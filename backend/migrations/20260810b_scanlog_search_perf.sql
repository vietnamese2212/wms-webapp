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
