-- Cho phép location_id nullable trong InventoryEntry
-- Dùng cho hàng POSM và Pallet Loscam: không yêu cầu vị trí kho khi nhập
ALTER TABLE "InventoryEntry" ALTER COLUMN "location_id" DROP NOT NULL;
