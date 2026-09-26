-- 20260926c — ĐK bảo quản của Ô chỉ áp cho hàng thuộc ĐÚNG Loại kho của ô đó.
-- Đo Bàu Bàng 26/09 sau khi khai khu LNVL "Kho Lạnh NVL" (Loại kho của ô: RM01, PK01) = 2–8 °C: 136 mã FG01 có 284/9.045 pallet
-- nằm NHỜ trong khu đó ⇒ theo luật "mã nằm cả ô lạnh lẫn ô thường đòi cả hai mức" mọi chuyến FG01 bị ép lên xe kết hợp (94/97).
-- Hàng để nhờ ô của loại khác không phải hàng lạnh — ô lạnh nói về hàng THUỘC ô đó (user: "trong kho RM01 có cả kho lạnh, thường").
-- Ô không khai Loại kho (categories rỗng) = nhận mọi loại ⇒ áp cho mọi hàng (cùng quy ước null-inclusive của Location.categories).
CREATE OR REPLACE FUNCTION public.dispatch_stock_conditions(p_warehouse_id text, p_material_codes text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE out jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Location" WHERE warehouse_id = p_warehouse_id AND storage_condition IS NOT NULL) THEN
    RETURN '[]'::jsonb;
  END IF;
  WITH mats AS (
    SELECT m.id, m.material_code, m.category FROM "Material" m WHERE m.material_code = ANY(p_material_codes)
  ), live AS (
    SELECT ie.material_id,
           CASE WHEN l.storage_condition IS NOT NULL
                 AND (coalesce(cardinality(l.categories), 0) = 0 OR mats.category = ANY(l.categories))
                THEN l.storage_condition END AS storage_condition
      FROM "InventoryEntry" ie
      JOIN mats ON mats.id = ie.material_id
      LEFT JOIN "Location" l ON l.id = ie.location_id
     WHERE ie.warehouse_id = p_warehouse_id
       AND ie.cartons_remaining > 0
       AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
  ), hot AS (
    SELECT DISTINCT material_id FROM live WHERE storage_condition IS NOT NULL
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('material_code', x.material_code, 'condition', x.storage_condition) ORDER BY x.material_code, x.storage_condition NULLS FIRST), '[]'::jsonb)
    INTO out
    FROM (SELECT DISTINCT mats.material_code, live.storage_condition
            FROM live JOIN hot USING (material_id) JOIN mats ON mats.id = live.material_id) x;
  RETURN out;
END;
$function$;
