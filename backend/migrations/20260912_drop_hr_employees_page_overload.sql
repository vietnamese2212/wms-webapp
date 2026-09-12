-- ============================================================================
-- DỌN OVERLOAD CHẾT: `hr_employees_page` bản CŨ 9 tham số (`p_jt_name`).
--
-- VÌ SAO: staging đang có HAI hàm cùng tên sống song song —
--   cũ:  p_scope_ids, p_dept, p_jt_name, p_wh, p_search, p_active, p_incl_deleted, p_offset, p_limit
--   mới: p_scope_ids, p_dept, p_jt_id,   p_wh, p_search, p_active, p_incl_deleted, p_status, p_offset, p_limit
-- Bản mới lọc theo ID chức danh (không so TÊN) và có thêm `p_status`. Bản cũ sót lại vì migration
-- trước dùng CREATE OR REPLACE — lệnh đó chỉ thay bản TRÙNG chữ ký, thêm/bớt tham số là ĐẺ overload.
--
-- NGUY HIỂM Ở ĐÂU: PostgREST phân giải hàm theo **TẬP TÊN THAM SỐ** trong body, không theo thứ tự.
-- Hôm nay `employeeController` gửi đủ `p_jt_id`+`p_status` nên trúng bản mới. Nhưng chỉ cần một lời
-- gọi sau này quên `p_status` là rơi trúng bản CŨ: không lỗi, không cảnh báo, màn Nhân sự lặng lẽ
-- quay về hành vi phiên bản trước (mất bộ lọc trạng thái, lọc chức danh so theo TÊN nên đổi tên chức
-- danh là hỏng âm thầm). ĐÃ DÍNH ĐÚNG LỚP LỖI NÀY 11/09 với `outbound_date_rule_lines` — màn Quy
-- định date rơi về bản cũ, mất bộ lọc, không ai thấy gì sai.
-- Overload còn rò vào `backend/src/types/database.ts`: RPC này sinh ra kiểu Args dạng UNION hai chữ ký.
--
-- AN TOÀN: đã kiểm cả backend (`grep hr_employees_page`) — chỉ MỘT nơi gọi, và gọi bằng `p_jt_id`.
-- FE không gọi RPC trực tiếp (anon/authenticated có 0 quyền EXECUTE từ 02/09).
--
-- CÁCH CHẠY: Supabase Dashboard → SQL Editor (STAGING trước, production khi cutover).
-- ============================================================================

DROP FUNCTION IF EXISTS public.hr_employees_page(
  text[],     -- p_scope_ids
  text,       -- p_dept
  text,       -- p_jt_name   ← đây là thứ phân biệt bản CŨ
  text,       -- p_wh
  text,       -- p_search
  text,       -- p_active
  boolean,    -- p_incl_deleted
  integer,    -- p_offset
  integer     -- p_limit
);

-- KIỂM SAU KHI CHẠY — phải trả về ĐÚNG 1 dòng (bản 10 tham số có p_jt_id + p_status):
--   SELECT pg_get_function_identity_arguments(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'hr_employees_page';
--
-- QUÉT ĐỊNH KỲ overload cùng loại (chỉ `unaccent` được phép có 2 bản — của extension):
--   SELECT p.proname, count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.prokind='f' GROUP BY 1 HAVING count(*) > 1;
