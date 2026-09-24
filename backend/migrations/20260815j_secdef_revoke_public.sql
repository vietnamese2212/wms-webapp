-- BẢO MẬT — ĐÓNG các RPC đang mở cho ANON (khoá anon nằm CÔNG KHAI trong bundle FE).
--
-- ĐO THẬT 15/08 bằng chính anon key, qua PostgREST:
--   POST /rest/v1/rpc/packing_logs_recon         → HTTP 200 + dữ liệu nghiệp vụ THẬT
--       (id pallet, id trang sổ, id NGƯỜI đóng gói, trạng thái…)
--   POST /rest/v1/rpc/alerts_packing_unreceived  → HTTP 200 + id kho + số liệu
--   POST /rest/v1/rpc/packing_open_run           → HTTP 400 "PACKOPEN:Nhập Máy"
--       ⇒ lỗi NGHIỆP VỤ, tức hàm ĐÃ CHẠY QUA tầng quyền: payload đầy đủ là anon TẠO ĐƯỢC trang sổ.
--   POST /rest/v1/rpc/realtime_readiness         → HTTP 200 + bản đồ TOÀN BỘ bảng kèm trạng thái RLS
--   POST /rest/v1/rpc/rpc_source                 → (đã vá ở 20260815i) trả nguyên văn mã mọi hàm
--
-- VÌ SAO LỌT: Postgres mặc định cấp EXECUTE cho PUBLIC trên mọi hàm mới; `GRANT ... TO service_role`
-- chỉ THÊM quyền chứ không thu hồi mặc định. Hàm SECURITY DEFINER còn nguy hơn — nó chạy bằng quyền
-- CHỦ SỞ HỮU nên **RLS không chặn được gì**, tức lá chắn RLS của cả app vô hiệu ngay tại đó.
--
-- AN TOÀN KHI THU HỒI: frontend KHÔNG gọi `supabase.rpc(` ở bất kỳ đâu (mọi thứ đi qua API app,
-- backend dùng service_role). Đã grep xác nhận trước khi viết migration này.

BEGIN;

DO $$
DECLARE r record;
BEGIN
  -- 1) MỌI hàm SECURITY DEFINER trong public: cấm PUBLIC/anon/authenticated.
  --    Đây là lớp nguy hiểm nhất — bỏ qua RLS nên hở là ra dữ liệu thật.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;

  -- 2) Các hàm tiện ích ĐỌC CATALOG / phục vụ bộ QA — không chạm bảng có RLS nên RLS không che.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN ('realtime_readiness', 'rpc_source', 'weigh_ticket_warehouses')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- ─── LƯỚI GÁC: liệt kê hàm SECURITY DEFINER còn hở cho PUBLIC/anon ──────────
-- Bất biến QA gọi hàm này; thêm hàm SECURITY DEFINER mới mà quên REVOKE = ĐỎ ngay, không chờ ai nhớ.
-- (Bản thân hàm này cũng bị thu hồi khỏi PUBLIC ở dưới — không thì nó lại là cửa sổ mới.)
CREATE OR REPLACE FUNCTION public.secdef_public_grants()
RETURNS TABLE (fn text, grantee text)
LANGUAGE sql
STABLE
AS $$
  SELECT p.oid::regprocedure::text,
         CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
  WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
    AND a.privilege_type = 'EXECUTE'
    AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))
$$;

REVOKE ALL ON FUNCTION public.secdef_public_grants() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secdef_public_grants() TO service_role;

COMMIT;
