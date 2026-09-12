-- ============================================================================
-- 20260912g — Việc cần làm đợt C: HỘP VIỆC theo NGƯỜI gom mọi nguồn + RPC GIÁM SÁT
-- ============================================================================
-- Rà theo vai 12/09 (plan docs/plans/DIRECTED_WORK_2_ROLE_UX_PLAN.md, user duyệt "Ok luôn đi"):
-- xe nâng còn lệnh Fill, dòng kế hoạch Slotting; thủ kho còn chuyến chuyển kho chờ nhận; NV SAP còn dòng
-- chưa khai quy định date và DO cần xử lý — mỗi thứ một trang, không trang nào nói "hôm nay bạn có N việc".
--
-- work_inbox(p_warehouse_ids, p_employee_id) → MỘT round-trip trả mọi nguồn việc dưới CÙNG một hình dạng
-- {zone, source, key, warehouse_id, wh_name, title, sub, n, link, pm, pa, wv, sub_wait}:
--   zone MINE    = giao đích danh (chuyến tôi là xe chuyển · việc tôi đang cầm · lệnh fill giao tôi)
--   zone SHARED  = việc chung của kho, ai có quyền cũng làm được (cần hạ · fill chưa ai nhận · sắp xếp kho ·
--                  chuyển kho chờ nhận · khai quy định date · DO SAP cần xử lý)
--   zone WAITING = đang chờ người khác (pallet chờ xe hạ của chuyến tôi · người khác đang cầm việc)
-- RPC KHÔNG biết quyền — trả `pm/pa` (module/action) để backend lọc theo quyền của người gọi; dòng có
-- `wv=true` (waiting variant) mà người gọi KHÔNG có quyền thì rơi vào WAITING với `sub_wait` (vd dòng chưa
-- khai date: người có set_date thấy ở SHARED để đi khai, xe nâng thấy ở WAITING "đang chờ người khác").
-- p_warehouse_ids NULL = mọi kho (backend chỉ truyền NULL cho phạm vi toàn quốc không chọn kho).
-- Ngày chuyến là timestamptz ⇒ so theo ngày VN bằng AT TIME ZONE (bẫy naive-utc-timestamp-rpc-trap).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.work_inbox(p_warehouse_ids text[], p_employee_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
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
           'Chuyến ' || COALESCE(m.license_plate, m.group_code) || COALESCE(' · ' || m.dock_name, '') AS title,
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
           'Sắp xếp kho: ' || sp.name, COALESCE(sp.n_lines, 0) || ' dòng chuyển pallet đang mở',
           COALESCE(sp.n_lines, 0)::int, '/wms/slotting/plans/' || sp.id, 'slotting', 'view', false, NULL
      FROM public."SlottingPlan" sp JOIN public."Warehouse" w ON w.id = sp.warehouse_id
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
           'Chuyến ' || COALESCE(m.license_plate, m.group_code) || ': ' || m.n_wait || ' pallet chờ xe hạ',
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
$$;

-- ============================================================================
-- directed_supervision(p_warehouse_id, p_days) — góc nhìn GIÁM SÁT (quyền directed_work.replan):
--   live      : chuyến đang chạy — còn bao nhiêu việc, bao nhiêu chờ hạ, chờ lâu nhất bao nhiêu phút, ai đang cầm
--   by_person : ai hạ / đưa ra / quét bao nhiêu trong p_days ngày (đọc *_by, là TÊN người ghi lúc bấm)
--   by_day    : xong vs bỏ vì "quét pallet khác" theo ngày ⇒ % LÀM ĐÚNG KẾ HOẠCH = done / (done + skipped_other)
--   lead_time : phút trung bình hạ → đưa ra, đưa ra → quét đủ
-- ============================================================================
CREATE OR REPLACE FUNCTION public.directed_supervision(p_warehouse_id text, p_days int DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(1, LEAST(p_days, 90)));
  v_live jsonb; v_person jsonb; v_day jsonb; v_lead jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'gdo_id', x.gdo_id, 'group_code', x.group_code, 'license_plate', x.license_plate, 'dock_name', x.dock_name,
           'started_at', x.started_at, 'pending', x.pending, 'waiting_lower', x.waiting_lower, 'done', x.done,
           'oldest_wait_min', x.oldest_wait_min, 'claimers', x.claimers, 'drivers', x.drivers
         ) ORDER BY x.oldest_wait_min DESC NULLS LAST, x.started_at), '[]'::jsonb)
    INTO v_live
    FROM (
      SELECT g.id AS gdo_id, g.group_code, g.license_plate, dk.row AS dock_name, g.started_at,
             g.forklift_driver_names AS drivers,
             count(*) FILTER (WHERE t.status = 'PENDING') AS pending,
             count(*) FILTER (WHERE t.status = 'PENDING' AND t.needs_lower AND t.lowered_at IS NULL) AS waiting_lower,
             count(*) FILTER (WHERE t.status = 'DONE') AS done,
             floor(extract(epoch FROM now() - min(t.created_at) FILTER (WHERE t.status = 'PENDING' AND t.needs_lower AND t.lowered_at IS NULL)) / 60)::int AS oldest_wait_min,
             (SELECT string_agg(DISTINCT COALESCE(e.name, tt.claimed_by), ', ')
                FROM public.wms_tasks tt LEFT JOIN public."Employee" e ON e.id = tt.claimed_by
               WHERE tt.gdo_id = g.id AND tt.status = 'PENDING' AND tt.claimed_by IS NOT NULL
                 AND tt.claimed_at > now() - interval '10 minutes') AS claimers
        FROM public."GroupDeliveryOrder" g
        LEFT JOIN public."Location" dk ON dk.id = g.dock_location_id
        JOIN public.wms_tasks t ON t.gdo_id = g.id
       WHERE g.warehouse_id = p_warehouse_id AND g.status IN ('IN_PROGRESS', 'PAUSED')
       GROUP BY g.id, g.group_code, g.license_plate, dk.row, g.started_at, g.forklift_driver_names
    ) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', p.name, 'lowered', p.lowered, 'moved', p.moved, 'done', p.done)
           ORDER BY (p.lowered + p.moved + p.done) DESC, p.name), '[]'::jsonb)
    INTO v_person
    FROM (
      SELECT name, sum(l) AS lowered, sum(m) AS moved, sum(d) AS done FROM (
        SELECT lowered_by AS name, 1 AS l, 0 AS m, 0 AS d FROM public.wms_tasks
         WHERE warehouse_id = p_warehouse_id AND lowered_at >= v_since AND lowered_by IS NOT NULL AND confirm_source = 'MANUAL'
        UNION ALL
        SELECT moved_by, 0, 1, 0 FROM public.wms_tasks
         WHERE warehouse_id = p_warehouse_id AND moved_at >= v_since AND moved_by IS NOT NULL AND confirm_source = 'MANUAL'
        UNION ALL
        SELECT done_by, 0, 0, 1 FROM public.wms_tasks
         WHERE warehouse_id = p_warehouse_id AND done_at >= v_since AND done_by IS NOT NULL
      ) u GROUP BY name
    ) p;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day', d.day, 'done', d.done, 'skipped_other', d.skipped_other,
           'adherence_pct', CASE WHEN d.done + d.skipped_other > 0 THEN round(100.0 * d.done / (d.done + d.skipped_other)) END
         ) ORDER BY d.day), '[]'::jsonb)
    INTO v_day
    FROM (
      SELECT (COALESCE(t.done_at, t.updated_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
             count(*) FILTER (WHERE t.status = 'DONE') AS done,
             count(*) FILTER (WHERE t.status = 'SKIPPED' AND t.skip_reason = 'OTHER_PALLET') AS skipped_other
        FROM public.wms_tasks t
       WHERE t.warehouse_id = p_warehouse_id AND COALESCE(t.done_at, t.updated_at) >= v_since
         AND (t.status = 'DONE' OR (t.status = 'SKIPPED' AND t.skip_reason = 'OTHER_PALLET'))
       GROUP BY 1
    ) d;

  SELECT jsonb_build_object(
           'lower_to_move_min', round(avg(extract(epoch FROM t.moved_at - t.lowered_at) / 60) FILTER (WHERE t.needs_lower AND t.lowered_at IS NOT NULL AND t.moved_at IS NOT NULL AND t.moved_at > t.lowered_at))::int,
           'move_to_scan_min',  round(avg(extract(epoch FROM t.done_at - t.moved_at) / 60) FILTER (WHERE t.moved_at IS NOT NULL AND t.done_at IS NOT NULL AND t.done_at > t.moved_at AND t.confirm_source = 'SCAN'))::int,
           'sample', count(*) FILTER (WHERE t.status = 'DONE')
         )
    INTO v_lead
    FROM public.wms_tasks t
   WHERE t.warehouse_id = p_warehouse_id AND COALESCE(t.done_at, t.updated_at) >= v_since;

  RETURN jsonb_build_object('live', v_live, 'by_person', v_person, 'by_day', v_day, 'lead_time', v_lead,
                            'since', v_since, 'days', GREATEST(1, LEAST(p_days, 90)));
END;
$$;
