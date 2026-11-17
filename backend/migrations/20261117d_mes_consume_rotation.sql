-- MES 17/11 — cấp NVL cho mẻ là một loại XUẤT (user: "khi quét tem trong Mẻ thì cũng phải có các chức năng như bên xuất
-- hàng … xem được tồn kho đang ở đâu, date là gì, FIFO đã phù hợp chưa"). Luật luân chuyển chấm ở controller bằng CÙNG
-- helper với quét xuất (utils/rotation.ts); ở đây chỉ GHI VẾT lên dòng cấp, cùng bộ cột với OutboundScanEntry:
--   rotation_violation · rotation_principle · rotation_best_date · rotation_override_reason.
BEGIN;

ALTER TABLE batch_consumption ADD COLUMN IF NOT EXISTS rotation_violation boolean;
ALTER TABLE batch_consumption ADD COLUMN IF NOT EXISTS rotation_principle text;
ALTER TABLE batch_consumption ADD COLUMN IF NOT EXISTS rotation_best_date text;
ALTER TABLE batch_consumption ADD COLUMN IF NOT EXISTS rotation_override_reason text;

-- p: {batch_id, entry_id, qty, actor_id, actor_name, rotation?: {violation, principle, best_date, override_reason}}
CREATE OR REPLACE FUNCTION public.mes_consume_scan(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_wh   text := mes_open_batch_wh(p->>'batch_id');
  v_qty  numeric := (p->>'qty')::numeric;
  v_rot  jsonb := COALESCE(p->'rotation', '{}'::jsonb);
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
         qty, source, created_by, created_by_name, created_at, updated_at,
         rotation_violation, rotation_principle, rotation_best_date, rotation_override_reason)
  VALUES (v_id, p->>'batch_id', e.id, e.pallet_code, e.material_id, e.production_date::date, e.batch, e.ncc_id,
         v_qty, 'SCAN', p->>'actor_id', p->>'actor_name', now(), now(),
         CASE WHEN v_rot ? 'violation' THEN (v_rot->>'violation')::boolean END,
         NULLIF(v_rot->>'principle', ''), NULLIF(v_rot->>'best_date', ''), NULLIF(v_rot->>'override_reason', ''));
  RETURN jsonb_build_object('rows', jsonb_build_array(jsonb_build_object('id', v_id, 'entry_id', e.id, 'pallet_code', e.pallet_code,
    'qty', v_qty, 'remaining', v_new, 'rotation_violation', (v_rot->>'violation')::boolean)));
END $$;

COMMIT;
