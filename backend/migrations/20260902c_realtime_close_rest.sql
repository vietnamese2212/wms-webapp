-- ============================================================================
-- 20260902c — ĐÓNG CỬA ĐỌC PostgREST CỦA authenticated/anon (PHA 2 — chạy SAU khi frontend
--             đã nghe Broadcast và đã xác minh sống trên môi trường tương ứng)
-- ============================================================================
-- Điều kiện trước khi chạy: 20260902b đã apply + bundle FE mới (broadcast) đã lên + kiểm 2 phiên
-- thấy số nhảy. Chạy sớm hơn = realtime tắt cho bundle cũ tới khi người dùng tải lại trang
-- (không mất dữ liệu, chỉ số đứng im).
--
-- Sau pha này, cầm vé realtime gọi PostgREST → 0 dòng ở MỌI bảng; RPC nghiệp vụ (SECURITY INVOKER)
-- gọi bằng vé cũng chết ở câu SELECT đầu tiên. Gói QA 00 gác bằng RPC rest_exposure() = 3 mảng rỗng.
-- Đường lui: 20260902c_realtime_close_rest_ROLLBACK.sql (publication giữ nguyên nên quay lại tức thì).
-- ============================================================================

-- 1. Xoá MỌI policy SELECT cho authenticated trong public (56 `rls_auth_select` + 7 `*_read` +
--    `rls_own_select`): chúng tồn tại CHỈ để postgres_changes chịu gửi sự kiện — nay không còn lý do.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND (roles::text LIKE '%authenticated%' OR roles::text LIKE '%anon%' OR roles::text LIKE '%public%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    RAISE NOTICE 'đã xoá policy %.% (%)', p.tablename, p.policyname, p.schemaname;
  END LOOP;
END $$;

-- 2. Thu hồi MỌI quyền bảng/sequence của anon + authenticated (gồm cả TRUNCATE/REFERENCES/TRIGGER
--    mà default ACL cũ cấp nhầm — TRUNCATE không chịu RLS, là mìn chờ).
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- 3. CHỐT GỐC RỄ: bảng/sequence tạo SAU không tự nhận quyền cho 2 vai này nữa. Trước đây migration
--    20260712 chỉ REVOKE INSERT/UPDATE/DELETE ở tầng default nên mỗi bảng mới vẫn nhận SELECT+TRUNCATE
--    — quên bật RLS ở một bảng mới là rò ra Internet ngay lập tức.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- (Không đụng EXECUTE của hàm public: 113 RPC vẫn PUBLIC-executable nhưng đều SECURITY INVOKER ⇒
--  chạy dưới vai gọi = chết ở SELECT đầu tiên. Thu hồi EXECUTE phải GRANT lại service_role đúng
--  từng hàm — việc riêng, làm sau khi đã đo, kẻo gãy backend.)
