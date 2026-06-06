-- Thêm cột ship-to-party (mã khách hàng/NPP) vào đơn xuất
-- Plain text, không FK — nếu trùng với Warehouse.code thì app tự tạo inbound điều chuyển
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS shipto_party text;
