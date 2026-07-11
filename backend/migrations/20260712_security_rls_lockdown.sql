-- ════════════════════════════════════════════════════════════════════════════
-- 20260712_security_rls_lockdown.sql  —  ĐÓNG HẲN truy cập từ anon key
-- VÁ LỖ NGHIÊM TRỌNG: anon key (công khai trong bundle FE) hiện ĐỌC + GHI + XÓA
-- được MỌI bảng qua Supabase REST, bỏ qua backend. Bằng chứng (test sống 12/07):
-- GET Employee?select=password trả hash bcrypt 39 nhân viên; PATCH/DELETE trả 200.
--
-- KIẾN TRÚC: backend dùng SERVICE_ROLE (bỏ qua RLS + full grant) cho MỌI thao tác.
-- Frontend CHỈ dùng anon cho Realtime. Sau khi bật cơ chế "vé realtime" (JWT role
-- 'authenticated' do backend cấp — code đã deploy), Realtime chạy dưới role authenticated
-- → RLS cho phép authenticated đọc, CHẶN anon. Khách vãng lai (chỉ có anon key) đọc = 0 dòng.
--
-- ⚠️⚠️ THỨ TỰ APPLY (SAI THỨ TỰ = REALTIME CHẾT):
--   1. Code đã deploy (backend cấp realtime_token, FE setAuth).  ✅ (commit trên dev/main)
--   2. Thêm biến môi trường SUPABASE_JWT_SECRET vào Vercel (CẢ 2 deploy) — lấy ở
--      Supabase Dashboard → Project Settings → API → JWT Settings → "JWT Secret".
--      Redeploy để backend bắt đầu cấp vé. (Chưa có secret → FE tự dùng anon, chưa siết.)
--   3. Đăng nhập lại 1 lần, xác nhận realtime VẪN chạy (giờ qua vé authenticated).
--   4. MỚI chạy file SQL này (Dashboard → SQL Editor), CẢ 2 project:
--      staging bxxryrmpfabvjitqbdnw + production LOF svicyfquresxaigfxsdb.
--   5. Verify: anon key GET bảng bất kỳ → 401/rỗng; app đăng nhập vẫn realtime OK.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── PHẦN 1: CHẶN GHI/XÓA + EXECUTE cho anon + authenticated (mọi bảng) ─────────
-- Backend (service_role) không bị ảnh hưởng. Realtime chỉ đọc nên không đụng.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', r.tablename);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon, authenticated;
REVOKE USAGE, UPDATE ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM anon, authenticated;

-- ─── PHẦN 2: BẬT RLS + chặn ĐỌC của anon trên MỌI bảng ─────────────────────────
-- Mỗi bảng: enable RLS + thu hồi SELECT của anon. Bảng vận hành (cần realtime) → thêm
-- policy cho 'authenticated' đọc (vé realtime của user đăng nhập). Employee (hash mật
-- khẩu) → KHÔNG cấp cho cả authenticated + gỡ khỏi realtime → chỉ backend service_role đọc.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS rls_auth_select ON public.%I', r.tablename);
    IF r.tablename = 'Employee' THEN
      EXECUTE 'REVOKE SELECT ON public."Employee" FROM authenticated';   -- chỉ backend đọc
    ELSE
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', r.tablename);
      EXECUTE format('CREATE POLICY rls_auth_select ON public.%I FOR SELECT TO authenticated USING (true)', r.tablename);
    END IF;
  END LOOP;
  -- Employee ra khỏi publication realtime (không broadcast hash mật khẩu qua WAL)
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public."Employee";
  EXCEPTION WHEN undefined_object OR undefined_table THEN
    RAISE NOTICE 'Employee không trong publication, bỏ qua';
  END;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY SAU KHI APPLY (chạy bằng anon key — PHẢI 401/permission denied hoặc rỗng):
--   curl "$URL/rest/v1/InventoryEntry?select=*&limit=1" -H "apikey:$ANON" -H "Authorization:Bearer $ANON"
--   curl "$URL/rest/v1/Employee?select=password&limit=1"  -H "apikey:$ANON" -H "Authorization:Bearer $ANON"
--   → cả hai KHÔNG được trả dữ liệu.
-- Và mở app đã đăng nhập: realtime vẫn nhảy số (qua vé authenticated).
--
-- ROLLBACK (nếu realtime chết vì chưa kịp bật vé): tạm mở lại đọc cho anon —
--   DO $$ DECLARE r record; BEGIN
--     FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
--       EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
--       EXECUTE format('GRANT SELECT ON public.%I TO anon', r.tablename);
--     END LOOP; END $$;
--   (Employee vẫn nên giữ khóa — cấp lại SELECT anon cho Employee là mở lại lỗ hash.)
-- ════════════════════════════════════════════════════════════════════════════
