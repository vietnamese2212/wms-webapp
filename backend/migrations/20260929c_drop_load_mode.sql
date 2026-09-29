-- 29/09/2026 — BỎ "kiểu đi Pallet / Xá" khỏi điều vận (user: "dòng xe là đơn vị thấp hơn của loại xe — bỏ loại xe, chọn
-- dòng xe luôn"). Chỉ DỮ LIỆU, không đổi schema: các cột dưới đây để CHẾT (app không đọc / không ghi nữa), DROP ở đợt dọn sau:
--   Customer.load_mode · Customer.load_mode_by_category · Warehouse.dispatch_pallet_max_stops ·
--   dispatch_trip.load_mode · dispatch_trip_od.load_mode · RPC customer_set_load_mode_cat
-- "Xe pallet chỉ một khách" từng là tham số kho (dispatch_pallet_max_stops = 1 ở mọi kho staging) áp theo kiểu đi của khách;
-- nay là `max_drops` khai ở CHÍNH dòng xe. Đặt sẵn = 1 cho dòng xe con của Loại xe "chở hàng đã lên pallet" chưa khai, để
-- hành vi hôm nay giữ nguyên; muốn xe pallet rớt thêm khách thì sửa ô "Điểm giao tối đa" của dòng xe đó (Cài đặt TMS → Mã dòng xe).
BEGIN;

UPDATE vehicle_model vm
SET max_drops = 1, updated_at = now()
FROM "VehicleType" vt
WHERE vt.id = vm.parent_type_id
  AND vt.is_pallet_truck = true
  AND vm.max_drops IS NULL;

COMMENT ON COLUMN "Customer".load_mode IS 'CHẾT từ 29/09/2026 — điều vận không còn kiểu đi Pallet/Xá; chờ DROP';
COMMENT ON COLUMN "Customer".load_mode_by_category IS 'CHẾT từ 29/09/2026 — chờ DROP';
COMMENT ON COLUMN "Warehouse".dispatch_pallet_max_stops IS 'CHẾT từ 29/09/2026 — thay bằng vehicle_model.max_drops; chờ DROP';
COMMENT ON COLUMN dispatch_trip.load_mode IS 'CHẾT từ 29/09/2026 — chờ DROP';
COMMENT ON COLUMN dispatch_trip_od.load_mode IS 'CHẾT từ 29/09/2026 — chờ DROP';

COMMIT;
