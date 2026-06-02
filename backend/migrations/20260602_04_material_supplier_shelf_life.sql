-- Thêm HSD ngoại lệ theo NCC cho Material
ALTER TABLE "Material"
  ADD COLUMN IF NOT EXISTS supplier_shelf_life_overrides JSONB DEFAULT '[]'::jsonb;
