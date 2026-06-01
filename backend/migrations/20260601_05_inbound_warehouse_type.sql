-- Thêm warehouse_type vào ProductionImport để lọc trực tiếp, không qua Material.category
ALTER TABLE "ProductionImport"
  ADD COLUMN IF NOT EXISTS warehouse_type TEXT;

-- Backfill từ Material.category cho các phiếu đã có
UPDATE "ProductionImport" pi
SET warehouse_type = m.category
FROM "Material" m
WHERE pi.material_id = m.id
  AND pi.warehouse_type IS NULL;
