-- 20261007: "GHÉP NHIỀU XE TRÊN MỘT THẺ" theo loại xe (07/10).
--
-- VÌ SAO: thẻ nhiều xe (luật 11, 27/09 — một Số xe gồm 2 container, hay Xe 17 pallet + Xe 4 pallet) chỉ có MỘT công tắc cho cả kho
-- (`Warehouse.dispatch_max_vehicles_per_trip`, mọi kho = 3). User 07/10: "thường thì dòng xe pallet, xe container sẽ không ghép xe, chỉ
-- dòng xe Xá, SCA mới có thể" · "khai như các tính năng khác: xe cha lấy xuống xe con, theo kho". Đo cùng ngày: kế hoạch Trung chuyển
-- Ba Vì 04/10 ra 17 thẻ "2 XE cont".
--
-- Ba tầng, cùng khuôn với cấu hình dòng xe theo kho (03/10 — ô NULL = theo tầng trên):
--   VehicleType.allow_multi_vehicle            NOT NULL DEFAULT true  — loại xe CHA (mặc định = hành vi trước 07/10: được ghép)
--   vehicle_model.allow_multi_vehicle          NULL = theo cha
--   warehouse_vehicle_model.allow_multi_vehicle NULL = theo dòng xe (bản Chung)
-- Hiệu lực = kho ?? dòng xe ?? cha. Đơn lớn hơn xe lớn nhất của loại KHÔNG được ghép ⇒ máy để ở khung chờ (user chốt), không tách đơn.
-- Không kho / dòng xe nào đổi hành vi khi áp file này (cha mặc định true, hai tầng dưới NULL). File chạy lại được.

ALTER TABLE public."VehicleType" ADD COLUMN IF NOT EXISTS allow_multi_vehicle boolean NOT NULL DEFAULT true;
ALTER TABLE public.vehicle_model ADD COLUMN IF NOT EXISTS allow_multi_vehicle boolean;
ALTER TABLE public.warehouse_vehicle_model ADD COLUMN IF NOT EXISTS allow_multi_vehicle boolean;

COMMENT ON COLUMN public."VehicleType".allow_multi_vehicle IS 'Điều vận: loại xe này được ghép nhiều xe trên MỘT thẻ (Số xe). Mặc định cho mọi dòng xe con (07/10).';
COMMENT ON COLUMN public.vehicle_model.allow_multi_vehicle IS 'NULL = theo loại xe cha; true/false = khai riêng dòng xe (07/10).';
COMMENT ON COLUMN public.warehouse_vehicle_model.allow_multi_vehicle IS 'NULL = theo dòng xe (bản Chung); true/false = kho khai riêng (07/10).';
