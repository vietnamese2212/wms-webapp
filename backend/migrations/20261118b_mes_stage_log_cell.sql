-- MES 18/11 (b) — TÌNH TRẠNG MẺ theo bước · BỎ "ĐÓNG MẺ" · PHIẾU THEO DÕI GHI TỪNG Ô.
--
-- 1) BỎ "ĐÓNG MẺ" (user 18/11: "Đóng mẻ ko phải là bước cần thiết để đổ bồn … nếu đã có Bỏ duyệt QA chặn ko cho làm tiếp thì cũng
--    không cần"). Mẻ chỉ còn hai trạng thái lưu: OPEN · CANCELLED. "Xong" của mẻ = đã NẠP BTP VÀO BỒN (tình trạng tính ở mục 2).
--    Hệ quả phải đổi cùng lúc: mẻ chỉ GIỮ CHỖ trong bồn tới lần nạp đầu tiên (trước đây "đóng mẻ" mới nhả phần kế hoạch chưa nạp —
--    nay không ai đóng nữa thì phần dư sẽ treo mãi). Mẻ đang CLOSED (staging 0 dòng) mở lại thành OPEN.
-- 2) TÌNH TRẠNG (stage) — user 18/11: "màu sắc của Mẻ thay đổi theo tình trạng: Duyệt 1 một màu, Chờ QA duyệt một màu, QA block có
--    symbol, đang làm, đã làm xong". MỘT hàm SQL `mes_batch_stage` cho danh sách (dòng · ô tổng · lọc) và trang mẻ (qua mes_batch_gate)
--    — không tính lại ở trình duyệt.
--      cancelled · rejected (QA bồn không đạt) · released (đã nạp, QA bồn đạt) · filled (đã nạp, chờ QA bồn)
--      kho bật luồng chặt: wait_lead (chờ trưởng ca duyệt) → wait_qa (trưởng ca đã duyệt, chờ QA duyệt) → working (đang làm)
--      kho không chặn:     new (chưa cấp NVL) · wait_qa (đã duyệt 1, chưa cấp) · working (đã cấp NVL hoặc đủ hai duyệt)
-- 3) PHIẾU THEO DÕI GHI TỪNG Ô (user 18/11: "chỉ để 1 nút mở phiếu ghi nhận tình trạng Bắt đầu, và cho nút ở các input, bấm vào sẽ
--    hiện lên yêu cầu Input, nếu thời gian thì tự lấy thời gian"). `mes_log_cell` thay `mes_log_stamp`:
--      op=start — mở phiếu (chưa có thì tạo + điền sẵn máy / kế hoạch) và ghi GIỜ MÁY CHỦ vào mốc giờ đầu tiên nếu còn trống
--      op=set   — ghi MỘT ô (ô nhóm hoặc ô bảng theo dõi): không gửi value + ô Giờ ⇒ giờ máy chủ; gửi value ⇒ giá trị đó ('' = xoá)
--    Mỗi lần ghi gộp đúng một khoá vào jsonb dưới khoá tư vấn (mẻ, phiếu) ⇒ nhiều người ghi các ô khác nhau không đè nhau, hai người
--    cùng mở phiếu lần đầu không đụng khoá trùng.
BEGIN;

-- ─── 1. Bỏ trạng thái CLOSED ────────────────────────────────────────────────────────────────────────────────────
UPDATE public.production_batch SET status = 'OPEN', closed_at = NULL, closed_by = NULL, closed_by_name = NULL, updated_at = now()
 WHERE status = 'CLOSED';
ALTER TABLE public.production_batch DROP CONSTRAINT IF EXISTS production_batch_status_check;
ALTER TABLE public.production_batch ADD CONSTRAINT production_batch_status_check CHECK (status IN ('OPEN', 'CANCELLED'));

-- mẻ giữ chỗ trong bồn tới lần NẠP ĐẦU TIÊN (thay cho "đóng mẻ mới nhả chỗ")
CREATE OR REPLACE FUNCTION public.mes_tank_room_check(p_tank text, p_wh text, p_material text, p_planned numeric, p_exclude text) RETURNS numeric
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE t record; v_unit text; v_other text; v_cur numeric; v_res numeric; v_free numeric;
BEGIN
  SELECT * INTO t FROM production_tank WHERE id = p_tank;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy bồn'; END IF;
  IF t.warehouse_id <> p_wh THEN RAISE EXCEPTION 'MESERR:WRONG_WAREHOUSE|Bồn % không thuộc kho của mẻ', t.code; END IF;
  IF NOT t.is_active THEN RAISE EXCEPTION 'MESERR:TANK_INACTIVE|Bồn % đang ngừng dùng', t.code; END IF;
  SELECT upper(coalesce(base_unit, '')) INTO v_unit FROM "Material" WHERE id = p_material;
  IF v_unit <> t.unit THEN
    RAISE EXCEPTION 'MESERR:UNIT|Bồn % tính theo %, mã bán thành phẩm tính theo % — chọn bồn khác', t.code, t.unit, coalesce(nullif(v_unit, ''), '(trống)');
  END IF;
  SELECT m.material_code INTO v_other FROM tank_lot l JOIN production_batch ob ON ob.id = l.batch_id JOIN "Material" m ON m.id = ob.material_id
   WHERE l.tank_id = t.id AND l.status = 'ACTIVE' AND ob.material_id <> p_material LIMIT 1;
  IF v_other IS NOT NULL THEN RAISE EXCEPTION 'MESERR:MIX_MATERIAL|Bồn % đang chứa mã % — chọn bồn khác', t.code, v_other; END IF;
  SELECT ob.batch_code INTO v_other FROM production_batch ob
   WHERE ob.tank_id = t.id AND ob.status = 'OPEN' AND ob.material_id <> p_material AND ob.id IS DISTINCT FROM p_exclude
     AND NOT EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = ob.id AND mv.kind = 'FILL') LIMIT 1;
  IF v_other IS NOT NULL THEN RAISE EXCEPTION 'MESERR:MIX_MATERIAL|Bồn % đã đặt cho mẻ % (mã khác) — chọn bồn khác', t.code, v_other; END IF;
  SELECT COALESCE(sum(qty_remaining), 0) INTO v_cur FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE';
  SELECT COALESCE(sum(ob.planned_qty), 0) INTO v_res FROM production_batch ob
   WHERE ob.tank_id = t.id AND ob.status = 'OPEN' AND ob.planned_qty IS NOT NULL AND ob.id IS DISTINCT FROM p_exclude
     AND NOT EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = ob.id AND mv.kind = 'FILL');
  v_free := t.capacity - v_cur - v_res;
  IF p_planned IS NOT NULL AND p_planned > v_free THEN
    RAISE EXCEPTION 'MESERR:OVER_CAPACITY|Bồn % chỉ còn chỗ cho % % (sức chứa %, đang chứa %, mẻ khác đã đặt %) — kế hoạch % không vừa',
      t.code, greatest(v_free, 0), t.unit, t.capacity, v_cur, v_res, p_planned;
  END IF;
  RETURN v_free;
