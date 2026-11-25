-- Rà soát MES 25/11 (docs/plans/MES_REVIEW_2026-11-25.md) — ĐỢT 4: sơ đồ bồn + dashboard Báo cáo NVL.
--   B1  Mẻ nạp bồn rồi vẫn OPEN mãi (không còn "đóng mẻ") ⇒ listTanks lấy mẻ OPEN theo created_at TĂNG + limit(1000) (và FILL limit(5000)
--       bị PostgREST cắt ~1.000) ⇒ sau ~1.000 mẻ sơ đồ bồn mất mẻ MỚI. Nay: cột production_batch.first_filled_at (trigger khi có dòng
--       FILL — sổ bồn chỉ ghi thêm) + chỉ mục một phần (tank_id) WHERE status = 'OPEN' AND first_filled_at IS NULL ⇒ "mẻ đang giữ chỗ
--       của bồn" là MỘT hàm mes_tank_incoming, đọc theo số mẻ ĐANG chờ chứ không theo lịch sử nhiều năm. mes_tank_room_check ·
--       mes_tank_transfer · mes_tank_update · listTanks cùng dùng luật này (trước: bốn chỗ viết NOT EXISTS FILL riêng).
--   B5  mes_dash_batches / mes_dash_lines lọc COALESCE(prod_date, …) trên cột NOT NULL ⇒ PG không dùng phần ngày của chỉ mục, quét mọi mẻ
--       của kho mỗi lần mở dashboard ⇒ lọc thẳng prod_date.
--   B7  Thẻ "Sửa phiếu" / "Cấp lệch" cộng cả dòng trong dung sai (state ok) nhưng sổ dòng chỉ lưu over / under / extra ⇒ bấm vào ra thiếu
--       dòng. Nay sổ dòng (production_batch_dev_line) lưu thêm dòng ok có sửa phiếu hoặc cấp khác phiếu — luật MỘT hàm mes_dev_line_keep
--       cho cả lúc dựng fact lẫn phần mẻ chưa nạp; mọi chỗ đọc sổ như "dòng lệch" (pareto, ngoại lệ, bảng chi tiết không lọc) lọc lại
--       state IN (over, under, extra). Dựng lại fact của mọi mẻ đã nạp.
BEGIN;

-- ── B1: dấu lần nạp đầu ──
ALTER TABLE public.production_batch ADD COLUMN IF NOT EXISTS first_filled_at timestamptz;
UPDATE public.production_batch b SET first_filled_at = x.at
  FROM (SELECT batch_id, min(created_at) AS at FROM public.tank_movement WHERE kind = 'FILL' AND batch_id IS NOT NULL GROUP BY batch_id) x
 WHERE b.id = x.batch_id AND b.first_filled_at IS DISTINCT FROM x.at;
CREATE OR REPLACE FUNCTION public.mes_batch_first_fill() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  UPDATE production_batch SET first_filled_at = NEW.created_at WHERE id = NEW.batch_id AND first_filled_at IS NULL;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_mes_batch_first_fill ON public.tank_movement;
CREATE TRIGGER trg_mes_batch_first_fill AFTER INSERT ON public.tank_movement
  FOR EACH ROW WHEN (NEW.kind = 'FILL' AND NEW.batch_id IS NOT NULL) EXECUTE FUNCTION public.mes_batch_first_fill();
CREATE INDEX IF NOT EXISTS idx_prod_batch_tank_waiting ON public.production_batch (tank_id) WHERE status = 'OPEN' AND first_filled_at IS NULL;

-- ── B1: MỘT luật "mẻ đang giữ chỗ của bồn" (mở, đã đặt bồn, chưa nạp lần nào) ──
CREATE OR REPLACE FUNCTION public.mes_tank_incoming(p_tank_ids text[])
RETURNS TABLE(batch_id text, tank_id text, material_id text, material_code text, short_name text, batch_code text, cycle text, batch_no integer,
              planned_qty numeric, shift text, created_at timestamptz)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT ob.id, ob.tank_id, ob.material_id, m.material_code, m.short_name, ob.batch_code, ob.cycle, ob.batch_no, ob.planned_qty, ob.shift, ob.created_at
    FROM production_batch ob LEFT JOIN "Material" m ON m.id = ob.material_id
   WHERE ob.tank_id = ANY(p_tank_ids) AND ob.status = 'OPEN' AND ob.first_filled_at IS NULL
   ORDER BY ob.created_at
