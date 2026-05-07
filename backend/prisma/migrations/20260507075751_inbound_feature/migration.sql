/*
  Warnings:

  - You are about to drop the column `quantity` on the `ProductionImport` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "InventoryEntry" ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "import_order_id" TEXT,
ADD COLUMN     "machine_code" TEXT,
ADD COLUMN     "updated_by" TEXT;

-- AlterTable
ALTER TABLE "ProductionImport" DROP COLUMN "quantity",
ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "location_id" TEXT,
ADD COLUMN     "planned_pallets" INTEGER,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "updated_by" TEXT,
ADD COLUMN     "warehouse_id" TEXT;

-- CreateIndex
CREATE INDEX "InventoryEntry_import_order_id_idx" ON "InventoryEntry"("import_order_id");

-- CreateIndex
CREATE INDEX "ProductionImport_warehouse_id_idx" ON "ProductionImport"("warehouse_id");

-- CreateIndex
CREATE INDEX "ProductionImport_status_idx" ON "ProductionImport"("status");

-- CreateIndex
CREATE INDEX "ProductionImport_material_id_idx" ON "ProductionImport"("material_id");

-- AddForeignKey
ALTER TABLE "InventoryEntry" ADD CONSTRAINT "InventoryEntry_import_order_id_fkey" FOREIGN KEY ("import_order_id") REFERENCES "ProductionImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEntry" ADD CONSTRAINT "InventoryEntry_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEntry" ADD CONSTRAINT "InventoryEntry_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionImport" ADD CONSTRAINT "ProductionImport_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionImport" ADD CONSTRAINT "ProductionImport_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionImport" ADD CONSTRAINT "ProductionImport_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionImport" ADD CONSTRAINT "ProductionImport_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
