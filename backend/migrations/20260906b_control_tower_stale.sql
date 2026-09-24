-- ══════════════════════════════════════════════════════════════════════════════════════════
-- 06/09/2026 — GIÁM SÁT VẬN HÀNH: quá tải thì ĐƯA SỐ CŨ (nói rõ giờ chốt), đừng báo lỗi.
--
-- VÌ SAO (đo thật 06/09, ca chiều 2 kho + 4 người xem báo cáo):
--   `control_tower_stats_cached` có sẵn cache 30s + chống giẫm đạp (nhiều người cùng miss thì
--   CHỈ MỘT người tính, số còn lại nhận số cũ). Nhưng NGƯỜI ĐI TÍNH thì không có đường lui:
--   hàm để `statement_timeout = 30s`, dưới tải ghi nặng câu tính vượt 30s ⇒ người đó ôm khe
--   pool trọn 30 giây rồi nhận 503, mà cache VẪN không được làm mới ⇒ người kế tiếp lại thành
--   "người đi tính" và lại 30 giây nữa. Đo được: màn Giám sát vận hành p50 32,7s, 503 liên tục,
--   trong khi lúc máy rảnh nó chỉ 0,19s.
--
-- CÁCH LÀM (2 việc nhỏ, không đụng công thức tính):
--   1. Hạ trần thời gian tính 30s → 12s. Quá 12 giây nghĩa là hệ thống đang nghẽn — lúc đó câu
--      trả lời đúng là "số liệu lúc HH:MM", không phải bắt người dùng chờ thêm 18 giây rồi báo lỗi.
--      Máy rảnh chỉ mất 0,19s nên trần này không bao giờ chạm trong vận hành bình thường.
--   2. Thêm hàm đọc SỐ CŨ theo đúng khoá cache, KHÔNG tính lại — controller gọi khi hết giờ tính,
--      trả 200 kèm cờ `stale` + `computed_at` để màn hình NÓI THẲNG là số cũ.
-- ══════════════════════════════════════════════════════════════════════════════════════════

-- 1. Trần thời gian tính: 30s → 12s (nghẽn thì bỏ sớm, nhả khe pool cho sàn kho)
ALTER FUNCTION public.control_tower_stats_cached(text[], text[], date, text[], integer)
  SET statement_timeout TO '12s';

-- 2. Đọc số ĐÃ TÍNH LẦN TRƯỚC theo đúng khoá cache của màn Giám sát vận hành.
--    Không tính, không ghi — chỉ tra bảng cache nên luôn trả về trong vài mili giây.
--    NULL = chưa từng có số nào (lần đầu trong ngày) ⇒ controller giữ nguyên 503 có hướng dẫn.
CREATE OR REPLACE FUNCTION public.control_tower_stats_stale(
  p_warehouse_ids  text[],
  p_categories     text[],
  p_today          date,
  p_material_codes text[]
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET statement_timeout TO '5s'
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_row record;
BEGIN
  v_key := md5('ct|' || cache_key_part(p_warehouse_ids) || '|' || cache_key_part(p_categories)
            || '|' || coalesce(p_today::text, '*') || '|' || cache_key_part(p_material_codes));
  SELECT c.payload, c.computed_at INTO v_row
    FROM public.dashboard_cache c WHERE c.key = v_key;
  IF v_row.payload IS NULL THEN RETURN NULL; END IF;
  RETURN v_row.payload || jsonb_build_object('stale', true, 'computed_at', v_row.computed_at);
END $$;
