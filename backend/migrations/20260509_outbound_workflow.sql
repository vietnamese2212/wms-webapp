-- Rev 13: GroupDeliveryOrder workflow fields (Giao đơn + Bắt đầu)
-- Apply: Supabase Dashboard → SQL Editor

ALTER TABLE "GroupDeliveryOrder"
  ADD COLUMN IF NOT EXISTS assigned_at         TIMESTAMP,
  ADD COLUMN IF NOT EXISTS assigned_by         TEXT,
  ADD COLUMN IF NOT EXISTS started_at          TIMESTAMP,
  ADD COLUMN IF NOT EXISTS license_plate       TEXT,
  ADD COLUMN IF NOT EXISTS container_number    TEXT,
  ADD COLUMN IF NOT EXISTS exporter_name       TEXT,
  ADD COLUMN IF NOT EXISTS loader_name         TEXT,
  ADD COLUMN IF NOT EXISTS forklift_driver_id  TEXT REFERENCES "Employee"(id);
