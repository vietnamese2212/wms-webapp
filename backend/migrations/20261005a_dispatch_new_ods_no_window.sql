-- 05/10/2026 — BỎ CỬA SỔ 14 NGÀY của bàn điều vận (user chốt: "chỉ có trạng thái Đã đi · chưa đi Trung chuyển / Bán hàng · Không liên
-- quan · Không điều…"): đơn chưa có trong lịch sử app, không mang dấu tay, là CHƯA ĐI ⇒ tab Điều, mọi ngày giao tới ngày lập.
-- `dispatch_new_ods` (cửa /sync đếm "OD mới") phải cùng luật với `loadCandidates`: p_from NULL = không chặn dưới. Giữ nguyên chữ ký
-- 8 tham số (CREATE OR REPLACE, không DROP) để bản code cũ còn chạy trên Preview (truyền p_from = ngày lập − 14) không gãy lúc chuyển.
-- Nhánh "đơn hẹn tới hôm nay mà ngày giao quá cửa sổ" của 20261004c bỏ — không còn cửa sổ nên mọi đơn ngày giao ≤ ngày lập đều vào.
BEGIN;
CREATE OR REPLACE FUNCTION public.dispatch_new_ods(
  p_plant text, p_from date, p_to date, p_day date, p_slocs text[], p_warehouse_id text, p_plan_id uuid, p_segment text
) RETURNS text[]
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT e.od_number, e.delivery_date, e.flow, e.material_code, e.ship_to_code
      FROM public.erp_outbound_orders e
     WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL
       AND (p_from IS NULL OR e.delivery_date >= p_from) AND e.delivery_date <= p_to
       AND (coalesce(cardinality(p_slocs), 0) = 0 OR e.storage_location IS NULL OR upper(trim(e.storage_location)) = ANY (p_slocs))
       AND (e.delivery_date = p_day OR e.flow IN ('SALE', 'STO', 'INTERNAL', 'PALLET'))
  ), od AS (
    SELECT r.od_number, min(r.ship_to_code) AS ship_to_code,
           bool_or(r.flow IN ('SALE', 'STO', 'INTERNAL', 'PALLET')) AS loadable,
           bool_or(r.material_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public."Material" m WHERE m.material_code = r.material_code)) AS missing_mat
      FROM r GROUP BY r.od_number
  ), seg AS (
    SELECT od.od_number,
           coalesce(s.segment, CASE WHEN c.dispatch_transfer OR coalesce((lv.meta->>'dispatch_transfer')::boolean, false) THEN 'TRANSFER' ELSE 'SALES' END, 'SALES') AS segment
      FROM od
      LEFT JOIN public.dispatch_od_segment s ON s.warehouse_id = p_warehouse_id AND s.od_number = od.od_number
      LEFT JOIN public."Customer" c ON c.ship_to_code = od.ship_to_code
      LEFT JOIN public."LookupValue" lv ON lv.type = 'customer_channel' AND lv.value = c.channel
  )
  SELECT coalesce(array_agg(od.od_number ORDER BY od.od_number), '{}'::text[])
    FROM od JOIN seg ON seg.od_number = od.od_number
   WHERE od.loadable AND NOT od.missing_mat
     AND (p_segment IS NULL OR seg.segment = p_segment)
     AND NOT EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.do_no = od.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE')
     AND NOT EXISTS (SELECT 1 FROM public.dispatch_od_hold h WHERE h.warehouse_id = p_warehouse_id AND h.od_number = od.od_number
                        AND (h.hold_until IS NULL OR h.hold_until > p_day))
     AND NOT EXISTS (SELECT 1 FROM public.dispatch_od_outside x WHERE x.warehouse_id = p_warehouse_id AND x.od_number = od.od_number)
     AND NOT EXISTS (SELECT 1 FROM public.dispatch_trip_od o JOIN public.dispatch_plan p ON p.id = o.plan_id JOIN public.dispatch_trip t ON t.id = o.trip_id
                      WHERE o.od_number = od.od_number AND o.plan_id <> p_plan_id AND o.trip_id IS NOT NULL
                        AND p.status IN ('DRAFT', 'TENDERED') AND t.status <> 'DISCARDED')
     AND NOT EXISTS (SELECT 1 FROM public.dispatch_trip_od o WHERE o.plan_id = p_plan_id AND o.od_number = od.od_number)
     AND NOT EXISTS (SELECT 1 FROM public.erp_outbound_orders old JOIN public.khvc_lines k ON k.do_no = old.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE'
                      WHERE old.replaced_by_od = od.od_number)
$$;
COMMIT;
