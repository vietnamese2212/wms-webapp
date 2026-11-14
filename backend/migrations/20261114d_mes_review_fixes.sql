-- ============================================================================
-- 20261114d — MES: sửa sau đợt rà logic 14/11 (check-app module production)
-- ============================================================================
-- 1. mes_consume_scan: chỉ rút dòng tồn IN_STOCK / PARTIAL — trước đây đường quét tem không kiểm trạng thái trong khi
--    đường "theo lô" có kiểm (hai cửa cùng một sổ mà khác luật, lớp C19).
-- 2. mes_consume_lot: khớp ĐÚNG mã lô đã chọn. Trước đây lô "không mã lô" (batch null) rút được cả hàng CÓ mã lô cùng
--    NSX — màn chọn lô (mes_stock) tách hai lô đó thành hai dòng nên người chọn lô A có thể bị trừ sang lô B.
-- 3. Lô QA LOẠI (REJECTED): không nạp vào bồn (mes_tank_fill) và không rút cho đóng gói (mes_tank_take DRAW) bất kể
--    công tắc production_qa_gate — công tắc OFF / WARN / BLOCK nay chỉ nói về lô CHỜ QA (HOLD). Trước đây lô bị loại
--    chỉ ra dòng cảnh báo "chưa QA thả" như lô đang chờ. Xả bỏ / chuyển bồn / điều chỉnh vẫn làm được.
-- 4. mes_tank_take: lưới cuối — tổng phần chia phải bằng lượng lấy (số lẻ > 3 chữ số từng có thể lấy thiếu âm thầm).
-- Thân hàm chép NGUYÊN từ 20261114, chỉ đổi đúng các chỗ trên.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.mes_consume_scan(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_wh   text := mes_open_batch_wh(p->>'batch_id');
  v_qty  numeric := (p->>'qty')::numeric;
  e      record;
  v_new  numeric;
  v_id   text := gen_random_uuid()::text;
BEGIN
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Số lượng rút phải lớn hơn 0'; END IF;
  SELECT * INTO e FROM "InventoryEntry" WHERE id = p->>'entry_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy dòng tồn'; END IF;
  IF e.warehouse_id IS DISTINCT FROM v_wh THEN
    RAISE EXCEPTION 'MESERR:WRONG_WAREHOUSE|Tem % không nằm trong kho của mẻ — chuyển hàng sang kho chế biến trước', e.pallet_code;
  END IF;
  IF e.status NOT IN ('IN_STOCK', 'PARTIAL') THEN
    RAISE EXCEPTION 'MESERR:NOT_IN_STOCK|Tem % không còn là hàng trong kho (trạng thái %) — không rút vào mẻ được', e.pallet_code, e.status;
  END IF;
  IF qa_is_hold(e.qa_status_id) THEN
    RAISE EXCEPTION 'MESERR:QA_HOLD|Tem % đang bị QA giữ — không rút vào mẻ được', e.pallet_code;
  END IF;
  IF COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0) < v_qty THEN
    RAISE EXCEPTION 'MESERR:SHORT|Tem % chỉ còn % có thể rút', e.pallet_code,
      COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0);
  END IF;
  v_new := COALESCE(e.cartons_remaining, e.cartons_imported, 0) - v_qty;
  UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = mes_entry_status(v_new, COALESCE(e.cartons_imported, 0)),
         updated_at = now() WHERE id = e.id;
  INSERT INTO batch_consumption (id, batch_id, entry_id, pallet_code, material_id, production_date, batch_lot, ncc_id,
         qty, source, created_by, created_by_name, created_at, updated_at)
  VALUES (v_id, p->>'batch_id', e.id, e.pallet_code, e.material_id, e.production_date::date, e.batch, e.ncc_id,
         v_qty, 'SCAN', p->>'actor_id', p->>'actor_name', now(), now());
  RETURN jsonb_build_object('rows', jsonb_build_array(jsonb_build_object('id', v_id, 'entry_id', e.id, 'pallet_code', e.pallet_code, 'qty', v_qty, 'remaining', v_new)));
END $$;

