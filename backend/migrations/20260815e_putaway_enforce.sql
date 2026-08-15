-- QUY TẮC CẤT HÀNG — đợt B: VẾT của từng lượt cất.
-- Đối xứng với 20260814c (luân chuyển): cột NULLABLE, dòng cũ để NULL = "chưa đo" và KHÔNG vào
-- mẫu số báo cáo tuân thủ — nếu coi dòng cũ là "đạt" thì tỷ lệ tuân thủ bị thổi lên ngay ngày đầu.

BEGIN;

ALTER TABLE public."InventoryEntry"
  -- true = lượt cất này ĐÃ được chấm theo quy tắc (mẫu số của % tuân thủ)
  ADD COLUMN IF NOT EXISTS putaway_checked         boolean NOT NULL DEFAULT false,
  -- mã lý do vi phạm (NO_IN / FULL / PICK_FACE / QA_HOLD / MAX_MATERIALS / NCC_MIX / DATE_MIX);
  -- NULL + checked = cất đúng quy tắc
  ADD COLUMN IF NOT EXISTS putaway_violation       text,
  -- lý do vượt rào, DANH SÁCH CỐ ĐỊNH (utils/putaway.ts) — để báo cáo gom nhóm được nguyên nhân
  ADD COLUMN IF NOT EXISTS putaway_override_reason text;

-- Chỉ đánh index phần VI PHẠM: báo cáo luôn hỏi "lượt nào sai", không ai quét cả bảng để đếm đúng.
CREATE INDEX IF NOT EXISTS idx_inventory_putaway_violation
  ON public."InventoryEntry" (warehouse_id, import_date)
  WHERE putaway_violation IS NOT NULL;

COMMIT;
