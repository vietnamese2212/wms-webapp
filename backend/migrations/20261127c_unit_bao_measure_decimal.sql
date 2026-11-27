-- 27/11 — Đơn vị BAO (bao đường / bột, không phải đơn vị SAP) + mã KG có đơn vị quy cách được số lẻ.
-- User 27/11: "BAG là BAG (đơn vị SAP), tiếng Việt là túi" — bao đường 20 kg là đơn vị RIÊNG của app; đường trắng 210000262:
-- Base KG, Entry BAO, 1 bao = 20 kg ⇒ 110 kg hiện "5 bao + 10 kg" ở Tồn kho / Nhập / Xuất.
-- Luật số nguyên của mã có quy cách (luật 19/07, viết cho hộp / chai) KHÔNG áp cho đơn vị gốc là đơn vị đo (kg, lít…):
-- "5 bao + 10,5 kg" hợp lệ. Trước đây luật này có HAI bản tự viết trong DB (huỷ cấp · xử lý hàng chặn) ⇒ gom về MỘT hàm
-- qty_whole_required, cùng danh sách đơn vị đo với MEASURE_UNIT_CODES (backend + frontend utils/qtyUnits.ts —
-- test backend/tests/unit/measureUnitsSql.test.ts đối chiếu).

BEGIN;

-- ── 1. Danh mục đơn vị tính ───────────────────────────────────────────────────────────────────────────────
INSERT INTO "LookupValue" (id, type, value, sort_order, meta, created_at, updated_at, created_by)
SELECT gen_random_uuid(), 'unit_of_measure', 'BAO', 12, '{"role":"entry","label":"Bao"}'::jsonb, now(), now(), 'migration 20261127c'
WHERE NOT EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'unit_of_measure' AND value = 'BAO');

-- BAG (mã SAP — túi nhỏ của bao bì) đổi TÊN hiển thị thành "Túi"; mã giữ nguyên. Chỉ đổi khi còn tên mặc định "Bao".
UPDATE "LookupValue" SET meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{label}', '"Túi"'), updated_at = now()
 WHERE type = 'unit_of_measure' AND value = 'BAG' AND coalesce(meta->>'label', '') IN ('', 'Bao');

-- ── 2. Một hàm: số theo đơn vị gốc của mã có phải nguyên không ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qty_whole_required(p_material text)
RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE((
    SELECT COALESCE(btrim(m.entry_unit), '') <> '' AND COALESCE(m.units_per_carton, 0) > 0
           AND NOT (upper(btrim(coalesce(m.base_unit, ''))) = ANY (ARRAY['KG', 'G', 'MG', 'TON', 'L', 'ML', 'M', 'CM', 'MM', 'M2', 'M3']))
      FROM "Material" m WHERE m.id = p_material), false)
$$;

-- ── 3. Hai cửa MES dùng hàm chung (thân hàm giữ nguyên như 20261125h, chỉ đổi dòng kiểm số nguyên) ──────────
CREATE OR REPLACE FUNCTION public.mes_consume_reverse_line(p_cid text, p_reason text, p_block numeric, p_keep_closed boolean, p_source text,
                                                           p_actor_id text, p_actor_name text)
RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  c       record;
  e       record;
  v_batch text;
  v_new   numeric;
  v_wh    text;
  v_shift record;
  v_block numeric := COALESCE(p_block, 0);
  v_why   text := left(btrim(coalesce(p_reason, '')), 500);
