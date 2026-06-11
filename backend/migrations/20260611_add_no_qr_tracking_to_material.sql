ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS no_qr_tracking BOOLEAN NOT NULL DEFAULT false;

-- Seed: POSM, Pallet Loscam, mã bắt đầu 810000
UPDATE "Material"
SET no_qr_tracking = true
WHERE category IN ('POSM', 'Pallet Loscam')
   OR material_code LIKE '810000%';
