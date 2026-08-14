-- NGUYÊN TẮC LUÂN CHUYỂN (rotation) theo KHO — 14/08/2026
--
-- Mặc định CỐ Ý = đúng hành vi đang chạy: FEFO + KHÔNG bắt buộc (chỉ cảnh báo).
-- ⇒ apply migration này KHÔNG đổi cách làm việc của bất kỳ kho nào; kho nào muốn siết thì tự
--    tick trong Cài đặt WMS → Kho.

-- ── 1. Cấu hình theo kho ────────────────────────────────────────────────────
ALTER TABLE "Warehouse"
  ADD COLUMN IF NOT EXISTS rotation_principle text    NOT NULL DEFAULT 'FEFO',
  ADD COLUMN IF NOT EXISTS rotation_required  boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE "Warehouse" ADD CONSTRAINT warehouse_rotation_principle_chk
    CHECK (rotation_principle IN ('FEFO', 'FIFO', 'LIFO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN "Warehouse".rotation_principle IS
  'Thứ tự lấy hàng: FEFO = hạn dùng ngắn đi trước · FIFO = vào trước đi trước · LIFO = vào sau đi trước';
COMMENT ON COLUMN "Warehouse".rotation_required IS
  'true = CHẶN quét sai thứ tự (phải có quyền outbound.rotation_override + chọn lý do mới qua được); false = chỉ cảnh báo';

-- ── 2. Vết trên từng lượt quét ──────────────────────────────────────────────
-- Đều NULLABLE: dòng cũ = "chưa đo" (NULL), báo cáo tuân thủ KHÔNG tính vào mẫu số —
-- không được để dữ liệu trước tính năng này bị quy là "đúng thứ tự" một cách vô căn cứ.
ALTER TABLE "OutboundScanEntry"
  ADD COLUMN IF NOT EXISTS rotation_principle      text,
  ADD COLUMN IF NOT EXISTS rotation_violation      boolean,
  ADD COLUMN IF NOT EXISTS rotation_best_date      text,
  ADD COLUMN IF NOT EXISTS rotation_override_reason text;

COMMENT ON COLUMN "OutboundScanEntry".rotation_principle IS
  'Nguyên tắc ĐANG hiệu lực lúc quét — chốt cứng để dòng cũ/mới không lẫn nghĩa khi kho đổi cấu hình';
COMMENT ON COLUMN "OutboundScanEntry".rotation_violation IS
  'true = lấy sai thứ tự · false = đúng · NULL = không kết luận được (thiếu NSX/HSD) hoặc dòng trước 14/08';
COMMENT ON COLUMN "OutboundScanEntry".rotation_best_date IS
  'Ngày đại diện (HSD với FEFO, NSX với FIFO/LIFO) của pallet đáng lẽ nên lấy';
COMMENT ON COLUMN "OutboundScanEntry".rotation_override_reason IS
  'Mã lý do vượt rào khi kho bật bắt buộc: BLOCKED | DAMAGED | CUSTOMER | OTHER: <ghi chú>';

-- Cột best_available_date CŨ giữ nguyên cho dữ liệu lịch sử (nghĩa cũ: MIN(NSX) trong kho, chỉ
-- đếm IN_STOCK/PARTIAL) — từ 14/08 KHÔNG ghi nữa, chỗ hiển thị đọc rotation_best_date.

-- Đếm vi phạm theo khoảng ngày (ô band "% tuân thủ" trang Lịch sử quét)
CREATE INDEX IF NOT EXISTS idx_ose_rotation_violation
  ON "OutboundScanEntry" (scanned_at) WHERE rotation_violation = true;
