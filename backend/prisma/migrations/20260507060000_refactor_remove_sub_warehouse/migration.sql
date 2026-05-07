-- Refactor: Remove SubWarehouse table, embed sub_code/sub_name/sub_type into Location
-- Xoá dữ liệu phụ thuộc trước (sẽ seed lại)
DELETE FROM "ExportHistory";
DELETE FROM "LocationTransfer";
DELETE FROM "ProductionImport";
DELETE FROM "InventoryEntry";
DELETE FROM "Location";

-- Xoá FK cũ và cột sub_warehouse_id
ALTER TABLE "Location" DROP CONSTRAINT "Location_sub_warehouse_id_fkey";
ALTER TABLE "Location" DROP COLUMN "sub_warehouse_id";

-- Xoá index cũ
DROP INDEX IF EXISTS "Location_sub_warehouse_id_idx";

-- Thêm cột mới (nullable trước để tránh lỗi NOT NULL trên bảng trống)
ALTER TABLE "Location" ADD COLUMN "warehouse_id" TEXT;
ALTER TABLE "Location" ADD COLUMN "sub_code"     TEXT;
ALTER TABLE "Location" ADD COLUMN "sub_name"     TEXT;
ALTER TABLE "Location" ADD COLUMN "sub_type"     TEXT;

-- Đổi thành NOT NULL (bảng đã rỗng nên OK)
ALTER TABLE "Location" ALTER COLUMN "warehouse_id" SET NOT NULL;
ALTER TABLE "Location" ALTER COLUMN "sub_code"     SET NOT NULL;

-- Thêm FK mới và index
ALTER TABLE "Location" ADD CONSTRAINT "Location_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Location_warehouse_id_idx"          ON "Location"("warehouse_id");
CREATE INDEX "Location_warehouse_id_sub_code_idx" ON "Location"("warehouse_id", "sub_code");

-- Xoá bảng SubWarehouse (không còn dùng)
DROP TABLE "SubWarehouse";
