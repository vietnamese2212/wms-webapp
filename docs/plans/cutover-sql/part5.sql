-- ══════════════════════════════════════════════════════════════════════════
-- CUTOVER production 15/08/2026 — PART5 (17 migration)
-- Dán TRỌN file này vào Supabase SQL Editor (project production svicyfquresxaigfxsdb) → Run.
-- Bọc trong 1 transaction: lỗi bất kỳ đâu là ROLLBACK toàn bộ part → sửa rồi chạy lại,
-- KHÔNG để schema dở dang. Chạy các part theo ĐÚNG THỨ TỰ part1 → part5.
-- ══════════════════════════════════════════════════════════════════════════
BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 20260810_scanlog_rpc_perf.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260810_scanlog_rpc_perf.sql
-- LỊCH SỬ QUÉT chết ở quy mô thật (bắt khi test 150k lượt quét/3 tháng, 10/08):
-- p50 8,4s → HTTP 500 (statement_timeout 8s PostgREST) với lọc 90 ngày; ngay cả "hôm nay"
-- (0 dòng khớp) cũng mất 4s. Ba nguyên nhân trong RPC get_outbound_scan_log (bản 16 tham số):
--   1. Lọc ngày NON-SARGABLE: `(ose.scanned_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= ...`
--      là BIỂU THỨC trên cột ⇒ idx_ose_scanned_at vô dụng ⇒ mọi truy vấn đều quét cả bảng.
--   2. COUNT(*) OVER() vật chất hóa TOÀN BỘ tập khớp qua 10 JOIN trước khi LIMIT.
--   3. LANGUAGE sql — bẫy generic plan đã ghi ở chiến dịch phân trang 28/07
--      (memory server-pagination-campaign: "LANGUAGE sql = generic plan >300s").
-- Fix theo đúng khuôn 28/07: plpgsql + force_custom_plan; quy đổi ngày VN → cận [from, to+1)
-- MỘT LẦN ở biến rồi so cột thô (index dùng được); COUNT tách riêng qua 7 join tối thiểu
-- (bỏ Warehouse/Location/Employee-confirm chỉ phục vụ hiển thị); trang chỉ join đủ 10 bảng
-- cho ≤ p_limit dòng. Semantics lọc GIỮ NGUYÊN: dòng nhặt lẻ tính theo loose_confirmed_at
-- (timestamptz), dòng thường theo scanned_at (naive UTC — memory naive-utc-timestamp-rpc-trap);
-- nhặt lẻ chỉ hiện khi đã xác nhận. Đo sau fix (cùng dữ liệu 150k): xem báo cáo 10/08.

-- Index cho nhánh nhặt lẻ (nhánh thường đã có idx_ose_scanned_at)
CREATE INDEX IF NOT EXISTS idx_ose_loose_confirmed_at
  ON "OutboundScanEntry" (loose_confirmed_at)
  WHERE is_loose_picking;

CREATE OR REPLACE FUNCTION public.get_outbound_scan_log(
  p_from_date text DEFAULT NULL, p_to_date text DEFAULT NULL, p_warehouse_ids text DEFAULT NULL,
  p_material_category text DEFAULT NULL, p_group_code text DEFAULT NULL, p_distributor text DEFAULT NULL,
  p_delivery_code text DEFAULT NULL, p_pallet_code text DEFAULT NULL, p_material text DEFAULT NULL,
  p_machine_codes text DEFAULT NULL, p_cycles text DEFAULT NULL, p_scanner_name text DEFAULT NULL,
  p_nmsx text DEFAULT NULL, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0,
  p_allowed_categories text DEFAULT NULL)
RETURNS TABLE(
  id text, pallet_code text, cartons_scanned numeric, production_date text, best_available_date text,
  scanned_at timestamp with time zone, is_loose_picking boolean, loose_confirmed_at timestamp with time zone,
  loose_confirmed_by_name text, group_code text, delivery_date date, license_plate text, container_number text,
  forklift_driver_names text, loader_name text, assigned_at timestamp with time zone, started_at timestamp with time zone,
  last_scanned_at timestamp with time zone, completed_at timestamp with time zone, warehouse_name text,
  delivery_code text, distributor_name text, header_text text, material_code_raw text, material_code text,
  material_name text, material_category text, shelf_life_days integer, cycle text, machine_code text, nmsx text,
  import_date timestamp with time zone, location_code text, scanner_name text, total_count bigint,
  base_unit text, entry_unit text, units_per_carton integer)
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  -- Ngày VN → cận thời gian tính MỘT LẦN: [from 00:00 VN, (to+1) 00:00 VN)
  v_from_n  timestamp   := CASE WHEN p_from_date IS NULL THEN NULL
                           ELSE ((p_from_date || ' 00:00:00+07')::timestamptz AT TIME ZONE 'UTC') END;
  v_to_n    timestamp   := CASE WHEN p_to_date IS NULL THEN NULL
                           ELSE (((p_to_date::date + 1)::text || ' 00:00:00+07')::timestamptz AT TIME ZONE 'UTC') END;
  v_from_tz timestamptz := CASE WHEN p_from_date IS NULL THEN NULL
                           ELSE (p_from_date || ' 00:00:00+07')::timestamptz END;
  v_to_tz   timestamptz := CASE WHEN p_to_date IS NULL THEN NULL
                           ELSE ((p_to_date::date + 1)::text || ' 00:00:00+07')::timestamptz END;
  v_total bigint;
