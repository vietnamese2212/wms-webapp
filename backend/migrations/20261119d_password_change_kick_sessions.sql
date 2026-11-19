-- 19/11 (d) — ĐỔI MẬT KHẨU ⇒ ĐÁ NGAY mọi máy đang mở tài khoản (user: "đổi pass thì đá các đăng nhập ra và bắt đăng nhập lại").
-- Bản (c) chỉ chặn ở lần làm mới phiên kế tiếp (tải trang / mỗi 5 phút). Nay trigger đặt mốc còn PHÁT tín hiệu
-- {table:'session', op:'REVOKE'} lên kênh Broadcast CÁ NHÂN `wms-user-<id>` (kênh đã có của thông báo đích danh,
-- chỉ đúng người đó nghe được) ⇒ mọi máy đang mở kiểm lại phiên ngay: token phát trước lần đổi ⇒ 401 ⇒ về trang đăng nhập.
-- Tín hiệu ghi vào realtime.messages trong CÙNG giao dịch ⇒ đổi mật khẩu bị huỷ thì không phát. Lỗi phát KHÔNG chặn đổi mật khẩu.
-- Chạy lại được.
BEGIN;

CREATE OR REPLACE FUNCTION public.employee_password_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'realtime' AS $$
BEGIN
  IF NEW.password IS DISTINCT FROM OLD.password THEN
    NEW.password_changed_at := now();
    BEGIN
      PERFORM realtime.send(jsonb_build_object('table', 'session', 'op', 'REVOKE'), 'db_change', 'wms-user-' || NEW.id::text, true);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'employee_password_changed: không phát được tín hiệu đá phiên (%) — máy cũ vẫn bị chặn ở lần làm mới kế tiếp', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.employee_password_changed() FROM PUBLIC, anon, authenticated;

COMMIT;
