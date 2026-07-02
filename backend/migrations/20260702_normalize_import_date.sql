-- Chuẩn hóa import_date của tồn đầu kỳ nạp bằng script/upload (origin='IMPORT'):
-- bản cũ ghi ISO UTC (kèm giờ, vd 2026-06-30 08:38:30) trong khi luồng quét nhập ghi ngày VN thuần
-- (nửa đêm) → 3998 pallet rớt khỏi filter khoảng "Ngày nhập đến X" (lte 'YYYY-MM-DD' < có-giờ).
-- Code upload UI (inventoryController.uploadExcel) + scripts/import_inventory.js đã sửa cùng ngày
-- để ghi ngày VN thuần từ nay về sau — migration này chỉ dọn dữ liệu đã nạp.
BEGIN;

UPDATE "InventoryEntry"
SET import_date = date_trunc('day', import_date)
WHERE origin = 'IMPORT' AND import_date::time <> '00:00:00';

COMMIT;
