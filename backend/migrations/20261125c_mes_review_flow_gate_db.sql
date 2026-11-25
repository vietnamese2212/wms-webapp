-- Rà soát MES 25/11 (docs/plans/MES_REVIEW_2026-11-25.md) — ĐỢT 3 (N1): luật "luồng chặt" (Warehouse.mes_flow_gate — chưa đủ hai
-- bước duyệt thì chưa cấp NVL) trước đây CHỈ kiểm ở controller (consumeGateError): đọc Warehouse lỗi ⇒ cho cấp (mở cửa khi lỗi);
-- QA bỏ duyệt đúng lúc đang cấp ⇒ lọt (mẻ đọc từ trước). Nay hàm mes_consume_flow_gate kiểm trong CÙNG giao dịch với lệnh trừ tồn,
-- sau khi mes_open_batch_wh đã khoá mẻ FOR SHARE (mes_batch_approve khoá FOR UPDATE ⇒ hai bên xếp hàng).
-- CHỈ hai cửa CẤP gọi (mes_consume_scan · mes_consume_lot). mes_open_batch_wh dùng chung cho cả huỷ cấp / xin + duyệt NVL hết hạn ⇒
-- KHÔNG đặt kiểm vào đó (QA bỏ duyệt vì lỡ cấp nhầm vẫn phải huỷ được dòng cấp — Gemini nhắc khi bàn 25/11).
-- Thân hai hàm cấp = bản đang chạy (20261117e) + đúng một dòng PERFORM sau BEGIN (sinh bằng gen_w3.cjs từ pg_get_functiondef).
BEGIN;

CREATE OR REPLACE FUNCTION public.mes_consume_flow_gate(p_batch_id text) RETURNS void
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE b record; v_gate boolean;
BEGIN
  SELECT pb.lead_ok_at, pb.qa_ok_at, pb.warehouse_id INTO b FROM production_batch pb WHERE pb.id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  SELECT coalesce(w.mes_flow_gate, false) INTO v_gate FROM "Warehouse" w WHERE w.id = b.warehouse_id;
  IF NOT coalesce(v_gate, false) THEN RETURN; END IF;
  IF b.lead_ok_at IS NULL THEN RAISE EXCEPTION 'MESERR:NOT_APPROVED|Trưởng ca chưa duyệt phiếu của mẻ — chưa cấp nguyên liệu được'; END IF;
  IF b.qa_ok_at IS NULL THEN RAISE EXCEPTION 'MESERR:NOT_APPROVED|QA chưa duyệt phiếu của mẻ — chưa cấp nguyên liệu được'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.mes_consume_flow_gate(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_consume_flow_gate(text) TO service_role;

CREATE OR REPLACE FUNCTION public.mes_consume_scan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wh   text := mes_open_batch_wh(p->>'batch_id');
  v_qty  numeric := (p->>'qty')::numeric;
  v_rot  jsonb := COALESCE(p->'rotation', '{}'::jsonb);
  e      record;
  v_appr mes_expiry_approval;
  v_new  numeric;
  v_id   text := gen_random_uuid()::text;
BEGIN
  PERFORM mes_consume_flow_gate(p->>'batch_id');   -- 25/11 N1: luật luồng chặt kiểm TRONG giao dịch, sau khoá mẻ (FOR SHARE)
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
  IF e.expiry_calc IS NOT NULL AND e.expiry_calc < mes_vn_today() THEN
    SELECT * INTO v_appr FROM mes_expiry_approval WHERE batch_id = p->>'batch_id' AND subject_key = 'E:' || e.id;
    IF v_appr.status IS NULL OR v_appr.status = 'PENDING' THEN
      RAISE EXCEPTION 'MESERR:EXPIRED|Tem % đã hết hạn (HSD %) — chỉ cấp vào mẻ khi QA duyệt', e.pallet_code, to_char(e.expiry_calc, 'DD-MM-YYYY');
    ELSIF v_appr.status = 'REJECTED' THEN
      RAISE EXCEPTION 'MESERR:EXPIRED_REJECTED|QA đã từ chối dùng tem % (hết hạn %) cho mẻ này', e.pallet_code, to_char(e.expiry_calc, 'DD-MM-YYYY');
    END IF;
  END IF;
  IF COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0) < v_qty THEN
    RAISE EXCEPTION 'MESERR:SHORT|Tem % chỉ còn % có thể rút', e.pallet_code,
      COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0);
  END IF;
  v_new := COALESCE(e.cartons_remaining, e.cartons_imported, 0) - v_qty;
  UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = mes_entry_status(v_new, COALESCE(e.cartons_imported, 0)),
         updated_at = now() WHERE id = e.id;
  INSERT INTO batch_consumption (id, batch_id, entry_id, pallet_code, material_id, production_date, batch_lot, ncc_id,
         qty, source, created_by, created_by_name, created_at, updated_at,
         rotation_violation, rotation_principle, rotation_best_date, rotation_override_reason, expiry_approval_id)
  VALUES (v_id, p->>'batch_id', e.id, e.pallet_code, e.material_id, e.production_date::date, e.batch, e.ncc_id,
         v_qty, 'SCAN', p->>'actor_id', p->>'actor_name', now(), now(),
         CASE WHEN v_rot ? 'violation' THEN (v_rot->>'violation')::boolean END,
         NULLIF(v_rot->>'principle', ''), NULLIF(v_rot->>'best_date', ''), NULLIF(v_rot->>'override_reason', ''), v_appr.id);
  RETURN jsonb_build_object('rows', jsonb_build_array(jsonb_build_object('id', v_id, 'entry_id', e.id, 'pallet_code', e.pallet_code,
    'qty', v_qty, 'remaining', v_new, 'rotation_violation', (v_rot->>'violation')::boolean, 'expiry_approval_id', v_appr.id)));
