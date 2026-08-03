-- ĐỢT A (user chốt 03/08): "Điều vận up Kế hoạch xuất TRƯỚC khi có VL06O".
-- Trước: DO chưa có trong VL06O → CHẶN cả file (400 MISSING_DO) → điều vận không nạp được kế hoạch.
-- Nay: vẫn sinh chuyến, nhưng chuyến ở dạng CHỜ DỮ LIỆU — bất động cho tới khi VL06O về.
--
-- Vì sao dùng CỜ chứ không thêm trạng thái mới cho chuyến: status hiện len lỏi ~20 chỗ
-- (bộ lọc, facet, màu dòng, SummaryBand, dashboard, control tower, RPC phân trang, QA invariant).
-- Thêm giá trị status mới = phải sửa hết ngần ấy chỗ và chắc chắn sót. Cờ thì mọi chỗ cũ vẫn đúng
-- (chuyến chờ vẫn là PENDING), chỉ nơi nào CẦN mới đọc cờ.
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS awaiting_sap boolean NOT NULL DEFAULT false;
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS awaiting_dos text[];

COMMENT ON COLUMN "GroupDeliveryOrder".awaiting_sap IS
  'true = chuyến còn DO chưa có dữ liệu VL06O → khóa mọi đường xuất (422 AWAITING_SAP), giao diện làm mờ. Tự tắt khi VL06O về.';
COMMENT ON COLUMN "GroupDeliveryOrder".awaiting_dos IS
  'Danh sách DO đang chờ dữ liệu (hiện trong cảnh báo). null khi đã đủ.';

-- Lọc "chuyến đang chờ" trên list Xuất: chỉ index phần true (bảng sẽ có hàng triệu dòng,
-- phần chờ luôn là thiểu số) — index partial nhỏ hơn index đầy đủ hàng chục lần.
CREATE INDEX IF NOT EXISTS idx_gdo_awaiting ON "GroupDeliveryOrder" (awaiting_sap) WHERE awaiting_sap;

-- ─────────────────────────────────────────────────────────────────────────────
-- SỔ SỰ KIỆN CHUYẾN XUẤT (user chốt 03/08): "DO trên chuyến phải tracking được —
-- thay đổi thế nào, bởi ai, lúc nào, nguồn nào".
--
-- Vì sao KHÔNG dùng lại reconcile_tasks (đã cân nhắc): bảng đó là HÀNG CHỜ VIỆC
-- (có người xử lý, có trạng thái OPEN/RESOLVED). Nhét cả nhật ký vận hành vào đó sẽ
-- làm loãng hàng chờ và bóp méo ngữ nghĩa "cần xử lý". Tách 2 bảng: việc thì vẫn ở
-- reconcile_tasks, còn ĐÂY là dòng thời gian chỉ-ghi-thêm cho nút "Lịch sử" của chuyến.
CREATE TABLE IF NOT EXISTS public."outbound_events" (
  id            text PRIMARY KEY,
  gdo_id        text,                        -- chuyến (null khi chuyến chưa/không còn tồn tại)
  group_code    text NOT NULL,               -- Số xe = khóa xuyên suốt Kế hoạch xuất ↔ Xuất ↔ TMS
  event_type    text NOT NULL,               -- PLAN_DO_ADDED|PLAN_DO_REMOVED|PLAN_DATE_CHANGED|PLAN_VEHICLE_DROPPED|
                                             -- PLAN_VEHICLE_REOPENED|AWAITING_SET|AWAITING_CLEARED|SAP_AUTO_APPLIED|
                                             -- SAP_NEEDS_REVIEW|SAP_BLOCKED|TRIP_* (đợt sau)
  source        text NOT NULL,               -- PLAN (Kế hoạch xuất) | SAP (VL06O/API) | USER (thao tác tay) | SYSTEM
  actor         text,                        -- tên người thao tác, hoặc nguồn tự động
  do_number     text,                        -- DO liên quan (nếu có)
  material_code text,
  old_value     text,                        -- giá trị cũ (chuỗi đọc được — sổ để NGƯỜI đọc, không phải để máy tính lại)
  new_value     text,
  detail        text NOT NULL,               -- câu mô tả tiếng Việt hiện thẳng trên dòng thời gian
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL
);
-- Truy vấn chính = "lịch sử của CHUYẾN này, mới nhất trước" → index composite đúng shape đó.
CREATE INDEX IF NOT EXISTS idx_oev_gdo   ON public."outbound_events" (gdo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oev_group ON public."outbound_events" (group_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oev_do    ON public."outbound_events" (do_number) WHERE do_number IS NOT NULL;

ALTER TABLE public."outbound_events" ENABLE ROW LEVEL SECURITY;   -- chặn anon (service role bypass)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='outbound_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."outbound_events";
  END IF;
END $$;
