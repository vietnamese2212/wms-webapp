-- Thêm audit columns cho Material
ALTER TABLE "Material"
  ADD COLUMN IF NOT EXISTS created_by  TEXT,
  ADD COLUMN IF NOT EXISTS updated_by  TEXT;
