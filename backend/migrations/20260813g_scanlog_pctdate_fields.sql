-- 20260813g — Lịch sử quét: %Date SAI NGUỒN (audit hardcode 13/08, mục A2).
-- FE OutboundScanLog tự tính %Date bằng calcPctAtScan(prodDate, m.shelf_life_days, scannedAt):
-- bỏ qua (1) HSD TƯỜNG MINH trên tem V2 (ie.expiry_date), (2) shelf-life THEO LÔ (ie.shelf_life_days
-- — đã bake override NCC lúc nhập), (3) override NCC của mã — nên ra số KHÁC trang Tồn kho.
-- Fix: 2 RPC trả thêm NGUYÊN LIỆU THÔ (4 cột cuối), FE dùng computePctDate CHUNG (utils/shelfLife)
-- với nowMs = thời điểm quét. Đổi RETURNS TABLE ⇒ phải DROP trước (CREATE OR REPLACE từ chối đổi shape).

DROP FUNCTION IF EXISTS public.get_outbound_scan_log(text,text,text,text,text,text,text,text,text,text,text,text,text,integer,integer,text);
DROP FUNCTION IF EXISTS public.search_outbound_scan_log(text,text,text,integer,integer);

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
