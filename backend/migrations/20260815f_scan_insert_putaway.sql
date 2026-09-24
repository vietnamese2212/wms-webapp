-- scan_insert_pallet: nhận thêm 3 cột vết quy tắc cất hàng (20260815e).
--
-- BUG THẬT bắt được lúc kiểm sống đợt B: RPC insert bằng DANH SÁCH CỘT GHI TAY, nên key mới thêm
-- vào `entryObj` phía backend bị RƠI ÂM THẦM — không lỗi, không cảnh báo, API trả 200, chỉ có dữ
-- liệu là không tới nơi. tsc xanh, build xanh, test "quét thành công" cũng xanh.
-- ⇒ Kèm gác: bất biến QA 00 mục 12 đối chiếu key của `entryObj` với danh sách cột của RPC này,
--   thêm cột mà quên sửa RPC = ĐỎ ngay (luật "bug chết hai lần").

BEGIN;

CREATE OR REPLACE FUNCTION public.scan_insert_pallet(p_entry jsonb, p_location_id text, p_stack_layer integer)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
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
    import_date, update_date, created_at, updated_at,
    putaway_checked, putaway_violation, putaway_override_reason
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
    (p_entry->>'created_at')::timestamp, (p_entry->>'updated_at')::timestamp,
    -- COALESCE: bundle cũ / đường ghi khác không gửi khoá này thì giữ nghĩa "chưa đo"
    COALESCE((p_entry->>'putaway_checked')::boolean, false),
    NULLIF(p_entry->>'putaway_violation',''), NULLIF(p_entry->>'putaway_override_reason','')
  ) RETURNING id INTO v_id;

  RETURN 'OK|'||v_id;
EXCEPTION WHEN unique_violation THEN
  RETURN 'DUP';
END $function$;

-- Đọc định nghĩa 1 RPC (read-only) để bộ QA đối chiếu SỐNG danh sách cột với khoá backend gửi.
-- Không có cửa này thì bất biến 12 phải đoán, mà đoán chính là cách bug trên sống sót.
CREATE OR REPLACE FUNCTION public.rpc_source(p_name text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = p_name
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.rpc_source(text) TO service_role;

COMMIT;
