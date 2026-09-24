-- 20260821f — CACHE số liệu Dashboard (user chốt 21/08: 5 phút, đưa vào Cài đặt › Hệ thống).
--
-- VÌ SAO (đo 21/08 trên dữ liệu lớn — 55.779 dòng tồn, gói QA 06-readload, 8 luồng ghi + 6 người đọc):
--   Dashboard  p50 28.285ms · max 35.954ms · trả 500
-- Trang chủ là trang AI CŨNG mở đầu tiên, nên nó chậm là CẢ APP có cảm giác chậm.
--
-- ĐÃ LOẠI TRỪ query là nguyên nhân — đừng đi lại đường này:
--   · `dashboard_stats` chạy ẤM chỉ 64ms (2.721 buffer); lạnh 6,7s.
--   · Thử index giả định `(warehouse_id, material_id) INCLUDE (cartons_remaining)
--     WHERE cartons_remaining>0` trong BEGIN…ROLLBACK: cost 3811→2330 nhưng KHÔNG nhanh hơn 64ms ⇒
--     không tạo.
--   · 2 CTE `inv` và `by_unit` là cùng một lượt quét khác GROUP BY (gộp được về 1) nhưng chỉ lợi
--     ~30ms ⇒ không đáng rủi ro đổi số liệu trang chủ.
-- Nút thắt thật = XẾP HÀNG ở pool ~10 khe NỘI BỘ của PostgREST (memory `postgrest-pool-roundtrips`).
-- Cách duy nhất có tác dụng: ĐỪNG chạy tổng hợp nặng trong MỌI request.
--
-- Cache đặt Ở DB chứ không trong RAM của lambda: serverless có N instance, cache RAM thì mỗi
-- instance lạnh vẫn phải trả giá đủ (đúng lúc tải cao Vercel bung thêm instance = đúng lúc cache RAM
-- vô dụng nhất). Bảng dùng chung ⇒ instance thứ 2..N đọc 1 dòng nhỏ.

CREATE TABLE IF NOT EXISTS public.dashboard_cache (
  key         text        PRIMARY KEY,
  payload     jsonb       NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
-- Bật RLS: bất biến gói QA 00 đòi MỌI bảng public phải bật (không hở với anon key).
-- Không khai policy — chỉ service_role (bypass RLS) đọc/ghi bảng này.
ALTER TABLE public.dashboard_cache ENABLE ROW LEVEL SECURITY;

-- Bọc dashboard_all: TRẢ LẠI kết quả còn tươi, hết hạn thì tính rồi lưu.
-- p_ttl_seconds <= 0 ⇒ BỎ QUA cache hoàn toàn (cờ dashboard_cache_seconds = 0 → hành vi CŨ nguyên vẹn).
CREATE OR REPLACE FUNCTION public.dashboard_all_cached(
  p_warehouse_ids text[],
  p_categories    text[],
  p_today         date,
  p_ttl_seconds   int DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_key  text;
  v_hit  jsonb;
  v_calc jsonb;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RETURN dashboard_all(p_warehouse_ids, p_categories, p_today);
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

  v_calc := dashboard_all(p_warehouse_ids, p_categories, p_today);

  INSERT INTO public.dashboard_cache(key, payload, computed_at) VALUES (v_key, v_calc, now())
  ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- Dọn lười: khoá gắn NGÀY nên mỗi ngày sinh bộ khoá mới. Xoá dòng quá 2 ngày để bảng không phình.
  -- (Chỉ chạy ở nhánh MISS — tức tối đa vài lần / TTL, không phải mỗi request.)
  DELETE FROM public.dashboard_cache WHERE computed_at < now() - interval '2 days';

  RETURN v_calc;
END $$;

REVOKE ALL ON FUNCTION public.dashboard_all_cached(text[], text[], date, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_all_cached(text[], text[], date, int) TO service_role;

-- Kiểm sau khi apply:
--   SELECT dashboard_all_cached(NULL, NULL, current_date, 300);   -- lượt 1: tính + lưu
--   SELECT dashboard_all_cached(NULL, NULL, current_date, 300);   -- lượt 2: phải NHANH HẲN
--   SELECT dashboard_all_cached(NULL, NULL, current_date, 0)
--        = dashboard_all(NULL, NULL, current_date);               -- ttl=0 phải KHỚP đường cũ
--   SELECT count(*) FROM dashboard_cache;                         -- 1 dòng / (phạm vi, ngày)
