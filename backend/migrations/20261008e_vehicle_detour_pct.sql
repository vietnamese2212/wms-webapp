-- 20261008e — "XE TUYẾN LIÊN TỈNH — ĐƯỜNG VÒNG TỐI ĐA (%)" CHUYỂN TỪ FORM KHO SANG DÒNG XE
-- User 08/10: "config TMS ở kho là không phù hợp, bởi nó là của TMS — chuyển sang dòng xe cha; nếu dòng xe con chọn khác thì lấy
-- theo dòng xe con, tương tự các config khác". Thang như "ghép nhiều xe trên một thẻ" (07/10):
--   dòng xe con TẠI KHO (warehouse_vehicle_model) → dòng xe con CHUNG (vehicle_model) → loại xe CHA (VehicleType) → tắt.
-- NULL = theo bậc trên · 0 = TẮT riêng ở bậc đó (dòng con tắt dù cha bật) · > 0 = hai lô KHÁC TỈNH được ghép lên xe dòng này khi
-- quãng kho → các điểm (gần trước) không dài hơn đi thẳng tới điểm xa nhất quá N %. Máy ghép đọc % của DÒNG XE SẼ CHỞ chuyến ghép.
-- `Warehouse.dispatch_detour_pct` (20261002b) app KHÔNG đọc nữa — 0/153 kho từng khai (đo 08/10) nên không có số để chuyển; DROP sau.
BEGIN;
ALTER TABLE public."VehicleType"             ADD COLUMN IF NOT EXISTS detour_pct numeric(5,1);
ALTER TABLE public.vehicle_model             ADD COLUMN IF NOT EXISTS detour_pct numeric(5,1);
ALTER TABLE public.warehouse_vehicle_model   ADD COLUMN IF NOT EXISTS detour_pct numeric(5,1);

ALTER TABLE public."VehicleType" DROP CONSTRAINT IF EXISTS vehicletype_detour_pct_range;
ALTER TABLE public."VehicleType" ADD CONSTRAINT vehicletype_detour_pct_range CHECK (detour_pct IS NULL OR (detour_pct >= 0 AND detour_pct <= 100));
ALTER TABLE public.vehicle_model DROP CONSTRAINT IF EXISTS vehicle_model_detour_pct_range;
ALTER TABLE public.vehicle_model ADD CONSTRAINT vehicle_model_detour_pct_range CHECK (detour_pct IS NULL OR (detour_pct >= 0 AND detour_pct <= 100));
ALTER TABLE public.warehouse_vehicle_model DROP CONSTRAINT IF EXISTS warehouse_vehicle_model_detour_pct_range;
ALTER TABLE public.warehouse_vehicle_model ADD CONSTRAINT warehouse_vehicle_model_detour_pct_range CHECK (detour_pct IS NULL OR (detour_pct >= 0 AND detour_pct <= 100));

COMMENT ON COLUMN public."VehicleType".detour_pct IS 'Điều vận — xe tuyến liên tỉnh: đường vòng tối đa % khi ghép lô KHÁC TỈNH lên xe loại này; NULL/0 = không ghép khác tỉnh';
COMMENT ON COLUMN public.vehicle_model.detour_pct IS 'Như VehicleType.detour_pct cho riêng dòng xe con (bản Chung); NULL = theo loại xe cha, 0 = tắt riêng';
COMMENT ON COLUMN public.warehouse_vehicle_model.detour_pct IS 'Như vehicle_model.detour_pct tại một kho; NULL = theo bản Chung, 0 = tắt riêng ở kho';
COMMENT ON COLUMN public."Warehouse".dispatch_detour_pct IS 'BỎ 08/10 — chuyển sang dòng xe (VehicleType / vehicle_model / warehouse_vehicle_model .detour_pct); app không đọc nữa, chờ DROP';
COMMIT;
