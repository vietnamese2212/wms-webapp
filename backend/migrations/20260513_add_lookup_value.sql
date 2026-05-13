-- Bảng lưu các giá trị lookup dùng chung (vd: loại xuất hàng)
CREATE TABLE IF NOT EXISTS "LookupValue" (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT        NOT NULL,
  value       TEXT        NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (type, value)
);

-- Seed 3 loại xuất ban đầu
INSERT INTO "LookupValue" (type, value, sort_order) VALUES
  ('export_type', 'Xe Container', 1),
  ('export_type', 'Xe Pallet',    2),
  ('export_type', 'Xe Xá',        3)
ON CONFLICT (type, value) DO NOTHING;
