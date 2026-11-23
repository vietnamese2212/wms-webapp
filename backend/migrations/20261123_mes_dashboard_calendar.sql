-- MES 23/11 — dashboard Báo cáo NVL: KỲ THEO LỊCH quanh một MỐC (user 23/11: "3 năm thì chọn năm hiện tại, năm trước đó và năm sau đó ·
-- 1 năm thì chọn các tháng của năm hiện tại · dữ liệu gom luôn · phải có mục chọn theo mốc thời gian"; chốt 3 tháng = tháng trước · tháng
-- chọn · tháng sau, 7 ngày = tuần T2 → CN). Kỳ tính ở màn (frontend/src/utils/mesDash.ts periodOf). DB chỉ cần thêm hai thứ:
--   • grain 'year' (3 năm gom theo năm — khoá 01/01, date_trunc('year'));
--   • kỳ so do màn gửi (prev_from / prev_to = kỳ liền trước CÙNG kiểu: tháng trước, năm trước, 3 năm trước đó…) — trước đây luôn là "cùng
--     số ngày liền trước" nên tháng 11 so với 02/10 → 31/10. Vắng hai tham số ⇒ như cũ. Trả thêm prev_from / prev_to.
-- Thay nguyên thân mes_dashboard (chữ ký giữ nguyên); phần còn lại của 20261122 không đổi.
BEGIN;

