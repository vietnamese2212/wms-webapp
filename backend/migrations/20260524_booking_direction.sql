-- E: Thêm cột direction (Xuất/Nhập) cho DeliveryBooking
ALTER TABLE "DeliveryBooking"
  ADD COLUMN IF NOT EXISTS direction TEXT CHECK (direction IN ('OUTBOUND', 'INBOUND'));
