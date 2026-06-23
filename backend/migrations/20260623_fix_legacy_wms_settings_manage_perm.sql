-- Dọn action CŨ 'manage' của wms_settings (cũ hơn cả 'manage_global', migration 20260621 không map tới).
-- 'manage' (cũ = "quản mọi thứ trong Cài đặt WMS") -> cấp đủ 5 quyền tab + giữ manage_zone + view.
-- Hiện chỉ chức danh "Quản lý kho NPP" còn dính: wms_settings = ["manage","manage_zone","view"].
-- Idempotent: chạy lại không đổi (lần 2 không còn 'manage').

UPDATE "JobTitle" jt
SET module_permissions = jsonb_set(
  jt.module_permissions,
  '{wms_settings}',
  new_perms.arr
)
FROM (
  SELECT j.id,
    to_jsonb(ARRAY(
      SELECT DISTINCT unnest(
        -- (1) giữ các action cũ, trừ 'manage'
        (SELECT COALESCE(array_agg(a), '{}')
           FROM jsonb_array_elements_text(j.module_permissions->'wms_settings') a
          WHERE a <> 'manage')
        -- (2) nếu cũ có 'manage' -> cấp đủ bộ tab mới
        || CASE WHEN j.module_permissions->'wms_settings' ? 'manage'
                THEN ARRAY['manage_warehouse','manage_type','manage_zone','manage_shift','manage_qa']
                ELSE '{}'::text[] END
        -- (3) luôn đảm bảo có 'view' (mở trang)
        || ARRAY['view']
      )
    )) AS arr
  FROM "JobTitle" j
  WHERE j.module_permissions ? 'wms_settings'
    AND j.module_permissions->'wms_settings' ? 'manage'
) new_perms
WHERE jt.id = new_perms.id;
