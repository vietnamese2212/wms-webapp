-- PHIẾU THEO DÕI: MỞ trước khi cấp NVL · ĐÓNG sau QA bồn (26/11 — user chốt: "Bắt buộc phải mở phiếu mới có thể cấp NVL được,
-- để lấy được thời gian bắt đầu, còn đóng phiếu thì sau QA bồn"; ô bắt buộc thôi chặn nạp bồn, thành điều kiện đóng phiếu; vẫn ghi
-- phiếu suốt quá trình; mẻ QA bồn đạt mà phiếu chưa đóng ⇒ tình trạng "Chờ đóng phiếu").
-- Chỉ áp cho kho bật "Chặn theo từng bước" (Warehouse.mes_flow_gate) — như mọi chỗ chặn khác của luồng mẻ.
--   • mes_log_unopened(mẻ)  — phiếu CHÍNH (mẫu đang dùng, không phải phiếu bổ sung) chưa bấm "Bắt đầu" ⇒ tên phiếu, không có ⇒ NULL
--   • mes_log_pending(mẻ)   — còn phiếu của mẻ chưa đóng (QA xác nhận): phiếu chính + phiếu bổ sung đã chọn + mọi phiếu đã mở
--   • mes_consume_flow_gate — cửa chung của hai hàm cấp (quét tem · chọn lô): thêm MESERR:LOG_NOT_STARTED
--   • mes_batch_stage       — thêm tham số p_log_pending: QA bồn đạt + phiếu chưa đóng ⇒ 'closing' (Chờ đóng phiếu)
--   • mes_batch_gate        — bước mới: lead → qa → log (Mở phiếu) → rm → label → pour → fill → tankqa → close (Đóng phiếu);
--                             fill_blockers bỏ "chưa ghi phiếu / ô bắt buộc"; can_consume cần phiếu chính đã mở; trả need_open · open_forms · log_pending
--   • mes_batch_page · mes_cycle_report — truyền p_log_pending (chỉ đoạn gọi đổi, phần còn lại giữ nguyên bản đang chạy)
-- Đóng phiếu sớm / còn ô bắt buộc: controller confirmProcessLog đọc mes_batch_gate (stage + missing) — không tự tính điều kiện.
BEGIN;

CREATE OR REPLACE FUNCTION public.mes_log_unopened(p_batch_id text)
 RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT string_agg(COALESCE(nullif(btrim(f.short), ''), f.title, f.code), ', ' ORDER BY f.sort_order, f.code)
    FROM production_process_form f
   WHERE f.is_active AND NOT COALESCE(f.optional, false)
     AND NOT EXISTS (SELECT 1 FROM batch_process_log l WHERE l.batch_id = p_batch_id AND l.form = f.code)
$function$;

CREATE OR REPLACE FUNCTION public.mes_log_pending(p_batch_id text)
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM production_process_form f, production_batch b
                  WHERE b.id = p_batch_id AND f.is_active AND (NOT COALESCE(f.optional, false) OR f.code = ANY(COALESCE(b.extra_forms, '{}')))
                    AND NOT EXISTS (SELECT 1 FROM batch_process_log l WHERE l.batch_id = p_batch_id AND l.form = f.code AND l.confirmed_at IS NOT NULL))
      OR EXISTS (SELECT 1 FROM batch_process_log l WHERE l.batch_id = p_batch_id AND l.confirmed_at IS NULL)
$function$;

CREATE OR REPLACE FUNCTION public.mes_consume_flow_gate(p_batch_id text)
 RETURNS void LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE b record; v_gate boolean; v_open text;
BEGIN
  SELECT pb.lead_ok_at, pb.qa_ok_at, pb.warehouse_id INTO b FROM production_batch pb WHERE pb.id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  SELECT coalesce(w.mes_flow_gate, false) INTO v_gate FROM "Warehouse" w WHERE w.id = b.warehouse_id;
  IF NOT coalesce(v_gate, false) THEN RETURN; END IF;
  IF b.lead_ok_at IS NULL THEN RAISE EXCEPTION 'MESERR:NOT_APPROVED|Trưởng ca chưa duyệt phiếu của mẻ — chưa cấp nguyên liệu được'; END IF;
  IF b.qa_ok_at IS NULL THEN RAISE EXCEPTION 'MESERR:NOT_APPROVED|QA chưa duyệt phiếu của mẻ — chưa cấp nguyên liệu được'; END IF;
  -- 26/11: phải MỞ phiếu theo dõi (bấm "Bắt đầu" — ghi giờ bắt đầu của mẻ) rồi mới cấp
  v_open := mes_log_unopened(p_batch_id);
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'MESERR:LOG_NOT_STARTED|Chưa mở phiếu theo dõi (%) — bấm "Bắt đầu phiếu" để ghi giờ bắt đầu rồi mới cấp nguyên liệu', v_open;
  END IF;
