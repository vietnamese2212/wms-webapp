-- Mở rộng DeliveryBooking: thêm npp_name, số lượng, loại kho/xe; bỏ NOT NULL ncc_id
ALTER TABLE "DeliveryBooking" ALTER COLUMN ncc_id DROP NOT NULL;

ALTER TABLE "DeliveryBooking"
  ADD COLUMN IF NOT EXISTS npp_name       TEXT,
  ADD COLUMN IF NOT EXISTS box_count      INTEGER,
  ADD COLUMN IF NOT EXISTS pallet_count   INTEGER,
  ADD COLUMN IF NOT EXISTS tonnage        NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS warehouse_type TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_type   TEXT;
