-- Thêm completed_at vào TmsOrder
-- Dùng để ghi nhận giờ hoàn thành khi tất cả phiếu nhập trong đơn đều COMPLETED
ALTER TABLE "TmsOrder" ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