END $$;

-- ─── 2. Tình trạng của mẻ ──────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_batch_stage(p_status text, p_qa text, p_lead timestamptz, p_qa_ok timestamptz,
                                                  p_filled boolean, p_consumed boolean, p_gate boolean) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_status = 'CANCELLED' THEN 'cancelled'
    WHEN p_qa = 'REJECTED' THEN 'rejected'
    WHEN p_filled THEN CASE WHEN p_qa = 'RELEASED' THEN 'released' ELSE 'filled' END
    WHEN p_gate AND p_lead IS NULL THEN 'wait_lead'
    WHEN p_gate AND p_qa_ok IS NULL THEN 'wait_qa'
    WHEN p_gate THEN 'working'
    WHEN p_consumed OR p_qa_ok IS NOT NULL THEN 'working'
    WHEN p_lead IS NOT NULL THEN 'wait_qa'
    ELSE 'new'
  END
$$;

-- cổng của mẻ: thêm `stage` (trang mẻ đọc từ đây — cùng hàm với danh sách)
CREATE OR REPLACE FUNCTION public.mes_batch_gate(p_batch_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  b record; v_gate boolean; v_short jsonb; v_missing jsonb; v_scanned int; v_need_log boolean;
  v_block text[] := '{}';
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

  RETURN jsonb_build_object(
    'flow_gate', v_gate, 'lead_ok', b.lead_ok_at IS NOT NULL, 'qa_ok', b.qa_ok_at IS NOT NULL,
    'can_consume', (NOT v_gate) OR (b.lead_ok_at IS NOT NULL AND b.qa_ok_at IS NOT NULL),
    'label_count', b.label_count, 'label_valid', b.label_at IS NOT NULL, 'label_ver', b.label_ver, 'scanned', v_scanned,
    'short', v_short, 'missing', v_missing, 'need_log', v_need_log,
    'fill_blockers', CASE WHEN v_gate THEN to_jsonb(v_block) ELSE '[]'::jsonb END,
    'stage', mes_batch_stage(b.status, b.qa_status, b.lead_ok_at, b.qa_ok_at,
               EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = b.id AND mv.kind = 'FILL'),
               EXISTS (SELECT 1 FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL), v_gate));
