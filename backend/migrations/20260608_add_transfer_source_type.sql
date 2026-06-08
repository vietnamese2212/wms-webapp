-- Thêm 'TRANSFER' vào check constraint source_type của ProductionImport
-- Cần cho luồng chuyển kho NPP nhận hàng

ALTER TABLE "ProductionImport"
DROP CONSTRAINT check_production_import_source_type;

ALTER TABLE "ProductionImport"
ADD CONSTRAINT check_production_import_source_type
CHECK (source_type IN ('FACTORY', 'NCC', 'TRANSFER'));
