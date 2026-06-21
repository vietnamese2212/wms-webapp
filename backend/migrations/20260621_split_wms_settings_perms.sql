-- Tách quyền wms_settings: manage_global -> manage_warehouse/manage_type/manage_zone/manage_shift/manage_qa.
-- Ánh xạ quyền CŨ -> MỚI cho mọi JobTitle để KHÔNG ai mất quyền:
--   * Có 'manage_global' (cũ) -> cấp đủ 5 quyền tab + view, bỏ 'manage_global'.
--   * Có 'manage_zone' (cũ, vẫn hợp lệ) -> giữ nguyên.
--   * Mọi JobTitle có wms_settings -> đảm bảo có 'view' (để mở được trang).
-- Idempotent: chạy lại không đổi kết quả (lần 2 không còn manage_global).

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
        -- (1) giữ các action cũ, trừ 'manage_global'
        (SELECT COALESCE(array_agg(a), '{}')
           FROM jsonb_array_elements_text(j.module_permissions->'wms_settings') a
          WHERE a <> 'manage_global')
        -- (2) nếu cũ có manage_global -> cấp đủ bộ tab mới
        || CASE WHEN j.module_permissions->'wms_settings' ? 'manage_global'
                THEN ARRAY['manage_warehouse','manage_type','manage_zone','manage_shift','manage_qa']
                ELSE '{}'::text[] END
        -- (3) luôn đảm bảo có 'view' (mở trang)
        || ARRAY['view']
      )
    )) AS arr
  FROM "JobTitle" j
  WHERE j.module_permissions ? 'wms_settings'
) new_perms
WHERE jt.id = new_perms.id;
