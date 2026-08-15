-- ============================================================================
-- PRODUCTION: Loại kho tên tiếng Việt → MÃ SAP + gộp "Thùng" vào PK01  (15/08/2026)
-- ----------------------------------------------------------------------------
-- BỐI CẢNH: staging đổi sang mã SAP từ 27/07 (qua GIAO DIỆN, không qua migration) nên
-- production vẫn giữ tên tiếng Việt ⇒ hai môi trường lệch taxonomy, mọi đợt QA chạy trên
-- staging không còn phản ánh production. User chốt 15/08: đưa production sang mã SAP.
--
-- ÁNH XẠ (đo sống trên production 15/08, 13.479 dòng / 18 cột):
--     Thành phẩm → FG01      (9.158 dòng, nặng nhất TmsOrder 7.970)
--     POSM       → PM01      (1.258)
--     Raw        → RM01      (639)
--     Giấy       → PK01      (696)
--     Thùng      → GỘP vào PK01  (746 — trong đó 311 MÃ HÀNG đổi loại)
-- FG02 (SCA) KHÔNG tạo: production không có kho nào dùng. Danh mục còn 4 giá trị,
-- staging 5 — khác biệt ĐÚNG THỰC TẾ, không phải lệch.
--
-- VÌ SAO KHÔNG DÙNG LẠI `20260727_merge_warehouse_type_thung_pk01.sql`: file đó viết cho
-- cột `WarehouseZone.category` / `Location.category` DẠNG ĐƠN, nhưng từ migration
-- `20260727_zone_location_multi_categories` chúng đã là `categories text[]`, và
-- `StocktakeLog.category` không còn tồn tại ⇒ chạy nguyên bản sẽ 42703.
--
-- PHỤ THUỘC: chạy `20260815b_warehouse_type_rename_full.sql` TRƯỚC (RPC cascade 17 bảng —
-- bản cũ 15 bảng bỏ sót OutboundItem.material_type + alert_events.category).
--
-- AN TOÀN: idempotent (chạy lại = bỏ qua phần đã đổi) · sao lưu schema bak_20260815 ·
-- gác RAISE trước khi xoá bất cứ thứ gì. CÁCH CHẠY: Dashboard → SQL Editor → Run.
-- ============================================================================

BEGIN;

-- ── 0) Chặn chạy nhầm khi chưa vá RPC (thiếu 2 cột = để lại dữ liệu trỏ tên chết) ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'rename_warehouse_type'
       AND pg_get_functiondef(p.oid) LIKE '%OutboundItem%'
  ) THEN
    RAISE EXCEPTION 'Chưa apply 20260815b (rename_warehouse_type còn thiếu OutboundItem/alert_events) — dừng';
  END IF;
END $$;

-- ── 1) SAO LƯU phần sẽ bị đụng (khôi phục được nếu cần) ─────────────────────
DROP SCHEMA IF EXISTS bak_20260815 CASCADE;
CREATE SCHEMA bak_20260815;
CREATE TABLE bak_20260815."LookupValue"   AS SELECT * FROM public."LookupValue"   WHERE type = 'warehouse_type';
CREATE TABLE bak_20260815."Material"      AS SELECT id, material_code, category FROM public."Material" WHERE category IS NOT NULL;
CREATE TABLE bak_20260815."Employee"      AS SELECT id, employee_code, allowed_categories FROM public."Employee" WHERE allowed_categories IS NOT NULL;
CREATE TABLE bak_20260815."WarehouseZone" AS SELECT * FROM public."WarehouseZone";
CREATE TABLE bak_20260815."SlotTemplate"  AS SELECT * FROM public."SlotTemplate";
CREATE TABLE bak_20260815."DeliverySlot"  AS SELECT * FROM public."DeliverySlot";

-- ── 2) ĐỔI TÊN 4 loại (RPC cascade 17 bảng). Idempotent: đã đổi rồi thì bỏ qua. ──
DO $$
DECLARE
  m  text[][] := ARRAY[['Thành phẩm','FG01'], ['POSM','PM01'], ['Raw','RM01'], ['Giấy','PK01']];
  i  int;
  vi text; sap text;
BEGIN
  FOR i IN 1 .. array_length(m, 1) LOOP
    vi := m[i][1]; sap := m[i][2];
    IF EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = vi) THEN
      IF EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = sap) THEN
        RAISE EXCEPTION 'Có CẢ "%" lẫn "%" trong danh mục — không tự gộp được, xử tay', vi, sap;
      END IF;
      PERFORM rename_warehouse_type(vi, sap);
      RAISE NOTICE 'đổi tên % → %', vi, sap;
    ELSE
      RAISE NOTICE 'bỏ qua % (không còn trong danh mục)', vi;
    END IF;
  END LOOP;