END $function$;

DROP FUNCTION public.mes_batch_stage(text, text, timestamptz, timestamptz, boolean, boolean, boolean);
CREATE FUNCTION public.mes_batch_stage(p_status text, p_qa text, p_lead timestamptz, p_qa_ok timestamptz, p_filled boolean, p_consumed boolean,
                                       p_gate boolean, p_log_pending boolean)
 RETURNS text LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE
    WHEN p_status = 'CANCELLED' THEN 'cancelled'
    WHEN p_qa = 'REJECTED' THEN 'rejected'
    WHEN p_filled THEN CASE WHEN p_qa IS DISTINCT FROM 'RELEASED' THEN 'filled'
                            WHEN p_gate AND COALESCE(p_log_pending, false) THEN 'closing'   -- 26/11: QA bồn đạt, phiếu chưa đóng
                            ELSE 'released' END
    WHEN p_gate AND p_lead IS NULL THEN 'wait_lead'
    WHEN p_gate AND p_qa_ok IS NULL THEN 'wait_qa'
    WHEN p_gate THEN 'working'
    WHEN p_consumed OR p_qa_ok IS NOT NULL THEN 'working'
    WHEN p_lead IS NOT NULL THEN 'wait_qa'
    ELSE 'new'
  END
$function$;

CREATE OR REPLACE FUNCTION public.mes_batch_gate(p_batch_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  b record; v_gate boolean; v_short jsonb; v_missing jsonb; v_scanned int; v_need_log boolean;
  v_block text[] := '{}';
  v_filled boolean; v_stage text; v_has_req boolean; v_step text; v_open text; v_pending boolean;
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p_batch_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(mes_flow_gate, false) INTO v_gate FROM "Warehouse" WHERE id = b.warehouse_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('material_code', m.material_code, 'name', m.short_name, 'required', r.qty_required, 'issued', x.issued)
                            ORDER BY r.sort_order), '[]'::jsonb) INTO v_short
    FROM batch_requirement r
    JOIN "Material" m ON m.id = r.material_id
    CROSS JOIN LATERAL (SELECT COALESCE(sum(c.qty), 0) AS issued FROM batch_consumption c
                         WHERE c.batch_id = r.batch_id AND c.material_id = r.material_id AND c.reversed_at IS NULL) x
   WHERE r.batch_id = b.id AND r.removed_at IS NULL
     AND (x.issued <= 0 OR x.issued < r.qty_required * (1 - COALESCE(r.tol_pct, 0) / 100) - 0.0005);

  -- ô bắt buộc còn trống (phiếu đã mở) — 26/11: điều kiện ĐÓNG phiếu, không còn chặn nạp bồn
  SELECT COALESCE(jsonb_agg(jsonb_build_object('form', l.form, 'title', COALESCE(f.short, l.form), 'key', fld->>'key', 'label', fld->>'label')), '[]'::jsonb)
    INTO v_missing
    FROM batch_process_log l
    LEFT JOIN production_process_form f ON f.code = l.form
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.blocks, f.blocks, '[]'::jsonb)) blk
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN blk->>'type' = 'fields' THEN blk->'fields' ELSE '[]'::jsonb END) fld
   WHERE l.batch_id = b.id AND (fld->>'required') = 'true' AND COALESCE(btrim(l.data->>(fld->>'key')), '') = '';
  v_need_log := EXISTS (
    SELECT 1 FROM production_process_form f, jsonb_array_elements(f.blocks) blk, jsonb_array_elements(CASE WHEN blk->>'type' = 'fields' THEN blk->'fields' ELSE '[]'::jsonb END) fld
     WHERE f.is_active AND (NOT f.optional OR f.code = ANY(b.extra_forms)) AND (fld->>'required') = 'true'
       AND NOT EXISTS (SELECT 1 FROM batch_process_log l WHERE l.batch_id = b.id AND l.form = f.code));
  v_open := mes_log_unopened(b.id);
  v_pending := mes_log_pending(b.id);

  SELECT count(*) INTO v_scanned FROM batch_pour_scan s WHERE s.batch_id = b.id AND s.label_ver = b.label_ver AND s.tank_id = b.tank_id;

  IF b.lead_ok_at IS NULL THEN v_block := v_block || 'Trưởng ca chưa duyệt phiếu'::text; END IF;
  IF b.qa_ok_at IS NULL THEN v_block := v_block || 'QA chưa duyệt phiếu'::text; END IF;
  IF jsonb_array_length(v_short) > 0 THEN
    v_block := v_block || format('%s nguyên liệu cấp chưa đủ (%s)', jsonb_array_length(v_short),
      (SELECT string_agg(x->>'material_code', ', ') FROM (SELECT x FROM jsonb_array_elements(v_short) x LIMIT 5) s));
  END IF;
  IF b.label_at IS NULL OR b.label_count IS NULL THEN v_block := v_block || 'Chưa in tem pallet của mẻ'::text;
  ELSIF v_scanned < b.label_count THEN v_block := v_block || format('Mới quét %s/%s tem pallet tại bồn', v_scanned, b.label_count); END IF;

  v_filled := EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = b.id AND mv.kind = 'FILL');
  v_stage := mes_batch_stage(b.status, b.qa_status, b.lead_ok_at, b.qa_ok_at, v_filled,
               EXISTS (SELECT 1 FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL), v_gate, v_pending);
  v_has_req := EXISTS (SELECT 1 FROM batch_requirement r WHERE r.batch_id = b.id AND r.removed_at IS NULL);
  -- BƯỚC ĐANG TỚI — bước đầu tiên chưa xong, đúng thứ tự dải bước của trang mẻ (26/11: Mở phiếu trước Cấp NVL, Đóng phiếu sau QA bồn).
  -- Kho không chặn theo bước: hai bước duyệt không giữ chân khi mẻ đã làm; không có bước Đóng phiếu (tình trạng không có 'closing').
  v_step := CASE
    WHEN v_stage IN ('cancelled', 'released') THEN NULL
    WHEN v_stage = 'closing' THEN 'close'
    WHEN v_stage IN ('filled', 'rejected') THEN 'tankqa'
    WHEN v_stage IN ('new', 'wait_lead') THEN 'lead'
    WHEN v_stage = 'wait_qa' THEN 'qa'
    WHEN v_open IS NOT NULL THEN 'log'
    WHEN NOT v_has_req OR jsonb_array_length(v_short) > 0 THEN 'rm'
    WHEN b.label_at IS NULL OR COALESCE(b.label_count, 0) = 0 THEN 'label'
    WHEN v_scanned < b.label_count THEN 'pour'
    ELSE 'fill'
  END;

  RETURN jsonb_build_object(
    'flow_gate', v_gate, 'lead_ok', b.lead_ok_at IS NOT NULL, 'qa_ok', b.qa_ok_at IS NOT NULL,
    'can_consume', (NOT v_gate) OR (b.lead_ok_at IS NOT NULL AND b.qa_ok_at IS NOT NULL AND v_open IS NULL),
    'label_count', b.label_count, 'label_valid', b.label_at IS NOT NULL, 'label_ver', b.label_ver, 'scanned', v_scanned,
    'short', v_short, 'missing', v_missing, 'need_log', v_need_log, 'has_req', v_has_req,
    'need_open', v_open IS NOT NULL, 'open_forms', v_open, 'log_pending', v_pending,
    'fill_blockers', CASE WHEN v_gate THEN to_jsonb(v_block) ELSE '[]'::jsonb END,
    'stage', v_stage, 'step', v_step);
