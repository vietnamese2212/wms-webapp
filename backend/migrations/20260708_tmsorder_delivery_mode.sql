-- Xác nhận giao hàng (cờ delivery_confirmation): phân biệt luồng nhận hàng của booking chuyển kho.
--   SCAN (mặc định / NULL): kho nhận QR-QTY → luồng cũ (Bắt đầu nhận hàng → quét → Hoàn thành, tạo ProductionImport).
--   SELF: kho nhận NONE hoặc khách ngoài (OTHER) → KHÔNG có bước nhận-quét; tài xế TỰ HOÀN THÀNH
--         (chỉ đánh dấu đã giao: GDO.transfer_status=DELIVERED + TmsOrder.status=DONE, không tạo tồn/phiếu nhập).
ALTER TABLE "TmsOrder" ADD COLUMN IF NOT EXISTS delivery_mode text;
