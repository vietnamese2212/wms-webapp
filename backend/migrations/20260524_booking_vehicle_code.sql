-- Thêm mã chuyến (số xe) duy nhất vào DeliveryBooking
ALTER TABLE "DeliveryBooking" ADD COLUMN IF NOT EXISTS vehicle_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_booking_vehicle_code
  ON "DeliveryBooking" (vehicle_code)
  WHERE vehicle_code IS NOT NULL;
