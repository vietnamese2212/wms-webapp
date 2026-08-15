-- ============================================================================
-- KHU VỰC KHO NHIỀU LOẠI KHO (27/07/2026 — user chốt: "Khu vực cho phép chọn
-- MULTI loại kho, KHÔNG cho để trống")
-- ----------------------------------------------------------------------------
-- Đổi 3 cột 1-giá-trị → MẢNG text[]:
--   • WarehouseZone.category  → categories  (NOT NULL, ≥1 phần tử — bắt buộc chọn)
--   • Location.category       → categories  (nullable — kế thừa từ khu; null di sản = dùng chung)
--   • StocktakeLog.category   → categories  (snapshot loại của vị trí lúc đếm)
-- Ngữ nghĩa mới: vị trí/khu nhận hàng nếu LOẠI CỦA PHIẾU ∈ mảng (trước: bằng nhau).
-- Kèm: sửa 2 RPC đang đọc cột cũ (rename_warehouse_type + slotting_stats).
-- ⚠️ Thứ tự deploy: apply migration xong phải deploy code MỚI ngay (code cũ còn
--    select cột `category` sẽ 400). Staging: apply → push dev. Production: apply
--    ngay trước khi merge main.
-- ============================================================================

BEGIN;

-- ── 0. GÁC: khu chưa gắn loại → BẮT dừng (luật mới không cho khu trống loại).
--    Production nếu dính phải gán loại cho các khu này TRƯỚC rồi mới apply.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(w.name || ' / ' || z.code || ' (' || z.name || ')', ' · ')
    INTO bad
  FROM "WarehouseZone" z JOIN "Warehouse" w ON w.id = z.warehouse_id
  WHERE z.category IS NULL;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Có khu vực CHƯA gắn Loại kho — gán loại trong Cài đặt WMS → Khu vực rồi apply lại: %', bad;
  END IF;
END $$;

-- ── 1. WarehouseZone.categories — NOT NULL, tối thiểu 1 loại
ALTER TABLE "WarehouseZone" ADD COLUMN IF NOT EXISTS categories text[];
UPDATE "WarehouseZone" SET categories = ARRAY[category] WHERE categories IS NULL;
ALTER TABLE "WarehouseZone" ALTER COLUMN categories SET NOT NULL;
ALTER TABLE "WarehouseZone" ADD CONSTRAINT chk_zone_categories_nonempty
  CHECK (cardinality(categories) >= 1);
ALTER TABLE "WarehouseZone" DROP COLUMN category;

-- ── 2. Location.categories — kế thừa từ khu; null = di sản chưa gán (dùng chung, giữ hành vi cũ)
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS categories text[];
UPDATE "Location" SET categories = ARRAY[category] WHERE category IS NOT NULL AND categories IS NULL;
-- Vị trí chưa có loại nhưng khu của nó ĐÃ khai → đồng bộ luôn theo khu (khu là chuẩn)
UPDATE "Location" l SET categories = z.categories
FROM "WarehouseZone" z
WHERE l.categories IS NULL AND z.warehouse_id = l.warehouse_id AND z.code = l.sub_code;
ALTER TABLE "Location" DROP COLUMN category;

-- ── 3. StocktakeLog.categories — snapshot loại vị trí lúc đếm (append-only, giữ nguyên dữ liệu cũ)
ALTER TABLE "StocktakeLog" ADD COLUMN IF NOT EXISTS categories text[];
UPDATE "StocktakeLog" SET categories = ARRAY[category] WHERE category IS NOT NULL AND categories IS NULL;
ALTER TABLE "StocktakeLog" DROP COLUMN category;

-- ── 4. RPC rename_warehouse_type: 3 cột trên đổi từ so-bằng → array_replace
--    (bản đồ taxonomy 14 chỗ — memory warehouse-type-taxonomy-sap; 3 chỗ này giờ là MẢNG)
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

  -- MẢNG (multi-loại 27/07): Location / WarehouseZone / StocktakeLog
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

  UPDATE "PalletLabelPrint" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('PalletLabelPrint', n);

  RETURN counts;
END;
$function$;

-- ── 5. RPC slotting_stats: l.category/z.category → categories (mảng); jsonb zones trả 'categories'
CREATE OR REPLACE FUNCTION public.slotting_stats(p_warehouse_id text, p_categories text[] DEFAULT NULL::text[], p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
WITH win AS (
  SELECT (now() AT TIME ZONE 'UTC') - make_interval(days => GREATEST(COALESCE(p_days, 30), 1)) AS t0
),
picks AS (
  SELECT ie.material_id,
         count(*)::int                              AS picks,
         COALESCE(sum(ose.cartons_scanned), 0)      AS cartons_out_base,
         count(DISTINCT ose.inventory_entry_id)::int AS pallets_touched
  FROM "OutboundScanEntry" ose
  JOIN "InventoryEntry" ie ON ie.id = ose.inventory_entry_id
  WHERE ie.warehouse_id::text = p_warehouse_id
    AND ose.scanned_at >= (SELECT t0 FROM win)
  GROUP BY ie.material_id
),
stock AS (
  SELECT ie.material_id, l.sub_code,
         count(*)::int                          AS pallets,
         COALESCE(sum(ie.cartons_remaining), 0) AS cartons_base
  FROM "InventoryEntry" ie
  LEFT JOIN "Location" l ON l.id = ie.location_id
  WHERE ie.warehouse_id::text = p_warehouse_id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  GROUP BY ie.material_id, l.sub_code
),
stock_tot AS (
  SELECT material_id, sum(pallets)::int AS pallets, sum(cartons_base) AS cartons_base
  FROM stock GROUP BY material_id
),
mats AS (
  SELECT mu.material_id, m.material_code, m.short_name, m.category,
         COALESCE(p.picks, 0)           AS picks,
         COALESCE(p.cartons_out_base, 0) / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end) AS cartons_out,
         COALESCE(p.pallets_touched, 0) AS pallets_touched,
         COALESCE(st.pallets, 0)        AS stock_pallets,
         COALESCE(st.cartons_base, 0) / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end) AS stock_cartons
  FROM (SELECT material_id FROM picks UNION SELECT material_id FROM stock_tot) mu
  JOIN "Material" m ON m.id = mu.material_id
  LEFT JOIN picks p      ON p.material_id  = mu.material_id
  LEFT JOIN stock_tot st ON st.material_id = mu.material_id
  WHERE p_categories IS NULL OR m.category IS NULL OR m.category = ANY(p_categories)
),
classed AS (
  SELECT *,
    sum(picks) OVER () AS total_picks,
    sum(picks) OVER (ORDER BY picks DESC, material_code) AS cum_picks,
    CASE
      WHEN picks = 0 OR sum(picks) OVER () = 0 THEN 'C'
      WHEN (sum(picks) OVER (ORDER BY picks DESC, material_code) - picks)::numeric
           / NULLIF(sum(picks) OVER (), 0) < 0.80 THEN 'A'
      WHEN (sum(picks) OVER (ORDER BY picks DESC, material_code) - picks)::numeric
           / NULLIF(sum(picks) OVER (), 0) < 0.95 THEN 'B'
      ELSE 'C'
    END AS abc
  FROM mats
),
loc_used AS (
  SELECT l.id, l.location_code, l.sub_code, l.max_pallets, l.categories,
         l.slot_no_in, l.slot_no_out,
         count(ie.id)::int AS used_slots
  FROM "Location" l
  LEFT JOIN "InventoryEntry" ie ON ie.location_id = l.id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  WHERE l.warehouse_id = p_warehouse_id AND l.is_active = true
  GROUP BY l.id, l.location_code, l.sub_code, l.max_pallets, l.categories, l.slot_no_in, l.slot_no_out
)
SELECT jsonb_build_object(
  'total_picks', COALESCE((SELECT sum(picks) FROM mats), 0),
  'materials', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'material_id', c.material_id, 'code', c.material_code, 'name', c.short_name,
      'category', c.category,
      'picks', c.picks, 'cartons_out', c.cartons_out,
      'pallets_touched', c.pallets_touched, 'stock_pallets', c.stock_pallets,
      'stock_cartons', c.stock_cartons, 'abc', c.abc,
      'cum_share', CASE WHEN c.total_picks > 0 THEN round(c.cum_picks::numeric / c.total_picks, 4) ELSE 0 END
    ) ORDER BY c.picks DESC, c.material_code) FROM classed c), '[]'::jsonb),
  'placement', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'material_id', s.material_id, 'sub_code', s.sub_code,
      'pallets', s.pallets,
      'cartons', s.cartons_base / (case when m2.entry_unit is not null and coalesce(m2.units_per_carton,0) > 0 then m2.units_per_carton else 1 end)))
    FROM stock s JOIN "Material" m2 ON m2.id = s.material_id
    WHERE s.material_id IN (SELECT material_id FROM mats)), '[]'::jsonb),
  'zones', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', z.id, 'code', z.code, 'name', z.name, 'categories', z.categories,
      'pick_rank', z.pick_rank, 'flow_type', z.flow_type,
      'capacity', COALESCE(zc.capacity, 0), 'used_slots', COALESCE(zc.used_slots, 0))
      ORDER BY z.pick_rank NULLS LAST, z.sort_order)
    FROM "WarehouseZone" z
    LEFT JOIN (SELECT sub_code, sum(max_pallets)::int AS capacity, sum(used_slots)::int AS used_slots
               FROM loc_used GROUP BY sub_code) zc ON zc.sub_code = z.code
    WHERE z.warehouse_id = p_warehouse_id AND z.is_active = true), '[]'::jsonb),
  'locations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', lu.id, 'location_code', lu.location_code, 'sub_code', lu.sub_code,
      'max_pallets', lu.max_pallets, 'used_slots', lu.used_slots,
      'slot_no_in', lu.slot_no_in, 'slot_no_out', lu.slot_no_out)
      ORDER BY lu.location_code)
    FROM loc_used lu), '[]'::jsonb)
);
$function$;

COMMIT;
