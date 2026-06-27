-- Dọn quyền CHẾT của module loosepicking: create/start/cancel KHÔNG có route/nút nào
-- enforce (nhặt lẻ tạo/bắt đầu/hủy đều qua Outbound). Chỉ giữ view/scan/complete.
-- Idempotent: chạy lại không đổi khi đã sạch.
UPDATE "JobTitle"
SET module_permissions = jsonb_set(
  module_permissions,
  '{loosepicking}',
  (
    SELECT COALESCE(jsonb_agg(x), '[]'::jsonb)
    FROM jsonb_array_elements_text(module_permissions->'loosepicking') AS x
    WHERE x IN ('view', 'scan', 'complete')
  )
)
WHERE module_permissions ? 'loosepicking'
  AND (module_permissions->'loosepicking') ?| array['create', 'start', 'cancel'];
