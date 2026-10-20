-- 20261020g — LỆNH CHUYỂN KHO KẾ THỪA ĐVVT CỦA CHUYẾN GỐC (user 20/10: "có chứ? đang không như thế à").
-- Từ bản vá cùng ngày, `maybeAutoCreateTransferOrder` ghi `ncc_id` = ĐVVT của lệnh VC cùng Số xe (source_type ≠ TRANSFER). Câu này điền
-- cho lệnh chuyển kho đã sinh TRƯỚC bản vá (để trống ⇒ ĐVVT nào cũng thấy / khai được). Không dò theo tên `GroupDeliveryOrder.dvvt`.
-- Idempotent (chỉ đụng dòng ncc_id còn trống). Staging 20/10: 0 dòng (63 lệnh SELF giả đã xoá theo user).
BEGIN;
UPDATE public."TmsOrder" t
   SET ncc_id = s.ncc_id, updated_at = now()
  FROM public."GroupDeliveryOrder" g
  JOIN public."TmsOrder" s
    ON s.order_code = g.group_code
   AND s.source_type IS DISTINCT FROM 'TRANSFER'
   AND s.ncc_id IS NOT NULL
 WHERE t.source_type = 'TRANSFER'
   AND t.transfer_gdo_id = g.id
   AND t.ncc_id IS NULL;
COMMIT;
