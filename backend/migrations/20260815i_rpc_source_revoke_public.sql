-- BẢO MẬT: đóng `rpc_source` với PUBLIC/anon.
--
-- LỖ RÒ THẬT, đo bằng ANON KEY qua PostgREST (khoá này nằm công khai trong bundle FE):
--   POST /rest/v1/rpc/rpc_source {"p_name":"scan_insert_pallet"}  →  HTTP 200 + NGUYÊN VĂN mã hàm.
-- Nghĩa là bất kỳ ai cũng đọc được toàn bộ logic nghiệp vụ, tên bảng/cột của MỌI hàm trong schema.
--
-- Vì sao lọt: Postgres mặc định cấp EXECUTE cho PUBLIC trên hàm mới; `GRANT ... TO service_role`
-- ở migration 20260815f chỉ THÊM quyền, KHÔNG thu hồi quyền mặc định. Các RPC khác vô tình an toàn
-- nhờ chạm bảng có RLS (anon bị 401 ở tầng bảng), còn hàm này đọc `pg_proc` — KHÔNG có RLS.
--
-- BÀI HỌC CHUNG: hàm nào KHÔNG chạm bảng có RLS thì RLS không bảo vệ được nó; phải REVOKE tay.

BEGIN;

REVOKE ALL ON FUNCTION public.rpc_source(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_source(text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_source(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_source(text) TO service_role;

COMMIT;
