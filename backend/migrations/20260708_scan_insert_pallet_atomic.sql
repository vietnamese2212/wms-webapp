-- Nhập kho NGUYÊN TỬ: khóa dòng Location (FOR UPDATE) → đếm sức chứa/kiểm tầng dưới DƯỚI LOCK → INSERT
-- cùng transaction. Chống đua quá-tải khi nhiều người quét cùng 1 vị trí (trước đây check-rồi-insert,
-- 2 request đồng thời cùng thấy còn chỗ → vượt max). Đếm loại pallet tồn=0 (khớp preview + move_pallets RPC).
-- Trả text: 'OK|<id>' | 'FULL|<used>|<max>' | 'NO_BASE' | 'DUP' | 'NOLOC'.
-- Cột: id/location_id/material_id/qa_status_id/created_by/updated_by/import_order_id = TEXT;
--      warehouse_id/ncc_id = UUID; production_date/import_date/update_date/created_at/updated_at = TIMESTAMP; expiry_date = DATE.
-- cartons_reserved KHÔNG set (giữ DEFAULT 0). status default IN_STOCK.
CREATE OR REPLACE FUNCTION scan_insert_pallet(p_entry jsonb, p_location_id text, p_stack_layer int)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_max  int;
  v_used int;
  v_id   text;
BEGIN
  SELECT max_pallets INTO v_max FROM "Location" WHERE id = p_location_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOLOC'; END IF;

  IF p_stack_layer = 1 THEN
    IF v_max > 0 THEN
      SELECT count(*) INTO v_used FROM "InventoryEntry"
        WHERE location_id = p_location_id AND stack_layer = 1
          AND status IN ('IN_STOCK','PARTIAL','QUARANTINE') AND cartons_remaining > 0;
      IF v_used >= v_max THEN RETURN 'FULL|'||v_used||'|'||v_max; END IF;
    END IF;
  ELSE
    PERFORM 1 FROM "InventoryEntry"
      WHERE location_id = p_location_id AND stack_layer = p_stack_layer - 1 AND status = 'IN_STOCK' LIMIT 1;
    IF NOT FOUND THEN RETURN 'NO_BASE'; END IF;
  END IF;

  INSERT INTO "InventoryEntry" (
    id, pallet_code, location_id, warehouse_id, material_id, manufacturer_id,
    nmsx, cycle, machine_code, pallet_sequence_no, stack_layer,
    cartons_imported, cartons_remaining, production_date, qa_status_id, batch, expiry_date,
    import_order_id, created_by, updated_by, status, ncc_id, shelf_life_days,
    import_date, update_date, created_at, updated_at
  ) VALUES (
    p_entry->>'id', p_entry->>'pallet_code', p_entry->>'location_id',
    NULLIF(p_entry->>'warehouse_id','')::uuid, p_entry->>'material_id', p_entry->>'manufacturer_id',
    p_entry->>'nmsx', p_entry->>'cycle', p_entry->>'machine_code',
    NULLIF(p_entry->>'pallet_sequence_no','')::int, (p_entry->>'stack_layer')::int,
    (p_entry->>'cartons_imported')::numeric, NULLIF(p_entry->>'cartons_remaining','')::numeric,
    NULLIF(p_entry->>'production_date','')::timestamp, p_entry->>'qa_status_id',
    p_entry->>'batch', NULLIF(p_entry->>'expiry_date','')::date,
    p_entry->>'import_order_id', p_entry->>'created_by', p_entry->>'updated_by',
    COALESCE(NULLIF(p_entry->>'status',''),'IN_STOCK'), NULLIF(p_entry->>'ncc_id','')::uuid, NULLIF(p_entry->>'shelf_life_days','')::int,
    NULLIF(p_entry->>'import_date','')::timestamp, NULLIF(p_entry->>'update_date','')::timestamp,
    (p_entry->>'created_at')::timestamp, (p_entry->>'updated_at')::timestamp
  ) RETURNING id INTO v_id;

  RETURN 'OK|'||v_id;
EXCEPTION WHEN unique_violation THEN
  RETURN 'DUP';
END $$;
