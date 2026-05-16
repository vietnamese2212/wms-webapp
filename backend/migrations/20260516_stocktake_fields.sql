-- Thêm cột kiểm kê vào Location và InventoryEntry
ALTER TABLE "Location"
  ADD COLUMN IF NOT EXISTS requires_stocktake BOOLEAN DEFAULT false;

ALTER TABLE "InventoryEntry"
  ADD COLUMN IF NOT EXISTS stocktake_flagged   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS stocktake_flag_note TEXT,
  ADD COLUMN IF NOT EXISTS stocktake_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stocktake_by        UUID REFERENCES "Employee"(id);
