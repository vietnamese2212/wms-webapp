-- QUY TẮC CẤT HÀNG — luật "tối đa N mã / vị trí" phải kiểm DƯỚI ROW-LOCK.
--
-- ĐO THẬT 15/08: kho đặt 1 mã/ô, bắn 6 lượt quét ĐỒNG THỜI 6 mã khác nhau vào cùng ô trống →
-- **3 mã lọt vào**. Luật kiểm ở backend (đọc-rồi-ghi) nên nhiều lượt cùng đọc "ô đang có 0 mã"
-- rồi cùng ghi. Đây đúng lớp lỗi CLAUDE.md gọi tên: bộ đếm trên tài nguyên DÙNG CHUNG phải nguyên tử.
--
-- Cách sửa KHÔNG đẻ bản luật thứ hai: không chép cả bộ quy tắc xuống SQL, chỉ đưa DUY NHẤT ràng
-- buộc mang tính "đếm dưới khoá" vào RPC — cùng khuôn với phép kiểm sức chứa vốn đã nằm ở đây.
-- Backend vẫn là nơi QUYẾT ĐỊNH (nó truyền p_max_materials=NULL khi luật tắt hoặc khi đã được
-- duyệt vượt rào); RPC chỉ chốt lại con số dưới lock.

BEGIN;

DROP FUNCTION IF EXISTS public.scan_insert_pallet(jsonb, text, integer);
CREATE OR REPLACE FUNCTION public.scan_insert_pallet(
  p_entry         jsonb,
  p_location_id   text,
  p_stack_layer   integer,
  p_max_materials integer DEFAULT NULL   -- NULL = không ràng buộc (luật tắt / đã duyệt vượt rào)
)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_max  int;
  v_used int;
  v_mats int;
  v_has  boolean;
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

  -- Số mã trong ô — ĐẾM DƯỚI LOCK (khoá dòng Location ở trên). Mã đã có sẵn trong ô thì không
  -- làm tăng số mã ⇒ không chặn (khớp đúng putawayBlock ở backend).
  IF p_max_materials IS NOT NULL THEN
    SELECT count(DISTINCT material_id),
           bool_or(material_id = p_entry->>'material_id')
      INTO v_mats, v_has
      FROM "InventoryEntry"
      WHERE location_id = p_location_id AND stack_layer = 1
        AND status IN ('IN_STOCK','PARTIAL') AND cartons_remaining > 0;
    IF COALESCE(v_has, false) = false AND COALESCE(v_mats, 0) >= p_max_materials THEN
      RETURN 'MAXMAT|'||COALESCE(v_mats,0)||'|'||p_max_materials;
    END IF;
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

GRANT EXECUTE ON FUNCTION public.scan_insert_pallet(jsonb, text, integer, integer) TO service_role;

COMMIT;
