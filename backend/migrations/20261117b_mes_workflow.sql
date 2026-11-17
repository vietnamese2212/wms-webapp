-- MES 17/11 — LUỒNG LÀM VIỆC CỦA MẺ (user chốt 10 điểm, 17–17/11):
--   1. Mẻ có SỐ MẺ (4 số) + BỒN ngay lúc tạo. Mã lô tự ghép: <chữ nhà máy><chu kỳ><số mẻ 4 số><mã bồn> (vd B300001BD62) — không gõ tay.
--      Chữ nhà máy = Warehouse.nmsx_code của kho chế biến, trống thì lấy của kho cha.
--   2. Đổi bồn tại mẻ (trước khi nạp) ⇒ mã lô đổi theo, tem đã in mất hiệu lực (in lại).
--   3. Hai bước duyệt phiếu: trưởng ca → QA. Kho bật `mes_flow_gate` thì chưa đủ hai duyệt không cấp được nguyên liệu.
--   4. QA đạt / không đạt bấm ở BỒN (áp cho mọi mẻ đang có trong bồn) — không còn bấm ở mẻ.
--   5. Tạo mẻ / đổi bồn chặn khi bồn đang chứa (hoặc đã đặt cho) mã khác, hoặc chỗ trống < kế hoạch (tính cả mẻ đã đặt bồn mà chưa nạp).
--   7. Ô giờ trên phiếu = nút bấm ghi giờ + người (stamps). Ô đánh dấu `required` phải ghi trước khi nạp bồn.
--   8. Tem pallet của mẻ i/n (QR `MEB;<mã lô>;<i>;<n>;<bản tem>`), đổi số pallet ⇒ bản tem mới.
--   9. Nạp bồn (kho bật cờ): quét đủ n/n tem tại đúng bồn + không nguyên liệu nào dưới mức lệch + đủ ô bắt buộc.
-- Cờ `Warehouse.mes_flow_gate` mặc định false = hành vi cũ (đa đơn vị: khác biệt bằng cờ).
BEGIN;

ALTER TABLE public."Warehouse" ADD COLUMN IF NOT EXISTS mes_flow_gate boolean NOT NULL DEFAULT false;

ALTER TABLE public.production_batch
  ADD COLUMN IF NOT EXISTS batch_no        integer CHECK (batch_no IS NULL OR batch_no BETWEEN 1 AND 9999),
  ADD COLUMN IF NOT EXISTS tank_id         text REFERENCES public.production_tank(id),
  ADD COLUMN IF NOT EXISTS lead_ok_at      timestamptz,
  ADD COLUMN IF NOT EXISTS lead_ok_by      text,
  ADD COLUMN IF NOT EXISTS lead_ok_by_name text,
  ADD COLUMN IF NOT EXISTS qa_ok_at        timestamptz,
  ADD COLUMN IF NOT EXISTS qa_ok_by        text,
  ADD COLUMN IF NOT EXISTS qa_ok_by_name   text,
  ADD COLUMN IF NOT EXISTS label_count     integer CHECK (label_count IS NULL OR label_count BETWEEN 1 AND 99),
  ADD COLUMN IF NOT EXISTS label_ver       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS label_at        timestamptz,
  ADD COLUMN IF NOT EXISTS label_by_name   text;
CREATE UNIQUE INDEX IF NOT EXISTS production_batch_cycle_no_uq ON public.production_batch (warehouse_id, cycle, batch_no)
  WHERE status <> 'CANCELLED' AND batch_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prod_batch_tank ON public.production_batch (tank_id) WHERE tank_id IS NOT NULL;

ALTER TABLE public.batch_process_log ADD COLUMN IF NOT EXISTS stamps jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(stamps) = 'object');

-- Lần quét tem pallet của mẻ tại bồn (đổ bồn). Thuộc hồ sơ lô ⇒ không lưu trữ / xoá theo hạn.
CREATE TABLE IF NOT EXISTS public.batch_pour_scan (
  id              text PRIMARY KEY,
  batch_id        text NOT NULL REFERENCES public.production_batch(id),
  label_ver       integer NOT NULL,
  pallet_no       integer NOT NULL CHECK (pallet_no BETWEEN 1 AND 99),
  tank_id         text NOT NULL REFERENCES public.production_tank(id),
  scanned_by      text,
  scanned_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL,
  UNIQUE (batch_id, label_ver, pallet_no)
);
ALTER TABLE public.batch_pour_scan ENABLE ROW LEVEL SECURITY;

