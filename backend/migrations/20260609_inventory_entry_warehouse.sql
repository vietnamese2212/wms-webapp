-- Thêm warehouse_id vào InventoryEntry để hỗ trợ POSM (location_id IS NULL)
ALTER TABLE "InventoryEntry" ADD COLUMN IF NOT EXISTS warehouse_id UUID;

-- Backfill tất cả entry từ ProductionImport (bao gồm cả POSM và regular)
UPDATE "InventoryEntry" e
SET warehouse_id = pi.warehouse_id::uuid
FROM "ProductionImport" pi
WHERE e.import_order_id = pi.id
  AND e.warehouse_id IS NULL;
