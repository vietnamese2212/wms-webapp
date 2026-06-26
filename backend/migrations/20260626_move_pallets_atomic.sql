-- ============================================================================
-- Dồn pallet vào 1 vị trí — kiểm SỨC CHỨA nguyên tử (chống đua quá-tải vị trí).
-- Cơ chế cũ trong bulkTransferLocation: COUNT pallet ở vị trí → so max_pallets →
-- UPDATE location_id. Đọc-rồi-ghi KHÔNG nguyên tử → 2 người dồn cùng lúc vào CÙNG
-- vị trí đều thấy còn chỗ → cùng move → VƯỢT max_pallets.
-- Fix (khuôn giống book_vehicle_slot): khóa dòng Location FOR UPDATE → đếm sống
-- DƯỚI LOCK → move trong cùng transaction. Lượt thứ 2 chờ lock, đếm lại đã thấy
-- pallet của lượt 1 → không thể vượt chỗ dù đua thế nào.
-- Idempotent: CREATE OR REPLACE.
-- Trả: 'OK|<code>' | 'FULL|<còn>|<code>' | 'NOT_FOUND' | 'INACTIVE' | 'NO_IDS'.
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

  -- Kiểm sức chứa DƯỚI LOCK (đếm sống; loại các pallet đang được dời vào để không double-count)
  IF v_max > 0 THEN
    SELECT COUNT(*) INTO v_used
    FROM "InventoryEntry"
    WHERE location_id = p_location_id
      AND status IN ('IN_STOCK','PARTIAL','QUARANTINE')
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
