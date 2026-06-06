-- Lưu nguồn gốc điều chuyển kho: link từ GroupDeliveryOrder → ProductionImport
ALTER TABLE "ProductionImport" ADD COLUMN IF NOT EXISTS from_gdo_id text;
