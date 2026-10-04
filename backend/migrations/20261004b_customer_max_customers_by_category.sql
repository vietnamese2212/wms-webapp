-- 04/10/2026 — "SỐ KHÁCH TỐI ĐA CÙNG XE" THEO LOẠI KHO (user: "khách Trung chuyển mà đi FG01 thì đi một mình, còn FG02 thì ghép 3–4 điểm").
-- Trước: một số cho cả khách (Customer.max_customers_per_trip) / kênh (meta.max_customers_per_trip). Nay thêm bảng theo Loại kho
-- {"FG01": 1, "FG02": 4}; số cũ giữ vai "Chung" (Loại kho không khai riêng). Thứ tự máy áp (services/dispatchEngine resolveMaxCustomers):
-- Khách × Loại kho → Khách chung → Kênh × Loại kho → Kênh chung → chưa khai (= 1). OD nhiều Loại kho chính ⇒ số khắt khe nhất.
-- Kênh dùng LookupValue(customer_channel).meta.max_customers_by_category cùng hình dạng (không cột mới).
ALTER TABLE public."Customer" ADD COLUMN IF NOT EXISTS max_customers_by_category jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public."Customer" DROP CONSTRAINT IF EXISTS customer_max_customers_by_category_chk;
-- object + mọi giá trị là SỐ NGUYÊN 1…50 (strict: lax tự mở mảng; lỗi trong filter = unknown = không khớp nên tách hai vế)
ALTER TABLE public."Customer" ADD CONSTRAINT customer_max_customers_by_category_chk CHECK (
  jsonb_typeof(max_customers_by_category) = 'object'
  AND NOT jsonb_path_exists(max_customers_by_category, 'strict $.* ? (@.type() != "number")')
  AND NOT jsonb_path_exists(max_customers_by_category, 'strict $.* ? (@ < 1 || @ > 50 || @ != @.floor())')
);
COMMENT ON COLUMN public."Customer".max_customers_by_category IS 'Số khách tối đa cùng xe theo Loại kho {FG01: 1, FG02: 4}; loại không khai ⇒ max_customers_per_trip (Chung) ⇒ kênh. 04/10/2026.';

-- cascade đổi tên Loại kho (định nghĩa SỐNG của staging + hai câu mới)
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

  UPDATE "Location" SET categories = array_replace(categories, p_old, p_new)
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Location', n);

  UPDATE "WarehouseZone" SET categories = array_replace(categories, p_old, p_new)
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('WarehouseZone', n);

  UPDATE "StocktakeLog" SET categories = array_replace(categories, p_old, p_new), updated_at = now()
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('StocktakeLog', n);

  UPDATE "Employee" SET allowed_categories = array_replace(allowed_categories, p_old, p_new)
    WHERE p_old = ANY(allowed_categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Employee', n);

  UPDATE "Warehouse" SET carton_scan_categories = array_replace(carton_scan_categories, p_old, p_new)
    WHERE p_old = ANY(carton_scan_categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Warehouse', n);

  UPDATE warehouse_type_configs SET type_code = p_new, updated_at = now() WHERE type_code = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('warehouse_type_configs', n);

  UPDATE "SlotTemplate" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('SlotTemplate', n);

  UPDATE "DeliverySlot" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('DeliverySlot', n);

  UPDATE "TmsOrder" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('TmsOrder', n);

  UPDATE "TmsOrder" SET booking_category = p_new WHERE booking_category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('TmsOrder.booking_category', n);

  UPDATE khvc_lines SET booking_category = p_new WHERE booking_category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('khvc_lines', n);

  UPDATE "GroupDeliveryOrder"
     SET warehouse_type = (SELECT string_agg(DISTINCT c, '+')
                             FROM unnest(array_replace(wt_cats(warehouse_type), p_old, p_new)) c)
   WHERE wt_cats(warehouse_type) @> ARRAY[p_old];
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('GroupDeliveryOrder', n);

  UPDATE "OutboundItem" SET material_type = p_new WHERE material_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('OutboundItem', n);

  UPDATE alert_events SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('alert_events', n);

  UPDATE gate_registrations SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('gate_registrations', n);

  UPDATE inbound_plan_lines SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('inbound_plan_lines', n);

  UPDATE "ProductionImport" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('ProductionImport', n);

  UPDATE "PalletLabelPrint" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('PalletLabelPrint', n);

  UPDATE date_rule_master SET category = p_new, updated_at = now() WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('date_rule_master', n);

  UPDATE "FillOrder" SET warehouse_type = p_new, updated_at = now() WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('FillOrder', n);

  UPDATE "Customer"
     SET load_mode_by_category = (load_mode_by_category - p_old) || jsonb_build_object(p_new, load_mode_by_category -> p_old),
         updated_at = now()
   WHERE load_mode_by_category ? p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Customer.load_mode_by_category', n);

  -- MỚI 27/09 — dòng xe được vào theo Loại kho (khách + kênh)
  UPDATE "Customer"
     SET dispatch_vehicles = (dispatch_vehicles - p_old) || jsonb_build_object(p_new, dispatch_vehicles -> p_old),
         updated_at = now()
   WHERE dispatch_vehicles ? p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Customer.dispatch_vehicles', n);

  -- MỚI 04/10 — "Số khách tối đa cùng xe" theo Loại kho (khách + kênh)
  UPDATE "Customer"
     SET max_customers_by_category = (max_customers_by_category - p_old) || jsonb_build_object(p_new, max_customers_by_category -> p_old),
         updated_at = now()
   WHERE max_customers_by_category ? p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Customer.max_customers_by_category', n);

  UPDATE "LookupValue"
     SET meta = jsonb_set(meta, '{max_customers_by_category}',
                 ((meta -> 'max_customers_by_category') - p_old) || jsonb_build_object(p_new, meta -> 'max_customers_by_category' -> p_old)),
         updated_at = now()
   WHERE type = 'customer_channel' AND jsonb_typeof(meta -> 'max_customers_by_category') = 'object' AND (meta -> 'max_customers_by_category') ? p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('customer_channel.max_customers_by_category', n);

  UPDATE "LookupValue"
     SET meta = jsonb_set(meta, '{dispatch_vehicles}',
                 ((meta -> 'dispatch_vehicles') - p_old) || jsonb_build_object(p_new, meta -> 'dispatch_vehicles' -> p_old)),
         updated_at = now()
   WHERE type = 'customer_channel' AND jsonb_typeof(meta -> 'dispatch_vehicles') = 'object' AND (meta -> 'dispatch_vehicles') ? p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('customer_channel.dispatch_vehicles', n);

  RETURN counts;
END;
$function$
;
