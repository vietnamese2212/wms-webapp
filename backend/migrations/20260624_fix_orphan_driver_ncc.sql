-- Dọn driver account mồ côi do đổi ĐVVT của xe trước đây (updateVehicle cũ KHÔNG
-- di chuyển driver theo ncc mới). Di chuyển driver về ncc hiện tại của xe (khớp biển số).
-- An toàn: chỉ đụng tài khoản đăng nhập lái xe (Employee.is_driver), KHÔNG đụng lịch sử
-- xuất/nhập (booking/gate lưu biển số + tên NCC dạng snapshot text).
-- Idempotent: chạy lại không hại (driver đã khớp ncc xe thì 0 dòng).

UPDATE "Employee" e
SET ncc_id = v.ncc_id, updated_at = now()
FROM "Vehicle" v
WHERE e.is_driver = true
  AND v.license_plate = e.employee_code
  AND v.ncc_id <> e.ncc_id
  -- chỉ di chuyển khi ncc cũ của driver KHÔNG còn xe nào khớp biển số (đúng nghĩa mồ côi)
  AND NOT EXISTS (
    SELECT 1 FROM "Vehicle" v2
    WHERE v2.license_plate = e.employee_code AND v2.ncc_id = e.ncc_id
  );
