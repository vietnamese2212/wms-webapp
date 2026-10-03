-- 03/10 (quota egress Supabase — user chốt ở lại plan hiện tại): cửa GET /tms/dispatch/plans/:id/sync chỉ cần đếm "có OD mới
-- chưa vào kế hoạch không" nhưng loadCandidates(countOnly) kéo CẢ cửa sổ 14 ngày ZSD02 của plant về backend (Ba Vì 9.094 dòng =
-- 4,0 MB JSON) rồi mới lọc trong JS; FE hỏi mỗi 120 s + sau mỗi lần kéo thả ⇒ 17.217 trang trong 5 ngày (≈ 7 GB). Đẩy phép lọc
-- xuống SQL, trả về CHỈ danh sách số OD mới (thường 0–50). Cùng luật với loadCandidates/splitPool:
--   cửa sổ [p_from, p_to] theo ngày giao · Sloc của kho · dòng của ngày (đúng ngày hoặc flow lên xe được) · OD có dòng lên xe được ·
--   mã hàng phải có trong Mã hàng (NO_MATERIAL) · chưa trong Kế hoạch xuất · không hoãn còn hiệu lực · không Ngoài app ·
--   không đang trên xe của nháp mở khác · chưa có trong chính kế hoạch này · không phải OD mới thay cho OD cũ đã điều (REDO_DISPATCHED).
BEGIN;
CREATE OR REPLACE FUNCTION public.dispatch_new_ods(
  p_plant text, p_from date, p_to date, p_day date, p_slocs text[], p_warehouse_id text, p_plan_id uuid
) RETURNS text[]
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT e.od_number, e.delivery_date, e.flow, e.material_code
      FROM public.erp_outbound_orders e
     WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL
       AND e.delivery_date >= p_from AND e.delivery_date <= p_to
       AND (coalesce(cardinality(p_slocs), 0) = 0 OR e.storage_location IS NULL OR upper(trim(e.storage_location)) = ANY (p_slocs))
       AND (e.delivery_date = p_day OR e.flow IN ('SALE', 'STO', 'INTERNAL', 'PALLET'))
  ), od AS (
    SELECT r.od_number,
           bool_or(r.flow IN ('SALE', 'STO', 'INTERNAL', 'PALLET')) AS loadable,
           bool_or(r.material_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public."Material" m WHERE m.material_code = r.material_code)) AS missing_mat
      FROM r GROUP BY r.od_number
  )
  SELECT coalesce(array_agg(od.od_number ORDER BY od.od_number), '{}'::text[])
    FROM od
   WHERE od.loadable AND NOT od.missing_mat
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
