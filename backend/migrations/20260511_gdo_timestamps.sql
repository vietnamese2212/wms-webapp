-- Thêm completed_at và last_scanned_at vào GroupDeliveryOrder
ALTER TABLE "GroupDeliveryOrder"
  ADD COLUMN IF NOT EXISTS completed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ;
