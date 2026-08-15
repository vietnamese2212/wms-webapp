-- ============================================================================
-- VÁ `rename_warehouse_type`: bổ sung 3 chỗ bị SÓT  (27/07/2026)
-- ----------------------------------------------------------------------------
-- Đổi tên 1 Loại kho trước đây cascade 11 bảng nhưng BỎ QUA 3 cột cũng chứa
-- Loại kho → sau khi đổi tên, 3 chỗ này còn trỏ vào tên CŨ (mồ côi âm thầm):
--   • Warehouse.carton_scan_categories (text[]) — cấu hình quét tem thùng per-kho
--   • PalletLabelPrint.category                  — lịch sử in tem
--   • StocktakeLog.category                      — nhật ký kiểm kê
-- Phát hiện khi rà đợt đổi taxonomy sang mã SAP 27/07 (lần đó 3 cột đều rỗng
-- nên CHƯA gây hậu quả — nhưng trên production có dữ liệu thì sẽ hỏng).
-- Thay đổi DUY NHẤT: thêm 3 lệnh UPDATE + 3 khóa trong jsonb trả về.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rename_warehouse_type(p_old text, p_new text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  counts jsonb := '{}'::jsonb;
  n bigint;
BEGIN
  p_new := btrim(p_new);
  IF p_old IS NULL OR p_new IS NULL OR p_new = '' OR p_old = p_new THEN
    RAISE EXCEPTION 'Tên mới không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = p_old) THEN
    RAISE EXCEPTION 'Loại kho "%" không tồn tại', p_old USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = p_new) THEN
    RAISE EXCEPTION 'Loại kho "%" đã tồn tại', p_new USING ERRCODE = '23505';
  END IF;

  UPDATE "LookupValue" SET value = p_new, updated_at = now()
    WHERE type = 'warehouse_type' AND value = p_old;

  UPDATE "Material" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Material', n);

  UPDATE "Location" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Location', n);

  UPDATE "WarehouseZone" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('WarehouseZone', n);

  UPDATE "Employee" SET allowed_categories = array_replace(allowed_categories, p_old, p_new)
    WHERE p_old = ANY(allowed_categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Employee', n);

  -- MỚI: cấu hình quét tem thùng theo kho (text[])
  UPDATE "Warehouse" SET carton_scan_categories = array_replace(carton_scan_categories, p_old, p_new)
    WHERE p_old = ANY(carton_scan_categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Warehouse', n);

  UPDATE "SlotTemplate" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('SlotTemplate', n);

  UPDATE "DeliverySlot" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('DeliverySlot', n);

  UPDATE "TmsOrder" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('TmsOrder', n);

  UPDATE "GroupDeliveryOrder" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('GroupDeliveryOrder', n);

  UPDATE gate_registrations SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('gate_registrations', n);

  UPDATE inbound_plan_lines SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('inbound_plan_lines', n);

  UPDATE "ProductionImport" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('ProductionImport', n);

  -- MỚI: lịch sử in tem + nhật ký kiểm kê (snapshot loại hàng)
  UPDATE "PalletLabelPrint" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('PalletLabelPrint', n);

  UPDATE "StocktakeLog" SET category = p_new, updated_at = now() WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('StocktakeLog', n);

  RETURN counts;
END;
$function$;
