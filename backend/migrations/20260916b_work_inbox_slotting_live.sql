-- ============================================================================
-- 20260916b — Hộp việc: dòng "Sắp xếp kho" đếm VIỆC CÒN LÀM ĐƯỢC, không đếm n_lines đóng băng
-- ============================================================================
-- Đo staging 16/09 (Kho Ba Vì): Hộp việc giục "54 dòng chuyển pallet đang mở" trong khi trang kế hoạch
-- — vốn đã suy tiến độ SỐNG từ vị trí pallet (deriveLineStatuses) — chỉ còn 2 dòng làm được: 103/106
-- pallet đã xuất hết hoặc không còn bản ghi. Kế hoạch thứ hai: nói 3, thật 1. Hai màn của cùng một app
-- nói hai con số, và con số sai lại nằm ở chỗ GIAO VIỆC ⇒ người đi làm đi tìm 52 dòng hàng không còn.
-- Cùng lớp "kế hoạch tĩnh" đã vá ở Việc cần làm (14/09, hàng đợi sắp lại) và Fill hàng (15/09, bộ đối
-- chiếu); Slotting chưa có đường nào nói lại với Hộp việc.
-- Nay nhánh SLOTTING đếm dòng có ÍT NHẤT MỘT pallet còn sống chưa nằm ở vị trí đích — đúng định nghĩa
-- PENDING/PARTIAL của `deriveLineStatuses`; hết dòng làm được thì kế hoạch KHÔNG hiện trong Hộp việc
-- nữa (đóng kế hoạch vẫn là quyết định của người, máy chỉ thôi giục). Cùng chữ ký, CREATE OR REPLACE.
-- Chép từ 20260914d, sửa đúng một nhánh UNION.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.work_inbox(p_warehouse_ids text[], p_employee_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_rows  jsonb;
BEGIN
  WITH g AS (
    SELECT g.id, g.group_code, g.license_plate, g.warehouse_id, w.name AS wh_name,
           COALESCE(g.forklift_driver_ids, ARRAY[]::text[]) AS drivers, dk.row AS dock_name
      FROM public."GroupDeliveryOrder" g
      JOIN public."Warehouse" w  ON w.id = g.warehouse_id
      LEFT JOIN public."Location" dk ON dk.id = g.dock_location_id
     WHERE g.status IN ('IN_PROGRESS', 'PAUSED')
       AND (p_warehouse_ids IS NULL OR g.warehouse_id = ANY (p_warehouse_ids))
  ),
  t AS (
    SELECT t.*, g.drivers, g.wh_name, g.license_plate, g.group_code, g.dock_name,
           (t.needs_lower AND t.lowered_at IS NULL) AS waiting_lower,
           (t.claimed_by IS NOT NULL AND t.claimed_at > now() - interval '10 minutes') AS claim_active,
           NOT (t.kind = 'LOOSE_FEED' AND t.needs_lower) AS move_visible
      FROM public.wms_tasks t JOIN g ON g.id = t.gdo_id
     WHERE t.status = 'PENDING'
  ),
  my_trips AS (
    SELECT t.gdo_id, t.warehouse_id, t.wh_name, t.license_plate, t.group_code, t.dock_name,
           count(*) FILTER (WHERE t.move_visible AND t.moved_at IS NULL) AS n_move,
           count(*) FILTER (WHERE t.waiting_lower) AS n_wait
      FROM t WHERE p_employee_id = ANY (t.drivers)
     GROUP BY t.gdo_id, t.warehouse_id, t.wh_name, t.license_plate, t.group_code, t.dock_name
  ),
  rows_all AS (
    -- ── MINE ──
    SELECT 'MINE' AS zone, 'TRIP' AS source, m.gdo_id AS key, m.warehouse_id, m.wh_name,
           'Chuyến ' || COALESCE(m.group_code, m.license_plate) || COALESCE(' · ' || NULLIF(m.license_plate, m.group_code), '') || COALESCE(' · ' || m.dock_name, '') AS title,
           m.n_move || ' pallet cần đưa ra' || CASE WHEN m.n_wait > 0 THEN ' · ' || m.n_wait || ' đang chờ xe hạ' ELSE '' END AS sub,
           m.n_move::int AS n, '/wms/directed?tab=MOVE&trip=' || m.gdo_id AS link,
           'directed_work' AS pm, 'view' AS pa, false AS wv, NULL::text AS sub_wait
      FROM my_trips m WHERE m.n_move > 0
    UNION ALL
    SELECT 'MINE', 'CLAIM', 'claim:' || t.warehouse_id, t.warehouse_id, t.wh_name,
           'Đang cầm ' || count(*) || ' việc hạ',
           count(DISTINCT t.from_location_id) || ' vị trí — bấm ✓ Xong khi hạ xong, quá 10 phút việc tự nhả',
           count(*)::int, '/wms/directed?tab=LOWER', 'directed_work', 'confirm', false, NULL
      FROM t WHERE t.claim_active AND t.claimed_by = p_employee_id
     GROUP BY t.warehouse_id, t.wh_name
    UNION ALL
    SELECT 'MINE', 'FILL', 'fill:' || fo.id, ft.warehouse_id, w.name,
           'Lệnh fill ' || fo.order_code,
           count(*) || ' dòng hạ hàng nhặt lẻ giao cho bạn',
           count(*)::int, '/wms/fill/orders/' || fo.id, 'fill', 'execute', false, NULL
      FROM public."FillTask" ft
      JOIN public."FillOrder" fo ON fo.id = ft.fill_order_id
      JOIN public."Warehouse" w  ON w.id = ft.warehouse_id
     WHERE ft.status = 'PENDING' AND ft.assignee_id = p_employee_id
       AND (p_warehouse_ids IS NULL OR ft.warehouse_id = ANY (p_warehouse_ids))
     GROUP BY fo.id, fo.order_code, ft.warehouse_id, w.name
    -- ── SHARED ──
    UNION ALL
    SELECT 'SHARED', 'LOWER', 'lower:' || t.warehouse_id, t.warehouse_id, t.wh_name,
           'Cần hạ ' || count(*) || ' pallet',
           count(DISTINCT t.from_location_id) || ' vị trí · ' || count(DISTINCT t.gdo_id) || ' chuyến — chưa ai nhận',
           count(*)::int, '/wms/directed?tab=LOWER', 'directed_work', 'view', false, NULL
      FROM t WHERE t.waiting_lower AND NOT t.claim_active
     GROUP BY t.warehouse_id, t.wh_name
    UNION ALL
    SELECT 'SHARED', 'FILL_OPEN', 'fillopen:' || ft.warehouse_id, ft.warehouse_id, w.name,
           'Lệnh fill chưa ai nhận', count(*) || ' dòng hạ hàng nhặt lẻ',
           count(*)::int, '/wms/fill', 'fill', 'execute', false, NULL
      FROM public."FillTask" ft JOIN public."Warehouse" w ON w.id = ft.warehouse_id
     WHERE ft.status = 'PENDING' AND ft.assignee_id IS NULL
       AND (p_warehouse_ids IS NULL OR ft.warehouse_id = ANY (p_warehouse_ids))
     GROUP BY ft.warehouse_id, w.name
    UNION ALL
    SELECT 'SHARED', 'SLOTTING', 'slot:' || sp.id, sp.warehouse_id, w.name,
           'Sắp xếp kho: ' || sp.name, c.n_open || ' dòng chuyển pallet còn phải làm',
           c.n_open, '/wms/slotting/plans/' || sp.id, 'slotting', 'view', false, NULL
      FROM public."SlottingPlan" sp
      JOIN public."Warehouse" w ON w.id = sp.warehouse_id
      -- Dòng CÒN LÀM ĐƯỢC = còn ít nhất một pallet sống chưa đứng ở vị trí đích. Pallet đã xuất hết
      -- (cartons_remaining <= 0 / status EXPORTED) hoặc không còn bản ghi thì dòng đó hết việc.
      JOIN LATERAL (
        SELECT count(*)::int AS n_open
          FROM public."SlottingPlanLine" sl
         WHERE sl.plan_id = sp.id
           AND EXISTS (
                 SELECT 1
                   FROM jsonb_array_elements_text(COALESCE(sl.entry_ids, '[]'::jsonb)) x(eid)
                   JOIN public."InventoryEntry" ie ON ie.id = x.eid
                  WHERE COALESCE(ie.cartons_remaining, 0) > 0
                    AND COALESCE(ie.status, '') <> 'EXPORTED'
                    AND ie.location_id IS DISTINCT FROM sl.to_location_id)
      ) c ON c.n_open > 0
     WHERE sp.status = 'ACTIVE'
       AND (p_warehouse_ids IS NULL OR sp.warehouse_id = ANY (p_warehouse_ids))
    UNION ALL
    SELECT 'SHARED', 'TRANSFER', 'transfer:' || o.destination_warehouse_id, o.destination_warehouse_id, w.name,
           'Chuyển kho chờ nhận', count(*) || ' lệnh — kho nhận xác nhận trong app',
           count(*)::int, '/tms/bookings', 'tms_plan', 'confirm_receipt', false, NULL
      FROM public."TmsOrder" o JOIN public."Warehouse" w ON w.id = o.destination_warehouse_id
     WHERE o.status = 'PENDING' AND o.source_type = 'TRANSFER' AND o.delivery_mode = 'SCAN'
       AND COALESCE(o.plan_dropped, false) = false
       AND (p_warehouse_ids IS NULL OR o.destination_warehouse_id = ANY (p_warehouse_ids))
     GROUP BY o.destination_warehouse_id, w.name
    UNION ALL
    SELECT 'SHARED', 'DATE', 'date:' || x.warehouse_id, x.warehouse_id, x.wh_name,
           'Khai quy định date', count(*) || ' dòng hàng · ' || count(DISTINCT x.gdo_id) || ' chuyến tới ngày xuất — chưa khai thì không sinh việc',
           count(*)::int, '/wms/outbound/date-rules', 'outbound', 'set_date', true,
           count(*) || ' dòng hàng đang chờ người khác khai quy định date'
      FROM (
        SELECT gg.id AS gdo_id, gg.warehouse_id, w.name AS wh_name
          FROM public."GroupDeliveryOrder" gg
          JOIN public."Warehouse" w ON w.id = gg.warehouse_id
          JOIN public."OutboundDelivery" d ON d.gdo_id = gg.id
          JOIN public."OutboundItem" i ON i.do_id = d.id
         WHERE gg.status IN ('PENDING', 'IN_PROGRESS', 'PAUSED')
           AND (gg.delivery_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= v_today
           AND (p_warehouse_ids IS NULL OR gg.warehouse_id = ANY (p_warehouse_ids))
           AND i.date_rule IS NULL AND COALESCE(i.date_required, 0) <= 0
           AND COALESCE(i.cartons_ordered, 0) > COALESCE(i.cartons_scanned, 0)
      ) x
     GROUP BY x.warehouse_id, x.wh_name
    UNION ALL
    SELECT 'SHARED', 'RECONCILE', 'recon:' || gg.warehouse_id, gg.warehouse_id, w.name,
           'DO SAP cần xử lý', count(*) || ' thay đổi từ SAP chờ người quyết',
           count(*)::int, '/external?tab=reconcile', 'outbound', 'reconcile', false, NULL
      FROM public.reconcile_tasks rt
      JOIN public."GroupDeliveryOrder" gg ON gg.id = rt.gdo_id
      JOIN public."Warehouse" w ON w.id = gg.warehouse_id
     WHERE rt.status = 'OPEN'
       AND (p_warehouse_ids IS NULL OR gg.warehouse_id = ANY (p_warehouse_ids))
     GROUP BY gg.warehouse_id, w.name
    -- ── WAITING ──
    UNION ALL
    SELECT 'WAITING', 'TRIP_WAIT', 'wait:' || m.gdo_id, m.warehouse_id, m.wh_name,
           'Chuyến ' || COALESCE(m.group_code, m.license_plate) || COALESCE(' · ' || NULLIF(m.license_plate, m.group_code), '') || ': ' || m.n_wait || ' pallet chờ xe hạ',
           'xe hạ hạ xong thì việc tự sang bảng của bạn',
           m.n_wait::int, '/wms/directed?tab=MOVE&trip=' || m.gdo_id, 'directed_work', 'view', false, NULL
      FROM my_trips m WHERE m.n_wait > 0
    UNION ALL
    SELECT 'WAITING', 'OTHER_CLAIM', 'oc:' || t.warehouse_id || ':' || t.claimed_by, t.warehouse_id, t.wh_name,
           COALESCE(e.name, t.claimed_by) || ' đang cầm ' || count(*) || ' việc hạ',
           count(DISTINCT t.from_location_id) || ' vị trí',
           count(*)::int, '/wms/directed?tab=LOWER', 'directed_work', 'view', false, NULL
      FROM t LEFT JOIN public."Employee" e ON e.id = t.claimed_by
     WHERE t.claim_active AND t.claimed_by <> p_employee_id
     GROUP BY t.warehouse_id, t.wh_name, t.claimed_by, e.name
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY
           CASE r.zone WHEN 'MINE' THEN 0 WHEN 'SHARED' THEN 1 ELSE 2 END, r.wh_name, r.source, r.title), '[]'::jsonb)
    INTO v_rows
    FROM rows_all r;

  RETURN jsonb_build_object('rows', v_rows, 'today', v_today);
END;
$function$;
