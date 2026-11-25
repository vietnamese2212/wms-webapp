-- Rà soát MES 25/11 (docs/plans/MES_REVIEW_2026-11-25.md) — ĐỢT 5: sổ InventoryEntry — MỘT hàm trạng thái + MỘT luật "dòng lấy được".
-- User chốt 25/11: cửa tồn gộp (Lưu thủ công / Xuất luôn) theo luật của cửa cấp NVL vào mẻ — chặn hàng QA giữ, trừ phần đang giữ chỗ cho
-- nhặt lẻ, theo nguyên tắc luân chuyển của kho (thứ tự lấy do code tính bằng helper luân chuyển chung, truyền vào p_order_ids).
--   • XUẤT LỐ KHÔNG AI BIẾT: nhặt lẻ giữ 20/100 → chuyến khác "Lưu thủ công" lấy cả 100 (outbound_pool_apply cộng SUM(remaining), không trừ
--     cartons_reserved, ghi đè LOOSE_PICKING) → xác nhận nhặt lẻ, outbound_adjust_entry kẹp GREATEST(0, …) ⇒ tồn 0, thực ra đã ra 120.
--   • outbound_consume_exact (cửa quét) kiểm đủ hàng dưới khoá mà không trừ phần đang giữ (bước kiểm trước có trừ ⇒ chỉ lọt khi đua).
--   • adjust_inventory_atomic hạ tồn xuống dưới phần đang giữ được.
--   • 6 chỗ tự viết CASE trạng thái khác nhau ⇒ hàm inventory_entry_status(status hiện tại, còn, nhập, giữ): giữ chỗ > 0 ⇒ LOOSE_PICKING;
--     trạng thái đặc biệt khác bộ bốn IN_STOCK / PARTIAL / EXPORTED / LOOSE_PICKING (vd QUARANTINE) giữ nguyên.
-- Hàm MES (mes_consume_scan / lot / reverse) = bản đang chạy + thay đúng lời gọi mes_entry_status (sinh bằng gen_w5.cjs).
BEGIN;

CREATE OR REPLACE FUNCTION public.inventory_entry_status(p_cur text, p_remaining numeric, p_imported numeric, p_reserved numeric) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_cur IS NOT NULL AND p_cur NOT IN ('IN_STOCK', 'PARTIAL', 'EXPORTED', 'LOOSE_PICKING') THEN p_cur
    WHEN coalesce(p_reserved, 0) > 0 THEN 'LOOSE_PICKING'
    WHEN coalesce(p_remaining, 0) <= 0 THEN 'EXPORTED'
    WHEN p_remaining < coalesce(p_imported, 0) THEN 'PARTIAL'
    ELSE 'IN_STOCK' END
$$;
COMMENT ON FUNCTION public.inventory_entry_status(text, numeric, numeric, numeric) IS
  'MỘT luật trạng thái của dòng tồn sau khi đổi còn / giữ (25/11). Cửa ghi mới đổi cartons_remaining / cartons_reserved thì gọi hàm này, đừng tự viết CASE.';
-- giữ tên cũ cho chỗ nào còn gọi (không còn hàm MES nào gọi sau migration này)
CREATE OR REPLACE FUNCTION public.mes_entry_status(p_remaining numeric, p_imported numeric) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT public.inventory_entry_status(NULL, p_remaining, p_imported, 0) $$;

CREATE OR REPLACE FUNCTION public.outbound_consume_exact(p_entry_id text, p_amount numeric, p_now text) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_remaining numeric;
  v_imported  numeric;
  v_reserved  numeric;
  v_status    text;
  v_new       numeric;
  v_newst     text;