END $function$;

-- ── danh sách mẻ + báo cáo chu kỳ: chỉ đoạn gọi mes_batch_stage đổi (bản đang chạy giữ nguyên phần còn lại) ──
CREATE OR REPLACE FUNCTION public.mes_batch_page(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_wh    text[] := ARRAY(SELECT jsonb_array_elements_text(coalesce(p->'wh_ids', '[]'::jsonb)));
  v_stage text := nullif(p->>'stage', '');
  v_from  date := nullif(p->>'date_from', '')::date;
  v_to    date := nullif(p->>'date_to', '')::date;
  v_q     text := nullif(btrim(coalesce(p->>'search', '')), '');
  v_size  int  := least(greatest(coalesce((p->>'page_size')::int, 100), 1), 1000);
  v_page  int  := greatest(coalesce((p->>'page')::int, 1), 1);
  v_like  text;
  v_rows  jsonb;
  v_sum   jsonb;
BEGIN
  v_like := '%' || like_esc(coalesce(v_q, '')) || '%';
  WITH f AS (
    SELECT b.id, b.prod_date, b.batch_code,
           mes_batch_stage(b.status, b.qa_status, b.lead_ok_at, b.qa_ok_at,
             EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = b.id AND mv.kind = 'FILL'),
             EXISTS (SELECT 1 FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL),
             COALESCE(w.mes_flow_gate, false),
             -- 26/11: phiếu chưa đóng ⇒ "Chờ đóng phiếu" (chỉ tính cho mẻ QA bồn đạt ở kho chặn theo bước)
             CASE WHEN COALESCE(w.mes_flow_gate, false) AND b.qa_status = 'RELEASED' THEN mes_log_pending(b.id) ELSE false END) AS stage
      FROM production_batch b
      JOIN "Warehouse" w ON w.id = b.warehouse_id
     WHERE b.warehouse_id = ANY(v_wh)
       AND (v_from IS NULL OR b.prod_date >= v_from) AND (v_to IS NULL OR b.prod_date <= v_to)
       AND (v_q IS NULL OR b.batch_code ILIKE v_like
            OR EXISTS (SELECT 1 FROM "Material" m WHERE m.id = b.material_id AND (m.material_code ILIKE v_like OR m.short_name ILIKE v_like)))
  ), pg AS (
    SELECT f.id, f.stage, f.prod_date, f.batch_code FROM f
     WHERE v_stage IS NULL OR f.stage = v_stage
     ORDER BY f.prod_date DESC, f.batch_code DESC
     OFFSET (v_page - 1) * v_size LIMIT v_size
  )
  SELECT
    (SELECT jsonb_build_object(
       'total',     count(*) FILTER (WHERE v_stage IS NULL OR stage = v_stage),
       'new',       count(*) FILTER (WHERE stage = 'new'),
       'wait_lead', count(*) FILTER (WHERE stage = 'wait_lead'),
       'wait_qa',   count(*) FILTER (WHERE stage = 'wait_qa'),
       'working',   count(*) FILTER (WHERE stage = 'working'),
       'filled',    count(*) FILTER (WHERE stage = 'filled'),
       'closing',   count(*) FILTER (WHERE stage = 'closing'),
       'released',  count(*) FILTER (WHERE stage = 'released'),
       'rejected',  count(*) FILTER (WHERE stage = 'rejected'),
       'cancelled', count(*) FILTER (WHERE stage = 'cancelled')) FROM f),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', b.id, 'warehouse_id', b.warehouse_id, 'warehouse_name', w.name, 'batch_code', b.batch_code,
             'material_id', b.material_id, 'material_code', m.material_code, 'material_name', m.short_name, 'base_unit', m.base_unit,
             'machine_code', b.machine_code, 'shift', b.shift, 'cycle', b.cycle, 'batch_no', b.batch_no, 'tank_id', b.tank_id, 'tank_code', tk.code,
             'lead_ok_at', b.lead_ok_at, 'qa_ok_at', b.qa_ok_at, 'stage', pg.stage,
             -- bước đang tới của mẻ đang làm — chỉ dòng của TRANG đang xem, chỉ mẻ đang làm (vài mẻ) mới gọi hàm cổng
             'step', CASE WHEN pg.stage = 'working' THEN mes_batch_gate(b.id)->>'step' END,
             'prod_date', b.prod_date, 'planned_qty', b.planned_qty,
             'status', b.status, 'qa_status', b.qa_status, 'qa_at', b.qa_at, 'qa_by_name', b.qa_by_name,
             'note', b.note, 'opened_by_name', b.opened_by_name, 'created_at', b.created_at,
             'rm_lines', (SELECT count(*) FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL),
             'rm_materials', (SELECT count(DISTINCT c.material_id) FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL),
             'filled', (SELECT COALESCE(sum(mv.qty), 0) FROM tank_movement mv WHERE mv.batch_id = b.id AND mv.kind = 'FILL'),
             'in_tank', (SELECT COALESCE(sum(l.qty_remaining), 0) FROM tank_lot l WHERE l.batch_id = b.id AND l.status = 'ACTIVE')
           ) ORDER BY pg.prod_date DESC, pg.batch_code DESC), '[]'::jsonb)
       FROM pg
       JOIN production_batch b ON b.id = pg.id
       JOIN "Warehouse" w ON w.id = b.warehouse_id
       JOIN "Material" m ON m.id = b.material_id
       LEFT JOIN production_tank tk ON tk.id = b.tank_id)
  INTO v_sum, v_rows;
  RETURN jsonb_build_object('rows', v_rows, 'summary', v_sum, 'page', v_page, 'page_size', v_size);
