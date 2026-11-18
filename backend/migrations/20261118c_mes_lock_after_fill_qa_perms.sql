-- MES 18/11 (c) — KHOÁ SỔ NVL CỦA MẺ SAU KHI NẠP BỒN · BỎ QUYỀN QA Ở BA CHỨC DANH QUẢN LÝ KHO (user chốt 18/11).
--
-- 1) User: "Có khoá cấp / huỷ NVL sau khi mẻ đã nạp bồn không?" ⇒ "ok". Năm hàm ghi NVL vào mẻ (mes_consume_scan · mes_consume_lot ·
--    mes_consume_reverse · mes_expiry_request · mes_expiry_decide) đều mở bằng mes_open_batch_wh ⇒ đặt luật Ở ĐÂY, một chỗ cho mọi cửa:
--    mẻ đã có lần NẠP (tank_movement FILL) ⇒ 409 MES_BATCH_FILLED. Lời báo trạng thái không còn nói "mở lại mẻ" (không còn đóng mẻ — 18/11 b).
--    mes_tank_fill khoá dòng mẻ FOR NO KEY UPDATE (thay FOR SHARE) ⇒ chờ các lượt cấp đang chạy (chúng giữ FOR SHARE) — không lọt dòng
--    cấp đúng lúc nạp; các lượt cấp vẫn chạy song song với nhau như cũ.
-- 2) User: "Quản lý kho — bỏ quyền đi" (câu hỏi: Quản lý kho NPP / site / toàn quốc có giữ quyền QA không). Gỡ approve_qa (duyệt / bỏ
--    duyệt phiếu QA) · print_label (in tem pallet của mẻ) · qa_release (kết luận QA ở bồn, QA xác nhận phiếu) — chỉ chức danh QA giữ.
--    Khớp id staging HOẶC tên (DB khác có thể sinh id khác); các quyền khác giữ nguyên.
BEGIN;

CREATE OR REPLACE FUNCTION public.mes_open_batch_wh(p_batch_id text)
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_wh text; v_status text; v_code text;
BEGIN
  SELECT warehouse_id, status, batch_code INTO v_wh, v_status, v_code FROM production_batch WHERE id = p_batch_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF v_status <> 'OPEN' THEN RAISE EXCEPTION 'MESERR:BATCH_NOT_OPEN|Mẻ % đã huỷ — không cấp / huỷ cấp nguyên liệu được', v_code; END IF;
  IF EXISTS (SELECT 1 FROM tank_movement WHERE batch_id = p_batch_id AND kind = 'FILL') THEN
    RAISE EXCEPTION 'MESERR:BATCH_FILLED|Mẻ % đã nạp BTP vào bồn — sổ nguyên liệu của mẻ đã khoá (không cấp thêm, không huỷ dòng cấp)', v_code;
  END IF;
  RETURN v_wh;
END $$;

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
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR NO KEY UPDATE;   -- 18/11 (c): chờ lượt cấp / huỷ cấp đang chạy (giữ FOR SHARE qua mes_open_batch_wh)
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

UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(j.module_permissions, '{production}',
         COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(j.module_permissions->'production') x
                    WHERE x NOT IN ('"approve_qa"'::jsonb, '"print_label"'::jsonb, '"qa_release"'::jsonb)), '[]'::jsonb), true),
       updated_at = now()
 WHERE jsonb_typeof(j.module_permissions->'production') = 'array'
   AND (j.module_permissions->'production' ?| ARRAY['approve_qa', 'print_label', 'qa_release'])
   AND (j.id IN ('jt-ql-site', 'jt-ql-tq', '5d7e4421-3f7a-4280-893d-0c709a2451cb')
        OR j.name IN ('Quản lý kho NPP', 'Quản lý kho site', 'Quản lý kho toàn quốc'));

-- Lưới: không chức danh quản lý kho nào còn quyền QA của MES
DO $chk$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public."JobTitle" j
   WHERE j.module_permissions->'production' ?| ARRAY['approve_qa', 'print_label', 'qa_release']
     AND (j.id IN ('jt-ql-site', 'jt-ql-tq', '5d7e4421-3f7a-4280-893d-0c709a2451cb')
          OR j.name IN ('Quản lý kho NPP', 'Quản lý kho site', 'Quản lý kho toàn quốc'));
  IF n > 0 THEN RAISE EXCEPTION 'còn % chức danh quản lý kho giữ quyền QA của MES', n; END IF;
END $chk$;

COMMIT;
