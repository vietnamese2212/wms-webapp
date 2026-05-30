-- Thêm timestamp từ cổng vào TmsVehicleSlot để hiển thị trong Kế hoạch VC
-- Dữ liệu được cập nhật bởi gateRegistrationController khi xe đăng ký/vào/ra

ALTER TABLE "TmsVehicleSlot"
  ADD COLUMN IF NOT EXISTS gate_registered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gate_entry_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gate_exit_at       TIMESTAMPTZ;