END $$;

-- danh sách mẻ: tình trạng ở từng dòng · ô tổng đếm theo tình trạng · lọc theo tình trạng (thay lọc Trạng thái + QA)
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

-- ─── 3. Phiếu theo dõi: ghi từng ô ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_log_cell(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  b record; l record; f record;
  v_form   text := p->>'form';
  v_op     text := coalesce(nullif(p->>'op', ''), 'set');
  v_key    text := nullif(p->>'key', '');
  v_hasval boolean := (p ? 'value') AND jsonb_typeof(p->'value') = 'string';
  v_val    text := btrim(coalesce(p->>'value', ''));
  v_who    text := p->>'actor_name';
  v_hhmm   text := to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI');
  v_blocks jsonb; v_data jsonb; v_stamps jsonb; v_kind text; v_err text; v_old text; v_m text[];
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  -- một người ghi một lúc trên MỘT phiếu của mẻ (các phiếu / mẻ khác không chờ nhau)
  PERFORM pg_advisory_xact_lock(hashtext('mes_log:' || b.id || ':' || coalesce(v_form, '')));
  v_err := mes_batch_form_error(b.id, v_form);   -- mẻ huỷ · mẫu không có / đã ngưng · phiếu bổ sung chưa thêm vào mẻ
  IF v_err IS NOT NULL THEN RAISE EXCEPTION 'MESERR:%', v_err; END IF;
  SELECT * INTO f FROM production_process_form WHERE code = v_form;
  SELECT * INTO l FROM batch_process_log WHERE batch_id = b.id AND form = v_form FOR UPDATE;
  IF l.id IS NOT NULL AND l.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'MESERR:PROCESS_LOG_CONFIRMED|Phiếu đã được QA xác nhận — bỏ xác nhận rồi mới ghi được';
  END IF;
  v_blocks := COALESCE(l.blocks, f.blocks, '[]'::jsonb);
  v_data   := COALESCE(l.data, '{}'::jsonb);
  v_stamps := COALESCE(l.stamps, '{}'::jsonb);
  IF l.id IS NULL THEN
    -- phiếu mới: điền sẵn những gì mẻ đã biết (ô khai "điền sẵn" ở mẫu) — cùng luật form cũ
    SELECT v_data || COALESCE(jsonb_object_agg(fld->>'key',
             CASE fld->>'prefill' WHEN 'machine_code' THEN b.machine_code ELSE replace(trim_scale(b.planned_qty)::text, '.', ',') END), '{}'::jsonb)
      INTO v_data
      FROM jsonb_array_elements(v_blocks) blk,
           jsonb_array_elements(CASE WHEN blk->>'type' = 'fields' THEN blk->'fields' ELSE '[]'::jsonb END) fld
     WHERE (fld->>'prefill' = 'machine_code' AND nullif(btrim(b.machine_code), '') IS NOT NULL)
        OR (fld->>'prefill' = 'planned_qty' AND b.planned_qty IS NOT NULL);
  END IF;

  IF v_op = 'start' THEN
    -- BẮT ĐẦU: mốc giờ đầu tiên của phiếu (ô Giờ đầu tiên của các nhóm ô, theo thứ tự trên mẫu)
    SELECT fld.v->>'key' INTO v_key
      FROM jsonb_array_elements(v_blocks) WITH ORDINALITY AS blk(v, bi),
           jsonb_array_elements(CASE WHEN blk.v->>'type' = 'fields' THEN blk.v->'fields' ELSE '[]'::jsonb END) WITH ORDINALITY AS fld(v, fi)
     WHERE fld.v->>'kind' = 'time'
     ORDER BY blk.bi, fld.fi LIMIT 1;
    IF v_key IS NOT NULL AND COALESCE(btrim(v_data->>v_key), '') = '' THEN
      v_data := v_data || jsonb_build_object(v_key, v_hhmm);
      v_stamps := v_stamps || jsonb_build_object(v_key, jsonb_build_object('by', v_who, 'at', now()));
    ELSIF l.id IS NOT NULL THEN
      RETURN jsonb_build_object('key', v_key, 'value', v_data->>v_key, 'changed', false);   -- đã bắt đầu từ trước
    END IF;
  ELSE
    IF v_key IS NULL THEN RAISE EXCEPTION 'MESERR:KEY|Thiếu mã ô'; END IF;
    -- loại ô: ô của nhóm ô, hoặc ô của bảng theo dõi (<bảng>_<lần>_<cột>_<ô>)
    SELECT fld->>'kind' INTO v_kind
      FROM jsonb_array_elements(v_blocks) blk,
           jsonb_array_elements(CASE WHEN blk->>'type' = 'fields' THEN blk->'fields' ELSE '[]'::jsonb END) fld
     WHERE fld->>'key' = v_key LIMIT 1;
    IF v_kind IS NULL THEN
      v_m := regexp_match(v_key, '^([a-z][a-z0-9]{0,11})_([0-9]{1,2})_([a-z0-9]{1,8})_([a-z0-9]{1,8})$');
      IF v_m IS NOT NULL THEN
        SELECT c->>'kind' INTO v_kind
          FROM jsonb_array_elements(v_blocks) blk,
               jsonb_array_elements(CASE WHEN blk->>'type' = 'grid' THEN blk->'cells' ELSE '[]'::jsonb END) c
         WHERE blk->>'key' = v_m[1] AND v_m[2]::int BETWEEN 1 AND (blk->>'rows')::int AND c->>'key' = v_m[4]
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(blk->'cols') co WHERE co->>'key' = v_m[3])
         LIMIT 1;
      END IF;
    END IF;
    IF v_kind IS NULL THEN RAISE EXCEPTION 'MESERR:KEY|Phiếu không có ô này (mẫu vừa đổi?) — tải lại phiếu'; END IF;
    v_old := COALESCE(btrim(v_data->>v_key), '');
    IF NOT v_hasval THEN
      -- BẤM Ô GIỜ = giờ máy chủ + người bấm. Ô đã có giờ ⇒ báo (hai người cùng bấm / bấm đúp) — sửa giờ thì nhập giờ
      IF v_kind <> 'time' THEN RAISE EXCEPTION 'MESERR:KIND|Ô này không phải ô giờ — nhập giá trị'; END IF;
      IF v_old <> '' THEN RAISE EXCEPTION 'MESERR:ALREADY|Ô này đã ghi lúc % — bấm vào ô để sửa giờ', v_old; END IF;
      v_val := v_hhmm;
      v_stamps := v_stamps || jsonb_build_object(v_key, jsonb_build_object('by', v_who, 'at', now()));
    ELSE
      IF length(v_val) > 300 THEN RAISE EXCEPTION 'MESERR:TOO_LONG|Tối đa 300 ký tự'; END IF;
      IF v_kind = 'time' AND v_val <> '' AND v_val !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION 'MESERR:TIME|Giờ ghi dạng HH:MM (vd 08:30)';
      END IF;
      IF v_val = v_old THEN RETURN jsonb_build_object('key', v_key, 'value', v_val, 'changed', false); END IF;
      -- ô trống ⇒ người ghi + lúc ghi; ô đã có ⇒ giữ người ghi đầu, thêm người sửa + lúc sửa (lưu vết, luật 17/11)
      v_stamps := v_stamps || jsonb_build_object(v_key, CASE WHEN v_old = '' THEN jsonb_build_object('by', v_who, 'at', now())
                    ELSE COALESCE(v_stamps->v_key, '{}'::jsonb) || jsonb_build_object('edited_by', v_who, 'edited_at', now()) END);
    END IF;
    v_data := CASE WHEN v_val = '' THEN v_data - v_key ELSE v_data || jsonb_build_object(v_key, v_val) END;
  END IF;

  IF l.id IS NULL THEN
    INSERT INTO batch_process_log (id, batch_id, form, data, stamps, created_by_name, updated_by_name, created_at, updated_at)
    VALUES (gen_random_uuid()::text, b.id, v_form, v_data, v_stamps, v_who, v_who, now(), now());
  ELSE
    UPDATE batch_process_log SET data = v_data, stamps = v_stamps, updated_by_name = v_who, updated_at = now() WHERE id = l.id;
  END IF;
  RETURN jsonb_build_object('key', v_key, 'value', v_data->>v_key, 'changed', true);
