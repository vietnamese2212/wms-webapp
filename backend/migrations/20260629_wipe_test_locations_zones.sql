-- Dọn sạch VỊ TRÍ + KHU VỰC test (56 vị trí + 2 khu, up bằng script cũ nên lệch: 7 sub_code
-- nhưng chỉ 2 khu) để up lại từ đầu cho chuẩn. Chỉ InventoryEntry + ProductionImport tham chiếu
-- location_id, cả hai đang RỖNG → xóa an toàn, không FK chặn.
-- Apply: Supabase Dashboard → SQL Editor → Run. (Sau đó up lại 5_ViTriKho.xlsx.)
BEGIN;

-- Chốt an toàn: nếu đã có tồn kho thì DỪNG (không xóa vị trí đang dùng).
DO $$
BEGIN
  IF (SELECT count(*) FROM "InventoryEntry") > 0
     OR (SELECT count(*) FROM "ProductionImport") > 0 THEN
    RAISE EXCEPTION 'Có tồn kho/phiếu nhập đang tham chiếu vị trí — DỪNG, không xóa.';
  END IF;
END $$;

DELETE FROM "Location";
DELETE FROM "WarehouseZone";

COMMIT;
