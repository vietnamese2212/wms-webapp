-- Shelflife chọn theo lô khi nhận hàng (1 mã + 1 NCC có thể nhiều shelflife: 100/200 ngày).
-- Không suy được từ (mã, NCC) vì NCC có nhiều giá trị → lưu shelflife đã chọn TRỰC TIẾP trên pallet.
-- %Date ưu tiên: InventoryEntry.shelf_life_days → ngoại lệ theo NCC (khi chỉ 1 giá trị) → Material.shelf_life_days.
-- Nullable: pallet cũ / SX / chưa chọn → theo NCC/mặc định. Chuyển kho kế thừa từ pallet gốc cùng pallet_code.

ALTER TABLE "InventoryEntry"
  ADD COLUMN IF NOT EXISTS shelf_life_days integer;
