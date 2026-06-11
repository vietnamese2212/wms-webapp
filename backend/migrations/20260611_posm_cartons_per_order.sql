-- Thêm cột posm_cartons vào ProductionImport
-- Mục đích: lưu số thùng mà TỪNG phiếu đóng góp vào shared pallet (Loscam/POSM)
-- Trước đây tất cả phiếu trỏ cùng 1 InventoryEntry và hiển thị tổng cộng dồn
-- Sau migration: mỗi phiếu biết đóng góp của riêng mình

ALTER TABLE "ProductionImport" ADD COLUMN IF NOT EXISTS posm_cartons integer;
