-- Inventory adjustment & stocktaking fields
ALTER TABLE "InventoryEntry"
  ADD COLUMN IF NOT EXISTS "adjustment_qty"  DECIMAL      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "stocktake_by"    TEXT         REFERENCES "Employee"(id),
  ADD COLUMN IF NOT EXISTS "stocktake_at"    TIMESTAMPTZ;
