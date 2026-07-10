-- 2026-07-10 — Loại kho tùy biến (multi-tenant SILO): hành vi đi theo CỜ per-loại thay vì hardcode tên.
-- 1) LookupValue.meta jsonb — cờ hành vi của từng giá trị danh mục (hiện dùng cho type='warehouse_type'):
--      is_ncc_goods          boolean — hàng NCC: QR V1 đoạn 4 = mã NCC (thay vì Máy)   [thay NCC_CATEGORIES]
--      requires_shelf_life   boolean — form/danh sách Mã hàng bắt buộc HSD              [thay NO_SHELF_LIFE_CATS]
--      requires_pallet_per_ea boolean — bắt buộc Pallet/EA (quy đổi tồn EA→pallet)      [thay PALLET_PER_EA_CATS]
--      batch_char            text(1) — ký tự cố định thế chỗ Máy trong mã lô khi SINH TEM V2 (vd Nguyên liệu='N')
--      badge_color           text    — màu badge hiển thị (blue|purple|orange|green|amber|red|emerald|cyan|slate)
-- 2) Seed cờ cho 5 loại hiện có = ĐÚNG hành vi hardcode hôm nay (đơn vị 1 không đổi hành vi).
-- 3) RPC rename_warehouse_type(old,new) — đổi tên loại kho CASCADE đồng bộ mọi cột dữ liệu đang lưu tên (text):
--    LookupValue + Material.category + Location.category + WarehouseZone.category + Employee.allowed_categories
--    + SlotTemplate.cargo_type + DeliverySlot.cargo_type + TmsOrder/GroupDeliveryOrder/gate_registrations/
--    inbound_plan_lines/ProductionImport.warehouse_type. (KHÔNG đụng updated_at bản ghi nghiệp vụ — giữ audit thật.)

-- ── 1) meta jsonb ────────────────────────────────────────────────────────────
ALTER TABLE "LookupValue" ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── 2) Seed cờ 5 loại hiện tại (khớp hardcode cũ; loại thiếu dòng seed = hành vi Thành phẩm) ──
UPDATE "LookupValue" lv SET meta = lv.meta || v.m, updated_at = now()
FROM (VALUES
  ('Thành phẩm', '{"is_ncc_goods":false,"requires_shelf_life":true,"requires_pallet_per_ea":false,"badge_color":"blue"}'::jsonb),
  ('POSM',       '{"is_ncc_goods":true,"requires_shelf_life":false,"requires_pallet_per_ea":false,"badge_color":"purple"}'::jsonb),
  ('Raw',        '{"is_ncc_goods":true,"requires_shelf_life":true,"requires_pallet_per_ea":true,"badge_color":"orange"}'::jsonb),
  ('Giấy',       '{"is_ncc_goods":true,"requires_shelf_life":true,"requires_pallet_per_ea":true}'::jsonb),
  ('Thùng',      '{"is_ncc_goods":true,"requires_shelf_life":false,"requires_pallet_per_ea":true}'::jsonb)
) AS v(val, m)
WHERE lv.type = 'warehouse_type' AND lv.value = v.val;

-- ── 3) RPC đổi tên cascade ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rename_warehouse_type(p_old text, p_new text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  RETURN counts;
END;
$$;

-- Chỉ service role (backend) được gọi — không mở cho client trực tiếp
REVOKE ALL ON FUNCTION rename_warehouse_type(text, text) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
