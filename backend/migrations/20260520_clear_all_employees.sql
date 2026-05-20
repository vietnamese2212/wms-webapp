-- Xóa toàn bộ dữ liệu nhân viên để tạo lại từ đầu.
-- Chạy trong Supabase Dashboard → SQL Editor.
-- Sau khi chạy: npx ts-node src/seed-admin.ts để tạo lại admin.

-- NULL out FK references trước (các FK không có ON DELETE SET NULL)
UPDATE "GroupDeliveryOrder" SET forklift_driver_id = NULL WHERE forklift_driver_id IS NOT NULL;
UPDATE "OutboundScanEntry"  SET scanned_by = NULL         WHERE scanned_by IS NOT NULL;
UPDATE "OutboundScanEntry"  SET loose_confirmed_by = NULL WHERE loose_confirmed_by IS NOT NULL;
UPDATE "InventoryEntry"     SET stocktake_by = NULL       WHERE stocktake_by IS NOT NULL;

-- UserWarehouseAccess có ON DELETE CASCADE nên xóa Employee là tự xóa theo,
-- nhưng xóa tường minh để chắc chắn.
DELETE FROM "UserWarehouseAccess";
DELETE FROM "Employee";
