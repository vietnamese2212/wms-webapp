-- 20260926 — Điều vận: KHÔNG TRỘN LOẠI KHO trên một chuyến · kiểu đi theo KHÁCH × LOẠI KHO · ĐK bảo quản theo VỊ TRÍ
--
-- User 26/09:
--  (1) "điều kiện bảo quản phải được khai theo cả vị trí — trong kho RM01 có thể có cả kho lạnh, thường; mặc định theo
--      loại kho" ⇒ `Location.storage_condition` (NULL = theo Loại kho của hàng nằm ở đó).
--  (3) "bản chất FG01 đi với FG01, FG02 đi FG02, muốn đi chung phải bật công tắc" ⇒ `Warehouse.dispatch_allow_mix_categories`
--      (mặc định TẮT — đổi hành vi có chủ đích: trước 26/09 máy ghép lẫn loại). POSM "đi theo đơn" = cờ
--      `meta.dispatch_follow` của Loại kho (LookupValue, không cần cột).
--  (4) "khách A: FG01 đi pallet, FG02 đi xe thường" ⇒ `Customer.load_mode_by_category` {Loại kho: PALLET|LOOSE};
--      loại không khai ⇒ theo `Customer.load_mode` chung như cũ.

ALTER TABLE public."Location" ADD COLUMN IF NOT EXISTS storage_condition text;
COMMENT ON COLUMN public."Location".storage_condition IS 'ĐK bảo quản RIÊNG của ô (mã LookupValue storage_condition). NULL = theo Loại kho của hàng.';
CREATE INDEX IF NOT EXISTS idx_location_storage_condition ON public."Location" (warehouse_id) WHERE storage_condition IS NOT NULL;

ALTER TABLE public."Warehouse" ADD COLUMN IF NOT EXISTS dispatch_allow_mix_categories boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public."Warehouse".dispatch_allow_mix_categories IS 'Điều vận: cho ghép nhiều Loại kho trên MỘT chuyến (mặc định không — FG01 đi FG01, FG02 đi FG02). Loại kho "đi kèm đơn" (POSM) không tính.';

ALTER TABLE public."Customer" ADD COLUMN IF NOT EXISTS load_mode_by_category jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public."Customer" DROP CONSTRAINT IF EXISTS customer_load_mode_by_category_chk;
ALTER TABLE public."Customer" ADD CONSTRAINT customer_load_mode_by_category_chk CHECK (
  jsonb_typeof(load_mode_by_category) = 'object'
  AND NOT jsonb_path_exists(load_mode_by_category, '$.* ? (@ != "PALLET" && @ != "LOOSE")')
);
COMMENT ON COLUMN public."Customer".load_mode_by_category IS 'Kiểu đi theo Loại kho {FG01: PALLET, FG02: LOOSE}. Loại không khai ⇒ theo load_mode chung.';

-- Thao tác hàng loạt "kiểu đi cho Loại kho X" trên nhiều khách: GỘP vào map từng dòng (không ghi đè cả map).
CREATE OR REPLACE FUNCTION public.customer_set_load_mode_cat(p_ids text[], p_category text, p_mode text, p_by text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  IF p_mode IS NOT NULL AND p_mode NOT IN ('PALLET', 'LOOSE') THEN
    RAISE EXCEPTION 'Kiểu đi phải là PALLET hoặc LOOSE' USING ERRCODE = '22023';
  END IF;
  UPDATE "Customer"
     SET load_mode_by_category = CASE WHEN p_mode IS NULL THEN load_mode_by_category - p_category
                                      ELSE load_mode_by_category || jsonb_build_object(p_category, p_mode) END,
         updated_by = p_by, updated_at = now()
   WHERE id = ANY(p_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

-- ĐK bảo quản của HÀNG theo CHỖ TỒN THẬT trong kho xuất (luật: services/dispatchEngine `lineConditions`).
-- Chỉ trả mã hàng có ít nhất một pallet nằm ở ô KHAI RIÊNG; với các mã đó trả MỌI giá trị ĐK của các ô đang chứa
-- (NULL = ô theo loại kho). Kho chưa khai ô nào ⇒ trả rỗng ngay (one-time filter) — hành vi cũ, 0 chi phí.
-- Trả jsonb một lời gọi (luật postgrest-pool-roundtrips), danh sách mã đi POST body (không dính trần URL).
CREATE OR REPLACE FUNCTION public.dispatch_stock_conditions(p_warehouse_id text, p_material_codes text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE out jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Location" WHERE warehouse_id = p_warehouse_id AND storage_condition IS NOT NULL) THEN
    RETURN '[]'::jsonb;
  END IF;
  WITH mats AS (
    SELECT m.id, m.material_code FROM "Material" m WHERE m.material_code = ANY(p_material_codes)
  ), live AS (
    SELECT ie.material_id, l.storage_condition
      FROM "InventoryEntry" ie
      LEFT JOIN "Location" l ON l.id = ie.location_id
     WHERE ie.warehouse_id = p_warehouse_id
       AND ie.material_id IN (SELECT id FROM mats)
       AND ie.cartons_remaining > 0
       AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
  ), hot AS (
    SELECT DISTINCT material_id FROM live WHERE storage_condition IS NOT NULL
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('material_code', x.material_code, 'condition', x.storage_condition) ORDER BY x.material_code, x.storage_condition NULLS FIRST), '[]'::jsonb)
    INTO out
    FROM (SELECT DISTINCT mats.material_code, live.storage_condition
            FROM live JOIN hot USING (material_id) JOIN mats ON mats.id = live.material_id) x;
  RETURN out;
END;
$function$;

-- Đổi tên Loại kho phải đổi cả KHOÁ trong map kiểu đi của khách (lớp lỗi "cascade ghi tay bỏ sót cột mới" — lần 4).
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

  -- MỚI 26/09 — kiểu đi của khách theo Loại kho: đổi KHOÁ của map (giữ giá trị)
  UPDATE "Customer"
     SET load_mode_by_category = (load_mode_by_category - p_old) || jsonb_build_object(p_new, load_mode_by_category -> p_old),
         updated_at = now()
   WHERE load_mode_by_category ? p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Customer.load_mode_by_category', n);

  RETURN counts;
END;
$function$;
