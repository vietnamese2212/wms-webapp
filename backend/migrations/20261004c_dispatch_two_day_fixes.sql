-- 04/10/2026 — bài giả lập HAI NGÀY (một nửa đơn kế hoạch 05/10, một nửa 06/10) lộ ba chỗ hai cửa cùng một sổ mà khác luật:
--
-- 1. BĂNG "QUÁ HẠN CHƯA QUYẾT" đếm cả đơn đang nằm trong một kế hoạch còn mở. Lập 06/10 khi nháp 05/10 còn mở: Ba Vì báo thêm 130 đơn,
--    Bàu Bàng 69 — đúng các đơn giao 21/09 đang trên xe nháp 05/10 (21/09 trong cửa sổ 14 ngày của 05/10, ngoài cửa sổ của 06/10).
--    Đơn đang nằm trong một kế hoạch mở (khung chờ hay trên xe) là đơn ĐANG CÓ NGƯỜI THẤY, không phải "chưa quyết" ⇒ loại.
--    Kèm: dấu hẹn có ngày đã QUA cửa sổ (hẹn tới ngày U mà U < ngày lập − 14) không còn đưa đơn về kế hoạch nào (loadCandidates chỉ
--    nhận hẹn có U ≥ ngày lập − 14) ⇒ đơn đó lại là "chưa quyết"; bản cũ loại mọi đơn có dấu hẹn nên đơn hẹn quá hạn rớt im lặng.
-- 2. "OD MỚI" (/sync, RPC dispatch_new_ods) KHÔNG đếm đơn hẹn tới hôm nay mà ngày giao đã quá cửa sổ, trong khi Nạp OD mới
--    (loadCandidates) có nhận ⇒ nút "Điều lại từ ngày này" của băng quá hạn đặt dấu xong thì bàn không bao giờ báo có đơn để nạp.
-- 3. DẤU TAY TOÀN KHO (Không điều · Không điều ngày này · Ngoài app) chỉ rút đơn khỏi kế hoạch đang bấm: đơn vẫn nằm khung chờ của
--    nháp ngày khác ⇒ bên đó ghép là đơn "Không điều" lên xe rồi vào Kế hoạch xuất. Cùng khuôn với "lên xe ở đâu thì rời khung chờ
--    nơi khác" (dispatch_od_leave_other_pools): dấu có hiệu lực với kế hoạch nào thì đơn rời khung chờ của kế hoạch đó. Đơn đang TRÊN
--    XE nháp khác thì cửa ghi (backend) trả 409 trước khi đặt dấu — rào này chỉ lo khung chờ.
BEGIN;

-- ── 1. Đơn quá cửa sổ chưa ai quyết ──
CREATE OR REPLACE FUNCTION public.dispatch_stale_ods(p_plant text, p_warehouse_id text, p_before date) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH od AS (
    SELECT e.od_number, min(e.delivery_date) AS dd, min(e.od_created_at) AS odc, min(e.ship_to_code) AS ship_to_code, min(e.ship_to_name) AS ship_to_name,
           sum(coalesce(e.sap_pallets, 0)) AS sap_pallets, bool_or(e.mat_doc IS NOT NULL OR coalesce(e.qty_issued_base, 0) > 0) AS sap_posted
      FROM public.erp_outbound_orders e
     WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL AND e.delivery_date < p_before
       AND e.flow IN ('SALE', 'STO', 'INTERNAL', 'PALLET')
       AND NOT EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.do_no = e.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE')
       AND NOT EXISTS (SELECT 1 FROM public.dispatch_od_outside x WHERE x.od_number = e.od_number AND x.warehouse_id = p_warehouse_id)
       -- dấu hẹn CÒN hiệu lực: Không điều (không ngày) · hẹn tới ngày còn trong cửa sổ hoặc sau đó
       AND NOT EXISTS (SELECT 1 FROM public.dispatch_od_hold h WHERE h.od_number = e.od_number AND h.warehouse_id = p_warehouse_id
                          AND (h.hold_until IS NULL OR h.hold_until >= p_before))
       -- đang nằm trong một kế hoạch mở của kho (khung chờ, hoặc xe chưa bỏ)
       AND NOT EXISTS (SELECT 1 FROM public.dispatch_trip_od o JOIN public.dispatch_plan p ON p.id = o.plan_id
                         LEFT JOIN public.dispatch_trip t ON t.id = o.trip_id
                        WHERE o.od_number = e.od_number AND p.warehouse_id = p_warehouse_id AND p.status IN ('DRAFT', 'TENDERED')
                          AND (o.trip_id IS NULL OR t.status <> 'DISCARDED'))
     GROUP BY e.od_number)
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM od),
    'rows', (SELECT coalesce(jsonb_agg(to_jsonb(od) ORDER BY od.dd, od.od_number), '[]'::jsonb) FROM (SELECT * FROM od ORDER BY dd, od_number LIMIT 500) od)
  )
