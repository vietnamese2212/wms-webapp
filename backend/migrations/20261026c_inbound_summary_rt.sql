-- 26/10: dải tổng Nhập kho thêm ô "RT" (phiếu nhập hàng trả về, source_type='RETURN').
-- Trước bản này 'sx' đếm mọi thứ không phải NCC / TRANSFER ⇒ phiếu trả về bị tính vào SX.
-- Chỉ đổi hai dòng trong jsonb_build_object ('sx' loại RETURN, thêm 'rt'); phần còn lại nguyên văn.
CREATE OR REPLACE FUNCTION public.inbound_orders_summary(p_warehouse_ids text[] DEFAULT NULL::text[], p_scope_categories text[] DEFAULT NULL::text[], p_category text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_material_ids text[] DEFAULT NULL::text[], p_cycles text[] DEFAULT NULL::text[], p_machines text[] DEFAULT NULL::text[], p_shift_ids text[] DEFAULT NULL::text[], p_source_types text[] DEFAULT NULL::text[], p_importer_ids text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_search_mat_ids text[] DEFAULT NULL::text[], p_search_order_ids text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE result jsonb;
BEGIN
WITH ord AS (
  SELECT pi.id, pi.status, pi.source_type, pi.posm_entry_id, pi.posm_cartons, pi.location_id,
         m.material_code AS mat_code, m.entry_unit, m.units_per_carton
  FROM "ProductionImport" pi
  LEFT JOIN "Material" m ON m.id = pi.material_id
  WHERE (p_warehouse_ids IS NULL OR pi.warehouse_id = ANY (p_warehouse_ids))
    AND ((p_status IS NULL AND pi.status <> 'CANCELLED') OR pi.status = p_status)
    AND (p_date_from IS NULL OR pi.import_date >= p_date_from::timestamp)
    AND (p_date_to   IS NULL OR pi.import_date < (p_date_to + 1)::timestamp)
    AND (p_category IS NULL OR pi.warehouse_type = p_category OR pi.source_type = 'TRANSFER')
    AND (p_category IS NOT NULL OR p_scope_categories IS NULL
         OR pi.warehouse_type = ANY (p_scope_categories) OR pi.source_type = 'TRANSFER')
    AND (p_material_ids IS NULL OR pi.material_id = ANY (p_material_ids))
    AND (p_shift_ids    IS NULL OR pi.source_type = 'TRANSFER' OR pi.shift_id = ANY (p_shift_ids))
    AND (p_source_types IS NULL OR pi.source_type = ANY (p_source_types))
    AND (p_importer_ids IS NULL OR pi.imported_by = ANY (p_importer_ids)
         OR (pi.imported_by IS NULL AND pi.created_by = ANY (p_importer_ids)))
    AND (p_cycles IS NULL OR pi.source_type = 'TRANSFER' OR EXISTS (
          SELECT 1 FROM "InventoryEntry" ie
          WHERE ie.import_order_id = pi.id AND ie.cycle = ANY (p_cycles)))
    AND (p_machines IS NULL OR pi.source_type = 'TRANSFER' OR EXISTS (
          SELECT 1 FROM "InventoryEntry" ie
          WHERE ie.import_order_id = pi.id AND ie.machine_code = ANY (p_machines)))
    AND (p_search IS NULL
         OR pi.import_code ILIKE '%' || p_search || '%'
         OR pi.material_id = ANY (COALESCE(p_search_mat_ids, ARRAY[]::text[]))
         OR pi.id = ANY (COALESCE(p_search_order_ids, ARRAY[]::text[])))
),
ent AS (
  SELECT ie.import_order_id AS oid, ie.cartons_imported, ie.pallet_code,
         l.location_code, l.sub_code
  FROM "InventoryEntry" ie
  JOIN ord o ON o.id = ie.import_order_id
  LEFT JOIN "Location" l ON l.id = ie.location_id
),
-- Per-order: tổng thô + xử lý pallet POSM DÙNG CHUNG (mirror computeOrderStats BE):
--   phiếu TẠO shared entry (có entry pallet_code = mã hàng mình) → thay phần shared bằng posm_cartons;
--   phiếu MƯỢN (posm_cartons>0, không có shared trong entries mình) → cộng thêm + 1 pallet.
oagg AS (
  SELECT o.id, o.status, o.source_type, o.location_id, o.entry_unit, o.units_per_carton,
         o.posm_entry_id, o.posm_cartons,
         COALESCE(SUM(e.cartons_imported), 0)::numeric AS base_cartons,
         COUNT(e.oid)::int AS pallet_cnt,
         COALESCE(SUM(e.cartons_imported) FILTER (WHERE e.pallet_code = o.mat_code), 0)::numeric AS shared_own,
         COALESCE(BOOL_OR(e.pallet_code = o.mat_code), false) AS is_creator
  FROM ord o
  LEFT JOIN ent e ON e.oid = o.id
  GROUP BY o.id, o.status, o.source_type, o.location_id, o.entry_unit, o.units_per_carton,
           o.posm_entry_id, o.posm_cartons, o.mat_code
),
adj AS (
  SELECT *,
    CASE WHEN posm_entry_id IS NOT NULL AND posm_cartons IS NOT NULL THEN
           CASE WHEN is_creator THEN base_cartons - shared_own + posm_cartons
                WHEN posm_cartons > 0 THEN base_cartons + posm_cartons
                ELSE base_cartons END
         ELSE base_cartons END AS total_cartons,
    CASE WHEN posm_entry_id IS NOT NULL AND posm_cartons IS NOT NULL
              AND NOT is_creator AND posm_cartons > 0
         THEN pallet_cnt + 1 ELSE pallet_cnt END AS pallet_total
  FROM oagg
),
conv AS (
  SELECT *,
    CASE WHEN entry_unit IS NOT NULL AND btrim(entry_unit) <> '' AND COALESCE(units_per_carton, 0) > 0
         THEN ROUND(total_cartons / units_per_carton, 3) ELSE total_cartons END AS cartons_conv
  FROM adj
),
-- Bảng "Vị trí hàng nhập": theo vị trí THẬT của từng pallet; quy đổi per-order-per-vị-trí
-- rồi mới cộng (mirror locationSummary FE)
loc_e AS (
  SELECT e.oid,
         COALESCE(e.location_code || '-' || e.sub_code, '(chưa xác định)') AS loc,
         COUNT(*)::int AS pallets, SUM(e.cartons_imported)::numeric AS cartons
  FROM ent e
  GROUP BY e.oid, COALESCE(e.location_code || '-' || e.sub_code, '(chưa xác định)')
),
loc_conv AS (
  SELECT le.loc, le.pallets,
         CASE WHEN a.entry_unit IS NOT NULL AND btrim(a.entry_unit) <> '' AND COALESCE(a.units_per_carton, 0) > 0
              THEN ROUND(le.cartons / a.units_per_carton, 3) ELSE le.cartons END AS cartons
  FROM loc_e le JOIN adj a ON a.id = le.oid
  UNION ALL
  -- Fallback FE: phiếu 0 entry nhưng mượn pallet POSM chung → tính theo vị trí của phiếu
  SELECT COALESCE(l.location_code || '-' || l.sub_code, '(chưa xác định)'), a.pallet_total,
         CASE WHEN a.entry_unit IS NOT NULL AND btrim(a.entry_unit) <> '' AND COALESCE(a.units_per_carton, 0) > 0
              THEN ROUND(a.total_cartons / a.units_per_carton, 3) ELSE a.total_cartons END
  FROM adj a LEFT JOIN "Location" l ON l.id = a.location_id
  WHERE a.pallet_cnt = 0 AND a.pallet_total > 0
),
locs AS (
  SELECT loc, SUM(pallets)::int AS pallets, SUM(cartons) AS cartons
  FROM loc_conv GROUP BY loc
)
SELECT jsonb_build_object(
  'total_orders',  (SELECT count(*) FROM adj),
  'sx',            (SELECT count(*) FROM adj
                    WHERE source_type IS DISTINCT FROM 'NCC' AND source_type IS DISTINCT FROM 'TRANSFER'
                      AND source_type IS DISTINCT FROM 'RETURN'),
  'ncc',           (SELECT count(*) FROM adj WHERE source_type = 'NCC'),
  'tf',            (SELECT count(*) FROM adj WHERE source_type = 'TRANSFER'),
  'rt',            (SELECT count(*) FROM adj WHERE source_type = 'RETURN'),
  'completed',     (SELECT count(*) FROM adj WHERE status = 'COMPLETED'),
  'total_pallets', COALESCE((SELECT SUM(pallet_total) FROM adj), 0),
  'total_cartons', COALESCE((SELECT SUM(cartons_conv) FROM conv), 0),
  'locations',     COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'loc', loc, 'pallets', pallets, 'cartons', cartons)
                       ORDER BY pallets DESC, loc) FROM locs), '[]'::jsonb)
) INTO result;
  RETURN result;
END;
$function$;
