-- Cho phép cùng pallet_code tồn tại ở nhiều kho khác nhau (split pallet scenario).
-- Trước đây: 1 pallet_code = 1 row → transfer = UPDATE (mất lịch sử khi split).
-- Sau: mỗi kho nhận hàng = INSERT row mới → duplicate check chuyển sang app-level (theo warehouse).
ALTER TABLE "InventoryEntry" DROP CONSTRAINT IF EXISTS "InventoryEntry_pallet_code_key";