CREATE OR REPLACE FUNCTION public.mes_dashboard(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  v_wh    text := nullif(p->>'warehouse_id', '');
  v_from  date := nullif(p->>'date_from', '')::date;
  v_to    date := nullif(p->>'date_to', '')::date;
  v_grain text := coalesce(nullif(p->>'grain', ''), 'day');
  v_days  int;
  v_pfrom date;
  v_pto   date;
  v_dev   numeric;
  v_pass  numeric;
  v_out   jsonb;
BEGIN
  IF v_wh IS NULL THEN RAISE EXCEPTION 'MESERR:WAREHOUSE|Chọn kho chế biến'; END IF;
  IF v_from IS NULL OR v_to IS NULL OR v_to < v_from THEN RAISE EXCEPTION 'MESERR:DATE_RANGE|Khoảng ngày không hợp lệ'; END IF;
  v_days := v_to - v_from + 1;
  IF v_days > 1100 THEN RAISE EXCEPTION 'MESERR:DATE_RANGE|Tối đa 3 năm'; END IF;
  IF v_grain NOT IN ('batch', 'day', 'week', 'month', 'year') THEN RAISE EXCEPTION 'MESERR:KIND|Cách gom không hợp lệ'; END IF;
  -- kỳ so (▲▼): màn gửi kỳ liền trước CÙNG kiểu (tháng trước · năm trước…); vắng ⇒ cùng số ngày liền trước như 22/11
  v_pfrom := COALESCE(nullif(p->>'prev_from', '')::date, v_from - v_days);
  v_pto := COALESCE(nullif(p->>'prev_to', '')::date, v_from - 1);
  IF v_pto < v_pfrom OR v_pto - v_pfrom > 1100 THEN RAISE EXCEPTION 'MESERR:DATE_RANGE|Kỳ so không hợp lệ'; END IF;
  SELECT COALESCE(w.mes_dev_target_pct, 0.5), COALESCE(w.mes_pass_target_pct, 95) INTO v_dev, v_pass FROM "Warehouse" w WHERE w.id = v_wh;

  WITH b AS MATERIALIZED (SELECT * FROM mes_dash_batches(v_wh, v_from, v_to)),
  l AS MATERIALIZED (SELECT * FROM mes_dash_lines(v_wh, v_from, v_to)),
  pv AS MATERIALIZED (SELECT * FROM mes_dash_batches(v_wh, v_pfrom, v_pto)),
  bk AS (SELECT CASE v_grain WHEN 'week' THEN date_trunc('week', b.prod_date)::date WHEN 'month' THEN date_trunc('month', b.prod_date)::date
                            WHEN 'year' THEN date_trunc('year', b.prod_date)::date ELSE b.prod_date END AS k, b.* FROM b),
  pct AS (SELECT b.*, CASE WHEN b.std_kg > 0 THEN round(b.total_kg / b.std_kg * 100, 3) END AS pct, (b.over + b.under + b.extra) AS dev FROM b)
  SELECT jsonb_build_object(
    'warehouse_id', v_wh, 'date_from', v_from, 'date_to', v_to, 'grain', v_grain, 'prev_from', v_pfrom, 'prev_to', v_pto, 'computed_at', now(),
    'targets', jsonb_build_object('dev_pct', v_dev, 'pass_pct', v_pass),
    'totals', (SELECT jsonb_build_object(
        'batches', count(*), 'filled', count(*) FILTER (WHERE filled), 'pass', count(*) FILTER (WHERE filled AND over + under + extra = 0),
        'dev_batches', count(*) FILTER (WHERE over + under + extra > 0),
        'lines', COALESCE(sum(lines), 0), 'pending', COALESCE(sum(pending), 0), 'ok', COALESCE(sum(ok), 0), 'over', COALESCE(sum(over), 0),
        'under', COALESCE(sum(under), 0), 'extra', COALESCE(sum(extra), 0), 'edited', COALESCE(sum(edited), 0),
        'std_kg', COALESCE(sum(std_kg), 0), 'sheet_kg', COALESCE(sum(sheet_kg), 0), 'iss_kg', COALESCE(sum(iss_kg), 0),
        'edit_kg', COALESCE(sum(edit_kg), 0), 'exec_kg', COALESCE(sum(exec_kg), 0), 'total_kg', COALESCE(sum(total_kg), 0),
        'avg_min', round(avg(open_min) FILTER (WHERE filled)), 'rm_bad', COALESCE(sum(rm_bad), 0),
        'qa_released', count(*) FILTER (WHERE qa_status = 'RELEASED'), 'qa_rejected', count(*) FILTER (WHERE qa_status = 'REJECTED')) FROM b),
    'prev', (SELECT jsonb_build_object(
        'batches', count(*), 'filled', count(*) FILTER (WHERE filled), 'pass', count(*) FILTER (WHERE filled AND over + under + extra = 0),
        'over', COALESCE(sum(over), 0), 'under', COALESCE(sum(under), 0), 'extra', COALESCE(sum(extra), 0),
        'std_kg', COALESCE(sum(std_kg), 0), 'total_kg', COALESCE(sum(total_kg), 0), 'avg_min', round(avg(open_min) FILTER (WHERE filled)),
        'qa_released', count(*) FILTER (WHERE qa_status = 'RELEASED'), 'qa_rejected', count(*) FILTER (WHERE qa_status = 'REJECTED')) FROM pv),
    'buckets', (SELECT COALESCE(jsonb_agg(jsonb_build_object('k', x.k, 'batches', x.n, 'filled', x.filled, 'pass', x.pass, 'dev_batches', x.devb,
                  'dev_lines', x.devl, 'std_kg', x.std, 'total_kg', x.tot, 'edit_kg', x.edit, 'exec_kg', x.exec) ORDER BY x.k), '[]'::jsonb)
                  FROM (SELECT k, count(*) AS n, count(*) FILTER (WHERE filled) AS filled, count(*) FILTER (WHERE filled AND over + under + extra = 0) AS pass,
                               count(*) FILTER (WHERE over + under + extra > 0) AS devb, sum(over + under + extra) AS devl,
                               sum(std_kg) AS std, sum(total_kg) AS tot, sum(edit_kg) AS edit, sum(exec_kg) AS exec FROM bk GROUP BY k) x),
    'points', CASE WHEN v_grain = 'batch' THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.batch_id, 'code', x.batch_code, 'no', x.batch_no,
                  'shift', x.shift, 'at', x.created_at, 'filled', x.filled, 'std_kg', x.std_kg, 'total_kg', x.total_kg, 'pct', x.pct, 'dev', x.dev,
                  'pending', x.pending) ORDER BY x.created_at), '[]'::jsonb) FROM pct x) END,
    'heat', (SELECT COALESCE(jsonb_agg(jsonb_build_object('shift', x.shift, 'k', x.k, 'batches', x.n, 'dev_batches', x.devb, 'std_kg', x.std, 'total_kg', x.tot)
                  ORDER BY x.k, x.shift NULLS LAST), '[]'::jsonb)
                  FROM (SELECT shift, k, count(*) AS n, count(*) FILTER (WHERE over + under + extra > 0) AS devb, sum(std_kg) AS std, sum(total_kg) AS tot
                          FROM bk GROUP BY shift, k) x),
    'shifts', (SELECT COALESCE(jsonb_agg(jsonb_build_object('shift', x.shift, 'batches', x.n, 'filled', x.filled, 'pass', x.pass, 'dev_lines', x.devl,
                  'std_kg', x.std, 'total_kg', x.tot) ORDER BY x.shift NULLS LAST), '[]'::jsonb)
                  FROM (SELECT shift, count(*) AS n, count(*) FILTER (WHERE filled) AS filled, count(*) FILTER (WHERE filled AND over + under + extra = 0) AS pass,
                               sum(over + under + extra) AS devl, sum(std_kg) AS std, sum(total_kg) AS tot FROM b GROUP BY shift) x),
    'btp', (SELECT COALESCE(jsonb_agg(jsonb_build_object('btp_id', x.btp_id, 'code', m.material_code, 'name', m.short_name, 'batches', x.n, 'filled', x.filled,
                  'pass', x.pass, 'dev_lines', x.devl, 'std_kg', x.std, 'total_kg', x.tot) ORDER BY x.n DESC, m.material_code), '[]'::jsonb)
                  FROM (SELECT btp_id, count(*) AS n, count(*) FILTER (WHERE filled) AS filled, count(*) FILTER (WHERE filled AND over + under + extra = 0) AS pass,
                               sum(over + under + extra) AS devl, sum(std_kg) AS std, sum(total_kg) AS tot FROM b GROUP BY btp_id) x
                  JOIN "Material" m ON m.id = x.btp_id),
    'pareto_total', (SELECT count(*) FROM l),
    'pareto', (SELECT COALESCE(jsonb_agg(jsonb_build_object('material_id', x.material_id, 'code', m.material_code, 'name', m.short_name, 'unit', m.base_unit,
                  'n', x.n, 'batches', x.nb, 'over', x.ov, 'under', x.un, 'extra', x.ex, 'std', x.std, 'iss', x.iss) ORDER BY x.n DESC, m.material_code), '[]'::jsonb)
                  FROM (SELECT material_id, count(*) AS n, count(DISTINCT batch_id) AS nb, count(*) FILTER (WHERE state = 'over') AS ov,
                               count(*) FILTER (WHERE state = 'under') AS un, count(*) FILTER (WHERE state = 'extra') AS ex, sum(std) AS std, sum(iss) AS iss
                          FROM l GROUP BY material_id ORDER BY count(*) DESC LIMIT 10) x
                  JOIN "Material" m ON m.id = x.material_id),
    'spc', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.batch_id, 'code', x.batch_code, 'no', x.batch_no, 'shift', x.shift, 'd', x.prod_date,
                  'at', x.created_at, 'pct', x.pct, 'dev', x.dev, 'filled', x.filled) ORDER BY x.created_at), '[]'::jsonb)
                  FROM (SELECT * FROM pct WHERE std_kg > 0 ORDER BY created_at DESC LIMIT 300) x),
    'exc', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.batch_id, 'code', x.batch_code, 'no', x.batch_no, 'shift', x.shift, 'd', x.prod_date,
                  'btp', m.material_code, 'filled', x.filled, 'std_kg', x.std_kg, 'total_kg', x.total_kg, 'pct', x.pct, 'dev', x.dev,
                  'edit_kg', x.edit_kg, 'exec_kg', x.exec_kg, 'extra', x.extra,
                  'mat', (SELECT jsonb_build_object('code', mm.material_code, 'name', mm.short_name, 'unit', mm.base_unit, 'state', ll.state, 'diff', ll.iss - ll.std)
                            FROM l ll JOIN "Material" mm ON mm.id = ll.material_id WHERE ll.batch_id = x.batch_id ORDER BY abs(ll.iss - ll.std) DESC LIMIT 1))
                  ORDER BY abs(x.pct) DESC, x.created_at DESC), '[]'::jsonb)
                  FROM (SELECT * FROM pct WHERE std_kg > 0 AND dev > 0 ORDER BY abs(pct) DESC, created_at DESC LIMIT 10) x
                  JOIN "Material" m ON m.id = x.btp_id)
  ) INTO v_out;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.mes_dashboard(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_dashboard(jsonb) TO service_role;

-- Lưới: từng kho, 3 năm theo NĂM = theo THÁNG cùng khoảng (tổng mẻ · lệch KG · số kỳ có mẻ khớp); kỳ so gửi tay được dùng đúng khoảng
DO $$
DECLARE r record; y jsonb; m jsonb; v_n int;
BEGIN
  FOR r IN SELECT DISTINCT warehouse_id FROM production_batch LOOP
    y := mes_dashboard(jsonb_build_object('warehouse_id', r.warehouse_id, 'date_from', '2025-01-01', 'date_to', '2027-12-31', 'grain', 'year',
                                          'prev_from', '2022-01-01', 'prev_to', '2024-12-31'));
    m := mes_dashboard(jsonb_build_object('warehouse_id', r.warehouse_id, 'date_from', '2025-01-01', 'date_to', '2027-12-31', 'grain', 'month'));
    IF (y->'totals'->>'batches') <> (m->'totals'->>'batches') OR (y->'totals'->>'total_kg')::numeric <> (m->'totals'->>'total_kg')::numeric THEN
      RAISE EXCEPTION 'mes_dashboard kho %: gom năm ≠ gom tháng', r.warehouse_id;
    END IF;
    SELECT count(*) INTO v_n FROM jsonb_array_elements(y->'buckets') b WHERE (b->>'k') NOT LIKE '%-01-01';
    IF v_n > 0 THEN RAISE EXCEPTION 'mes_dashboard kho %: khoá kỳ năm phải là 01/01', r.warehouse_id; END IF;
    IF y->>'prev_from' <> '2022-01-01' OR y->>'prev_to' <> '2024-12-31' THEN RAISE EXCEPTION 'mes_dashboard: kỳ so gửi tay không được dùng'; END IF;
  END LOOP;
END $$;

COMMIT;