BEGIN
  SELECT count(*) INTO v_total
  FROM "OutboundScanEntry"   ose
  JOIN "OutboundItem"        oi  ON oi.id  = ose.item_id
  JOIN "OutboundDelivery"    od  ON od.id  = oi.do_id
  JOIN "GroupDeliveryOrder"  gdo ON gdo.id = od.gdo_id
  LEFT JOIN "Material"       m   ON m.id   = oi.material_id
  LEFT JOIN "InventoryEntry" ie  ON ie.id  = ose.inventory_entry_id
  LEFT JOIN "Employee"       e   ON e.id   = ose.scanned_by
  WHERE
    ( (NOT ose.is_loose_picking
        AND (v_from_n IS NULL OR ose.scanned_at >= v_from_n)
        AND (v_to_n   IS NULL OR ose.scanned_at <  v_to_n))
      OR (ose.is_loose_picking AND ose.loose_confirmed = true
        AND (v_from_tz IS NULL OR ose.loose_confirmed_at >= v_from_tz)
        AND (v_to_tz   IS NULL OR ose.loose_confirmed_at <  v_to_tz)) )
    AND (p_warehouse_ids      IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
    AND (p_material_category  IS NULL OR m.category       = p_material_category)
    AND (p_allowed_categories IS NULL OR m.category IS NULL OR m.category = ANY(string_to_array(p_allowed_categories, ',')))
    AND (p_group_code         IS NULL OR gdo.group_code      ILIKE '%' || p_group_code    || '%')
    AND (p_distributor        IS NULL OR od.distributor_name ILIKE '%' || p_distributor   || '%')
    AND (p_delivery_code      IS NULL OR od.delivery_code    ILIKE '%' || p_delivery_code || '%')
    AND (p_pallet_code        IS NULL OR ose.pallet_code     ILIKE '%' || p_pallet_code   || '%')
    AND (p_material IS NULL OR CASE
          WHEN p_material LIKE '%,%' THEN m.id = ANY(string_to_array(p_material, ','))
          ELSE (m.material_code ILIKE '%' || p_material || '%'
                OR m.short_name ILIKE '%' || p_material || '%'
                OR oi.material_code_raw ILIKE '%' || p_material || '%') END)
    AND (p_machine_codes IS NULL OR ie.machine_code = ANY(string_to_array(p_machine_codes, ',')))
    AND (p_cycles        IS NULL OR ie.cycle        = ANY(string_to_array(p_cycles, ',')))
    AND (p_scanner_name  IS NULL OR e.name          ILIKE '%' || p_scanner_name || '%')
    AND (p_nmsx          IS NULL OR ose.nmsx        = ANY(string_to_array(p_nmsx, ',')));

  RETURN QUERY
  SELECT
    ose.id, ose.pallet_code, ose.cartons_scanned, ose.production_date, ose.best_available_date,
    ose.scanned_at::timestamptz, ose.is_loose_picking, ose.loose_confirmed_at,
    ec.name AS loose_confirmed_by_name, gdo.group_code,
    CASE WHEN ose.is_loose_picking
      THEN (ose.loose_confirmed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      ELSE ((ose.scanned_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    END AS delivery_date,
    gdo.license_plate, gdo.container_number, gdo.forklift_driver_names, gdo.loader_name,
    gdo.assigned_at::timestamptz, gdo.started_at::timestamptz, gdo.last_scanned_at, gdo.completed_at,
    w.name AS warehouse_name, od.delivery_code, od.distributor_name, oi.header_text,
    oi.material_code_raw, m.material_code, m.short_name AS material_name, m.category AS material_category,
    m.shelf_life_days, ie.cycle, ie.machine_code, ose.nmsx, ie.import_date::timestamptz,
    l.location_code, e.name AS scanner_name, v_total AS total_count,
    m.base_unit, m.entry_unit, m.units_per_carton
  FROM "OutboundScanEntry"   ose
  JOIN "OutboundItem"        oi  ON oi.id  = ose.item_id
  JOIN "OutboundDelivery"    od  ON od.id  = oi.do_id
  JOIN "GroupDeliveryOrder"  gdo ON gdo.id = od.gdo_id
  JOIN "Warehouse"           w   ON w.id   = gdo.warehouse_id
  LEFT JOIN "Material"       m   ON m.id   = oi.material_id
  LEFT JOIN "InventoryEntry" ie  ON ie.id  = ose.inventory_entry_id
  LEFT JOIN "Location"       l   ON l.id   = ie.location_id
  LEFT JOIN "Employee"       e   ON e.id   = ose.scanned_by
  LEFT JOIN "Employee"       ec  ON ec.id  = ose.loose_confirmed_by
  WHERE
    ( (NOT ose.is_loose_picking
        AND (v_from_n IS NULL OR ose.scanned_at >= v_from_n)
        AND (v_to_n   IS NULL OR ose.scanned_at <  v_to_n))
      OR (ose.is_loose_picking AND ose.loose_confirmed = true
        AND (v_from_tz IS NULL OR ose.loose_confirmed_at >= v_from_tz)
        AND (v_to_tz   IS NULL OR ose.loose_confirmed_at <  v_to_tz)) )
    AND (p_warehouse_ids      IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
    AND (p_material_category  IS NULL OR m.category       = p_material_category)
    AND (p_allowed_categories IS NULL OR m.category IS NULL OR m.category = ANY(string_to_array(p_allowed_categories, ',')))
    AND (p_group_code         IS NULL OR gdo.group_code      ILIKE '%' || p_group_code    || '%')
    AND (p_distributor        IS NULL OR od.distributor_name ILIKE '%' || p_distributor   || '%')
    AND (p_delivery_code      IS NULL OR od.delivery_code    ILIKE '%' || p_delivery_code || '%')
    AND (p_pallet_code        IS NULL OR ose.pallet_code     ILIKE '%' || p_pallet_code   || '%')
    AND (p_material IS NULL OR CASE
          WHEN p_material LIKE '%,%' THEN m.id = ANY(string_to_array(p_material, ','))
          ELSE (m.material_code ILIKE '%' || p_material || '%'
                OR m.short_name ILIKE '%' || p_material || '%'
                OR oi.material_code_raw ILIKE '%' || p_material || '%') END)
    AND (p_machine_codes IS NULL OR ie.machine_code = ANY(string_to_array(p_machine_codes, ',')))
    AND (p_cycles        IS NULL OR ie.cycle        = ANY(string_to_array(p_cycles, ',')))
    AND (p_scanner_name  IS NULL OR e.name          ILIKE '%' || p_scanner_name || '%')
    AND (p_nmsx          IS NULL OR ose.nmsx        = ANY(string_to_array(p_nmsx, ',')))
  ORDER BY ose.scanned_at DESC
  LIMIT p_limit OFFSET p_offset;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260810b_scanlog_search_perf.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260810b_scanlog_search_perf.sql
-- Ô TRUY CỨU Lịch sử quét (search_outbound_scan_log) chết 500 ở quy mô thật (150k lượt quét):
-- 13 phép `ILIKE '%q%'` rải trên 8 bảng ĐÃ JOIN + `carton_scans::text` (cast jsonb TỪNG DÒNG)
-- + COUNT(*) OVER() ⇒ vật chất hóa toàn bộ join 10 bảng × 150k dòng mỗi lần gõ → quá trần 8s,
-- UI treo skeleton vô hạn (đo 10/08). Cùng họ bệnh với get_outbound_scan_log (20260810).
--
-- Fix theo khuôn "THU HẸP ID" (tiền lệ omni-search 26/07): mỗi CHIỀU tìm = 1 nhánh UNION rẻ
-- chạy trên bảng GỐC của nó (ose đơn bảng · dimension nhỏ → dò id → lần theo index về scan id),
-- rồi count/page chỉ join trên TẬP KHỚP. Ngữ nghĩa OR 13 chiều GIỮ NGUYÊN; sửa kèm delivery_date
-- hiển thị theo đúng bẫy naive-UTC (memory naive-utc-timestamp-rpc-trap) đồng bộ với 20260810.
-- plpgsql + force_custom_plan (không dùng LANGUAGE sql — bẫy generic plan).

CREATE OR REPLACE FUNCTION public.search_outbound_scan_log(
  p_q text, p_warehouse_ids text DEFAULT NULL, p_allowed_categories text DEFAULT NULL,
  p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
RETURNS TABLE(
  id text, pallet_code text, cartons_scanned numeric, production_date text, best_available_date text,
  scanned_at timestamp with time zone, is_loose_picking boolean, loose_confirmed_at timestamp with time zone,
  loose_confirmed_by_name text, group_code text, delivery_date date, license_plate text, container_number text,
  forklift_driver_names text, loader_name text, assigned_at timestamp with time zone, started_at timestamp with time zone,
  last_scanned_at timestamp with time zone, completed_at timestamp with time zone, warehouse_name text,
  delivery_code text, distributor_name text, header_text text, material_code_raw text, material_code text,
  material_name text, material_category text, shelf_life_days integer, cycle text, machine_code text, nmsx text,
  import_date timestamp with time zone, location_code text, scanner_name text, total_count bigint,
  gdo_id text, item_id text, base_unit text, entry_unit text, units_per_carton integer)
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  v_total bigint;
  v_like  text := '%' || p_q || '%';
  -- Tập scan id KHỚP (đúng ngữ nghĩa OR 13 chiều cũ) — mỗi nhánh đi đường rẻ nhất của chiều đó.
  -- Gom vào MẢNG một lần (hàm STABLE không được CREATE TEMP TABLE), count + page cùng dùng.
  v_ids text[];
BEGIN
  SELECT array_agg(DISTINCT s.id) INTO v_ids FROM (
    -- 1. chiều nằm NGAY trên bảng quét (đơn bảng, không join)
    SELECT ose.id FROM "OutboundScanEntry" ose
    WHERE ose.pallet_code ILIKE v_like OR ose.carton_scans::text ILIKE v_like
    UNION ALL
    -- 2. chiều DO xuất (mã DO / tên NPP)
    SELECT ose.id FROM "OutboundScanEntry" ose
    JOIN "OutboundItem" oi ON oi.id = ose.item_id
    JOIN "OutboundDelivery" od ON od.id = oi.do_id
    WHERE od.delivery_code ILIKE v_like OR od.distributor_name ILIKE v_like
    UNION ALL
    -- 3. chiều chuyến (số chuyến / biển số / container) + tên kho
    SELECT ose.id FROM "OutboundScanEntry" ose
    JOIN "OutboundItem" oi ON oi.id = ose.item_id
    JOIN "OutboundDelivery" od ON od.id = oi.do_id
    JOIN "GroupDeliveryOrder" gdo ON gdo.id = od.gdo_id
    WHERE gdo.group_code ILIKE v_like OR gdo.license_plate ILIKE v_like
       OR gdo.container_number ILIKE v_like
       OR gdo.warehouse_id IN (SELECT w2.id FROM "Warehouse" w2 WHERE w2.name ILIKE v_like)
    UNION ALL
    -- 4. chiều mã hàng (danh mục nhỏ → dò trước rồi lần về item)
    SELECT ose.id FROM "OutboundScanEntry" ose
    JOIN "OutboundItem" oi ON oi.id = ose.item_id
    WHERE oi.material_code_raw ILIKE v_like
       OR oi.material_id IN (SELECT m2.id FROM "Material" m2 WHERE m2.material_code ILIKE v_like OR m2.short_name ILIKE v_like)
    UNION ALL
    -- 5. chiều người quét (bảng nhân sự nhỏ)
    SELECT ose.id FROM "OutboundScanEntry" ose
    WHERE ose.scanned_by IN (SELECT e2.id FROM "Employee" e2 WHERE e2.name ILIKE v_like)
    UNION ALL
    -- 6. chiều vị trí (dò Location → InventoryEntry theo index → scan)
    SELECT ose.id FROM "OutboundScanEntry" ose
    WHERE ose.inventory_entry_id IN (
      SELECT ie2.id FROM "InventoryEntry" ie2
      WHERE ie2.location_id IN (SELECT l2.id FROM "Location" l2 WHERE l2.location_code ILIKE v_like))
  ) s;

  SELECT count(*) INTO v_total
  FROM "OutboundScanEntry" ose
  JOIN "OutboundItem" oi ON oi.id = ose.item_id
  JOIN "OutboundDelivery" od ON od.id = oi.do_id
  JOIN "GroupDeliveryOrder" gdo ON gdo.id = od.gdo_id
  LEFT JOIN "Material" m ON m.id = oi.material_id
  WHERE ose.id = ANY(v_ids)
    AND (p_warehouse_ids IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
    AND (p_allowed_categories IS NULL OR m.category IS NULL OR m.category = ANY(string_to_array(p_allowed_categories, ',')))
    AND (NOT ose.is_loose_picking OR ose.loose_confirmed = true);

  RETURN QUERY
  SELECT
    ose.id, ose.pallet_code, ose.cartons_scanned, ose.production_date, ose.best_available_date,
    ose.scanned_at::timestamptz, ose.is_loose_picking, ose.loose_confirmed_at,
    ec.name AS loose_confirmed_by_name, gdo.group_code,
    CASE WHEN ose.is_loose_picking
      THEN (ose.loose_confirmed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      ELSE ((ose.scanned_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    END AS delivery_date,
    gdo.license_plate, gdo.container_number, gdo.forklift_driver_names, gdo.loader_name,
    gdo.assigned_at::timestamptz, gdo.started_at::timestamptz, gdo.last_scanned_at, gdo.completed_at,
    w.name AS warehouse_name, od.delivery_code, od.distributor_name, oi.header_text,
    oi.material_code_raw, m.material_code, m.short_name AS material_name, m.category AS material_category,
    m.shelf_life_days, ie.cycle, ie.machine_code, ose.nmsx, ie.import_date::timestamptz,
    l.location_code, e.name AS scanner_name, v_total AS total_count,
    gdo.id::text AS gdo_id, oi.id::text AS item_id,
    m.base_unit, m.entry_unit, m.units_per_carton
  FROM "OutboundScanEntry" ose
  JOIN "OutboundItem" oi ON oi.id = ose.item_id
  JOIN "OutboundDelivery" od ON od.id = oi.do_id
  JOIN "GroupDeliveryOrder" gdo ON gdo.id = od.gdo_id
  JOIN "Warehouse" w ON w.id = gdo.warehouse_id
  LEFT JOIN "Material" m ON m.id = oi.material_id
  LEFT JOIN "InventoryEntry" ie ON ie.id = ose.inventory_entry_id
  LEFT JOIN "Location" l ON l.id = ie.location_id
  LEFT JOIN "Employee" e ON e.id = ose.scanned_by
  LEFT JOIN "Employee" ec ON ec.id = ose.loose_confirmed_by
  WHERE ose.id = ANY(v_ids)
    AND (p_warehouse_ids IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
    AND (p_allowed_categories IS NULL OR m.category IS NULL OR m.category = ANY(string_to_array(p_allowed_categories, ',')))
    AND (NOT ose.is_loose_picking OR ose.loose_confirmed = true)
  ORDER BY ose.scanned_at DESC
  LIMIT p_limit OFFSET p_offset;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260810c_employee_fk_indexes.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260810c_employee_fk_indexes.sql
-- XÓA NHÂN VIÊN TIMEOUT 8s khi bảng nghiệp vụ đạt quy mô thật (bug #4 check-app 10/08,
-- bắt khi test với 3 tháng dữ liệu 390k dòng): DELETE 1 dòng "Employee" kích RI-check
-- `SELECT 1 FROM <bảng con> WHERE <cột FK> = $id` trên TỪNG FK trỏ Employee — các cột này
-- KHÔNG có index nên mỗi FK = 1 seq scan (InventoryEntry 175k × 3 cột + OutboundScanEntry
-- 150k × 2 cột…) ⇒ 57014 statement timeout. Ảnh hưởng cả trang Quản lý người dùng (xóa
-- tài khoản) lẫn thao tác quản trị DB ở production khi dữ liệu tích đủ lớn.
-- Index partial WHERE IS NOT NULL: RI-check tra giá trị cụ thể (non-null) nên dùng được,
-- đa số dòng để NULL các cột này nên index rất nhỏ.
-- Bảng chọn theo QUY MÔ (đang/ sẽ hàng trăm nghìn–triệu dòng/năm); bảng nhỏ cố định bỏ qua.

-- InventoryEntry (175k, sẽ hàng triệu)
CREATE INDEX IF NOT EXISTS idx_inv_created_by   ON "InventoryEntry" (created_by)   WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_updated_by   ON "InventoryEntry" (updated_by)   WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_stocktake_by ON "InventoryEntry" (stocktake_by) WHERE stocktake_by IS NOT NULL;

-- OutboundScanEntry (150k, sẽ hàng triệu)
CREATE INDEX IF NOT EXISTS idx_ose_scanned_by         ON "OutboundScanEntry" (scanned_by)         WHERE scanned_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ose_loose_confirmed_by ON "OutboundScanEntry" (loose_confirmed_by) WHERE loose_confirmed_by IS NOT NULL;

-- GroupDeliveryOrder + StocktakeLog + ProductionImport (vài nghìn → hàng trăm nghìn/năm)
CREATE INDEX IF NOT EXISTS idx_gdo_forklift_driver ON "GroupDeliveryOrder" (forklift_driver_id) WHERE forklift_driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stocktakelog_counted_by ON "StocktakeLog" (counted_by) WHERE counted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prodimport_imported_by ON "ProductionImport" (imported_by) WHERE imported_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prodimport_created_by  ON "ProductionImport" (created_by)  WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prodimport_updated_by  ON "ProductionImport" (updated_by)  WHERE updated_by IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────
-- 20260810d_outbound_pool_atomic.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260810d_outbound_pool_atomic.sql
-- BUG #6 check-app 10/08 — HOÀN TỒN KHỐNG dưới bão 504 (đo thật: pool 15 → 23, remaining 23 > imported 15,
-- adjustment 0, mọi chuyến đã xóa). Cơ chế: các đường ghi-nhận/hoàn tồn pool no-QR
-- (manualCompleteItem · quickExportGDO · quickExportExistingGDO) là CHUỖI request rời:
--   (1) applySharedPoolDelta đổi pool → (2) update OutboundItem.cartons_scanned → (3) upsert OutboundScanEntry.
-- Vercel kill function ở 60s GIỮA (1) và (2) ⇒ pool đã hoàn nhưng cartons_scanned còn giá trị cũ
-- ⇒ lượt hoàn sau tính delta từ scanned cũ → HOÀN ĐÔI (tồn tăng khống). Chiều xuôi kill giữa (1)-(2)
-- thì MẤT tồn âm thầm (đã trừ mà không có vết). Cùng họ "adjust phi-nguyên-tử" 23/07 (adjust_inventory_atomic).
--
-- Fix = RPC `outbound_pool_apply`: TRỌN chu trình trong MỘT transaction, và số lượng truyền vào là
-- SỐ TUYỆT ĐỐI (p_new_qty) chứ không phải delta — delta tính TRONG transaction từ chính
-- OutboundItem.cartons_scanned (đã khóa FOR UPDATE) ⇒ gọi lại lần 2 delta=0, hoàn đôi BẤT KHẢ THI
-- theo cấu trúc; kill giữa chừng = rollback toàn bộ, pool và scanned không bao giờ lệch nhau.
-- p_claim_only_pending thay luôn cú CAS-claim + "hoàn bù khi thua đua" của quickExportExistingGDO
-- (thua đua = CLAIM_LOST, KHÔNG đụng tồn — hết cả cửa hoàn-bù bị kill).
-- Semantics pool GIỮ NGUYÊN applySharedPoolDelta cũ: QTY/QTY_DATE thiếu → INSUFFICIENT;
-- NONE/không dòng → OK không đụng tồn; QTY_DATE trừ FEFO (NSX cũ trước, lọc theo NSX chọn tay),
-- mode khác trừ dòng còn-nhiều-trước; hoàn vào dòng còn tồn đầu tiên (QTY_DATE: NSX cũ nhất);
-- status dòng pool: 0=EXPORTED, <imported=PARTIAL, còn lại IN_STOCK.

CREATE OR REPLACE FUNCTION public.outbound_pool_apply(
  p_item_id text,
  p_material_code text,            -- pallet_code của pool (= mã hàng)
  p_warehouse_id text,
  p_mode text,                     -- inventory_mode kho: QTY / QTY_DATE / NONE / khác
  p_new_qty numeric,               -- SỐ BASE TUYỆT ĐỐI muốn chốt cho item
  p_item_status text,              -- trạng thái item sau ghi (COMPLETED / IN_PROGRESS)
  p_chosen_date text DEFAULT NULL, -- QTY_DATE: NSX chọn tay yyyy-mm-dd (NULL = FEFO)
  p_claim_only_pending boolean DEFAULT false,  -- true: item đã COMPLETED → CLAIM_LOST, không đụng gì
  p_touch_pool boolean DEFAULT true            -- false: mã thường không pool — chỉ update item
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE
AS $$
DECLARE
  v_now   timestamp := (now() AT TIME ZONE 'UTC');
  v_old   numeric;
  v_status text;
  v_delta numeric;
  v_rows  record;
  v_pool  RECORD;
  v_total numeric := 0;
  v_need  numeric;
  v_take  numeric;
  v_entry text := NULL;
  v_scan_id text;
  v_has_rows boolean := false;
BEGIN
  SELECT cartons_scanned, status INTO v_old, v_status
  FROM "OutboundItem" WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'NOT_FOUND'); END IF;
  IF p_claim_only_pending AND v_status = 'COMPLETED' THEN
    RETURN jsonb_build_object('outcome', 'CLAIM_LOST');
  END IF;

  v_old   := COALESCE(v_old, 0);
  v_delta := p_new_qty - v_old;

  IF p_touch_pool AND v_delta <> 0 THEN
    -- Khóa TOÀN BỘ dòng pool của (mã, kho) — vài chục dòng là nhiều (1 dòng/NSX ở QTY_DATE)
    CREATE TEMP TABLE IF NOT EXISTS _pool_rows(
      id text, remaining numeric, imported numeric, pdate text, ord int) ON COMMIT DROP;
    TRUNCATE _pool_rows;
    -- FOR UPDATE không đứng chung window function → khóa ở subquery, đánh số ở ngoài
    INSERT INTO _pool_rows
    SELECT locked.id, locked.cartons_remaining, locked.cartons_imported,
           to_char(locked.production_date, 'YYYY-MM-DD'),
           row_number() OVER (ORDER BY locked.production_date ASC NULLS LAST, locked.id)::int
    FROM (
      SELECT e.id, e.cartons_remaining, e.cartons_imported, e.production_date
      FROM "InventoryEntry" e
      WHERE e.pallet_code = p_material_code AND e.warehouse_id = p_warehouse_id::uuid
        AND (p_mode <> 'QTY_DATE' OR p_chosen_date IS NULL
             OR to_char(e.production_date, 'YYYY-MM-DD') = p_chosen_date)
      FOR UPDATE OF e
    ) locked;
    SELECT COALESCE(SUM(remaining), 0), COUNT(*) > 0 INTO v_total, v_has_rows FROM _pool_rows;

    IF v_delta > 0 THEN
      -- TRỪ TỒN
      IF NOT v_has_rows THEN
        IF p_mode IN ('QTY', 'QTY_DATE') THEN
          RETURN jsonb_build_object('outcome', 'INSUFFICIENT', 'available', 0);
        END IF;   -- NONE/khác: không theo dõi mã này — đi tiếp không đụng tồn
      ELSIF v_total < v_delta THEN
        RETURN jsonb_build_object('outcome', 'INSUFFICIENT', 'available', v_total);
      ELSE
        v_need := v_delta;
        FOR v_pool IN
          SELECT * FROM _pool_rows WHERE remaining > 0
          ORDER BY CASE WHEN p_mode = 'QTY_DATE' THEN ord ELSE NULL END ASC NULLS LAST,
                   CASE WHEN p_mode = 'QTY_DATE' THEN NULL ELSE remaining END DESC NULLS LAST
        LOOP
          EXIT WHEN v_need <= 0;
          v_take := LEAST(v_need, v_pool.remaining);
          UPDATE "InventoryEntry" SET
            cartons_remaining = cartons_remaining - v_take,
            status = CASE WHEN cartons_remaining - v_take = 0 THEN 'EXPORTED'
                          WHEN cartons_remaining - v_take < cartons_imported THEN 'PARTIAL'
                          ELSE 'IN_STOCK' END,
            updated_at = v_now
          WHERE id = v_pool.id;
          v_need := v_need - v_take;
          IF v_entry IS NULL THEN v_entry := v_pool.id; END IF;
        END LOOP;
      END IF;
    ELSE
      -- HOÀN TỒN |v_delta|: dòng còn tồn đầu tiên (QTY_DATE = NSX cũ nhất), không có thì dòng đầu
      IF v_has_rows THEN
        SELECT id INTO v_entry FROM _pool_rows
        ORDER BY (remaining > 0) DESC, ord ASC LIMIT 1;
        UPDATE "InventoryEntry" SET
          cartons_remaining = cartons_remaining - v_delta,   -- v_delta âm → cộng
          status = CASE WHEN cartons_remaining - v_delta = 0 THEN 'EXPORTED'
                        WHEN cartons_remaining - v_delta < cartons_imported THEN 'PARTIAL'
                        ELSE 'IN_STOCK' END,
          updated_at = v_now
        WHERE id = v_entry;
      END IF;   -- không dòng nào = mã không theo dõi → hoàn là noop (như cũ)
    END IF;
  END IF;

  UPDATE "OutboundItem"
  SET status = p_item_status, cartons_scanned = p_new_qty, updated_at = v_now
  WHERE id = p_item_id;

  IF p_touch_pool THEN
    SELECT id INTO v_scan_id FROM "OutboundScanEntry" WHERE item_id = p_item_id LIMIT 1;
    IF v_scan_id IS NOT NULL THEN
      UPDATE "OutboundScanEntry"
      SET cartons_scanned = p_new_qty,
          inventory_entry_id = COALESCE(v_entry, inventory_entry_id),
          updated_at = v_now
      WHERE id = v_scan_id;
    ELSE
      INSERT INTO "OutboundScanEntry"(id, item_id, inventory_entry_id, pallet_code, cartons_scanned,
        is_loose_picking, scanned_at, created_at, updated_at)
      VALUES (gen_random_uuid()::text, p_item_id, v_entry, p_material_code, p_new_qty,
        false, v_now, v_now, v_now);
    END IF;
  END IF;

  RETURN jsonb_build_object('outcome', 'OK', 'inv_entry_id', v_entry, 'available', v_total - v_delta);
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260811_packing_logs.sql
-- ───────────────────────────────────────────────────────────────────────
-- ============================================================================
-- SỔ ĐÓNG GÓI ĐIỆN TỬ (11/08/2026) — số hóa sổ đóng gói viết tay tại xưởng SX.
-- Workflow user chốt: tem pallet in sẵn (PalletLabelPrint) → quét tem lúc BẮT ĐẦU
-- xếp pallet (mở sổ) → pallet đầy đóng sổ (bấm Đóng hoặc quét tem pallet kế tiếp
-- cùng máy = tự đóng). GIỜ SẢN XUẤT THẬT lấy từ CHỮ IN PHUN trên thùng đầu/cuối
-- (chụp ảnh + OCR Tesseract chạy tại máy — bậc 0, đọc trượt thì điền tay); giờ
-- bấm nút chỉ là giờ thao tác (phụ, để đối chiếu — user chốt 11/08 "giờ in 10h10,
-- bốc xếp 10h12 thì ghi lúc bốc là không đúng").
-- 1 pallet = 1 dòng sổ (không ghi per thùng). Ảnh = bằng chứng gốc, lưu bucket
-- riêng tư 'packing-photos' (như forklift-photos), BE phát signed URL 1h.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.packing_logs (
  id             uuid PRIMARY KEY,
  pallet_code    text NOT NULL,              -- nguyên văn tem (normalizeQR — giữ đệm trong)
  material_code  text,
  material_id    uuid,
  machine_code   text,                        -- máy/chuyền (từ tem; V1 = đoạn 4)
  warehouse_id   text,                        -- kho/NMSX gắn tem (PalletLabelPrint.warehouse_id)
  qty_cartons    numeric,                     -- số thùng trên pallet
  qty_source     text NOT NULL DEFAULT 'LABEL',  -- LABEL (số chuẩn tem) | MANUAL (sửa tay lúc đóng)
  status         text NOT NULL DEFAULT 'OPEN',   -- OPEN | CLOSED | CANCELLED
  open_scan_at   timestamptz NOT NULL,        -- giờ THAO TÁC quét mở (máy ghi — phụ)
  close_scan_at  timestamptz,                 -- giờ THAO TÁC đóng (máy ghi — phụ)
  prod_start_at  timestamptz,                 -- giờ SX thùng ĐẦU (từ chữ in phun — CHÍNH)
  prod_end_at    timestamptz,                 -- giờ SX thùng CUỐI
  prod_start_src text,                        -- OCR | MANUAL (null = chưa có)
  prod_end_src   text,
  ocr_start_raw  text,                        -- nguyên văn OCR đọc được (giữ cả 587/B/Ak32 — khai thác sau)
  ocr_end_raw    text,
  photo_start_path text,                      -- object path trong bucket packing-photos
  photo_end_path   text,
  packed_by      uuid,                        -- Employee.id người đóng
  packed_by_name text,
  note           text,
  created_at     timestamptz,
  updated_at     timestamptz NOT NULL
);

-- 1 tem chỉ có 1 dòng sổ SỐNG — chống 2 người cùng quét mở (23505 → BE báo "tem đã có sổ")
CREATE UNIQUE INDEX IF NOT EXISTS uq_packing_pallet_alive
  ON public.packing_logs (pallet_code) WHERE status <> 'CANCELLED';

-- Board: pallet đang mở theo máy · Sổ: duyệt theo thời gian
CREATE INDEX IF NOT EXISTS idx_packing_open_machine
  ON public.packing_logs (machine_code, open_scan_at) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_packing_created ON public.packing_logs (created_at DESC);

-- RLS: đóng anon; authenticated ĐỌC được (bắt buộc cho realtime — bài học
-- realtime-rls-silent-death: RLS bật + 0 policy SELECT = client không nhận sự kiện).
-- Dữ liệu vận hành dùng chung (như FillTask), không phải dữ liệu cá nhân.
ALTER TABLE public.packing_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS packing_logs_read ON public.packing_logs;
CREATE POLICY packing_logs_read ON public.packing_logs FOR SELECT TO authenticated USING (true);

-- Realtime cho board cả tổ cùng thấy
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.packing_logs;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bucket ảnh riêng tư (mẫu forklift-photos): không policy storage.objects →
-- chỉ BE (service role) upload + phát signed URL.
INSERT INTO storage.buckets (id, name, public)
VALUES ('packing-photos', 'packing-photos', false)
ON CONFLICT (id) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 20260811b_packing_runs.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260811b — LỆNH MỞ TRANG SỔ ĐÓNG GÓI (user chốt 11/08 chiều):
-- Trước khi quét tem pallet phải MỞ TRANG SỔ (1 dòng = 1 trang sản phẩm trong sổ viết tay):
-- Kho + Ngày + Ca SX + Chu kỳ + Mã SP + Máy + Giờ bắt đầu; bấm "Giờ kết thúc" khi xong
-- → tính TỔNG SẢN LƯỢNG (Σ thùng các pallet đã ghi vào trang). Quét tem CHỈ được khi có
-- trang sổ đang MỞ khớp mã — pallet gắn run_id để gom/tra cứu.

CREATE TABLE IF NOT EXISTS packing_runs (
  id             uuid PRIMARY KEY,
  warehouse_id   text NOT NULL,
  run_date       date NOT NULL,
  shift          text,
  cycle          text,
  material_code  text NOT NULL,
  material_id    uuid,
  machine_code   text NOT NULL,
  start_at       timestamptz NOT NULL,
  end_at         timestamptz,
  qty_total      numeric,          -- Σ thùng các pallet trong trang — tính khi bấm Giờ kết thúc
  pallet_count   integer,
  status         text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','CANCELLED')),
  opened_by      uuid,
  opened_by_name text,
  closed_by      uuid,
  closed_by_name text,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL
);

-- 1 trang MỞ duy nhất per (kho, mã, máy) — 2 người cùng mở trùng: người sau nhận 23505 → 409
CREATE UNIQUE INDEX IF NOT EXISTS uq_packing_run_open
  ON packing_runs (warehouse_id, material_code, machine_code) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_packing_runs_date ON packing_runs (run_date DESC);
CREATE INDEX IF NOT EXISTS idx_packing_runs_open ON packing_runs (material_code) WHERE status = 'OPEN';

ALTER TABLE packing_logs ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES packing_runs(id);
CREATE INDEX IF NOT EXISTS idx_packing_logs_run ON packing_logs (run_id);

-- Realtime: RLS bật + policy SELECT authenticated (thiếu policy = realtime CHẾT CÂM — memory realtime-rls-silent-death)
ALTER TABLE packing_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS packing_runs_read ON packing_runs;
CREATE POLICY packing_runs_read ON packing_runs FOR SELECT TO authenticated USING (true);
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE packing_runs;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260813_packing_multi_material.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260813 — SỔ ĐÓNG GÓI: (1) 1 trang sổ ghi NHIỀU MÃ (user 13/08: "1 số loại hàng có 2,3 mã —
-- SX chung 1 chu kỳ và 1 máy → khi mở sổ cho phép nhiều mã chung 1 sổ"); (2) ĐỐI CHIẾU SX ↔ KHO:
-- quét ghi sổ = xác nhận LẦN 1 (SX đã sinh pallet), quét nhập kho = xác nhận LẦN 2 →
-- tra "pallet SX tạo ra mà kho CHƯA nhận" theo pallet_code (khóa khớp 2 bên, đã normalizeQR cả 2 chiều).

-- 1) Cột mảng mã — material_code giữ = mã ĐẦU (hiển thị cũ + unique index cũ vẫn là lưới phụ)
ALTER TABLE packing_runs ADD COLUMN IF NOT EXISTS material_codes text[];
UPDATE packing_runs SET material_codes = ARRAY[material_code] WHERE material_codes IS NULL;

CREATE INDEX IF NOT EXISTS idx_packing_runs_open_codes
  ON packing_runs USING gin (material_codes) WHERE status = 'OPEN';

-- 2) Tra "kho đã nhận pallet chưa" — InventoryEntry chưa có index pallet_code đứng đầu
--    (uq_inventory_active_wh_pallet là (kho, pallet) partial — không phục vụ lookup theo pallet đơn lẻ)
CREATE INDEX IF NOT EXISTS idx_inventory_pallet_code ON "InventoryEntry" (pallet_code);

-- 3) RPC MỞ TRANG SỔ — chống đua overlap mã bằng advisory xact lock per (kho, máy):
--    unique index cũ chỉ bắt trùng mã ĐẦU; 2 trang mã GIAO NHAU (vd [A,B] vs [B]) phải chặn ở đây.
--    Lỗi nghiệp vụ trả qua RAISE với prefix: PACKDUP: → 409 RUN_DUP · PACKOPEN: → 422 (controller bóc).
CREATE OR REPLACE FUNCTION packing_open_run(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_codes   text[] := ARRAY(SELECT DISTINCT upper(trim(x)) FROM jsonb_array_elements_text(p->'material_codes') x WHERE trim(x) <> '');
  v_wh      text   := trim(coalesce(p->>'warehouse_id', ''));
  v_machine text   := upper(trim(coalesce(p->>'machine_code', '')));
  v_dup     text[];
  v_row     packing_runs;
BEGIN
  IF v_wh = '' THEN RAISE EXCEPTION 'PACKOPEN:Chọn Kho / Nhà máy'; END IF;
  IF coalesce(array_length(v_codes, 1), 0) = 0 THEN RAISE EXCEPTION 'PACKOPEN:Chọn Mã sản phẩm'; END IF;
  IF array_length(v_codes, 1) > 10 THEN RAISE EXCEPTION 'PACKOPEN:Tối đa 10 mã / 1 trang sổ'; END IF;
  IF v_machine = '' THEN RAISE EXCEPTION 'PACKOPEN:Nhập Máy'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('packing_open|' || v_wh || '|' || v_machine));

  SELECT array_agg(DISTINCT c) INTO v_dup
    FROM packing_runs r, unnest(r.material_codes) c
   WHERE r.status = 'OPEN' AND r.warehouse_id = v_wh AND r.machine_code = v_machine
     AND c = ANY(v_codes);
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'PACKDUP:Mã % đang có trang sổ MỞ trên máy này — dùng trang đó hoặc bấm Giờ kết thúc trước', array_to_string(v_dup, ', ');
  END IF;

  INSERT INTO packing_runs (id, warehouse_id, run_date, shift, cycle,
      material_code, material_codes, material_id, machine_code, start_at, status,
      opened_by, opened_by_name, note, created_at, updated_at)
  VALUES (gen_random_uuid(), v_wh,
      coalesce(nullif(p->>'run_date', '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
      nullif(left(trim(coalesce(p->>'shift', '')), 40), ''),
      nullif(left(trim(coalesce(p->>'cycle', '')), 40), ''),
      v_codes[1], v_codes,
      CASE WHEN coalesce(p->>'material_id', '') ~ '^[0-9a-fA-F-]{36}$' THEN (p->>'material_id')::uuid END,
      left(v_machine, 10),
      coalesce(nullif(p->>'start_at', '')::timestamptz, now()), 'OPEN',
      CASE WHEN coalesce(p->>'opened_by', '') ~ '^[0-9a-fA-F-]{36}$' THEN (p->>'opened_by')::uuid END,
      nullif(p->>'opened_by_name', ''),
      nullif(left(trim(coalesce(p->>'note', '')), 500), ''),
      now(), now())
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;

-- 4) RPC TRANG SỔ PALLET + ĐỐI CHIẾU — rows + total + đếm đã/chưa nhận kho CÙNG MỘT WHERE
--    (received = tồn tại InventoryEntry cùng pallet_code — nhập rồi xuất vẫn tính ĐÃ NHẬN;
--     đếm đã/chưa loại dòng CANCELLED — dòng hủy không phải "SX đã tạo ra").
--    plpgsql + force_custom_plan (bẫy generic plan — memory server-pagination-campaign).
CREATE OR REPLACE FUNCTION packing_logs_recon(
  p_status text DEFAULT NULL, p_wh text DEFAULT NULL, p_scope text[] DEFAULT NULL,
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_machine text DEFAULT NULL, p_search text DEFAULT NULL, p_received text DEFAULT NULL,
  p_page int DEFAULT 1, p_size int DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET plan_cache_mode = force_custom_plan AS $$
DECLARE
  v_size int := least(greatest(coalesce(p_size, 200), 1), 500);
  v_off  int := greatest(0, (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_size, 200), 1), 500));
  v_rows jsonb; v_total bigint; v_recv bigint; v_miss bigint;
BEGIN
  WITH base AS (
    SELECT l.*,
           (SELECT min(e.created_at) FROM "InventoryEntry" e WHERE e.pallet_code = l.pallet_code) AS received_at
      FROM packing_logs l
     WHERE (p_status IS NULL OR l.status = p_status)
       AND (p_wh IS NULL OR l.warehouse_id = p_wh)
       AND (p_scope IS NULL OR l.warehouse_id IS NULL OR l.warehouse_id = ANY(p_scope))
       AND (p_from IS NULL OR l.open_scan_at >= p_from)
       AND (p_to IS NULL OR l.open_scan_at < p_to)
       AND (p_machine IS NULL OR l.machine_code = p_machine)
       AND (p_search IS NULL OR l.pallet_code ILIKE '%' || p_search || '%'
            OR l.material_code ILIKE '%' || p_search || '%'
            OR l.packed_by_name ILIKE '%' || p_search || '%')
  ), filt AS (
    SELECT * FROM base
     WHERE p_received IS NULL
        OR (p_received = 'YES' AND received_at IS NOT NULL)
        OR (p_received = 'NO'  AND received_at IS NULL)
  )
  SELECT (SELECT count(*) FROM filt),
         (SELECT count(*) FROM base WHERE received_at IS NOT NULL AND status <> 'CANCELLED'),
         (SELECT count(*) FROM base WHERE received_at IS NULL AND status <> 'CANCELLED'),
         (SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
            FROM (SELECT * FROM filt ORDER BY open_scan_at DESC OFFSET v_off LIMIT v_size) f)
    INTO v_total, v_recv, v_miss, v_rows;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total,
                            'received_count', v_recv, 'missing_count', v_miss);
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260813b_packing_recon_qty_alert.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260813b — user duyệt 3 đề xuất đối chiếu SX↔KHO:
-- (3) SO SỐ LƯỢNG: pallet kho ĐÃ nhận nhưng số thùng KHÁC sổ ghi → theo dõi ngay trong sổ
--     (recon v2: thêm received_qty + is_qty_diff + diff_count, filter p_received='DIFF').
-- (2) RULE CẢNH BÁO: pallet SX ghi sổ quá N giờ mà kho chưa nhận → trung tâm Thông báo
--     (RPC gộp per kho — tránh trăm alert lẻ; ngưỡng giờ tùy biến qua alert_thresholds).

-- Recon v2 (thay bản 20260813 — cùng chữ ký, thêm cột trả về + giá trị 'DIFF' cho p_received)
CREATE OR REPLACE FUNCTION packing_logs_recon(
  p_status text DEFAULT NULL, p_wh text DEFAULT NULL, p_scope text[] DEFAULT NULL,
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_machine text DEFAULT NULL, p_search text DEFAULT NULL, p_received text DEFAULT NULL,
  p_page int DEFAULT 1, p_size int DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET plan_cache_mode = force_custom_plan AS $$
DECLARE
  v_size int := least(greatest(coalesce(p_size, 200), 1), 500);
  v_off  int := greatest(0, (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_size, 200), 1), 500));
  v_rows jsonb; v_total bigint; v_recv bigint; v_miss bigint; v_diff bigint;
BEGIN
  WITH base AS (
    SELECT l.*, re.created_at AS received_at, re.cartons_imported AS received_qty,
           -- lệch = kho đã nhận + CẢ 2 BÊN có số + khác nhau (sổ chưa khai số thùng thì chưa kết luận)
           (re.created_at IS NOT NULL AND l.qty_cartons IS NOT NULL AND re.cartons_imported IS DISTINCT FROM l.qty_cartons) AS is_qty_diff
      FROM packing_logs l
      LEFT JOIN LATERAL (
        SELECT e.created_at, e.cartons_imported
          FROM "InventoryEntry" e WHERE e.pallet_code = l.pallet_code
         ORDER BY e.created_at LIMIT 1
      ) re ON true
     WHERE (p_status IS NULL OR l.status = p_status)
       AND (p_wh IS NULL OR l.warehouse_id = p_wh)
       AND (p_scope IS NULL OR l.warehouse_id IS NULL OR l.warehouse_id = ANY(p_scope))
       AND (p_from IS NULL OR l.open_scan_at >= p_from)
       AND (p_to IS NULL OR l.open_scan_at < p_to)
       AND (p_machine IS NULL OR l.machine_code = p_machine)
       AND (p_search IS NULL OR l.pallet_code ILIKE '%' || p_search || '%'
            OR l.material_code ILIKE '%' || p_search || '%'
            OR l.packed_by_name ILIKE '%' || p_search || '%')
  ), filt AS (
    SELECT * FROM base
     WHERE p_received IS NULL
        OR (p_received = 'YES'  AND received_at IS NOT NULL)
        OR (p_received = 'NO'   AND received_at IS NULL)
        OR (p_received = 'DIFF' AND is_qty_diff)
  )
  SELECT (SELECT count(*) FROM filt),
         (SELECT count(*) FROM base WHERE received_at IS NOT NULL AND status <> 'CANCELLED'),
         (SELECT count(*) FROM base WHERE received_at IS NULL AND status <> 'CANCELLED'),
         (SELECT count(*) FROM base WHERE is_qty_diff AND status <> 'CANCELLED'),
         (SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
            FROM (SELECT * FROM filt ORDER BY open_scan_at DESC OFFSET v_off LIMIT v_size) f)
    INTO v_total, v_recv, v_miss, v_diff, v_rows;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total,
                            'received_count', v_recv, 'missing_count', v_miss, 'diff_count', v_diff);
END $$;

-- Rule cảnh báo: pallet SX ghi sổ > p_hours giờ mà kho CHƯA nhận — GỘP PER KHO (nhà máy)
-- p_window_days chặn quét cả lịch sử (pallet quá cũ coi như đã xử lý tay / dữ liệu nguội).
CREATE OR REPLACE FUNCTION alerts_packing_unreceived(p_hours int DEFAULT 12, p_window_days int DEFAULT 7)
RETURNS TABLE (warehouse_id text, n bigint, oldest_hours numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET plan_cache_mode = force_custom_plan AS $$
BEGIN
  RETURN QUERY
  SELECT l.warehouse_id, count(*)::bigint,
         round(max(extract(epoch FROM (now() - l.open_scan_at)) / 3600)::numeric, 1)
    FROM packing_logs l
   WHERE l.status <> 'CANCELLED'
     AND l.open_scan_at < now() - make_interval(hours => p_hours)
     AND l.open_scan_at > now() - make_interval(days => p_window_days)
     AND NOT EXISTS (SELECT 1 FROM "InventoryEntry" e WHERE e.pallet_code = l.pallet_code)
   GROUP BY l.warehouse_id;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260813c_packing_recon_cycle.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260813c — tab Sổ pallet cần BỘ LỌC ĐẦY ĐỦ như tab Đóng gói (user 13/08 tối): thêm filter CHU KỲ.
-- Chu kỳ nằm ở TRANG SỔ (packing_runs.cycle) → recon v3 JOIN run của dòng, thêm p_cycle (ilike partial);
-- rows trả kèm run_cycle để FE hiển thị được giá trị đang lọc.
-- ⚠️ Đổi CHỮ KÝ (thêm tham số giữa) ⇒ DROP bản 10 tham số trước — để 2 overload sống chung là
-- PostgREST rpc gọi theo tên sẽ ambiguous / gọi nhầm bản cũ.
DROP FUNCTION IF EXISTS packing_logs_recon(text, text, text[], timestamptz, timestamptz, text, text, text, int, int);

CREATE OR REPLACE FUNCTION packing_logs_recon(
  p_status text DEFAULT NULL, p_wh text DEFAULT NULL, p_scope text[] DEFAULT NULL,
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_machine text DEFAULT NULL, p_cycle text DEFAULT NULL,
  p_search text DEFAULT NULL, p_received text DEFAULT NULL,
  p_page int DEFAULT 1, p_size int DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET plan_cache_mode = force_custom_plan AS $$
DECLARE
  v_size int := least(greatest(coalesce(p_size, 200), 1), 500);
  v_off  int := greatest(0, (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_size, 200), 1), 500));
  v_rows jsonb; v_total bigint; v_recv bigint; v_miss bigint; v_diff bigint;
BEGIN
  WITH base AS (
    SELECT l.*, r.cycle AS run_cycle,
           re.created_at AS received_at, re.cartons_imported AS received_qty,
           -- lệch = kho đã nhận + CẢ 2 BÊN có số + khác nhau (sổ chưa khai số thùng thì chưa kết luận)
           (re.created_at IS NOT NULL AND l.qty_cartons IS NOT NULL AND re.cartons_imported IS DISTINCT FROM l.qty_cartons) AS is_qty_diff
      FROM packing_logs l
      LEFT JOIN packing_runs r ON r.id = l.run_id
      LEFT JOIN LATERAL (
        SELECT e.created_at, e.cartons_imported
          FROM "InventoryEntry" e WHERE e.pallet_code = l.pallet_code
         ORDER BY e.created_at LIMIT 1
      ) re ON true
     WHERE (p_status IS NULL OR l.status = p_status)
       AND (p_wh IS NULL OR l.warehouse_id = p_wh)
       AND (p_scope IS NULL OR l.warehouse_id IS NULL OR l.warehouse_id = ANY(p_scope))
       AND (p_from IS NULL OR l.open_scan_at >= p_from)
       AND (p_to IS NULL OR l.open_scan_at < p_to)
       AND (p_machine IS NULL OR l.machine_code = p_machine)
       AND (p_cycle IS NULL OR r.cycle ILIKE '%' || p_cycle || '%')   -- dòng không gắn trang → loại khi lọc chu kỳ
       AND (p_search IS NULL OR l.pallet_code ILIKE '%' || p_search || '%'
            OR l.material_code ILIKE '%' || p_search || '%'
            OR l.packed_by_name ILIKE '%' || p_search || '%')
  ), filt AS (
    SELECT * FROM base
     WHERE p_received IS NULL
        OR (p_received = 'YES'  AND received_at IS NOT NULL)
        OR (p_received = 'NO'   AND received_at IS NULL)
        OR (p_received = 'DIFF' AND is_qty_diff)
  )
  SELECT (SELECT count(*) FROM filt),
         (SELECT count(*) FROM base WHERE received_at IS NOT NULL AND status <> 'CANCELLED'),
         (SELECT count(*) FROM base WHERE received_at IS NULL AND status <> 'CANCELLED'),
         (SELECT count(*) FROM base WHERE is_qty_diff AND status <> 'CANCELLED'),
         (SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
            FROM (SELECT * FROM filt ORDER BY open_scan_at DESC OFFSET v_off LIMIT v_size) f)
    INTO v_total, v_recv, v_miss, v_diff, v_rows;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total,
                            'received_count', v_recv, 'missing_count', v_miss, 'diff_count', v_diff);
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260813d_warehouse_machines.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260813d — DANH MỤC MÁY THEO KHO (user 13/08 tối): "Máy sẽ thuộc Kho, mỗi kho có các tên máy
-- khác nhau. Sổ đóng gói lấy validate máy ở đây; In tem validate chọn máy theo NMSX.
-- Kho nào có setup Máy thì phải chọn theo validate, không thì mới được điền tự do."
-- Quản trị ở Cài đặt WMS tab "Máy" (quyền wms_settings.manage_machine).
CREATE TABLE IF NOT EXISTS warehouse_machines (
  id           uuid PRIMARY KEY,
  warehouse_id text NOT NULL,           -- Warehouse.id (text như packing_runs.warehouse_id)
  code         text NOT NULL,           -- tên/mã máy in trên tem (A, M1, AP…) — lưu UPPERCASE
  note         text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL
);
-- 1 kho không có 2 máy trùng tên (so không phân hoa thường — BE đã uppercase, index gác nốt đường ghi lạ)
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_machine_code ON warehouse_machines (warehouse_id, upper(code));
CREATE INDEX IF NOT EXISTS idx_warehouse_machines_wh ON warehouse_machines (warehouse_id);

-- RLS: đóng anon; authenticated ĐỌC được (bắt buộc cho realtime — memory realtime-rls-silent-death:
-- RLS bật + 0 policy SELECT = client không nhận sự kiện; RLS tắt = anon đọc được qua REST).
ALTER TABLE warehouse_machines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS warehouse_machines_read ON warehouse_machines;
CREATE POLICY warehouse_machines_read ON warehouse_machines FOR SELECT TO authenticated USING (true);

-- realtime cho form đang mở (đổi danh mục máy → dropdown tự cập nhật)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE warehouse_machines;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260813e_packing_perf.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260813e — CHECK-APP dữ liệu lớn 13/08 (seed 72.000 dòng sổ đo thật): 2 index thiếu.
-- (1) recon/list lọc (warehouse_id, open_scan_at) đang SEQ SCAN toàn bảng (EXPLAIN: 1,1s/72k dòng,
--     tăng tuyến tính theo năm — bảng sổ vài trăm nghìn dòng/năm).
CREATE INDEX IF NOT EXISTS idx_packing_logs_wh_scan ON packing_logs (warehouse_id, open_scan_at DESC);
-- (2) quét tem tra dòng sống theo pallet_code (gate 1-tem-1-dòng + đối chiếu) cũng seq scan
--     → mỗi lượt quét chậm dần theo size bảng (đo: ghi p95 ~20s khi 25 đọc nặng cùng lúc).
CREATE INDEX IF NOT EXISTS idx_packing_logs_pallet ON packing_logs (pallet_code);

-- ───────────────────────────────────────────────────────────────────────
-- 20260813f_employee_is_superadmin.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260813f — Superadmin theo CỘT thay vì so TÊN (audit hardcode 13/08, nợ kỹ thuật CLAUDE.md).
-- Trước: superadmin = (name='Admin' OR employee_code='ADMIN') rải ~18 chỗ BE + FE isAdmin →
-- đổi tên hiển thị tài khoản là MẤT quyền âm thầm. Nay: cột is_superadmin là nguồn duy nhất,
-- authController nhét vào JWT, mọi điểm kiểm đọc cờ từ token.
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS is_superadmin boolean NOT NULL DEFAULT false;

UPDATE "Employee" SET is_superadmin = true
WHERE employee_code = 'ADMIN' OR name = 'Admin';

-- Gác an toàn: phải còn ÍT NHẤT 1 superadmin đang hoạt động, không thì cả hệ mất cửa quản trị.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "Employee" WHERE is_superadmin = true AND is_active = true;
  IF n = 0 THEN
    RAISE EXCEPTION 'Sau migration không có superadmin active nào — kiểm tra tài khoản Admin trước khi apply';
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260813g_scanlog_pctdate_fields.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260813g — Lịch sử quét: %Date SAI NGUỒN (audit hardcode 13/08, mục A2).
-- FE OutboundScanLog tự tính %Date bằng calcPctAtScan(prodDate, m.shelf_life_days, scannedAt):
-- bỏ qua (1) HSD TƯỜNG MINH trên tem V2 (ie.expiry_date), (2) shelf-life THEO LÔ (ie.shelf_life_days
-- — đã bake override NCC lúc nhập), (3) override NCC của mã — nên ra số KHÁC trang Tồn kho.
-- Fix: 2 RPC trả thêm NGUYÊN LIỆU THÔ (4 cột cuối), FE dùng computePctDate CHUNG (utils/shelfLife)
-- với nowMs = thời điểm quét. Đổi RETURNS TABLE ⇒ phải DROP trước (CREATE OR REPLACE từ chối đổi shape).

DROP FUNCTION IF EXISTS public.get_outbound_scan_log(text,text,text,text,text,text,text,text,text,text,text,text,text,integer,integer,text);
DROP FUNCTION IF EXISTS public.search_outbound_scan_log(text,text,text,integer,integer);
-- Xác chết overload 10 tham số đời trước 20260702 còn sót — 2 overload cùng tên làm lời gọi
-- positional/psql ambiguous (bài học packing recon 20260813c). PostgREST gọi theo TÊN tham số nên
-- chưa nổ, nhưng là mìn chờ — dọn hẳn.
DROP FUNCTION IF EXISTS public.get_outbound_scan_log(text,text,text,text,text,text,text,text,integer,integer);

CREATE FUNCTION public.get_outbound_scan_log(
  p_from_date text DEFAULT NULL, p_to_date text DEFAULT NULL, p_warehouse_ids text DEFAULT NULL,
  p_material_category text DEFAULT NULL, p_group_code text DEFAULT NULL, p_distributor text DEFAULT NULL,
  p_delivery_code text DEFAULT NULL, p_pallet_code text DEFAULT NULL, p_material text DEFAULT NULL,
  p_machine_codes text DEFAULT NULL, p_cycles text DEFAULT NULL, p_scanner_name text DEFAULT NULL,
  p_nmsx text DEFAULT NULL, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0,
  p_allowed_categories text DEFAULT NULL)
RETURNS TABLE(
  id text, pallet_code text, cartons_scanned numeric, production_date text, best_available_date text,
  scanned_at timestamp with time zone, is_loose_picking boolean, loose_confirmed_at timestamp with time zone,
  loose_confirmed_by_name text, group_code text, delivery_date date, license_plate text, container_number text,
  forklift_driver_names text, loader_name text, assigned_at timestamp with time zone, started_at timestamp with time zone,
  last_scanned_at timestamp with time zone, completed_at timestamp with time zone, warehouse_name text,
  delivery_code text, distributor_name text, header_text text, material_code_raw text, material_code text,
  material_name text, material_category text, shelf_life_days integer, cycle text, machine_code text, nmsx text,
  import_date timestamp with time zone, location_code text, scanner_name text, total_count bigint,
  base_unit text, entry_unit text, units_per_carton integer,
  entry_shelf_life_days integer, expiry_date date, ncc_id text, supplier_shelf_life_overrides jsonb)
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  -- Ngày VN → cận thời gian tính MỘT LẦN: [from 00:00 VN, (to+1) 00:00 VN)
  v_from_n  timestamp   := CASE WHEN p_from_date IS NULL THEN NULL
                           ELSE ((p_from_date || ' 00:00:00+07')::timestamptz AT TIME ZONE 'UTC') END;
  v_to_n    timestamp   := CASE WHEN p_to_date IS NULL THEN NULL
                           ELSE (((p_to_date::date + 1)::text || ' 00:00:00+07')::timestamptz AT TIME ZONE 'UTC') END;
  v_from_tz timestamptz := CASE WHEN p_from_date IS NULL THEN NULL
                           ELSE (p_from_date || ' 00:00:00+07')::timestamptz END;
  v_to_tz   timestamptz := CASE WHEN p_to_date IS NULL THEN NULL
                           ELSE ((p_to_date::date + 1)::text || ' 00:00:00+07')::timestamptz END;
  v_total bigint;
BEGIN
  SELECT count(*) INTO v_total
  FROM "OutboundScanEntry"   ose
  JOIN "OutboundItem"        oi  ON oi.id  = ose.item_id
  JOIN "OutboundDelivery"    od  ON od.id  = oi.do_id
  JOIN "GroupDeliveryOrder"  gdo ON gdo.id = od.gdo_id
  LEFT JOIN "Material"       m   ON m.id   = oi.material_id
  LEFT JOIN "InventoryEntry" ie  ON ie.id  = ose.inventory_entry_id
  LEFT JOIN "Employee"       e   ON e.id   = ose.scanned_by
  WHERE
    ( (NOT ose.is_loose_picking
        AND (v_from_n IS NULL OR ose.scanned_at >= v_from_n)
        AND (v_to_n   IS NULL OR ose.scanned_at <  v_to_n))
      OR (ose.is_loose_picking AND ose.loose_confirmed = true
        AND (v_from_tz IS NULL OR ose.loose_confirmed_at >= v_from_tz)
        AND (v_to_tz   IS NULL OR ose.loose_confirmed_at <  v_to_tz)) )
    AND (p_warehouse_ids      IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
    AND (p_material_category  IS NULL OR m.category       = p_material_category)
    AND (p_allowed_categories IS NULL OR m.category IS NULL OR m.category = ANY(string_to_array(p_allowed_categories, ',')))
    AND (p_group_code         IS NULL OR gdo.group_code      ILIKE '%' || p_group_code    || '%')
    AND (p_distributor        IS NULL OR od.distributor_name ILIKE '%' || p_distributor   || '%')
    AND (p_delivery_code      IS NULL OR od.delivery_code    ILIKE '%' || p_delivery_code || '%')
    AND (p_pallet_code        IS NULL OR ose.pallet_code     ILIKE '%' || p_pallet_code   || '%')
    AND (p_material IS NULL OR CASE
          WHEN p_material LIKE '%,%' THEN m.id = ANY(string_to_array(p_material, ','))
          ELSE (m.material_code ILIKE '%' || p_material || '%'
                OR m.short_name ILIKE '%' || p_material || '%'
                OR oi.material_code_raw ILIKE '%' || p_material || '%') END)
    AND (p_machine_codes IS NULL OR ie.machine_code = ANY(string_to_array(p_machine_codes, ',')))
    AND (p_cycles        IS NULL OR ie.cycle        = ANY(string_to_array(p_cycles, ',')))
    AND (p_scanner_name  IS NULL OR e.name          ILIKE '%' || p_scanner_name || '%')
    AND (p_nmsx          IS NULL OR ose.nmsx        = ANY(string_to_array(p_nmsx, ',')));

  RETURN QUERY
  SELECT
    ose.id, ose.pallet_code, ose.cartons_scanned, ose.production_date, ose.best_available_date,
    ose.scanned_at::timestamptz, ose.is_loose_picking, ose.loose_confirmed_at,
    ec.name AS loose_confirmed_by_name, gdo.group_code,
    CASE WHEN ose.is_loose_picking
      THEN (ose.loose_confirmed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      ELSE ((ose.scanned_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    END AS delivery_date,
    gdo.license_plate, gdo.container_number, gdo.forklift_driver_names, gdo.loader_name,
    gdo.assigned_at::timestamptz, gdo.started_at::timestamptz, gdo.last_scanned_at, gdo.completed_at,
    w.name AS warehouse_name, od.delivery_code, od.distributor_name, oi.header_text,
    oi.material_code_raw, m.material_code, m.short_name AS material_name, m.category AS material_category,
    m.shelf_life_days, ie.cycle, ie.machine_code, ose.nmsx, ie.import_date::timestamptz,
    l.location_code, e.name AS scanner_name, v_total AS total_count,
    m.base_unit, m.entry_unit, m.units_per_carton,
    ie.shelf_life_days AS entry_shelf_life_days, ie.expiry_date, ie.ncc_id::text, m.supplier_shelf_life_overrides
  FROM "OutboundScanEntry"   ose
  JOIN "OutboundItem"        oi  ON oi.id  = ose.item_id
  JOIN "OutboundDelivery"    od  ON od.id  = oi.do_id
  JOIN "GroupDeliveryOrder"  gdo ON gdo.id = od.gdo_id
  JOIN "Warehouse"           w   ON w.id   = gdo.warehouse_id
  LEFT JOIN "Material"       m   ON m.id   = oi.material_id
  LEFT JOIN "InventoryEntry" ie  ON ie.id  = ose.inventory_entry_id
  LEFT JOIN "Location"       l   ON l.id   = ie.location_id
  LEFT JOIN "Employee"       e   ON e.id   = ose.scanned_by
  LEFT JOIN "Employee"       ec  ON ec.id  = ose.loose_confirmed_by
  WHERE
    ( (NOT ose.is_loose_picking
        AND (v_from_n IS NULL OR ose.scanned_at >= v_from_n)
        AND (v_to_n   IS NULL OR ose.scanned_at <  v_to_n))
      OR (ose.is_loose_picking AND ose.loose_confirmed = true
        AND (v_from_tz IS NULL OR ose.loose_confirmed_at >= v_from_tz)
        AND (v_to_tz   IS NULL OR ose.loose_confirmed_at <  v_to_tz)) )
    AND (p_warehouse_ids      IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
    AND (p_material_category  IS NULL OR m.category       = p_material_category)
    AND (p_allowed_categories IS NULL OR m.category IS NULL OR m.category = ANY(string_to_array(p_allowed_categories, ',')))
    AND (p_group_code         IS NULL OR gdo.group_code      ILIKE '%' || p_group_code    || '%')
    AND (p_distributor        IS NULL OR od.distributor_name ILIKE '%' || p_distributor   || '%')
    AND (p_delivery_code      IS NULL OR od.delivery_code    ILIKE '%' || p_delivery_code || '%')
    AND (p_pallet_code        IS NULL OR ose.pallet_code     ILIKE '%' || p_pallet_code   || '%')
    AND (p_material IS NULL OR CASE
          WHEN p_material LIKE '%,%' THEN m.id = ANY(string_to_array(p_material, ','))
          ELSE (m.material_code ILIKE '%' || p_material || '%'
                OR m.short_name ILIKE '%' || p_material || '%'
                OR oi.material_code_raw ILIKE '%' || p_material || '%') END)
    AND (p_machine_codes IS NULL OR ie.machine_code = ANY(string_to_array(p_machine_codes, ',')))
    AND (p_cycles        IS NULL OR ie.cycle        = ANY(string_to_array(p_cycles, ',')))
    AND (p_scanner_name  IS NULL OR e.name          ILIKE '%' || p_scanner_name || '%')
    AND (p_nmsx          IS NULL OR ose.nmsx        = ANY(string_to_array(p_nmsx, ',')))
  ORDER BY ose.scanned_at DESC
  LIMIT p_limit OFFSET p_offset;
END $$;

CREATE FUNCTION public.search_outbound_scan_log(
  p_q text, p_warehouse_ids text DEFAULT NULL, p_allowed_categories text DEFAULT NULL,
  p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
RETURNS TABLE(
  id text, pallet_code text, cartons_scanned numeric, production_date text, best_available_date text,
  scanned_at timestamp with time zone, is_loose_picking boolean, loose_confirmed_at timestamp with time zone,
  loose_confirmed_by_name text, group_code text, delivery_date date, license_plate text, container_number text,
  forklift_driver_names text, loader_name text, assigned_at timestamp with time zone, started_at timestamp with time zone,
  last_scanned_at timestamp with time zone, completed_at timestamp with time zone, warehouse_name text,
  delivery_code text, distributor_name text, header_text text, material_code_raw text, material_code text,
  material_name text, material_category text, shelf_life_days integer, cycle text, machine_code text, nmsx text,
  import_date timestamp with time zone, location_code text, scanner_name text, total_count bigint,
  gdo_id text, item_id text, base_unit text, entry_unit text, units_per_carton integer,
  entry_shelf_life_days integer, expiry_date date, ncc_id text, supplier_shelf_life_overrides jsonb)
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  v_total bigint;
  v_like  text := '%' || p_q || '%';
  v_ids text[];
BEGIN
  SELECT array_agg(DISTINCT s.id) INTO v_ids FROM (
    SELECT ose.id FROM "OutboundScanEntry" ose
    WHERE ose.pallet_code ILIKE v_like OR ose.carton_scans::text ILIKE v_like
    UNION ALL
    SELECT ose.id FROM "OutboundScanEntry" ose
    JOIN "OutboundItem" oi ON oi.id = ose.item_id
    JOIN "OutboundDelivery" od ON od.id = oi.do_id
    WHERE od.delivery_code ILIKE v_like OR od.distributor_name ILIKE v_like
    UNION ALL
    SELECT ose.id FROM "OutboundScanEntry" ose
    JOIN "OutboundItem" oi ON oi.id = ose.item_id
    JOIN "OutboundDelivery" od ON od.id = oi.do_id
    JOIN "GroupDeliveryOrder" gdo ON gdo.id = od.gdo_id
    WHERE gdo.group_code ILIKE v_like OR gdo.license_plate ILIKE v_like
       OR gdo.container_number ILIKE v_like
       OR gdo.warehouse_id IN (SELECT w2.id FROM "Warehouse" w2 WHERE w2.name ILIKE v_like)
    UNION ALL
    SELECT ose.id FROM "OutboundScanEntry" ose
    JOIN "OutboundItem" oi ON oi.id = ose.item_id
    WHERE oi.material_code_raw ILIKE v_like
       OR oi.material_id IN (SELECT m2.id FROM "Material" m2 WHERE m2.material_code ILIKE v_like OR m2.short_name ILIKE v_like)
    UNION ALL
    SELECT ose.id FROM "OutboundScanEntry" ose
    WHERE ose.scanned_by IN (SELECT e2.id FROM "Employee" e2 WHERE e2.name ILIKE v_like)
    UNION ALL
    SELECT ose.id FROM "OutboundScanEntry" ose
    WHERE ose.inventory_entry_id IN (
      SELECT ie2.id FROM "InventoryEntry" ie2
      WHERE ie2.location_id IN (SELECT l2.id FROM "Location" l2 WHERE l2.location_code ILIKE v_like))
  ) s;

  SELECT count(*) INTO v_total
  FROM "OutboundScanEntry" ose
  JOIN "OutboundItem" oi ON oi.id = ose.item_id
  JOIN "OutboundDelivery" od ON od.id = oi.do_id
  JOIN "GroupDeliveryOrder" gdo ON gdo.id = od.gdo_id
  LEFT JOIN "Material" m ON m.id = oi.material_id
  WHERE ose.id = ANY(v_ids)
    AND (p_warehouse_ids IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
    AND (p_allowed_categories IS NULL OR m.category IS NULL OR m.category = ANY(string_to_array(p_allowed_categories, ',')))
    AND (NOT ose.is_loose_picking OR ose.loose_confirmed = true);

  RETURN QUERY
  SELECT
    ose.id, ose.pallet_code, ose.cartons_scanned, ose.production_date, ose.best_available_date,
    ose.scanned_at::timestamptz, ose.is_loose_picking, ose.loose_confirmed_at,
    ec.name AS loose_confirmed_by_name, gdo.group_code,
    CASE WHEN ose.is_loose_picking
      THEN (ose.loose_confirmed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      ELSE ((ose.scanned_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    END AS delivery_date,
    gdo.license_plate, gdo.container_number, gdo.forklift_driver_names, gdo.loader_name,
    gdo.assigned_at::timestamptz, gdo.started_at::timestamptz, gdo.last_scanned_at, gdo.completed_at,
    w.name AS warehouse_name, od.delivery_code, od.distributor_name, oi.header_text,
    oi.material_code_raw, m.material_code, m.short_name AS material_name, m.category AS material_category,
    m.shelf_life_days, ie.cycle, ie.machine_code, ose.nmsx, ie.import_date::timestamptz,
    l.location_code, e.name AS scanner_name, v_total AS total_count,
    gdo.id::text AS gdo_id, oi.id::text AS item_id,
    m.base_unit, m.entry_unit, m.units_per_carton,
    ie.shelf_life_days AS entry_shelf_life_days, ie.expiry_date, ie.ncc_id::text, m.supplier_shelf_life_overrides
  FROM "OutboundScanEntry" ose
  JOIN "OutboundItem" oi ON oi.id = ose.item_id
  JOIN "OutboundDelivery" od ON od.id = oi.do_id
  JOIN "GroupDeliveryOrder" gdo ON gdo.id = od.gdo_id
  JOIN "Warehouse" w ON w.id = gdo.warehouse_id
  LEFT JOIN "Material" m ON m.id = oi.material_id
  LEFT JOIN "InventoryEntry" ie ON ie.id = ose.inventory_entry_id
  LEFT JOIN "Location" l ON l.id = ie.location_id
  LEFT JOIN "Employee" e ON e.id = ose.scanned_by
  LEFT JOIN "Employee" ec ON ec.id = ose.loose_confirmed_by
  WHERE ose.id = ANY(v_ids)
    AND (p_warehouse_ids IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
    AND (p_allowed_categories IS NULL OR m.category IS NULL OR m.category = ANY(string_to_array(p_allowed_categories, ',')))
    AND (NOT ose.is_loose_picking OR ose.loose_confirmed = true)
  ORDER BY ose.scanned_at DESC
  LIMIT p_limit OFFSET p_offset;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260814c_rotation_strategy.sql
-- ───────────────────────────────────────────────────────────────────────
-- NGUYÊN TẮC LUÂN CHUYỂN (rotation) theo KHO — 14/08/2026
--
-- Mặc định CỐ Ý = đúng hành vi đang chạy: FEFO + KHÔNG bắt buộc (chỉ cảnh báo).
-- ⇒ apply migration này KHÔNG đổi cách làm việc của bất kỳ kho nào; kho nào muốn siết thì tự
--    tick trong Cài đặt WMS → Kho.

-- ── 1. Cấu hình theo kho ────────────────────────────────────────────────────
ALTER TABLE "Warehouse"
  ADD COLUMN IF NOT EXISTS rotation_principle text    NOT NULL DEFAULT 'FEFO',
  ADD COLUMN IF NOT EXISTS rotation_required  boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE "Warehouse" ADD CONSTRAINT warehouse_rotation_principle_chk
    CHECK (rotation_principle IN ('FEFO', 'FIFO', 'LIFO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN "Warehouse".rotation_principle IS
  'Thứ tự lấy hàng: FEFO = hạn dùng ngắn đi trước · FIFO = vào trước đi trước · LIFO = vào sau đi trước';
COMMENT ON COLUMN "Warehouse".rotation_required IS
  'true = CHẶN quét sai thứ tự (phải có quyền outbound.rotation_override + chọn lý do mới qua được); false = chỉ cảnh báo';

-- ── 2. Vết trên từng lượt quét ──────────────────────────────────────────────
-- Đều NULLABLE: dòng cũ = "chưa đo" (NULL), báo cáo tuân thủ KHÔNG tính vào mẫu số —
-- không được để dữ liệu trước tính năng này bị quy là "đúng thứ tự" một cách vô căn cứ.
ALTER TABLE "OutboundScanEntry"
  ADD COLUMN IF NOT EXISTS rotation_principle      text,
  ADD COLUMN IF NOT EXISTS rotation_violation      boolean,
  ADD COLUMN IF NOT EXISTS rotation_best_date      text,
  ADD COLUMN IF NOT EXISTS rotation_override_reason text;

COMMENT ON COLUMN "OutboundScanEntry".rotation_principle IS
  'Nguyên tắc ĐANG hiệu lực lúc quét — chốt cứng để dòng cũ/mới không lẫn nghĩa khi kho đổi cấu hình';
COMMENT ON COLUMN "OutboundScanEntry".rotation_violation IS
  'true = lấy sai thứ tự · false = đúng · NULL = không kết luận được (thiếu NSX/HSD) hoặc dòng trước 14/08';
COMMENT ON COLUMN "OutboundScanEntry".rotation_best_date IS
  'Ngày đại diện (HSD với FEFO, NSX với FIFO/LIFO) của pallet đáng lẽ nên lấy';
COMMENT ON COLUMN "OutboundScanEntry".rotation_override_reason IS
  'Mã lý do vượt rào khi kho bật bắt buộc: BLOCKED | DAMAGED | CUSTOMER | OTHER: <ghi chú>';

-- Cột best_available_date CŨ giữ nguyên cho dữ liệu lịch sử (nghĩa cũ: MIN(NSX) trong kho, chỉ
-- đếm IN_STOCK/PARTIAL) — từ 14/08 KHÔNG ghi nữa, chỗ hiển thị đọc rotation_best_date.

-- Đếm vi phạm theo khoảng ngày (ô band "% tuân thủ" trang Lịch sử quét)
CREATE INDEX IF NOT EXISTS idx_ose_rotation_violation
  ON "OutboundScanEntry" (scanned_at) WHERE rotation_violation = true;

-- ───────────────────────────────────────────────────────────────────────
-- 20260814d_scanlog_rotation.sql
-- ───────────────────────────────────────────────────────────────────────
-- Lịch sử quét: trả thêm VẾT LUÂN CHUYỂN + bộ lọc + số liệu tuân thủ — 14/08/2026
--
-- Đổi KIỂU TRẢ VỀ nên phải DROP rồi CREATE (CREATE OR REPLACE báo "cannot change return type").
-- Bản cũ 16 tham số bị gỡ hẳn để PostgREST không thấy 2 overload (PGRST203).

DROP FUNCTION IF EXISTS public.get_outbound_scan_log(text, text, text, text, text, text, text, text, text, text, text, text, text, integer, integer, text);

CREATE OR REPLACE FUNCTION public.get_outbound_scan_log(
  p_from_date text DEFAULT NULL::text, p_to_date text DEFAULT NULL::text, p_warehouse_ids text DEFAULT NULL::text,
  p_material_category text DEFAULT NULL::text, p_group_code text DEFAULT NULL::text, p_distributor text DEFAULT NULL::text,
  p_delivery_code text DEFAULT NULL::text, p_pallet_code text DEFAULT NULL::text, p_material text DEFAULT NULL::text,
  p_machine_codes text DEFAULT NULL::text, p_cycles text DEFAULT NULL::text, p_scanner_name text DEFAULT NULL::text,
  p_nmsx text DEFAULT NULL::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0,
  p_allowed_categories text DEFAULT NULL::text,
  p_rotation text DEFAULT NULL::text            -- NULL = tất cả · 'BAD' = chỉ sai thứ tự · 'OK' = chỉ đúng
)
 RETURNS TABLE(id text, pallet_code text, cartons_scanned numeric, production_date text, best_available_date text, scanned_at timestamp with time zone, is_loose_picking boolean, loose_confirmed_at timestamp with time zone, loose_confirmed_by_name text, group_code text, delivery_date date, license_plate text, container_number text, forklift_driver_names text, loader_name text, assigned_at timestamp with time zone, started_at timestamp with time zone, last_scanned_at timestamp with time zone, completed_at timestamp with time zone, warehouse_name text, delivery_code text, distributor_name text, header_text text, material_code_raw text, material_code text, material_name text, material_category text, shelf_life_days integer, cycle text, machine_code text, nmsx text, import_date timestamp with time zone, location_code text, scanner_name text, total_count bigint, base_unit text, entry_unit text, units_per_carton integer, entry_shelf_life_days integer, expiry_date date, ncc_id text, supplier_shelf_life_overrides jsonb, rotation_violation boolean, rotation_best_date text, rotation_principle text, rotation_override_reason text, viol_count bigint, measured_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  -- Ngày VN → cận thời gian tính MỘT LẦN: [from 00:00 VN, (to+1) 00:00 VN)
  v_from_n  timestamp   := CASE WHEN p_from_date IS NULL THEN NULL
                           ELSE ((p_from_date || ' 00:00:00+07')::timestamptz AT TIME ZONE 'UTC') END;
  v_to_n    timestamp   := CASE WHEN p_to_date IS NULL THEN NULL
                           ELSE (((p_to_date::date + 1)::text || ' 00:00:00+07')::timestamptz AT TIME ZONE 'UTC') END;
  v_from_tz timestamptz := CASE WHEN p_from_date IS NULL THEN NULL
                           ELSE (p_from_date || ' 00:00:00+07')::timestamptz END;
  v_to_tz   timestamptz := CASE WHEN p_to_date IS NULL THEN NULL
                           ELSE ((p_to_date::date + 1)::text || ' 00:00:00+07')::timestamptz END;
  v_total    bigint;
  v_viol     bigint;
  v_measured bigint;
BEGIN
  -- Đếm 1 lượt: tổng dòng · số sai thứ tự · số ĐO ĐƯỢC (rotation_violation NOT NULL).
  -- Mẫu số của "% tuân thủ" là v_measured, KHÔNG phải v_total: dòng trước 14/08 và dòng thiếu
  -- NSX/HSD chưa từng được đo ⇒ tính chúng là "đúng" sẽ thổi tỷ lệ tuân thủ lên một cách vô căn cứ.
  SELECT count(*),
         count(*) FILTER (WHERE ose.rotation_violation = true),
         count(*) FILTER (WHERE ose.rotation_violation IS NOT NULL)
    INTO v_total, v_viol, v_measured
  FROM "OutboundScanEntry"   ose
  JOIN "OutboundItem"        oi  ON oi.id  = ose.item_id
  JOIN "OutboundDelivery"    od  ON od.id  = oi.do_id
  JOIN "GroupDeliveryOrder"  gdo ON gdo.id = od.gdo_id
  LEFT JOIN "Material"       m   ON m.id   = oi.material_id
  LEFT JOIN "InventoryEntry" ie  ON ie.id  = ose.inventory_entry_id
  LEFT JOIN "Employee"       e   ON e.id   = ose.scanned_by
  WHERE
    ( (NOT ose.is_loose_picking
        AND (v_from_n IS NULL OR ose.scanned_at >= v_from_n)
        AND (v_to_n   IS NULL OR ose.scanned_at <  v_to_n))
      OR (ose.is_loose_picking AND ose.loose_confirmed = true
        AND (v_from_tz IS NULL OR ose.loose_confirmed_at >= v_from_tz)
        AND (v_to_tz   IS NULL OR ose.loose_confirmed_at <  v_to_tz)) )
    AND (p_warehouse_ids      IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
    AND (p_material_category  IS NULL OR m.category       = p_material_category)
    AND (p_allowed_categories IS NULL OR m.category IS NULL OR m.category = ANY(string_to_array(p_allowed_categories, ',')))
    AND (p_group_code         IS NULL OR gdo.group_code      ILIKE '%' || p_group_code    || '%')
    AND (p_distributor        IS NULL OR od.distributor_name ILIKE '%' || p_distributor   || '%')
    AND (p_delivery_code      IS NULL OR od.delivery_code    ILIKE '%' || p_delivery_code || '%')
    AND (p_pallet_code        IS NULL OR ose.pallet_code     ILIKE '%' || p_pallet_code   || '%')
    AND (p_material IS NULL OR CASE
          WHEN p_material LIKE '%,%' THEN m.id = ANY(string_to_array(p_material, ','))
          ELSE (m.material_code ILIKE '%' || p_material || '%'
                OR m.short_name ILIKE '%' || p_material || '%'
                OR oi.material_code_raw ILIKE '%' || p_material || '%') END)
    AND (p_machine_codes IS NULL OR ie.machine_code = ANY(string_to_array(p_machine_codes, ',')))
    AND (p_cycles        IS NULL OR ie.cycle        = ANY(string_to_array(p_cycles, ',')))
    AND (p_scanner_name  IS NULL OR e.name          ILIKE '%' || p_scanner_name || '%')
    AND (p_nmsx          IS NULL OR ose.nmsx        = ANY(string_to_array(p_nmsx, ',')));

  RETURN QUERY
  SELECT
    ose.id, ose.pallet_code, ose.cartons_scanned, ose.production_date, ose.best_available_date,
    ose.scanned_at::timestamptz, ose.is_loose_picking, ose.loose_confirmed_at,
    ec.name AS loose_confirmed_by_name, gdo.group_code,
    CASE WHEN ose.is_loose_picking
      THEN (ose.loose_confirmed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      ELSE ((ose.scanned_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    END AS delivery_date,
    gdo.license_plate, gdo.container_number, gdo.forklift_driver_names, gdo.loader_name,
    gdo.assigned_at::timestamptz, gdo.started_at::timestamptz, gdo.last_scanned_at, gdo.completed_at,
    w.name AS warehouse_name, od.delivery_code, od.distributor_name, oi.header_text,
    oi.material_code_raw, m.material_code, m.short_name AS material_name, m.category AS material_category,
    m.shelf_life_days, ie.cycle, ie.machine_code, ose.nmsx, ie.import_date::timestamptz,
    l.location_code, e.name AS scanner_name, v_total AS total_count,
    m.base_unit, m.entry_unit, m.units_per_carton,
    ie.shelf_life_days AS entry_shelf_life_days, ie.expiry_date, ie.ncc_id::text, m.supplier_shelf_life_overrides,
    ose.rotation_violation, ose.rotation_best_date, ose.rotation_principle, ose.rotation_override_reason,
    v_viol AS viol_count, v_measured AS measured_count
  FROM "OutboundScanEntry"   ose
  JOIN "OutboundItem"        oi  ON oi.id  = ose.item_id
  JOIN "OutboundDelivery"    od  ON od.id  = oi.do_id
  JOIN "GroupDeliveryOrder"  gdo ON gdo.id = od.gdo_id
  JOIN "Warehouse"           w   ON w.id   = gdo.warehouse_id
  LEFT JOIN "Material"       m   ON m.id   = oi.material_id
  LEFT JOIN "InventoryEntry" ie  ON ie.id  = ose.inventory_entry_id
  LEFT JOIN "Location"       l   ON l.id   = ie.location_id
  LEFT JOIN "Employee"       e   ON e.id   = ose.scanned_by
  LEFT JOIN "Employee"       ec  ON ec.id  = ose.loose_confirmed_by
  WHERE
    ( (NOT ose.is_loose_picking
        AND (v_from_n IS NULL OR ose.scanned_at >= v_from_n)
        AND (v_to_n   IS NULL OR ose.scanned_at <  v_to_n))
      OR (ose.is_loose_picking AND ose.loose_confirmed = true
        AND (v_from_tz IS NULL OR ose.loose_confirmed_at >= v_from_tz)
        AND (v_to_tz   IS NULL OR ose.loose_confirmed_at <  v_to_tz)) )
    AND (p_warehouse_ids      IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
    AND (p_material_category  IS NULL OR m.category       = p_material_category)
    AND (p_allowed_categories IS NULL OR m.category IS NULL OR m.category = ANY(string_to_array(p_allowed_categories, ',')))
    AND (p_group_code         IS NULL OR gdo.group_code      ILIKE '%' || p_group_code    || '%')
    AND (p_distributor        IS NULL OR od.distributor_name ILIKE '%' || p_distributor   || '%')
    AND (p_delivery_code      IS NULL OR od.delivery_code    ILIKE '%' || p_delivery_code || '%')
    AND (p_pallet_code        IS NULL OR ose.pallet_code     ILIKE '%' || p_pallet_code   || '%')
    AND (p_material IS NULL OR CASE
          WHEN p_material LIKE '%,%' THEN m.id = ANY(string_to_array(p_material, ','))
          ELSE (m.material_code ILIKE '%' || p_material || '%'
                OR m.short_name ILIKE '%' || p_material || '%'
                OR oi.material_code_raw ILIKE '%' || p_material || '%') END)
    AND (p_machine_codes IS NULL OR ie.machine_code = ANY(string_to_array(p_machine_codes, ',')))
    AND (p_cycles        IS NULL OR ie.cycle        = ANY(string_to_array(p_cycles, ',')))
    AND (p_scanner_name  IS NULL OR e.name          ILIKE '%' || p_scanner_name || '%')
    AND (p_nmsx          IS NULL OR ose.nmsx        = ANY(string_to_array(p_nmsx, ',')))
    -- Bộ lọc luân chuyển áp ở DANH SÁCH, KHÔNG áp ở khối đếm bên trên: ô band phải luôn hiện
    -- "x/y lượt đúng thứ tự" của cả dải đang xem, chứ không phải của riêng phần đã lọc.
    AND (p_rotation IS NULL
         OR (p_rotation = 'BAD' AND ose.rotation_violation = true)
         OR (p_rotation = 'OK'  AND ose.rotation_violation = false))
  ORDER BY ose.scanned_at DESC
  LIMIT p_limit OFFSET p_offset;
END $function$;

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────────
-- 20260814e_weigh_warehouses_rpc.sql
-- ───────────────────────────────────────────────────────────────────────
-- Kho THỰC CÓ phiếu cân — 1 lời gọi thay vì 1 truy vấn / 1 KHO (14/08/2026)
--
-- Trước: listWeighWarehouses hỏi "kho này có phiếu cân không?" cho TỪNG kho. Đo staging: 153 kho
-- đang hoạt động ⇒ 153 request PostgREST mỗi lần mở bộ lọc trang Phiếu cân, trong khi pool chỉ
-- ~10 khe. Cùng họ lỗi với gợi ý vị trí nhập (1.517 request) đã gỡ cùng ngày.
--
-- DISTINCT trên bảng phiếu cân KHÔNG bị cap-1000 vì chạy trong DB (cap là của PostgREST, không
-- phải của SQL) — số dòng TRẢ VỀ bị chặn bởi số KHO có phiếu, không phải số phiếu.

CREATE OR REPLACE FUNCTION public.weigh_ticket_warehouses()
RETURNS TABLE(warehouse_id text)
LANGUAGE sql
STABLE
AS $function$
  SELECT DISTINCT wt.warehouse_id
  FROM "WeighTicket" wt
  WHERE wt.warehouse_id IS NOT NULL
$function$;

CREATE INDEX IF NOT EXISTS idx_weighticket_warehouse ON "WeighTicket" (warehouse_id);

NOTIFY pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────────────
-- 20260815_packing_run_received.sql
-- ───────────────────────────────────────────────────────────────────────
-- 15/08/2026 — ĐỐI CHIẾU SX↔KHO Ở CẤP TRANG SỔ (user: "giao diện quản lý sổ cần thể hiện sổ nào
-- kho đã nhập hết, sổ nào chưa — dạng symbol").
--
-- Cấp PALLET đã có sẵn (getRun.attachReceived + RPC packing_logs_recon cho tab Sổ pallet).
-- Cấp TRANG thì chưa: list/board cố ý KHÔNG trả mảng pallet về client (check-app 13/08 đo 2,2MB
-- @60 pallet/trang — trang thật 100-150 pallet sẽ vượt trần 4,5MB Vercel).
--
-- ⇒ ĐẾM TRONG SQL, đừng kéo tem về đếm ở backend: 50 trang × ~100 pallet = ~5.000 pallet_code,
-- tra InventoryEntry theo chunk 300 = 17 round-trip PostgREST MỖI LẦN MỞ TRANG (pool ~10 khe
-- dùng chung — luật CLAUDE.md "đừng KÉO DÒNG để tính ra một TẬP"). RPC này = 1 round-trip.
--
-- recv_count = pallet kho ĐÃ quét nhập (tồn tại InventoryEntry cùng pallet_code — nhập rồi xuất
--              vẫn tính ĐÃ NHẬN, giống attachReceived); diff_count = đã nhận nhưng SL kho ≠ sổ
--              (chỉ kết luận khi CẢ HAI bên có số). Dòng CANCELLED không tính, khớp aggRuns.
CREATE OR REPLACE FUNCTION packing_runs_received(p_run_ids uuid[])
RETURNS TABLE(run_id uuid, recv_count integer, diff_count integer)
LANGUAGE sql
STABLE
AS $$
  WITH l AS (
    SELECT pl.run_id,
           pl.qty_cartons,
           (SELECT e.cartons_imported
              FROM "InventoryEntry" e
             WHERE e.pallet_code = pl.pallet_code
             ORDER BY e.created_at
             LIMIT 1) AS recv_qty,
           EXISTS (SELECT 1 FROM "InventoryEntry" e WHERE e.pallet_code = pl.pallet_code) AS received
      FROM packing_logs pl
     WHERE pl.run_id = ANY(p_run_ids)
       AND pl.status <> 'CANCELLED'
  )
  SELECT l.run_id,
         COUNT(*) FILTER (WHERE l.received)::int,
         COUNT(*) FILTER (WHERE l.received AND l.qty_cartons IS NOT NULL
                            AND l.recv_qty IS NOT NULL AND l.recv_qty <> l.qty_cartons)::int
    FROM l
   GROUP BY l.run_id;
$$;

-- idx_packing_logs_* (20260813e) phủ lọc theo run_id; idx_inventory_pallet_code (20260813)
-- phủ tra pallet_code — không cần index mới.

COMMIT;