-- Xếp xe 3D: đổi đơn vị cm → mm (user chốt 12/07) — RENAME cột + nhân 10 dữ liệu đã nhập.
-- Chạy SAU 20260712_load_plan_dims.sql + 20260712_load_plan_stack.sql.

ALTER TABLE public."Material" RENAME COLUMN carton_length_cm TO carton_length_mm;
ALTER TABLE public."Material" RENAME COLUMN carton_width_cm  TO carton_width_mm;
ALTER TABLE public."Material" RENAME COLUMN carton_height_cm TO carton_height_mm;
UPDATE public."Material" SET
  carton_length_mm = carton_length_mm * 10,
  carton_width_mm  = carton_width_mm  * 10,
  carton_height_mm = carton_height_mm * 10
WHERE carton_length_mm IS NOT NULL OR carton_width_mm IS NOT NULL OR carton_height_mm IS NOT NULL;

ALTER TABLE public."VehicleType" RENAME COLUMN box_length_cm TO box_length_mm;
ALTER TABLE public."VehicleType" RENAME COLUMN box_width_cm  TO box_width_mm;
ALTER TABLE public."VehicleType" RENAME COLUMN box_height_cm TO box_height_mm;
UPDATE public."VehicleType" SET
  box_length_mm = box_length_mm * 10,
  box_width_mm  = box_width_mm  * 10,
  box_height_mm = box_height_mm * 10
WHERE box_length_mm IS NOT NULL OR box_width_mm IS NOT NULL OR box_height_mm IS NOT NULL;
