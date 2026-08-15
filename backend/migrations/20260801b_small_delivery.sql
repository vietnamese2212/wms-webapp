-- 20260801b — GIAO LẺ (xe máy / nhân viên nhận / giao lẻ) tại kho bật gate cổng/cân (user chốt 01/08).
--
-- Vãng lai KHÔNG phải lúc nào cũng là xe tải né quy trình: giao xe máy / nhân viên tự nhận không
-- bao giờ qua đăng ký cổng lẫn bàn cân. Bắt duyệt từng chuyến là phiền vận hành ⇒ người bấm Bắt đầu
-- TỰ KHAI "Giao lẻ — không qua cổng-cân" (không cần quyền duyệt) nhưng ghi VẾT ai khai + lúc nào,
-- chuyến hiện badge để quản lý soi — xe tải tick láo để né cân sẽ lộ trên báo cáo.
-- Khác với weigh_waived_* (duyệt bởi NGƯỜI CÓ QUYỀN): small_delivery_* = TỰ KHAI, tách cột để
-- báo cáo phân biệt được 2 loại miễn.

ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS small_delivery_at timestamptz;
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS small_delivery_by text;

COMMENT ON COLUMN "GroupDeliveryOrder".small_delivery_at IS
  'Người bấm Bắt đầu TỰ KHAI chuyến giao lẻ (xe máy/nhân viên nhận) — miễn gate đăng ký cổng + cân ở kho bật require_weigh_on_start. NULL = chuyến thường.';
