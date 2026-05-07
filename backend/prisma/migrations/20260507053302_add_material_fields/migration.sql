-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "cartons_per_pallet" INTEGER,
ADD COLUMN     "cartons_per_pallet_mn" INTEGER,
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "old_code" TEXT,
ADD COLUMN     "shelf_life_days" INTEGER,
ADD COLUMN     "storage_category" TEXT,
ADD COLUMN     "units_per_carton" INTEGER,
ADD COLUMN     "weight_kg" DECIMAL(65,30);
