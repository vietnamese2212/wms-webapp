-- Bỏ direction khỏi SlotTemplate và DeliverySlot (khung giờ dùng chung Xuất/Nhập)
ALTER TABLE "SlotTemplate"   ALTER COLUMN direction DROP NOT NULL;
ALTER TABLE "SlotTemplate"   DROP CONSTRAINT IF EXISTS "SlotTemplate_direction_check";
ALTER TABLE "DeliverySlot"   ALTER COLUMN direction DROP NOT NULL;
ALTER TABLE "DeliverySlot"   DROP CONSTRAINT IF EXISTS "DeliverySlot_direction_check";
