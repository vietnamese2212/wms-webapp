-- ============================================================================
-- 20261001c — Toạ độ khách hàng: CẤP QUYỀN theo chức danh (lớp C37: quyền tồn tại ≠ ai đó có nó)
-- ============================================================================
-- Hai action mới của module customers (01/10, điều vận trên bản đồ):
--   • locate  = chấm ghim trên bản đồ / lấy GPS điện thoại tại chỗ  ← customers.edit ∨ dispatch.plan
--       (ai sửa hồ sơ khách, hoặc ai đang lập kế hoạch xe — người điều vận dời ghim sai mà không được sửa hồ sơ khách)
--   • geocode = máy định vị hàng loạt từ địa chỉ (gọi dịch vụ ngoài, tốn lượt) ← customers.edit
-- Cấp theo NĂNG LỰC ĐÃ CÓ, không so tên tiếng Việt; CHỈ điền cho chức danh CHƯA có key — admin đã tự cấp/gỡ thì không đè.
-- ============================================================================
BEGIN;
WITH src AS (
  SELECT id, COALESCE(module_permissions, '{}'::jsonb) AS mp FROM public."JobTitle"
), capab AS (
  SELECT id, mp,
         (mp->'customers' ? 'edit') AS cust_edit,
         (mp->'dispatch'  ? 'plan') AS dispatch_plan
  FROM src
), want AS (
  SELECT id, mp,
         ARRAY_REMOVE(ARRAY[
           CASE WHEN (cust_edit OR dispatch_plan) AND NOT (mp->'customers' ? 'locate')  THEN 'locate'  END,
           CASE WHEN cust_edit                    AND NOT (mp->'customers' ? 'geocode') THEN 'geocode' END
         ], NULL) AS add
  FROM capab
)
UPDATE public."JobTitle" j
SET module_permissions = jsonb_set(w.mp, '{customers}', COALESCE(w.mp->'customers', '[]'::jsonb) || to_jsonb(w.add)),
    updated_at = now()
FROM want w
WHERE j.id = w.id AND cardinality(w.add) > 0;
COMMIT;
