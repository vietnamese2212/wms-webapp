-- Seed danh mục Đơn vị tính (LookupValue type='unit_of_measure') — thay trường ĐVT cũ (Material.unit).
-- meta.role: base = hiện ở ô Base Unit · entry = ô Entry Unit · both = cả hai (Materials form lọc theo role).
-- Áp được nhiều lần (NOT EXISTS chống trùng). Giá trị suy từ base_unit/entry_unit đang dùng thật:
--   base: BAG/BT/EA/HOP/KG · entry: CAR (để 'both' cho mã bán theo thùng không có đơn vị nhỏ hơn).
INSERT INTO "LookupValue" (id, type, value, sort_order, meta, created_at, updated_at, created_by)
SELECT gen_random_uuid(), 'unit_of_measure', v.value, v.sort_order,
       jsonb_build_object('role', v.role, 'label', v.label), now(), now(), 'system'
FROM (VALUES
  ('CAR', 1, 'both', 'Thùng'),
  ('HOP', 2, 'base', 'Hộp'),
  ('BT',  3, 'base', 'Chai'),
  ('BAG', 4, 'base', 'Bao'),
  ('KG',  5, 'base', 'Kilogram'),
  ('EA',  6, 'base', 'Cái')
) AS v(value, sort_order, role, label)
WHERE NOT EXISTS (
  SELECT 1 FROM "LookupValue" l WHERE l.type = 'unit_of_measure' AND l.value = v.value
);
