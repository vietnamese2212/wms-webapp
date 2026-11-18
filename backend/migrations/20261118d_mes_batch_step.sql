-- MES 18/11 (d) — TÌNH TRẠNG MẺ GHI ĐÚNG BƯỚC ĐANG TỚI (user 18/11: "Tình trạng: thể hiện chính xác đang ở bước nào nhé").
--
-- Trước: danh sách mẻ ghi chung "Đang làm" cho cả năm bước Cấp nguyên liệu · Ghi phiếu · In tem pallet · Check trước khi đổ bồn ·
-- Nạp BTP vào bồn — phải mở từng mẻ mới biết đang kẹt ở đâu. Trang mẻ thì tự tính "bước đang tới" ở trình duyệt.
-- Nay: MỘT chỗ tính bước đang tới — `mes_batch_gate` trả thêm `step` (bước đầu tiên chưa xong, đúng thứ tự dải bước của trang mẻ):
--   lead (Trưởng ca duyệt) → qa (QA duyệt) → rm (Cấp nguyên liệu) → log (Ghi phiếu) → label (In tem pallet)
--   → pour (Check trước khi đổ bồn) → fill (Nạp BTP vào bồn) → tankqa (QA bồn); mẻ xong / huỷ ⇒ null.
-- Định nghĩa "xong" của từng bước = đúng điều kiện dải bước đang dùng: Cấp nguyên liệu xong khi mẻ CÓ phiếu và không còn mã thiếu
-- (dưới mức lệch) · Ghi phiếu xong khi không còn phiếu bắt buộc chưa mở và không còn ô bắt buộc trống · In tem xong khi bộ tem còn
-- hiệu lực · Check xong khi quét đủ n/n tem tại bồn của mẻ.
-- Danh sách (`mes_batch_page`) trả `step` cho dòng đang làm (gọi cùng hàm cổng) ⇒ cột Tình trạng, dải bước và nút chính của trang mẻ
-- nói cùng một bước. Ô tổng và lọc vẫn theo `stage` (không đổi).
BEGIN;

CREATE OR REPLACE FUNCTION public.mes_batch_gate(p_batch_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  b record; v_gate boolean; v_short jsonb; v_missing jsonb; v_scanned int; v_need_log boolean;
  v_block text[] := '{}';
  v_filled boolean; v_stage text; v_has_req boolean; v_step text;
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

  SELECT count(*) INTO v_scanned FROM batch_pour_scan s WHERE s.batch_id = b.id AND s.label_ver = b.label_ver AND s.tank_id = b.tank_id;

  IF b.lead_ok_at IS NULL THEN v_block := v_block || 'Trưởng ca chưa duyệt phiếu'::text; END IF;
  IF b.qa_ok_at IS NULL THEN v_block := v_block || 'QA chưa duyệt phiếu'::text; END IF;
  IF jsonb_array_length(v_short) > 0 THEN
    v_block := v_block || format('%s nguyên liệu cấp chưa đủ (%s)', jsonb_array_length(v_short),
      (SELECT string_agg(x->>'material_code', ', ') FROM (SELECT x FROM jsonb_array_elements(v_short) x LIMIT 5) s));
  END IF;
  IF v_need_log THEN v_block := v_block || 'Chưa ghi phiếu theo dõi'::text; END IF;
  IF jsonb_array_length(v_missing) > 0 THEN
    v_block := v_block || format('Phiếu còn %s ô bắt buộc chưa ghi (%s)', jsonb_array_length(v_missing),
      (SELECT string_agg(x->>'label', ', ') FROM (SELECT x FROM jsonb_array_elements(v_missing) x LIMIT 5) s));
  END IF;
  IF b.label_at IS NULL OR b.label_count IS NULL THEN v_block := v_block || 'Chưa in tem pallet của mẻ'::text;
  ELSIF v_scanned < b.label_count THEN v_block := v_block || format('Mới quét %s/%s tem pallet tại bồn', v_scanned, b.label_count); END IF;

  v_filled := EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = b.id AND mv.kind = 'FILL');
  v_stage := mes_batch_stage(b.status, b.qa_status, b.lead_ok_at, b.qa_ok_at, v_filled,
               EXISTS (SELECT 1 FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL), v_gate);
  v_has_req := EXISTS (SELECT 1 FROM batch_requirement r WHERE r.batch_id = b.id AND r.removed_at IS NULL);
  -- BƯỚC ĐANG TỚI — bước đầu tiên chưa xong. Kho không chặn theo bước (mes_flow_gate tắt): mẻ đã làm thì hai bước duyệt không giữ
  -- chân (không bắt buộc), bước đang tới tính từ Cấp nguyên liệu — như tình trạng "Đang làm" của kho đó.
  v_step := CASE
    WHEN v_stage IN ('cancelled', 'released') THEN NULL
    WHEN v_stage IN ('filled', 'rejected') THEN 'tankqa'
    WHEN v_stage IN ('new', 'wait_lead') THEN 'lead'
    WHEN v_stage = 'wait_qa' THEN 'qa'
    WHEN NOT v_has_req OR jsonb_array_length(v_short) > 0 THEN 'rm'
    WHEN v_need_log OR jsonb_array_length(v_missing) > 0 THEN 'log'
    WHEN b.label_at IS NULL OR COALESCE(b.label_count, 0) = 0 THEN 'label'
    WHEN v_scanned < b.label_count THEN 'pour'
    ELSE 'fill'
  END;

  RETURN jsonb_build_object(
    'flow_gate', v_gate, 'lead_ok', b.lead_ok_at IS NOT NULL, 'qa_ok', b.qa_ok_at IS NOT NULL,
    'can_consume', (NOT v_gate) OR (b.lead_ok_at IS NOT NULL AND b.qa_ok_at IS NOT NULL),
    'label_count', b.label_count, 'label_valid', b.label_at IS NOT NULL, 'label_ver', b.label_ver, 'scanned', v_scanned,
    'short', v_short, 'missing', v_missing, 'need_log', v_need_log, 'has_req', v_has_req,
    'fill_blockers', CASE WHEN v_gate THEN to_jsonb(v_block) ELSE '[]'::jsonb END,
    'stage', v_stage, 'step', v_step);
END $$;

-- danh sách mẻ: + `step` cho dòng đang làm (cùng hàm cổng của trang mẻ). Phần còn lại giữ nguyên 20261118b.
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
             COALESCE(w.mes_flow_gate, false)) AS stage
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

-- Lưới: mẻ nào cũng có bước khớp tình trạng (không mẻ đang làm nào thiếu bước; mẻ xong / huỷ không có bước)
DO $$
DECLARE r record; g jsonb;
BEGIN
  FOR r IN SELECT id FROM production_batch LOOP
    g := mes_batch_gate(r.id);
    IF (g->>'stage') = 'working' AND (g->>'step') NOT IN ('rm', 'log', 'label', 'pour', 'fill') THEN
      RAISE EXCEPTION 'mẻ % đang làm mà bước = %', r.id, g->>'step';
    END IF;
    IF (g->>'stage') IN ('released', 'cancelled') AND (g->>'step') IS NOT NULL THEN
      RAISE EXCEPTION 'mẻ % đã xong / huỷ mà còn bước %', r.id, g->>'step';
    END IF;
  END LOOP;
END $$;

COMMIT;
