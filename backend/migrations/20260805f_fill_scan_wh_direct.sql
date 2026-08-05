-- 20260805f — fill_scan_apply: xác định KHO của pallet bằng cột InventoryEntry.warehouse_id TRỰC TIẾP
-- (user báo 05/08: quét pallet có tồn nhưng bị chối). Bản cũ suy kho qua JOIN Location nên pallet
-- CHƯA GÁN VỊ TRÍ (location_id NULL — phổ biến ngay sau quét nhập) có loc_wh = NULL
-- → `IS DISTINCT FROM t.warehouse_id` = WRONG_WAREHOUSE oan. Luật CLAUDE.md: lọc theo KHO phải dùng
-- cột warehouse_id trực tiếp. Đổi duy nhất 2 chỗ: SELECT thêm e2.warehouse_id AS ent_wh + check
-- COALESCE(loc_wh, ent_wh). Pallet chưa gán vị trí vẫn phải KHÔNG ở pick-face (loc NULL ⇒ false) — giữ nguyên.

CREATE OR REPLACE FUNCTION fill_scan_apply(
  p_task_id        text,
  p_entry_id       text,
  p_to_location_id text,
  p_actor_id       text,
  p_actor_name     text,
  p_take_over      boolean,
  p_update_date    text,
  p_now            text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  t        "FillTask"%ROWTYPE;
  e        record;
  v_avail  numeric;
  v_mv     text;
  v_code   text;
  v_done   boolean;
  v_claim  boolean;
  v_ts     timestamptz := p_now::timestamptz;
  v_ord    text;
BEGIN
  SELECT * INTO t FROM "FillTask" WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF t.status <> 'PENDING' THEN RETURN jsonb_build_object('code', 'NOT_PENDING'); END IF;

  SELECT e2.id, e2.material_id, e2.pallet_code, e2.status, e2.production_date,
         e2.cartons_remaining, e2.cartons_reserved, e2.warehouse_id AS ent_wh,
         l.is_pick_face, l.warehouse_id AS loc_wh, l.location_code AS loc_code
  INTO e
  FROM "InventoryEntry" e2 LEFT JOIN "Location" l ON l.id = e2.location_id
  WHERE e2.id = p_entry_id
  FOR UPDATE OF e2;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'PALLET_NOT_FOUND'); END IF;

  v_avail := GREATEST(0, e.cartons_remaining - COALESCE(e.cartons_reserved, 0));
  IF e.status NOT IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') OR v_avail <= 0 THEN
    RETURN jsonb_build_object('code', 'GONE');
  END IF;
  -- Kho của pallet = vị trí đang đứng, pallet CHƯA GÁN VỊ TRÍ thì lấy kho của chính entry
  IF COALESCE(e.loc_wh::text, e.ent_wh::text) IS DISTINCT FROM t.warehouse_id::text THEN
    RETURN jsonb_build_object('code', 'WRONG_WAREHOUSE');
  END IF;
  IF COALESCE(e.is_pick_face, false) THEN RETURN jsonb_build_object('code', 'ALREADY_PICK_FACE'); END IF;
  IF e.material_id IS DISTINCT FROM t.material_id THEN RETURN jsonb_build_object('code', 'WRONG_MATERIAL'); END IF;
  IF t.required_date IS NOT NULL
     AND (e.production_date IS NULL OR e.production_date::date <> t.required_date) THEN
    RETURN jsonb_build_object('code', 'DATE_MISMATCH',
                              'required_date', t.required_date, 'pallet_date', e.production_date::date);
  END IF;
  IF EXISTS (SELECT 1 FROM "FillTaskScan" s WHERE s.task_id = t.id AND s.entry_id = p_entry_id) THEN
    RETURN jsonb_build_object('code', 'DUP');
  END IF;

  v_mv   := move_pallets_to_location(ARRAY[p_entry_id], p_to_location_id, p_actor_id, p_update_date, p_now);
  v_code := split_part(v_mv, '|', 1);
  IF v_code <> 'OK' THEN
    RETURN jsonb_build_object('code', v_code, 'move', v_mv);
  END IF;

  INSERT INTO "FillTaskScan"(id, task_id, fill_order_id, entry_id, pallet_code, qty_base, production_date,
                             from_location_code, to_location_id, to_location_code,
                             scanned_by, scanned_by_name, created_at, updated_at)
  VALUES (gen_random_uuid()::text, t.id, t.fill_order_id, p_entry_id, e.pallet_code, v_avail,
          e.production_date::date, e.loc_code, p_to_location_id,
          (SELECT location_code FROM "Location" WHERE id = p_to_location_id),
          p_actor_id, p_actor_name, v_ts, v_ts);

  v_done  := (t.scanned_pallets + 1 >= t.required_pallets) OR (t.qty_done_base + v_avail >= t.qty_base);
  v_claim := (t.assignee_id IS NULL AND p_actor_id IS NOT NULL)
             OR (p_take_over AND p_actor_id IS NOT NULL AND t.assignee_id IS DISTINCT FROM p_actor_id);

  UPDATE "FillTask" SET
    scanned_pallets  = scanned_pallets + 1,
    qty_done_base    = qty_done_base + v_avail,
    to_location_id   = p_to_location_id,
    to_location_code = (SELECT location_code FROM "Location" WHERE id = p_to_location_id),
    status           = CASE WHEN v_done THEN 'DONE' ELSE 'PENDING' END,
    done_at          = CASE WHEN v_done THEN v_ts ELSE done_at END,
    done_by          = CASE WHEN v_done THEN p_actor_id ELSE done_by END,
    done_by_name     = CASE WHEN v_done THEN p_actor_name ELSE done_by_name END,
    assignee_id      = CASE WHEN v_claim THEN p_actor_id   ELSE assignee_id END,
    assignee_name    = CASE WHEN v_claim THEN p_actor_name ELSE assignee_name END,
    assigned_by      = CASE WHEN v_claim THEN p_actor_name ELSE assigned_by END,
    assigned_at      = CASE WHEN v_claim THEN v_ts          ELSE assigned_at END,
    updated_at       = v_ts
  WHERE id = t.id
  RETURNING * INTO t;

  v_ord := fill_order_rollup(t.fill_order_id, v_ts);

  RETURN jsonb_build_object('code', 'OK', 'moved', true, 'scanned_qty', v_avail,
                            'task', to_jsonb(t), 'order_status', v_ord);
END $$;
