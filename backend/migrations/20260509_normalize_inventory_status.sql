-- Normalize InventoryEntry.status: convert legacy mixed-case values to uppercase
-- Applies to data created before the current code standardized on uppercase enums
-- Apply: Supabase Dashboard → SQL Editor

UPDATE "InventoryEntry" SET status = 'IN_STOCK'    WHERE status = 'In_Stock';
UPDATE "InventoryEntry" SET status = 'EXPORTED'    WHERE status = 'Exported';
UPDATE "InventoryEntry" SET status = 'PARTIAL'     WHERE status = 'Partial';
UPDATE "InventoryEntry" SET status = 'TRANSFERRED' WHERE status = 'Transferred';
UPDATE "InventoryEntry" SET status = 'QUARANTINE'  WHERE status = 'Quarantine';
UPDATE "InventoryEntry" SET status = 'CANCELLED'   WHERE status = 'Cancelled';
