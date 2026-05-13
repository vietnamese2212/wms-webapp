-- Thêm cột is_loose_picking vào OutboundScanEntry
-- Phân biệt scan từ chế độ nhặt lẻ vs xuất thường
ALTER TABLE "OutboundScanEntry"
ADD COLUMN IF NOT EXISTS is_loose_picking BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill dữ liệu cũ: nếu scan xảy ra TRƯỚC khi xe bắt đầu (started_at) thì là nhặt lẻ
UPDATE "OutboundScanEntry" se
SET is_loose_picking = TRUE
FROM "OutboundItem" oi
JOIN "OutboundDelivery" od ON od.id = oi.do_id
JOIN "GroupDeliveryOrder" gdo ON gdo.id = od.gdo_id
WHERE se.item_id = oi.id
  AND oi.loose_picking > 0
  AND (gdo.started_at IS NULL OR se.scanned_at < gdo.started_at);
