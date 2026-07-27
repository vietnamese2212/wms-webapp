-- ============================================================================
-- LỌC TỒN KHO THEO KHO = CỘT warehouse_id TRỰC TIẾP (27/07/2026)
-- ----------------------------------------------------------------------------
-- BUG: filter Kho trên Tồn kho liệt kê MỌI location_id của kho rồi nhét vào
-- `.or(location_id.in.(...))` — Kho Bàu Bàng 1.517 vị trí → chuỗi filter ~56KB
-- → PostgREST nghiền 60s → Vercel 504 (kho ≤ ~350 vị trí như Ba Vì thì thoát).
-- FIX: lọc thẳng `InventoryEntry.warehouse_id` (đã có index idx_ie_wh_importdate).
-- Điều kiện: cột này phải LUÔN = kho thật (production di sản ~99.8% NULL với
-- pallet quét QR — kho suy từ Location). Migration này:
--   1) BACKFILL warehouse_id từ Location cho mọi dòng có vị trí (align: location thắng)
--   2) RPC move_pallets_to_location SYNC warehouse_id khi dồn/chuyển vị trí
--   3) Gác verify 0 dòng lệch
-- (Code đi kèm: mọi INSERT đã set warehouse_id — scanQR/transfer/upload/split;
--  bulkTransferLocation fallback + kiểm kê đổi vị trí sync thêm ở controller.)
-- Apply STAGING trước; production apply khi merge main (bảng lớn: UPDATE 1 lượt).
-- ============================================================================

BEGIN;

-- ── 1. Backfill: cột kho = kho của VỊ TRÍ (dòng không vị trí giữ nguyên cột sẵn có)
UPDATE "InventoryEntry" e
SET warehouse_id = l.warehouse_id::uuid
FROM "Location" l
WHERE l.id = e.location_id
  AND (e.warehouse_id IS NULL OR e.warehouse_id::text <> l.warehouse_id);

-- ── 2. RPC dồn/chuyển vị trí: sync warehouse_id trong cùng transaction
CREATE OR REPLACE FUNCTION public.move_pallets_to_location(p_ids text[], p_location_id text, p_updated_by text, p_update_date text, p_now text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_max    int;
  v_active boolean;
  v_code   text;
  v_wh     text;
  v_used   int;
  v_need   int;
BEGIN
  v_need := COALESCE(array_length(p_ids, 1), 0);
  IF v_need = 0 THEN RETURN 'NO_IDS'; END IF;

  -- Khóa dòng Location → serialize mọi lượt dồn vào CÙNG vị trí
  SELECT max_pallets, is_active, location_code, warehouse_id
    INTO v_max, v_active, v_code, v_wh
  FROM "Location" WHERE id = p_location_id FOR UPDATE;
  IF NOT FOUND   THEN RETURN 'NOT_FOUND'; END IF;
  IF NOT v_active THEN RETURN 'INACTIVE'; END IF;

  -- Kiểm sức chứa DƯỚI LOCK (đếm sống; loại pallet đang được dời vào + pallet tồn=0)
  IF v_max > 0 THEN
    SELECT COUNT(*) INTO v_used
    FROM "InventoryEntry"
    WHERE location_id = p_location_id
      AND status IN ('IN_STOCK','PARTIAL','QUARANTINE')
      AND cartons_remaining > 0
      AND NOT (id = ANY(p_ids));
    IF (v_max - v_used) < v_need THEN
      RETURN 'FULL|' || GREATEST(0, v_max - v_used)::text || '|' || COALESCE(v_code, '');
    END IF;
  END IF;

  UPDATE "InventoryEntry"
     SET location_id  = p_location_id,
         warehouse_id = v_wh::uuid,   -- sync cột lọc theo kho (filter Tồn kho lọc thẳng cột này)
         updated_at   = p_now::timestamp,
         update_date  = p_update_date::timestamp,
         updated_by   = COALESCE(p_updated_by, updated_by)
   WHERE id = ANY(p_ids);

  RETURN 'OK|' || COALESCE(v_code, '');
END $function$;

-- ── 3. Gác: sau backfill KHÔNG còn dòng nào lệch kho giữa cột và vị trí
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM "InventoryEntry" e JOIN "Location" l ON l.id = e.location_id
  WHERE e.warehouse_id::text IS DISTINCT FROM l.warehouse_id;
  IF n > 0 THEN
    RAISE EXCEPTION 'Còn % dòng tồn lệch kho giữa warehouse_id và Location — backfill chưa sạch', n;
  END IF;
END $$;

COMMIT;
