-- Dọn key module MỒ CÔI trong JobTitle.module_permissions: 'tms', 'vehicles', 'schedule'
-- KHÔNG có trong MODULES/ALL_PERMISSIONS + KHÔNG route nào requirePerm chúng → grant CHẾT (vô hại nhưng bẩn).
-- Xóa key jsonb bằng toán tử `-`. An toàn: chỉ bỏ 3 key này, giữ nguyên phần còn lại.
UPDATE "JobTitle"
SET module_permissions = (module_permissions - 'tms' - 'vehicles' - 'schedule'),
    updated_at = now()
WHERE module_permissions ?| array['tms','vehicles','schedule'];

-- Kiểm sau khi apply (phải trả 0 dòng):
-- SELECT name FROM "JobTitle" WHERE module_permissions ?| array['tms','vehicles','schedule'];
