-- 20260810c_employee_fk_indexes.sql
-- XÓA NHÂN VIÊN TIMEOUT 8s khi bảng nghiệp vụ đạt quy mô thật (bug #4 check-app 10/08,
-- bắt khi test với 3 tháng dữ liệu 390k dòng): DELETE 1 dòng "Employee" kích RI-check
-- `SELECT 1 FROM <bảng con> WHERE <cột FK> = $id` trên TỪNG FK trỏ Employee — các cột này
-- KHÔNG có index nên mỗi FK = 1 seq scan (InventoryEntry 175k × 3 cột + OutboundScanEntry
-- 150k × 2 cột…) ⇒ 57014 statement timeout. Ảnh hưởng cả trang Quản lý người dùng (xóa
-- tài khoản) lẫn thao tác quản trị DB ở production khi dữ liệu tích đủ lớn.
-- Index partial WHERE IS NOT NULL: RI-check tra giá trị cụ thể (non-null) nên dùng được,
-- đa số dòng để NULL các cột này nên index rất nhỏ.
-- Bảng chọn theo QUY MÔ (đang/ sẽ hàng trăm nghìn–triệu dòng/năm); bảng nhỏ cố định bỏ qua.

-- InventoryEntry (175k, sẽ hàng triệu)
CREATE INDEX IF NOT EXISTS idx_inv_created_by   ON "InventoryEntry" (created_by)   WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_updated_by   ON "InventoryEntry" (updated_by)   WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_stocktake_by ON "InventoryEntry" (stocktake_by) WHERE stocktake_by IS NOT NULL;

-- OutboundScanEntry (150k, sẽ hàng triệu)
CREATE INDEX IF NOT EXISTS idx_ose_scanned_by         ON "OutboundScanEntry" (scanned_by)         WHERE scanned_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ose_loose_confirmed_by ON "OutboundScanEntry" (loose_confirmed_by) WHERE loose_confirmed_by IS NOT NULL;

-- GroupDeliveryOrder + StocktakeLog + ProductionImport (vài nghìn → hàng trăm nghìn/năm)
CREATE INDEX IF NOT EXISTS idx_gdo_forklift_driver ON "GroupDeliveryOrder" (forklift_driver_id) WHERE forklift_driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stocktakelog_counted_by ON "StocktakeLog" (counted_by) WHERE counted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prodimport_imported_by ON "ProductionImport" (imported_by) WHERE imported_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prodimport_created_by  ON "ProductionImport" (created_by)  WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prodimport_updated_by  ON "ProductionImport" (updated_by)  WHERE updated_by IS NOT NULL;
