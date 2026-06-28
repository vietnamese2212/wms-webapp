-- Ngoại lệ HSD theo NCC: cần biết NCC của hàng để chọn shelf-life override.
-- Pallet/QR KHÔNG mang NCC → lấy NCC ở ngữ cảnh phiếu nhập (ProductionImport),
-- rồi denormalize xuống InventoryEntry khi quét (né join 13k dòng khi tính %Date).
-- ncc_id → TransportCompany (type='NCC'). Nullable: SX/chuyển kho/pallet cũ = HSD mặc định.

ALTER TABLE "ProductionImport"
  ADD COLUMN IF NOT EXISTS ncc_id uuid REFERENCES "TransportCompany"(id);

ALTER TABLE "InventoryEntry"
  ADD COLUMN IF NOT EXISTS ncc_id uuid REFERENCES "TransportCompany"(id);

CREATE INDEX IF NOT EXISTS idx_inventory_entry_ncc_id ON "InventoryEntry"(ncc_id);
