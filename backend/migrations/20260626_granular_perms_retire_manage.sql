-- Mịn hóa phân quyền: bỏ action gộp `manage` cho 5 module, thay bằng create/edit/delete.
-- Chuyển quyền chức danh non-admin đang giữ `manage` sang bộ action mịn tương ứng
-- để KHÔNG ai mất quyền sau khi deploy code mới.
--   tms_vehicle_types: manage -> create, edit            (không có route delete loại xe)
--   tms_slots / tms_companies / tms_vehicles: manage -> create, edit, delete
--   work_skill: manage -> create, edit, delete           (giữ nguyên view, assign)
--
-- Superadmin (name='Admin') KHÔNG bị ảnh hưởng (nhận ALL_PERMISSIONS lúc login).
-- Idempotent: chỉ chạm chức danh còn 'manage' ở module tương ứng.
-- SAU KHI APPLY: chức danh bị ảnh hưởng cần đăng nhập lại (perms resolve lúc login/me).

-- Helper pattern: (mảng - 'manage') || mảng action mịn, rồi dedupe.

UPDATE "JobTitle"
SET module_permissions = jsonb_set(
  module_permissions, '{tms_vehicle_types}',
  (SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements_text(
     (module_permissions->'tms_vehicle_types') - 'manage' || '["create","edit"]'::jsonb) AS v)
)
WHERE module_permissions ? 'tms_vehicle_types'
  AND (module_permissions->'tms_vehicle_types') ? 'manage';

UPDATE "JobTitle"
SET module_permissions = jsonb_set(
  module_permissions, '{tms_slots}',
  (SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements_text(
     (module_permissions->'tms_slots') - 'manage' || '["create","edit","delete"]'::jsonb) AS v)
)
WHERE module_permissions ? 'tms_slots'
  AND (module_permissions->'tms_slots') ? 'manage';

UPDATE "JobTitle"
SET module_permissions = jsonb_set(
  module_permissions, '{tms_companies}',
  (SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements_text(
     (module_permissions->'tms_companies') - 'manage' || '["create","edit","delete"]'::jsonb) AS v)
)
WHERE module_permissions ? 'tms_companies'
  AND (module_permissions->'tms_companies') ? 'manage';

UPDATE "JobTitle"
SET module_permissions = jsonb_set(
  module_permissions, '{tms_vehicles}',
  (SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements_text(
     (module_permissions->'tms_vehicles') - 'manage' || '["create","edit","delete"]'::jsonb) AS v)
)
WHERE module_permissions ? 'tms_vehicles'
  AND (module_permissions->'tms_vehicles') ? 'manage';

UPDATE "JobTitle"
SET module_permissions = jsonb_set(
  module_permissions, '{work_skill}',
  (SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements_text(
     (module_permissions->'work_skill') - 'manage' || '["create","edit","delete"]'::jsonb) AS v)
)
WHERE module_permissions ? 'work_skill'
  AND (module_permissions->'work_skill') ? 'manage';

-- Kiểm tra sau khi chạy (kỳ vọng 0 dòng):
-- SELECT name, module_permissions FROM "JobTitle"
-- WHERE (module_permissions->'tms_vehicle_types') ? 'manage'
--    OR (module_permissions->'tms_slots') ? 'manage'
--    OR (module_permissions->'tms_companies') ? 'manage'
--    OR (module_permissions->'tms_vehicles') ? 'manage'
--    OR (module_permissions->'work_skill') ? 'manage';
