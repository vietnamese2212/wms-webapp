-- Inventory facets RPC — handles millions of rows via DB-side DISTINCT
-- Replace JS-side deduplication with a single efficient PostgreSQL function.
-- Parameters: comma-separated strings (NULL = no filter)
CREATE OR REPLACE FUNCTION public.get_inventory_facets(
  p_warehouse_ids text DEFAULT NULL,  -- e.g. 'uuid1,uuid2'
  p_categories    text DEFAULT NULL   -- e.g. 'Thành phẩm,POSM'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH
  loc_scope AS (
    SELECT id FROM "Location"
    WHERE p_warehouse_ids IS NULL
       OR warehouse_id::text = ANY(string_to_array(p_warehouse_ids, ','))
  ),
  mat_scope AS (
    SELECT id FROM "Material"
    WHERE p_categories IS NULL
       OR category = ANY(string_to_array(p_categories, ','))
  ),
  active AS (
    SELECT DISTINCT material_id, location_id, cycle, machine_code
    FROM "InventoryEntry"
    WHERE status IN ('IN_STOCK', 'PARTIAL')
      AND (p_warehouse_ids IS NULL OR location_id IN (SELECT id FROM loc_scope))
      AND (p_categories    IS NULL OR material_id IN (SELECT id FROM mat_scope))
  )
SELECT jsonb_build_object(
  'materials', COALESCE(
    (
      SELECT jsonb_agg(
               jsonb_build_object('id', m.id, 'code', m.material_code, 'name', m.short_name)
               ORDER BY m.material_code
             )
      FROM "Material" m
      WHERE m.id IN (SELECT DISTINCT material_id FROM active WHERE material_id IS NOT NULL)
    ),
    '[]'::jsonb
  ),
  'locations', COALESCE(
    (
      SELECT jsonb_agg(
               jsonb_build_object('id', l.id, 'code', l.location_code)
               ORDER BY l.location_code
             )
      FROM "Location" l
      WHERE l.id IN (SELECT DISTINCT location_id FROM active WHERE location_id IS NOT NULL)
    ),
    '[]'::jsonb
  ),
  'cycles', COALESCE(
    (
      SELECT jsonb_agg(c ORDER BY c)
      FROM (SELECT DISTINCT cycle AS c FROM active WHERE cycle IS NOT NULL) _c
    ),
    '[]'::jsonb
  ),
  'machines', COALESCE(
    (
      SELECT jsonb_agg(m ORDER BY m)
      FROM (SELECT DISTINCT machine_code AS m FROM active WHERE machine_code IS NOT NULL) _m
    ),
    '[]'::jsonb
  )
);
$$;

-- Grant execute to anon and authenticated roles (used by Supabase service role via backend)
GRANT EXECUTE ON FUNCTION public.get_inventory_facets(text, text) TO anon, authenticated, service_role;
