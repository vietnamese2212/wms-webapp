-- QUYỀN MỚI production.view_recipe "Xem công thức" (27/11 — user chốt bảo mật công thức: "ẩn số lượng với người không phải QA / quản lý").
-- Không có quyền này (và không có manage_recipe): API công thức bỏ cỡ mẻ + số lượng + mức lệch, trang Định mức ẩn khỏi menu.
-- Cấp sẵn cho chức danh QA (đang có approve_qa) và chức danh đang khai định mức (manage_recipe) — staging 27/11: Nhân viên QA NVL ·
-- Nhân viên QA TP · Phó phòng QA · QA chế biến · QA Manager · Quản lý kho toàn quốc. Chức danh khác (trưởng ca, giám sát kho, công nhân,
-- quản lý kho NPP / site) không được cấp — người quản trị tự tick thêm ở Quản lý người dùng nếu cần.
BEGIN;

UPDATE "JobTitle"
   SET module_permissions = jsonb_set(module_permissions, '{production}', (module_permissions->'production') || '["view_recipe"]'::jsonb),
       updated_at = now()
 WHERE jsonb_typeof(module_permissions->'production') = 'array'
   AND (module_permissions->'production') ?| array['manage_recipe', 'approve_qa']
   AND NOT ((module_permissions->'production') ? 'view_recipe');

DO $chk$
DECLARE v_miss int;
BEGIN
  SELECT count(*) INTO v_miss FROM "JobTitle"
   WHERE jsonb_typeof(module_permissions->'production') = 'array'
     AND (module_permissions->'production') ?| array['manage_recipe', 'approve_qa']
     AND NOT ((module_permissions->'production') ? 'view_recipe');
  IF v_miss > 0 THEN RAISE EXCEPTION 'tự kiểm: % chức danh QA / khai định mức chưa có view_recipe', v_miss; END IF;
END $chk$;

COMMIT;
