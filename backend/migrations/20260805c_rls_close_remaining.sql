-- 20260805c — Đóng RLS các bảng còn sót (cảnh báo Supabase 03/08: rls_disabled_in_public,
-- CẢ 2 project staging + production LOF)
--
-- Audit 12/07 đã đóng RLS toàn bộ; các bảng này là SÓT SAU ĐÓ: StocktakeLog (nghiệp vụ,
-- đang phát realtime), base_unit_flip_round_report (báo cáo chiến dịch flip), và các bảng
-- backup x_bak_* / x_flip_bak_* (giữ để rollback các đợt migration). Không bật RLS = ai có
-- URL project + anon key đọc/sửa/xóa được toàn bộ dữ liệu bảng đó.
--
-- Cách đóng: bật RLS trên MỌI bảng public còn tắt (vòng lặp ĐỘNG — staging và production có
-- bộ bảng sót khác nhau, một migration chạy đúng cả hai). Backend dùng service role nên
-- BYPASS RLS — không đổi hành vi app. Bảng không policy = đóng kín với anon/authenticated
-- (đúng chủ đích, như ApiKey/error_logs).
--
-- NGOẠI LỆ BẮT BUỘC: StocktakeLog nằm trong TABLE_QUERY_MAP (realtime màn Kiểm kê) — bật RLS
-- mà không có policy SELECT cho authenticated là realtime chết CÂM (bài học weigh_ticket
-- 20260716 + forklift 20260801e; bất biến realtime_readiness gói 00 đang gác đúng ca này).

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'StocktakeLog'
                   AND policyname = 'rls_auth_select') THEN
    CREATE POLICY rls_auth_select ON public."StocktakeLog"
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- Gác: sau migration này KHÔNG được còn bảng public nào tắt RLS
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF n > 0 THEN
    RAISE EXCEPTION 'Van con % bang public chua bat RLS', n;
  END IF;
END $$;

-- Lưới gác VĨNH VIỄN (luật bug-chết-hai-lần): RPC liệt kê bảng public đang tắt RLS — bất biến
-- gói QA 00 gọi mỗi lượt chạy, bảng MỚI nào quên bật RLS là đỏ trong ngày thay vì chờ email
-- Supabase. SECURITY DEFINER để đọc được pg_class; REVOKE anon/authenticated (biết danh sách
-- bảng hở cũng là thông tin — chỉ service role của bộ QA được gọi).
CREATE OR REPLACE FUNCTION public.rls_gap_tables() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT COALESCE(array_agg(c.relname ORDER BY c.relname), '{}')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
$$;
REVOKE EXECUTE ON FUNCTION public.rls_gap_tables() FROM PUBLIC, anon, authenticated;
