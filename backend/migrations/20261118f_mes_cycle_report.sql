-- MES 18/11 (f) — BÁO CÁO NVL THEO CHU KỲ + MẺ TRÊN SƠ ĐỒ BỒN.
-- User 18/11: "vẽ cho tôi bồn, dự kiến 20–30 cái bồn, tiết kiệm vị trí. Bồn nằm sau khâu của mẻ, vậy mẻ cũng hiện lên trên sơ đồ.
-- Liên kết sơ đồ với tình trạng để xem realtime. Từ đây đi ra được báo cáo NVL — xem realtime và lấy được các báo cáo cuối."
-- Trả lời câu hỏi: "theo CHU KỲ, chu kỳ là lớn hơn ca, mẻ" · "cuối chu kỳ, nhưng tách ra ca, mẻ — từ đó ra được các chỉ số của nhân sự, số liệu".
--
-- Chu kỳ = (kho chế biến, production_batch.cycle) — cùng khoá với số mẻ (chỉ mục duy nhất kho + chu kỳ + số mẻ). Ca của mẻ = production_batch.shift
-- (ca khai lúc mở mẻ, như tờ giấy ghi BTP / chu kỳ / mẻ). Mẻ đã huỷ không vào bảng NVL × mẻ (danh sách mẻ vẫn trả, có cờ).
--   • mes_batch_steps(ids)          — tình trạng + bước đang tới của NHIỀU mẻ trong MỘT lần gọi (sơ đồ bồn: mẻ đứng trên bồn của nó).
--                                     Cùng hàm cổng mes_batch_gate với danh sách mẻ / trang mẻ ⇒ sơ đồ, cột Tình trạng, dải bước nói cùng một bước.
--   • mes_cycle_list(p)             — các chu kỳ của một kho chế biến (mới nhất trước): số mẻ · đã nạp bồn · ca · mã BTP.
--   • mes_cycle_report(wh, cycle)   — mẻ (tình trạng, bước, mốc giờ, người làm) · NVL × mẻ (định mức ↔ thực cấp) · nhân sự (đếm việc từng người).
--   • mes_cycle_lines(wh, cycle)    — từng lần cấp NVL của chu kỳ (sheet "Chi tiết cấp" của báo cáo cuối).
-- Không bảng mới, không cột mới: chỉ đọc sổ đã có (batch_requirement · batch_consumption · tank_movement · batch_pour_scan · batch_process_log).
BEGIN;

CREATE INDEX IF NOT EXISTS idx_prod_batch_wh_cycle ON public.production_batch (warehouse_id, cycle, created_at);

-- ── tình trạng + bước của nhiều mẻ ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_batch_steps(p_ids text[]) RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_object_agg(x.id, jsonb_build_object('stage', x.g->>'stage', 'step', x.g->>'step')), '{}'::jsonb)
    FROM (SELECT i AS id, mes_batch_gate(i) AS g FROM (SELECT DISTINCT unnest(COALESCE(p_ids, '{}'::text[])) AS i LIMIT 2000) u) x
   WHERE x.g IS NOT NULL
$$;