$$;

-- ── 2. OD mới: thêm đơn HẸN tới hôm nay mà ngày giao đã quá cửa sổ (cùng luật loadCandidates: hẹn U với p_from ≤ U ≤ p_day) ──
CREATE OR REPLACE FUNCTION public.dispatch_new_ods(
  p_plant text, p_from date, p_to date, p_day date, p_slocs text[], p_warehouse_id text, p_plan_id uuid, p_segment text
) RETURNS text[]
LANGUAGE sql STABLE AS $$
  WITH due AS (
    SELECT h.od_number FROM public.dispatch_od_hold h
     WHERE h.warehouse_id = p_warehouse_id AND h.hold_until >= p_from AND h.hold_until <= p_day
  ), r0 AS (
    SELECT e.od_number, e.delivery_date, e.flow, e.material_code, e.ship_to_code, e.storage_location
      FROM public.erp_outbound_orders e
     WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL
       AND e.delivery_date >= p_from AND e.delivery_date <= p_to
    UNION ALL
    -- đơn hẹn tới hôm nay KHÔNG có dòng nào trong cửa sổ: cả đơn vào (loadCandidates nạp theo số OD, mọi ngày giao)
    SELECT e.od_number, e.delivery_date, e.flow, e.material_code, e.ship_to_code, e.storage_location
      FROM public.erp_outbound_orders e JOIN due d ON d.od_number = e.od_number
     WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM public.erp_outbound_orders w WHERE w.od_number = e.od_number AND w.plant = p_plant AND w.sync_status = 'ACTIVE'
                          AND w.delivery_date >= p_from AND w.delivery_date <= p_to)
  ), r AS (
    SELECT r0.od_number, r0.delivery_date, r0.flow, r0.material_code, r0.ship_to_code
      FROM r0
     WHERE (coalesce(cardinality(p_slocs), 0) = 0 OR r0.storage_location IS NULL OR upper(trim(r0.storage_location)) = ANY (p_slocs))
       AND (r0.delivery_date = p_day OR r0.flow IN ('SALE', 'STO', 'INTERNAL', 'PALLET'))
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

-- ── 3. Dấu tay toàn kho ⇒ đơn rời khung chờ của mọi kế hoạch mở cùng kho mà dấu có hiệu lực ──
-- Hẹn tới ngày U chỉ có hiệu lực với kế hoạch ngày < U (kế hoạch ngày ≥ U là nơi đơn được điều lại); Không điều / Ngoài app: mọi ngày.
CREATE OR REPLACE FUNCTION public.dispatch_od_mark_leave_pools() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  touched uuid[];
  -- đọc qua jsonb: trigger dùng chung hai bảng, dispatch_od_outside không có cột hold_until (NEW.hold_until sẽ lỗi ngay cả trong nhánh CASE)
  until_d date := (to_jsonb(NEW)->>'hold_until')::date;
BEGIN
  WITH gone AS (
    DELETE FROM public.dispatch_trip_od o
     USING public.dispatch_plan p
     WHERE o.plan_id = p.id AND o.trip_id IS NULL AND o.od_number = NEW.od_number
       AND p.warehouse_id = NEW.warehouse_id AND p.status IN ('DRAFT', 'TENDERED')
       AND (until_d IS NULL OR p.plan_date < until_d)
    RETURNING o.plan_id)
  SELECT array_agg(DISTINCT plan_id) INTO touched FROM gone;
  IF touched IS NOT NULL THEN
    UPDATE public.dispatch_plan p
       SET summary = jsonb_set(coalesce(p.summary, '{}'::jsonb), '{pool_ods}',
                               to_jsonb((SELECT count(DISTINCT o.od_number) FROM public.dispatch_trip_od o WHERE o.plan_id = p.id AND o.trip_id IS NULL)))
     WHERE p.id = ANY (touched);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_dispatch_od_hold_leave_pools ON public.dispatch_od_hold;
CREATE TRIGGER trg_dispatch_od_hold_leave_pools AFTER INSERT OR UPDATE OF hold_until, od_number, warehouse_id ON public.dispatch_od_hold
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_od_mark_leave_pools();
DROP TRIGGER IF EXISTS trg_dispatch_od_outside_leave_pools ON public.dispatch_od_outside;
CREATE TRIGGER trg_dispatch_od_outside_leave_pools AFTER INSERT OR UPDATE OF od_number, warehouse_id ON public.dispatch_od_outside
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_od_mark_leave_pools();

COMMIT;
