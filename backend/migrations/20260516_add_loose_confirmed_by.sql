-- Lưu người xác nhận nhặt lẻ
ALTER TABLE "OutboundScanEntry"
  ADD COLUMN IF NOT EXISTS loose_confirmed_by TEXT REFERENCES "Employee"(id);
