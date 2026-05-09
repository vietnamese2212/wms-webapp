-- Backfill cartons_remaining cho các InventoryEntry cũ chưa có giá trị
-- (Được thêm sau khi cột cartons_remaining tạo ra mà không có DEFAULT)
-- Apply: Supabase Dashboard → SQL Editor

UPDATE "InventoryEntry"
SET cartons_remaining = cartons_imported
WHERE cartons_remaining IS NULL;
