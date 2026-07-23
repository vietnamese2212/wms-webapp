-- RBAC scope-cut cho facet Lịch sử quét: thêm p_allowed_categories vào get_scan_log_facets
-- (get_outbound_scan_log đã có từ 20260702; facets bị bỏ sót → rò machine_code/cycle chéo loại).
-- DROP overload 2-arg cũ rồi tạo bản 3-arg (mọi lời gọi 2/3 tham số đều resolve về 1 hàm, né PostgREST overload-ambiguity).
-- Null-inclusive: m.category IS NULL vẫn hiện (khớp categoryAllowed của app). BE có fallback nếu chưa apply.

DROP FUNCTION IF EXISTS public.get_scan_log_facets(text, text);

CREATE OR REPLACE FUNCTION public.get_scan_log_facets(
  p_material_category  text DEFAULT NULL,
  p_warehouse_ids      text DEFAULT NULL,
  p_allowed_categories text DEFAULT NULL
)
RETURNS TABLE(machines text[], cycles text[])
LANGUAGE sql STABLE
AS $function$
  SELECT
    (
      SELECT COALESCE(array_agg(DISTINCT ie.machine_code ORDER BY ie.machine_code), ARRAY[]::text[])
      FROM "InventoryEntry"     ie
      JOIN "OutboundScanEntry"  ose ON ose.inventory_entry_id = ie.id
      JOIN "OutboundItem"       oi  ON oi.id  = ose.item_id
      JOIN "OutboundDelivery"   od  ON od.id  = oi.do_id
      JOIN "GroupDeliveryOrder" gdo ON gdo.id = od.gdo_id
      LEFT JOIN "Material"      m   ON m.id   = oi.material_id
      WHERE ie.machine_code IS NOT NULL
        AND (p_material_category  IS NULL OR m.category = p_material_category)
        AND (p_warehouse_ids      IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
        AND (p_allowed_categories IS NULL OR m.category IS NULL OR m.category = ANY(string_to_array(p_allowed_categories, ',')))
    ),
    (
      SELECT COALESCE(array_agg(DISTINCT ie.cycle ORDER BY ie.cycle), ARRAY[]::text[])
      FROM "InventoryEntry"     ie
      JOIN "OutboundScanEntry"  ose ON ose.inventory_entry_id = ie.id
      JOIN "OutboundItem"       oi  ON oi.id  = ose.item_id
      JOIN "OutboundDelivery"   od  ON od.id  = oi.do_id
      JOIN "GroupDeliveryOrder" gdo ON gdo.id = od.gdo_id
      LEFT JOIN "Material"      m   ON m.id   = oi.material_id
      WHERE ie.cycle IS NOT NULL
        AND (p_material_category  IS NULL OR m.category = p_material_category)
        AND (p_warehouse_ids      IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
        AND (p_allowed_categories IS NULL OR m.category IS NULL OR m.category = ANY(string_to_array(p_allowed_categories, ',')))
    )
$function$;
