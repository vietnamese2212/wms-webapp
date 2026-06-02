-- Thêm cột warehouse_pallet_overrides: khai báo số thùng/pallet theo từng kho
-- Thay thế cho cartons_per_pallet_mn (vẫn giữ cột cũ để backward compat)
ALTER TABLE "Material"
  ADD COLUMN IF NOT EXISTS warehouse_pallet_overrides JSONB DEFAULT '[]'::jsonb;