BEGIN
  SELECT COALESCE(cartons_remaining, cartons_imported, 0), COALESCE(cartons_imported, 0), COALESCE(cartons_reserved, 0), status
    INTO v_remaining, v_imported, v_reserved, v_status
  FROM "InventoryEntry" WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('missing', true);
  END IF;
  -- 25/11: phần đang GIỮ cho nhặt lẻ không lấy được (bước kiểm trước của scanItem có trừ — dưới khoá cũng phải trừ)
  IF v_remaining - v_reserved < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'remaining', GREATEST(v_remaining - v_reserved, 0));
  END IF;
  v_new   := v_remaining - p_amount;
  v_newst := inventory_entry_status(v_status, v_new, v_imported, v_reserved);
  UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = v_newst, updated_at = p_now::timestamp WHERE id = p_entry_id;
  RETURN jsonb_build_object('ok', true, 'remaining', v_new, 'status', v_newst);
END $$;

CREATE OR REPLACE FUNCTION public.outbound_adjust_entry(p_entry_id text, p_delta_remaining numeric, p_delta_reserved numeric, p_now text) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_remaining numeric;
  v_reserved  numeric;
  v_imported  numeric;
  v_cur       text;
  v_new_rem   numeric;
  v_new_res   numeric;
  v_status    text;
BEGIN
  SELECT COALESCE(cartons_remaining, 0), COALESCE(cartons_reserved, 0), COALESCE(cartons_imported, 0), status
    INTO v_remaining, v_reserved, v_imported, v_cur
  FROM "InventoryEntry" WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('missing', true);
  END IF;
  v_new_rem := GREATEST(0, v_remaining + p_delta_remaining);
  v_new_res := GREATEST(0, v_reserved  + p_delta_reserved);
  v_status  := inventory_entry_status(v_cur, v_new_rem, v_imported, v_new_res);
  UPDATE "InventoryEntry"
     SET cartons_remaining = v_new_rem, cartons_reserved = v_new_res, status = v_status, updated_at = p_now::timestamp
   WHERE id = p_entry_id;
  -- clamped: lượng trừ vượt tồn (dấu hiệu xuất lố ở cửa khác) — trả ra để controller ghi vết, không còn im lặng
  RETURN jsonb_build_object('ok', true, 'remaining', v_new_rem, 'reserved', v_new_res, 'status', v_status,
                            'clamped', (v_remaining + p_delta_remaining < 0 OR v_reserved + p_delta_reserved < 0));
END $$;

CREATE OR REPLACE FUNCTION public.adjust_inventory_atomic(p_entry_id text, p_delta numeric, p_note text, p_actor_name text, p_actor_id text, p_stocktake_by text, p_now text, p_vn_date text, p_updated_by text)
RETURNS text LANGUAGE plpgsql AS $$
declare
  v_before    numeric;
  v_imported  numeric;
  v_adj       numeric;
  v_status    text;
  v_reserved  numeric;
  v_new       numeric;
  v_newstatus text;
begin
  -- Khóa dòng: mọi lượt chỉnh cùng pallet xếp hàng, không mất cập nhật, không cần CAS client.
  select cartons_remaining, cartons_imported, adjustment_qty, status, coalesce(cartons_reserved, 0)
    into v_before, v_imported, v_adj, v_status, v_reserved
  from "InventoryEntry" where id = p_entry_id
  for update;

  if not found then return 'NOT_FOUND'; end if;

  v_before := coalesce(v_before, 0);
  v_new    := v_before + p_delta;
  if v_new < 0 then return 'NEGATIVE'; end if;
  -- 25/11: không hạ tồn xuống dưới phần đang GIỮ cho nhặt lẻ (người đang nhặt sẽ xác nhận trừ phần đó)
  if p_delta < 0 and v_new < v_reserved then return 'RESERVED'; end if;

  v_newstatus := inventory_entry_status(v_status, v_new, v_imported, v_reserved);

  update "InventoryEntry" set
    cartons_remaining = v_new,
    adjustment_qty    = coalesce(v_adj, 0) + p_delta,
    status            = v_newstatus,
    updated_at        = p_now::timestamp,
    update_date       = p_vn_date::timestamp,
    updated_by        = coalesce(p_updated_by, updated_by),
    stocktake_by      = case when p_stocktake_by is not null then p_stocktake_by else stocktake_by end,
    stocktake_at      = case when p_stocktake_by is not null then p_now::timestamptz else stocktake_at end
  where id = p_entry_id;

  insert into "InventoryAdjustmentLog"(id, entry_id, delta, cartons_before, cartons_after, note, actor_name, actor_id, adjusted_at)
    values (gen_random_uuid()::text, p_entry_id, p_delta, v_before, v_new,
            p_note, p_actor_name, p_actor_id, p_now::timestamptz);

  return 'OK';
