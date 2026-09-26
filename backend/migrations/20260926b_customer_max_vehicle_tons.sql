-- 20260926b — Khách chỉ nhận được xe tải trọng nhỏ (user 26/09: "config ở chỗ nào để khách hàng nào phù hợp dòng xe nào?
-- ngoài việc NPP không đi container, một số NPP chỉ đi được xe tải trọng nhỏ").
-- `Customer.max_vehicle_tons` = tải trọng xe LỚN NHẤT vào được điểm giao (đường nhỏ, cấm tải…). NULL = không giới hạn (hành vi cũ).
-- Điều vận: chuyến có khách này chỉ chọn dòng xe có `max_tons` ≤ mức đó; ghép chung với khách khác thì theo mức CHẶT NHẤT.
-- `dispatch_trip_od.max_vehicle_tons` chụp lúc lập để cửa sửa nháp (chuyển OD, xe mới, đổi dòng xe) theo cùng luật.

ALTER TABLE public."Customer" ADD COLUMN IF NOT EXISTS max_vehicle_tons numeric;
ALTER TABLE public."Customer" DROP CONSTRAINT IF EXISTS customer_max_vehicle_tons_chk;
ALTER TABLE public."Customer" ADD CONSTRAINT customer_max_vehicle_tons_chk CHECK (max_vehicle_tons IS NULL OR (max_vehicle_tons > 0 AND max_vehicle_tons <= 100));
COMMENT ON COLUMN public."Customer".max_vehicle_tons IS 'Tải trọng xe lớn nhất vào được điểm giao (tấn). NULL = không giới hạn.';

ALTER TABLE public.dispatch_trip_od ADD COLUMN IF NOT EXISTS max_vehicle_tons numeric;
