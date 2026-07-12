-- Sơ đồ xếp xe 3D: kích thước thùng carton (Material) + lòng thùng xe (TmsVehicleType)
-- Đơn vị: cm (numeric — cho phép lẻ 0.5cm)

ALTER TABLE public."Material" ADD COLUMN IF NOT EXISTS carton_length_cm numeric;
ALTER TABLE public."Material" ADD COLUMN IF NOT EXISTS carton_width_cm  numeric;
ALTER TABLE public."Material" ADD COLUMN IF NOT EXISTS carton_height_cm numeric;

ALTER TABLE public."VehicleType" ADD COLUMN IF NOT EXISTS box_length_cm numeric;
ALTER TABLE public."VehicleType" ADD COLUMN IF NOT EXISTS box_width_cm  numeric;
ALTER TABLE public."VehicleType" ADD COLUMN IF NOT EXISTS box_height_cm numeric;
