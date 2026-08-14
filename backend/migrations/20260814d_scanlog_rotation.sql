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
