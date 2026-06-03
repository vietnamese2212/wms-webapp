-- Thêm trạng thái và lý do hủy cho dòng kế hoạch nhập ngoài
-- ACTIVE (mặc định) = đang kế hoạch
-- CANCELLED         = đã hủy (NCC không tới / dời lịch / lý do khác)

ALTER TABLE inbound_plan_lines
  ADD COLUMN IF NOT EXISTS status       VARCHAR NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_inbound_plan_lines_status
  ON inbound_plan_lines(status);

-- Realtime đã bật cho bảng này (migration 20260601_04_inbound_plan_lines.sql)
-- TmsOrder.status đã là VARCHAR — thêm giá trị 'CANCELLED' không cần migration schema
