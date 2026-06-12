-- Gộp TẤT CẢ InventoryEntry của mã no_qr_tracking về 1 dòng no-location cho mỗi KHO HIỆU DỤNG.
-- Kho hiệu dụng = COALESCE(warehouse_id cột, kho của location). Gồm cả entry cũ có gắn vị trí.
-- Repoint FK (OutboundScanEntry, ProductionImport.posm_entry_id) sang entry canonical trước khi xoá.
-- Idempotent: chạy lại không gây hại (đã 1 dòng thì chỉ chuẩn hoá).
-- Lưu ý kiểu: InventoryEntry.warehouse_id = uuid, Location.warehouse_id = text → cast text khi COALESCE.
-- Chạy qua Supabase Dashboard → SQL Editor.

DO $$
DECLARE
  grp        RECORD;
  canonical  text;
  sum_imp    numeric;
  sum_rem    numeric;
  sum_res    numeric;
  e          RECORD;
BEGIN
  FOR grp IN
    SELECT ie.material_id,
           COALESCE(ie.warehouse_id::text, loc.warehouse_id) AS eff_wh
    FROM "InventoryEntry" ie
    JOIN "Material" m ON m.id = ie.material_id AND m.no_qr_tracking = true
    LEFT JOIN "Location" loc ON loc.id = ie.location_id
    WHERE ie.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING')
    GROUP BY ie.material_id, COALESCE(ie.warehouse_id::text, loc.warehouse_id)
  LOOP
    -- Canonical: ưu tiên entry đã có warehouse_id + không vị trí, rồi tới cũ nhất
    SELECT ie.id INTO canonical
    FROM "InventoryEntry" ie
    LEFT JOIN "Location" loc ON loc.id = ie.location_id
    WHERE ie.material_id = grp.material_id
      AND COALESCE(ie.warehouse_id::text, loc.warehouse_id) IS NOT DISTINCT FROM grp.eff_wh
      AND ie.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING')
    ORDER BY (CASE WHEN ie.warehouse_id IS NOT NULL AND ie.location_id IS NULL THEN 0 ELSE 1 END),
             ie.created_at
    LIMIT 1;

    SELECT COALESCE(SUM(ie.cartons_imported),0),
           COALESCE(SUM(ie.cartons_remaining),0),
           COALESCE(SUM(ie.cartons_reserved),0)
    INTO sum_imp, sum_rem, sum_res
    FROM "InventoryEntry" ie
    LEFT JOIN "Location" loc ON loc.id = ie.location_id
    WHERE ie.material_id = grp.material_id
      AND COALESCE(ie.warehouse_id::text, loc.warehouse_id) IS NOT DISTINCT FROM grp.eff_wh
      AND ie.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING');

    -- Repoint FK + xoá các entry không phải canonical
    FOR e IN
      SELECT ie.id
      FROM "InventoryEntry" ie
      LEFT JOIN "Location" loc ON loc.id = ie.location_id
      WHERE ie.material_id = grp.material_id
        AND COALESCE(ie.warehouse_id::text, loc.warehouse_id) IS NOT DISTINCT FROM grp.eff_wh
        AND ie.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING')
        AND ie.id <> canonical
    LOOP
      UPDATE "OutboundScanEntry" SET inventory_entry_id = canonical WHERE inventory_entry_id = e.id;
      UPDATE "ProductionImport"  SET posm_entry_id = canonical::uuid WHERE posm_entry_id::text = e.id;
      DELETE FROM "InventoryEntry" WHERE id = e.id;
    END LOOP;

    -- Chuẩn hoá canonical thành pool no-location + tổng đã gộp
    UPDATE "InventoryEntry" ie
    SET pallet_code       = m.material_code,
        location_id       = NULL,
        warehouse_id      = grp.eff_wh::uuid,
        cartons_imported  = sum_imp,
        cartons_remaining = sum_rem,
        cartons_reserved  = sum_res,
        status            = CASE WHEN sum_rem <= 0 THEN 'EXPORTED'
                                 WHEN sum_rem < sum_imp THEN 'PARTIAL'
                                 ELSE 'IN_STOCK' END,
        updated_at        = now()
    FROM "Material" m
    WHERE ie.id = canonical AND m.id = grp.material_id;
  END LOOP;
END $$;
