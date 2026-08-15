-- Index cho 2 cột KHOÁ NGOẠI của TmsOrder đang KHÔNG có index.
--
-- Postgres KHÔNG tự tạo index cho cột phía "con" của khoá ngoại. Thiếu index thì mỗi lần XOÁ /
-- UPDATE dòng phía "cha", Postgres phải QUÉT TOÀN BỘ bảng con để kiểm ràng buộc.
--
-- PHÁT HIỆN 28/07 (tình cờ khi dọn dữ liệu test): xoá 12.000 chuyến (`GroupDeliveryOrder`) bị
-- **statement timeout**, EXPLAIN chỉ ra `SELECT 1 FROM ONLY "TmsOrder" WHERE $1 = transfer_gdo_id
-- FOR KEY SHARE` — tức mỗi chuyến xoá là một lần quét 25.000 dòng TmsOrder.
--
-- ĐÂY LÀ ĐƯỜNG NGHIỆP VỤ THẬT, không phải chỉ chuyện dọn dữ liệu: "Bỏ hoàn thành" chuyến chuyển
-- kho có xoá chuyến kèm cascade xoá lệnh (memory outbound-transfer-all-modes). Với vài trăm nghìn
-- lệnh TmsOrder/năm, một cú xoá sẽ ngày càng lâu rồi timeout — mà người dùng chỉ thấy "không xoá
-- được", không có cách nào đoán ra nguyên nhân.
--
-- Cùng lý do cho `destination_warehouse_id` (đổi/xoá Kho phải quét bảng lệnh).

CREATE INDEX IF NOT EXISTS idx_tms_order_transfer_gdo
  ON "TmsOrder" (transfer_gdo_id) WHERE transfer_gdo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tms_order_dest_wh
  ON "TmsOrder" (destination_warehouse_id) WHERE destination_warehouse_id IS NOT NULL;