-- ── danh sách chu kỳ của một kho ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- p = { warehouse_id, search?, days? }: không tìm ⇒ chu kỳ có mẻ ngày SX trong `days` ngày gần nhất (mặc định 400); có tìm ⇒ mọi chu kỳ khớp.
CREATE OR REPLACE FUNCTION public.mes_cycle_list(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public' SET plan_cache_mode TO 'force_custom_plan' AS $$
DECLARE
  v_wh   text := p->>'warehouse_id';
  v_q    text := nullif(btrim(coalesce(p->>'search', '')), '');
  v_days int  := least(greatest(coalesce((p->>'days')::int, 400), 1), 5000);
  v_like text;
  v_out  jsonb;
BEGIN
  v_like := '%' || like_esc(coalesce(v_q, '')) || '%';
  WITH cy AS (
    SELECT b.cycle, max(b.created_at) AS last_at
      FROM production_batch b
     WHERE b.warehouse_id = v_wh AND b.cycle IS NOT NULL
       AND (v_q IS NULL OR b.cycle ILIKE v_like)
     GROUP BY b.cycle
    HAVING v_q IS NOT NULL OR max(b.prod_date) >= mes_vn_today() - v_days
     ORDER BY max(b.created_at) DESC
     LIMIT 200
  ), agg AS (
    SELECT cy.cycle, cy.last_at,
           count(*) FILTER (WHERE b.status <> 'CANCELLED') AS batches,
           count(*) FILTER (WHERE b.status = 'CANCELLED') AS cancelled,
           count(*) FILTER (WHERE b.status <> 'CANCELLED'
                              AND EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = b.id AND mv.kind = 'FILL')) AS filled,
           min(b.created_at) AS first_at, min(b.prod_date) AS date_from, max(b.prod_date) AS date_to,
           COALESCE(jsonb_agg(DISTINCT b.shift) FILTER (WHERE b.shift IS NOT NULL AND b.status <> 'CANCELLED'), '[]'::jsonb) AS shifts,
           COALESCE(jsonb_agg(DISTINCT m.material_code) FILTER (WHERE b.status <> 'CANCELLED'), '[]'::jsonb) AS btp
      FROM cy
      JOIN production_batch b ON b.warehouse_id = v_wh AND b.cycle = cy.cycle
      JOIN "Material" m ON m.id = b.material_id
     GROUP BY cy.cycle, cy.last_at
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'cycle', a.cycle, 'batches', a.batches, 'cancelled', a.cancelled, 'filled', a.filled,
           'first_at', a.first_at, 'last_at', a.last_at, 'date_from', a.date_from, 'date_to', a.date_to,
           'shifts', a.shifts, 'btp', a.btp) ORDER BY a.last_at DESC), '[]'::jsonb)
    INTO v_out FROM agg a;
  RETURN v_out;
END $$;

