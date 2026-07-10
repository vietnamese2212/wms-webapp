-- Chế độ quản tồn thứ 4: QTY_DATE = tồn số lượng NHƯNG tách pool theo NSX (theo dõi date).
-- Pool = 1 dòng InventoryEntry / (kho, mã hàng, NSX); xuất trừ FEFO (NSX cũ nhất trước, cho chọn tay khi cần).

-- 1. Nới CHECK inventory_mode
ALTER TABLE "Warehouse" DROP CONSTRAINT IF EXISTS warehouse_inventory_mode_check;
ALTER TABLE "Warehouse"
  ADD CONSTRAINT warehouse_inventory_mode_check
  CHECK (inventory_mode IN ('QR', 'QTY', 'NONE', 'QTY_DATE'));

-- 2. Unique index chống trùng pallet: thêm production_date vào khóa để kho QTY_DATE có
--    NHIỀU dòng active cùng (kho, mã hàng) khác NSX.
--    An toàn cho các mode cũ: QR = pallet_code là chuỗi QR nguyên văn (trùng code ⇒ trùng NSX ⇒ vẫn chặn
--    double-scan); QTY = pool không có NSX (null ⇒ COALESCE mốc chung ⇒ vẫn 1 dòng active/(kho,mã)).
DROP INDEX IF EXISTS uq_inventory_active_wh_pallet;
CREATE UNIQUE INDEX uq_inventory_active_wh_pallet
  ON "InventoryEntry" (warehouse_id, pallet_code, COALESCE(production_date, '1900-01-01'::timestamp)) NULLS NOT DISTINCT
  WHERE status = ANY (ARRAY['IN_STOCK'::text, 'PARTIAL'::text, 'QUARANTINE'::text, 'LOOSE_PICKING'::text]);
