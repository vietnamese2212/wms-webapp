-- 20260801d — TÁCH DUYỆT MIỄN TRỪ theo TỪNG RULE (user chốt 01/08: "phải phân thành 2 tình huống
-- và 2 action riêng — có khi đăng ký cổng nhưng không cân hoặc ngược lại").
--
-- Trước: 1 vết weigh_waived_* phủ CẢ 2 rule. Nay mỗi rule 1 vết + 1 quyền riêng:
--   Rule 1 (đăng ký cổng)  → gate_waived_*  (quyền outbound.gate_waive,  route /outbound/:id/gate-waive)
--   Rule 2 (cân)           → weigh_waived_* (quyền outbound.weigh_waive, route /outbound/:id/weigh-waive — giữ tên cũ, thu hẹp nghĩa CHỈ CÂN)
-- Giao lẻ/xe máy/NV nhận không biển số = cần duyệt CẢ 2 (mỗi vết bởi người có quyền tương ứng);
-- duyệt CỔNG thì biển số mới thành tùy chọn.

ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS gate_waived_at timestamptz;
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS gate_waived_by text;
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS gate_waive_reason text;

COMMENT ON COLUMN "GroupDeliveryOrder".gate_waived_at IS
  'Duyệt bỏ qua RULE 1 (đăng ký cổng) cho chuyến — quyền outbound.gate_waive. NULL = phải chấp hành rule 1 nếu kho bật. Độc lập với weigh_waived_at (rule 2 — cân).';
COMMENT ON COLUMN "GroupDeliveryOrder".weigh_waived_at IS
  'Duyệt bỏ qua RULE 2 (cân) cho chuyến — quyền outbound.weigh_waive. NULL = phải chấp hành rule 2 nếu kho bật. Độc lập với gate_waived_at (rule 1 — đăng ký cổng).';
