-- Điều vận vòng 2 (user chốt 25/09/2026 chiều):
--  (a) Khách đi PALLET hay đi XÁ — khai ở danh mục Khách hàng, CHƯA khai = Xá. Không trộn hai kiểu trên một xe:
--      xe pallet bản chất đi 1 khách (số khách tối đa / xe pallet = tham số KHO), xe xá ghép nhiều khách (dispatch_max_drops).
--      Đổi được trên OD (dispatch_trip_od.load_mode) và cả xe (dispatch_trip.load_mode — nút trên thẻ xe).
--  (b) Dòng xe con có ghi chú (đánh dấu sức chứa / cước GIẢ ĐỊNH trên staging cho tới khi có số thật).

ALTER TABLE public."Customer"
  ADD COLUMN IF NOT EXISTS load_mode text NOT NULL DEFAULT 'LOOSE';
ALTER TABLE public."Customer" DROP CONSTRAINT IF EXISTS customer_load_mode_chk;
ALTER TABLE public."Customer" ADD CONSTRAINT customer_load_mode_chk CHECK (load_mode IN ('PALLET', 'LOOSE'));

ALTER TABLE public."Warehouse"
  ADD COLUMN IF NOT EXISTS dispatch_pallet_max_stops integer NOT NULL DEFAULT 1;
ALTER TABLE public."Warehouse" DROP CONSTRAINT IF EXISTS warehouse_dispatch_pallet_max_stops_chk;
ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_dispatch_pallet_max_stops_chk CHECK (dispatch_pallet_max_stops BETWEEN 1 AND 20);

ALTER TABLE public.dispatch_trip
  ADD COLUMN IF NOT EXISTS load_mode text;
ALTER TABLE public.dispatch_trip DROP CONSTRAINT IF EXISTS dispatch_trip_load_mode_chk;
ALTER TABLE public.dispatch_trip ADD CONSTRAINT dispatch_trip_load_mode_chk CHECK (load_mode IS NULL OR load_mode IN ('PALLET', 'LOOSE'));

ALTER TABLE public.dispatch_trip_od
  ADD COLUMN IF NOT EXISTS load_mode text;
ALTER TABLE public.dispatch_trip_od DROP CONSTRAINT IF EXISTS dispatch_trip_od_load_mode_chk;
ALTER TABLE public.dispatch_trip_od ADD CONSTRAINT dispatch_trip_od_load_mode_chk CHECK (load_mode IS NULL OR load_mode IN ('PALLET', 'LOOSE'));

ALTER TABLE public.vehicle_model
  ADD COLUMN IF NOT EXISTS note text;
