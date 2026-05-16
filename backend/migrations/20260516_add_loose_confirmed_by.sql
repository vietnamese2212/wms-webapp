-- Lưu người xác nhận nhặt lẻ
ALTER TABLE "OutboundScanEntry"
  ADD COLUMN IF NOT EXISTS loose_confirmed_by UUID REFERENCES "Employee"(id);
