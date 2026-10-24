-- 20261024b — ĐẾM CHUYẾN KẸT CHO CẢNH BÁO (rà chuỗi điều vận 24/10). Cảnh báo "Chuyến trễ" (alertScanner R3) chỉ soi TRIP_LATE_DAYS ngày gần
-- (14) ⇒ chuyến kẹt lâu hơn tự BIẾN khỏi cảnh báo dù vẫn mở (đo staging: 64 chuyến ngày 02/10 chưa xuất, không cảnh báo nào). Và chuyến bán
-- hàng HOÀN THÀNH mà tài xế / ĐVVT chưa xác nhận "Đã giao" không ai nhắc (61 chuyến). Hàm trả SỐ theo kho (không kéo dòng về backend —
-- luật cap-1000): OLD_OPEN = chuyến mở có ngày xuất trước p_before · UNDELIVERED = hoàn thành trong [p_since, p_delivered_before) chưa ai
-- xác nhận đã giao (chỉ chuyến bán hàng có lệnh VC; chuyển kho đi đường kho nhận xác nhận).
BEGIN;

CREATE OR REPLACE FUNCTION public.trip_overdue_counts(p_before date, p_since timestamptz, p_delivered_before timestamptz)
RETURNS TABLE (warehouse_id text, kind text, n bigint, oldest text)
LANGUAGE sql
STABLE
AS $$
  SELECT g.warehouse_id::text, 'OLD_OPEN', count(*), min(g.delivery_date)::text
    FROM public."GroupDeliveryOrder" g
   WHERE g.status IN ('PENDING', 'IN_PROGRESS', 'PAUSED') AND coalesce(g.plan_dropped, false) = false AND coalesce(g.awaiting_sap, false) = false
     AND g.delivery_date < p_before
   GROUP BY g.warehouse_id
  UNION ALL
  SELECT g.warehouse_id::text, 'UNDELIVERED', count(*), min(g.completed_at)::text
    FROM public."GroupDeliveryOrder" g
   WHERE g.status = 'COMPLETED' AND g.transfer_status IS NULL AND coalesce(g.plan_dropped, false) = false
     AND g.completed_at >= p_since AND g.completed_at < p_delivered_before
     AND EXISTS (SELECT 1 FROM public."TmsOrder" o JOIN public."TmsVehicleSlot" s ON s.order_id = o.id WHERE o.order_code = g.group_code)
     AND NOT EXISTS (SELECT 1 FROM public."TmsOrder" o JOIN public."TmsVehicleSlot" s ON s.order_id = o.id WHERE o.order_code = g.group_code AND s.delivered_at IS NOT NULL)
   GROUP BY g.warehouse_id
$$;

COMMIT;
