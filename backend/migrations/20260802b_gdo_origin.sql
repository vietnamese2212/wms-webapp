-- NGUỒN GỐC CHUYẾN XUẤT (user chốt 02/08): Xuất/Nhặt lẻ là KẾT QUẢ DẪN XUẤT của
-- VL06O + Kế hoạch xuất — chuyến sinh từ 2 nguồn đó KHÓA sửa phần kế hoạch trên đơn
-- (SL/dòng hàng/ngày/kho/NPP), muốn đổi phải sửa Ở NGUỒN rồi hệ thống tự dội xuống.
-- Chuyến upload kiểu cũ / tạo tay / Xuất luôn GIỮ NGUYÊN sửa được (nhiều kho không làm SAP).
--
-- origin phân theo TỪNG CHUYẾN (không theo kho — cùng 1 kho có thể lẫn 2 loại):
--   'SAP'    = sinh từ uploadKhvc (join VL06O raw, item mang od_refs) → khóa phần kế hoạch
--   'EXCEL'  = upload KH xuất kiểu cũ (không có tầng raw)             → như cũ
--   'MANUAL' = tạo tay / Tạo & Xuất luôn                              → như cũ
--   'LEGACY' = dữ liệu trước migration không suy được nguồn           → như cũ (an toàn: không khóa oan)
ALTER TABLE "GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS origin text;

-- Backfill: chuyến có item mang od_refs (chỉ đường uploadKhvc ghi) = SAP; còn lại LEGACY.
UPDATE "GroupDeliveryOrder" g
   SET origin = CASE WHEN EXISTS (
         SELECT 1 FROM "OutboundDelivery" d
         JOIN "OutboundItem" i ON i.do_id = d.id
        WHERE d.gdo_id = g.id
          AND i.od_refs IS NOT NULL AND jsonb_array_length(i.od_refs) > 0
       ) THEN 'SAP' ELSE 'LEGACY' END
 WHERE origin IS NULL;
