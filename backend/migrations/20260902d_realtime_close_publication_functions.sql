-- ============================================================================
-- 20260902d — ĐÓNG NỐT 2 CỬA CÒN LẠI của anon/authenticated (kiểm định độc lập sau pha 2, 02/09 tối)
-- ============================================================================
-- Đo bằng anon key + vé realtime sau 20260902c: REST bảng 0/86 · REST ghi 403 · GraphQL tắt · OpenAPI 401 ·
-- Storage rỗng · Auth signup tắt · token giả 401 · kênh riêng tư đúng. Còn đúng 2 chỗ:
--
-- (1) postgres_changes (cơ chế CŨ): 73 bảng vẫn nằm trong publication `supabase_realtime` ⇒ CẢ ANON (khoá
--     công khai trong bundle) subscribe `schema=public` vẫn SUBSCRIBED và nhận sự kiện
--     {table:"Warehouse", eventType:"UPDATE", new:{}, old:{}, errors:["Error 401: Unauthorized"]}.
--     Không lộ cột nào (không còn quyền SELECT) nhưng người ngoài vẫn biết BẢNG NÀO ĐỔI LÚC NÀO, và Realtime
--     vẫn decode WAL + kiểm RLS cho 73 bảng vô ích. ⇒ Bỏ hết bảng khỏi publication; bảng mới không add nữa
--     (broadcast từ trigger không dùng publication này — realtime.messages đi publication riêng của Supabase).
--
-- (2) RPC: 113 hàm public còn EXECUTE cho PUBLIC ⇒ vé/anon gọi được. Hôm nay đều SECURITY INVOKER nên chết ở
--     SELECT (đo: 88 hàm 42501), nhưng 7 hàm chạy tới cùng (validate sớm / thuần tính toán) và hàm
--     SECURITY DEFINER tạo SAU sẽ hở NGAY vì Postgres mặc định cấp EXECUTE cho PUBLIC. ⇒ Thu EXECUTE của hàm
--     app (chủ postgres) về postgres + service_role; sửa DEFAULT PRIVILEGES để hàm MỚI không tự mở — phải làm
--     TOÀN CỤC vì docs Postgres: "you cannot revoke privileges per-schema if they are granted globally".
--     Hàm extension (pg_trgm/unaccent, chủ supabase_admin) không thu được và cũng chỉ là hàm văn bản thuần.
--
-- Gate: rest_exposure() thêm pub_tables · func_execs · func_default_public_exec — gói QA 00 mục 10c bắt rỗng/false.
-- Đường lui: 20260902d_realtime_close_publication_functions_ROLLBACK.sql (chỉ cần khi quay về postgres_changes,
-- đi cùng 20260902c_…_ROLLBACK.sql).
-- ============================================================================

-- 1. Publication supabase_realtime → rỗng.
DO $$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' LOOP
    EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE %I.%I', t.schemaname, t.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'đã bỏ % bảng khỏi publication supabase_realtime', n;
END $$;

-- 2. Bảng MỚI: chỉ gắn trigger broadcast, KHÔNG add publication nữa.
CREATE OR REPLACE FUNCTION public._auto_add_table_to_realtime() RETURNS event_trigger
LANGUAGE plpgsql AS $$
DECLARE obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF obj.command_tag = 'CREATE TABLE' AND obj.schema_name = 'public' THEN
      EXECUTE format('CREATE TRIGGER trg_wms_notify AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %s '
                     'FOR EACH STATEMENT EXECUTE FUNCTION public.wms_notify_change()', obj.object_identity);
    END IF;
  END LOOP;
END $$;

-- 3. Hàm app trong public: EXECUTE chỉ còn postgres (chủ) + service_role (backend qua PostgREST).
--    Trigger function không cần EXECUTE lúc fire (đã chứng minh với wms_notify_change từ 20260902b).
DO $$
DECLARE f record; n int := 0;
BEGIN
  FOR f IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p', 'a')
      AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON ROUTINE %I.%I(%s) FROM PUBLIC, anon, authenticated', f.nspname, f.proname, f.args);
    EXECUTE format('GRANT  EXECUTE ON ROUTINE %I.%I(%s) TO service_role', f.nspname, f.proname, f.args);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'đã thu EXECUTE khỏi PUBLIC/anon/authenticated + cấp service_role cho % hàm public', n;
END $$;

-- 4. GỐC RỄ: hàm MỚI do postgres tạo không tự mở cho PUBLIC. Dòng toàn cục bỏ PUBLIC; dòng per-schema public
--    (đã có sẵn: postgres + service_role) cộng thêm → hàm mới trong public = postgres + service_role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT  EXECUTE ON FUNCTIONS TO service_role;

-- 5. Gate mở rộng: 3 mảng cũ + publication + hàm gọi được + default EXECUTE toàn cục.
CREATE OR REPLACE FUNCTION public.rest_exposure() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'table_privs', COALESCE((
      SELECT jsonb_agg(x ORDER BY x) FROM (
        SELECT c.relname || ':' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
               || ':' || a.privilege_type AS x
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
          AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))
      ) s), '[]'::jsonb),
    'policies', COALESCE((
      SELECT jsonb_agg(p.tablename || ':' || p.policyname ORDER BY p.tablename, p.policyname)
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND (p.roles::text LIKE '%anon%' OR p.roles::text LIKE '%authenticated%' OR p.roles::text LIKE '%public%')
    ), '[]'::jsonb),
    'default_acl', COALESCE((
      SELECT jsonb_agg(pg_get_userbyid(d.defaclrole) || ':' || d.defaclobjtype::text || ':' || a.privilege_type
                       || '→' || pg_get_userbyid(a.grantee))
      FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE n.nspname = 'public' AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
        AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
    ), '[]'::jsonb),
    -- (20260902d) bảng còn trong publication supabase_realtime — phải RỖNG (postgres_changes hết đường)
    'pub_tables', COALESCE((
      SELECT jsonb_agg(pt.schemaname || '.' || pt.tablename ORDER BY pt.tablename)
      FROM pg_publication_tables pt WHERE pt.pubname = 'supabase_realtime'
    ), '[]'::jsonb),
    -- (20260902d) hàm public (không tính hàm của extension) mà anon/authenticated gọi được — phải RỖNG
    'func_execs', COALESCE((
      SELECT jsonb_agg(x ORDER BY x) FROM (
        SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
               || CASE WHEN p.prosecdef THEN ' SECURITY DEFINER' ELSE '' END AS x
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p', 'a')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
          AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      ) s), '[]'::jsonb),
    -- (20260902d) hàm MỚI do postgres tạo có tự mở EXECUTE cho PUBLIC không — phải FALSE
    'func_default_public_exec', COALESCE((
      SELECT bool_or(a.grantee = 0)
      FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
        AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f'
    ), true)
  )
$$;
REVOKE EXECUTE ON FUNCTION public.rest_exposure() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rest_exposure() TO service_role;
