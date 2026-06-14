-- Chuẩn hóa Warehouse.warehouse_type: các kho cũ đang NULL → 'CENTRAL' (Kho tổng)
-- Lý do: WMS Settings hiển thị NULL như "Kho tổng" nhưng NMSX (In tem pallet) lọc === 'CENTRAL'
-- nên kho NULL bị loại → dropdown NMSX rỗng. Backfill cho khớp ngữ nghĩa, rồi ép NOT NULL DEFAULT.
UPDATE "Warehouse" SET warehouse_type = 'CENTRAL', updated_at = now() WHERE warehouse_type IS NULL;
ALTER TABLE "Warehouse" ALTER COLUMN warehouse_type SET DEFAULT 'CENTRAL';
ALTER TABLE "Warehouse" ALTER COLUMN warehouse_type SET NOT NULL;
