-- 20260726 — SỬA HỒI QUY của 20260725_upload_concurrency.sql
--
-- Index cũ `uq_tms_order_inbound_group` UNIQUE (date, warehouse_id, warehouse_type, vehicle_type, ncc_id)
-- WHERE direction='INBOUND' áp cho MỌI lệnh nhập → CHẶN OAN nghiệp vụ hợp lệ:
--   1 NCC giao 2 xe cùng ngày / cùng loại xe / cùng kho là chuyện thường ngày.
--   Bằng chứng (verify 26/07): tạo đơn tay thứ 2 → 409 "Mã đơn đã tồn tại" (thông báo còn sai nghĩa);
--   upload KH vận chuyển 2 lệnh cùng nhóm trong 1 file → 409, ghi được 0/2.
--
-- Mục đích BAN ĐẦU của index chỉ là: chống 2 người upload KH NHẬP đồng thời cùng tạo TRÙNG lệnh-nhóm
-- (luồng đó GỘP theo nhóm có chủ đích — findOrCreateTmsOrder). Vì vậy thu hẹp ràng buộc về đúng luồng ấy:
-- cột `plan_group_key` CHỈ được set khi luồng upload KH nhập tự tạo lệnh; lệnh tạo tay / upload KH vận
-- chuyển để NULL → không bị ràng buộc.

BEGIN;

DROP INDEX IF EXISTS uq_tms_order_inbound_group;

ALTER TABLE "TmsOrder" ADD COLUMN IF NOT EXISTS plan_group_key text;

COMMENT ON COLUMN "TmsOrder".plan_group_key IS
  'Khóa nhóm KH nhập (ngày||kho||loại kho||loại xe||NCC) — CHỈ set bởi luồng upload KH nhập để chống đua tạo trùng lệnh-nhóm. Lệnh tạo tay/KH vận chuyển = NULL (không ràng buộc).';

-- KHÔNG backfill lệnh cũ (cố ý): key chỉ cần cho việc TẠO MỚI. Lệnh đã tồn tại vẫn được tìm thấy
-- theo cột (date/kho/loại/loại xe/NCC) như trước; backfill sẽ chặn oan các nhóm cũ vốn có 2+ lệnh.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tms_order_plan_group
  ON "TmsOrder" (plan_group_key)
  WHERE plan_group_key IS NOT NULL AND status <> 'CANCELLED';

COMMIT;