CREATE OR REPLACE FUNCTION public.mes_consume_lot(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_wh    text := mes_open_batch_wh(p->>'batch_id');
  v_qty   numeric := (p->>'qty')::numeric;
  v_date  date := nullif(p->>'production_date', '')::date;
  v_lot   text := nullif(btrim(coalesce(p->>'batch_lot', '')), '');
  v_left  numeric;
  v_avail numeric := 0;
  v_take  numeric;
  v_new   numeric;
  v_id    text;
  v_rows  jsonb := '[]'::jsonb;
  e       record;
BEGIN
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Số lượng rút phải lớn hơn 0'; END IF;
  v_left := v_qty;
  FOR e IN
    SELECT * FROM "InventoryEntry"
     WHERE warehouse_id = v_wh AND material_id = p->>'material_id'
       AND status IN ('IN_STOCK', 'PARTIAL')
       AND (production_date::date IS NOT DISTINCT FROM v_date)
       AND nullif(btrim(coalesce(batch, '')), '') IS NOT DISTINCT FROM v_lot   -- ĐÚNG lô đã chọn: lô không mã lô ≠ lô có mã lô cùng NSX
       AND NOT qa_is_hold(qa_status_id)
       AND COALESCE(cartons_remaining, cartons_imported, 0) - COALESCE(cartons_reserved, 0) > 0
     ORDER BY expiry_date NULLS LAST, created_at, id
     FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0));
    v_new  := COALESCE(e.cartons_remaining, e.cartons_imported, 0) - v_take;
    UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = mes_entry_status(v_new, COALESCE(e.cartons_imported, 0)),
           updated_at = now() WHERE id = e.id;
    v_id := gen_random_uuid()::text;
    INSERT INTO batch_consumption (id, batch_id, entry_id, pallet_code, material_id, production_date, batch_lot, ncc_id,
           qty, source, created_by, created_by_name, created_at, updated_at)
    VALUES (v_id, p->>'batch_id', e.id, e.pallet_code, e.material_id, e.production_date::date, e.batch, e.ncc_id,
           v_take, 'LOT', p->>'actor_id', p->>'actor_name', now(), now());
    v_rows := v_rows || jsonb_build_object('id', v_id, 'entry_id', e.id, 'pallet_code', e.pallet_code, 'qty', v_take, 'remaining', v_new);
    v_avail := v_avail + v_take;
    v_left  := v_left - v_take;
  END LOOP;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'MESERR:SHORT|Lô đã chọn chỉ còn % có thể rút (cần %)', v_avail, v_qty;   -- huỷ cả giao dịch
  END IF;
  RETURN jsonb_build_object('rows', v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.mes_tank_fill(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  t       record;
  b       record;
  v_qty   numeric := (p->>'qty')::numeric;
  v_unit  text;
  v_hold  integer;
  v_cur   numeric;
  v_other text;
  v_lot   text;
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
END $$;

CREATE OR REPLACE FUNCTION public.mes_tank_take(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  t        record;
  l        record;
  v_qty    numeric := (p->>'qty')::numeric;
  v_kind   text := p->>'kind';
  v_gate   text := coalesce(p->>'qa_gate', 'WARN');
  v_total  numeric;
  v_n      integer;
  v_i      integer := 0;
  v_given  numeric := 0;
  v_share  numeric;
  v_parts  jsonb := '[]'::jsonb;
  v_warn   text[] := ARRAY[]::text[];
  v_hold   text[];
  v_exp    text[];
  v_rej    text[];
  v_wtext  text;
BEGIN
  IF v_kind NOT IN ('DRAW', 'DISCARD', 'ADJUST', 'TRANSFER_OUT') THEN RAISE EXCEPTION 'MESERR:KIND|Loại thao tác bồn không hợp lệ'; END IF;
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Lượng lấy ra phải lớn hơn 0'; END IF;
  SELECT * INTO t FROM production_tank WHERE id = p->>'tank_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy bồn'; END IF;
  PERFORM 1 FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE' FOR UPDATE;
  SELECT COALESCE(sum(qty_remaining), 0), count(*) INTO v_total, v_n FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE' AND qty_remaining > 0;
  IF v_qty > v_total THEN
    RAISE EXCEPTION 'MESERR:TANK_SHORT|Bồn % chỉ đang chứa % % (cần %) — khớp lại mức bồn bằng "Điều chỉnh" nếu đồng hồ báo khác', t.code, v_total, t.unit, v_qty;
  END IF;
  IF v_kind = 'DRAW' THEN
    -- Lô QA LOẠI: không bao giờ rót ra thành phẩm, bất kể công tắc (công tắc chỉ nói về lô CHỜ QA)
    SELECT array_agg(DISTINCT b.batch_code) INTO v_rej FROM tank_lot l2 JOIN production_batch b ON b.id = l2.batch_id
     WHERE l2.tank_id = t.id AND l2.status = 'ACTIVE' AND l2.qty_remaining > 0 AND b.qa_status = 'REJECTED';
    IF v_rej IS NOT NULL THEN
      RAISE EXCEPTION 'MESERR:QA_REJECTED|Bồn % đang chứa lô bị QA loại: % — xả bỏ ở màn Bồn (hoặc QA đổi kết luận) rồi mới rút cho đóng gói', t.code, array_to_string(v_rej, ', ');
    END IF;
    SELECT array_agg(DISTINCT b.batch_code) INTO v_hold FROM tank_lot l2 JOIN production_batch b ON b.id = l2.batch_id
     WHERE l2.tank_id = t.id AND l2.status = 'ACTIVE' AND l2.qty_remaining > 0 AND b.qa_status = 'HOLD';
    IF v_hold IS NOT NULL AND v_gate = 'BLOCK' THEN
      RAISE EXCEPTION 'MESERR:QA_BLOCK|Bồn % có lô chưa được QA thả: % — kho đặt CHẶN rút', t.code, array_to_string(v_hold, ', ');
    END IF;
    IF v_hold IS NOT NULL AND v_gate = 'WARN' THEN v_warn := v_warn || ('Lô chưa QA thả: ' || array_to_string(v_hold, ', ')); END IF;
    SELECT array_agg(DISTINCT b.batch_code) INTO v_exp FROM tank_lot l2 JOIN production_batch b ON b.id = l2.batch_id
     WHERE l2.tank_id = t.id AND l2.status = 'ACTIVE' AND l2.qty_remaining > 0 AND l2.expires_at IS NOT NULL AND l2.expires_at < now();
    IF v_exp IS NOT NULL THEN v_warn := v_warn || ('Lô quá hạn lưu bồn: ' || array_to_string(v_exp, ', ')); END IF;
  END IF;
  v_wtext := nullif(array_to_string(v_warn, ' · '), '');
  FOR l IN SELECT * FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE' AND qty_remaining > 0 ORDER BY qty_remaining, filled_at, id LOOP
    v_i := v_i + 1;
    -- lô cuối (lượng còn lớn nhất) nhận phần dư làm tròn ⇒ Σ đúng bằng lượng lấy, không lô nào âm
    v_share := CASE WHEN v_i = v_n THEN v_qty - v_given ELSE round(v_qty * l.qty_remaining / v_total, 3) END;
    v_share := LEAST(v_share, l.qty_remaining);
    CONTINUE WHEN v_share <= 0;
    v_given := v_given + v_share;
    UPDATE tank_lot SET qty_remaining = qty_remaining - v_share,
           status = CASE WHEN qty_remaining - v_share <= 0 THEN 'EMPTY' ELSE 'ACTIVE' END,
           emptied_at = CASE WHEN qty_remaining - v_share <= 0 THEN now() ELSE emptied_at END,
           updated_at = now() WHERE id = l.id;
    INSERT INTO tank_movement (id, tank_id, tank_lot_id, batch_id, kind, qty, packing_run_id, ref_tank_id, reason, warning,
           created_by, created_by_name, created_at, updated_at)
    VALUES (gen_random_uuid()::text, t.id, l.id, l.batch_id, v_kind, -v_share, nullif(p->>'packing_run_id', '')::uuid,
           nullif(p->>'ref_tank_id', ''), nullif(left(btrim(coalesce(p->>'reason', '')), 500), ''), v_wtext,
           p->>'actor_id', p->>'actor_name', now(), now());
    v_parts := v_parts || jsonb_build_object('lot_id', l.id, 'batch_id', l.batch_id, 'qty', v_share, 'filled_at', l.filled_at, 'expires_at', l.expires_at);
  END LOOP;
  -- lưới cuối: số lẻ quá 3 chữ số làm phần chia không khớp ⇒ huỷ cả lệnh, không lấy thiếu âm thầm
  IF abs(v_given - v_qty) > 0.0005 THEN
    RAISE EXCEPTION 'MESERR:QTY|Lượng % không chia được cho các mẻ trong bồn — nhập tối đa 3 số lẻ', v_qty;
  END IF;
  UPDATE production_tank SET updated_at = now() WHERE id = t.id;
  RETURN jsonb_build_object('parts', v_parts, 'warnings', to_jsonb(v_warn), 'content', v_total - v_given, 'unit', t.unit);
END $$;

COMMIT;