-- ── báo cáo một chu kỳ ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_cycle_report(p_wh text, p_cycle text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  v_gate    boolean;
  v_batches jsonb;
  v_rows    jsonb;
  v_people  jsonb;
BEGIN
  SELECT coalesce(mes_flow_gate, false) INTO v_gate FROM "Warehouse" WHERE id = p_wh;

  -- MẺ — tình trạng tính bằng CÙNG hàm với danh sách mẻ; bước đang tới chỉ hỏi hàm cổng cho mẻ đang làm
  WITH bs AS (SELECT b.* FROM production_batch b WHERE b.warehouse_id = p_wh AND b.cycle = p_cycle),
  fx AS (SELECT mv.batch_id, sum(mv.qty) AS qty, min(mv.created_at) AS first_at,
                (array_agg(mv.created_by_name ORDER BY mv.created_at))[1] AS by_name
           FROM tank_movement mv JOIN bs ON bs.id = mv.batch_id WHERE mv.kind = 'FILL' GROUP BY mv.batch_id),
  -- lần cấp: còn hiệu lực (n) · sai thứ tự luân chuyển (bad) · hàng hết hạn QA duyệt (exp) · đã huỷ (rev — cấp nhầm phải huỷ)
  cx AS (SELECT c.batch_id,
                min(c.created_at) FILTER (WHERE c.reversed_at IS NULL) AS first_at, max(c.created_at) FILTER (WHERE c.reversed_at IS NULL) AS last_at,
                count(*) FILTER (WHERE c.reversed_at IS NULL) AS n,
                count(*) FILTER (WHERE c.reversed_at IS NULL AND COALESCE(c.rotation_violation, false)) AS bad,
                count(*) FILTER (WHERE c.reversed_at IS NULL AND c.expiry_approval_id IS NOT NULL) AS exp,
                count(*) FILTER (WHERE c.reversed_at IS NOT NULL) AS rev
           FROM batch_consumption c JOIN bs ON bs.id = c.batch_id GROUP BY c.batch_id),
  st AS (SELECT b.id, mes_batch_stage(b.status, b.qa_status, b.lead_ok_at, b.qa_ok_at, fx.batch_id IS NOT NULL, COALESCE(cx.n, 0) > 0, v_gate) AS stage
           FROM bs b LEFT JOIN fx ON fx.batch_id = b.id LEFT JOIN cx ON cx.batch_id = b.id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', b.id, 'batch_code', b.batch_code, 'batch_no', b.batch_no, 'shift', b.shift, 'prod_date', b.prod_date,
           'material_id', b.material_id, 'material_code', m.material_code, 'material_name', m.short_name, 'base_unit', m.base_unit,
           'tank_id', b.tank_id, 'tank_code', tk.code, 'planned_qty', b.planned_qty, 'status', b.status, 'qa_status', b.qa_status,
           'stage', st.stage, 'step', CASE WHEN st.stage = 'working' THEN mes_batch_gate(b.id)->>'step' END,
           'created_at', b.created_at, 'opened_by_name', b.opened_by_name,
           'lead_ok_at', b.lead_ok_at, 'lead_ok_by_name', b.lead_ok_by_name, 'qa_ok_at', b.qa_ok_at, 'qa_ok_by_name', b.qa_ok_by_name,
           'label_at', b.label_at, 'label_by_name', b.label_by_name, 'label_count', b.label_count,
           'rm_first_at', cx.first_at, 'rm_last_at', cx.last_at, 'rm_lines', COALESCE(cx.n, 0),
           'rm_bad', COALESCE(cx.bad, 0), 'rm_exp', COALESCE(cx.exp, 0), 'rm_rev', COALESCE(cx.rev, 0),
           'filled_qty', COALESCE(fx.qty, 0), 'filled_at', fx.first_at, 'filled_by_name', fx.by_name,
           'tank_qa_at', CASE WHEN b.qa_status IN ('RELEASED', 'REJECTED') THEN b.qa_at END,
           'tank_qa_by_name', CASE WHEN b.qa_status IN ('RELEASED', 'REJECTED') THEN b.qa_by_name END
         ) ORDER BY b.created_at, b.batch_no), '[]'::jsonb)
    INTO v_batches
    FROM bs b
    JOIN st ON st.id = b.id
    JOIN "Material" m ON m.id = b.material_id
    LEFT JOIN production_tank tk ON tk.id = b.tank_id
    LEFT JOIN fx ON fx.batch_id = b.id
    LEFT JOIN cx ON cx.batch_id = b.id;

  -- NVL × MẺ — định mức = dòng phiếu còn hiệu lực (bỏ dòng đã gỡ), thực cấp = lần cấp chưa huỷ; mã cấp mà không có trên phiếu ⇒ req null
  WITH bs AS (SELECT id FROM production_batch WHERE warehouse_id = p_wh AND cycle = p_cycle AND status <> 'CANCELLED'),
  req AS (SELECT r.batch_id, r.material_id, r.qty_required, r.tol_pct, r.sort_order
            FROM batch_requirement r JOIN bs ON bs.id = r.batch_id WHERE r.removed_at IS NULL),
  iss AS (SELECT c.batch_id, c.material_id, sum(c.qty) AS qty, count(*) AS n
            FROM batch_consumption c JOIN bs ON bs.id = c.batch_id WHERE c.reversed_at IS NULL GROUP BY c.batch_id, c.material_id),
  cell AS (SELECT COALESCE(req.batch_id, iss.batch_id) AS batch_id, COALESCE(req.material_id, iss.material_id) AS material_id,
                  req.qty_required AS req, req.tol_pct AS tol, req.sort_order, COALESCE(iss.qty, 0) AS iss, COALESCE(iss.n, 0) AS n
             FROM req FULL JOIN iss ON iss.batch_id = req.batch_id AND iss.material_id = req.material_id),
  mat AS (SELECT m.id, m.material_code, m.short_name, m.base_unit, m.entry_unit, m.units_per_carton,
                 min(cell.sort_order) AS sort_order,
                 jsonb_object_agg(cell.batch_id, jsonb_build_object('req', cell.req, 'tol', cell.tol, 'iss', cell.iss, 'n', cell.n)) AS cells
            FROM cell JOIN "Material" m ON m.id = cell.material_id
           GROUP BY m.id, m.material_code, m.short_name, m.base_unit, m.entry_unit, m.units_per_carton)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'material_id', mat.id, 'material_code', mat.material_code, 'material_name', mat.short_name,
           'base_unit', mat.base_unit, 'entry_unit', mat.entry_unit, 'units_per_carton', mat.units_per_carton, 'cells', mat.cells
         ) ORDER BY mat.sort_order NULLS LAST, mat.material_code), '[]'::jsonb)
    INTO v_rows FROM mat;

  -- NHÂN SỰ — mỗi việc một sự kiện có người · mẻ · lúc; đếm theo người (tên). Dòng cấp đã huỷ đếm riêng (rm_rev) — không vào "lần cấp".
  WITH bs AS (SELECT * FROM production_batch WHERE warehouse_id = p_wh AND cycle = p_cycle),
  ev AS (
    SELECT b.opened_by_name AS who, 'open'::text AS k, b.id AS batch_id, b.shift, b.created_at AS at, false AS bad, false AS exp, false AS rev
      FROM bs b WHERE b.opened_by_name IS NOT NULL
    UNION ALL SELECT b.lead_ok_by_name, 'lead', b.id, b.shift, b.lead_ok_at, false, false, false FROM bs b WHERE b.lead_ok_at IS NOT NULL AND b.lead_ok_by_name IS NOT NULL
    UNION ALL SELECT b.qa_ok_by_name, 'qaok', b.id, b.shift, b.qa_ok_at, false, false, false FROM bs b WHERE b.qa_ok_at IS NOT NULL AND b.qa_ok_by_name IS NOT NULL
    UNION ALL SELECT b.label_by_name, 'label', b.id, b.shift, b.label_at, false, false, false FROM bs b WHERE b.label_at IS NOT NULL AND b.label_by_name IS NOT NULL
    UNION ALL SELECT c.created_by_name, 'rm', c.batch_id, b.shift, c.created_at, COALESCE(c.rotation_violation, false), c.expiry_approval_id IS NOT NULL, c.reversed_at IS NOT NULL
      FROM batch_consumption c JOIN bs b ON b.id = c.batch_id WHERE c.created_by_name IS NOT NULL
    UNION ALL SELECT s.scanned_by_name, 'pour', s.batch_id, b.shift, s.created_at, false, false, false
      FROM batch_pour_scan s JOIN bs b ON b.id = s.batch_id WHERE s.scanned_by_name IS NOT NULL
    UNION ALL SELECT mv.created_by_name, 'fill', mv.batch_id, b.shift, mv.created_at, false, false, false
      FROM tank_movement mv JOIN bs b ON b.id = mv.batch_id WHERE mv.kind = 'FILL' AND mv.created_by_name IS NOT NULL
    UNION ALL SELECT b.qa_by_name, 'tankqa', b.id, b.shift, b.qa_at, false, false, false
      FROM bs b WHERE b.qa_status IN ('RELEASED', 'REJECTED') AND b.qa_at IS NOT NULL AND b.qa_by_name IS NOT NULL
    UNION ALL SELECT st.value->>'by', 'log', l.batch_id, b.shift, (st.value->>'at')::timestamptz, false, false, false
      FROM batch_process_log l JOIN bs b ON b.id = l.batch_id CROSS JOIN LATERAL jsonb_each(COALESCE(l.stamps, '{}'::jsonb)) st
     WHERE jsonb_typeof(st.value) = 'object' AND st.value->>'by' IS NOT NULL AND st.value->>'at' IS NOT NULL
    UNION ALL SELECT l.confirmed_by_name, 'logok', l.batch_id, b.shift, l.confirmed_at, false, false, false
      FROM batch_process_log l JOIN bs b ON b.id = l.batch_id WHERE l.confirmed_at IS NOT NULL AND l.confirmed_by_name IS NOT NULL
  ), pp AS (
    SELECT btrim(ev.who) AS name,
           count(*) FILTER (WHERE k = 'open') AS open, count(*) FILTER (WHERE k = 'lead') AS lead, count(*) FILTER (WHERE k = 'qaok') AS qaok,
           count(*) FILTER (WHERE k = 'label') AS label,
           count(*) FILTER (WHERE k = 'rm' AND NOT rev) AS rm, count(*) FILTER (WHERE k = 'rm' AND rev) AS rm_rev,
           count(*) FILTER (WHERE k = 'rm' AND NOT rev AND bad) AS rm_bad, count(*) FILTER (WHERE k = 'rm' AND NOT rev AND exp) AS rm_exp,
           count(DISTINCT batch_id) FILTER (WHERE k = 'rm' AND NOT rev) AS rm_batches,
           count(*) FILTER (WHERE k = 'pour') AS pour, count(*) FILTER (WHERE k = 'fill') AS fill, count(*) FILTER (WHERE k = 'tankqa') AS tankqa,
           count(*) FILTER (WHERE k = 'log') AS log, count(*) FILTER (WHERE k = 'logok') AS logok,
           count(DISTINCT batch_id) AS batches,
           COALESCE(jsonb_agg(DISTINCT ev.shift) FILTER (WHERE ev.shift IS NOT NULL), '[]'::jsonb) AS shifts,
           min(at) AS first_at, max(at) AS last_at
      FROM ev WHERE btrim(ev.who) <> '' GROUP BY btrim(ev.who)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(pp) ORDER BY pp.first_at, pp.name), '[]'::jsonb) INTO v_people FROM pp;

  RETURN jsonb_build_object('warehouse_id', p_wh, 'cycle', p_cycle, 'batches', v_batches, 'rows', v_rows, 'people', v_people);
