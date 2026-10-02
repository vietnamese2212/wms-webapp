-- 02/10/2026 — BỎ "điểm giao tối đa một chuyến" cấp KHO (user: "bỏ luôn cài đặt WMS đi, các khách và dòng xe muốn được ghép chuyến
-- phải khai — không khai thì có cảnh báo"). Số điểm giao nay chỉ còn hai nguồn: vehicle_model.max_drops (dòng xe) và
-- Customer.max_customers_per_trip / LookupValue customer_channel.meta.max_customers_per_trip (khách → kênh); chưa khai = 1.
-- Kho từng mặc định 3 (25/09) và đè lên dòng xe đã khai — cột không còn ai đọc.
ALTER TABLE "Warehouse" DROP COLUMN IF EXISTS dispatch_max_drops;
