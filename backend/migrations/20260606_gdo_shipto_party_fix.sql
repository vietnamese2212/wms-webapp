-- Bỏ FK constraint, giữ lại plain text field (ship to party là mã khách hàng, không phải warehouse FK)
ALTER TABLE "GroupDeliveryOrder" DROP CONSTRAINT IF EXISTS "GroupDeliveryOrder_shipto_party_id_fkey";
ALTER TABLE "GroupDeliveryOrder" RENAME COLUMN shipto_party_id TO shipto_party;
