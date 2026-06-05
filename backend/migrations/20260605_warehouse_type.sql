-- Thêm cột phân loại kho: CENTRAL (Kho tổng) hoặc NPP (Nhà phân phối)
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS warehouse_type text NOT NULL DEFAULT 'CENTRAL';
