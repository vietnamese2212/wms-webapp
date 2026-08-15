-- 20260801c — TÁCH 2 RULE cổng/cân + BỎ giao lẻ tự khai (user chốt lại 01/08).
--
-- User: "Việc bắt đầu và chọn là rủi ro… Chúng ta sẽ có 2 rule: 1 chọn có trong ĐĂNG KÝ,
-- 2 chọn có trong CÂN. Chọn cái nào thì phải chấp hành cái đó. Nếu cả 2 yêu cầu thì phải có cả 2."
-- ⇒ (1) mỗi rule 1 cờ per kho, độc lập; (2) MỌI miễn trừ (xe không đăng ký được / không cân được /
-- giao lẻ xe máy-nhân viên nhận) đều đi 1 đường duy nhất: DUYỆT BÊN NGOÀI trên chuyến bởi người có
-- quyền outbound.weigh_waive (weigh_waived_*) — KHÔNG còn lựa chọn tự khai nào lúc bấm Bắt đầu.

-- 1) Rule ĐĂNG KÝ CỔNG — tách khỏi rule cân (trước 01/08 gói chung trong require_weigh_on_start)
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS require_gate_on_start boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN "Warehouse".require_gate_on_start IS
  'Rule 1: chuyến XUẤT chỉ được Bắt đầu khi gắn Đăng ký cổng hợp lệ (đúng kho, chiều XUẤT, đã VÀO, biển khớp). Độc lập với require_weigh_on_start (rule 2 — cân). Miễn trừ duy nhất = duyệt weigh_waived trên chuyến.';
COMMENT ON COLUMN "Warehouse".require_weigh_on_start IS
  'Rule 2: chuyến XUẤT chỉ được Bắt đầu khi biển số khớp phiếu cân CHƯA hoàn thành của hôm nay. Độc lập với require_gate_on_start (rule 1 — đăng ký cổng). Miễn trừ duy nhất = duyệt weigh_waived trên chuyến.';

-- 2) BỎ giao lẻ TỰ KHAI (20260801b) — thay bằng duyệt có phân quyền. Cột chỉ mới có trên staging,
--    chưa lên production (production chỉ cần apply file này, BỎ QUA 20260801b).
ALTER TABLE "GroupDeliveryOrder" DROP COLUMN IF EXISTS small_delivery_at;
ALTER TABLE "GroupDeliveryOrder" DROP COLUMN IF EXISTS small_delivery_by;
