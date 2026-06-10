-- Xóa tất cả phiếu nhập đã bị huỷ (dọn dẹp sau khi chuyển sang hard delete)
DELETE FROM "ProductionImport" WHERE status = 'CANCELLED';
