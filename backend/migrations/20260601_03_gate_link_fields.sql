-- Link tường minh gate registration → outbound/inbound execution
-- TmsVehicleSlot.gate_registration_id : link đúng "lần" cho OUTBOUND (thay thế position-based suggest)
-- GroupDeliveryOrder.gate_registration_id: link xe GDO với lần đăng ký gate cụ thể

ALTER TABLE "TmsVehicleSlot"
  ADD COLUMN IF NOT EXISTS gate_registration_id UUID REFERENCES gate_registrations(id) ON DELETE SET NULL;

ALTER TABLE "GroupDeliveryOrder"
  ADD COLUMN IF NOT EXISTS gate_registration_id UUID REFERENCES gate_registrations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vslot_gate_reg ON "TmsVehicleSlot"(gate_registration_id);
CREATE INDEX IF NOT EXISTS idx_gdo_gate_reg   ON "GroupDeliveryOrder"(gate_registration_id);

NOTIFY pgrst, 'reload schema';
