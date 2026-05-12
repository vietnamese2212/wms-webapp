-- Chuẩn hóa Location NVL — giữ nguyên hậu tố số
--   sub_code:      NL1  → NVL1,  NL2  → NVL2
--   sub_name:      "Nguyên liệu 1" → "NVL 1"
--   sub_type:      NGUYEN_LIEU → NVL
--   category:      NULL → NVL
--   location_code: BV_NL1_01_T1 → BV_NVL1_01_T1
-- Chạy trong Supabase Dashboard → SQL Editor

UPDATE "Location"
SET
  sub_code      = 'NVL' || SUBSTRING(sub_code FROM 3),
  location_code = REPLACE(location_code, '_NL', '_NVL'),
  sub_name      = 'NVL' || SUBSTRING(sub_name FROM (LENGTH('Nguyên liệu') + 1)),
  sub_type      = 'NVL',
  category      = 'NVL'
WHERE sub_type = 'NGUYEN_LIEU'
   OR sub_name ILIKE 'Nguyên liệu%';

-- Kiểm tra sau:
-- SELECT sub_code, sub_name, sub_type, category, location_code
-- FROM "Location" WHERE sub_type = 'NVL' ORDER BY sub_code LIMIT 20;
