-- 20/10/2026 — LƯU TRỮ CHUNG cho sổ lớn lên theo năm (user 20/10 "ok làm đi" sau khi đo cả DB staging: 502 MB chạm trần 500 MB gói Free;
-- thứ lớn theo năm là dòng ZSD02 — 76 % byte của dòng là `raw` chép nguyên dòng SAP — rồi pallet, sổ vết, quét). Code: services/dataArchive.ts.
-- (1) data_archive_state: MỘT dòng 'main' = ổ khoá thuê + lượt chạy gần nhất. Không khoá thì hai lượt chạy chồng (hai người mở app cùng
--     lúc) ⇒ lượt B đọc nửa chừng lúc lượt A vừa xoá ⇒ tệp thiếu dòng / ghi đè tệp của A = MẤT DỮ LIỆU. Khoá có token: lượt đã quá hạn
--     thuê không nhả được khoá của lượt sau.
-- (2) purge_sap_raw: `raw` của dòng ZSD02 / VL06O chỉ giữ N ngày (cờ retention_days.sap_raw) — quá hạn thay bằng {_v:0, created_by}
--     (created_by còn hiện ở Xem đơn + bảng DO SAP); các cột đã tách giữ nguyên, panel chi tiết đọc cột trước. Không đổi updated_at
--     (không phải thay đổi nghiệp vụ). Mỗi lần gọi tối đa p_limit dòng mỗi bảng.
-- (3) chỉ mục thời gian cho các bảng được lưu trữ (tìm tháng cũ nhất + đọc theo (thời điểm, id) không quét cả bảng) + chỉ mục MỘT PHẦN
--     cho dòng còn `raw` (để dọn raw không phải đọc lại mọi dòng đã dọn).
-- Idempotent. Lên production: áp bất kỳ lúc nào (cờ mặc định 0 = giữ mãi, hành vi không đổi tới khi người bật).
BEGIN;

CREATE TABLE IF NOT EXISTS public.data_archive_state (
  id          text PRIMARY KEY,
  lease_until timestamptz,
  lease_token text,
  last_run_at timestamptz,
  last_result jsonb,
  updated_at  timestamptz NOT NULL
);
ALTER TABLE public.data_archive_state ENABLE ROW LEVEL SECURITY;

-- 'taken' = được chạy · 'busy' = lượt khác đang giữ khoá · 'recent' = vừa chạy chưa đủ giãn cách
CREATE OR REPLACE FUNCTION public.data_archive_take(p_token text, p_lease_s int, p_min_gap_s int DEFAULT 0)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  INSERT INTO public.data_archive_state (id, updated_at) VALUES ('main', now()) ON CONFLICT (id) DO NOTHING;
  UPDATE public.data_archive_state
     SET lease_until = now() + make_interval(secs => p_lease_s), lease_token = p_token, updated_at = now()
   WHERE id = 'main' AND (lease_until IS NULL OR lease_until < now())
     AND (p_min_gap_s <= 0 OR last_run_at IS NULL OR last_run_at < now() - make_interval(secs => p_min_gap_s));
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RETURN 'taken'; END IF;
  RETURN CASE WHEN EXISTS (SELECT 1 FROM public.data_archive_state WHERE id = 'main' AND lease_until >= now()) THEN 'busy' ELSE 'recent' END;
END $$;

CREATE OR REPLACE FUNCTION public.data_archive_release(p_token text, p_result jsonb)
RETURNS void LANGUAGE sql AS $$
  UPDATE public.data_archive_state
     SET lease_until = NULL, lease_token = NULL, last_run_at = now(), last_result = p_result, updated_at = now()
   WHERE id = 'main' AND lease_token = p_token;
$$;

CREATE OR REPLACE FUNCTION public.purge_sap_raw(p_before timestamptz, p_limit int DEFAULT 2000)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n_od int := 0; n_so int := 0;
BEGIN
  UPDATE public.erp_outbound_orders e
     SET raw = jsonb_strip_nulls(jsonb_build_object('_v', 0, 'created_by', e.raw -> 'created_by'))
   WHERE e.id IN (SELECT id FROM public.erp_outbound_orders
                   WHERE created_at < p_before AND raw IS NOT NULL AND coalesce(raw ->> '_v', '') <> '0'
                   ORDER BY created_at LIMIT p_limit);
  GET DIAGNOSTICS n_od = ROW_COUNT;
  UPDATE public.erp_so_lines e
     SET raw = jsonb_strip_nulls(jsonb_build_object('_v', 0, 'created_by', e.raw -> 'created_by'))
   WHERE e.id IN (SELECT id FROM public.erp_so_lines
                   WHERE created_at < p_before AND raw IS NOT NULL AND coalesce(raw ->> '_v', '') <> '0'
                   ORDER BY created_at LIMIT p_limit);
  GET DIAGNOSTICS n_so = ROW_COUNT;
  RETURN jsonb_build_object('od', n_od, 'so', n_so);
