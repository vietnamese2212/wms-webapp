-- Fix GDO bị stuck ở DELIVERED do code cũ (maybeCreateTransferInbound / confirmTransferReceipt cũ)
-- Áp dụng cho các GDO đã DELIVERED nhưng NPP chưa thực sự nhận hàng

-- 1. Hủy các ProductionImport OPEN (auto-tạo sai) cho GDO này
UPDATE "ProductionImport"
SET status = 'CANCELLED', updated_at = NOW()
WHERE from_gdo_id = (
  SELECT id FROM "GroupDeliveryOrder" WHERE group_code = 'BV_X_060626_01' LIMIT 1
)
AND status = 'OPEN';

-- 2. Reset GDO transfer_status về IN_TRANSIT (TmsOrder đã tồn tại)
--    Nếu TmsOrder chưa tồn tại thì đặt NULL — khi re-complete sẽ auto-tạo lại
UPDATE "GroupDeliveryOrder" g
SET transfer_status = CASE
  WHEN EXISTS (
    SELECT 1 FROM "TmsOrder" t
    WHERE t.transfer_gdo_id = g.id AND t.source_type = 'TRANSFER'
  ) THEN 'IN_TRANSIT'
  ELSE NULL
END,
updated_at = NOW()
WHERE group_code = 'BV_X_060626_01';

-- Verify
SELECT id, group_code, status, transfer_status
FROM "GroupDeliveryOrder"
WHERE group_code = 'BV_X_060626_01';
