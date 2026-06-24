-- Xe "kết hợp" (vừa Nhập vừa Xuất cùng Loại kho): 1 lần đăng ký tách thành 2 bản ghi 1 chiều
-- (1 INBOUND + 1 OUTBOUND) chia sẻ cùng visit_group_id để thể hiện là cùng 1 lượt xe.
-- Không lưu record nào là "BOTH" → cỗ máy match/relink booking giữ nguyên, không lỗi TMS booking.
ALTER TABLE gate_registrations
  ADD COLUMN IF NOT EXISTS visit_group_id uuid;

CREATE INDEX IF NOT EXISTS idx_gate_reg_visit_group ON gate_registrations (visit_group_id);