END $$;

-- ── từng lần cấp NVL của chu kỳ (báo cáo cuối — sheet Chi tiết cấp) ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_cycle_lines(p_wh text, p_cycle text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'batch_id', c.batch_id, 'batch_code', b.batch_code, 'batch_no', b.batch_no, 'shift', b.shift,
           'material_code', m.material_code, 'material_name', m.short_name, 'base_unit', m.base_unit, 'entry_unit', m.entry_unit,
           'units_per_carton', m.units_per_carton, 'pallet_code', c.pallet_code, 'batch_lot', c.batch_lot, 'production_date', c.production_date,
           'qty', c.qty, 'source', c.source, 'by', c.created_by_name, 'at', c.created_at,
           'rotation_violation', COALESCE(c.rotation_violation, false), 'rotation_principle', c.rotation_principle,
           'rotation_override_reason', c.rotation_override_reason, 'expiry_approved', c.expiry_approval_id IS NOT NULL,
           'reversed_at', c.reversed_at, 'reversed_by_name', c.reversed_by_name, 'reverse_reason', c.reverse_reason
         ) ORDER BY c.created_at, c.id), '[]'::jsonb)
    FROM batch_consumption c
    JOIN production_batch b ON b.id = c.batch_id
    JOIN "Material" m ON m.id = c.material_id
   WHERE b.warehouse_id = p_wh AND b.cycle = p_cycle
