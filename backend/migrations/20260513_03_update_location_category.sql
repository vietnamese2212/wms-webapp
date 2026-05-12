-- Cập nhật Location.category dựa theo sub_code prefix
-- TP% → Thành phẩm | NVL% → NVL | POSM% → POSM
-- Chạy trong Supabase Dashboard → SQL Editor
-- Kiểm tra trước: SELECT DISTINCT sub_code, sub_type FROM "Location" WHERE category IS NULL ORDER BY sub_code;

UPDATE "Location" SET category = 'Thành phẩm' WHERE category IS NULL AND sub_code ILIKE 'TP%';
UPDATE "Location" SET category = 'NVL'        WHERE category IS NULL AND sub_code ILIKE 'NVL%';
UPDATE "Location" SET category = 'POSM'       WHERE category IS NULL AND sub_code ILIKE 'POSM%';

-- Kiểm tra sau:
-- SELECT category, COUNT(*) FROM "Location" GROUP BY category ORDER BY category;
