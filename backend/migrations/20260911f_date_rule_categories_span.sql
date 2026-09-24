-- Khoảng HẠN DÙNG của từng loại hàng — để màn khai quy đổi SỐNG lúc người ta đang gõ.
--
-- Vì sao cần: gõ "≥ 60 %" cho FG02 thì phải hiện ngay "≈ còn 27–36 ngày", vì FG02 hạn dùng chỉ
-- 45–60 ngày nên mức chung 60 % NUỐT MẤT yêu cầu 35 ngày mà không ai thấy gì sai. Không có con số
-- này thì câu cảnh báo không dựng được, và người khai chỉ phát hiện sau khi xe đã đi.

CREATE OR REPLACE FUNCTION public.date_rule_categories()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'category'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
               'category',        m.category,
               'materials',       count(*),
               'with_shelf_life', count(*) FILTER (WHERE coalesce(m.shelf_life_days, 0) > 0),
               -- Chỉ tính trên mã CÓ khai hạn dùng: mã bỏ trống kéo min về 0 thì câu quy đổi
               -- thành "≈ còn 0–36 ngày", vô nghĩa.
               'min_shelf_life',  min(m.shelf_life_days) FILTER (WHERE coalesce(m.shelf_life_days, 0) > 0),
               'max_shelf_life',  max(m.shelf_life_days) FILTER (WHERE coalesce(m.shelf_life_days, 0) > 0)
             ) AS x
        FROM public."Material" m
       WHERE coalesce(m.is_active, true) AND m.category IS NOT NULL
       GROUP BY m.category
    ) s
$function$;
