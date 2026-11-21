-- MES 21/11 — BÁO CÁO NVL: SO VỚI ĐỊNH MỨC GỐC (user 21/11: "báo cáo đã có dữ liệu thô rồi, vậy cần xem được dashboard ở đây — cái người
-- ta quan tâm là định mức và sự chênh lệch của từng ca, từng mẻ"). User chốt:
--   (1) định mức = ĐỊNH MỨC GỐC theo công thức × kế hoạch (batch_requirement.qty_standard), lệch tách HAI phần: trưởng ca SỬA PHIẾU
--       (phiếu − định mức, có lý do) và CẤP LỆCH phiếu (thực cấp − phiếu). Trước đây báo cáo so với phiếu đã sửa ⇒ sửa phiếu lên 150 rồi
--       cấp 150 thì "lệch 0" dù công thức chỉ 90.
--   (2) lệch của mẻ / ca = KG cộng dồn + số NVL lệch (phép gom ở frontend/src/utils/cycleReport.ts — DB chỉ trả số gốc từng ô).
--   (3) ca = khung giờ của một ngày ("Ca 1 · 17/11" ≠ "Ca 1 · 18/11") — gom ở utils/cycleReport.ts, không đổi DB.
--   (4) ô Ca bắt buộc khi mở / sửa mẻ — luật ở route (zBatchCreate / zBatchUpdate); mẻ cũ chưa có ca giữ nguyên tới khi sửa.
-- Hai hàm đọc (thay nguyên thân, chỉ thêm cột):
--   • mes_cycle_report: ô NVL × mẻ thêm std · rm · why; dòng ĐÃ BỎ khỏi phiếu nay có mặt (req null, rm true).
--   • mes_consumption_raw part 'req' (sheet "Định mức – thực cấp"): thêm dòng đã bỏ + removed · change_reason · diff_std (thực cấp − định mức chuẩn).
BEGIN;

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
END $$;

CREATE OR REPLACE FUNCTION public.mes_consumption_raw(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public' SET plan_cache_mode TO 'force_custom_plan' AS $$
DECLARE
  v_wh    text := nullif(p->>'warehouse_id', '');
  v_part  text := coalesce(nullif(p->>'part', ''), 'events');
  v_page_mode boolean := coalesce(p->>'mode', 'page') = 'page';
  v_from  date := nullif(p->>'date_from', '')::date;
  v_to    date := nullif(p->>'date_to', '')::date;
  v_cycle text := nullif(btrim(coalesce(p->>'cycle', '')), '');
  v_q     text := nullif(btrim(coalesce(p->>'search', '')), '');
  v_event text := nullif(p->>'event', '');
  v_flag  text := nullif(p->>'flag', '');
  v_desc  boolean := coalesce(p->>'sort', 'desc') = 'desc';
  v_size  int := least(greatest(coalesce((p->>'page_size')::int, 100), 1), 2000);
  v_page  int := greatest(coalesce((p->>'page')::int, 1), 1);
  v_t0    timestamptz;
  v_t1    timestamptz;
  v_like  text;
  v_out   jsonb;
BEGIN
  IF v_wh IS NULL THEN RAISE EXCEPTION 'MESERR:WAREHOUSE|Chọn kho chế biến'; END IF;
  IF (v_from IS NULL) <> (v_to IS NULL) THEN RAISE EXCEPTION 'MESERR:DATE_RANGE|Chọn đủ Từ ngày và Đến ngày'; END IF;
  IF v_cycle IS NULL AND v_from IS NULL THEN RAISE EXCEPTION 'MESERR:DATE_RANGE|Chọn khoảng ngày (hoặc một chu kỳ)'; END IF;
  IF v_from IS NOT NULL AND (v_to < v_from OR v_to - v_from > 366) THEN
    RAISE EXCEPTION 'MESERR:DATE_RANGE|Khoảng ngày không hợp lệ — Đến ngày phải sau Từ ngày, tối đa 367 ngày';
  END IF;
  IF v_part NOT IN ('events', 'req', 'fill') THEN RAISE EXCEPTION 'MESERR:KIND|Phần dữ liệu không hợp lệ'; END IF;
  -- ngày theo giờ Việt Nam: [00:00 Từ ngày, 00:00 ngày sau Đến ngày)
  IF v_from IS NOT NULL THEN
    v_t0 := v_from::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
    v_t1 := (v_to + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
  END IF;
  v_like := '%' || like_esc(coalesce(v_q, '')) || '%';

  IF v_part = 'events' THEN
    WITH ev AS MATERIALIZED (
      SELECT c.id, 'ISSUE'::text AS ev, c.created_at AS at
        FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
       WHERE b.warehouse_id = v_wh AND (v_cycle IS NULL OR b.cycle = v_cycle)
         AND (v_t0 IS NULL OR (c.created_at >= v_t0 AND c.created_at < v_t1))
         AND (v_event IS NULL OR v_event = 'ISSUE')
      UNION ALL
      SELECT c.id, 'REVERSAL'::text, c.reversed_at
        FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
       WHERE c.reversed_at IS NOT NULL AND b.warehouse_id = v_wh AND (v_cycle IS NULL OR b.cycle = v_cycle)
         AND (v_t0 IS NULL OR (c.reversed_at >= v_t0 AND c.reversed_at < v_t1))
         AND (v_event IS NULL OR v_event = 'REVERSAL')
    ), f AS MATERIALIZED (
      SELECT ev.id, ev.ev, ev.at, c.qty, c.batch_id, c.material_id, m.base_unit AS unit,
             COALESCE(c.rotation_violation, false) AS rot, c.expiry_approval_id IS NOT NULL AS xp
        FROM ev
        JOIN batch_consumption c ON c.id = ev.id
        JOIN production_batch b ON b.id = c.batch_id
        JOIN "Material" m ON m.id = c.material_id
       WHERE (v_q IS NULL OR b.batch_code ILIKE v_like OR m.material_code ILIKE v_like OR m.short_name ILIKE v_like
              OR c.pallet_code ILIKE v_like OR c.batch_lot ILIKE v_like)
         AND (v_flag IS NULL
              OR (v_flag = 'rotation' AND COALESCE(c.rotation_violation, false))
              OR (v_flag = 'expiry'   AND c.expiry_approval_id IS NOT NULL)
              OR (v_flag = 'reversed' AND c.reversed_at IS NOT NULL))
    ), pg AS (
      SELECT f.* FROM f
       ORDER BY CASE WHEN v_desc THEN f.at END DESC, CASE WHEN NOT v_desc THEN f.at END ASC, f.id, f.ev
       LIMIT v_size OFFSET (v_page - 1) * v_size
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'line_id', c.id, 'event', pg.ev, 'at', pg.at, 'qty', c.qty,
            'signed_qty', CASE WHEN pg.ev = 'REVERSAL' THEN -c.qty ELSE c.qty END,
            'by_name', CASE WHEN pg.ev = 'REVERSAL' THEN c.reversed_by_name ELSE c.created_by_name END,
            'by_code', CASE WHEN pg.ev = 'REVERSAL' THEN er.employee_code ELSE ei.employee_code END,
            'wh_code', w.code, 'wh_name', w.name, 'factory_code', pw.code, 'factory_name', pw.name,
            'sap_plant', COALESCE(w.sap_plant, pw.sap_plant),
            'sap_sloc', NULLIF(array_to_string(CASE WHEN cardinality(w.sap_storage_locations) > 0 THEN w.sap_storage_locations
                                                     ELSE pw.sap_storage_locations END, ','), ''),
            'nmsx', COALESCE(w.nmsx_code, pw.nmsx_code),
            'batch_id', b.id, 'batch_code', b.batch_code, 'cycle', b.cycle, 'batch_no', b.batch_no, 'shift', b.shift,
            'prod_date', b.prod_date, 'batch_status', b.status, 'batch_qa', b.qa_status, 'tank_code', tk.code, 'machine_code', b.machine_code,
            'btp_code', bm.material_code, 'btp_name', bm.short_name, 'btp_unit', bm.base_unit)
          || jsonb_build_object(
            'mat_code', m.material_code, 'mat_name', m.short_name, 'mat_desc', m.material_description, 'mat_category', m.category,
            'unit', m.base_unit, 'entry_unit', m.entry_unit, 'units_per_carton', m.units_per_carton,
            'source', c.source, 'pallet_code', c.pallet_code, 'batch_lot', c.batch_lot, 'production_date', c.production_date,
            'expiry_date', COALESCE(ie.expiry_date, ie.expiry_calc, xa.expiry_date),
            -- import_date là timestamp không múi giờ, ghi theo mốc UTC ⇒ đổi về NGÀY Việt Nam
            'import_date', ((ie.import_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
            'ncc_code', n.code, 'ncc_name', n.name, 'manufacturer', mf.name,
            'rotation_violation', COALESCE(c.rotation_violation, false), 'rotation_principle', c.rotation_principle,
            'rotation_best_date', c.rotation_best_date, 'rotation_reason', c.rotation_override_reason,
            'exp_approved', c.expiry_approval_id IS NOT NULL, 'exp_by', xa.decided_by_name, 'exp_at', xa.decided_at, 'exp_note', xa.note,
            'issued_at', c.created_at, 'issued_by', c.created_by_name,
            'reversed_at', c.reversed_at, 'reversed_by', c.reversed_by_name, 'reverse_reason', c.reverse_reason)
          ORDER BY CASE WHEN v_desc THEN pg.at END DESC, CASE WHEN NOT v_desc THEN pg.at END ASC, pg.id, pg.ev)
          FROM pg
          JOIN batch_consumption c ON c.id = pg.id
          JOIN production_batch b ON b.id = c.batch_id
          JOIN "Material" m ON m.id = c.material_id
          JOIN "Material" bm ON bm.id = b.material_id
          JOIN "Warehouse" w ON w.id = b.warehouse_id
          LEFT JOIN "Warehouse" pw ON pw.id = w.parent_warehouse_id
          LEFT JOIN production_tank tk ON tk.id = b.tank_id
          LEFT JOIN "InventoryEntry" ie ON ie.id = c.entry_id
          LEFT JOIN "TransportCompany" n ON n.id = c.ncc_id               -- NCC dùng chung bảng ĐVVT / NCC (mã = mã NCC của SAP)
          LEFT JOIN "Manufacturer" mf ON mf.id = COALESCE(ie.manufacturer_id, m.manufacturer_id)
          LEFT JOIN mes_expiry_approval xa ON xa.id = c.expiry_approval_id
          LEFT JOIN "Employee" ei ON ei.id = c.created_by
          LEFT JOIN "Employee" er ON er.id = c.reversed_by), '[]'::jsonb),
      'total', CASE WHEN v_page_mode THEN (SELECT count(*) FROM f) END,
      'summary', CASE WHEN v_page_mode THEN (
        SELECT jsonb_build_object(
          'events', count(*), 'issues', count(*) FILTER (WHERE f.ev = 'ISSUE'), 'reversals', count(*) FILTER (WHERE f.ev = 'REVERSAL'),
          'batches', count(DISTINCT f.batch_id), 'materials', count(DISTINCT f.material_id),
          'rotation', count(*) FILTER (WHERE f.ev = 'ISSUE' AND f.rot), 'expiry', count(*) FILTER (WHERE f.ev = 'ISSUE' AND f.xp),
          'by_unit', (SELECT COALESCE(jsonb_agg(jsonb_build_object('unit', u.unit, 'issued', u.iss, 'reversed', u.rev, 'net', u.iss - u.rev) ORDER BY u.unit), '[]'::jsonb)
                        FROM (SELECT COALESCE(f2.unit, '') AS unit,
                                     COALESCE(sum(f2.qty) FILTER (WHERE f2.ev = 'ISSUE'), 0) AS iss,
                                     COALESCE(sum(f2.qty) FILTER (WHERE f2.ev = 'REVERSAL'), 0) AS rev
                                FROM f f2 GROUP BY COALESCE(f2.unit, '')) u))
          FROM f) END)
    INTO v_out;

  ELSIF v_part = 'req' THEN
    WITH bs AS MATERIALIZED (
      SELECT b.id FROM production_batch b
       WHERE b.warehouse_id = v_wh AND (v_cycle IS NULL OR b.cycle = v_cycle) AND (v_from IS NULL OR b.prod_date BETWEEN v_from AND v_to)
      UNION
      SELECT c.batch_id FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
       WHERE v_t0 IS NOT NULL AND b.warehouse_id = v_wh AND (v_cycle IS NULL OR b.cycle = v_cycle)
         AND c.created_at >= v_t0 AND c.created_at < v_t1
      UNION
      SELECT c.batch_id FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
       WHERE v_t0 IS NOT NULL AND b.warehouse_id = v_wh AND (v_cycle IS NULL OR b.cycle = v_cycle)
         AND c.reversed_at >= v_t0 AND c.reversed_at < v_t1
    ), rq AS (
      -- 21/11: cả dòng ĐÃ BỎ khỏi phiếu (định mức gốc của nó vẫn tính khi so với định mức) — req chỉ cộng dòng còn hiệu lực
      SELECT r.batch_id, r.material_id, sum(r.qty_required) FILTER (WHERE r.removed_at IS NULL) AS req, sum(r.qty_standard) AS std,
             bool_and(r.removed_at IS NOT NULL) AS rm, max(r.change_reason) AS why, max(r.tol_pct) AS tol, min(r.sort_order) AS so
        FROM batch_requirement r JOIN bs ON bs.id = r.batch_id
       GROUP BY r.batch_id, r.material_id
    ), cs AS (
      SELECT c.batch_id, c.material_id,
             COALESCE(sum(c.qty) FILTER (WHERE c.reversed_at IS NULL), 0) AS iss, count(*) FILTER (WHERE c.reversed_at IS NULL) AS n,
             count(*) FILTER (WHERE c.reversed_at IS NOT NULL) AS n_rev, COALESCE(sum(c.qty) FILTER (WHERE c.reversed_at IS NOT NULL), 0) AS rev_qty,
             count(*) FILTER (WHERE c.reversed_at IS NULL AND COALESCE(c.rotation_violation, false)) AS n_rot,
             min(c.created_at) FILTER (WHERE c.reversed_at IS NULL) AS first_at, max(c.created_at) FILTER (WHERE c.reversed_at IS NULL) AS last_at
        FROM batch_consumption c JOIN bs ON bs.id = c.batch_id GROUP BY c.batch_id, c.material_id
    ), j AS (
      SELECT COALESCE(rq.batch_id, cs.batch_id) AS batch_id, COALESCE(rq.material_id, cs.material_id) AS material_id,
             rq.req, rq.std, COALESCE(rq.rm, false) AS rm, rq.why, rq.tol, rq.so, COALESCE(cs.iss, 0) AS iss, COALESCE(cs.n, 0) AS n, COALESCE(cs.n_rev, 0) AS n_rev,
             COALESCE(cs.rev_qty, 0) AS rev_qty, COALESCE(cs.n_rot, 0) AS n_rot, cs.first_at, cs.last_at
        FROM rq FULL JOIN cs ON cs.batch_id = rq.batch_id AND cs.material_id = rq.material_id
    ), k AS (
      SELECT j.*, b.prod_date, b.batch_no, b.batch_code, m.material_code
        FROM j JOIN production_batch b ON b.id = j.batch_id JOIN "Material" m ON m.id = j.material_id
       ORDER BY b.prod_date, b.batch_no NULLS LAST, b.batch_code, j.so NULLS LAST, m.material_code
       LIMIT v_size OFFSET (v_page - 1) * v_size
    )
    SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(
             jsonb_build_object(
               'batch_id', b.id, 'batch_code', b.batch_code, 'cycle', b.cycle, 'batch_no', b.batch_no, 'shift', b.shift, 'prod_date', b.prod_date,
               'batch_status', b.status, 'batch_qa', b.qa_status, 'tank_code', tk.code,
               'btp_code', bm.material_code, 'btp_name', bm.short_name, 'planned_qty', b.planned_qty, 'btp_unit', bm.base_unit,
               'wh_code', w.code, 'sap_plant', COALESCE(w.sap_plant, pw.sap_plant),
               'sap_sloc', NULLIF(array_to_string(CASE WHEN cardinality(w.sap_storage_locations) > 0 THEN w.sap_storage_locations
                                                        ELSE pw.sap_storage_locations END, ','), ''))
             || jsonb_build_object(
               'mat_code', m.material_code, 'mat_name', m.short_name, 'mat_desc', m.material_description, 'unit', m.base_unit,
               'in_sheet', k.req IS NOT NULL, 'removed', k.rm, 'change_reason', k.why, 'req', k.req, 'std', k.std, 'tol_pct', k.tol, 'iss', k.iss,
               'diff', CASE WHEN k.req IS NULL THEN NULL ELSE k.iss - k.req END,
               'diff_std', CASE WHEN k.std IS NULL THEN NULL ELSE k.iss - k.std END,
               'lines', k.n, 'reversed_lines', k.n_rev, 'reversed_qty', k.rev_qty, 'rotation_lines', k.n_rot,
               'first_at', k.first_at, 'last_at', k.last_at)
             ORDER BY k.prod_date, k.batch_no NULLS LAST, k.batch_code, k.so NULLS LAST, k.material_code), '[]'::jsonb))
      INTO v_out
      FROM k
      JOIN production_batch b ON b.id = k.batch_id
      JOIN "Material" m ON m.id = k.material_id
      JOIN "Material" bm ON bm.id = b.material_id
      JOIN "Warehouse" w ON w.id = b.warehouse_id
      LEFT JOIN "Warehouse" pw ON pw.id = w.parent_warehouse_id
      LEFT JOIN production_tank tk ON tk.id = b.tank_id;

  ELSE   -- 'fill'
    WITH fm AS (
      SELECT mv.id, mv.created_at FROM tank_movement mv JOIN production_batch b ON b.id = mv.batch_id
       WHERE mv.kind = 'FILL' AND b.warehouse_id = v_wh AND (v_cycle IS NULL OR b.cycle = v_cycle)
         AND (v_t0 IS NULL OR (mv.created_at >= v_t0 AND mv.created_at < v_t1))
       ORDER BY mv.created_at, mv.id
       LIMIT v_size OFFSET (v_page - 1) * v_size
    )
    SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
             'move_id', mv.id, 'at', mv.created_at, 'qty', mv.qty, 'by_name', mv.created_by_name, 'warning', mv.warning,
             'tank_code', tk.code, 'batch_id', b.id, 'batch_code', b.batch_code, 'cycle', b.cycle, 'batch_no', b.batch_no, 'shift', b.shift,
             'prod_date', b.prod_date, 'batch_status', b.status, 'batch_qa', b.qa_status,
             'btp_code', bm.material_code, 'btp_name', bm.short_name, 'btp_desc', bm.material_description, 'unit', bm.base_unit,
             'planned_qty', b.planned_qty, 'wh_code', w.code, 'sap_plant', COALESCE(w.sap_plant, pw.sap_plant),
             'sap_sloc', NULLIF(array_to_string(CASE WHEN cardinality(w.sap_storage_locations) > 0 THEN w.sap_storage_locations
                                                      ELSE pw.sap_storage_locations END, ','), ''))
             ORDER BY fm.created_at, fm.id), '[]'::jsonb))
      INTO v_out
      FROM fm
      JOIN tank_movement mv ON mv.id = fm.id
      JOIN production_batch b ON b.id = mv.batch_id
      JOIN "Material" bm ON bm.id = b.material_id
      JOIN "Warehouse" w ON w.id = b.warehouse_id
      LEFT JOIN "Warehouse" pw ON pw.id = w.parent_warehouse_id
      LEFT JOIN production_tank tk ON tk.id = mv.tank_id;
  END IF;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.mes_cycle_report(text, text), public.mes_consumption_raw(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_cycle_report(text, text), public.mes_consumption_raw(jsonb) TO service_role;

-- Lưới: mọi chu kỳ đang có — Σ thực cấp các ô = Σ lần cấp chưa huỷ · Σ định mức gốc các ô = Σ qty_standard của mọi dòng phiếu (kể cả dòng
-- đã bỏ) của mẻ chưa huỷ · Σ phiếu các ô = Σ dòng còn hiệu lực · sheet thô "Định mức – thực cấp" cùng ba con số đó
DO $$
DECLARE r record; rep jsonb; rq jsonb; v_iss numeric; v_std numeric; v_req numeric; d_iss numeric; d_std numeric; d_req numeric;
BEGIN
  FOR r IN SELECT DISTINCT warehouse_id, cycle FROM production_batch WHERE cycle IS NOT NULL LOOP
    rep := mes_cycle_report(r.warehouse_id, r.cycle);
    SELECT COALESCE(sum((c.value->>'iss')::numeric), 0), COALESCE(sum((c.value->>'std')::numeric), 0), COALESCE(sum((c.value->>'req')::numeric), 0)
      INTO v_iss, v_std, v_req
      FROM jsonb_array_elements(rep->'rows') x CROSS JOIN LATERAL jsonb_each(x->'cells') c;
    SELECT COALESCE(sum(c.qty), 0) INTO d_iss FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
     WHERE b.warehouse_id = r.warehouse_id AND b.cycle = r.cycle AND b.status <> 'CANCELLED' AND c.reversed_at IS NULL;
    SELECT COALESCE(sum(q.qty_standard), 0), COALESCE(sum(q.qty_required) FILTER (WHERE q.removed_at IS NULL), 0) INTO d_std, d_req
      FROM batch_requirement q JOIN production_batch b ON b.id = q.batch_id
     WHERE b.warehouse_id = r.warehouse_id AND b.cycle = r.cycle AND b.status <> 'CANCELLED';
    IF v_iss <> d_iss OR v_std <> d_std OR v_req <> d_req THEN
      RAISE EXCEPTION 'mes_cycle_report: kho % chu kỳ % — thực cấp %/% · định mức gốc %/% · phiếu %/%', r.warehouse_id, r.cycle, v_iss, d_iss, v_std, d_std, v_req, d_req;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(rep->'rows') x CROSS JOIN LATERAL jsonb_each(x->'cells') c
                WHERE (c.value->>'rm')::boolean AND c.value->>'req' IS NOT NULL) THEN
      RAISE EXCEPTION 'mes_cycle_report: chu kỳ % — dòng đã bỏ khỏi phiếu mà còn số phiếu', r.cycle;
    END IF;
  END LOOP;
  -- sheet thô (mọi mẻ có cấp / có phiếu của chu kỳ, kể cả mẻ huỷ) — so với sổ cùng phạm vi
  FOR r IN SELECT DISTINCT warehouse_id, cycle FROM production_batch WHERE cycle IS NOT NULL LOOP
    rq := mes_consumption_raw(jsonb_build_object('warehouse_id', r.warehouse_id, 'cycle', r.cycle, 'part', 'req', 'mode', 'rows', 'page_size', 2000));
    SELECT COALESCE(sum((x->>'std')::numeric), 0), COALESCE(sum((x->>'iss')::numeric), 0) INTO v_std, v_iss FROM jsonb_array_elements(rq->'rows') x;
    SELECT COALESCE(sum(q.qty_standard), 0) INTO d_std FROM batch_requirement q JOIN production_batch b ON b.id = q.batch_id
     WHERE b.warehouse_id = r.warehouse_id AND b.cycle = r.cycle;
    SELECT COALESCE(sum(c.qty), 0) INTO d_iss FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
     WHERE b.warehouse_id = r.warehouse_id AND b.cycle = r.cycle AND c.reversed_at IS NULL;
    IF v_std <> d_std OR v_iss <> d_iss THEN
      RAISE EXCEPTION 'mes_consumption_raw(req): kho % chu kỳ % — định mức chuẩn %/% · thực cấp %/%', r.warehouse_id, r.cycle, v_std, d_std, v_iss, d_iss;
    END IF;
  END LOOP;
END $$;

COMMIT;
