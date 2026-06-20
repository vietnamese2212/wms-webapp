-- ─────────────────────────────────────────────────────────────────────────────
-- #E — get_scan_log_facets: thêm scope theo kho (p_warehouse_ids)
--
-- TRƯỚC: facets (dropdown Máy / Chu kỳ trên trang Lịch sử quét) chỉ lọc theo
-- material_category → user kho A vẫn thấy mã máy / chu kỳ của MỌI kho (rò rỉ nhẹ),
-- trong khi get_outbound_scan_log đã scope theo gdo.warehouse_id.
--
-- SAU: thêm tham số p_warehouse_ids (CSV id kho) + JOIN qua GDO để lọc theo
-- gdo.warehouse_id — KHỚP đúng cách RPC chính scope. Controller truyền danh sách kho
-- hiệu lực (đã giao với scope JWT của user) như get_outbound_scan_log.
--
-- Apply: Supabase Dashboard → SQL Editor → chạy cả file.
-- ⚠️ Apply TRƯỚC/đồng thời với deploy backend rebuild-token .80 (controller gọi RPC 2 tham số;
--    chưa apply → dropdown facets rỗng, trang vẫn chạy bình thường).
-- ─────────────────────────────────────────────────────────────────────────────

-- Bỏ overload 1-tham số cũ để tránh nhập nhằng (chỉ getScanLogFacets gọi hàm này).
DROP FUNCTION IF EXISTS public.get_scan_log_facets(text);

CREATE OR REPLACE FUNCTION public.get_scan_log_facets(
  p_material_category text DEFAULT NULL::text,
  p_warehouse_ids     text DEFAULT NULL::text
)
RETURNS TABLE(machines text[], cycles text[])
LANGUAGE sql
STABLE
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
        AND (p_material_category IS NULL OR m.category = p_material_category)
        AND (p_warehouse_ids     IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
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
        AND (p_material_category IS NULL OR m.category = p_material_category)
        AND (p_warehouse_ids     IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
    )
$function$;