END $function$;

CREATE OR REPLACE FUNCTION public.mes_cycle_report(p_wh text, p_cycle text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  st AS (SELECT b.id, mes_batch_stage(b.status, b.qa_status, b.lead_ok_at, b.qa_ok_at, fx.batch_id IS NOT NULL, COALESCE(cx.n, 0) > 0, v_gate,
                                   CASE WHEN v_gate AND b.qa_status = 'RELEASED' THEN mes_log_pending(b.id) ELSE false END) AS stage
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

  -- NVL × MẺ (21/11 — user: "người ta quan tâm định mức và sự chênh lệch của từng ca, từng mẻ"; chốt so với ĐỊNH MỨC GỐC theo công thức,
  -- tách phần trưởng ca sửa phiếu): std = định mức gốc (qty_standard; null = dòng thêm tay vào phiếu) · req = phiếu của mẻ đang hiệu lực
  -- (null = dòng đã bỏ khỏi phiếu, hoặc mã cấp ngoài phiếu) · rm = dòng đã bỏ (vẫn có mặt: định mức gốc của nó vẫn tính) · why = lý do sửa ·
  -- iss = lần cấp chưa huỷ. Trước 21/11 dòng đã bỏ không có mặt và "định mức" là phiếu đã sửa ⇒ sửa phiếu bằng đúng số cấp thì lệch 0.
  WITH bs AS (SELECT id FROM production_batch WHERE warehouse_id = p_wh AND cycle = p_cycle AND status <> 'CANCELLED'),
  req AS (SELECT r.batch_id, r.material_id, CASE WHEN r.removed_at IS NULL THEN r.qty_required END AS qty_required, r.qty_standard,
                 r.removed_at IS NOT NULL AS rm, r.change_reason, r.tol_pct, r.sort_order
            FROM batch_requirement r JOIN bs ON bs.id = r.batch_id),
  iss AS (SELECT c.batch_id, c.material_id, sum(c.qty) AS qty, count(*) AS n
            FROM batch_consumption c JOIN bs ON bs.id = c.batch_id WHERE c.reversed_at IS NULL GROUP BY c.batch_id, c.material_id),
  cell AS (SELECT COALESCE(req.batch_id, iss.batch_id) AS batch_id, COALESCE(req.material_id, iss.material_id) AS material_id,
                  req.qty_required AS req, req.qty_standard AS std, COALESCE(req.rm, false) AS rm, req.change_reason AS why,
                  req.tol_pct AS tol, req.sort_order, COALESCE(iss.qty, 0) AS iss, COALESCE(iss.n, 0) AS n
             FROM req FULL JOIN iss ON iss.batch_id = req.batch_id AND iss.material_id = req.material_id),
  mat AS (SELECT m.id, m.material_code, m.short_name, m.base_unit, m.entry_unit, m.units_per_carton,
                 min(cell.sort_order) AS sort_order,
                 jsonb_object_agg(cell.batch_id, jsonb_build_object('req', cell.req, 'std', cell.std, 'rm', cell.rm, 'why', cell.why, 'tol', cell.tol, 'iss', cell.iss, 'n', cell.n)) AS cells
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
END $function$;

-- ── tự kiểm: mọi mẻ có tình trạng / bước khớp luật mới ──
DO $$
DECLARE r record; g jsonb;
BEGIN
  FOR r IN SELECT id FROM production_batch LOOP
    g := mes_batch_gate(r.id);
    IF (g->>'stage') = 'working' AND (g->>'step') NOT IN ('log', 'rm', 'label', 'pour', 'fill') THEN
      RAISE EXCEPTION 'mẻ % đang làm mà bước = %', r.id, g->>'step';
    END IF;
    IF (g->>'stage') = 'closing' AND (g->>'step') IS DISTINCT FROM 'close' THEN RAISE EXCEPTION 'mẻ % chờ đóng phiếu mà bước = %', r.id, g->>'step'; END IF;
    IF (g->>'stage') IN ('released', 'cancelled') AND (g->>'step') IS NOT NULL THEN RAISE EXCEPTION 'mẻ % đã xong / huỷ mà còn bước %', r.id, g->>'step'; END IF;
  END LOOP;
END $$;

COMMIT;
