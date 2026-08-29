-- 20260829 — CACHE cho 2 màn GIÁM SÁT nặng nhất: Giám sát vận hành + Slotting.
--
-- VÌ SAO (đo 29/08, diễn tập 100 người dùng ở Kho Ba Vì + Kho Bàu Bàng):
--   Chỉ 3 endpoint gãy dưới tải, lặp lại y nhau qua mọi lượt đo — `/wms/control-tower`,
--   `/wms/slotting`, `/wms/outbound/scan-log` — đều 500 vì `canceling statement due to statement
--   timeout` (đọc thẳng từ bảng error_logs: 67 + 67 + 35 dòng chỉ trong 3 giờ chạy tải).
--   Mọi màn còn lại chịu được 28 người xem đồng thời.
--
-- ĐÃ LOẠI TRỪ mấy hướng SAI — đừng đi lại:
--   · Không phải app phí round-trip: đo bằng pg_stat_statements (lọc role service_role, so từng
--     queryid lấy delta dương) → mỗi màn chỉ 1–3 request PostgREST. Đã gọn.
--   · Không phải máy DB yếu: chạy THẲNG vào Postgres, 8 người đồng thời thì control_tower_stats
--     1,0s · slotting_stats 1,7s — cách xa trần 8s.
--   · Không phải staging nhỏ hơn production: so pg_settings hai bên NGÀY 29/08 thì GIỐNG HỆT
--     (shared_buffers 224MB · work_mem 2MB · max_connections 60 · 2 parallel worker). Ngưỡng đo
--     được ở staging CHÍNH LÀ ngưỡng của production.
--   ⇒ Chúng gãy vì DB bão hoà bởi TOÀN BỘ mix nhiều màn cùng lúc, và 2 câu nặng nhất chạm trần
--     trước. Cách duy nhất có tác dụng (giống hệt bài học Dashboard 21/08): ĐỪNG chạy tổng hợp
--     nặng trong MỌI request.
--
-- Vì sao KHÔNG cache `/wms/outbound/scan-log`: mỗi người một bộ lọc riêng ⇒ cache phân mảnh vô
-- ích. Màn đó xử bằng index (migration riêng), và nay ít nhất đã trả 503 tử tế thay vì 500.

-- Dùng lại bảng cache của Dashboard: một bảng, một đường dọn lười, không đẻ thêm chỗ phải nhớ.
COMMENT ON TABLE public.dashboard_cache IS
  'Cache dùng chung cho các RPC tổng hợp nặng (Dashboard · Giám sát vận hành · Slotting). '
  'Khoá = md5 của ĐÚNG bộ tham số. Chỉ service_role đọc/ghi (RLS bật, không policy).';

-- ── Lõi dùng chung: đọc cache còn tươi, hết hạn thì CHỈ MỘT phiên được tính ────────────────────
-- CHỐNG GIẪM ĐẠP (điều mà bản cache Dashboard 21/08 còn thiếu): TTL thuần vẫn để N người cùng
-- MISS thì cả N cùng tính lại — đúng cảnh đầu ca ai cũng mở app một lượt, tức là cache vô dụng
-- đúng lúc cần nhất. Nay: ai giành được advisory lock thì tính; người còn lại DÙNG SỐ CŨ nếu có
-- (thà số cũ 1 phút còn hơn màn hình trắng), không có số cũ thì XẾP HÀNG chờ người kia tính xong
-- rồi đọc cache — không ai tính trùng.
CREATE OR REPLACE FUNCTION public.cache_fetch(p_key text, p_ttl_seconds int)
RETURNS TABLE(payload jsonb, fresh boolean, mine boolean)
LANGUAGE plpgsql
AS $$
DECLARE v_hit jsonb; v_stale jsonb;
BEGIN
  SELECT c.payload INTO v_hit FROM public.dashboard_cache c
   WHERE c.key = p_key AND c.computed_at > now() - make_interval(secs => p_ttl_seconds);
  IF v_hit IS NOT NULL THEN RETURN QUERY SELECT v_hit, true, false; RETURN; END IF;

  IF pg_try_advisory_xact_lock(hashtext(p_key)) THEN
    RETURN QUERY SELECT NULL::jsonb, false, true; RETURN;      -- mình tính
  END IF;

  SELECT c.payload INTO v_stale FROM public.dashboard_cache c WHERE c.key = p_key;
  IF v_stale IS NOT NULL THEN RETURN QUERY SELECT v_stale, false, false; RETURN; END IF;

  -- Chưa từng có số: chờ người đang tính (khoá nhả khi transaction của họ kết thúc) rồi đọc lại.
  PERFORM pg_advisory_xact_lock(hashtext(p_key));
  SELECT c.payload INTO v_hit FROM public.dashboard_cache c WHERE c.key = p_key;
  RETURN QUERY SELECT v_hit, v_hit IS NOT NULL, v_hit IS NULL;