-- ─── chữ nhà máy + mã lô ────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_plant_letter(p_wh text) RETURNS text
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT upper(regexp_replace(coalesce(nullif(btrim(w.nmsx_code), ''), nullif(btrim(pw.nmsx_code), ''), ''), '[^A-Za-z0-9]', '', 'g'))
    FROM "Warehouse" w LEFT JOIN "Warehouse" pw ON pw.id = w.parent_warehouse_id WHERE w.id = p_wh
$$;

CREATE OR REPLACE FUNCTION public.mes_batch_code(p_wh text, p_cycle text, p_no integer, p_tank text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE v_plant text := mes_plant_letter(p_wh); v_tank text;
BEGIN
  IF coalesce(v_plant, '') = '' THEN
    RAISE EXCEPTION 'MESERR:NO_PLANT|Kho chưa khai "Mã NMSX" (chữ nhà máy trong mã lô) — khai ở Cài đặt WMS → Kho (kho chế biến hoặc kho nhà máy của nó)';
  END IF;
  IF p_cycle IS NULL OR p_cycle !~ '^[A-Z0-9]{1,6}$' THEN RAISE EXCEPTION 'MESERR:CYCLE|Chu kỳ gồm 1–6 chữ / số, viết liền'; END IF;
  IF p_no IS NULL OR p_no < 1 OR p_no > 9999 THEN RAISE EXCEPTION 'MESERR:BATCH_NO|Số mẻ từ 1 đến 9999'; END IF;
  SELECT code INTO v_tank FROM production_tank WHERE id = p_tank;
  IF v_tank IS NULL THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy bồn'; END IF;
  RETURN v_plant || p_cycle || lpad(p_no::text, 4, '0') || v_tank;
END $$;

-- Bồn nhận được mẻ này không: cùng kho · đang dùng · cùng đơn vị · không chứa / không đặt cho mã khác · đủ chỗ cho kế hoạch.
-- Gọi SAU khi đã khoá dòng bồn. Trả chỗ trống (đã trừ các mẻ khác đặt bồn này mà chưa nạp đủ).
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
  SELECT COALESCE(sum(greatest(ob.planned_qty - COALESCE((SELECT sum(mv.qty) FROM tank_movement mv WHERE mv.batch_id = ob.id AND mv.kind = 'FILL'), 0), 0)), 0)
    INTO v_res FROM production_batch ob
   WHERE ob.tank_id = t.id AND ob.status = 'OPEN' AND ob.planned_qty IS NOT NULL AND ob.id IS DISTINCT FROM p_exclude;
  v_free := t.capacity - v_cur - v_res;
  IF p_planned IS NOT NULL AND p_planned > v_free THEN
    RAISE EXCEPTION 'MESERR:OVER_CAPACITY|Bồn % chỉ còn chỗ cho % % (sức chứa %, đang chứa %, mẻ khác đã đặt %) — kế hoạch % không vừa',
      t.code, greatest(v_free, 0), t.unit, t.capacity, v_cur, v_res, p_planned;
  END IF;
  RETURN v_free;
END $$;

-- MỞ MẺ: khoá bồn ⇒ kiểm chỗ + sinh mã lô + ghi mẻ trong một giao dịch. batch_no trống ⇒ số kế tiếp trong chu kỳ.
CREATE OR REPLACE FUNCTION public.mes_batch_create(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_wh    text := p->>'warehouse_id';
  v_cycle text := upper(btrim(coalesce(p->>'cycle', '')));
  v_no    integer := nullif(p->>'batch_no', '')::integer;
  v_tank  text := p->>'tank_id';
  v_plan  numeric := nullif(p->>'planned_qty', '')::numeric;
  v_code  text;
  v_id    text := gen_random_uuid()::text;
  v_dup   text;
BEGIN
  PERFORM 1 FROM production_tank WHERE id = v_tank FOR UPDATE;
  PERFORM mes_tank_room_check(v_tank, v_wh, p->>'material_id', v_plan, NULL);
  IF v_no IS NULL THEN
    SELECT COALESCE(max(batch_no), 0) + 1 INTO v_no FROM production_batch WHERE warehouse_id = v_wh AND cycle = v_cycle AND status <> 'CANCELLED';
  END IF;
  v_code := mes_batch_code(v_wh, v_cycle, v_no, v_tank);
  SELECT status INTO v_dup FROM production_batch WHERE warehouse_id = v_wh AND batch_code = v_code;
  IF v_dup = 'CANCELLED' THEN RAISE EXCEPTION 'MESERR:CODE_USED|Mã lô % đã dùng cho một mẻ đã huỷ — chọn số mẻ khác', v_code; END IF;
  INSERT INTO production_batch (id, warehouse_id, batch_code, material_id, prod_date, machine_code, shift, cycle, batch_no, tank_id, planned_qty, note,
                                status, qa_status, opened_by, opened_by_name, created_at, updated_at)
  VALUES (v_id, v_wh, v_code, p->>'material_id', (p->>'prod_date')::date, nullif(p->>'machine_code', ''), nullif(p->>'shift', ''), v_cycle, v_no, v_tank,
          v_plan, nullif(p->>'note', ''), 'OPEN', 'HOLD', p->>'actor_id', p->>'actor_name', now(), now());
  UPDATE production_tank SET updated_at = now() WHERE id = v_tank;   -- sơ đồ bồn thấy ngay phần "đã đặt"
  RETURN (SELECT to_jsonb(b) FROM production_batch b WHERE b.id = v_id);
END $$;

-- ĐỔI chu kỳ / số mẻ / bồn của mẻ (trước khi nạp bồn) ⇒ mã lô ghép lại; tem đã in mất hiệu lực.
CREATE OR REPLACE FUNCTION public.mes_batch_identity(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  b       record;
  v_cycle text; v_no integer; v_tank text; v_code text; v_dup text; v_relabel boolean := false;
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF b.status <> 'OPEN' THEN RAISE EXCEPTION 'MESERR:BATCH_STATUS|Mẻ không còn mở — không đổi được chu kỳ / số mẻ / bồn'; END IF;
  IF EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = b.id) THEN
    RAISE EXCEPTION 'MESERR:FILLED|Mẻ đã nạp bồn — mã lô giữ nguyên; muốn đưa sang bồn khác thì dùng "Chuyển bồn" ở trang Bồn';
  END IF;
  v_cycle := CASE WHEN p ? 'cycle' THEN upper(btrim(coalesce(p->>'cycle', ''))) ELSE b.cycle END;
  v_no    := CASE WHEN p ? 'batch_no' THEN nullif(p->>'batch_no', '')::integer ELSE b.batch_no END;
  v_tank  := CASE WHEN p ? 'tank_id' THEN p->>'tank_id' ELSE b.tank_id END;
  IF v_tank IS NULL THEN RAISE EXCEPTION 'MESERR:TANK|Chọn bồn cho mẻ'; END IF;
  PERFORM 1 FROM production_tank WHERE id IN (v_tank, coalesce(b.tank_id, v_tank)) ORDER BY id FOR UPDATE;
  IF v_tank IS DISTINCT FROM b.tank_id THEN PERFORM mes_tank_room_check(v_tank, b.warehouse_id, b.material_id, b.planned_qty, b.id); END IF;
  v_code := mes_batch_code(b.warehouse_id, v_cycle, v_no, v_tank);
  IF v_code <> b.batch_code THEN
    SELECT status INTO v_dup FROM production_batch WHERE warehouse_id = b.warehouse_id AND batch_code = v_code AND id <> b.id;
    IF v_dup IS NOT NULL THEN
      RAISE EXCEPTION 'MESERR:CODE_USED|Mã lô % đã có%', v_code, CASE WHEN v_dup = 'CANCELLED' THEN ' (mẻ đã huỷ) — chọn số mẻ khác' ELSE ' — chọn số mẻ khác' END;
    END IF;
    v_relabel := b.label_at IS NOT NULL;
  END IF;
  UPDATE production_batch SET cycle = v_cycle, batch_no = v_no, tank_id = v_tank, batch_code = v_code,
         label_ver = CASE WHEN v_code <> b.batch_code AND b.label_ver > 0 THEN b.label_ver + 1 ELSE b.label_ver END,
         label_at = CASE WHEN v_code <> b.batch_code THEN NULL ELSE b.label_at END,
         updated_at = now()
   WHERE id = b.id;
  UPDATE production_tank SET updated_at = now() WHERE id IN (v_tank, coalesce(b.tank_id, v_tank));
  RETURN jsonb_build_object('batch_code', v_code, 'old_code', b.batch_code, 'relabel', v_relabel);
END $$;

-- ─── CỔNG CỦA MẺ: một hàm cho màn hình và cho hàm nạp bồn ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_batch_gate(p_batch_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  b record; v_gate boolean; v_short jsonb; v_missing jsonb; v_scanned int; v_logs int; v_need_log boolean;
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
  SELECT count(*) INTO v_logs FROM batch_process_log WHERE batch_id = b.id;
  v_need_log := v_logs = 0 AND EXISTS (
    SELECT 1 FROM production_process_form f, jsonb_array_elements(f.blocks) blk, jsonb_array_elements(CASE WHEN blk->>'type' = 'fields' THEN blk->'fields' ELSE '[]'::jsonb END) fld
     WHERE f.is_active AND (fld->>'required') = 'true');

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
    'fill_blockers', CASE WHEN v_gate THEN to_jsonb(v_block) ELSE '[]'::jsonb END);
END $$;

-- ─── NẠP BỒN: thêm "đúng bồn của mẻ" (luôn) + cổng của mẻ (kho bật cờ) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_tank_fill(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  t       record;
  b       record;
  v_qty   numeric := (p->>'qty')::numeric;
  v_unit  text;
  v_hold  integer;
  v_cur   numeric;
  v_other text;
  v_lot   text;
  v_gate  jsonb;
BEGIN
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Lượng nạp phải lớn hơn 0'; END IF;
  SELECT * INTO t FROM production_tank WHERE id = p->>'tank_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy bồn'; END IF;
  IF NOT t.is_active THEN RAISE EXCEPTION 'MESERR:TANK_INACTIVE|Bồn % đang ngừng dùng', t.code; END IF;
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF b.status = 'CANCELLED' THEN RAISE EXCEPTION 'MESERR:BATCH_CANCELLED|Mẻ đã huỷ'; END IF;
  IF b.qa_status = 'REJECTED' THEN RAISE EXCEPTION 'MESERR:QA_REJECTED|Lô % đã bị QA loại — không nạp vào bồn', b.batch_code; END IF;
  IF b.warehouse_id <> t.warehouse_id THEN RAISE EXCEPTION 'MESERR:WRONG_WAREHOUSE|Bồn % không thuộc kho của mẻ', t.code; END IF;
  IF b.tank_id IS NOT NULL AND b.tank_id <> t.id THEN
    RAISE EXCEPTION 'MESERR:WRONG_TANK|Mẻ % đặt bồn %, không phải bồn % — đổi bồn ở trang mẻ trước khi nạp', b.batch_code,
      (SELECT code FROM production_tank WHERE id = b.tank_id), t.code;
  END IF;
  v_gate := mes_batch_gate(b.id);
  IF jsonb_array_length(v_gate->'fill_blockers') > 0 THEN
    RAISE EXCEPTION 'MESERR:NOT_READY|Chưa nạp bồn được: %', (SELECT string_agg(x, ' · ') FROM jsonb_array_elements_text(v_gate->'fill_blockers') x);
  END IF;
  SELECT upper(coalesce(base_unit, '')), tank_hold_hours INTO v_unit, v_hold FROM "Material" WHERE id = b.material_id;
  IF v_unit <> t.unit THEN
    RAISE EXCEPTION 'MESERR:UNIT|Bồn % tính theo %, mã bán thành phẩm tính theo % — không nạp được', t.code, t.unit, coalesce(nullif(v_unit, ''), '(trống)');
  END IF;
  SELECT m.material_code INTO v_other
    FROM tank_lot l JOIN production_batch ob ON ob.id = l.batch_id JOIN "Material" m ON m.id = ob.material_id
   WHERE l.tank_id = t.id AND l.status = 'ACTIVE' AND ob.material_id <> b.material_id LIMIT 1;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'MESERR:MIX_MATERIAL|Bồn % đang chứa mã % — không trộn mã bán thành phẩm khác vào cùng bồn', t.code, v_other;
  END IF;
  SELECT COALESCE(sum(qty_remaining), 0) INTO v_cur FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE';
  IF v_cur + v_qty > t.capacity THEN
    RAISE EXCEPTION 'MESERR:OVER_CAPACITY|Bồn % chỉ còn chỗ cho % % (sức chứa %, đang chứa %)', t.code, t.capacity - v_cur, t.unit, t.capacity, v_cur;
  END IF;
  SELECT id INTO v_lot FROM tank_lot WHERE tank_id = t.id AND batch_id = b.id AND status = 'ACTIVE' FOR UPDATE;
  IF v_lot IS NULL THEN
    v_lot := gen_random_uuid()::text;
    INSERT INTO tank_lot (id, tank_id, batch_id, qty_in, qty_remaining, filled_at, expires_at, status, created_at, updated_at)
    VALUES (v_lot, t.id, b.id, v_qty, v_qty, now(), CASE WHEN v_hold IS NOT NULL THEN now() + make_interval(hours => v_hold) END, 'ACTIVE', now(), now());
  ELSE
    UPDATE tank_lot SET qty_in = qty_in + v_qty, qty_remaining = qty_remaining + v_qty, updated_at = now() WHERE id = v_lot;
  END IF;
  INSERT INTO tank_movement (id, tank_id, tank_lot_id, batch_id, kind, qty, created_by, created_by_name, created_at, updated_at)
  VALUES (gen_random_uuid()::text, t.id, v_lot, b.id, 'FILL', v_qty, p->>'actor_id', p->>'actor_name', now(), now());
  UPDATE production_tank SET updated_at = now() WHERE id = t.id;   -- tín hiệu realtime cho màn Bồn
  RETURN jsonb_build_object('tank_lot_id', v_lot, 'content', v_cur + v_qty, 'capacity', t.capacity);
END $function$;

-- ─── QA Ở BỒN: kết luận áp cho mọi mẻ đang có trong bồn ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_tank_qa(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE t record; v_st text := p->>'qa_status'; v_note text := nullif(left(btrim(coalesce(p->>'note', '')), 500), ''); v_ids text[]; v_codes text;
BEGIN
  IF v_st NOT IN ('HOLD', 'RELEASED', 'REJECTED') THEN RAISE EXCEPTION 'MESERR:KIND|Kết luận QA không hợp lệ'; END IF;
  IF v_st = 'REJECTED' AND v_note IS NULL THEN RAISE EXCEPTION 'MESERR:REASON|Không đạt phải ghi lý do'; END IF;
  SELECT * INTO t FROM production_tank WHERE id = p->>'tank_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy bồn'; END IF;
  SELECT array_agg(DISTINCT l.batch_id) INTO v_ids FROM tank_lot l WHERE l.tank_id = t.id AND l.status = 'ACTIVE' AND l.qty_remaining > 0;
  IF v_ids IS NULL THEN RAISE EXCEPTION 'MESERR:TANK_EMPTY|Bồn % đang trống — chưa có gì để kết luận', t.code; END IF;
  UPDATE production_batch SET qa_status = v_st, qa_note = v_note, qa_at = now(), qa_by = p->>'actor_id', qa_by_name = p->>'actor_name', updated_at = now()
   WHERE id = ANY(v_ids);
  SELECT string_agg(batch_code, ', ' ORDER BY batch_code) INTO v_codes FROM production_batch WHERE id = ANY(v_ids);
  UPDATE production_tank SET updated_at = now() WHERE id = t.id;
  RETURN jsonb_build_object('batches', cardinality(v_ids), 'batch_codes', v_codes, 'qa_status', v_st);
END $$;

-- ─── PHIẾU: bấm ghi giờ một mốc (giờ máy chủ, giờ Việt Nam) ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_log_stamp(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  b record; l record; f record; v_key text := p->>'key'; v_form text := p->>'form'; v_blocks jsonb; v_ok boolean;
  v_hhmm text := to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI');
  v_stamp jsonb := jsonb_build_object('by', p->>'actor_name', 'at', now());
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF b.status = 'CANCELLED' THEN RAISE EXCEPTION 'MESERR:BATCH_CANCELLED|Mẻ đã huỷ — không ghi phiếu được'; END IF;
  SELECT * INTO f FROM production_process_form WHERE code = v_form;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không có mẫu phiếu này'; END IF;
  SELECT * INTO l FROM batch_process_log WHERE batch_id = b.id AND form = v_form FOR UPDATE;
  IF l.id IS NULL AND NOT f.is_active THEN RAISE EXCEPTION 'MESERR:PROCESS_FORM_INACTIVE|Mẫu phiếu này đã ngưng dùng — bật lại ở Cài đặt MES'; END IF;
  IF l.confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'MESERR:PROCESS_LOG_CONFIRMED|Phiếu đã được QA xác nhận — bỏ xác nhận rồi mới ghi được'; END IF;
  v_blocks := COALESCE(l.blocks, f.blocks);
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_blocks) blk, jsonb_array_elements(CASE WHEN blk->>'type' = 'fields' THEN blk->'fields' ELSE '[]'::jsonb END) fld
                  WHERE fld->>'key' = v_key AND fld->>'kind' = 'time') INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'MESERR:KIND|Ô này không phải mốc giờ của phiếu'; END IF;
  IF l.id IS NULL THEN
    INSERT INTO batch_process_log (id, batch_id, form, data, stamps, created_by_name, updated_by_name, created_at, updated_at)
    VALUES (gen_random_uuid()::text, b.id, v_form, jsonb_build_object(v_key, v_hhmm), jsonb_build_object(v_key, v_stamp), p->>'actor_name', p->>'actor_name', now(), now());
  ELSE
    IF COALESCE(btrim(l.data->>v_key), '') <> '' THEN
      RAISE EXCEPTION 'MESERR:ALREADY|Mốc này đã ghi lúc % — muốn sửa giờ thì mở phiếu', l.data->>v_key;
    END IF;
    UPDATE batch_process_log SET data = data || jsonb_build_object(v_key, v_hhmm), stamps = stamps || jsonb_build_object(v_key, v_stamp),
           updated_by_name = p->>'actor_name', updated_at = now() WHERE id = l.id;
  END IF;
  RETURN jsonb_build_object('key', v_key, 'value', v_hhmm);
END $$;

-- ─── TEM PALLET CỦA MẺ + QUÉT TẠI BỒN ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_batch_labels(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE b record; v_n integer := (p->>'count')::integer; v_gate boolean; v_reprint boolean;
BEGIN
  IF v_n IS NULL OR v_n < 1 OR v_n > 99 THEN RAISE EXCEPTION 'MESERR:QTY|Số pallet từ 1 đến 99'; END IF;
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF b.status <> 'OPEN' THEN RAISE EXCEPTION 'MESERR:BATCH_STATUS|Mẻ không còn mở — không in tem được'; END IF;
  IF b.tank_id IS NULL THEN RAISE EXCEPTION 'MESERR:TANK|Mẻ chưa chọn bồn — chọn bồn rồi mới in tem'; END IF;
  SELECT coalesce(mes_flow_gate, false) INTO v_gate FROM "Warehouse" WHERE id = b.warehouse_id;
  IF v_gate AND (b.lead_ok_at IS NULL OR b.qa_ok_at IS NULL) THEN RAISE EXCEPTION 'MESERR:NOT_APPROVED|Phiếu của mẻ chưa đủ hai bước duyệt — chưa in tem được'; END IF;
  IF EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = b.id AND mv.kind = 'FILL') AND (b.label_at IS NULL OR v_n <> b.label_count) THEN
    RAISE EXCEPTION 'MESERR:FILLED|Mẻ đã nạp bồn — không đổi số pallet được nữa';
  END IF;
  v_reprint := b.label_at IS NOT NULL AND b.label_count = v_n;
  IF NOT v_reprint THEN
    UPDATE production_batch SET label_count = v_n, label_ver = label_ver + 1, label_at = now(), label_by_name = p->>'actor_name', updated_at = now() WHERE id = b.id;
  END IF;
  RETURN (SELECT jsonb_build_object('batch_code', x.batch_code, 'count', x.label_count, 'ver', x.label_ver, 'reprint', v_reprint) FROM production_batch x WHERE x.id = b.id);
END $$;

CREATE OR REPLACE FUNCTION public.mes_pour_scan(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE b record; v_i integer := (p->>'pallet_no')::integer; v_n integer := (p->>'pallet_total')::integer; v_ver integer := (p->>'label_ver')::integer; v_cnt integer;
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF b.status <> 'OPEN' THEN RAISE EXCEPTION 'MESERR:BATCH_STATUS|Mẻ % không còn mở', b.batch_code; END IF;
  IF b.tank_id IS DISTINCT FROM p->>'tank_id' THEN
    RAISE EXCEPTION 'MESERR:WRONG_TANK|SAI BỒN: mẻ % phải đổ vào bồn %, bạn đang đứng ở bồn %', b.batch_code,
      coalesce((SELECT code FROM production_tank WHERE id = b.tank_id), '(chưa chọn)'), coalesce((SELECT code FROM production_tank WHERE id = p->>'tank_id'), '?');
  END IF;
  IF upper(coalesce(p->>'label_code', '')) <> b.batch_code THEN
    RAISE EXCEPTION 'MESERR:WRONG_LABEL|SAI MẺ: tem của mẻ %, không phải mẻ %', coalesce(p->>'label_code', '?'), b.batch_code;
  END IF;
  IF b.label_at IS NULL OR v_ver IS DISTINCT FROM b.label_ver OR v_n IS DISTINCT FROM b.label_count OR v_i IS NULL OR v_i < 1 OR v_i > b.label_count THEN
    RAISE EXCEPTION 'MESERR:LABEL_VOID|Tem này đã mất hiệu lực (mẻ đã in lại bộ tem mới) — dùng bộ tem mới nhất';
  END IF;
  BEGIN
    INSERT INTO batch_pour_scan (id, batch_id, label_ver, pallet_no, tank_id, scanned_by, scanned_by_name, created_at, updated_at)
    VALUES (gen_random_uuid()::text, b.id, b.label_ver, v_i, b.tank_id, p->>'actor_id', p->>'actor_name', now(), now());
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'MESERR:ALREADY|Pallet %/% đã quét rồi', v_i, b.label_count;
  END;
  UPDATE production_batch SET updated_at = now() WHERE id = b.id;   -- trang mẻ thấy ngay số tem đã quét
  SELECT count(*) INTO v_cnt FROM batch_pour_scan WHERE batch_id = b.id AND label_ver = b.label_ver AND tank_id = b.tank_id;
  RETURN jsonb_build_object('pallet_no', v_i, 'scanned', v_cnt, 'total', b.label_count);
END $$;

-- ─── DANH SÁCH MẺ: thêm số mẻ · bồn · hai bước duyệt ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_batch_page(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_wh    text[] := ARRAY(SELECT jsonb_array_elements_text(coalesce(p->'wh_ids', '[]'::jsonb)));
  v_st    text := nullif(p->>'status', '');
  v_qa    text := nullif(p->>'qa', '');
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
    SELECT b.* FROM production_batch b
     WHERE b.warehouse_id = ANY(v_wh)
       AND (v_from IS NULL OR b.prod_date >= v_from) AND (v_to IS NULL OR b.prod_date <= v_to)
       AND (v_q IS NULL OR b.batch_code ILIKE v_like
            OR EXISTS (SELECT 1 FROM "Material" m WHERE m.id = b.material_id AND (m.material_code ILIKE v_like OR m.short_name ILIKE v_like)))
  )
  SELECT jsonb_build_object(
           'total',     count(*) FILTER (WHERE (v_st IS NULL OR status = v_st) AND (v_qa IS NULL OR qa_status = v_qa)),
           'open',      count(*) FILTER (WHERE status = 'OPEN'),
           'closed',    count(*) FILTER (WHERE status = 'CLOSED'),
           'cancelled', count(*) FILTER (WHERE status = 'CANCELLED'),
           'qa_hold',   count(*) FILTER (WHERE qa_status = 'HOLD' AND status <> 'CANCELLED'),
           'qa_released', count(*) FILTER (WHERE qa_status = 'RELEASED' AND status <> 'CANCELLED'),
           'qa_rejected', count(*) FILTER (WHERE qa_status = 'REJECTED' AND status <> 'CANCELLED'))
    INTO v_sum FROM f;

  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'prod_date') DESC, r->>'batch_code' DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
             'id', b.id, 'warehouse_id', b.warehouse_id, 'warehouse_name', w.name, 'batch_code', b.batch_code,
             'material_id', b.material_id, 'material_code', m.material_code, 'material_name', m.short_name, 'base_unit', m.base_unit,
             'machine_code', b.machine_code, 'shift', b.shift, 'cycle', b.cycle, 'batch_no', b.batch_no, 'tank_id', b.tank_id, 'tank_code', tk.code,
             'lead_ok_at', b.lead_ok_at, 'qa_ok_at', b.qa_ok_at,
             'prod_date', b.prod_date, 'planned_qty', b.planned_qty,
             'status', b.status, 'qa_status', b.qa_status, 'qa_at', b.qa_at, 'qa_by_name', b.qa_by_name,
             'note', b.note, 'opened_by_name', b.opened_by_name, 'created_at', b.created_at, 'closed_at', b.closed_at,
             'rm_lines', (SELECT count(*) FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL),
             'rm_materials', (SELECT count(DISTINCT c.material_id) FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL),
             'filled', (SELECT COALESCE(sum(mv.qty), 0) FROM tank_movement mv WHERE mv.batch_id = b.id AND mv.kind = 'FILL'),
             'in_tank', (SELECT COALESCE(sum(l.qty_remaining), 0) FROM tank_lot l WHERE l.batch_id = b.id AND l.status = 'ACTIVE')
           ) AS r
      FROM production_batch b
      JOIN "Warehouse" w ON w.id = b.warehouse_id
      JOIN "Material" m ON m.id = b.material_id
      LEFT JOIN production_tank tk ON tk.id = b.tank_id
     WHERE b.warehouse_id = ANY(v_wh)
       AND (v_st IS NULL OR b.status = v_st) AND (v_qa IS NULL OR b.qa_status = v_qa)
       AND (v_from IS NULL OR b.prod_date >= v_from) AND (v_to IS NULL OR b.prod_date <= v_to)
       AND (v_q IS NULL OR b.batch_code ILIKE v_like OR m.material_code ILIKE v_like OR m.short_name ILIKE v_like)
     ORDER BY b.prod_date DESC, b.batch_code DESC
     OFFSET (v_page - 1) * v_size LIMIT v_size
  ) s;
  RETURN jsonb_build_object('rows', v_rows, 'summary', v_sum, 'page', v_page, 'page_size', v_size);
END $function$;

-- ─── QUYỀN MỚI (cấp theo năng lực; đã có thì không đè) ──────────────────────────────────────────────────────────
--   approve_lead (trưởng ca duyệt phiếu) ← người mở mẻ · approve_qa + print_label ← người QA lô · pour (quét tem đổ bồn) ← người thao tác bồn
UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(j.module_permissions, '{production}',
         (SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements(
            (j.module_permissions->'production')
            || CASE WHEN j.module_permissions->'production' ? 'open_batch' THEN '["approve_lead"]'::jsonb ELSE '[]'::jsonb END
            || CASE WHEN j.module_permissions->'production' ? 'qa_release' THEN '["approve_qa","print_label"]'::jsonb ELSE '[]'::jsonb END
            || CASE WHEN j.module_permissions->'production' ? 'tank_ops'   THEN '["pour"]'::jsonb ELSE '[]'::jsonb END) x), true),
       updated_at = now()
 WHERE jsonb_typeof(j.module_permissions->'production') = 'array'
   AND (j.module_permissions->'production' ? 'open_batch' OR j.module_permissions->'production' ? 'qa_release' OR j.module_permissions->'production' ? 'tank_ops');

COMMIT;
