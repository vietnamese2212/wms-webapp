-- Transfer inbound workflow: nhập hàng chuyển kho (kho A → kho B)

-- TmsOrder: phân biệt NCC vs TRANSFER, link GDO nguồn
ALTER TABLE "TmsOrder" ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'NCC'; -- 'NCC' | 'TRANSFER'
ALTER TABLE "TmsOrder" ADD COLUMN IF NOT EXISTS transfer_gdo_id TEXT REFERENCES "GroupDeliveryOrder"(id);
ALTER TABLE "TmsOrder" ADD COLUMN IF NOT EXISTS destination_warehouse_id UUID REFERENCES "Warehouse"(id);

-- GroupDeliveryOrder: track trạng thái giao hàng liên kho
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS transfer_status TEXT; -- 'PENDING_DELIVERY' | 'IN_TRANSIT' | 'DELIVERED'
