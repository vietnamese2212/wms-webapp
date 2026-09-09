-- KPI · biểu đồ theo chu kỳ: "kỳ đã qua" KHÔNG có nghĩa là "kỳ đã chốt".
--
-- Bản cũ giữ cache TỐI THIỂU 24 GIỜ cho mọi kỳ kết thúc trước hôm nay, với giả định số của kỳ cũ
-- không đổi nữa. Giả định đó sai trong kho: phiếu nhập ghi bù ca đêm, chuyến hoàn thành muộn, sửa
-- chấm công, khai chi phí tháng trước, VL06O dội xuống trễ — tất cả đều đổi số của kỳ ĐÃ kết thúc.
-- Đo thật 09/09/2026: nạp trọn dữ liệu vận hành 01–09/09 xong, ô tổng cả khoảng ra đúng (23/23
-- chuyến, 97 pallet) nhưng biểu đồ theo NGÀY chỉ có điểm ở 09/09 — 8 kỳ còn lại đọc bản cache tính
-- lúc chưa có dữ liệu, và không có đường nào làm mới trong 24h.
--
-- Hai sửa đổi, đều nằm gọn trong warehouse_kpi_series (hàm tính không đổi):
--   1. Cache dài chỉ áp cho kỳ kết thúc đã QUÁ 7 NGÀY. Trong 7 ngày gần nhất dùng TTL chung
--      (cờ dashboard_cache_seconds) nên dữ liệu về muộn hiện ra trong vòng một nhịp cache.
--      Vì sao không bỏ hẳn cache dài: đo 09/09 mỗi kỳ tốn ~1,3–1,7s (1 kho hay 153 kho đều vậy),
--      chart 60 kỳ tính tươi hết ≈ 90s > statement_timeout 55s. Cửa sổ 7 ngày = 4–8 kỳ tươi (~6–12s),
--      vẫn trong hạn, và với chu kỳ THÁNG thì tháng trước còn sống hết tuần đầu tháng sau — đúng lúc
--      người ta khai chi phí và chốt công.
--   2. Tắt cache thì phải tắt được CẢ chuỗi: greatest(0, 86400) khiến dashboard_cache_seconds = 0
--      vẫn cho ra cache 24h ở kỳ cũ, tức cái nút tắt không tắt được gì.
--
-- CÒN LẠI (chưa xử ở bản này): sửa dữ liệu của kỳ CŨ HƠN 7 ngày vẫn phải chờ hết 24h. Muốn đúng
-- tuyệt đối thì cần mốc "dữ liệu quá khứ vừa đổi" do trigger ghi rồi đối chiếu với computed_at —
-- việc riêng, có đánh đổi hiệu năng, chưa làm.

CREATE OR REPLACE FUNCTION public.warehouse_kpi_series(
  p_warehouse_ids text[] DEFAULT NULL,
  p_categories    text[] DEFAULT NULL,
  p_grain         text    DEFAULT 'month',
  p_from          date    DEFAULT NULL,
  p_to            date    DEFAULT NULL,
  p_std_hours     numeric DEFAULT 8,
  p_pct_low       numeric DEFAULT 30,
  p_slow_days     int     DEFAULT 90,
  p_dead_days     int     DEFAULT 180,
  p_ttl_seconds   int     DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql
SET statement_timeout TO '55s'
AS $$
DECLARE
  v_step interval;
  v_start date; v_end date; v_n int; v_key text; v_one jsonb; v_ttl int;
  v_out jsonb := '[]'::jsonb;
  -- Số ngày một kỳ đã kết thúc còn được coi là "có thể còn nhận dữ liệu muộn".
  c_grace_days constant int := 7;
BEGIN
  IF p_grain NOT IN ('day', 'week', 'month', 'year') THEN RAISE EXCEPTION 'BAD_GRAIN'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'BAD_RANGE'; END IF;
  v_step  := CASE p_grain WHEN 'day' THEN interval '1 day' WHEN 'week' THEN interval '7 days'
                          WHEN 'month' THEN interval '1 month' ELSE interval '1 year' END;
  v_start := CASE p_grain WHEN 'day' THEN p_from ELSE date_trunc(p_grain, p_from)::date END;
  -- Số kỳ = số bước từ kỳ chứa p_from tới kỳ chứa p_to
  v_n := CASE p_grain
           WHEN 'day'   THEN (p_to - p_from) + 1
           WHEN 'week'  THEN ((date_trunc('week', p_to)::date - v_start) / 7) + 1
           WHEN 'month' THEN (extract(year FROM p_to) - extract(year FROM v_start)) * 12 + (extract(month FROM p_to) - extract(month FROM v_start)) + 1
           ELSE (extract(year FROM p_to) - extract(year FROM v_start)) + 1 END;
  IF v_n > 60 THEN RAISE EXCEPTION 'TOO_MANY_BUCKETS:%', v_n; END IF;

  FOR i IN 0..(v_n - 1) LOOP
    v_end := (v_start + v_step - interval '1 day')::date;
    v_key := CASE p_grain WHEN 'day' THEN to_char(v_start, 'YYYY-MM-DD') WHEN 'week' THEN to_char(v_start, 'IYYY-"W"IW')
                          WHEN 'month' THEN to_char(v_start, 'YYYY-MM') ELSE to_char(v_start, 'YYYY') END;
    v_ttl := CASE
               WHEN coalesce(p_ttl_seconds, 0) <= 0            THEN p_ttl_seconds            -- tắt cache = tắt cả chuỗi
               WHEN v_end < current_date - c_grace_days        THEN greatest(p_ttl_seconds, 86400)
               ELSE p_ttl_seconds END;
    v_one := warehouse_kpi_cached(p_warehouse_ids, p_categories, v_start, v_end, p_std_hours, p_pct_low, p_slow_days, p_dead_days, v_ttl, true);
    v_out := v_out || jsonb_build_object('key', v_key, 'from', v_start, 'to', v_end, 'days', (v_end - v_start + 1),
                                         'totals', v_one->'totals', 'cost_shared', v_one->'cost_shared');
    v_start := (v_start + v_step)::date;
  END LOOP;
  RETURN v_out;
END;
$$;
