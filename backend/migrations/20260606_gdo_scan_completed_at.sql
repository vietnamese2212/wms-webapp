-- Thêm cột ghi nhận thời điểm quét xong toàn bộ hàng (trước khi user bấm Hoàn thành)
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS scan_completed_at timestamptz;
