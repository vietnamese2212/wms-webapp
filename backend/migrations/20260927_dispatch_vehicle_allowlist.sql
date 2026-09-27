-- 20260927 — Điều vận: DÒNG XE ĐƯỢC VÀO theo Kênh → Khách × Loại kho + switch ghép Loại kho trên TỪNG thẻ xe.
-- User chốt 27/09:
--  (1) "Tôi không muốn tự động, tôi muốn config được — khách hàng nào vào được dòng xe nào, dạng multi check box"
--      + "mặc định theo kênh, khách đặc biệt config riêng" ⇒ danh sách dòng xe (vehicle_model.id) theo Loại kho:
--      `Customer.dispatch_vehicles` và `LookupValue(customer_channel).meta.dispatch_vehicles`, cùng hình dạng
--      {"*": [id…], "FG02": [id…]} — "*" = mọi Loại kho. Thứ tự áp: khách×loại → khách×* → kênh×loại → kênh×* → mọi xe.
--      Thay cho "Tải trọng xe tối đa" (Customer.max_vehicle_tons, luật 10 — máy tự suy theo tấn): cột GIỮ, engine không đọc nữa.
--  (2) "Trên từng thẻ xe, TẮT = chặn thả" ⇒ `dispatch_trip.allow_mix_categories` (NULL = theo kế hoạch/kho).
--  (3) Dòng OD trên nháp chụp danh sách dòng xe khách được vào (`dispatch_trip_od.allowed_models`, NULL = không giới hạn)
--      để kéo tay / xe mới / đổi dòng xe theo cùng luật mà không đọc lại danh mục.
-- Áp STAGING trước. Idempotent.

ALTER TABLE public."Customer" ADD COLUMN IF NOT EXISTS dispatch_vehicles jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public."Customer" DROP CONSTRAINT IF EXISTS customer_dispatch_vehicles_chk;
ALTER TABLE public."Customer" ADD CONSTRAINT customer_dispatch_vehicles_chk CHECK (
  jsonb_typeof(dispatch_vehicles) = 'object'
  -- STRICT: chế độ lax mặc định tự "mở" mảng rồi soi TỪNG phần tử (chuỗi ≠ "array") ⇒ mọi danh sách hợp lệ bị 23514
  -- (bắt ở QA 61 [13a] lượt đầu trên Preview 27/09)
  AND NOT jsonb_path_exists(dispatch_vehicles, 'strict $.* ? (@.type() != "array")')
);
COMMENT ON COLUMN public."Customer".dispatch_vehicles IS 'Dòng xe (vehicle_model.id) khách được vào theo Loại kho {"*": [...], "FG02": [...]}; "*" = mọi loại; khoá vắng = theo kênh.';

ALTER TABLE public.dispatch_trip ADD COLUMN IF NOT EXISTS allow_mix_categories boolean;
COMMENT ON COLUMN public.dispatch_trip.allow_mix_categories IS 'Switch trên thẻ xe: cho thả OD khác Loại kho chính. NULL = theo tham số kế hoạch (kho).';

ALTER TABLE public.dispatch_trip_od ADD COLUMN IF NOT EXISTS allowed_models text[];
COMMENT ON COLUMN public.dispatch_trip_od.allowed_models IS 'Dòng xe khách của OD được vào (chụp lúc lập). NULL = không giới hạn.';

-- Thao tác hàng loạt "dòng xe được vào" cho MỘT khoá Loại kho trên nhiều khách: GỘP vào map từng dòng.
-- p_mode: SET (thay danh sách) · ADD (thêm) · REMOVE (bớt) · CLEAR (gỡ khoá ⇒ về theo kênh).
CREATE OR REPLACE FUNCTION public.customer_set_dispatch_vehicles(p_ids text[], p_key text, p_mode text, p_models text[], p_by text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  IF p_mode NOT IN ('SET', 'ADD', 'REMOVE', 'CLEAR') THEN
    RAISE EXCEPTION 'Thao tác phải là SET, ADD, REMOVE hoặc CLEAR' USING ERRCODE = '22023';
  END IF;
  IF p_key IS NULL OR btrim(p_key) = '' THEN
    RAISE EXCEPTION 'Thiếu Loại kho' USING ERRCODE = '22023';
  END IF;
  UPDATE "Customer" c
     SET dispatch_vehicles = CASE
           WHEN p_mode = 'CLEAR' THEN c.dispatch_vehicles - p_key
           WHEN p_mode = 'SET' THEN c.dispatch_vehicles || jsonb_build_object(p_key, to_jsonb(coalesce(p_models, '{}'::text[])))
           WHEN p_mode = 'ADD' THEN c.dispatch_vehicles || jsonb_build_object(p_key, to_jsonb(ARRAY(
                  SELECT DISTINCT x FROM unnest(coalesce(ARRAY(SELECT jsonb_array_elements_text(c.dispatch_vehicles -> p_key)), '{}'::text[]) || coalesce(p_models, '{}'::text[])) x ORDER BY x)))
           ELSE CASE WHEN c.dispatch_vehicles ? p_key
                     THEN c.dispatch_vehicles || jsonb_build_object(p_key, to_jsonb(ARRAY(
                            SELECT x FROM jsonb_array_elements_text(c.dispatch_vehicles -> p_key) x WHERE x <> ALL (coalesce(p_models, '{}'::text[])) ORDER BY x)))
                     ELSE c.dispatch_vehicles END
         END,
         updated_by = p_by, updated_at = now()
   WHERE c.id = ANY(p_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

-- Đổi tên Loại kho phải đổi cả KHOÁ của hai map dòng xe mới (lớp lỗi "cascade ghi tay bỏ sót cột mới" — lần 5).
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

  UPDATE "LookupValue"
     SET meta = jsonb_set(meta, '{dispatch_vehicles}',
                 ((meta -> 'dispatch_vehicles') - p_old) || jsonb_build_object(p_new, meta -> 'dispatch_vehicles' -> p_old)),
         updated_at = now()
   WHERE type = 'customer_channel' AND jsonb_typeof(meta -> 'dispatch_vehicles') = 'object' AND (meta -> 'dispatch_vehicles') ? p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('customer_channel.dispatch_vehicles', n);

  RETURN counts;
END;
$function$;
