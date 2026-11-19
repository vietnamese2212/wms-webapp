-- 19/11 (c) — ĐỔI MẬT KHẨU THÌ PHIÊN CŨ HẾT HIỆU LỰC (user: "đổi pass Hà Thị Thu Hương nhưng mà đăng nhập cũ vẫn được").
-- Đo staging: QA0001 đăng nhập 09:23, admin đặt mật khẩu mới 10:36, không có lần đăng nhập nào sau đó — phiên mở từ 09:23
-- vẫn chạy vì token JWT không trạng thái và /auth/me còn cấp token MỚI mỗi 5 phút (phiên sống mãi khi còn dùng).
-- Mốc `password_changed_at` do TRIGGER đặt ⇒ MỌI cửa ghi mật khẩu (admin đặt · tự đổi · cửa sau này) cùng một luật.
-- /auth/me từ chối token phát TRƯỚC mốc này (401 PASSWORD_CHANGED) ⇒ máy đang mở bị đăng xuất ở lần làm mới kế tiếp.
-- Chạy lại được.
BEGIN;

ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
COMMENT ON COLUMN "Employee".password_changed_at IS 'Lúc mật khẩu đổi lần cuối (trigger) — token phát trước mốc này bị /auth/me từ chối';

CREATE OR REPLACE FUNCTION public.employee_password_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.password IS DISTINCT FROM OLD.password THEN NEW.password_changed_at := now(); END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.employee_password_changed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_employee_password_changed ON "Employee";
CREATE TRIGGER trg_employee_password_changed BEFORE UPDATE OF password ON "Employee"
  FOR EACH ROW EXECUTE FUNCTION public.employee_password_changed();

-- Điền mốc cho lần admin đặt mật khẩu GẦN NHẤT đã ghi sổ quản trị (vd QA0001 10:36 hôm nay): phiên mở trước lần đặt đó
-- lẽ ra đã phải hết hiệu lực. Lần tự đổi trước đây không ghi sổ ⇒ để trống (không đoán).
UPDATE "Employee" e SET password_changed_at = x.at
  FROM (SELECT target_id, max(created_at) AS at FROM admin_audit_events WHERE action = 'PASSWORD_SET' AND target_type = 'Employee' GROUP BY target_id) x
 WHERE e.id = x.target_id AND e.password_changed_at IS NULL;

COMMIT;
