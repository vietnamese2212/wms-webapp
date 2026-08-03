-- ĐỢT B (user chốt 03/08): "khi điều vận upload Kế hoạch xuất, dữ liệu ở module Kế hoạch VC sẽ được
-- TỰ ĐỘNG chuyển lên (dạng bị động, chạy theo Kế hoạch xuất) — để phục vụ booking đối với đơn xuất".
--
-- KHÓA LIÊN KẾT = SỐ XE, xuyên suốt 3 tầng: khvc_lines.group_code = GroupDeliveryOrder.group_code
-- = TmsOrder.order_code (bên TMS cột "Số xe" vốn đã đổ vào order_code — không phải bịa khóa mới).
-- ⇒ Điều vận SỬA DO trong xe thì lệnh + khung giờ ĐÃ ĐẶT giữ nguyên, chỉ số liệu cập nhật.
ALTER TABLE "TmsOrder" ADD COLUMN IF NOT EXISTS origin text;
ALTER TABLE "TmsOrder" ADD COLUMN IF NOT EXISTS plan_dropped boolean NOT NULL DEFAULT false;
ALTER TABLE "TmsOrder" ADD COLUMN IF NOT EXISTS plan_dropped_at timestamptz;

COMMENT ON COLUMN "TmsOrder".origin IS
  '''KHVC'' = lệnh TỰ SINH theo Kế hoạch xuất (bị động — sửa ở nguồn, không sửa tay). NULL = up tay/upload TMS như cũ.';
COMMENT ON COLUMN "TmsOrder".plan_dropped IS
  'true = Kế hoạch xuất không còn Số xe này → lệnh ngừng hiệu lực + ĐÃ NHẢ khung giờ. Kế hoạch có lại thì bật lại nhưng PHẢI booking lại.';

-- Lệnh tự sinh của 1 ngày/kho là thiểu số trong bảng → index partial cho rẻ
CREATE INDEX IF NOT EXISTS idx_tms_order_khvc ON "TmsOrder" (origin) WHERE origin = 'KHVC';
