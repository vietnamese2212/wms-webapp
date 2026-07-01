-- Chống tạo pallet TRÙNG khi quét ĐỒNG THỜI (race read-then-insert ở scanQR/scanManual):
-- nhiều request cùng đọc "chưa có pallet" rồi cùng INSERT → nhiều InventoryEntry cùng pallet_code.
-- pallet_code = QR pallet VẬT LÝ → chỉ được tồn 1 lần ở trạng thái ĐANG TỒN.
-- scanQR (inboundController ~1016) & scanManual (~1140) ĐÃ bắt 23505 → trả 409 "đã tồn kho";
-- index này khiến 23505 THỰC SỰ bắn khi đua (trước đây không có unique nên insert trùng lọt hết).
-- Trạng thái active khớp bộ lọc dedup của scanQR: IN_STOCK/PARTIAL/QUARANTINE/LOOSE_PICKING.
-- (EXPORTED lịch sử vẫn cho trùng — pallet đã xuất, tái dùng mã ở chuyến sau là hợp lệ.)
-- CONCURRENTLY: không khoá bảng khi tạo (đang có user thao tác).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_inventory_active_pallet_code
ON "InventoryEntry" (pallet_code)
WHERE status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING');
