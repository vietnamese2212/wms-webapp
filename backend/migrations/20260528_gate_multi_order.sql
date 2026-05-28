-- Multi-order support for gate_registrations
-- 1 xe có thể chở nhiều TmsOrder trong cùng 1 booking slot

ALTER TABLE gate_registrations
  ADD COLUMN IF NOT EXISTS tms_order_ids           TEXT,     -- comma-sep UUIDs của tất cả đơn trong slot group
  ADD COLUMN IF NOT EXISTS booking_npp_names       TEXT,     -- comma-sep tên NPP
  ADD COLUMN IF NOT EXISTS booking_gdo_refs        TEXT,     -- comma-sep GDO refs
  ADD COLUMN IF NOT EXISTS booking_planned_boxes   TEXT,     -- comma-sep số thùng
  ADD COLUMN IF NOT EXISTS booking_planned_pallets TEXT;     -- comma-sep số pallet

-- Backfill: populate tms_order_ids từ tms_order_id cũ (single-order records)
UPDATE gate_registrations
SET tms_order_ids = tms_order_id::TEXT
WHERE tms_order_id IS NOT NULL AND tms_order_ids IS NULL;
