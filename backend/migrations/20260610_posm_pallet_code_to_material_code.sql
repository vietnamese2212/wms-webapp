-- Đổi pallet_code của POSM/LOSCAM từ "POSM-{hash}" sang mã hàng thực tế
-- Mỗi kho sẽ có 1 row per vật tư trong InventoryEntry
UPDATE "InventoryEntry" ie
SET pallet_code = m.material_code
FROM "Material" m
WHERE ie.material_id = m.id
  AND ie.pallet_code LIKE 'POSM-%'
  AND ie.location_id IS NULL;
