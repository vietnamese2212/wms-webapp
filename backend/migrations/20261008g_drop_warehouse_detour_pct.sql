-- ============================================================================
-- 20261008g — BỎ cột `Warehouse.dispatch_detour_pct` (user duyệt 08/10)
-- ============================================================================
-- "Đường vòng tối đa %" của xe tuyến liên tỉnh đã chuyển sang DÒNG XE (20261008e: VehicleType / vehicle_model /
-- warehouse_vehicle_model .detour_pct). Từ 4c44d05a app không đọc / ghi cột này; đo staging 08/10: 0/153 kho có
-- giá trị, 0 hàm / view nhắc tới ⇒ không có số nào để chuyển.
-- Thứ tự an toàn khi áp ở DB khác: code KHÔNG còn đọc cột (4c44d05a trở về sau) phải chạy TRƯỚC khi DROP.
-- ============================================================================
ALTER TABLE public."Warehouse" DROP COLUMN IF EXISTS dispatch_detour_pct;
