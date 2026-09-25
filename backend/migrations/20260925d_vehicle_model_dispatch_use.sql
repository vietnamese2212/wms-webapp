-- Điều vận vòng 3 (user 25/09/2026 tối: "bạn lôi cả container đi, dù container chỉ dành cho tuyến trung chuyển giữa các
-- kho — có config cho dòng xe dùng làm gì nhé"):
--  (a) vehicle_model.dispatch_use = dòng xe này máy điều vận được dùng cho việc gì:
--        ALL      — mọi đơn (mặc định = hành vi cũ)
--        TRANSFER — CHỈ trung chuyển giữa các kho của mình (khách có Customer.warehouse_id, hoặc SAP flow STO / INTERNAL)
--      Khai ở Cài đặt TMS → Mã dòng xe (form + thao tác hàng loạt).
--  (b) dispatch_trip_od.is_transfer = OD đó là trung chuyển giữa kho — chụp lúc máy lập để các cửa sửa nháp (kéo thả,
--      xe mới, đổi pallet ↔ xá) chọn dòng xe đúng luật mà không phải nạp lại danh mục Khách hàng.
--  Backfill: dòng xe có cha là XE CONTAINER / XE CONTAINER SCA (mã cha CONT / CONTSCA) ⇒ TRANSFER — đúng lời user.

ALTER TABLE public.vehicle_model
  ADD COLUMN IF NOT EXISTS dispatch_use text NOT NULL DEFAULT 'ALL';
ALTER TABLE public.vehicle_model DROP CONSTRAINT IF EXISTS vehicle_model_dispatch_use_chk;
ALTER TABLE public.vehicle_model ADD CONSTRAINT vehicle_model_dispatch_use_chk CHECK (dispatch_use IN ('ALL', 'TRANSFER'));

UPDATE public.vehicle_model m
   SET dispatch_use = 'TRANSFER', updated_at = now()
  FROM public."VehicleType" v
 WHERE v.id = m.parent_type_id AND v.code IN ('CONT', 'CONTSCA') AND m.dispatch_use = 'ALL';

ALTER TABLE public.dispatch_trip_od
  ADD COLUMN IF NOT EXISTS is_transfer boolean NOT NULL DEFAULT false;
