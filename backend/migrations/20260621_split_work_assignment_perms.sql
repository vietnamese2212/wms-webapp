-- Tách quyền work_assignment: tab Layout + Quy tắc ca khỏi 'create'.
-- Ai đang có 'create' (tạo phiếu phân công) -> cấp thêm manage_layout + manage_shift_rules
-- để giữ nguyên khả năng quản Layout/Quy tắc ca như trước. Idempotent (DISTINCT).

UPDATE "JobTitle" jt
SET module_permissions = jsonb_set(
  jt.module_permissions,
  '{work_assignment}',
  (SELECT to_jsonb(ARRAY(
    SELECT DISTINCT unnest(
      (SELECT COALESCE(array_agg(a), '{}')
         FROM jsonb_array_elements_text(jt.module_permissions->'work_assignment') a)
      || ARRAY['manage_layout','manage_shift_rules']
    )
  )))
)
WHERE jt.module_permissions->'work_assignment' ? 'create';
