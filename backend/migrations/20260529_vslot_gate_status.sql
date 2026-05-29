-- Per-slot gate export status tracking
-- TmsVehicleSlot.gate_export_status: trạng thái gate của từng slot xe (độc lập với nhau)
-- Thay thế order-level export_status trong booking display để hiển thị đúng từng dòng xe

ALTER TABLE "TmsVehicleSlot"
  ADD COLUMN IF NOT EXISTS gate_export_status TEXT;
