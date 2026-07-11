-- ════════════════════════════════════════════════════════════════════════════
-- 20260712_security_rls_lockdown.sql
-- VÁ LỖ NGHIÊM TRỌNG: anon key (công khai trong bundle FE) hiện ĐỌC + GHI + XÓA
-- được MỌI bảng qua Supabase REST, bỏ qua toàn bộ backend + phân quyền.
-- Bằng chứng (test sống 12/07 trên staging): GET Employee?select=password trả hash
-- bcrypt của cả 39 nhân viên; PATCH/DELETE trả 200 (RLS không chặn).
--
-- KIẾN TRÚC: backend dùng SERVICE_ROLE (bỏ qua RLS + có full grant) cho MỌI thao tác.
-- Frontend CHỈ dùng anon key cho Realtime (không query bảng trực tiếp — đã xác nhận).
-- ⇒ Thu hồi quyền của anon/authenticated KHÔNG ảnh hưởng backend.
--
-- ⚠️ APPLY CẢ 2 PROJECT: staging (bxxryrmpfabvjitqbdnw) + production LOF
--    (svicyfquresxaigfxsdb) qua Supabase Dashboard → SQL Editor. Chạy nguyên file.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── PHẦN 1: CHẶN GHI/XÓA cho anon + authenticated trên MỌI bảng ───────────────
-- Đây là phần đóng lỗ THẢM HOẠ (giả mạo/leo thang/xóa dữ liệu). Realtime chỉ ĐỌC
-- nên KHÔNG bị ảnh hưởng. Backend (service_role) giữ nguyên toàn quyền.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', r.tablename);
  END LOOP;
END $$;

-- Bảng tạo trong tương lai cũng mặc định KHÔNG cấp ghi cho anon/authenticated
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon, authenticated;

-- Thu hồi quyền GHI trên sequence (chống lách qua nextval nếu có)
REVOKE USAGE, UPDATE ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Thu hồi EXECUTE mọi function/RPC khỏi anon/authenticated (backend gọi bằng service_role).
-- FE không gọi RPC trực tiếp; RPC nhạy cảm (book_vehicle_slot, adjust…) chỉ backend dùng.
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM anon, authenticated;

-- ─── PHẦN 2: KHÓA HẲN bảng chứa CREDENTIAL ─────────────────────────────────────
-- CHỈ Employee — chứa HASH MẬT KHẨU (bcrypt). Đây là thứ DUY NHẤT bắt buộc giấu khỏi
-- anon: lộ hash + mật khẩu ngắn = crack offline → đăng nhập thật.
-- Các bảng khác (Attendance/LeaveRequest/UserWarehouseAccess…) là DỮ LIỆU NGHIỆP VỤ nội
-- bộ, KHÔNG phải credential — không nguy hiểm hơn tồn kho/đơn hàng (vốn đã anon-readable
-- để giữ realtime). Giữ realtime cho chúng cho nhất quán; đã chặn GHI ở Phần 1 nên không
-- ai sửa được. (Muốn giấu TẤT CẢ dữ liệu nghiệp vụ khỏi anon = fix gốc: realtime dùng
-- token tương thích Supabase-Auth, mini-project sau.)
-- FE bù realtime cho Employee (đã gỡ) bằng POLLING useEmployeeRecords 60s.
DO $$
DECLARE t text;
DECLARE sensitive text[] := ARRAY['Employee'];
BEGIN
  FOREACH t IN ARRAY sensitive LOOP
    -- gỡ khỏi realtime (bỏ qua nếu chưa có trong publication)
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    EXCEPTION WHEN undefined_object OR undefined_table THEN
      RAISE NOTICE 'Bảng % không trong publication, bỏ qua', t;
    END;
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- KIỂM TRA SAU KHI APPLY (chạy bằng anon key — PHẢI thất bại/rỗng):
--   curl "$URL/rest/v1/Employee?select=password&limit=1" -H "apikey:$ANON" -H "Authorization:Bearer $ANON"
--     → phải trả 401/permission denied (KHÔNG còn hash).
--   curl -X PATCH "$URL/rest/v1/InventoryEntry?id=eq.<bất kỳ>" -H ... -d '{"cartons_remaining":0}'
--     → phải trả 401/permission denied (KHÔNG còn ghi được).
--
-- NỢ CÒN LẠI (không đóng được trong hotfix này vì đang dùng JWT tự ký, không tương
-- thích RLS auth của Supabase, và FE subscribe realtime table:'*'):
--   anon vẫn ĐỌC được các bảng VẬN HÀNH (InventoryEntry, TmsOrder, Location…) để
--   realtime chạy. Đây là dữ liệu nghiệp vụ (không phải credential) và vốn đã đọc
--   được bởi mọi user đăng nhập qua các route "hở đọc". Fix triệt để = chuyển realtime
--   sang token tương thích Supabase-Auth (setAuth) + policy theo auth.uid(), hoặc dùng
--   Realtime Broadcast có kiểm quyền — là mini-project, làm sau.
-- ════════════════════════════════════════════════════════════════════════════
