-- Hàm RPC trả về scan log xuất kho (flat join, phục vụ trang Lịch sử quét)
-- Apply: Supabase Dashboard → SQL Editor → Run
CREATE OR REPLACE FUNCTION get_outbound_scan_log(
  p_from_date     text    DEFAULT NULL,
  p_to_date       text    DEFAULT NULL,
  p_warehouse_id  text    DEFAULT NULL,
  p_group_code    text    DEFAULT NULL,
  p_distributor   text    DEFAULT NULL,
  p_delivery_code text    DEFAULT NULL,
  p_material      text    DEFAULT NULL,
  p_scanner_name  text    DEFAULT NULL,
  p_limit         int     DEFAULT 200,
  p_offset        int     DEFAULT 0
)
RETURNS TABLE (
  id                    text,
  pallet_code           text,
  cartons_scanned       numeric,
  production_date       text,
  scanned_at            timestamptz,
  is_loose_picking      boolean,
  group_code            text,
  delivery_date         date,
  license_plate         text,
  container_number      text,
  forklift_driver_names text,
  loader_name           text,
  assigned_at           timestamptz,
  started_at            timestamptz,
  last_scanned_at       timestamptz,
  completed_at          timestamptz,
  warehouse_name        text,
  delivery_code         text,
  distributor_name      text,
  header_text           text,
  material_code_raw     text,
  material_code         text,
  material_name         text,
  cycle                 text,
  machine_code          text,
  import_date           timestamptz,
  location_code         text,
  scanner_name          text,
  total_count           bigint
)
LANGUAGE sql STABLE
AS $$
  SELECT
    ose.id,
    ose.pallet_code,
    ose.cartons_scanned,
    ose.production_date,
    ose.scanned_at,
    ose.is_loose_picking,
    gdo.group_code,
    gdo.delivery_date,
    gdo.license_plate,
    gdo.container_number,
    gdo.forklift_driver_names,
    gdo.loader_name,
    gdo.assigned_at,
    gdo.started_at,
    gdo.last_scanned_at,
    gdo.completed_at,
    w.name   AS warehouse_name,
    od.delivery_code,
    od.distributor_name,
    oi.header_text,
    oi.material_code_raw,
    m.material_code,
    m.short_name AS material_name,
    ie.cycle,
    ie.machine_code,
    ie.import_date,
    l.location_code,
    e.name   AS scanner_name,
    COUNT(*) OVER() AS total_count
  FROM outbound_scan_entries ose
  JOIN outbound_items       oi  ON oi.id  = ose.item_id
  JOIN outbound_deliveries  od  ON od.id  = oi.do_id
  JOIN group_delivery_orders gdo ON gdo.id = od.gdo_id
  JOIN warehouses            w   ON w.id   = gdo.warehouse_id
  LEFT JOIN materials         m   ON m.id   = oi.material_id
  LEFT JOIN inventory_entries ie  ON ie.id  = ose.inventory_entry_id
  LEFT JOIN locations         l   ON l.id   = ie.location_id
  LEFT JOIN employees         e   ON e.id   = ose.scanned_by
  WHERE
    (p_from_date    IS NULL OR gdo.delivery_date >= p_from_date::date)
    AND (p_to_date      IS NULL OR gdo.delivery_date <= p_to_date::date)
    AND (p_warehouse_id IS NULL OR gdo.warehouse_id = p_warehouse_id)
    AND (p_group_code   IS NULL OR gdo.group_code   ILIKE '%' || p_group_code   || '%')
    AND (p_distributor  IS NULL OR od.distributor_name ILIKE '%' || p_distributor  || '%')
    AND (p_delivery_code IS NULL OR od.delivery_code   ILIKE '%' || p_delivery_code || '%')
    AND (
      p_material IS NULL
      OR m.material_code  ILIKE '%' || p_material || '%'
      OR m.short_name     ILIKE '%' || p_material || '%'
      OR oi.material_code_raw ILIKE '%' || p_material || '%'
    )
    AND (p_scanner_name IS NULL OR e.name ILIKE '%' || p_scanner_name || '%')
  ORDER BY ose.scanned_at DESC
  LIMIT  p_limit
  OFFSET p_offset
$$;