end
$$;

-- ── cửa tồn gộp của Xuất kho: thêm p_order_ids (thứ tự lấy theo luân chuyển, code tính) ⇒ đổi chữ ký: bỏ bản cũ rồi tạo lại ──
DROP FUNCTION IF EXISTS public.outbound_pool_apply(text, text, text, text, numeric, text, text, boolean, boolean);
CREATE OR REPLACE FUNCTION public.outbound_pool_apply(p_item_id text, p_material_code text, p_warehouse_id text, p_mode text, p_new_qty numeric,
  p_item_status text, p_chosen_date text DEFAULT NULL::text, p_claim_only_pending boolean DEFAULT false, p_touch_pool boolean DEFAULT true,
  p_order_ids text[] DEFAULT NULL::text[])
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_now   timestamp := (now() AT TIME ZONE 'UTC');
  v_old   numeric;
  v_status text;
  v_delta numeric;
  v_pool  RECORD;
  v_total numeric := 0;
  v_need  numeric;
  v_take  numeric;
  v_entry text := NULL;
  v_scan_id text;
  v_has_rows boolean := false;
BEGIN
  SELECT cartons_scanned, status INTO v_old, v_status
  FROM "OutboundItem" WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'NOT_FOUND'); END IF;
  IF p_claim_only_pending AND v_status = 'COMPLETED' THEN
    RETURN jsonb_build_object('outcome', 'CLAIM_LOST');
  END IF;

  v_old   := COALESCE(v_old, 0);
  v_delta := p_new_qty - v_old;

  IF p_touch_pool AND v_delta <> 0 THEN
    -- Khóa TOÀN BỘ dòng pool của (mã, kho) — vài chục dòng là nhiều (1 dòng/NSX ở QTY_DATE)
    CREATE TEMP TABLE IF NOT EXISTS _pool_rows_v2(
      id text, remaining numeric, imported numeric, reserved numeric, status text, eligible boolean, ord int) ON COMMIT DROP;
    TRUNCATE _pool_rows_v2;
    -- FOR UPDATE không đứng chung window function → khóa ở subquery, đánh số ở ngoài.
    -- 25/11: "lấy được" = trạng thái lấy được (cùng PICKABLE_STATUSES của cửa quét) + KHÔNG bị QA giữ (qa_is_hold); khả dụng = còn − giữ.
    -- Thứ tự: theo p_order_ids (luân chuyển của kho, code tính bằng helper chung) rồi mới tới NSX cũ trước như cũ.
    INSERT INTO _pool_rows_v2
    SELECT locked.id, COALESCE(locked.cartons_remaining, 0), COALESCE(locked.cartons_imported, 0), COALESCE(locked.cartons_reserved, 0),
           locked.status,
           (locked.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING') AND NOT qa_is_hold(locked.qa_status_id)),
           row_number() OVER (ORDER BY array_position(p_order_ids, locked.id) NULLS LAST, locked.production_date ASC NULLS LAST, locked.id)::int
    FROM (
      SELECT e.id, e.cartons_remaining, e.cartons_imported, e.cartons_reserved, e.status, e.qa_status_id, e.production_date
      FROM "InventoryEntry" e
      WHERE e.pallet_code = p_material_code AND e.warehouse_id = p_warehouse_id
        AND (p_mode <> 'QTY_DATE' OR p_chosen_date IS NULL
             OR to_char(e.production_date, 'YYYY-MM-DD') = p_chosen_date)
      FOR UPDATE OF e
    ) locked;
    SELECT COALESCE(SUM(GREATEST(remaining - reserved, 0)) FILTER (WHERE eligible), 0), COUNT(*) > 0 INTO v_total, v_has_rows FROM _pool_rows_v2;

    IF v_delta > 0 THEN
      -- TRỪ TỒN
      IF NOT v_has_rows THEN
        IF p_mode IN ('QTY', 'QTY_DATE') THEN
          RETURN jsonb_build_object('outcome', 'INSUFFICIENT', 'available', 0);
        END IF;   -- NONE/khác: không theo dõi mã này — đi tiếp không đụng tồn
      ELSIF v_total < v_delta THEN
        RETURN jsonb_build_object('outcome', 'INSUFFICIENT', 'available', v_total);
      ELSE
        v_need := v_delta;
        FOR v_pool IN
          SELECT * FROM _pool_rows_v2 WHERE eligible AND remaining - reserved > 0
          ORDER BY CASE WHEN p_order_ids IS NOT NULL OR p_mode = 'QTY_DATE' THEN ord END ASC NULLS LAST,
                   CASE WHEN p_order_ids IS NULL AND p_mode IS DISTINCT FROM 'QTY_DATE' THEN remaining END DESC NULLS LAST,
                   ord
        LOOP
          EXIT WHEN v_need <= 0;
          v_take := LEAST(v_need, v_pool.remaining - v_pool.reserved);
          UPDATE "InventoryEntry" SET
            cartons_remaining = cartons_remaining - v_take,
            status = inventory_entry_status(status, cartons_remaining - v_take, cartons_imported, cartons_reserved),
            updated_at = v_now
          WHERE id = v_pool.id;
          v_need := v_need - v_take;
          IF v_entry IS NULL THEN v_entry := v_pool.id; END IF;
        END LOOP;
      END IF;
    ELSE
      -- HOÀN TỒN |v_delta|: dòng còn tồn đầu tiên (QTY_DATE = NSX cũ nhất), không có thì dòng đầu
      IF v_has_rows THEN
        SELECT id INTO v_entry FROM _pool_rows_v2
        ORDER BY (remaining > 0) DESC, ord ASC LIMIT 1;
        UPDATE "InventoryEntry" SET
          cartons_remaining = cartons_remaining - v_delta,   -- v_delta âm → cộng
          status = inventory_entry_status(status, cartons_remaining - v_delta, cartons_imported, cartons_reserved),
          updated_at = v_now
        WHERE id = v_entry;
      END IF;   -- không dòng nào = mã không theo dõi → hoàn là noop (như cũ)
    END IF;
  END IF;

  UPDATE "OutboundItem"
  SET status = p_item_status, cartons_scanned = p_new_qty, updated_at = v_now
  WHERE id = p_item_id;

  IF p_touch_pool THEN
    SELECT id INTO v_scan_id FROM "OutboundScanEntry" WHERE item_id = p_item_id LIMIT 1;
    IF v_scan_id IS NOT NULL THEN
      UPDATE "OutboundScanEntry"
      SET cartons_scanned = p_new_qty,
          inventory_entry_id = COALESCE(v_entry, inventory_entry_id),
          updated_at = v_now
      WHERE id = v_scan_id;
    ELSE
      INSERT INTO "OutboundScanEntry"(id, item_id, inventory_entry_id, pallet_code, cartons_scanned,
        is_loose_picking, scanned_at, created_at, updated_at)
      VALUES (gen_random_uuid()::text, p_item_id, v_entry, p_material_code, p_new_qty,
        false, v_now, v_now, v_now);
    END IF;
  END IF;

  RETURN jsonb_build_object('outcome', 'OK', 'inv_entry_id', v_entry, 'available', v_total - v_delta);
END $$;
REVOKE ALL ON FUNCTION public.outbound_pool_apply(text, text, text, text, numeric, text, text, boolean, boolean, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outbound_pool_apply(text, text, text, text, numeric, text, text, boolean, boolean, text[]) TO service_role;

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
  UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = inventory_entry_status(e.status, v_new, COALESCE(e.cartons_imported, 0), e.cartons_reserved),
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
END $function$;

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
    UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = inventory_entry_status(e.status, v_new, COALESCE(e.cartons_imported, 0), e.cartons_reserved),
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
END $function$;

CREATE OR REPLACE FUNCTION public.mes_consume_reverse(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  c     record;
  e     record;
  v_new numeric;
BEGIN
  IF length(btrim(coalesce(p->>'reason', ''))) = 0 THEN RAISE EXCEPTION 'MESERR:REASON|Nhập lý do huỷ'; END IF;
  SELECT * INTO c FROM batch_consumption WHERE id = p->>'consumption_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy dòng rút'; END IF;
  IF c.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'MESERR:ALREADY_REVERSED|Dòng rút này đã huỷ rồi'; END IF;
  PERFORM mes_open_batch_wh(c.batch_id);
  SELECT * INTO e FROM "InventoryEntry" WHERE id = c.entry_id FOR UPDATE;
  v_new := COALESCE(e.cartons_remaining, 0) + c.qty;
  UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = inventory_entry_status(e.status, v_new, COALESCE(e.cartons_imported, 0), e.cartons_reserved),
         updated_at = now() WHERE id = e.id;
  UPDATE batch_consumption SET reversed_at = now(), reversed_by = p->>'actor_id', reversed_by_name = p->>'actor_name',
         reverse_reason = left(btrim(p->>'reason'), 500), updated_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('id', c.id, 'entry_id', e.id, 'remaining', v_new);
END $function$;

-- Lưới tự kiểm (dữ liệu giả, rollback)
DO $$
DECLARE v_mat text; v_wh text; v_qa text; r jsonb; v_err text; v_s text; c record;
BEGIN
  -- bảng ca CHUNG với bản TS (backend/tests/unit/inventoryStatusCases.json — gen_w5.cjs chép vào đây)
  FOR c IN SELECT * FROM jsonb_to_recordset('[{"cur":"IN_STOCK","remaining":100,"imported":100,"reserved":0,"want":"IN_STOCK"},{"cur":"IN_STOCK","remaining":60,"imported":100,"reserved":0,"want":"PARTIAL"},{"cur":"PARTIAL","remaining":0,"imported":100,"reserved":0,"want":"EXPORTED"},{"cur":"PARTIAL","remaining":60,"imported":100,"reserved":20,"want":"LOOSE_PICKING"},{"cur":"LOOSE_PICKING","remaining":60,"imported":100,"reserved":0,"want":"PARTIAL"},{"cur":"LOOSE_PICKING","remaining":20,"imported":100,"reserved":20,"want":"LOOSE_PICKING"},{"cur":"QUARANTINE","remaining":60,"imported":100,"reserved":0,"want":"QUARANTINE"},{"cur":"EXPORTED","remaining":30,"imported":100,"reserved":0,"want":"PARTIAL"},{"cur":"EXPORTED","remaining":150,"imported":150,"reserved":0,"want":"IN_STOCK"},{"cur":null,"remaining":100,"imported":100,"reserved":0,"want":"IN_STOCK"},{"cur":null,"remaining":-5,"imported":100,"reserved":0,"want":"EXPORTED"},{"cur":"IN_STOCK","remaining":120,"imported":100,"reserved":0,"want":"IN_STOCK"}]'::jsonb) AS x(cur text, remaining numeric, imported numeric, reserved numeric, want text) LOOP
    IF inventory_entry_status(c.cur, c.remaining, c.imported, c.reserved) IS DISTINCT FROM c.want THEN
      RAISE EXCEPTION 'inventory_entry_status(%, %, %, %) = % — bảng ca muốn %', c.cur, c.remaining, c.imported, c.reserved,
        inventory_entry_status(c.cur, c.remaining, c.imported, c.reserved), c.want;
    END IF;
  END LOOP;
  SELECT id INTO v_mat FROM "Material" ORDER BY id LIMIT 1;
  SELECT id INTO v_wh FROM "Warehouse" ORDER BY id LIMIT 1;
  SELECT id INTO v_qa FROM "QAStatus" WHERE code <> 'OK' ORDER BY id LIMIT 1;
  IF v_mat IS NULL OR v_wh IS NULL THEN RAISE NOTICE 'tự kiểm đợt 5: thiếu mã / kho — bỏ qua'; RETURN; END IF;
  BEGIN
    -- pool QAW5POOL: E1 còn 100, giữ 20 (đang nhặt lẻ) ⇒ lấy được 80; E2 còn 50 nhưng QA giữ ⇒ không lấy
    INSERT INTO "InventoryEntry" (id, pallet_code, material_id, warehouse_id, cartons_imported, cartons_remaining, cartons_reserved, status, qa_status_id, production_date, updated_at)
    VALUES ('QAW5_E1', 'QAW5POOL', v_mat, v_wh, 100, 100, 20, 'LOOSE_PICKING', NULL, '2026-01-01', now()),
           ('QAW5_E2', 'QAW5POOL', v_mat, v_wh, 50, 50, 0, 'IN_STOCK', v_qa, '2025-12-01', now());
    INSERT INTO "GroupDeliveryOrder" (id, group_code, planned_date, delivery_date, warehouse_id, updated_at) VALUES ('QAW5_G', 'QAW5G', current_date, current_date, v_wh, now());
    INSERT INTO "OutboundDelivery" (id, gdo_id, updated_at) VALUES ('QAW5_D', 'QAW5_G', now());
    INSERT INTO "OutboundItem" (id, do_id, cartons_ordered, cartons_scanned, status, updated_at) VALUES ('QAW5_I', 'QAW5_D', 200, 0, 'PENDING', now());
    r := outbound_pool_apply('QAW5_I', 'QAW5POOL', v_wh, 'QTY', 100, 'IN_PROGRESS');
    IF r->>'outcome' <> 'INSUFFICIENT' OR (r->>'available')::numeric <> (CASE WHEN v_qa IS NULL THEN 130 ELSE 80 END) THEN
      RAISE EXCEPTION 'pool: lấy 100 phải INSUFFICIENT còn % (trừ giữ chỗ + QA giữ), nhận %', CASE WHEN v_qa IS NULL THEN 130 ELSE 80 END, r;
    END IF;
    r := outbound_pool_apply('QAW5_I', 'QAW5POOL', v_wh, 'QTY', 80, 'IN_PROGRESS');
    SELECT status INTO v_s FROM "InventoryEntry" WHERE id = 'QAW5_E1';
    IF r->>'outcome' <> 'OK' OR (SELECT cartons_remaining FROM "InventoryEntry" WHERE id = 'QAW5_E1') <> 20 OR v_s <> 'LOOSE_PICKING'
       OR (v_qa IS NOT NULL AND (SELECT cartons_remaining FROM "InventoryEntry" WHERE id = 'QAW5_E2') <> 50) THEN
      RAISE EXCEPTION 'pool: lấy 80 phải trừ E1 còn 20 (= phần giữ, vẫn LOOSE_PICKING), E2 QA giữ không đụng; nhận % / %', r, v_s;
    END IF;
    -- cửa quét: E1 còn 20 nhưng giữ 20 ⇒ quét 1 không được
    r := outbound_consume_exact('QAW5_E1', 1, now()::text);
    IF (r->>'ok')::boolean THEN RAISE EXCEPTION 'consume_exact: phần đang giữ không được lấy, nhận %', r; END IF;
    -- điều chỉnh tồn xuống dưới phần giữ ⇒ RESERVED
    IF adjust_inventory_atomic('QAW5_E1', -5, 'tự kiểm', NULL, NULL, NULL, now()::text, current_date::text, NULL) <> 'RESERVED' THEN
      RAISE EXCEPTION 'adjust: hạ dưới phần giữ phải RESERVED';
    END IF;
    RAISE EXCEPTION 'SELFTEST_OK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'SELFTEST_OK' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'tự kiểm đợt 5 (trạng thái · pool · quét · điều chỉnh): OK';
END $$;

COMMIT;
