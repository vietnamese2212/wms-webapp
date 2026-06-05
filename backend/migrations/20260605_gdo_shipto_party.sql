-- Thêm cột kho nhận hàng cho đơn xuất (dùng cho điều chuyển kho / giao NPP)
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS shipto_party_id text REFERENCES "Warehouse"(id);
