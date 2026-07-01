-- Chống tạo pallet TRÙNG khi quét ĐỒNG THỜI (race read-then-insert ở scanQR/scanManual):
-- nhiều request cùng đọc "chưa có pallet" rồi cùng INSERT → nhiều InventoryEntry cùng pallet_code.
-- scanQR (~1016) & scanManual (~1140) ĐÃ bắt 23505 → 409 "đã tồn"; index này khiến 23505 THỰC SỰ bắn khi đua.
--
-- Unique theo (warehouse_id, pallet_code) — KHÔNG global, vì:
--   • Hàng QR: pallet_code = QR pallet vật lý, duy nhất trong 1 kho (scanQR nay set warehouse_id).
--   • Hàng no-QR (Loscam/POSM): pallet_code = MÃ HÀNG, 1 entry chung/kho → CÙNG mã ở NHIỀU kho là HỢP LỆ
--     → global unique sẽ chặn oan kho thứ 2. Composite (warehouse_id, pallet_code) cho phép.
-- NULLS NOT DISTINCT (PG15+): entry QR cũ warehouse_id null vẫn dedup theo pallet_code (QR vốn duy nhất toàn cục).
-- Chỉ áp trạng thái ĐANG TỒN (khớp bộ lọc dedup); EXPORTED lịch sử cho trùng (tái dùng mã chuyến sau).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_inventory_active_wh_pallet
ON "InventoryEntry" (warehouse_id, pallet_code) NULLS NOT DISTINCT
WHERE status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING');