END $function$
;

CREATE OR REPLACE FUNCTION public.mes_consume_lot(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wh    text := mes_open_batch_wh(p->>'batch_id');
  v_qty   numeric := (p->>'qty')::numeric;
  v_date  date := nullif(p->>'production_date', '')::date;
  v_lot   text := nullif(btrim(coalesce(p->>'batch_lot', '')), '');
  v_rot   jsonb := COALESCE(p->'rotation', '{}'::jsonb);
  v_appr  mes_expiry_approval;
  v_exp   date;
  v_left  numeric;
  v_avail numeric := 0;
  v_take  numeric;
  v_new   numeric;
  v_id    text;
  v_rows  jsonb := '[]'::jsonb;
  v_code  text;
  v_tem   numeric;
  e       record;
BEGIN
  PERFORM mes_consume_flow_gate(p->>'batch_id');   -- 25/11 N1: luật luồng chặt kiểm TRONG giao dịch, sau khoá mẻ (FOR SHARE)
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Số lượng rút phải lớn hơn 0'; END IF;
  v_left := v_qty;
  SELECT upper(material_code) INTO v_code FROM "Material" WHERE id = p->>'material_id';
  -- HẾT HẠN: lô (hàng không tem cấp được) có dòng quá HSD ⇒ phải có QA duyệt lô này cho mẻ này
  SELECT min(expiry_calc) INTO v_exp FROM "InventoryEntry"
   WHERE warehouse_id = v_wh AND material_id = p->>'material_id' AND status IN ('IN_STOCK', 'PARTIAL')
     AND (production_date::date IS NOT DISTINCT FROM v_date)
     AND nullif(btrim(coalesce(batch, '')), '') IS NOT DISTINCT FROM v_lot
     AND NOT qa_is_hold(qa_status_id)
     AND COALESCE(cartons_remaining, cartons_imported, 0) - COALESCE(cartons_reserved, 0) > 0
     AND upper(pallet_code) = v_code;
  IF v_exp IS NOT NULL AND v_exp < mes_vn_today() THEN
    SELECT * INTO v_appr FROM mes_expiry_approval WHERE batch_id = p->>'batch_id' AND subject_key = mes_lot_subject(p->>'material_id', v_date, v_lot);
    IF v_appr.status IS NULL OR v_appr.status = 'PENDING' THEN
      RAISE EXCEPTION 'MESERR:EXPIRED|Lô % đã hết hạn (HSD %) — chỉ cấp vào mẻ khi QA duyệt', coalesce(v_lot, to_char(v_date, 'DD-MM-YYYY'), '—'), to_char(v_exp, 'DD-MM-YYYY');
    ELSIF v_appr.status = 'REJECTED' THEN
      RAISE EXCEPTION 'MESERR:EXPIRED_REJECTED|QA đã từ chối dùng lô % (hết hạn %) cho mẻ này', coalesce(v_lot, to_char(v_date, 'DD-MM-YYYY'), '—'), to_char(v_exp, 'DD-MM-YYYY');
    END IF;
  END IF;
  FOR e IN
    SELECT * FROM "InventoryEntry"
     WHERE warehouse_id = v_wh AND material_id = p->>'material_id'
       AND status IN ('IN_STOCK', 'PARTIAL')
       AND (production_date::date IS NOT DISTINCT FROM v_date)
       AND nullif(btrim(coalesce(batch, '')), '') IS NOT DISTINCT FROM v_lot   -- ĐÚNG lô đã chọn: lô không mã lô ≠ lô có mã lô cùng NSX
       AND NOT qa_is_hold(qa_status_id)
       AND COALESCE(cartons_remaining, cartons_imported, 0) - COALESCE(cartons_reserved, 0) > 0
       AND upper(pallet_code) = v_code   -- CHỈ hàng không có tem (tồn gộp, mã tem = mã hàng); hàng có tem QR phải quét
     ORDER BY expiry_calc NULLS LAST, created_at, id
     FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0));
    v_new  := COALESCE(e.cartons_remaining, e.cartons_imported, 0) - v_take;
    UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = mes_entry_status(v_new, COALESCE(e.cartons_imported, 0)),
           updated_at = now() WHERE id = e.id;
    v_id := gen_random_uuid()::text;
    INSERT INTO batch_consumption (id, batch_id, entry_id, pallet_code, material_id, production_date, batch_lot, ncc_id,
           qty, source, created_by, created_by_name, created_at, updated_at,
           rotation_violation, rotation_principle, rotation_best_date, rotation_override_reason, expiry_approval_id)
    VALUES (v_id, p->>'batch_id', e.id, e.pallet_code, e.material_id, e.production_date::date, e.batch, e.ncc_id,
           v_take, 'LOT', p->>'actor_id', p->>'actor_name', now(), now(),
           CASE WHEN v_rot ? 'violation' THEN (v_rot->>'violation')::boolean END,
           NULLIF(v_rot->>'principle', ''), NULLIF(v_rot->>'best_date', ''), NULLIF(v_rot->>'override_reason', ''), v_appr.id);
    v_rows := v_rows || jsonb_build_object('id', v_id, 'entry_id', e.id, 'pallet_code', e.pallet_code, 'qty', v_take, 'remaining', v_new,
                'rotation_violation', (v_rot->>'violation')::boolean, 'expiry_approval_id', v_appr.id);
    v_avail := v_avail + v_take;
    v_left  := v_left - v_take;
  END LOOP;
  IF v_left > 0 THEN
    SELECT COALESCE(sum(COALESCE(cartons_remaining, cartons_imported, 0) - COALESCE(cartons_reserved, 0)), 0) INTO v_tem FROM "InventoryEntry"
     WHERE warehouse_id = v_wh AND material_id = p->>'material_id' AND status IN ('IN_STOCK', 'PARTIAL')
       AND (production_date::date IS NOT DISTINCT FROM v_date) AND nullif(btrim(coalesce(batch, '')), '') IS NOT DISTINCT FROM v_lot
       AND NOT qa_is_hold(qa_status_id) AND upper(pallet_code) <> v_code
       AND COALESCE(cartons_remaining, cartons_imported, 0) - COALESCE(cartons_reserved, 0) > 0;
    IF v_tem > 0 THEN
      RAISE EXCEPTION 'MESERR:MUST_SCAN|Lô này còn % nằm trên pallet / bao CÓ TEM QR — quét tem để cấp (chỉ hàng không có tem mới chọn lô bằng tay)', v_tem;
    END IF;
    RAISE EXCEPTION 'MESERR:SHORT|Lô đã chọn chỉ còn % có thể rút (cần %)', v_avail, v_qty;   -- huỷ cả giao dịch
  END IF;
  RETURN jsonb_build_object('rows', v_rows);