$$;
REVOKE ALL ON FUNCTION public.mes_tank_incoming(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_tank_incoming(text[]) TO service_role;

-- ── B7: MỘT luật "dòng nào vào sổ dòng của dashboard" ──
CREATE OR REPLACE FUNCTION public.mes_dev_line_keep(p_state text, p_std numeric, p_sheet numeric, p_iss numeric) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_state IN ('over', 'under', 'extra')
      OR (p_state NOT IN ('progress', 'none') AND (p_sheet IS DISTINCT FROM p_std OR p_iss IS DISTINCT FROM p_sheet))
$$;
ALTER TABLE public.production_batch_dev_line DROP CONSTRAINT IF EXISTS production_batch_dev_line_state_check;
ALTER TABLE public.production_batch_dev_line ADD CONSTRAINT production_batch_dev_line_state_check CHECK (state IN ('over', 'under', 'extra', 'ok'));

CREATE OR REPLACE FUNCTION public.mes_tank_room_check(p_tank text, p_wh text, p_material text, p_planned numeric, p_exclude text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  SELECT x.batch_code INTO v_other FROM mes_tank_incoming(ARRAY[t.id]) x
   WHERE x.material_id <> p_material AND x.batch_id IS DISTINCT FROM p_exclude LIMIT 1;
  IF v_other IS NOT NULL THEN RAISE EXCEPTION 'MESERR:MIX_MATERIAL|Bồn % đã đặt cho mẻ % (mã khác) — chọn bồn khác', t.code, v_other; END IF;
  SELECT COALESCE(sum(qty_remaining), 0) INTO v_cur FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE';
  SELECT COALESCE(sum(x.planned_qty), 0) INTO v_res FROM mes_tank_incoming(ARRAY[t.id]) x
   WHERE x.planned_qty IS NOT NULL AND x.batch_id IS DISTINCT FROM p_exclude;
  v_free := t.capacity - v_cur - v_res;
  IF p_planned IS NOT NULL AND p_planned > v_free THEN
    RAISE EXCEPTION 'MESERR:OVER_CAPACITY|Bồn % chỉ còn chỗ cho % % (sức chứa %, đang chứa %, mẻ khác đã đặt %) — kế hoạch % không vừa',
      t.code, greatest(v_free, 0), t.unit, t.capacity, v_cur, v_res, p_planned;
  END IF;
  RETURN v_free;
END $function$;

CREATE OR REPLACE FUNCTION public.mes_tank_transfer(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  a       record;
  b       record;
  part    jsonb;
  v_qty   numeric := (p->>'qty')::numeric;
  v_cur   numeric;
  v_other text;
  v_mat   text;
  v_take  jsonb;
  v_lot   text;
BEGIN
  IF p->>'from_tank_id' = p->>'to_tank_id' THEN RAISE EXCEPTION 'MESERR:SAME_TANK|Chọn hai bồn khác nhau'; END IF;
  -- khoá hai bồn theo thứ tự id ⇒ hai lệnh chuyển ngược chiều không khoá chéo nhau
  PERFORM 1 FROM production_tank WHERE id IN (p->>'from_tank_id', p->>'to_tank_id') ORDER BY id FOR UPDATE;
  SELECT * INTO a FROM production_tank WHERE id = p->>'from_tank_id';
  SELECT * INTO b FROM production_tank WHERE id = p->>'to_tank_id';
  IF a.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy bồn'; END IF;
  IF NOT b.is_active THEN RAISE EXCEPTION 'MESERR:TANK_INACTIVE|Bồn % đang ngừng dùng', b.code; END IF;
  IF a.warehouse_id <> b.warehouse_id THEN RAISE EXCEPTION 'MESERR:WRONG_WAREHOUSE|Hai bồn phải cùng một kho'; END IF;
  IF a.unit <> b.unit THEN RAISE EXCEPTION 'MESERR:UNIT|Hai bồn khác đơn vị (% / %)', a.unit, b.unit; END IF;
  SELECT DISTINCT ob.material_id INTO v_mat FROM tank_lot l JOIN production_batch ob ON ob.id = l.batch_id
   WHERE l.tank_id = a.id AND l.status = 'ACTIVE' LIMIT 1;
  SELECT m.material_code INTO v_other FROM tank_lot l JOIN production_batch ob ON ob.id = l.batch_id JOIN "Material" m ON m.id = ob.material_id
   WHERE l.tank_id = b.id AND l.status = 'ACTIVE' AND ob.material_id <> v_mat LIMIT 1;
  IF v_other IS NOT NULL THEN RAISE EXCEPTION 'MESERR:MIX_MATERIAL|Bồn % đang chứa mã % — không trộn mã khác', b.code, v_other; END IF;
  -- 25/11 (B6): bồn đích đã đặt cho mẻ CHƯA NẠP mang mã khác (mẻ gắn bồn từ lúc mở, tem in theo bồn) ⇒ chặn, như lúc mở mẻ
  SELECT ob.batch_code INTO v_other FROM production_batch ob
   WHERE ob.tank_id = b.id AND ob.status = 'OPEN' AND ob.material_id <> v_mat
     AND ob.first_filled_at IS NULL LIMIT 1;
  IF v_other IS NOT NULL THEN RAISE EXCEPTION 'MESERR:MIX_MATERIAL|Bồn % đã đặt cho mẻ % (mã khác) — chọn bồn khác', b.code, v_other; END IF;
  SELECT COALESCE(sum(qty_remaining), 0) INTO v_cur FROM tank_lot WHERE tank_id = b.id AND status = 'ACTIVE';
  IF v_cur + v_qty > b.capacity THEN
    RAISE EXCEPTION 'MESERR:OVER_CAPACITY|Bồn % chỉ còn chỗ cho % %', b.code, b.capacity - v_cur, b.unit;
  END IF;
  v_take := mes_tank_take(jsonb_build_object('tank_id', a.id, 'qty', v_qty, 'kind', 'TRANSFER_OUT', 'ref_tank_id', b.id,
              'reason', p->>'reason', 'actor_id', p->>'actor_id', 'actor_name', p->>'actor_name'));
  FOR part IN SELECT * FROM jsonb_array_elements(v_take->'parts') LOOP
    SELECT id INTO v_lot FROM tank_lot WHERE tank_id = b.id AND batch_id = part->>'batch_id' AND status = 'ACTIVE' FOR UPDATE;
    IF v_lot IS NULL THEN
      v_lot := gen_random_uuid()::text;
      INSERT INTO tank_lot (id, tank_id, batch_id, qty_in, qty_remaining, filled_at, expires_at, status, created_at, updated_at)
      VALUES (v_lot, b.id, part->>'batch_id', (part->>'qty')::numeric, (part->>'qty')::numeric,
              (part->>'filled_at')::timestamptz, nullif(part->>'expires_at', '')::timestamptz, 'ACTIVE', now(), now());
    ELSE
      UPDATE tank_lot SET qty_in = qty_in + (part->>'qty')::numeric, qty_remaining = qty_remaining + (part->>'qty')::numeric,
             -- trộn với phần cũ hơn ⇒ hạn lưu theo phần CŨ NHẤT (đi kèm sớm nhất)
             filled_at = LEAST(filled_at, (part->>'filled_at')::timestamptz),
             expires_at = CASE WHEN expires_at IS NULL THEN nullif(part->>'expires_at', '')::timestamptz
                               WHEN nullif(part->>'expires_at', '') IS NULL THEN expires_at
                               ELSE LEAST(expires_at, (part->>'expires_at')::timestamptz) END,
             updated_at = now() WHERE id = v_lot;
    END IF;
    INSERT INTO tank_movement (id, tank_id, tank_lot_id, batch_id, kind, qty, ref_tank_id, reason, created_by, created_by_name, created_at, updated_at)
    VALUES (gen_random_uuid()::text, b.id, v_lot, part->>'batch_id', 'TRANSFER_IN', (part->>'qty')::numeric, a.id,
            nullif(left(btrim(coalesce(p->>'reason', '')), 500), ''), p->>'actor_id', p->>'actor_name', now(), now());
  END LOOP;
  UPDATE production_tank SET updated_at = now() WHERE id = b.id;
  RETURN jsonb_build_object('parts', v_take->'parts');
END $function$;

CREATE OR REPLACE FUNCTION public.mes_tank_update(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  t      record;
  v_cur  numeric;
  v_code text;
BEGIN
  SELECT * INTO t FROM production_tank WHERE id = p->>'tank_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy bồn'; END IF;
  SELECT COALESCE(sum(qty_remaining), 0) INTO v_cur FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE';
  SELECT ob.batch_code INTO v_code FROM production_batch ob
   WHERE ob.tank_id = t.id AND ob.status = 'OPEN' AND ob.first_filled_at IS NULL
   ORDER BY ob.created_at LIMIT 1;
  IF p ? 'unit' AND p->>'unit' IS DISTINCT FROM t.unit THEN
    IF v_cur > 0 THEN RAISE EXCEPTION 'MESERR:TANK_NOT_EMPTY|Bồn đang có hàng — không đổi đơn vị được'; END IF;
    IF v_code IS NOT NULL THEN RAISE EXCEPTION 'MESERR:TANK_NOT_EMPTY|Bồn đã đặt cho mẻ % (chưa nạp) — không đổi đơn vị được; đổi bồn của mẻ trước', v_code; END IF;
  END IF;
  IF p ? 'capacity' AND (p->>'capacity')::numeric < v_cur THEN
    RAISE EXCEPTION 'MESERR:TANK_NOT_EMPTY|Bồn đang chứa % % — sức chứa không được nhỏ hơn', v_cur, t.unit;
  END IF;
  IF p ? 'is_active' AND NOT coalesce((p->>'is_active')::boolean, true) THEN
    IF v_cur > 0 THEN RAISE EXCEPTION 'MESERR:TANK_NOT_EMPTY|Bồn đang có hàng — rút / chuyển / xả hết trước khi ngừng dùng'; END IF;
    IF v_code IS NOT NULL THEN RAISE EXCEPTION 'MESERR:TANK_NOT_EMPTY|Bồn đã đặt cho mẻ % (chưa nạp) — đổi bồn của mẻ trước khi ngừng dùng', v_code; END IF;
  END IF;
  UPDATE production_tank SET
    name      = CASE WHEN p ? 'name' THEN nullif(btrim(coalesce(p->>'name', '')), '') ELSE name END,
    capacity  = CASE WHEN p ? 'capacity' THEN (p->>'capacity')::numeric ELSE capacity END,
    unit      = CASE WHEN p ? 'unit' THEN p->>'unit' ELSE unit END,
    is_active = CASE WHEN p ? 'is_active' THEN (p->>'is_active')::boolean ELSE is_active END,
    note      = CASE WHEN p ? 'note' THEN nullif(btrim(coalesce(p->>'note', '')), '') ELSE note END,
    updated_at = now(), updated_by = p->>'actor_name'
  WHERE id = t.id;
  RETURN (SELECT to_jsonb(x) FROM production_tank x WHERE x.id = t.id);
END $function$;

CREATE OR REPLACE FUNCTION public.mes_dash_batches(p_wh text, p_from date, p_to date)
 RETURNS TABLE(batch_id text, prod_date date, shift text, btp_id text, batch_code text, batch_no integer, created_at timestamp with time zone, filled_at timestamp with time zone, filled boolean, open_min integer, qa_status text, rm_bad integer, lines integer, pending integer, ok integer, over integer, under integer, extra integer, edited integer, std_kg numeric, sheet_kg numeric, iss_kg numeric, edit_kg numeric, exec_kg numeric, total_kg numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH live AS (
    SELECT pb.* FROM production_batch pb
     WHERE pb.warehouse_id = p_wh AND pb.status <> 'CANCELLED'
       AND pb.prod_date BETWEEN p_from AND p_to
       AND NOT EXISTS (SELECT 1 FROM production_batch_fact f WHERE f.batch_id = pb.id)),
  a AS (SELECT * FROM mes_batch_agg(ARRAY(SELECT id FROM live)))
  SELECT f.batch_id, f.prod_date, f.shift, f.btp_id, f.batch_code, f.batch_no, f.created_at, f.filled_at, true, f.open_min, f.qa_status, f.rm_bad,
         f.lines, f.pending, f.ok, f.over, f.under, f.extra, f.edited, f.std_kg, f.sheet_kg, f.iss_kg, f.edit_kg, f.exec_kg, f.total_kg
    FROM production_batch_fact f WHERE f.warehouse_id = p_wh AND f.prod_date BETWEEN p_from AND p_to
  UNION ALL
  SELECT l.id, COALESCE(l.prod_date, (l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date), NULLIF(btrim(COALESCE(l.shift, '')), ''), l.material_id,
         l.batch_code, l.batch_no, l.created_at, NULL::timestamptz, false, NULL::int, l.qa_status,
         (SELECT count(*) FROM batch_consumption c WHERE c.batch_id = l.id AND c.reversed_at IS NULL AND COALESCE(c.rotation_violation, false))::int,
         COALESCE(a.lines, 0), COALESCE(a.pending, 0), COALESCE(a.ok, 0), COALESCE(a.over, 0), COALESCE(a.under, 0), COALESCE(a.extra, 0), COALESCE(a.edited, 0),
         COALESCE(a.std_kg, 0), COALESCE(a.sheet_kg, 0), COALESCE(a.iss_kg, 0), COALESCE(a.edit_kg, 0), COALESCE(a.exec_kg, 0), COALESCE(a.total_kg, 0)
    FROM live l LEFT JOIN a ON a.batch_id = l.id
$function$;

CREATE OR REPLACE FUNCTION public.mes_dash_lines(p_wh text, p_from date, p_to date)
 RETURNS TABLE(batch_id text, prod_date date, shift text, material_id text, state text, std numeric, sheet numeric, iss numeric, why text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH live AS (
    SELECT pb.id, pb.prod_date AS pd, NULLIF(btrim(COALESCE(pb.shift, '')), '') AS sh
      FROM production_batch pb
     WHERE pb.warehouse_id = p_wh AND pb.status <> 'CANCELLED'
       AND pb.prod_date BETWEEN p_from AND p_to
       AND NOT EXISTS (SELECT 1 FROM production_batch_fact f WHERE f.batch_id = pb.id))
  SELECT d.batch_id, d.prod_date, d.shift, d.material_id, d.state, d.std, d.sheet, d.iss, d.why
    FROM production_batch_dev_line d WHERE d.warehouse_id = p_wh AND d.prod_date BETWEEN p_from AND p_to
  UNION ALL
  SELECT c.batch_id, live.pd, live.sh, c.material_id, c.state, c.std, c.sheet, c.iss, c.why
    FROM live JOIN mes_batch_cells(ARRAY(SELECT id FROM live)) c ON c.batch_id = live.id
   WHERE mes_dev_line_keep(c.state, c.std, c.sheet, c.iss)
$function$;

CREATE OR REPLACE FUNCTION public.mes_batch_fact_build(p_batch text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  b       production_batch%ROWTYPE;
  v_fill  timestamptz;
  v_date  date;
  v_shift text;
BEGIN
  IF p_batch IS NULL THEN RETURN; END IF;
  -- hai giao dịch cùng sửa một mẻ: người sau chờ người trước xong rồi mới đọc ⇒ sổ không bỏ sót lần cấp của ai
  PERFORM pg_advisory_xact_lock(hashtext('mes_batch_fact'), hashtext(p_batch));
  SELECT * INTO b FROM production_batch WHERE id = p_batch;
  IF FOUND THEN SELECT min(mv.created_at) INTO v_fill FROM tank_movement mv WHERE mv.batch_id = p_batch AND mv.kind = 'FILL'; END IF;
  IF NOT FOUND OR b.id IS NULL OR b.status = 'CANCELLED' OR v_fill IS NULL THEN
    DELETE FROM production_batch_dev_line WHERE batch_id = p_batch;
    DELETE FROM production_batch_fact WHERE batch_id = p_batch;
    RETURN;
  END IF;
  v_date := COALESCE(b.prod_date, (b.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);
  v_shift := NULLIF(btrim(COALESCE(b.shift, '')), '');
  INSERT INTO production_batch_fact (batch_id, warehouse_id, prod_date, shift, btp_id, batch_code, batch_no, cycle, created_at, filled_at, open_min,
                                     qa_status, rm_bad, lines, pending, ok, over, under, extra, edited,
                                     std_kg, sheet_kg, iss_kg, edit_kg, exec_kg, total_kg, updated_at)
  SELECT b.id, b.warehouse_id, v_date, v_shift, b.material_id, b.batch_code, b.batch_no, b.cycle, b.created_at, v_fill,
         GREATEST(0, round(extract(epoch FROM (v_fill - b.created_at)) / 60))::int, b.qa_status,
         (SELECT count(*) FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL AND COALESCE(c.rotation_violation, false))::int,
         COALESCE(a.lines, 0), COALESCE(a.pending, 0), COALESCE(a.ok, 0), COALESCE(a.over, 0), COALESCE(a.under, 0), COALESCE(a.extra, 0), COALESCE(a.edited, 0),
         COALESCE(a.std_kg, 0), COALESCE(a.sheet_kg, 0), COALESCE(a.iss_kg, 0), COALESCE(a.edit_kg, 0), COALESCE(a.exec_kg, 0), COALESCE(a.total_kg, 0), now()
    FROM (SELECT 1) one LEFT JOIN mes_batch_agg(ARRAY[p_batch]) a ON true
  ON CONFLICT (batch_id) DO UPDATE SET warehouse_id = EXCLUDED.warehouse_id, prod_date = EXCLUDED.prod_date, shift = EXCLUDED.shift, btp_id = EXCLUDED.btp_id,
    batch_code = EXCLUDED.batch_code, batch_no = EXCLUDED.batch_no, cycle = EXCLUDED.cycle, created_at = EXCLUDED.created_at, filled_at = EXCLUDED.filled_at,
    open_min = EXCLUDED.open_min, qa_status = EXCLUDED.qa_status, rm_bad = EXCLUDED.rm_bad, lines = EXCLUDED.lines, pending = EXCLUDED.pending, ok = EXCLUDED.ok,
    over = EXCLUDED.over, under = EXCLUDED.under, extra = EXCLUDED.extra, edited = EXCLUDED.edited, std_kg = EXCLUDED.std_kg, sheet_kg = EXCLUDED.sheet_kg,
    iss_kg = EXCLUDED.iss_kg, edit_kg = EXCLUDED.edit_kg, exec_kg = EXCLUDED.exec_kg, total_kg = EXCLUDED.total_kg, updated_at = EXCLUDED.updated_at;
  DELETE FROM production_batch_dev_line WHERE batch_id = p_batch;
  INSERT INTO production_batch_dev_line (id, batch_id, warehouse_id, prod_date, shift, material_id, state, std, sheet, iss, why, updated_at)
  SELECT gen_random_uuid()::text, p_batch, b.warehouse_id, v_date, v_shift, c.material_id, c.state, c.std, c.sheet, c.iss, c.why, now()
    FROM mes_batch_cells(ARRAY[p_batch]) c WHERE mes_dev_line_keep(c.state, c.std, c.sheet, c.iss);
END $function$;

CREATE OR REPLACE FUNCTION public.mes_dashboard(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  l AS MATERIALIZED (SELECT * FROM mes_dash_lines(v_wh, v_from, v_to) WHERE state IN ('over', 'under', 'extra')),   -- 25/11 B7: sổ dòng nay có cả dòng sửa phiếu / cấp lệch trong dung sai; pareto · ngoại lệ chỉ tính dòng LỆCH
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
END $function$;

CREATE OR REPLACE FUNCTION public.mes_dashboard_detail(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wh    text := nullif(p->>'warehouse_id', '');
  v_from  date := nullif(p->>'date_from', '')::date;
  v_to    date := nullif(p->>'date_to', '')::date;
  v_kind  text := coalesce(nullif(p->>'kind', ''), 'batches');
  v_shift text := nullif(p->>'shift', '');
  v_btp   text := nullif(p->>'btp_id', '');
  v_mat   text := nullif(p->>'material_id', '');
  v_only  text := nullif(p->>'only', '');
  v_lim   int := least(greatest(coalesce((p->>'limit')::int, 500), 1), 500);
  v_out   jsonb;
BEGIN
  IF v_wh IS NULL THEN RAISE EXCEPTION 'MESERR:WAREHOUSE|Chọn kho chế biến'; END IF;
  IF v_from IS NULL OR v_to IS NULL OR v_to < v_from OR v_to - v_from > 1100 THEN RAISE EXCEPTION 'MESERR:DATE_RANGE|Khoảng ngày không hợp lệ'; END IF;
  IF v_kind NOT IN ('batches', 'lines') THEN RAISE EXCEPTION 'MESERR:KIND|Loại dữ liệu không hợp lệ'; END IF;
  IF v_kind = 'batches' THEN
    WITH f AS MATERIALIZED (
      SELECT b.*, CASE WHEN b.std_kg > 0 THEN round(b.total_kg / b.std_kg * 100, 3) END AS pct, (b.over + b.under + b.extra) AS dev
        FROM mes_dash_batches(v_wh, v_from, v_to) b
       WHERE (v_shift IS NULL OR (v_shift = '__none' AND b.shift IS NULL) OR b.shift = v_shift)
         AND (v_btp IS NULL OR b.btp_id = v_btp)
         AND (v_only IS NULL
              OR (v_only = 'dev' AND b.over + b.under + b.extra > 0)
              OR (v_only = 'fail' AND b.filled AND b.over + b.under + b.extra > 0)
              OR (v_only = 'pass' AND b.filled AND b.over + b.under + b.extra = 0)
              OR (v_only = 'filled' AND b.filled)
              OR (v_only = 'running' AND NOT b.filled)
              OR (v_only = 'edited' AND b.edited > 0)
              OR (v_only = 'qa_rejected' AND b.qa_status = 'REJECTED')
              OR (v_only = 'rm_bad' AND b.rm_bad > 0)))
    SELECT jsonb_build_object('kind', 'batches', 'total', (SELECT count(*) FROM f), 'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', x.batch_id, 'code', x.batch_code, 'no', x.batch_no, 'shift', x.shift, 'd', x.prod_date, 'at', x.created_at,
               'btp', m.material_code, 'btp_name', m.short_name, 'filled', x.filled, 'qa_status', x.qa_status, 'open_min', x.open_min, 'rm_bad', x.rm_bad,
               'lines', x.lines, 'pending', x.pending, 'over', x.over, 'under', x.under, 'extra', x.extra, 'edited', x.edited,
               'std_kg', x.std_kg, 'iss_kg', x.iss_kg, 'edit_kg', x.edit_kg, 'exec_kg', x.exec_kg, 'total_kg', x.total_kg, 'pct', x.pct)
               ORDER BY x.prod_date DESC, x.created_at DESC)
        FROM (SELECT * FROM f ORDER BY prod_date DESC, created_at DESC LIMIT v_lim) x JOIN "Material" m ON m.id = x.btp_id), '[]'::jsonb))
      INTO v_out;
  ELSE
    WITH bb AS MATERIALIZED (SELECT batch_id, btp_id, batch_code, batch_no, created_at, filled FROM mes_dash_batches(v_wh, v_from, v_to)),
    f AS MATERIALIZED (
      SELECT l.*, bb.btp_id, bb.batch_code, bb.batch_no, bb.created_at, bb.filled FROM mes_dash_lines(v_wh, v_from, v_to) l JOIN bb ON bb.batch_id = l.batch_id
       WHERE (v_shift IS NULL OR (v_shift = '__none' AND l.shift IS NULL) OR l.shift = v_shift)
         AND (v_btp IS NULL OR bb.btp_id = v_btp) AND (v_mat IS NULL OR l.material_id = v_mat)
         AND CASE WHEN v_only = 'edited' THEN l.sheet <> l.std WHEN v_only = 'exec' THEN l.iss <> l.sheet
                  WHEN v_only IS NULL THEN l.state IN ('over', 'under', 'extra') ELSE l.state = v_only END)   -- 25/11 B7
    SELECT jsonb_build_object('kind', 'lines', 'total', (SELECT count(*) FROM f), 'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('batch_id', x.batch_id, 'code', x.batch_code, 'no', x.batch_no, 'shift', x.shift, 'd', x.prod_date,
               'filled', x.filled, 'btp', bm.material_code, 'mat_id', x.material_id, 'mat_code', m.material_code, 'mat_name', m.short_name, 'unit', m.base_unit,
               'state', x.state, 'std', x.std, 'sheet', x.sheet, 'iss', x.iss, 'diff', x.iss - x.std, 'edit', x.sheet - x.std, 'exec', x.iss - x.sheet,
               'pct', CASE WHEN x.std > 0 THEN round((x.iss - x.std) / x.std * 100, 1) END, 'why', x.why)
               ORDER BY x.prod_date DESC, x.created_at DESC, m.material_code)
        FROM (SELECT * FROM f ORDER BY prod_date DESC, created_at DESC LIMIT v_lim) x
        JOIN "Material" m ON m.id = x.material_id JOIN "Material" bm ON bm.id = x.btp_id), '[]'::jsonb))
      INTO v_out;
  END IF;
  RETURN v_out;
END $function$;

-- dựng lại fact (sổ dòng) của mọi mẻ đã nạp theo luật mới
DO $$ DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN SELECT batch_id FROM production_batch_fact LOOP PERFORM mes_batch_fact_build(r.batch_id); v_n := v_n + 1; END LOOP;
  RAISE NOTICE 'dựng lại fact: % mẻ', v_n;
END $$;

-- Lưới tự kiểm
DO $$
DECLARE v_bad int; v_wh text; m1 text; v_u text; b1 jsonb; v_n int;
BEGIN
  -- B7: bảng ca của luật giữ dòng
  IF NOT (mes_dev_line_keep('ok', 100, 101, 101) AND mes_dev_line_keep('ok', 100, 100, 101) AND mes_dev_line_keep('over', 100, 100, 130)
          AND mes_dev_line_keep('extra', 0, 0, 5) AND NOT mes_dev_line_keep('ok', 100, 100, 100) AND NOT mes_dev_line_keep('progress', 100, 101, 50)
          AND NOT mes_dev_line_keep('none', 100, 101, 0)) THEN
    RAISE EXCEPTION 'B7: mes_dev_line_keep sai bảng ca';
  END IF;
  -- B7: mọi fact — số dòng "sửa phiếu" của thẻ = số dòng sổ có sheet <> std (bấm vào phải ra đủ)
  SELECT count(*) INTO v_bad FROM production_batch_fact f
   WHERE f.edited <> (SELECT count(*) FROM production_batch_dev_line d WHERE d.batch_id = f.batch_id AND d.sheet IS DISTINCT FROM d.std);
  IF v_bad > 0 THEN RAISE EXCEPTION 'B7: % mẻ có số dòng sửa phiếu ≠ số dòng sổ', v_bad; END IF;
  -- B1: dấu nạp đầu khớp sổ bồn; mẻ chờ nạp nằm trong mes_tank_incoming, mẻ đã nạp thì không
  SELECT count(*) INTO v_bad FROM production_batch b
   WHERE (b.first_filled_at IS NULL) <> NOT EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = b.id AND mv.kind = 'FILL');
  IF v_bad > 0 THEN RAISE EXCEPTION 'B1: % mẻ có first_filled_at lệch sổ bồn', v_bad; END IF;
  SELECT w.id INTO v_wh FROM "Warehouse" w WHERE w.parent_warehouse_id IS NOT NULL AND coalesce(mes_plant_letter(w.id), '') <> '' ORDER BY w.id LIMIT 1;
  SELECT id, upper(coalesce(base_unit, '')) INTO m1, v_u FROM "Material" WHERE is_semi_finished AND upper(coalesce(base_unit, '')) IN ('L', 'KG') ORDER BY id LIMIT 1;
  IF v_wh IS NULL OR m1 IS NULL THEN RAISE NOTICE 'tự kiểm B1 (trigger): thiếu kho phụ / mã BTP — bỏ qua'; RETURN; END IF;
  BEGIN
    INSERT INTO production_tank (id, warehouse_id, code, capacity, unit, updated_at) VALUES ('QAW4_T', v_wh, 'QAW4T', 1000, v_u, now());
    b1 := mes_batch_create(jsonb_build_object('warehouse_id', v_wh, 'material_id', m1, 'prod_date', current_date, 'cycle', 'QW4', 'tank_id', 'QAW4_T', 'planned_qty', 10, 'shift', 'Ca 1'));
    SELECT count(*) INTO v_n FROM mes_tank_incoming(ARRAY['QAW4_T']) x WHERE x.batch_id = b1->>'id';
    IF v_n <> 1 THEN RAISE EXCEPTION 'B1: mẻ chưa nạp phải nằm trong mes_tank_incoming'; END IF;
    INSERT INTO tank_movement (id, tank_id, batch_id, kind, qty, created_at, updated_at) VALUES ('QAW4_MV', 'QAW4_T', b1->>'id', 'FILL', 5, now(), now());
    IF (SELECT first_filled_at FROM production_batch WHERE id = b1->>'id') IS NULL THEN RAISE EXCEPTION 'B1: trigger không đặt first_filled_at'; END IF;
    SELECT count(*) INTO v_n FROM mes_tank_incoming(ARRAY['QAW4_T']);
    IF v_n <> 0 THEN RAISE EXCEPTION 'B1: mẻ đã nạp vẫn nằm trong mes_tank_incoming'; END IF;
    RAISE EXCEPTION 'SELFTEST_OK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'SELFTEST_OK' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'tự kiểm đợt 4 (B1 B7): OK';
END $$;

COMMIT;
