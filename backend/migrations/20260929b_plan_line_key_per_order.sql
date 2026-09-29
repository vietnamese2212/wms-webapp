-- 20260929b — Khoá duy nhất dòng Kế hoạch nhập phải tính THEO LỆNH (gói 28 [12c] bắt được 28/09 tối, xác nhận 29/09 sáng).
--
-- Chỉ mục `uq_inbound_plan_line_active_key` (20260725, chống đua upload) khoá (date, warehouse_id, ncc_id, material_id) cho MỌI
-- dòng sống ⇒ HAI lệnh chuyển kho cùng ngày, cùng kho nhận, cùng mã hàng (ncc NULL) — chuyện thường ngày: hai chuyến tới cùng
-- NPP chở cùng SKU — thì lệnh thứ hai KHÔNG ghi được dòng kế hoạch nhập, và code nuốt lỗi 23505 nên màn hình im lặng: kho nhận
-- thấy lệnh mà không thấy hàng. Cùng khuôn với `uq_tms_order_inbound_group` đã phải bỏ ngày 26/07 (1 NCC giao 2 xe cùng ngày).
-- Đo staging 29/09: 27/27 dòng kế hoạch nhập đều thuộc lệnh TRANSFER (chưa dòng NCC nào gắn lệnh) ⇒ đưa `tms_order_id` vào khoá:
-- dòng KHÔNG gắn lệnh (upload NCC) vẫn được gác y như cũ (NULLS NOT DISTINCT), dòng của hai lệnh khác nhau không còn đụng nhau.
BEGIN;
DROP INDEX IF EXISTS public.uq_inbound_plan_line_active_key;
CREATE UNIQUE INDEX uq_inbound_plan_line_active_key
  ON public.inbound_plan_lines (date, warehouse_id, ncc_id, material_id, tms_order_id) NULLS NOT DISTINCT
  WHERE status <> 'CANCELLED' AND material_id IS NOT NULL;
COMMIT;
