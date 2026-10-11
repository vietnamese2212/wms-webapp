-- 11/10/2026 — Tổng quan nhớ số liệu 30 phút (user duyệt đề xuất 3: 30 lần mở / 35 giờ = 30 lần tính lại, trung bình 2,4 s, có lần
-- 17,5 s) ⇒ số liệu phải NÓI mình tính lúc nào: payload mang `computed_at` (cả khi lấy từ cache lẫn khi vừa tính) để trang chủ in
-- "Số liệu lúc hh:mm" như Giám sát vận hành. Mặc định TTL: `DASHBOARD_CACHE_SECONDS_DEFAULT` 300 → 1800 (settings.ts); staging đã đặt
-- SystemSetting dashboard_cache_seconds = 1800. Lên production: áp bất kỳ lúc nào; ĐẶT dashboard_cache_seconds = 1800 ở Cài đặt WMS ›
-- Hệ thống (dòng cấu hình có sẵn ở production vẫn là 300 cho tới khi đổi tay).
CREATE OR REPLACE FUNCTION public.dashboard_all_cached(p_warehouse_ids text[], p_categories text[], p_today date, p_ttl_seconds integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_key  text;
  v_hit  jsonb;
  v_calc jsonb;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RETURN dashboard_all(p_warehouse_ids, p_categories, p_today) || jsonb_build_object('computed_at', now());
  END IF;

  -- Khoá cache = ĐÚNG bộ tham số. Sắp mảng trước khi ghép để 2 user cùng phạm vi kho nhưng thứ tự
  -- id khác nhau vẫn CHUNG một dòng cache (không thì cache phân mảnh vô ích).
  v_key := md5(
       coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p_warehouse_ids) x), '*')
    || '|' || coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p_categories) x), '*')
    || '|' || coalesce(p_today::text, '*'));

  SELECT payload INTO v_hit FROM public.dashboard_cache
   WHERE key = v_key AND computed_at > now() - make_interval(secs => p_ttl_seconds);
  IF v_hit IS NOT NULL THEN
    RETURN v_hit;
  END IF;

  v_calc := dashboard_all(p_warehouse_ids, p_categories, p_today) || jsonb_build_object('computed_at', now());

  INSERT INTO public.dashboard_cache(key, payload, computed_at) VALUES (v_key, v_calc, now())
  ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- Dọn lười: khoá gắn NGÀY nên mỗi ngày sinh bộ khoá mới. Xoá dòng quá 2 ngày để bảng không phình.
  -- (Chỉ chạy ở nhánh MISS — tức tối đa vài lần / TTL, không phải mỗi request.)
  DELETE FROM public.dashboard_cache WHERE computed_at < now() - interval '2 days';

  RETURN v_calc;
END $function$;
