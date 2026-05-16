-- Loose picking confirmation feature
-- InventoryEntry.cartons_reserved: thùng đã giữ cho nhặt lẻ chưa được xác nhận
ALTER TABLE "InventoryEntry"
  ADD COLUMN IF NOT EXISTS cartons_reserved DECIMAL NOT NULL DEFAULT 0;

-- OutboundScanEntry: trạng thái xác nhận nhặt lẻ
ALTER TABLE "OutboundScanEntry"
  ADD COLUMN IF NOT EXISTS loose_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS loose_confirmed_at TIMESTAMPTZ;
