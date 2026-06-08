-- Thêm FK constraint cho ProductionImport.from_gdo_id → GroupDeliveryOrder(id)
-- Cần để PostgREST có thể resolve embedded join from_gdo:GroupDeliveryOrder!...
-- Không có FK → PostgREST trả PGRST200 "No relationship found" → toàn bộ inbound-orders list bị rỗng

ALTER TABLE "ProductionImport"
ADD CONSTRAINT fk_production_import_from_gdo
FOREIGN KEY (from_gdo_id) REFERENCES "GroupDeliveryOrder"(id) ON DELETE SET NULL;
