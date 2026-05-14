-- Add production_date to OutboundScanEntry for FIFO highlighting
-- Stores NSX of the pallet at scan time, copied from InventoryEntry.production_date
ALTER TABLE "OutboundScanEntry"
  ADD COLUMN IF NOT EXISTS production_date TEXT;
