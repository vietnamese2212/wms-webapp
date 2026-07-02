-- Dọn action inbound_plan lỗi thời khỏi JobTitle.module_permissions.
-- create/delete/cancel đã BỎ khỏi hệ phân quyền (02/07/2026) — mồ côi, không UI nào dùng;
-- các thao tác đó đi theo tms_plan.upload_inbound / tms_plan.edit. Chỉ giữ view + edit.
-- (Hiện 1 chức danh "Giám sát kho TP" đang giữ đủ 5 action.)
BEGIN;

UPDATE "JobTitle"
SET module_permissions = jsonb_set(
  module_permissions,
  '{inbound_plan}',
  (
    SELECT coalesce(jsonb_agg(a), '[]'::jsonb)
    FROM jsonb_array_elements_text(module_permissions -> 'inbound_plan') AS t(a)
    WHERE t.a IN ('view', 'edit')
  )
),
    updated_at = now()
WHERE module_permissions ? 'inbound_plan';

COMMIT;
