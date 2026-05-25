-- Thêm consolidation group vào TmsVehicleSlot
-- Cho phép nhiều đơn của cùng 1 xe (1 xe đi nhiều đơn) → tính 1 booked_count

ALTER TABLE "TmsVehicleSlot"
  ADD COLUMN IF NOT EXISTS consolidation_group_id UUID,
  ADD COLUMN IF NOT EXISTS is_consolidation_primary BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tms_vehicle_slot_consolidation
  ON "TmsVehicleSlot"(consolidation_group_id)
  WHERE consolidation_group_id IS NOT NULL;
