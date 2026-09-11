-- Trang Khách hàng: MỘT lời gọi trả dòng + tổng + mức đã khai (11/09/2026, đợt 2).
--
-- Vì sao đổi khỏi cách cũ (2 truy vấn PostgREST):
--   1. Ô band đang `select(...)` KHÔNG phân trang ⇒ dính trần 1000 dòng, và cắt ÂM THẦM: danh mục
--      vượt 1.000 khách là mọi con số trên dải xanh đều sai mà không có lỗi nào nổi lên.
--      (Chính lớp lỗi đã quét cả chiến dịch 03/07 + 03/08 — xem CLAUDE.md.)
--   2. Mỗi dòng nay mang NHIỀU mức (khách × loại hàng). Đính kèm bằng một truy vấn nữa cho mỗi
--      trang là thêm round-trip trên đúng cái pool 10 khe của PostgREST.
--   3. Lọc "đã khai mức / chưa khai" không viết được bằng filter PostgREST trên bảng Customer.
--
-- Khuôn giống các hàm *_page khác: force_custom_plan (tham số NULL rất lệch nhau, generic plan sẽ
-- chọn sai kế hoạch) và CÙNG MỘT mệnh đề WHERE cho dòng lẫn tổng — viết một lần trong CTE `pick`.
-- KHÔNG dùng bảng tạm: hàm STABLE không được phép CREATE TABLE (và bảng tạm cũng phá mất khả năng
-- chạy song song).

CREATE OR REPLACE FUNCTION public.customer_page(
  p_search       text    DEFAULT NULL,
  p_channels     text[]  DEFAULT NULL,
  p_has_channel  boolean DEFAULT NULL,
  p_warehouse_id text    DEFAULT NULL,
  p_active       boolean DEFAULT NULL,
  p_has_rule     boolean DEFAULT NULL,
  p_limit        int     DEFAULT 200,
  p_offset       int     DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET plan_cache_mode = 'force_custom_plan'
AS $function$
DECLARE
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_lim    int  := greatest(1, least(500, coalesce(p_limit, 200)));
  v_off    int  := greatest(0, coalesce(p_offset, 0));
  v_res    jsonb;
BEGIN
  WITH pick AS (
    SELECT c.*
      FROM public."Customer" c
     WHERE (v_search IS NULL
            OR c.ship_to_code ILIKE '%' || public.like_esc(v_search) || '%'
            OR c.name         ILIKE '%' || public.like_esc(v_search) || '%')
       AND (p_channels IS NULL OR array_length(p_channels, 1) IS NULL OR c.channel = ANY (p_channels))
       AND (p_has_channel IS NULL OR (c.channel IS NOT NULL) = p_has_channel)
       AND (p_warehouse_id IS NULL OR c.warehouse_id = p_warehouse_id)
       AND (p_active IS NULL OR c.is_active = p_active)
       AND (p_has_rule IS NULL OR EXISTS (
              SELECT 1 FROM public.date_rule_master m
               WHERE m.scope = 'CUSTOMER' AND m.scope_key = c.id) = p_has_rule)
  ),
  -- Ô band: đếm TRÊN TOÀN BỘ LỌC (không phải trang đang xem), đếm trong SQL.
  -- "chưa khai mức" = khách không có dòng mức nào VÀ kênh của khách cũng chưa khai
  -- ⇒ đúng nghĩa "dòng hàng của khách này KHÔNG được cấp quy định date tự động".
  agg AS (
    SELECT count(*) AS total,
           jsonb_build_object(
             'total',          count(*),
             'no_channel',     count(*) FILTER (WHERE c.channel IS NULL),
             'with_warehouse', count(*) FILTER (WHERE c.warehouse_id IS NOT NULL),
             'auto_created',   count(*) FILTER (WHERE c.auto_created),
             'inactive',       count(*) FILTER (WHERE NOT c.is_active),
             'no_rule',        count(*) FILTER (
               WHERE NOT EXISTS (SELECT 1 FROM public.date_rule_master m
                                  WHERE m.scope = 'CUSTOMER' AND m.scope_key = c.id)
                 AND NOT EXISTS (SELECT 1 FROM public.date_rule_master m
                                  WHERE m.scope = 'CHANNEL' AND m.scope_key = c.channel))
           ) AS summary
      FROM pick c
  ),
  page AS (
    SELECT c.name AS o1, c.ship_to_code AS o2,
           to_jsonb(c) || jsonb_build_object(
             'rules', coalesce((
               SELECT jsonb_agg(jsonb_build_object('id', m.id, 'category', m.category, 'rule', m.rule)
                                ORDER BY m.category NULLS FIRST)
                 FROM public.date_rule_master m
                WHERE m.scope = 'CUSTOMER' AND m.scope_key = c.id), '[]'::jsonb),
             'channel_rules', coalesce((
               SELECT jsonb_agg(jsonb_build_object('category', m.category, 'rule', m.rule)
                                ORDER BY m.category NULLS FIRST)
                 FROM public.date_rule_master m
                WHERE m.scope = 'CHANNEL' AND m.scope_key = c.channel), '[]'::jsonb)
           ) AS r
      FROM pick c
     ORDER BY c.name, c.ship_to_code
     LIMIT v_lim OFFSET v_off
  )
  SELECT jsonb_build_object(
           'rows',    coalesce((SELECT jsonb_agg(p.r ORDER BY p.o1, p.o2) FROM page p), '[]'::jsonb),
           'total',   (SELECT total FROM agg),
           'summary', (SELECT summary FROM agg)
         )
    INTO v_res;

  RETURN v_res;
END;
$function$;
