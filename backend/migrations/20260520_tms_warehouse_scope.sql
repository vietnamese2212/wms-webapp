-- TMS Phase 1 — Warehouse scope cho SlotTemplate & DeliverySlot
-- Warehouse.id là TEXT nên warehouse_id phải TEXT (không phải UUID)

ALTER TABLE "SlotTemplate"
  ADD COLUMN IF NOT EXISTS warehouse_id TEXT NOT NULL REFERENCES "Warehouse"(id);

ALTER TABLE "DeliverySlot"
  ADD COLUMN IF NOT EXISTS warehouse_id TEXT REFERENCES "Warehouse"(id);
