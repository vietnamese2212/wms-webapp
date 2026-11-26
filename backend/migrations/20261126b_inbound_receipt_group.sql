-- 26/11 — "NHẬP NHIỀU MÃ" (user: nhập nội bộ ở kho chế biến = 1 phiếu vài chục mã của nhiều NCC; Nhập SX từng mã một lâu,
-- Nhập NCC bắt chọn từng NCC). User chốt: khai trước mã + số lượng, quét ở từng mã hoặc quét cả nhóm; vị trí mặc định cho cả phiếu,
-- đổi được từng tem khi quét; dùng ở MỌI kho; giữ khuôn hiện tại.
-- Mô hình: mỗi MÃ vẫn là một ProductionImport (source FACTORY — quét / lưu thủ công / hoàn thành dùng nguyên màn chi tiết như Nhập SX);
-- các phiếu của cùng chứng từ mang chung `receipt_group` (uuid do POST /wms/inbound-orders/group cấp) ⇒ danh sách nối ngoặc như nhóm NCC
-- theo lượt cổng, "Sửa nhóm" thêm / bớt mã, màn quét "cả nhóm" tự chuyển phiếu theo mã trên tem.
-- Không đổi dữ liệu cũ (cột mới NULL). Chạy lại được.

BEGIN;

ALTER TABLE "ProductionImport" ADD COLUMN IF NOT EXISTS receipt_group text;
COMMENT ON COLUMN "ProductionImport".receipt_group IS
  'Nhóm phiếu "Nhập nhiều mã" (26/11): các phiếu (mỗi mã một phiếu) của cùng một chứng từ. NULL = phiếu lẻ / nhóm theo lượt cổng hay lệnh TMS như cũ.';
CREATE INDEX IF NOT EXISTS idx_production_import_receipt_group ON "ProductionImport" (receipt_group) WHERE receipt_group IS NOT NULL;

-- Thứ tự danh sách: phiếu cùng nhóm đứng liền nhau (giống nhóm theo lượt cổng). Chỉ thêm một nhánh vào khoá nhóm.
CREATE OR REPLACE FUNCTION public.inbound_orders_page(p_offset integer, p_limit integer, p_warehouse_ids text[] DEFAULT NULL::text[], p_scope_categories text[] DEFAULT NULL::text[], p_category text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_material_ids text[] DEFAULT NULL::text[], p_cycles text[] DEFAULT NULL::text[], p_machines text[] DEFAULT NULL::text[], p_shift_ids text[] DEFAULT NULL::text[], p_source_types text[] DEFAULT NULL::text[], p_importer_ids text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_search_mat_ids text[] DEFAULT NULL::text[], p_search_order_ids text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE result jsonb;
BEGIN
WITH f AS (
  SELECT pi.id, pi.import_date, pi.created_at,
         -- Khóa nhóm "cùng chuyến" (mirror inboundGroupKey FE): lệnh TMS trước, rồi xe NCC theo cổng
         CASE WHEN pi.tms_order_id IS NOT NULL THEN 'tms:' || pi.tms_order_id::text
              WHEN pi.source_type = 'NCC' AND pi.gate_registration_id IS NOT NULL
                THEN 'gate:' || pi.gate_registration_id::text
              -- 26/11: nhóm phiếu "Nhập nhiều mã" (một chứng từ nhiều mã) — mirror inboundGroupKey FE
              WHEN pi.receipt_group IS NOT NULL THEN 'grp:' || pi.receipt_group
              ELSE NULL END AS grp,
         COALESCE(CASE s.name WHEN 'Ca 1' THEN 0 WHEN 'Ca 2' THEN 1
                              WHEN 'Ca 3' THEN 2 WHEN 'HC' THEN 3 END, 99) AS shift_ord
  FROM "ProductionImport" pi
  LEFT JOIN "ImportShift" s ON s.id = pi.shift_id
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
pg AS (
  SELECT id,
         row_number() OVER (ORDER BY import_date DESC, (grp IS NULL), COALESCE(grp, ''),
                            shift_ord, created_at, id) AS rn
  FROM f
  ORDER BY import_date DESC, (grp IS NULL), COALESCE(grp, ''), shift_ord, created_at, id
  LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
)
SELECT jsonb_build_object(
  'total', (SELECT count(*) FROM f),
  'ids',   COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb)
) INTO result;
  RETURN result;
END;
$function$;

COMMIT;
