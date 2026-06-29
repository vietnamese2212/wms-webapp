-- Quy tắc location_code: tiền tố = Warehouse.nmsx_code nếu có, không thì Warehouse.code.
--   vd Ba Vì (nmsx_code 'B')  -> B_TP1_1_T1
--      Bàu Bàng (nmsx_code 'D') -> D_TP1_1_T1
--      Đà Nẵng / NPP (nmsx_code NULL) -> <Mã kho>_TP1_1_T1
--
-- 56 vị trí đã tạo trước đây dùng tiền tố BV_/BB_ (không khớp nmsx_code B/D) -> đổi tên cho khớp.
-- An toàn: các vị trí này có 0 tham chiếu tồn/nhập; InventoryEntry/ProductionImport bám location_id,
-- KHÔNG bám chuỗi location_code, nên đổi tên không hỏng liên kết. WarehouseZone bám sub_code (không đổi).
BEGIN;

-- Kho Ba Vì (code 20000016, nmsx_code 'B'): BV_<phần còn lại> -> B_<phần còn lại>
UPDATE "Location" l
SET location_code = 'B_' || substring(l.location_code FROM 4),
    updated_at    = now()
FROM "Warehouse" w
WHERE l.warehouse_id = w.id
  AND w.code = '20000016'
  AND l.location_code LIKE 'BV\_%' ESCAPE '\';

-- Kho Bàu Bàng (code 20000017, nmsx_code 'D'): BB_<phần còn lại> -> D_<phần còn lại>
UPDATE "Location" l
SET location_code = 'D_' || substring(l.location_code FROM 4),
    updated_at    = now()
FROM "Warehouse" w
WHERE l.warehouse_id = w.id
  AND w.code = '20000017'
  AND l.location_code LIKE 'BB\_%' ESCAPE '\';

COMMIT;
