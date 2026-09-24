-- ============================================================================
-- LƯỚI GÁC: không hàm public nào được có NHIỀU HƠN MỘT bản (overload).
--
-- VÌ SAO (luật "bug chết hai lần" cho lớp lỗi đã cắn 2 lần):
--   • 11/09 `outbound_date_rule_lines` có 2 bản (10 và 12 tham số) — màn Quy định date lặng lẽ
--     rơi về bản cũ, mất bộ lọc, không lỗi không cảnh báo.
--   • 12/09 `hr_employees_page` có 2 bản (`p_jt_name` cũ ⟂ `p_jt_id`+`p_status` mới).
-- Gốc chung: `CREATE OR REPLACE FUNCTION` chỉ thay bản TRÙNG chữ ký; thêm/bớt một tham số là ĐẺ
-- thêm hàm chứ không thay. Và PostgREST phân giải theo **TẬP TÊN THAM SỐ** trong body, không theo
-- thứ tự — nên một lời gọi quên tham số mới là trúng bản cũ, im lặng tuyệt đối.
-- Thêm tham số có DEFAULT KHÔNG cứu được: bản cũ vẫn khớp khi lời gọi không nhắc tên tham số mới.
--
-- Trả 0 dòng = sạch. Gói QA 00-invariant gọi hàm này mỗi lượt chạy, nên lần sau ai quên DROP bản cũ
-- là ĐỎ ngay tại chỗ, không phải chờ một màn hình nào đó hỏng rồi mới đi tìm.
--
-- MIỄN TRỪ: `unaccent` — extension `unaccent` cố ý có 2 bản (text) và (regdictionary, text).
-- Thêm miễn trừ mới phải kèm lý do ở đây, đừng nới lưới trong gói QA.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.function_overloads()
 RETURNS TABLE(fn text, n bigint, chu_ky text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.proname::text,
         count(*),
         string_agg(pg_get_function_identity_arguments(p.oid), '  ||  ' ORDER BY p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prokind = 'f'
     AND p.proname <> 'unaccent'          -- của extension, hợp lệ
   GROUP BY p.proname
  HAVING count(*) > 1
   ORDER BY 1;
$function$;

REVOKE ALL ON FUNCTION public.function_overloads() FROM PUBLIC, anon, authenticated;

-- KIỂM SAU KHI CHẠY:  SELECT * FROM public.function_overloads();   -- phải 0 dòng