$$;

REVOKE ALL ON FUNCTION public.mes_batch_steps(text[]), public.mes_cycle_list(jsonb), public.mes_cycle_report(text, text), public.mes_cycle_lines(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_batch_steps(text[]), public.mes_cycle_list(jsonb), public.mes_cycle_report(text, text), public.mes_cycle_lines(text, text)
  TO service_role;

-- Lưới: mọi chu kỳ đang có — Σ thực cấp trong bảng NVL × mẻ = Σ lần cấp chưa huỷ của mẻ chưa huỷ · số mẻ khớp · bước của mẻ đang làm hợp lệ
DO $$
DECLARE r record; rep jsonb; v_iss numeric; v_db numeric; v_n int;
BEGIN
  FOR r IN SELECT DISTINCT warehouse_id, cycle FROM production_batch WHERE cycle IS NOT NULL LOOP
    rep := mes_cycle_report(r.warehouse_id, r.cycle);
    SELECT COALESCE(sum((c.value->>'iss')::numeric), 0) INTO v_iss
      FROM jsonb_array_elements(rep->'rows') x CROSS JOIN LATERAL jsonb_each(x->'cells') c;
    SELECT COALESCE(sum(c.qty), 0) INTO v_db FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
     WHERE b.warehouse_id = r.warehouse_id AND b.cycle = r.cycle AND b.status <> 'CANCELLED' AND c.reversed_at IS NULL;
    IF v_iss <> v_db THEN RAISE EXCEPTION 'chu kỳ % kho %: Σ thực cấp % ≠ sổ %', r.cycle, r.warehouse_id, v_iss, v_db; END IF;
    SELECT count(*) INTO v_n FROM production_batch WHERE warehouse_id = r.warehouse_id AND cycle = r.cycle;
    IF jsonb_array_length(rep->'batches') <> v_n THEN RAISE EXCEPTION 'chu kỳ %: số mẻ lệch', r.cycle; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(rep->'batches') x WHERE x->>'stage' = 'working' AND COALESCE(x->>'step', '') NOT IN ('rm', 'log', 'label', 'pour', 'fill')) THEN
      RAISE EXCEPTION 'chu kỳ %: mẻ đang làm thiếu bước', r.cycle;
    END IF;
  END LOOP;
END $$;

COMMIT;
