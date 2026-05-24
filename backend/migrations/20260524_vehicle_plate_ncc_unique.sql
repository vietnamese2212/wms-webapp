-- Cho phép cùng biển số thuộc nhiều ĐVVT khác nhau
-- Unique constraint dịch chuyển từ (license_plate) → (license_plate, ncc_id)

ALTER TABLE "Vehicle" DROP CONSTRAINT IF EXISTS "Vehicle_license_plate_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Vehicle_plate_ncc_uidx"
  ON "Vehicle"(license_plate, ncc_id);
