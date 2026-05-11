-- Add 10 test locations per warehouse (max 5 pallets each) for app testing
-- Location code format: {warehouse_code}_TEST_{row}_{shelf}

WITH
  bv AS (SELECT id FROM "Warehouse" WHERE code = 'BV' LIMIT 1),
  bb AS (SELECT id FROM "Warehouse" WHERE code = 'BB' LIMIT 1)
INSERT INTO "Location" (id, warehouse_id, sub_code, sub_name, sub_type, location_code, row, shelf, max_pallets, is_active, created_at, updated_at)
SELECT
  gen_random_uuid(),
  wh_id,
  'TEST',
  'Khu Test',
  'THANH_PHAM',
  wh_code || '_TEST_' || r || '_' || s,
  r::text,
  s,
  5,
  true,
  now(),
  now()
FROM (
  SELECT id AS wh_id, 'BV' AS wh_code FROM bv
  UNION ALL
  SELECT id AS wh_id, 'BB' AS wh_code FROM bb
) warehouses
CROSS JOIN (VALUES ('1'),('2'),('3'),('4'),('5')) AS rows(r)
CROSS JOIN (VALUES ('T1'),('T2')) AS shelves(s)
ON CONFLICT (location_code) DO NOTHING;
