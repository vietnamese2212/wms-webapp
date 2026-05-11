-- 1. Chuẩn hoá Material.category về short code (TP / NVL / POSM / BAO_BI)
--    Seed và import Excel có thể dùng tên đầy đủ tiếng Việt → cần map về code
UPDATE "Material"
SET category = CASE
  WHEN category ILIKE 'thành phẩm'     OR category = 'Thanh pham'  THEN 'TP'
  WHEN category ILIKE 'nguyên vật liệu' OR category ILIKE 'nguyen vat lieu' OR category ILIKE 'nvl' THEN 'NVL'
  WHEN category ILIKE 'posm'            THEN 'POSM'
  WHEN category ILIKE 'bao bì'         OR category ILIKE 'bao bi'   OR category ILIKE 'bao_bi'     THEN 'BAO_BI'
  ELSE category  -- giữ nguyên nếu đã đúng hoặc không map được
END
WHERE category IS NOT NULL
  AND category NOT IN ('TP', 'NVL', 'POSM', 'BAO_BI');  -- chỉ cập nhật những row chưa đúng

-- 2. Gán sub_type cho các location hiện có dựa theo sub_code prefix
--    (phòng khi live DB được tạo tay mà không set sub_type)
UPDATE "Location"
SET sub_type = 'THANH_PHAM'
WHERE sub_type IS NULL
  AND (sub_code ILIKE 'TP%' OR sub_code = 'TEST');

UPDATE "Location"
SET sub_type = 'NGUYEN_LIEU'
WHERE sub_type IS NULL
  AND sub_code ILIKE 'NL%';

UPDATE "Location"
SET sub_type = 'POSM'
WHERE sub_type IS NULL
  AND sub_code ILIKE 'POSM%';

-- 3. Thêm nhiều vị trí Thành phẩm (sub_type = THANH_PHAM) cho kho BV
--    BV_TP3 : 5 hàng × 3 tầng = 15 vị trí, max 4 pallet
--    BV_TP4 : 4 hàng × 3 tầng = 12 vị trí, max 3 pallet
WITH bv AS (SELECT id FROM "Warehouse" WHERE code = 'BV' LIMIT 1)
INSERT INTO "Location" (id, warehouse_id, sub_code, sub_name, sub_type, location_code, row, shelf, max_pallets, is_active, created_at, updated_at)
SELECT
  gen_random_uuid(),
  bv.id,
  cfg.sub_code,
  cfg.sub_name,
  'THANH_PHAM',
  'BV_' || cfg.sub_code || '_' || r || '_' || s,
  r::text,
  s,
  cfg.max_pl,
  true,
  now(),
  now()
FROM bv,
(VALUES
  ('TP3','Thành phẩm 3', 4),
  ('TP4','Thành phẩm 4', 3)
) AS cfg(sub_code, sub_name, max_pl),
(VALUES ('1'),('2'),('3'),('4'),('5')) AS rows(r),
(VALUES ('T1'),('T2'),('T3'))         AS shelves(s)
WHERE NOT (cfg.sub_code = 'TP4' AND r = '5')  -- TP4 chỉ 4 hàng
ON CONFLICT (location_code) DO NOTHING;

-- 4. Thêm NVL locations cho BV (để test filter NVL)
--    BV_NL2 : 3 hàng × 2 tầng = 6 vị trí, max 3 pallet
WITH bv AS (SELECT id FROM "Warehouse" WHERE code = 'BV' LIMIT 1)
INSERT INTO "Location" (id, warehouse_id, sub_code, sub_name, sub_type, location_code, row, shelf, max_pallets, is_active, created_at, updated_at)
SELECT
  gen_random_uuid(),
  bv.id,
  'NL2',
  'Nguyên liệu 2',
  'NGUYEN_LIEU',
  'BV_NL2_' || r || '_' || s,
  r::text,
  s,
  3,
  true,
  now(),
  now()
FROM bv,
(VALUES ('1'),('2'),('3')) AS rows(r),
(VALUES ('T1'),('T2'))     AS shelves(s)
ON CONFLICT (location_code) DO NOTHING;
