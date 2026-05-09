-- Add explicit business-date columns to InventoryEntry
-- import_date: actual date the pallet was physically imported (set at scan time)
-- update_date: last time the entry was modified by an operator

ALTER TABLE "InventoryEntry"
  ADD COLUMN IF NOT EXISTS import_date TIMESTAMP,
  ADD COLUMN IF NOT EXISTS update_date TIMESTAMP;

-- Backfill existing rows from system timestamps
UPDATE "InventoryEntry" SET import_date = created_at WHERE import_date IS NULL;
UPDATE "InventoryEntry" SET update_date = updated_at  WHERE update_date IS NULL;
