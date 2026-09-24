-- 20260817: filter "Không đưa hàng vào" (Location.slot_no_in) cho trang danh mục Vị trí kho.
-- Thêm p_slot_no_in (3 trạng thái: NULL = không lọc · true/false = chỉ có / chỉ chưa) vào
-- locations_page + locations_summary — cột NULL coi như false (chưa cấm).
-- DROP trước khi CREATE: thêm tham số DEFAULT bằng CREATE OR REPLACE sẽ tạo OVERLOAD thứ hai
-- cùng tên → PostgREST thấy 2 ứng viên cùng khớp là PGRST203 (ambiguous) cho MỌI lời gọi cũ.
DROP FUNCTION IF EXISTS public.locations_page(integer, integer, text[], text, text[], text[], boolean, boolean, boolean, boolean, text[]);
DROP FUNCTION IF EXISTS public.locations_summary(text[], text, text[], text[], boolean, boolean, text[]);

CREATE FUNCTION public.locations_page(
  p_offset integer, p_limit integer,
  p_wh_ids text[] DEFAULT NULL::text[], p_category text DEFAULT NULL::text,
  p_scope_cats text[] DEFAULT NULL::text[], p_tokens text[] DEFAULT NULL::text[],
  p_flag boolean DEFAULT NULL::boolean, p_incl_inactive boolean DEFAULT false,
  p_with_rows boolean DEFAULT false, p_pick_face boolean DEFAULT NULL::boolean,
  p_subs text[] DEFAULT NULL::text[], p_slot_no_in boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  result jsonb;
BEGIN
  WITH f AS (
    SELECT l.id, l.sub_code, l.row, l.shelf
    FROM "Location" l
    LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
    WHERE (p_wh_ids IS NULL OR l.warehouse_id = ANY (p_wh_ids))
      AND (p_incl_inactive OR l.is_active)
      AND (p_category IS NULL OR l.categories IS NULL OR l.categories @> ARRAY[p_category])
      AND (p_scope_cats IS NULL OR l.categories IS NULL OR l.categories && p_scope_cats)
      AND (p_flag IS NULL OR l.requires_stocktake = p_flag)
      AND (p_pick_face IS NULL OR l.is_pick_face = p_pick_face)
      AND (p_slot_no_in IS NULL OR COALESCE(l.slot_no_in, false) = p_slot_no_in)
      AND (p_subs IS NULL OR l.sub_code = ANY (p_subs))
      AND (p_tokens IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p_tokens) t
            WHERE position(t IN (COALESCE(l.search_norm, '') || ' ' ||
                   lower(COALESCE(array_to_string(l.categories, ' '), '') || ' ' ||
                         COALESCE(l.sub_type, '') || ' ' || COALESCE(l.row, '') || ' ' ||
                         COALESCE(l.shelf, '') || ' ' || COALESCE(w.code, '') || ' ' || COALESCE(w.name, '')))) = 0))
  ),
  pg AS (
    SELECT id, row_number() OVER (ORDER BY sub_code, row, shelf, id) rn
    FROM f ORDER BY sub_code, row, shelf, id
    LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    'ids',   COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb),
    'total', (SELECT count(*) FROM f),
    'rows',  CASE WHEN NOT p_with_rows THEN NULL ELSE COALESCE((
      SELECT jsonb_agg(to_jsonb(l)
               || jsonb_build_object(
                    'warehouse', CASE WHEN w.id IS NULL THEN NULL ELSE
                      jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name) END,
                    '_count', jsonb_build_object('inventory_entries', COALESCE(cnt.n, 0)),
                    'used_slots', COALESCE(us.n, 0),
                    'has_same_material', false)
               ORDER BY p.rn)
      FROM pg p
      JOIN "Location" l ON l.id = p.id
      LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
      LEFT JOIN LATERAL (
        SELECT count(*) n FROM "InventoryEntry" e WHERE e.location_id = l.id) cnt ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*) n FROM "InventoryEntry" e
        WHERE e.location_id = l.id AND e.stack_layer = 1
          AND e.status IN ('IN_STOCK', 'PARTIAL') AND e.cartons_remaining > 0) us ON TRUE), '[]'::jsonb) END
  ) INTO result;
  RETURN result;
END $function$;

CREATE FUNCTION public.locations_summary(
  p_wh_ids text[] DEFAULT NULL::text[], p_category text DEFAULT NULL::text,
  p_scope_cats text[] DEFAULT NULL::text[], p_tokens text[] DEFAULT NULL::text[],
  p_flag boolean DEFAULT NULL::boolean, p_pick_face boolean DEFAULT NULL::boolean,
  p_subs text[] DEFAULT NULL::text[], p_slot_no_in boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  result jsonb;
BEGIN
  WITH f AS (   -- SummaryBand luôn tính trên vị trí ĐANG DÙNG (mirror activeFiltered của FE cũ)
    SELECT l.id, l.max_pallets
    FROM "Location" l
    LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
    WHERE (p_wh_ids IS NULL OR l.warehouse_id = ANY (p_wh_ids))
      AND l.is_active
      AND (p_category IS NULL OR l.categories IS NULL OR l.categories @> ARRAY[p_category])
      AND (p_scope_cats IS NULL OR l.categories IS NULL OR l.categories && p_scope_cats)
      AND (p_flag IS NULL OR l.requires_stocktake = p_flag)
      AND (p_pick_face IS NULL OR l.is_pick_face = p_pick_face)
      AND (p_slot_no_in IS NULL OR COALESCE(l.slot_no_in, false) = p_slot_no_in)
      AND (p_subs IS NULL OR l.sub_code = ANY (p_subs))
      AND (p_tokens IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p_tokens) t
            WHERE position(t IN (COALESCE(l.search_norm, '') || ' ' ||
                   lower(COALESCE(array_to_string(l.categories, ' '), '') || ' ' ||
                         COALESCE(l.sub_type, '') || ' ' || COALESCE(l.row, '') || ' ' ||
                         COALESCE(l.shelf, '') || ' ' || COALESCE(w.code, '') || ' ' || COALESCE(w.name, '')))) = 0))
  ),
  used AS (
    SELECT f.id, f.max_pallets, count(e.id) AS used_slots
    FROM f LEFT JOIN "InventoryEntry" e
      ON e.location_id = f.id AND e.stack_layer = 1
     AND e.status IN ('IN_STOCK', 'PARTIAL') AND e.cartons_remaining > 0
    GROUP BY f.id, f.max_pallets
  )
  SELECT jsonb_build_object(
    'count',    (SELECT count(*) FROM used),
    'capacity', (SELECT COALESCE(sum(max_pallets), 0) FROM used),
    'used',     (SELECT COALESCE(sum(used_slots), 0) FROM used),
    'full',     (SELECT count(*) FROM used WHERE max_pallets > 0 AND used_slots >= max_pallets)
  ) INTO result;
  RETURN result;
END $function$;
