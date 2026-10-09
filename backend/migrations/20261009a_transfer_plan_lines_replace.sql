-- 20261009a — Kế hoạch nhập của lệnh chuyển kho: THAY TRỌN trong MỘT giao dịch (error_logs 07–09/10: 8 lần
-- TRANSFER_PLAN_LINES_FAILED_RACE "duplicate key uq_inbound_plan_line_active_key").
--
-- Gốc: `maybeAutoCreateTransferOrder` nhánh SYNC (Bỏ hoàn thành → Hoàn thành lại / Đẩy lại cho kho nhận) chèn dòng MỚI
-- rồi mới xoá dòng CŨ (thứ tự 29/09 để một cú chèn hỏng không để lại lệnh "đã đẩy" mà không dòng). Nhưng khoá duy nhất
-- 20260929b là (ngày, kho, NCC, mã, lệnh): hoàn thành lại TRONG NGÀY ⇒ dòng mới trùng khoá với dòng cũ còn sống ⇒ chèn
-- hỏng ⇒ code giữ dòng cũ, kho nhận vẫn thấy SỐ CŨ dù kho xuất đã sửa đơn. Mã lỗi gắn đuôi _RACE "lượt sau tự đúng"
-- trong khi đây là lỗi TẤT ĐỊNH — gói 28 [3] chỉ đếm lệnh nên xanh suông từ 29/09.
--
-- Cách chữa: xoá cũ + chèn mới trong CÙNG giao dịch ⇒ không đụng khoá (xoá trước), hỏng ở đâu cũng lăn về nguyên trạng
-- (dòng cũ còn nguyên — đúng mục đích của thứ tự 29/09), và 2 request PostgREST còn 1.
BEGIN;

CREATE OR REPLACE FUNCTION public.transfer_plan_lines_replace(p_order_id uuid, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.inbound_plan_lines WHERE tms_order_id = p_order_id;
  INSERT INTO public.inbound_plan_lines
    (id, tms_order_id, date, warehouse_id, warehouse_type, material_id, planned_boxes, planned_pallets, status, created_at, updated_at)
  SELECT (r->>'id')::uuid, p_order_id, (r->>'date')::date, r->>'warehouse_id', r->>'warehouse_type', r->>'material_id',
         (r->>'planned_boxes')::numeric, NULL, 'ACTIVE', (r->>'created_at')::timestamptz, (r->>'updated_at')::timestamptz
  FROM jsonb_array_elements(p_rows) AS r;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

COMMIT;
