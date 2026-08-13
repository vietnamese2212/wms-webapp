-- 20260813f — Superadmin theo CỘT thay vì so TÊN (audit hardcode 13/08, nợ kỹ thuật CLAUDE.md).
-- Trước: superadmin = (name='Admin' OR employee_code='ADMIN') rải ~18 chỗ BE + FE isAdmin →
-- đổi tên hiển thị tài khoản là MẤT quyền âm thầm. Nay: cột is_superadmin là nguồn duy nhất,
-- authController nhét vào JWT, mọi điểm kiểm đọc cờ từ token.
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS is_superadmin boolean NOT NULL DEFAULT false;

UPDATE "Employee" SET is_superadmin = true
WHERE employee_code = 'ADMIN' OR name = 'Admin';

-- Gác an toàn: phải còn ÍT NHẤT 1 superadmin đang hoạt động, không thì cả hệ mất cửa quản trị.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "Employee" WHERE is_superadmin = true AND is_active = true;
  IF n = 0 THEN
    RAISE EXCEPTION 'Sau migration không có superadmin active nào — kiểm tra tài khoản Admin trước khi apply';
  END IF;
END $$;
