-- Chuẩn hóa Location NVL: sub_type NGUYEN_LIEU + sub_name Nguyên liệu → NVL
-- Áp dụng cho cả category (trường hợp migration _03 bỏ sót do sub_code không bắt đầu bằng NVL)
-- Chạy trong Supabase Dashboard → SQL Editor

UPDATE "Location"
SET
  sub_type = 'NVL',
  sub_name = 'NVL',
  category = 'NVL'
WHERE sub_type = 'NGUYEN_LIEU'
   OR sub_name = 'Nguyên liệu';

-- Kiểm tra sau:
-- SELECT sub_code, sub_name, sub_type, category FROM "Location"
-- WHERE sub_code ILIKE 'NVL%' OR sub_type = 'NVL' ORDER BY sub_code LIMIT 20;