END $$;

CREATE OR REPLACE FUNCTION public.cache_store(p_key text, p_payload jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.dashboard_cache(key, payload, computed_at) VALUES (p_key, p_payload, now())
  ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;
  -- Dọn lười: khoá gắn NGÀY nên mỗi ngày sinh bộ khoá mới. Chỉ chạy ở nhánh MISS.
  DELETE FROM public.dashboard_cache WHERE computed_at < now() - interval '2 days';
END $$;

-- Khoá cache: SẮP mảng trước khi ghép để 2 người cùng phạm vi nhưng khác thứ tự id vẫn CHUNG một
-- dòng cache (không thì cache phân mảnh vô ích).
CREATE OR REPLACE FUNCTION public.cache_key_part(p_arr text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p_arr) x), '*')
$$;

-- ── Giám sát vận hành ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.control_tower_stats_cached(
  p_warehouse_ids  text[],
  p_categories     text[],
  p_today          date,
  p_material_codes text[],
  p_ttl_seconds    int DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_key text; r record; v_calc jsonb;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RETURN control_tower_stats(p_warehouse_ids, p_categories, p_today, p_material_codes);
  END IF;
  v_key := md5('ct|' || cache_key_part(p_warehouse_ids) || '|' || cache_key_part(p_categories)
            || '|' || coalesce(p_today::text, '*') || '|' || cache_key_part(p_material_codes));
  SELECT * INTO r FROM cache_fetch(v_key, p_ttl_seconds);
  IF NOT r.mine THEN RETURN r.payload; END IF;
  v_calc := control_tower_stats(p_warehouse_ids, p_categories, p_today, p_material_codes);
  PERFORM cache_store(v_key, v_calc);
  RETURN v_calc;
END $$;

CREATE OR REPLACE FUNCTION public.control_tower_resources_cached(
  p_warehouse_ids text[], p_today date, p_ttl_seconds int DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_key text; r record; v_calc jsonb;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RETURN control_tower_resources(p_warehouse_ids, p_today);
  END IF;
  v_key := md5('ctr|' || cache_key_part(p_warehouse_ids) || '|' || coalesce(p_today::text, '*'));
  SELECT * INTO r FROM cache_fetch(v_key, p_ttl_seconds);
  IF NOT r.mine THEN RETURN r.payload; END IF;
  v_calc := control_tower_resources(p_warehouse_ids, p_today);
  PERFORM cache_store(v_key, v_calc);
  RETURN v_calc;
END $$;

-- ── Slotting ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.slotting_stats_cached(
  p_warehouse_id text, p_categories text[], p_days int, p_ttl_seconds int DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_key text; r record; v_calc jsonb;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RETURN slotting_stats(p_warehouse_id, p_categories, p_days);
  END IF;
  v_key := md5('slot|' || coalesce(p_warehouse_id, '*') || '|' || cache_key_part(p_categories)
            || '|' || coalesce(p_days::text, '*'));
  SELECT * INTO r FROM cache_fetch(v_key, p_ttl_seconds);
  IF NOT r.mine THEN RETURN r.payload; END IF;
  v_calc := slotting_stats(p_warehouse_id, p_categories, p_days);
  PERFORM cache_store(v_key, v_calc);
  RETURN v_calc;
END $$;

REVOKE ALL ON FUNCTION public.cache_fetch(text, int)                                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cache_store(text, jsonb)                                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.control_tower_stats_cached(text[], text[], date, text[], int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.control_tower_resources_cached(text[], date, int)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.slotting_stats_cached(text, text[], int, int)            FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.control_tower_stats_cached(text[], text[], date, text[], int) TO service_role;
GRANT EXECUTE ON FUNCTION public.control_tower_resources_cached(text[], date, int)     TO service_role;
GRANT EXECUTE ON FUNCTION public.slotting_stats_cached(text, text[], int, int)         TO service_role;

-- Kiểm sau khi apply:
--   SELECT control_tower_stats_cached(NULL,NULL,current_date,NULL,30);  -- lượt 1: tính + lưu
--   SELECT control_tower_stats_cached(NULL,NULL,current_date,NULL,30);  -- lượt 2: phải NHANH HẲN
--   SELECT control_tower_stats_cached(NULL,NULL,current_date,NULL,0)
--        = control_tower_stats(NULL,NULL,current_date,NULL);            -- ttl=0 phải KHỚP đường cũ
--   SELECT count(*) FROM dashboard_cache;                               -- 1 dòng / (phạm vi, ngày)
