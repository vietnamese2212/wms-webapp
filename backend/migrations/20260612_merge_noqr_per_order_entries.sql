-- Dọn data: gộp các InventoryEntry mã KHÔNG-QR được tạo riêng theo từng phiếu
-- (pallet_code = "{material_code}_M_{uuid8}", sinh ra trong khoảng commit 8d76ae3)
-- về 1 entry chung mỗi (kho, vật tư) — pallet_code = material_code.
-- Đồng thời ghi lại posm_entry_id + posm_cartons cho phiếu để detail hiển thị đúng đóng góp.
--
-- An toàn: chỉ áp dụng cho Material.no_qr_tracking = true và entry IN_STOCK.
-- Chạy 1 lần qua Supabase Dashboard → SQL Editor.

DO $$
DECLARE
  r          RECORD;
  shared_id  text;
BEGIN
  FOR r IN
    SELECT ie.id, ie.warehouse_id, ie.cartons_imported, ie.cartons_remaining, m.material_code
    FROM "InventoryEntry" ie
    JOIN "Material" m ON m.id = ie.material_id
    WHERE m.no_qr_tracking = true
      AND ie.status = 'IN_STOCK'
      AND ie.pallet_code <> m.material_code   -- entry per-phiếu (_M_), không phải entry chung
  LOOP
    -- Tìm entry chung của (kho, vật tư) — pallet_code = material_code
    SELECT id INTO shared_id
    FROM "InventoryEntry"
    WHERE pallet_code = r.material_code
      AND warehouse_id IS NOT DISTINCT FROM r.warehouse_id
      AND id <> r.id
    LIMIT 1;

    IF shared_id IS NULL THEN
      -- Chưa có entry chung → biến entry này thành entry chung (đổi pallet_code)
      UPDATE "InventoryEntry" SET pallet_code = r.material_code, updated_at = now() WHERE id = r.id;
      UPDATE "ProductionImport" SET posm_cartons = r.cartons_imported WHERE posm_entry_id::text = r.id;
    ELSE
      -- Cộng dồn vào entry chung, chuyển phiếu trỏ về entry chung, xoá entry per-phiếu
      UPDATE "InventoryEntry"
        SET cartons_imported  = cartons_imported  + r.cartons_imported,
            cartons_remaining = cartons_remaining + r.cartons_remaining,
            updated_at = now()
        WHERE id = shared_id;
      UPDATE "ProductionImport"
        SET posm_entry_id = shared_id::uuid, posm_cartons = r.cartons_imported
        WHERE posm_entry_id::text = r.id;
      DELETE FROM "InventoryEntry" WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
