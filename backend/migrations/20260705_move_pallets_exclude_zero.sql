-- ============================================================================
-- Sức chứa vị trí: LOẠI pallet tồn=0 khỏi đếm chiếm chỗ.
-- Bối cảnh: upload Tồn kho giờ chấp nhận tồn=0 (snapshot đầy đủ) → DB có ~31k bản ghi
-- IN_STOCK với cartons_remaining=0 vẫn gắn location_id. Pallet hết hàng KHÔNG còn nằm
-- trên sàn nhưng bị RPC move_pallets_to_location đếm vào used_slots → 134 vị trí báo
-- "đầy" oan (chặn dồn pallet / gợi ý vị trí sai). Các count phía JS đã sửa cùng ngày
-- (inbound suggest/scan, listLocations used_slots, move fallback) — RPC này là chỗ cuối.
-- Idempotent: CREATE OR REPLACE.
-- ============================================================================
CREATE OR REPLACE FUNCTION move_pallets_to_location(
  p_ids         text[],
  p_location_id text,
  p_updated_by  text,
  p_update_date text,
  p_now         text
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_max    int;
  v_active boolean;
  v_code   text;
  v_used   int;
  v_need   int;
BEGIN
  v_need := COALESCE(array_length(p_ids, 1), 0);
  IF v_need = 0 THEN RETURN 'NO_IDS'; END IF;

  -- Khóa dòng Location → serialize mọi lượt dồn vào CÙNG vị trí
  SELECT max_pallets, is_active, location_code
    INTO v_max, v_active, v_code
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
     SET location_id = p_location_id,
         updated_at  = p_now::timestamp,
         update_date = p_update_date::timestamp,
         updated_by  = COALESCE(p_updated_by, updated_by)
   WHERE id = ANY(p_ids);

  RETURN 'OK|' || COALESCE(v_code, '');
END $$;
