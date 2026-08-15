-- ĐỢT A vòng 2 (user chốt 03/08): "Kế hoạch xuất bị xóa ⇒ chuyến bên Xuất KHÔNG bị xóa mà vào
-- trạng thái không hoạt động, chỉ xem được info + lịch sử. Kế hoạch tồn tại lại ⇒ hoạt động lại."
--
-- Trước đây replanKhvcGroups XÓA CỨNG chuyến PENDING/PAUSED khi kế hoạch hết dòng — mất luôn
-- vết "đã từng có chuyến này" (đúng cái user cần tracking). Nay chỉ ĐÁNH DẤU.
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS plan_dropped boolean NOT NULL DEFAULT false;
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS plan_dropped_at timestamptz;

COMMENT ON COLUMN "GroupDeliveryOrder".plan_dropped IS
  'true = Kế hoạch xuất không còn dòng nào cho Số xe này → chuyến ngừng hoạt động (chỉ xem + lịch sử), KHÔNG xóa. Tự bật lại khi kế hoạch có lại.';

CREATE INDEX IF NOT EXISTS idx_gdo_plan_dropped ON "GroupDeliveryOrder" (plan_dropped) WHERE plan_dropped;
