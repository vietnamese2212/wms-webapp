-- 2026-06-19 — Dọn action quyền KHÔNG hợp lệ "delete" khỏi JobTitle.module_permissions['inbound'].
-- Action inbound hợp lệ KHÔNG có "delete" (chỉ có delete_pallet / force_delete_pallet — xem
-- backend/src/config/permissions.ts). "delete" là quyền cũ lỗi thời, không gate gì, gây nhiễu khi
-- xem/cấp quyền. Dính 2 chức danh: "Giám sát kho NVL", "Giám sát kho TP".
-- Giữ nguyên các action khác (scan, edit_pallet, force_edit_pallet, ...).

UPDATE "JobTitle"
SET module_permissions = jsonb_set(
  module_permissions,
  '{inbound}',
  COALESCE((
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(module_permissions->'inbound') AS elem
    WHERE elem <> '"delete"'::jsonb
  ), '[]'::jsonb),
  false
)
WHERE module_permissions ? 'inbound'
  AND module_permissions->'inbound' @> '["delete"]'::jsonb;

-- Kiểm tra sau khi chạy (kỳ vọng: 0 dòng):
--   SELECT name FROM "JobTitle" WHERE module_permissions->'inbound' @> '["delete"]'::jsonb;
