-- Lưu tên nhiều lái xe nâng dưới dạng text (comma-separated)
ALTER TABLE "GroupDeliveryOrder"
  ADD COLUMN IF NOT EXISTS forklift_driver_names TEXT;
