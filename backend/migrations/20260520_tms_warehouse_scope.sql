-- TMS Phase 1 — Warehouse scope cho SlotTemplate & DeliverySlot
-- SlotTemplate và DeliverySlot phải gắn với 1 kho cụ thể
-- vì mỗi kho có khung giờ và số xe tối đa khác nhau

ALTER TABLE "SlotTemplate"
  ADD COLUMN IF NOT EXISTS warehouse_id UUID NOT NULL REFERENCES "Warehouse"(id);

ALTER TABLE "DeliverySlot"
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES "Warehouse"(id);