END $function$
;

-- Lưới tự kiểm (dữ liệu giả, rollback): kho bật luồng chặt, mẻ chưa duyệt ⇒ cả hai cửa cấp NOT_APPROVED; duyệt đủ ⇒ qua cổng (rơi tiếp vào lỗi tem không có)
DO $$
DECLARE v_wh text; m1 text; v_u text; b1 jsonb; v_err text;
BEGIN
  SELECT w.id INTO v_wh FROM "Warehouse" w WHERE w.parent_warehouse_id IS NOT NULL AND coalesce(mes_plant_letter(w.id), '') <> '' ORDER BY w.id LIMIT 1;
  SELECT id, upper(coalesce(base_unit, '')) INTO m1, v_u FROM "Material" WHERE is_semi_finished AND upper(coalesce(base_unit, '')) IN ('L', 'KG') ORDER BY id LIMIT 1;
  IF v_wh IS NULL OR m1 IS NULL THEN RAISE NOTICE 'tự kiểm N1: thiếu kho phụ / mã BTP — bỏ qua'; RETURN; END IF;
  BEGIN
    UPDATE "Warehouse" SET mes_flow_gate = true WHERE id = v_wh;
    INSERT INTO production_tank (id, warehouse_id, code, capacity, unit, updated_at) VALUES ('QAW3_T', v_wh, 'QAW3T', 1000, v_u, now());
    b1 := mes_batch_create(jsonb_build_object('warehouse_id', v_wh, 'material_id', m1, 'prod_date', current_date, 'cycle', 'QW3', 'tank_id', 'QAW3_T', 'shift', 'Ca 1'));
    v_err := NULL;
    BEGIN PERFORM mes_consume_scan(jsonb_build_object('batch_id', b1->>'id', 'entry_id', 'QAW3_NONE', 'qty', 1));
    EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR v_err NOT LIKE 'MESERR:NOT_APPROVED%' THEN RAISE EXCEPTION 'N1: quét cấp khi chưa duyệt phải NOT_APPROVED, nhận %', coalesce(v_err, 'không lỗi'); END IF;
    v_err := NULL;
    BEGIN PERFORM mes_consume_lot(jsonb_build_object('batch_id', b1->>'id', 'material_id', m1, 'qty', 1));
    EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR v_err NOT LIKE 'MESERR:NOT_APPROVED%' THEN RAISE EXCEPTION 'N1: cấp theo lô khi chưa duyệt phải NOT_APPROVED, nhận %', coalesce(v_err, 'không lỗi'); END IF;
    INSERT INTO batch_requirement (id, batch_id, material_id, qty_required, updated_at) VALUES ('QAW3_RQ', b1->>'id', m1 || '', 1, now()) ON CONFLICT DO NOTHING;
    UPDATE production_batch SET lead_ok_at = now(), qa_ok_at = now() WHERE id = b1->>'id';
    v_err := NULL;
    BEGIN PERFORM mes_consume_scan(jsonb_build_object('batch_id', b1->>'id', 'entry_id', 'QAW3_NONE', 'qty', 1));
    EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR v_err NOT LIKE 'MESERR:NOT_FOUND%' THEN RAISE EXCEPTION 'N1: đã duyệt đủ phải qua cổng (rơi vào NOT_FOUND tem), nhận %', coalesce(v_err, 'không lỗi'); END IF;
    RAISE EXCEPTION 'SELFTEST_OK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'SELFTEST_OK' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'tự kiểm N1 (luồng chặt trong DB): OK';
END $$;

COMMIT;