BEGIN
  IF length(v_why) = 0 THEN RAISE EXCEPTION 'MESERR:REASON|Nhập lý do huỷ'; END IF;
  SELECT batch_id INTO v_batch FROM batch_consumption WHERE id = p_cid;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy dòng rút'; END IF;
  v_wh := mes_open_batch_wh(v_batch);
  SELECT * INTO c FROM batch_consumption WHERE id = p_cid FOR UPDATE;
  IF c.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'MESERR:ALREADY_REVERSED|Dòng rút này đã huỷ rồi'; END IF;
  IF v_block < 0 OR v_block > c.qty THEN
    RAISE EXCEPTION 'MESERR:BLOCK_QTY|Phần không tái dùng (chặn) của tem % phải từ 0 tới % (lượng đã cấp)', c.pallet_code, c.qty;
  END IF;
  -- mã có đơn vị thùng ⇒ số gốc phải nguyên, TRỪ đơn vị gốc là đơn vị đo (kg / lít — 27/11) — cùng luật qtyIntegerError (qty_whole_required)
  IF v_block <> trunc(v_block) AND qty_whole_required(c.material_id) THEN
    RAISE EXCEPTION 'MESERR:BLOCK_QTY|Mã của tem % tính theo thùng — phần chặn phải là số nguyên theo đơn vị gốc', c.pallet_code;
  END IF;
  -- 25/11 (N4, user chốt): kho bật "chặn huỷ cấp của ca đã chốt" ⇒ lần cấp nằm trong một ca đã chốt không huỷ được nữa
  IF (SELECT mes_block_reverse_closed FROM "Warehouse" WHERE id = v_wh) THEN
    SELECT s.report_date, s.shift INTO v_shift FROM production_shift_report s
     WHERE s.warehouse_id = v_wh AND s.status = 'CLOSED' AND s.from_at <= c.created_at AND s.to_at > c.created_at
     ORDER BY s.to_at DESC LIMIT 1;
    IF FOUND THEN
      IF p_keep_closed THEN RETURN jsonb_build_object('id', c.id, 'kept', true, 'qty', c.qty); END IF;
      RAISE EXCEPTION 'MESERR:SHIFT_CLOSED|Lần cấp này thuộc ca % ngày % đã chốt — kho đặt chặn huỷ cấp của ca đã chốt (NVL thường đã dùng / mất). Chênh lệch xử lý bằng kiểm kê / điều chỉnh tồn',
        v_shift.shift, to_char(v_shift.report_date, 'DD-MM-YYYY');
    END IF;
  END IF;
  SELECT * INTO e FROM "InventoryEntry" WHERE id = c.entry_id FOR UPDATE;
  v_new := COALESCE(e.cartons_remaining, 0) + c.qty - v_block;
  UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = inventory_entry_status(e.status, v_new, COALESCE(e.cartons_imported, 0), e.cartons_reserved),
         updated_at = now() WHERE id = e.id;
  UPDATE batch_consumption SET reversed_at = clock_timestamp(), reversed_by = p_actor_id, reversed_by_name = p_actor_name,
         reverse_reason = v_why, updated_at = now() WHERE id = c.id;
  IF v_block > 0 THEN
    INSERT INTO inventory_block (id, entry_id, warehouse_id, material_id, pallet_code, qty, reason, source, batch_id, consumption_id,
                                 created_by, created_by_name, created_at, updated_at)
    VALUES (gen_random_uuid()::text, e.id, e.warehouse_id, c.material_id, c.pallet_code, v_block, v_why, p_source, c.batch_id, c.id,
            p_actor_id, p_actor_name, clock_timestamp(), now());
  END IF;
  RETURN jsonb_build_object('id', c.id, 'entry_id', e.id, 'remaining', v_new, 'blocked', v_block, 'kept', false);
END $function$;

CREATE OR REPLACE FUNCTION public.mes_block_act(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  k      record;
  e      record;
  v_wh   text;
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_open numeric;
  v_qty  numeric;
  v_new  numeric;
BEGIN
  IF v_kind NOT IN ('WRITE_OFF', 'RELEASE') THEN RAISE EXCEPTION 'MESERR:BAD_INPUT|Thao tác phải là WRITE_OFF hoặc RELEASE'; END IF;
  SELECT warehouse_id INTO v_wh FROM inventory_block WHERE id = p->>'block_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy dòng hàng chặn'; END IF;
  -- như mọi cửa đổi tồn của kho chế biến: khoá CHIA SẺ theo kho ⇒ chốt ca (khoá độc quyền) chụp số không lọt lượt này
  PERFORM pg_advisory_xact_lock_shared(hashtext('mes_shift:' || v_wh));
  SELECT * INTO k FROM inventory_block WHERE id = p->>'block_id' FOR UPDATE;
  v_open := k.qty - k.qty_written_off - k.qty_released;
  IF v_open <= 0 THEN RAISE EXCEPTION 'MESERR:BLOCK_CLOSED|Hàng chặn của tem % đã xử lý hết', k.pallet_code; END IF;
  v_qty := COALESCE(NULLIF(p->>'qty', '')::numeric, v_open);
  IF v_qty <= 0 OR v_qty > v_open THEN
    RAISE EXCEPTION 'MESERR:BLOCK_QTY|Lượng phải lớn hơn 0 và không quá % (phần đang chặn của tem %)', v_open, k.pallet_code;
  END IF;
  IF v_qty <> trunc(v_qty) AND qty_whole_required(k.material_id) THEN   -- 27/11: cùng luật qtyIntegerError
    RAISE EXCEPTION 'MESERR:BLOCK_QTY|Mã của tem % tính theo thùng — lượng phải là số nguyên theo đơn vị gốc', k.pallet_code;
  END IF;
  IF v_kind = 'RELEASE' THEN
    SELECT * INTO e FROM "InventoryEntry" WHERE id = k.entry_id FOR UPDATE;
    v_new := COALESCE(e.cartons_remaining, 0) + v_qty;
    UPDATE "InventoryEntry" SET cartons_remaining = v_new,
           status = inventory_entry_status(e.status, v_new, COALESCE(e.cartons_imported, 0), e.cartons_reserved), updated_at = now()
     WHERE id = e.id;
    UPDATE inventory_block SET qty_released = qty_released + v_qty, updated_at = now() WHERE id = k.id;
  ELSE
    UPDATE inventory_block SET qty_written_off = qty_written_off + v_qty, updated_at = now() WHERE id = k.id;
  END IF;
  INSERT INTO inventory_block_event (id, block_id, warehouse_id, kind, qty, note, shift_report_id, actor_id, actor_name, created_at, updated_at)
  VALUES (gen_random_uuid()::text, k.id, k.warehouse_id, v_kind, v_qty, NULLIF(left(btrim(coalesce(p->>'note', '')), 500), ''),
          NULLIF(p->>'shift_report_id', ''), p->>'actor_id', p->>'actor_name', clock_timestamp(), now());
  RETURN jsonb_build_object('block_id', k.id, 'kind', v_kind, 'qty', v_qty, 'open', v_open - v_qty);
END $function$;

COMMIT;
