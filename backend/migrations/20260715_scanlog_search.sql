-- Lịch sử quét: SEARCH TỔNG (user chốt 15/07) — 1 ô tìm mọi thứ: QR pallet, QR tem thùng,
-- tên NPP, tên hàng, mã hàng, số DO, số xe, biển số, vị trí, người quét, tên kho.
-- BYPASS bắt buộc chọn Kho/Loại kho ở FE — nhưng VẪN cắt theo scope user (p_warehouse_ids +
-- p_allowed_categories từ JWT, controller truyền). Shape cột GIỐNG get_outbound_scan_log
-- để FE tái dùng nguyên bảng render + THÊM gdo_id/item_id (click dòng kết quả → mở đơn xuất).
DROP FUNCTION IF EXISTS public.search_outbound_scan_log(text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.search_outbound_scan_log(
  p_q text,
  p_warehouse_ids text DEFAULT NULL,
  p_allowed_categories text DEFAULT NULL,
  p_limit integer DEFAULT 500, p_offset integer DEFAULT 0
)
RETURNS TABLE(id text, pallet_code text, cartons_scanned numeric, production_date text, best_available_date text, scanned_at timestamp with time zone, is_loose_picking boolean, loose_confirmed_at timestamp with time zone, loose_confirmed_by_name text, group_code text, delivery_date date, license_plate text, container_number text, forklift_driver_names text, loader_name text, assigned_at timestamp with time zone, started_at timestamp with time zone, last_scanned_at timestamp with time zone, completed_at timestamp with time zone, warehouse_name text, delivery_code text, distributor_name text, header_text text, material_code_raw text, material_code text, material_name text, material_category text, shelf_life_days integer, cycle text, machine_code text, nmsx text, import_date timestamp with time zone, location_code text, scanner_name text, total_count bigint, gdo_id text, item_id text)
LANGUAGE sql STABLE
AS $function$
  SELECT
    ose.id,
    ose.pallet_code,
    ose.cartons_scanned,
    ose.production_date,
    ose.best_available_date,
    ose.scanned_at,
    ose.is_loose_picking,
    ose.loose_confirmed_at,
    ec.name                AS loose_confirmed_by_name,
    gdo.group_code,
    CASE
      WHEN ose.is_loose_picking
        THEN (ose.loose_confirmed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      ELSE
        (ose.scanned_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    END                    AS delivery_date,
    gdo.license_plate,
    gdo.container_number,
    gdo.forklift_driver_names,
    gdo.loader_name,
    gdo.assigned_at,
    gdo.started_at,
    gdo.last_scanned_at,
    gdo.completed_at,
    w.name                 AS warehouse_name,
    od.delivery_code,
    od.distributor_name,
    oi.header_text,
    oi.material_code_raw,
    m.material_code,
    m.short_name           AS material_name,
    m.category             AS material_category,
    m.shelf_life_days,
    ie.cycle,
    ie.machine_code,
    ose.nmsx,
    ie.import_date,
    l.location_code,
    e.name                 AS scanner_name,
    COUNT(*) OVER()        AS total_count,
    gdo.id::text           AS gdo_id,
    oi.id::text            AS item_id
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
    (p_warehouse_ids      IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
    AND (p_allowed_categories IS NULL OR m.category IS NULL OR m.category = ANY(string_to_array(p_allowed_categories, ',')))
    AND (NOT ose.is_loose_picking OR ose.loose_confirmed = true)
    AND (
      ose.pallet_code          ILIKE '%' || p_q || '%'
      OR ose.carton_scans::text ILIKE '%' || p_q || '%'
      OR gdo.group_code        ILIKE '%' || p_q || '%'
      OR gdo.license_plate     ILIKE '%' || p_q || '%'
      OR gdo.container_number  ILIKE '%' || p_q || '%'
      OR od.distributor_name   ILIKE '%' || p_q || '%'
      OR od.delivery_code      ILIKE '%' || p_q || '%'
      OR m.material_code       ILIKE '%' || p_q || '%'
      OR m.short_name          ILIKE '%' || p_q || '%'
      OR oi.material_code_raw  ILIKE '%' || p_q || '%'
      OR e.name                ILIKE '%' || p_q || '%'
      OR l.location_code       ILIKE '%' || p_q || '%'
      OR w.name                ILIKE '%' || p_q || '%'
    )
  ORDER BY ose.scanned_at DESC
  LIMIT  p_limit
  OFFSET p_offset
$function$;