END $$;

-- (4) ĐỌC / XOÁ theo phần cho việc lưu trữ — DANH SÁCH TRẮNG bảng + cột thời gian + điều kiện ở MỘT chỗ (archive_spec), tên bảng không
--     bao giờ ghép từ đầu vào. Khoá thứ tự (thời điểm, id::text) — đọc keyset (không OFFSET: lượt chạy chồng không làm trượt trang),
--     xoá ĐÚNG khoảng khoá đã ghi tệp; xoá nhiều hơn số đã ghi ⇒ ném lỗi, cả câu huỷ (không bao giờ xoá dòng chưa vào tệp).
--     json_agg (không jsonb) để giữ thứ tự cột của bảng cho tiêu đề CSV.
CREATE OR REPLACE FUNCTION public.archive_spec(p_table text, OUT time_col text, OUT cond text)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  CASE p_table
    WHEN 'outbound_events'     THEN time_col := 'created_at';  cond := $c$event_type NOT IN ('QTY_REDUCED', 'QTY_REDUCED_TO_ACTUAL')$c$;  -- service_level dựng nhu cầu gốc từ đây
    WHEN 'admin_audit_events'  THEN time_col := 'created_at';  cond := 'true';
    WHEN 'alert_events'        THEN time_col := 'resolved_at'; cond := 'resolved_at IS NOT NULL';                                     -- chỉ cảnh báo đã đóng
    WHEN 'erp_outbound_orders' THEN time_col := 'created_at';  cond := 'true';
    WHEN 'erp_so_lines'        THEN time_col := 'created_at';  cond := 'true';
    ELSE RAISE EXCEPTION 'ARCHIVE_TABLE_NOT_ALLOWED: %', p_table;
  END CASE;
END $$;

CREATE OR REPLACE FUNCTION public.archive_oldest(p_table text)
RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE s record; v timestamptz;
BEGIN
  SELECT * INTO s FROM public.archive_spec(p_table);
  EXECUTE format('SELECT min(%I) FROM public.%I WHERE %s', s.time_col, p_table, s.cond) INTO v;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.archive_fetch(p_table text, p_from timestamptz, p_to timestamptz, p_after_ts timestamptz, p_after_id text, p_limit int)
RETURNS json LANGUAGE plpgsql STABLE AS $$
DECLARE s record; v json;
BEGIN
  SELECT * INTO s FROM public.archive_spec(p_table);
  EXECUTE format($q$
    SELECT coalesce(json_agg(t ORDER BY t.%1$I, t.id::text), '[]'::json) FROM (
      SELECT * FROM public.%2$I
       WHERE %3$s AND %1$I >= $1 AND %1$I < $2
         AND ($3::timestamptz IS NULL OR (%1$I, id::text) > ($3, $4))
       ORDER BY %1$I, id::text LIMIT $5) t$q$, s.time_col, p_table, s.cond)
    USING p_from, p_to, p_after_ts, p_after_id, least(greatest(p_limit, 1), 10000) INTO v;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.archive_delete(p_table text, p_from timestamptz, p_to timestamptz,
  p_first_ts timestamptz, p_first_id text, p_last_ts timestamptz, p_last_id text, p_expected int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE s record; n int;
BEGIN
  SELECT * INTO s FROM public.archive_spec(p_table);
  EXECUTE format($q$
    DELETE FROM public.%2$I
     WHERE %3$s AND %1$I >= $1 AND %1$I < $2
       AND (%1$I, id::text) >= ($3, $4) AND (%1$I, id::text) <= ($5, $6)$q$, s.time_col, p_table, s.cond)
    USING p_from, p_to, p_first_ts, p_first_id, p_last_ts, p_last_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > p_expected THEN RAISE EXCEPTION 'ARCHIVE_COUNT_MISMATCH: xoá % dòng nhưng tệp chỉ có %', n, p_expected; END IF;
  RETURN n;
END $$;

CREATE INDEX IF NOT EXISTS idx_erp_ob_created     ON public.erp_outbound_orders (created_at);
CREATE INDEX IF NOT EXISTS idx_erp_so_created     ON public.erp_so_lines (created_at);
CREATE INDEX IF NOT EXISTS idx_erp_ob_raw_live    ON public.erp_outbound_orders (created_at) WHERE raw IS NOT NULL AND coalesce(raw ->> '_v', '') <> '0';
CREATE INDEX IF NOT EXISTS idx_erp_so_raw_live    ON public.erp_so_lines (created_at) WHERE raw IS NOT NULL AND coalesce(raw ->> '_v', '') <> '0';
CREATE INDEX IF NOT EXISTS idx_oev_created        ON public.outbound_events (created_at);
CREATE INDEX IF NOT EXISTS idx_alert_events_resolved ON public.alert_events (resolved_at) WHERE resolved_at IS NOT NULL;

COMMIT;