END $$;

-- ── 3) GỘP "Thùng" → PK01 ───────────────────────────────────────────────────
DO $$
DECLARE
  n_tpl bigint; n_dup bigint; n_slot bigint; n_sdup bigint; n_booked bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = 'Thùng') THEN
    RAISE NOTICE 'không còn loại "Thùng" — bỏ qua bước gộp';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = 'PK01') THEN
    RAISE EXCEPTION 'Chưa có PK01 để gộp vào — kiểm lại bước đổi tên';
  END IF;

  -- GÁC: chỉ được XOÁ khung giờ/slot khi chúng TRÙNG KHÍT PK01 và chưa ai đặt chỗ.
  -- (Đổi sang PK01 thay vì xoá sẽ đẻ dòng trùng lặp trong lưới đặt lịch.)
  SELECT count(*) INTO n_tpl FROM "SlotTemplate" WHERE cargo_type = 'Thùng';
  SELECT count(*) INTO n_dup FROM "SlotTemplate" a JOIN "SlotTemplate" b
       ON a.warehouse_id = b.warehouse_id AND a.day_of_week = b.day_of_week
      AND a.time_from = b.time_from AND a.time_to = b.time_to
      AND a.vehicle_type_id IS NOT DISTINCT FROM b.vehicle_type_id
      AND a.direction      IS NOT DISTINCT FROM b.direction
     WHERE a.cargo_type = 'Thùng' AND b.cargo_type = 'PK01';
  IF n_tpl <> n_dup THEN
    RAISE EXCEPTION 'Có % khung giờ "Thùng" KHÔNG trùng PK01 — dừng, xử tay để không mất cấu hình', n_tpl - n_dup;
  END IF;

  SELECT count(*) INTO n_slot FROM "DeliverySlot" WHERE cargo_type = 'Thùng';
  SELECT count(*) INTO n_sdup FROM "DeliverySlot" a JOIN "DeliverySlot" b
       ON a.warehouse_id = b.warehouse_id AND a.date = b.date
      AND a.time_from = b.time_from AND a.time_to = b.time_to
      AND a.vehicle_type_id IS NOT DISTINCT FROM b.vehicle_type_id
     WHERE a.cargo_type = 'Thùng' AND b.cargo_type = 'PK01';
  IF n_slot <> n_sdup THEN
    RAISE EXCEPTION 'Có % slot ngày "Thùng" KHÔNG trùng PK01 — dừng', n_slot - n_sdup;
  END IF;

  SELECT COALESCE(sum(booked_count), 0) INTO n_booked FROM "DeliverySlot" WHERE cargo_type = 'Thùng';
  IF n_booked > 0 THEN
    RAISE EXCEPTION 'Slot "Thùng" đang có % lượt đặt — dừng, chuyển lượt đặt sang PK01 trước', n_booked;
  END IF;

  -- Cột 1 GIÁ TRỊ
  UPDATE "Material"           SET category      = 'PK01', updated_at = now() WHERE category      = 'Thùng';
  UPDATE "TmsOrder"           SET warehouse_type= 'PK01', updated_at = now() WHERE warehouse_type= 'Thùng';
  UPDATE "TmsOrder"           SET booking_category = 'PK01', updated_at = now() WHERE booking_category = 'Thùng';
  UPDATE khvc_lines           SET booking_category = 'PK01'                    WHERE booking_category = 'Thùng';
  UPDATE "ProductionImport"   SET warehouse_type= 'PK01', updated_at = now() WHERE warehouse_type= 'Thùng';
  UPDATE gate_registrations   SET warehouse_type= 'PK01', updated_at = now() WHERE warehouse_type= 'Thùng';
  UPDATE inbound_plan_lines   SET warehouse_type= 'PK01', updated_at = now() WHERE warehouse_type= 'Thùng';
  UPDATE "PalletLabelPrint"   SET category      = 'PK01'                      WHERE category      = 'Thùng';
  UPDATE "OutboundItem"       SET material_type = 'PK01', updated_at = now() WHERE material_type = 'Thùng';
  UPDATE alert_events         SET category      = 'PK01'                      WHERE category      = 'Thùng';

  -- Chuyến chở lẫn: thay phần tử trong chuỗi ghép, DISTINCT phòng khi ghép ra trùng
  UPDATE "GroupDeliveryOrder"
     SET warehouse_type = (SELECT string_agg(DISTINCT c, '+')
                             FROM unnest(array_replace(wt_cats(warehouse_type), 'Thùng', 'PK01')) c),
         updated_at = now()
   WHERE wt_cats(warehouse_type) @> ARRAY['Thùng'];

  -- Cột MẢNG: gỡ 'Thùng', thêm 'PK01' NẾU CHƯA CÓ (không nhân đôi phần tử).
  -- ⚠ Phải nối bằng ARRAY['PK01']::text[] — viết `|| 'PK01'` thì Postgres chọn toán tử
  --   array||array rồi ép chuỗi thành mảng → 'malformed array literal'.
  UPDATE "Location" SET
    categories = CASE WHEN 'PK01' = ANY(array_remove(categories, 'Thùng'))
                      THEN array_remove(categories, 'Thùng')
                      ELSE array_remove(categories, 'Thùng') || ARRAY['PK01']::text[] END,
    updated_at = now()
  WHERE 'Thùng' = ANY(categories);

  UPDATE "WarehouseZone" SET
    categories = CASE WHEN 'PK01' = ANY(array_remove(categories, 'Thùng'))
                      THEN array_remove(categories, 'Thùng')
                      ELSE array_remove(categories, 'Thùng') || ARRAY['PK01']::text[] END,
    updated_at = now()
  WHERE 'Thùng' = ANY(categories);

  UPDATE "StocktakeLog" SET
    categories = CASE WHEN 'PK01' = ANY(array_remove(categories, 'Thùng'))
                      THEN array_remove(categories, 'Thùng')
                      ELSE array_remove(categories, 'Thùng') || ARRAY['PK01']::text[] END,
    updated_at = now()
  WHERE 'Thùng' = ANY(categories);

  -- Nhân sự: GIỮ NGUYÊN quyền — ai đang được xem "Thùng" thì sau gộp phải xem được PK01
  UPDATE "Employee" SET
    allowed_categories = CASE WHEN 'PK01' = ANY(array_remove(allowed_categories, 'Thùng'))
                              THEN array_remove(allowed_categories, 'Thùng')
                              ELSE array_remove(allowed_categories, 'Thùng') || ARRAY['PK01']::text[] END,
    updated_at = now()
  WHERE 'Thùng' = ANY(allowed_categories);

  UPDATE "Warehouse" SET
    carton_scan_categories = CASE WHEN 'PK01' = ANY(array_remove(carton_scan_categories, 'Thùng'))
                                  THEN array_remove(carton_scan_categories, 'Thùng')
                                  ELSE array_remove(carton_scan_categories, 'Thùng') || ARRAY['PK01']::text[] END,
    updated_at = now()
  WHERE 'Thùng' = ANY(carton_scan_categories);

  -- Khung giờ / slot: XOÁ (gác ở trên đã chứng minh trùng khít PK01, 0 lượt đặt)
  DELETE FROM "DeliverySlot" WHERE cargo_type = 'Thùng';
  DELETE FROM "SlotTemplate" WHERE cargo_type = 'Thùng';

  DELETE FROM "LookupValue" WHERE type = 'warehouse_type' AND value = 'Thùng';
  RAISE NOTICE 'đã gộp "Thùng" → PK01';
END $$;

-- ── 4) GÁC CUỐI: không được còn dòng nào trỏ tên cũ ─────────────────────────
DO $$
DECLARE gaps text;
BEGIN
  SELECT string_agg(format('%s.%s(%s)', tbl, col, n), ', ') INTO gaps
    FROM warehouse_type_column_coverage();
  IF gaps IS NOT NULL THEN
    RAISE EXCEPTION 'Còn cột mang Loại kho ngoài tầm cascade: % — dừng', gaps;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- KIỂM SAU KHI CHẠY — mọi số phải = 0, danh mục phải là 4 mã SAP
--   SELECT value FROM "LookupValue" WHERE type='warehouse_type' ORDER BY 1;
--     → FG01, PK01, PM01, RM01
--   SELECT * FROM warehouse_type_column_coverage();       → 0 dòng
--   SELECT count(*) FROM "Material" WHERE category='PK01';  → 195 + 311 = 506
-- Khôi phục: các bảng gốc trong schema bak_20260815. Dọn: DROP SCHEMA bak_20260815 CASCADE;
-- ============================================================================
