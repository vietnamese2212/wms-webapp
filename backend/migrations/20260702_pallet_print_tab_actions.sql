-- In tem pallet: tách quyền theo tab — thêm 2 action mới `history` (tab Lịch sử in)
-- + `audit` (tab Truy cứu). Trước đây ai có pallet_print.view đều thấy cả 4 tab
-- → cấp history+audit cho mọi chức danh đang có view để GIỮ NGUYÊN hành vi;
-- admin muốn siết thì gỡ trong trình phân quyền.

UPDATE "JobTitle"
SET module_permissions = jsonb_set(
      module_permissions,
      '{pallet_print}',
      (
        SELECT to_jsonb(array_agg(DISTINCT a))
        FROM (
          SELECT jsonb_array_elements_text(module_permissions->'pallet_print') AS a
          UNION SELECT 'history'
          UNION SELECT 'audit'
        ) t
      )
    ),
    updated_at = now()
WHERE module_permissions->'pallet_print' ? 'view';
