-- Gắn Loại kho vào Khu vực kho
ALTER TABLE "WarehouseZone" ADD COLUMN IF NOT EXISTS category VARCHAR(100);
