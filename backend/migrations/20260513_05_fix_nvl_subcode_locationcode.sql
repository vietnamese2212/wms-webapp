-- Fix NVL locations: sub_code NL1→NVL1, location_code BV_NL1_…→BV_NVL1_…, sub_name NVL→NVL1
-- Chạy sau migration _04 (đã set sub_type='NVL' nhưng sub_code/location_code chưa đổi)
-- Chạy trong Supabase Dashboard → SQL Editor

UPDATE "Location"
SET
  sub_code      = 'NVL' || SUBSTRING(sub_code FROM 3),
  location_code = REPLACE(location_code, '_NL', '_NVL'),
  sub_name      = 'NVL' || SUBSTRING(sub_code FROM 3)
WHERE sub_type = 'NVL'
  AND sub_code ILIKE 'NL%';

-- Giải thích:
--   sub_code ILIKE 'NL%'  → chỉ chạm record chưa được sửa (NL1, NL2…)
--   SUBSTRING(sub_code FROM 3) → lấy từ ký tự thứ 3 trở đi (bỏ 2 ký tự 'NL')
--   NL1 → NVL + 1 = NVL1 | NL2 → NVL2 | NL10 → NVL10
--   BV_NL1_1_T2 → BV_NVL1_1_T2 (REPLACE '_NL' → '_NVL')
--   sub_name lấy lại từ sub_code mới (NVL1, NVL2…)

-- Kiểm tra sau:
-- SELECT sub_code, sub_name, sub_type, category, location_code
-- FROM "Location" WHERE sub_type = 'NVL' ORDER BY sub_code LIMIT 30;
