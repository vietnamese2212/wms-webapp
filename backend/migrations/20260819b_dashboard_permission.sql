-- 19/08/2026 — Thêm quyền dashboard.view (trang Tổng quan trước nay MỞ cho mọi user đăng nhập).
-- Luật "mặc định cờ mới = giá trị đang chạy": backfill CẤP quyền cho MỌI chức danh để hành vi
-- không đổi ngày apply; admin muốn siết thì gỡ per chức danh trong trình phân quyền.
BEGIN;

UPDATE "JobTitle"
SET module_permissions = jsonb_set(
      COALESCE(module_permissions, '{}'::jsonb),
      '{dashboard}', '["view"]'::jsonb, true),
    updated_at = now()
WHERE COALESCE(module_permissions, '{}'::jsonb) -> 'dashboard' IS NULL;

-- Gác an toàn: sau backfill không còn chức danh nào thiếu key dashboard
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "JobTitle"
  WHERE COALESCE(module_permissions, '{}'::jsonb) -> 'dashboard' IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'backfill dashboard.view thiếu % chức danh', n; END IF;
END $$;

COMMIT;