END $$;

DROP FUNCTION IF EXISTS public.mes_log_stamp(jsonb);

-- Lưới: không còn mẻ CLOSED; hàm tình trạng trả đúng các ca chính
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM production_batch WHERE status NOT IN ('OPEN', 'CANCELLED')) THEN RAISE EXCEPTION 'còn mẻ ở trạng thái ngoài OPEN / CANCELLED'; END IF;
  IF mes_batch_stage('OPEN', 'HOLD', NULL, NULL, false, false, true) <> 'wait_lead'
     OR mes_batch_stage('OPEN', 'HOLD', now(), NULL, false, true, true) <> 'wait_qa'
     OR mes_batch_stage('OPEN', 'HOLD', now(), now(), false, true, true) <> 'working'
     OR mes_batch_stage('OPEN', 'HOLD', now(), now(), true, true, true) <> 'filled'
     OR mes_batch_stage('OPEN', 'RELEASED', now(), now(), true, true, true) <> 'released'
     OR mes_batch_stage('OPEN', 'REJECTED', now(), now(), true, true, true) <> 'rejected'
     OR mes_batch_stage('CANCELLED', 'HOLD', NULL, NULL, false, false, true) <> 'cancelled'
     OR mes_batch_stage('OPEN', 'HOLD', NULL, NULL, false, false, false) <> 'new'
     OR mes_batch_stage('OPEN', 'HOLD', NULL, NULL, false, true, false) <> 'working'
     OR mes_batch_stage('OPEN', 'HOLD', now(), NULL, false, false, false) <> 'wait_qa' THEN
    RAISE EXCEPTION 'mes_batch_stage trả sai';
  END IF;
END $$;

COMMIT;
