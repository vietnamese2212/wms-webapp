-- SIẾT RLS FEED CÁ NHÂN — chỉ CHÍNH CHỦ đọc được (check-app 06/08 bắt tại chỗ).
--
-- Lỗ hổng đo thật: policy `rls_auth_select USING (true)` + vé realtime (`role=authenticated`,
-- `sub=<employee_id>`, ký bằng SUPABASE_JWT_SECRET) ⇒ BẤT KỲ user đăng nhập nào cầm anon key
-- (nằm sẵn trong bundle FE) gọi thẳng PostgREST đọc được TOÀN BỘ `user_notifications` của người
-- khác. API backend khoá đúng (B không thấy feed của A qua /notify/feed) nhưng đường Supabase
-- trực tiếp thì hở — app vài nghìn người dùng thì đây là rò thông tin giao việc toàn công ty.
--
-- Vá: policy so `employee_id = auth.uid()` — vé realtime mang sub = employee id nên khớp CHÍNH CHỦ.
-- Realtime KHÔNG chết: Supabase Realtime áp cùng policy SELECT, client vẫn nhận sự kiện dòng CỦA
-- MÌNH (đúng nhu cầu badge chuông) — chỉ mất khả năng nhìn trộm dòng người khác.
-- Backend dùng service role nên bypass RLS, mọi API giữ nguyên hành vi.
DROP POLICY IF EXISTS rls_auth_select ON user_notifications;
CREATE POLICY rls_own_select ON user_notifications
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid());
