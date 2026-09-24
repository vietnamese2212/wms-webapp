-- ============================================================================
-- CUTOVER production 24/09/2026 — PART 7/10
-- 7 migration · 20260912g_work_inbox.sql → 20260913e_qa_ok_is_not_hold.sql
-- Dán TRỌN file vào Supabase SQL Editor của project PRODUCTION svicyfquresxaigfxsdb rồi Run.
-- Cả part nằm trong MỘT transaction: lỗi bất kỳ đâu = rollback trọn part, schema không dở dang.
-- Chạy lại lần hai sẽ báo "đã tồn tại" rồi tự rollback — không hỏng gì.
-- ============================================================================
BEGIN;


-- ─────────────────────────────────────────────────────────────────────────
-- [20260912g_work_inbox.sql]
-- ─────────────────────────────────────────────────────────────────────────
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



-- ─────────────────────────────────────────────────────────────────────────
-- [20260912h_directed_board_move_unlocked.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260912h — "Cần đưa ra" KHÔNG còn bị khoá bởi bước xác nhận hạ
-- ============================================================================
-- User 12/09: "Cần hạ KHÔNG bắt buộc phải thao tác xác nhận đã hạ. Cần đưa ra thể hiện nội dung
-- cần đưa ra chứ không phải chỉ mỗi cái mà cần-hạ đã xác nhận."
--
-- Trước bản này bảng của XE CHUYỂN tự khoá tay chính mình theo hai cách:
--   1. `can_confirm = … AND (p_mode <> 'MOVE' OR NOT waiting_lower …)` ⇒ mọi việc còn trên kệ mà
--      chưa ai bấm "đã hạ" thì KHÔNG có nút nào. Bấm xác nhận hạ là việc TUỲ NGHI (xe nâng đeo găng,
--      đứng trên xe, hạ xong đi luôn) nên trong thực tế bảng Cần đưa ra đứng im cả ca.
--      Cùng khuôn lỗi với 20260910f, chỉ khác chỗ khoá: lần đó khoá tab Cần hạ, lần này khoá tab kia.
--   2. Bộ lọc MOVE loại hẳn `LOOSE_FEED AND needs_lower` ⇒ việc "hạ xuống rồi đưa về vị trí nhặt lẻ"
--      chỉ sống ở tab Cần hạ. Đó VẪN là việc đưa hàng đi một chỗ khác, tức việc của xe chuyển.
--
-- Nay: MOVE hiện MỌI việc của kho; dòng còn trên kệ mang cờ `combined_lower` (bất kể kho có xe hạ
-- riêng hay không) ⇒ FE hiện một nút "Hạ & đưa ra" gửi stage BOTH, ghi CẢ HAI mốc trong một lần bấm.
-- Ai muốn tách vai thì vẫn có tab Cần hạ; ai không bấm cũng không chặn ai.
-- Gọi `move_pallets_to_location` hai lần cho cùng pallet + cùng ô là VÔ HẠI: phép đếm sức chứa của
-- RPC đó loại chính `p_ids` ra khỏi số đang dùng (20260815k), nên lần hai không bao giờ 'FULL'.
--
-- Kèm theo: trả thêm `materials` [{id, code}] để bảng có nút TRA TỒN KHO theo mã (user 12/09:
-- "cần có nút kiểm tra được tồn kho, vị trí tương tự như bên Chuẩn bị hàng"). Phải là CẶP id+mã
-- dựng trong cùng một object — hai mảng `jsonb_agg(DISTINCT …)` rời nhau KHÔNG bảo đảm cùng thứ tự,
-- ghép theo chỉ số là tra nhầm mã lúc một ô có nhiều mã.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.directed_board(
  p_warehouse_id text,
  p_mode         text,
  p_gdo_id       text DEFAULT NULL,
  p_driver_id    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_rows   jsonb;
  v_tot    jsonb;
  v_alerts jsonb;
  v_sep    boolean;
BEGIN
  SELECT COALESCE(w.separate_lowering_forklift, true) INTO v_sep
    FROM public."Warehouse" w WHERE w.id = p_warehouse_id;
  v_sep := COALESCE(v_sep, true);

  WITH base AS (
    SELECT t.*,
           g.group_code, g.license_plate, g.status AS gdo_status, g.started_at,
           g.delivery_date,
           g.forklift_driver_ids, g.dock_location_id AS gdo_dock_id,
           fl.location_code AS from_code,
           dl.location_code AS drop_code, dl.row AS drop_name,
           tl.location_code AS to_code,   tl.row AS to_name,
           dk.row           AS dock_name,
           m.short_name     AS material_name,
           m.units_per_carton, m.entry_unit, m.base_unit,
           ce.name          AS claimed_by_name,
           CASE
             WHEN t.lowered_at IS NULL           THEN fl.location_code
             WHEN t.kind = 'LOOSE_FEED'          THEN tl.location_code
             ELSE COALESCE(dl.location_code, fl.location_code)
           END AS current_code,
           (t.needs_lower AND t.lowered_at IS NULL AND t.status = 'PENDING') AS waiting_lower,
           (t.status = 'SKIPPED') AS skipped,
           -- Khoá mềm 10 phút: quá hạn coi như không ai giữ
           (t.status = 'PENDING' AND t.claimed_by IS NOT NULL
              AND t.claimed_at > now() - interval '10 minutes') AS claim_active
      FROM public.wms_tasks t
      JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
      LEFT JOIN public."Location" fl ON fl.id = t.from_location_id
      LEFT JOIN public."Location" dl ON dl.id = t.drop_location_id
      LEFT JOIN public."Location" tl ON tl.id = t.to_location_id
      LEFT JOIN public."Location" dk ON dk.id = g.dock_location_id
      LEFT JOIN public."Material"  m  ON m.id  = t.material_id
      LEFT JOIN public."Employee"  ce ON ce.id = t.claimed_by
     WHERE t.warehouse_id = p_warehouse_id
       AND t.status IN ('PENDING', 'DONE', 'SKIPPED')
       AND g.status IN ('IN_PROGRESS', 'PAUSED')
       AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id)
  ),
  gdo_flag AS (
    SELECT gdo_id,
           bool_and(NOT (status = 'PENDING' AND NOT waiting_lower)) AS truck_idle
      FROM base WHERE NOT skipped GROUP BY gdo_id
  ),
  filtered AS (
    SELECT b.*, COALESCE(f.truck_idle, false) AS truck_idle
      FROM base b LEFT JOIN gdo_flag f ON f.gdo_id = b.gdo_id
     -- LOWER = riêng việc phải hạ. MOVE = TOÀN BỘ việc phải mang đi đâu đó (kể cả việc về vị trí
     -- nhặt lẻ còn trên kệ) — bảng của xe chuyển phải nói hết phần việc, không lọc theo việc người
     -- khác đã bấm hay chưa.
     WHERE CASE p_mode WHEN 'LOWER' THEN b.needs_lower ELSE true END
       AND (p_driver_id IS NULL OR p_driver_id = ANY (COALESCE(b.forklift_driver_ids, ARRAY[]::text[])))
  ),
  grouped AS (
    SELECT
      CASE WHEN p_mode = 'SCAN' THEN t.id
           ELSE t.gdo_id || '|' || COALESCE(t.current_code, '?') || '|' || COALESCE(t.to_code, '?') || '|' || t.kind
                || CASE WHEN t.skipped THEN '|S' ELSE '' END
      END                                        AS group_key,
      min(t.seq)                                 AS seq,
      jsonb_agg(t.id ORDER BY t.seq)             AS task_ids,
      count(*)                                   AS n_pallets,
      sum(t.qty_base)                            AS qty_base,
      bool_or(t.is_partial)                      AS is_partial,
      min(t.units_per_carton)                    AS units_per_carton,
      min(t.entry_unit)                          AS entry_unit,
      min(t.base_unit)                           AS base_unit,
      min(t.gdo_id)                              AS gdo_id,
      min(t.group_code)                          AS group_code,
      min(t.license_plate)                       AS license_plate,
      min(t.started_at)                          AS started_at,
      min(t.delivery_date)                       AS delivery_date,
      min(t.dock_name)                           AS dock_name,
      min(t.kind)                                AS kind,
      min(t.current_code)                        AS current_code,
      min(t.from_code)                           AS from_code,
      max(t.level_no)                            AS level_no,
      min(t.to_code)                             AS to_code,
      min(t.to_name)                             AS to_name,
      min(t.drop_name)                           AS drop_name,
      min(t.dist_cells)                          AS dist_cells,
      bool_or(t.needs_lower)                     AS needs_lower,
      bool_or(t.waiting_lower)                   AS waiting_lower,
      bool_or(t.truck_idle)                      AS truck_idle,
      bool_or(t.skipped)                         AS skipped,
      min(t.skip_reason)                         AS skip_reason,
      bool_or(t.claim_active)                    AS claim_active,
      min(t.claimed_by)      FILTER (WHERE t.claim_active) AS claimed_by,
      min(t.claimed_by_name) FILTER (WHERE t.claim_active) AS claimed_by_name,
      bool_and(t.status = 'DONE' OR CASE p_mode WHEN 'LOWER' THEN t.lowered_at IS NOT NULL
                                                WHEN 'MOVE'  THEN t.moved_at   IS NOT NULL
                                                ELSE t.done_at IS NOT NULL END) AS stage_done,
      bool_and(t.status = 'DONE')                AS all_scanned,
      max(COALESCE(t.done_at, t.moved_at, t.lowered_at, t.updated_at)) AS last_at,
      min(t.lowered_by)                          AS lowered_by,
      min(t.moved_by)                            AS moved_by,
      jsonb_agg(DISTINCT t.material_code)        AS material_codes,
      jsonb_agg(DISTINCT jsonb_build_object('id', t.material_id, 'code', t.material_code))
        FILTER (WHERE t.material_id IS NOT NULL) AS materials,
      min(t.material_name)                       AS material_name,
      jsonb_agg(DISTINCT t.pallet_code)          AS pallet_codes
      FROM filtered t
     GROUP BY 1
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'group_key',      g.group_key,
      'task_ids',       g.task_ids,
      'seq',            g.seq,
      'gdo_id',         g.gdo_id,
      'group_code',     g.group_code,
      'license_plate',  g.license_plate,
      'started_at',     g.started_at,
      'delivery_date',  g.delivery_date,
      'dock_name',      g.dock_name,
      'kind',           g.kind,
      'current_code',   g.current_code,
      'from_code',      g.from_code,
      'level_no',       g.level_no,
      'to_code',        g.to_code,
      'to_name',        g.to_name,
      'drop_name',      g.drop_name,
      'dist_cells',     g.dist_cells,
      'n_pallets',      g.n_pallets,
      'qty_base',       g.qty_base,
      'is_partial',     g.is_partial,
      'units_per_carton', g.units_per_carton,
      'entry_unit',     g.entry_unit,
      'base_unit',      g.base_unit,
      'material_codes', g.material_codes,
      'materials',      COALESCE(g.materials, '[]'::jsonb),
      'material_name',  g.material_name,
      'pallet_codes',   g.pallet_codes,
      'needs_lower',    g.needs_lower,
      'waiting_lower',  g.waiting_lower,
      'skipped',        g.skipped,
      'skip_reason',    g.skip_reason,
      'claim_active',   g.claim_active,
      'claimed_by',     g.claimed_by,
      'claimed_by_name', g.claimed_by_name,
      'stage_done',     g.stage_done,
      'all_scanned',    g.all_scanned,
      'last_at',        g.last_at,
      'done_by_name',   COALESCE(g.moved_by, g.lowered_by),
      -- Việc còn trên kệ nhìn từ bảng XE CHUYỂN = MỘT nút "Hạ & đưa ra" (stage BOTH). Không còn phụ
      -- thuộc `separate_lowering_forklift`: cờ đó chỉ còn quyết định có HIỆN tab Cần hạ hay không.
      'combined_lower', (p_mode = 'MOVE' AND g.waiting_lower),
      -- Không tự khoá tay ai nữa: việc chưa xong và chưa bị bỏ thì bấm được, ở cả ba bảng.
      'can_confirm',    (NOT g.stage_done) AND (NOT g.skipped)
    ) ORDER BY
        (g.stage_done OR g.skipped),
        g.skipped,
        CASE WHEN p_mode = 'LOWER' THEN (NOT g.truck_idle)::int ELSE 0 END,
        g.started_at,
        CASE WHEN p_mode = 'LOWER' THEN g.dist_cells END NULLS LAST,
        CASE WHEN p_mode = 'LOWER' THEN -g.level_no END,
        g.seq
    ), '[]'::jsonb)
    INTO v_rows
    FROM grouped g;

  SELECT jsonb_build_object(
           'pending',   count(*) FILTER (WHERE t.status = 'PENDING'),
           'done',      count(*) FILTER (WHERE t.status = 'DONE'),
           'skipped',   count(*) FILTER (WHERE t.status = 'SKIPPED'),
           'to_lower',  count(*) FILTER (WHERE t.status = 'PENDING' AND t.needs_lower AND t.lowered_at IS NULL),
           'to_move',   count(*) FILTER (WHERE t.status = 'PENDING' AND t.moved_at IS NULL),
           'trips',     count(DISTINCT t.gdo_id) FILTER (WHERE t.status <> 'SKIPPED')
         )
    INTO v_tot
    FROM public.wms_tasks t
    JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
   WHERE t.warehouse_id = p_warehouse_id AND t.status IN ('PENDING', 'DONE', 'SKIPPED')
     AND g.status IN ('IN_PROGRESS', 'PAUSED')
     AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'gdo_id', x.gdo_id, 'group_code', x.group_code, 'item_id', x.item_id,
           'material_code', x.material_code_raw, 'remaining', x.remaining, 'note', x.header_text,
           'delivery_date', x.delivery_date
         ) ORDER BY x.group_code, x.material_code_raw), '[]'::jsonb)
    INTO v_alerts
    FROM (
      SELECT g.id AS gdo_id, g.group_code, g.delivery_date, i.id AS item_id, i.material_code_raw, i.header_text,
             (COALESCE(i.cartons_ordered, 0) - COALESCE(i.cartons_scanned, 0)) AS remaining
        FROM public."GroupDeliveryOrder" g
        JOIN public."OutboundDelivery"   d ON d.gdo_id = g.id
        JOIN public."OutboundItem"       i ON i.do_id  = d.id
       WHERE g.warehouse_id = p_warehouse_id
         AND g.status IN ('IN_PROGRESS', 'PAUSED')
         AND (p_gdo_id IS NULL OR g.id = p_gdo_id)
         AND i.date_rule IS NULL
         AND COALESCE(i.date_required, 0) <= 0
         AND COALESCE(i.cartons_ordered, 0) > COALESCE(i.cartons_scanned, 0)
    ) x;

  RETURN jsonb_build_object(
    'rows', v_rows, 'totals', v_tot, 'unset_items', v_alerts,
    'settings', jsonb_build_object('separate_lowering_forklift', v_sep)
  );
END;
$$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260913_admin_ip_pairs.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260913 — Cảnh báo ADMIN_NEW_IP đang MÙ vì trần 1.000 dòng của PostgREST
-- ============================================================================
-- Luật `ruleAdminNewIp` kéo `auth_login_events` về Node rồi tự dựng tập (email|ip) bằng vòng lặp:
--     .select('email, ip, created_at')…gte('created_at', memory).order('created_at').limit(5000)
-- `.limit(5000)` KHÔNG vượt được trần ~1.000 dòng/response của PostgREST (luật cốt tử trong
-- CLAUDE.md) ⇒ chỉ nhận về 1.000 dòng CŨ NHẤT trong cửa sổ 30 ngày.
--
-- Đo thật trên staging 13/09 lúc 02:48: xin 5.000 → trả 1.000, dòng mới nhất trong kết quả là
-- 15:53 hôm trước ⇒ **11 giờ đăng nhập gần nhất VÔ HÌNH với luật**. Mà "IP lạ" hoàn toàn là
-- chuyện của dòng MỚI ⇒ cảnh báo im lặng đúng lúc cần kêu, và càng đông người dùng càng mù thêm.
-- Bằng chứng lặp lại: gói QA 45 XANH ở lượt full đầu (sổ còn <1.000 dòng) rồi ĐỎ ở lượt thứ hai
-- vài giờ sau (sổ vượt 1.000). Dựng lại ngoài gói QA cũng không sinh cảnh báo.
--
-- Gốc rễ theo đúng CLAUDE.md: **đừng KÉO DÒNG để tính ra một TẬP** — cần "khoá nào có mặt" thì
-- hỏi DB trả DISTINCT. Hàm dưới gom theo (email, ip) và trả về đúng thứ luật cần, nên số dòng
-- bị chặn bởi SỐ CẶP chứ không bởi số lượt đăng nhập: vài chục dòng thay vì hàng vạn, đứng xa
-- trần mãi mãi. Chạy mỗi 10 phút nên cũng nhẹ hơn hẳn.
--
-- RPC mới tự đóng (default privileges đã tắt PUBLIC từ 20260902d) — backend đi service_role.
-- ============================================================================
-- [cutover] gỡ: BEGIN;

CREATE OR REPLACE FUNCTION public.admin_login_ip_pairs(
  p_emails text[],
  p_memory timestamptz,   -- chỉ xét đăng nhập từ mốc này trở lại đây (cửa sổ ghi nhớ IP)
  p_recent timestamptz    -- ranh giới "cũ" ↔ "mới" (thường = 24h trước)
)
RETURNS TABLE (email text, ip text, has_old boolean, has_new boolean, first_new_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(e.email)                                              AS email,
         e.ip                                                        AS ip,
         bool_or(e.created_at <  p_recent)                           AS has_old,
         bool_or(e.created_at >= p_recent)                           AS has_new,
         min(e.created_at) FILTER (WHERE e.created_at >= p_recent)    AS first_new_at
    FROM public.auth_login_events e
   WHERE e.ok IS TRUE
     AND e.reason IS NULL
     AND e.ip IS NOT NULL
     AND e.created_at >= p_memory
     AND lower(e.email) = ANY (SELECT lower(x) FROM unnest(p_emails) AS x)
   GROUP BY lower(e.email), e.ip
$$;

COMMENT ON FUNCTION public.admin_login_ip_pairs IS
  'Cặp (email quản trị, IP) trong cửa sổ ghi nhớ, kèm cờ đã-thấy-trước-mốc / mới-sau-mốc. '
  'Trả TẬP chứ không trả dòng thô: luật ADMIN_NEW_IP từng mù vì kéo dòng rồi dính trần 1.000 của PostgREST.';

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260913b_directed_board_context.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260913b — "Việc cần làm" phải TRẢ LỜI ĐƯỢC TẠI CHỖ, không bắt đi tra nơi khác
-- ============================================================================
-- User 13/09: "Nó chính là nơi giao MỌI việc cho user … nơi mà user có thể check được các thông
-- tin liên quan TẠI ĐÓ khi làm việc ở đó."
--
-- Bảng đang nói: đi tới ô nào · lấy mấy pallet · mã gì · đưa tới đâu. Ba câu hỏi người đứng giữa
-- kho phải hỏi thêm thì màn hình IM LẶNG:
--
--   1. "LẤY PALLET NÀO?" — bảng xe nâng gom theo VỊ TRÍ nên chỉ nói "1 pallet mã X". Đo staging
--      13/09 trên 18 việc đang chờ: **16/18 ô còn NHIỀU pallet cùng mã** (ô nhiều nhất 13 pallet)
--      và **8/18 ca các pallet đó KHÁC NGÀY SẢN XUẤT**. Kế hoạch đã ghim đúng pallet theo luật luân
--      chuyển + quy định date, nhưng người đi lấy không nhìn thấy cái ghim đó ⇒ lấy pallet mặt
--      ngoài là chuyện bình thường, việc bị SKIPPED 'OTHER_PALLET', và chính chỉ số "% làm đúng kế
--      hoạch" của khối Giám sát tụt xuống vì màn hình không cấp đủ dữ kiện để làm đúng.
--      `pallet_code` ĐÃ có trong payload từ đầu — chỉ chưa ai đưa ra ngoài bảng.
--   2. "ĐÚNG DATE CHƯA?" — cả yêu cầu (`OutboundItem.date_rule`: FEFO · ≥ 60 % · còn ≥ 35 ngày) lẫn
--      date THẬT của pallet (NSX/HSD) đều không có trên màn. Đây là toàn bộ lý do tồn tại của
--      Quy định date: chốt xong rồi mà người thực hiện không đọc được thì mức chốt chỉ sống trong DB.
--   3. "GIAO CHO AI, CHUYẾN NÀY CÒN BAO NHIÊU?" — NPP, số DO, tiến độ dòng hàng không có mặt; bảng
--      chỉ có biển số + cửa. Đo 13/09: 6 chuyến đang chạy đều có NPP thật (Hoàng Oanh · An Tiến
--      Phát · Tân Phú …) nằm sẵn trong DB.
--
-- ⚠️ %Date/HSD KHÔNG tính trong SQL. Luật một nguồn (`utils/shelfLife.ts`, BE⇄FE mirror) — RPC chỉ
-- trả NGUYÊN LIỆU THÔ (NSX · HSD tem · shelflife của lô · NCC · shelflife + ngoại lệ NCC của mã) để
-- FE gọi `computePctDate`. Chép công thức xuống SQL là đúng khuôn `rotation_rule_hand_rolled` /
-- `date_rule_hand_rolled` mà dự án đã dựng ratchet để cấm. Đo thật: 0/19.527 pallet tồn có
-- `shelf_life_days` hay `expiry_date` riêng ⇒ %Date thực tế đi đường NSX + shelflife của mã.
--
-- KHÔNG đổi chữ ký hàm (cùng tên + cùng tên/kiểu tham số) ⇒ CREATE OR REPLACE thay tại chỗ, không
-- sinh bản nạp chồng (bẫy `rpc-overload-silent-fallback`). Mọi khoá cũ giữ nguyên; chỉ THÊM khoá mới.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.directed_board(
  p_warehouse_id text,
  p_mode         text,
  p_gdo_id       text DEFAULT NULL,
  p_driver_id    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_rows   jsonb;
  v_tot    jsonb;
  v_alerts jsonb;
  v_trips  jsonb;
  v_sep    boolean;
BEGIN
  SELECT COALESCE(w.separate_lowering_forklift, true) INTO v_sep
    FROM public."Warehouse" w WHERE w.id = p_warehouse_id;
  v_sep := COALESCE(v_sep, true);

  WITH base AS (
    SELECT t.*,
           g.group_code, g.license_plate, g.status AS gdo_status, g.started_at,
           g.delivery_date,
           g.forklift_driver_ids, g.dock_location_id AS gdo_dock_id,
           fl.location_code AS from_code,
           dl.location_code AS drop_code, dl.row AS drop_name,
           tl.location_code AS to_code,   tl.row AS to_name,
           dk.row           AS dock_name,
           m.short_name     AS material_name,
           m.units_per_carton, m.entry_unit, m.base_unit,
           -- NGUYÊN LIỆU THÔ cho %Date (FE tính bằng computePctDate — xem đầu file)
           m.shelf_life_days              AS mat_shelf_days,
           m.supplier_shelf_life_overrides AS mat_overrides,
           ie.production_date, ie.expiry_date,
           ie.shelf_life_days AS entry_shelf_days,
           ie.ncc_id,
           -- YÊU CẦU của dòng đơn + NƠI NHẬN (câu hỏi 2 và 3 ở đầu file)
           oi.date_rule, oi.date_required, oi.header_text,
           od.distributor_name, od.delivery_code,
           ce.name          AS claimed_by_name,
           CASE
             WHEN t.lowered_at IS NULL           THEN fl.location_code
             WHEN t.kind = 'LOOSE_FEED'          THEN tl.location_code
             ELSE COALESCE(dl.location_code, fl.location_code)
           END AS current_code,
           (t.needs_lower AND t.lowered_at IS NULL AND t.status = 'PENDING') AS waiting_lower,
           (t.status = 'SKIPPED') AS skipped,
           -- Khoá mềm 10 phút: quá hạn coi như không ai giữ
           (t.status = 'PENDING' AND t.claimed_by IS NOT NULL
              AND t.claimed_at > now() - interval '10 minutes') AS claim_active
      FROM public.wms_tasks t
      JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
      LEFT JOIN public."Location" fl ON fl.id = t.from_location_id
      LEFT JOIN public."Location" dl ON dl.id = t.drop_location_id
      LEFT JOIN public."Location" tl ON tl.id = t.to_location_id
      LEFT JOIN public."Location" dk ON dk.id = g.dock_location_id
      LEFT JOIN public."Material"  m  ON m.id  = t.material_id
      -- entry_id là ON DELETE SET NULL ⇒ LEFT JOIN; pallet đã bị xoá thì chỉ mất phần date, dòng việc vẫn hiện
      LEFT JOIN public."InventoryEntry"   ie ON ie.id = t.entry_id
      LEFT JOIN public."OutboundItem"     oi ON oi.id = t.item_id
      LEFT JOIN public."OutboundDelivery" od ON od.id = oi.do_id
      LEFT JOIN public."Employee"  ce ON ce.id = t.claimed_by
     WHERE t.warehouse_id = p_warehouse_id
       AND t.status IN ('PENDING', 'DONE', 'SKIPPED')
       AND g.status IN ('IN_PROGRESS', 'PAUSED')
       AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id)
  ),
  gdo_flag AS (
    SELECT gdo_id,
           bool_and(NOT (status = 'PENDING' AND NOT waiting_lower)) AS truck_idle
      FROM base WHERE NOT skipped GROUP BY gdo_id
  ),
  filtered AS (
    SELECT b.*, COALESCE(f.truck_idle, false) AS truck_idle
      FROM base b LEFT JOIN gdo_flag f ON f.gdo_id = b.gdo_id
     -- LOWER = riêng việc phải hạ. MOVE = TOÀN BỘ việc phải mang đi đâu đó (kể cả việc về vị trí
     -- nhặt lẻ còn trên kệ) — bảng của xe chuyển phải nói hết phần việc, không lọc theo việc người
     -- khác đã bấm hay chưa.
     WHERE CASE p_mode WHEN 'LOWER' THEN b.needs_lower ELSE true END
       AND (p_driver_id IS NULL OR p_driver_id = ANY (COALESCE(b.forklift_driver_ids, ARRAY[]::text[])))
  ),
  grouped AS (
    SELECT
      CASE WHEN p_mode = 'SCAN' THEN t.id
           ELSE t.gdo_id || '|' || COALESCE(t.current_code, '?') || '|' || COALESCE(t.to_code, '?') || '|' || t.kind
                || CASE WHEN t.skipped THEN '|S' ELSE '' END
      END                                        AS group_key,
      min(t.seq)                                 AS seq,
      jsonb_agg(t.id ORDER BY t.seq)             AS task_ids,
      count(*)                                   AS n_pallets,
      sum(t.qty_base)                            AS qty_base,
      bool_or(t.is_partial)                      AS is_partial,
      min(t.units_per_carton)                    AS units_per_carton,
      min(t.entry_unit)                          AS entry_unit,
      min(t.base_unit)                           AS base_unit,
      min(t.gdo_id)                              AS gdo_id,
      min(t.group_code)                          AS group_code,
      min(t.license_plate)                       AS license_plate,
      min(t.started_at)                          AS started_at,
      min(t.delivery_date)                       AS delivery_date,
      min(t.dock_name)                           AS dock_name,
      min(t.kind)                                AS kind,
      min(t.current_code)                        AS current_code,
      min(t.from_code)                           AS from_code,
      max(t.level_no)                            AS level_no,
      min(t.to_code)                             AS to_code,
      min(t.to_name)                             AS to_name,
      min(t.drop_name)                           AS drop_name,
      min(t.dist_cells)                          AS dist_cells,
      bool_or(t.needs_lower)                     AS needs_lower,
      bool_or(t.waiting_lower)                   AS waiting_lower,
      bool_or(t.truck_idle)                      AS truck_idle,
      bool_or(t.skipped)                         AS skipped,
      min(t.skip_reason)                         AS skip_reason,
      bool_or(t.claim_active)                    AS claim_active,
      min(t.claimed_by)      FILTER (WHERE t.claim_active) AS claimed_by,
      min(t.claimed_by_name) FILTER (WHERE t.claim_active) AS claimed_by_name,
      bool_and(t.status = 'DONE' OR CASE p_mode WHEN 'LOWER' THEN t.lowered_at IS NOT NULL
                                                WHEN 'MOVE'  THEN t.moved_at   IS NOT NULL
                                                ELSE t.done_at IS NOT NULL END) AS stage_done,
      bool_and(t.status = 'DONE')                AS all_scanned,
      max(COALESCE(t.done_at, t.moved_at, t.lowered_at, t.updated_at)) AS last_at,
      min(t.lowered_by)                          AS lowered_by,
      min(t.moved_by)                            AS moved_by,
      jsonb_agg(DISTINCT t.material_code)        AS material_codes,
      jsonb_agg(DISTINCT jsonb_build_object('id', t.material_id, 'code', t.material_code))
        FILTER (WHERE t.material_id IS NOT NULL) AS materials,
      min(t.material_name)                       AS material_name,
      jsonb_agg(DISTINCT t.pallet_code)          AS pallet_codes,
      -- ── MỚI 13/09 ───────────────────────────────────────────────────────────────────────────
      -- TỪNG PALLET của nhóm: tem + nguyên liệu thô để FE tính %Date. Một dòng bảng xe nâng có thể
      -- gom nhiều pallet trong cùng ô, và đó chính là lúc "lấy cái nào" trở thành câu hỏi thật.
      jsonb_agg(jsonb_build_object(
        'task_id',         t.id,
        'code',            t.pallet_code,
        'material_code',   t.material_code,
        'qty_base',        t.qty_base,
        'is_partial',      t.is_partial,
        'level_no',        t.level_no,
        'loc_code',        t.current_code,
        'production_date', t.production_date,
        'expiry_date',     t.expiry_date,
        'shelf_life_days', t.entry_shelf_days,
        'ncc_id',          t.ncc_id,
        'mat_shelf_days',  t.mat_shelf_days,
        'mat_overrides',   t.mat_overrides,
        'done',            (t.status = 'DONE'),
        'skipped',         t.skipped
      ) ORDER BY t.seq)                          AS pallets,
      -- YÊU CẦU date của (các) dòng đơn trong nhóm — thường đúng 1; gom nhiều mã thì có thể nhiều mức
      jsonb_agg(DISTINCT t.date_rule) FILTER (WHERE t.date_rule IS NOT NULL) AS date_rules,
      max(t.date_required)                       AS date_required,
      string_agg(DISTINCT t.distributor_name, ' · ') AS customer_name,
      string_agg(DISTINCT t.delivery_code, ' · ')    AS do_codes,
      string_agg(DISTINCT t.header_text, ' · ')      AS cs_note
      FROM filtered t
     GROUP BY 1
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'group_key',      g.group_key,
      'task_ids',       g.task_ids,
      'seq',            g.seq,
      'gdo_id',         g.gdo_id,
      'group_code',     g.group_code,
      'license_plate',  g.license_plate,
      'started_at',     g.started_at,
      'delivery_date',  g.delivery_date,
      'dock_name',      g.dock_name,
      'kind',           g.kind,
      'current_code',   g.current_code,
      'from_code',      g.from_code,
      'level_no',       g.level_no,
      'to_code',        g.to_code,
      'to_name',        g.to_name,
      'drop_name',      g.drop_name,
      'dist_cells',     g.dist_cells,
      'n_pallets',      g.n_pallets,
      'qty_base',       g.qty_base,
      'is_partial',     g.is_partial,
      'units_per_carton', g.units_per_carton,
      'entry_unit',     g.entry_unit,
      'base_unit',      g.base_unit,
      'material_codes', g.material_codes,
      'materials',      COALESCE(g.materials, '[]'::jsonb),
      'material_name',  g.material_name,
      'pallet_codes',   g.pallet_codes,
      'pallets',        COALESCE(g.pallets, '[]'::jsonb),
      'date_rules',     COALESCE(g.date_rules, '[]'::jsonb),
      'date_required',  g.date_required,
      'customer_name',  g.customer_name,
      'do_codes',       g.do_codes,
      'cs_note',        g.cs_note,
      'needs_lower',    g.needs_lower,
      'waiting_lower',  g.waiting_lower,
      'skipped',        g.skipped,
      'skip_reason',    g.skip_reason,
      'claim_active',   g.claim_active,
      'claimed_by',     g.claimed_by,
      'claimed_by_name', g.claimed_by_name,
      'stage_done',     g.stage_done,
      'all_scanned',    g.all_scanned,
      'last_at',        g.last_at,
      'done_by_name',   COALESCE(g.moved_by, g.lowered_by),
      -- Việc còn trên kệ nhìn từ bảng XE CHUYỂN = MỘT nút "Hạ & đưa ra" (stage BOTH). Không còn phụ
      -- thuộc `separate_lowering_forklift`: cờ đó chỉ còn quyết định có HIỆN tab Cần hạ hay không.
      'combined_lower', (p_mode = 'MOVE' AND g.waiting_lower),
      -- Không tự khoá tay ai nữa: việc chưa xong và chưa bị bỏ thì bấm được, ở cả ba bảng.
      'can_confirm',    (NOT g.stage_done) AND (NOT g.skipped)
    ) ORDER BY
        (g.stage_done OR g.skipped),
        g.skipped,
        CASE WHEN p_mode = 'LOWER' THEN (NOT g.truck_idle)::int ELSE 0 END,
        g.started_at,
        CASE WHEN p_mode = 'LOWER' THEN g.dist_cells END NULLS LAST,
        CASE WHEN p_mode = 'LOWER' THEN -g.level_no END,
        g.seq
    ), '[]'::jsonb)
    INTO v_rows
    FROM grouped g;

  SELECT jsonb_build_object(
           'pending',   count(*) FILTER (WHERE t.status = 'PENDING'),
           'done',      count(*) FILTER (WHERE t.status = 'DONE'),
           'skipped',   count(*) FILTER (WHERE t.status = 'SKIPPED'),
           'to_lower',  count(*) FILTER (WHERE t.status = 'PENDING' AND t.needs_lower AND t.lowered_at IS NULL),
           'to_move',   count(*) FILTER (WHERE t.status = 'PENDING' AND t.moved_at IS NULL),
           'trips',     count(DISTINCT t.gdo_id) FILTER (WHERE t.status <> 'SKIPPED')
         )
    INTO v_tot
    FROM public.wms_tasks t
    JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
   WHERE t.warehouse_id = p_warehouse_id AND t.status IN ('PENDING', 'DONE', 'SKIPPED')
     AND g.status IN ('IN_PROGRESS', 'PAUSED')
     AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id);

  -- ── HỒ SƠ CHUYẾN (mới 13/09) — người đang lấy hàng phải biết mình đang phục vụ chuyến nào, giao
  --    cho ai, còn bao nhiêu. Đếm theo DÒNG HÀNG, KHÔNG cộng thùng cross-mã (luật base-unit).
  WITH tt AS (
    SELECT g.id, g.group_code, g.license_plate, g.started_at, g.delivery_date,
           dk.row AS dock_name,
           string_agg(DISTINCT d.distributor_name, ' · ')                   AS customers,
           count(DISTINCT d.id)                                             AS n_do,
           count(DISTINCT i.id)                                             AS lines_total,
           count(DISTINCT i.id) FILTER (
             WHERE COALESCE(i.cartons_scanned, 0) >= COALESCE(i.cartons_ordered, 0)) AS lines_done,
           count(DISTINCT i.id) FILTER (
             WHERE i.date_rule IS NULL AND COALESCE(i.date_required, 0) <= 0
               AND COALESCE(i.cartons_ordered, 0) > COALESCE(i.cartons_scanned, 0))  AS lines_unset
      FROM public."GroupDeliveryOrder" g
      LEFT JOIN public."Location"          dk ON dk.id  = g.dock_location_id
      LEFT JOIN public."OutboundDelivery"  d  ON d.gdo_id = g.id
      LEFT JOIN public."OutboundItem"      i  ON i.do_id  = d.id
     WHERE g.warehouse_id = p_warehouse_id
       AND g.status IN ('IN_PROGRESS', 'PAUSED')
       AND (p_gdo_id IS NULL OR g.id = p_gdo_id)
     GROUP BY g.id, g.group_code, g.license_plate, g.started_at, g.delivery_date, dk.row
  ), tk AS (
    SELECT t.gdo_id,
           count(*) FILTER (WHERE t.status = 'PENDING') AS tasks_pending,
           count(*) FILTER (WHERE t.status = 'DONE')    AS tasks_done
      FROM public.wms_tasks t
     WHERE t.warehouse_id = p_warehouse_id
     GROUP BY t.gdo_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'gdo_id',        tt.id,
           'group_code',    tt.group_code,
           'license_plate', tt.license_plate,
           'dock_name',     tt.dock_name,
           'started_at',    tt.started_at,
           'delivery_date', tt.delivery_date,
           'customers',     tt.customers,
           'n_do',          tt.n_do,
           'lines_total',   tt.lines_total,
           'lines_done',    tt.lines_done,
           'lines_unset',   tt.lines_unset,
           'tasks_pending', COALESCE(tk.tasks_pending, 0),
           'tasks_done',    COALESCE(tk.tasks_done, 0)
         ) ORDER BY tt.started_at NULLS LAST, tt.group_code), '[]'::jsonb)
    INTO v_trips
    FROM tt LEFT JOIN tk ON tk.gdo_id = tt.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'gdo_id', x.gdo_id, 'group_code', x.group_code, 'item_id', x.item_id,
           'material_code', x.material_code_raw, 'remaining', x.remaining, 'note', x.header_text,
           'delivery_date', x.delivery_date
         ) ORDER BY x.group_code, x.material_code_raw), '[]'::jsonb)
    INTO v_alerts
    FROM (
      SELECT g.id AS gdo_id, g.group_code, g.delivery_date, i.id AS item_id, i.material_code_raw, i.header_text,
             (COALESCE(i.cartons_ordered, 0) - COALESCE(i.cartons_scanned, 0)) AS remaining
        FROM public."GroupDeliveryOrder" g
        JOIN public."OutboundDelivery"   d ON d.gdo_id = g.id
        JOIN public."OutboundItem"       i ON i.do_id  = d.id
       WHERE g.warehouse_id = p_warehouse_id
         AND g.status IN ('IN_PROGRESS', 'PAUSED')
         AND (p_gdo_id IS NULL OR g.id = p_gdo_id)
         AND i.date_rule IS NULL
         AND COALESCE(i.date_required, 0) <= 0
         AND COALESCE(i.cartons_ordered, 0) > COALESCE(i.cartons_scanned, 0)
    ) x;

  RETURN jsonb_build_object(
    'rows', v_rows, 'totals', v_tot, 'unset_items', v_alerts, 'trips', v_trips,
    'settings', jsonb_build_object('separate_lowering_forklift', v_sep)
  );
END;
$$;

COMMENT ON FUNCTION public.directed_board IS
  'Bảng Việc cần làm theo vai (LOWER/MOVE/SCAN). Từ 13/09 trả thêm: pallets[] (tem + nguyên liệu thô '
  'để FE tính %Date bằng computePctDate), date_rules/date_required (yêu cầu date của dòng đơn), '
  'customer_name/do_codes/cs_note (giao cho ai), và trips[] (hồ sơ chuyến + tiến độ theo DÒNG hàng). '
  'KHÔNG tính %Date trong SQL — luật một nguồn utils/shelfLife.ts.';



-- ─────────────────────────────────────────────────────────────────────────
-- [20260913c_directed_board_keep_route.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260913c — Bảng "Cần hạ" ĐỪNG VỨT BỎ vòng đường mà kế hoạch đã tính
-- ============================================================================
-- `assignSeq` (services/directedTasks.ts) đánh `seq` bằng VÒNG LÁNG GIỀNG GẦN NHẤT: xuất phát từ
-- cửa của chuyến, đi qua từng VỊ TRÍ theo đường ngắn nhất trên Sơ đồ kho (BFS); trong cùng một ô thì
-- tầng cao xuống trước. Nhưng bảng "Cần hạ" lại sắp LẠI theo `dist_cells` (khoảng cách TỚI CỬA) rồi
-- mới tới `seq` ⇒ **vòng đường bị thay bằng danh sách xếp theo xa/gần cửa**. Xếp theo xa/gần cửa
-- KHÔNG phải một vòng đi: hai ô cùng cách cửa 50 ô có thể nằm ở hai đầu kho.
--
-- Hai khoá này có từ bản đầu (20260910c) và chưa bao giờ kèm một dòng giải thích nào.
--
-- ĐO THẬT 13/09 trên chính bản vẽ Kho Ba Vì (200×200 ô · 1 ô = 1,2 m · 236 vị trí · 5 cửa xuất),
-- tự dựng lại BFS NGOÀI app rồi tính quãng đường; mỗi số là trung bình 12 lượt gieo khác nhau:
--
--   hàng rải đều · 8 chuyến × 10 việc : bảng 4.013 m → theo `seq` 3.854 m   (−4 % quãng đường)
--                                       giải phóng cửa 2.173 m → 2.071 m    (−5 %, xe rời cửa SỚM hơn)
--   hàng rải đều · 4 chuyến × 8 việc  : 1.498 → 1.459 m · cửa 900 → 875 m
--
-- Tức đây là LỖ THUẦN: đi xa hơn VÀ giữ cửa lâu hơn, không đổi lại được gì.
--
-- GIỮ NGUYÊN `truck_idle`: chuyến chỉ còn chờ hạ (xe đã đứng bãi) vẫn lên đầu — đó là ưu tiên
-- NGHIỆP VỤ có lý do rõ ràng, khác hẳn hai khoá bị bỏ.
--
-- Cùng đợt, gói QA 57 [5c3] được viết lại: phép kiểm cũ khẳng định "thứ tự đi phải TĂNG DẦN theo
-- khoảng cách từ cửa" — đó chính là quan niệm sai ở trên, đóng khung thành luật. Một vòng ngắn nhất
-- KHÔNG có tính chất đó (đo được: sắp theo khoảng cách đi XA HƠN vòng thật). Oracle mới kiểm đúng
-- thứ đáng kiểm: **không quay lại ô đã rời** — tính chất thật của một vòng đi.
--
-- Không đổi chữ ký hàm ⇒ CREATE OR REPLACE thay tại chỗ, không sinh bản nạp chồng.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.directed_board(
  p_warehouse_id text,
  p_mode         text,
  p_gdo_id       text DEFAULT NULL,
  p_driver_id    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_rows   jsonb;
  v_tot    jsonb;
  v_alerts jsonb;
  v_trips  jsonb;
  v_sep    boolean;
BEGIN
  SELECT COALESCE(w.separate_lowering_forklift, true) INTO v_sep
    FROM public."Warehouse" w WHERE w.id = p_warehouse_id;
  v_sep := COALESCE(v_sep, true);

  WITH base AS (
    SELECT t.*,
           g.group_code, g.license_plate, g.status AS gdo_status, g.started_at,
           g.delivery_date,
           g.forklift_driver_ids, g.dock_location_id AS gdo_dock_id,
           fl.location_code AS from_code,
           dl.location_code AS drop_code, dl.row AS drop_name,
           tl.location_code AS to_code,   tl.row AS to_name,
           dk.row           AS dock_name,
           m.short_name     AS material_name,
           m.units_per_carton, m.entry_unit, m.base_unit,
           -- NGUYÊN LIỆU THÔ cho %Date (FE tính bằng computePctDate — xem đầu file)
           m.shelf_life_days              AS mat_shelf_days,
           m.supplier_shelf_life_overrides AS mat_overrides,
           ie.production_date, ie.expiry_date,
           ie.shelf_life_days AS entry_shelf_days,
           ie.ncc_id,
           -- YÊU CẦU của dòng đơn + NƠI NHẬN (câu hỏi 2 và 3 ở đầu file)
           oi.date_rule, oi.date_required, oi.header_text,
           od.distributor_name, od.delivery_code,
           ce.name          AS claimed_by_name,
           CASE
             WHEN t.lowered_at IS NULL           THEN fl.location_code
             WHEN t.kind = 'LOOSE_FEED'          THEN tl.location_code
             ELSE COALESCE(dl.location_code, fl.location_code)
           END AS current_code,
           (t.needs_lower AND t.lowered_at IS NULL AND t.status = 'PENDING') AS waiting_lower,
           (t.status = 'SKIPPED') AS skipped,
           -- Khoá mềm 10 phút: quá hạn coi như không ai giữ
           (t.status = 'PENDING' AND t.claimed_by IS NOT NULL
              AND t.claimed_at > now() - interval '10 minutes') AS claim_active
      FROM public.wms_tasks t
      JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
      LEFT JOIN public."Location" fl ON fl.id = t.from_location_id
      LEFT JOIN public."Location" dl ON dl.id = t.drop_location_id
      LEFT JOIN public."Location" tl ON tl.id = t.to_location_id
      LEFT JOIN public."Location" dk ON dk.id = g.dock_location_id
      LEFT JOIN public."Material"  m  ON m.id  = t.material_id
      -- entry_id là ON DELETE SET NULL ⇒ LEFT JOIN; pallet đã bị xoá thì chỉ mất phần date, dòng việc vẫn hiện
      LEFT JOIN public."InventoryEntry"   ie ON ie.id = t.entry_id
      LEFT JOIN public."OutboundItem"     oi ON oi.id = t.item_id
      LEFT JOIN public."OutboundDelivery" od ON od.id = oi.do_id
      LEFT JOIN public."Employee"  ce ON ce.id = t.claimed_by
     WHERE t.warehouse_id = p_warehouse_id
       AND t.status IN ('PENDING', 'DONE', 'SKIPPED')
       AND g.status IN ('IN_PROGRESS', 'PAUSED')
       AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id)
  ),
  gdo_flag AS (
    SELECT gdo_id,
           bool_and(NOT (status = 'PENDING' AND NOT waiting_lower)) AS truck_idle
      FROM base WHERE NOT skipped GROUP BY gdo_id
  ),
  filtered AS (
    SELECT b.*, COALESCE(f.truck_idle, false) AS truck_idle
      FROM base b LEFT JOIN gdo_flag f ON f.gdo_id = b.gdo_id
     -- LOWER = riêng việc phải hạ. MOVE = TOÀN BỘ việc phải mang đi đâu đó (kể cả việc về vị trí
     -- nhặt lẻ còn trên kệ) — bảng của xe chuyển phải nói hết phần việc, không lọc theo việc người
     -- khác đã bấm hay chưa.
     WHERE CASE p_mode WHEN 'LOWER' THEN b.needs_lower ELSE true END
       AND (p_driver_id IS NULL OR p_driver_id = ANY (COALESCE(b.forklift_driver_ids, ARRAY[]::text[])))
  ),
  grouped AS (
    SELECT
      CASE WHEN p_mode = 'SCAN' THEN t.id
           ELSE t.gdo_id || '|' || COALESCE(t.current_code, '?') || '|' || COALESCE(t.to_code, '?') || '|' || t.kind
                || CASE WHEN t.skipped THEN '|S' ELSE '' END
      END                                        AS group_key,
      min(t.seq)                                 AS seq,
      jsonb_agg(t.id ORDER BY t.seq)             AS task_ids,
      count(*)                                   AS n_pallets,
      sum(t.qty_base)                            AS qty_base,
      bool_or(t.is_partial)                      AS is_partial,
      min(t.units_per_carton)                    AS units_per_carton,
      min(t.entry_unit)                          AS entry_unit,
      min(t.base_unit)                           AS base_unit,
      min(t.gdo_id)                              AS gdo_id,
      min(t.group_code)                          AS group_code,
      min(t.license_plate)                       AS license_plate,
      min(t.started_at)                          AS started_at,
      min(t.delivery_date)                       AS delivery_date,
      min(t.dock_name)                           AS dock_name,
      min(t.kind)                                AS kind,
      min(t.current_code)                        AS current_code,
      min(t.from_code)                           AS from_code,
      max(t.level_no)                            AS level_no,
      min(t.to_code)                             AS to_code,
      min(t.to_name)                             AS to_name,
      min(t.drop_name)                           AS drop_name,
      min(t.dist_cells)                          AS dist_cells,
      bool_or(t.needs_lower)                     AS needs_lower,
      bool_or(t.waiting_lower)                   AS waiting_lower,
      bool_or(t.truck_idle)                      AS truck_idle,
      bool_or(t.skipped)                         AS skipped,
      min(t.skip_reason)                         AS skip_reason,
      bool_or(t.claim_active)                    AS claim_active,
      min(t.claimed_by)      FILTER (WHERE t.claim_active) AS claimed_by,
      min(t.claimed_by_name) FILTER (WHERE t.claim_active) AS claimed_by_name,
      bool_and(t.status = 'DONE' OR CASE p_mode WHEN 'LOWER' THEN t.lowered_at IS NOT NULL
                                                WHEN 'MOVE'  THEN t.moved_at   IS NOT NULL
                                                ELSE t.done_at IS NOT NULL END) AS stage_done,
      bool_and(t.status = 'DONE')                AS all_scanned,
      max(COALESCE(t.done_at, t.moved_at, t.lowered_at, t.updated_at)) AS last_at,
      min(t.lowered_by)                          AS lowered_by,
      min(t.moved_by)                            AS moved_by,
      jsonb_agg(DISTINCT t.material_code)        AS material_codes,
      jsonb_agg(DISTINCT jsonb_build_object('id', t.material_id, 'code', t.material_code))
        FILTER (WHERE t.material_id IS NOT NULL) AS materials,
      min(t.material_name)                       AS material_name,
      jsonb_agg(DISTINCT t.pallet_code)          AS pallet_codes,
      -- ── MỚI 13/09 ───────────────────────────────────────────────────────────────────────────
      -- TỪNG PALLET của nhóm: tem + nguyên liệu thô để FE tính %Date. Một dòng bảng xe nâng có thể
      -- gom nhiều pallet trong cùng ô, và đó chính là lúc "lấy cái nào" trở thành câu hỏi thật.
      jsonb_agg(jsonb_build_object(
        'task_id',         t.id,
        'code',            t.pallet_code,
        'material_code',   t.material_code,
        'qty_base',        t.qty_base,
        'is_partial',      t.is_partial,
        'level_no',        t.level_no,
        'loc_code',        t.current_code,
        'production_date', t.production_date,
        'expiry_date',     t.expiry_date,
        'shelf_life_days', t.entry_shelf_days,
        'ncc_id',          t.ncc_id,
        'mat_shelf_days',  t.mat_shelf_days,
        'mat_overrides',   t.mat_overrides,
        'done',            (t.status = 'DONE'),
        'skipped',         t.skipped
      ) ORDER BY t.seq)                          AS pallets,
      -- YÊU CẦU date của (các) dòng đơn trong nhóm — thường đúng 1; gom nhiều mã thì có thể nhiều mức
      jsonb_agg(DISTINCT t.date_rule) FILTER (WHERE t.date_rule IS NOT NULL) AS date_rules,
      max(t.date_required)                       AS date_required,
      string_agg(DISTINCT t.distributor_name, ' · ') AS customer_name,
      string_agg(DISTINCT t.delivery_code, ' · ')    AS do_codes,
      string_agg(DISTINCT t.header_text, ' · ')      AS cs_note
      FROM filtered t
     GROUP BY 1
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'group_key',      g.group_key,
      'task_ids',       g.task_ids,
      'seq',            g.seq,
      'gdo_id',         g.gdo_id,
      'group_code',     g.group_code,
      'license_plate',  g.license_plate,
      'started_at',     g.started_at,
      'delivery_date',  g.delivery_date,
      'dock_name',      g.dock_name,
      'kind',           g.kind,
      'current_code',   g.current_code,
      'from_code',      g.from_code,
      'level_no',       g.level_no,
      'to_code',        g.to_code,
      'to_name',        g.to_name,
      'drop_name',      g.drop_name,
      'dist_cells',     g.dist_cells,
      'n_pallets',      g.n_pallets,
      'qty_base',       g.qty_base,
      'is_partial',     g.is_partial,
      'units_per_carton', g.units_per_carton,
      'entry_unit',     g.entry_unit,
      'base_unit',      g.base_unit,
      'material_codes', g.material_codes,
      'materials',      COALESCE(g.materials, '[]'::jsonb),
      'material_name',  g.material_name,
      'pallet_codes',   g.pallet_codes,
      'pallets',        COALESCE(g.pallets, '[]'::jsonb),
      'date_rules',     COALESCE(g.date_rules, '[]'::jsonb),
      'date_required',  g.date_required,
      'customer_name',  g.customer_name,
      'do_codes',       g.do_codes,
      'cs_note',        g.cs_note,
      'needs_lower',    g.needs_lower,
      'waiting_lower',  g.waiting_lower,
      'skipped',        g.skipped,
      'skip_reason',    g.skip_reason,
      'claim_active',   g.claim_active,
      'claimed_by',     g.claimed_by,
      'claimed_by_name', g.claimed_by_name,
      'stage_done',     g.stage_done,
      'all_scanned',    g.all_scanned,
      'last_at',        g.last_at,
      'done_by_name',   COALESCE(g.moved_by, g.lowered_by),
      -- Việc còn trên kệ nhìn từ bảng XE CHUYỂN = MỘT nút "Hạ & đưa ra" (stage BOTH). Không còn phụ
      -- thuộc `separate_lowering_forklift`: cờ đó chỉ còn quyết định có HIỆN tab Cần hạ hay không.
      'combined_lower', (p_mode = 'MOVE' AND g.waiting_lower),
      -- Không tự khoá tay ai nữa: việc chưa xong và chưa bị bỏ thì bấm được, ở cả ba bảng.
      'can_confirm',    (NOT g.stage_done) AND (NOT g.skipped)
    ) ORDER BY
        (g.stage_done OR g.skipped),
        g.skipped,
        CASE WHEN p_mode = 'LOWER' THEN (NOT g.truck_idle)::int ELSE 0 END,
        g.started_at,
        -- BỎ hai khoá 'gần cửa trước' + 'tầng cao trước' (13/09 — xem đầu file): thứ tự đi đã nằm
        -- trong `seq` do assignSeq tính bằng vòng láng giềng gần nhất trên Sơ đồ kho; sắp lại theo
        -- khoảng-cách-tới-cửa là VỨT BỎ chính cái vòng đó. "Tầng cao trước" vẫn đúng nhưng chỉ có
        -- nghĩa TRONG một ô (assignSeq đã sắp), áp giữa các ô khác nhau thì không mang nghĩa gì.
        g.seq
    ), '[]'::jsonb)
    INTO v_rows
    FROM grouped g;

  SELECT jsonb_build_object(
           'pending',   count(*) FILTER (WHERE t.status = 'PENDING'),
           'done',      count(*) FILTER (WHERE t.status = 'DONE'),
           'skipped',   count(*) FILTER (WHERE t.status = 'SKIPPED'),
           'to_lower',  count(*) FILTER (WHERE t.status = 'PENDING' AND t.needs_lower AND t.lowered_at IS NULL),
           'to_move',   count(*) FILTER (WHERE t.status = 'PENDING' AND t.moved_at IS NULL),
           'trips',     count(DISTINCT t.gdo_id) FILTER (WHERE t.status <> 'SKIPPED')
         )
    INTO v_tot
    FROM public.wms_tasks t
    JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
   WHERE t.warehouse_id = p_warehouse_id AND t.status IN ('PENDING', 'DONE', 'SKIPPED')
     AND g.status IN ('IN_PROGRESS', 'PAUSED')
     AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id);

  -- ── HỒ SƠ CHUYẾN (mới 13/09) — người đang lấy hàng phải biết mình đang phục vụ chuyến nào, giao
  --    cho ai, còn bao nhiêu. Đếm theo DÒNG HÀNG, KHÔNG cộng thùng cross-mã (luật base-unit).
  WITH tt AS (
    SELECT g.id, g.group_code, g.license_plate, g.started_at, g.delivery_date,
           dk.row AS dock_name,
           string_agg(DISTINCT d.distributor_name, ' · ')                   AS customers,
           count(DISTINCT d.id)                                             AS n_do,
           count(DISTINCT i.id)                                             AS lines_total,
           count(DISTINCT i.id) FILTER (
             WHERE COALESCE(i.cartons_scanned, 0) >= COALESCE(i.cartons_ordered, 0)) AS lines_done,
           count(DISTINCT i.id) FILTER (
             WHERE i.date_rule IS NULL AND COALESCE(i.date_required, 0) <= 0
               AND COALESCE(i.cartons_ordered, 0) > COALESCE(i.cartons_scanned, 0))  AS lines_unset
      FROM public."GroupDeliveryOrder" g
      LEFT JOIN public."Location"          dk ON dk.id  = g.dock_location_id
      LEFT JOIN public."OutboundDelivery"  d  ON d.gdo_id = g.id
      LEFT JOIN public."OutboundItem"      i  ON i.do_id  = d.id
     WHERE g.warehouse_id = p_warehouse_id
       AND g.status IN ('IN_PROGRESS', 'PAUSED')
       AND (p_gdo_id IS NULL OR g.id = p_gdo_id)
     GROUP BY g.id, g.group_code, g.license_plate, g.started_at, g.delivery_date, dk.row
  ), tk AS (
    SELECT t.gdo_id,
           count(*) FILTER (WHERE t.status = 'PENDING') AS tasks_pending,
           count(*) FILTER (WHERE t.status = 'DONE')    AS tasks_done
      FROM public.wms_tasks t
     WHERE t.warehouse_id = p_warehouse_id
     GROUP BY t.gdo_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'gdo_id',        tt.id,
           'group_code',    tt.group_code,
           'license_plate', tt.license_plate,
           'dock_name',     tt.dock_name,
           'started_at',    tt.started_at,
           'delivery_date', tt.delivery_date,
           'customers',     tt.customers,
           'n_do',          tt.n_do,
           'lines_total',   tt.lines_total,
           'lines_done',    tt.lines_done,
           'lines_unset',   tt.lines_unset,
           'tasks_pending', COALESCE(tk.tasks_pending, 0),
           'tasks_done',    COALESCE(tk.tasks_done, 0)
         ) ORDER BY tt.started_at NULLS LAST, tt.group_code), '[]'::jsonb)
    INTO v_trips
    FROM tt LEFT JOIN tk ON tk.gdo_id = tt.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'gdo_id', x.gdo_id, 'group_code', x.group_code, 'item_id', x.item_id,
           'material_code', x.material_code_raw, 'remaining', x.remaining, 'note', x.header_text,
           'delivery_date', x.delivery_date
         ) ORDER BY x.group_code, x.material_code_raw), '[]'::jsonb)
    INTO v_alerts
    FROM (
      SELECT g.id AS gdo_id, g.group_code, g.delivery_date, i.id AS item_id, i.material_code_raw, i.header_text,
             (COALESCE(i.cartons_ordered, 0) - COALESCE(i.cartons_scanned, 0)) AS remaining
        FROM public."GroupDeliveryOrder" g
        JOIN public."OutboundDelivery"   d ON d.gdo_id = g.id
        JOIN public."OutboundItem"       i ON i.do_id  = d.id
       WHERE g.warehouse_id = p_warehouse_id
         AND g.status IN ('IN_PROGRESS', 'PAUSED')
         AND (p_gdo_id IS NULL OR g.id = p_gdo_id)
         AND i.date_rule IS NULL
         AND COALESCE(i.date_required, 0) <= 0
         AND COALESCE(i.cartons_ordered, 0) > COALESCE(i.cartons_scanned, 0)
    ) x;

  RETURN jsonb_build_object(
    'rows', v_rows, 'totals', v_tot, 'unset_items', v_alerts, 'trips', v_trips,
    'settings', jsonb_build_object('separate_lowering_forklift', v_sep)
  );
END;
$$;

COMMENT ON FUNCTION public.directed_board IS
  'Bảng Việc cần làm theo vai (LOWER/MOVE/SCAN). Từ 13/09 trả thêm: pallets[] (tem + nguyên liệu thô '
  'để FE tính %Date bằng computePctDate), date_rules/date_required (yêu cầu date của dòng đơn), '
  'customer_name/do_codes/cs_note (giao cho ai), và trips[] (hồ sơ chuyến + tiến độ theo DÒNG hàng). '
  'KHÔNG tính %Date trong SQL — luật một nguồn utils/shelfLife.ts.';



-- ─────────────────────────────────────────────────────────────────────────
-- [20260913d_cross_trip_pick_radius.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260913d — "NHẶT DỌC ĐƯỜNG": lấy lại quãng đường mà việc nhóm-theo-chuyến đang mất
-- ============================================================================
-- Đo 13/09 (BFS dựng NGOÀI app trên bản vẽ thật Kho Ba Vì, TB 12 lượt gieo) cho thấy thứ tự việc
-- đang đứng giữa hai tiêu chí ĐỐI NHAU:
--   • nhóm theo CHUYẾN  → xe rời cửa SỚM, nhưng xe nâng đi xa hơn đường ngắn nhất ~25 %
--   • đường ngắn nhất toàn kho → đi ít hơn, nhưng giữ cửa lâu hơn **37 %** (2.071 → 2.834 m)
-- ⇒ KHÔNG được đổi sang tối ưu đường thuần: cửa mới là tài nguyên hiếm (đã mô hình hoá bằng
--    `Location.dock_capacity`).
--
-- Nhưng có một phương án THẮNG CẢ HAI cùng lúc: giữ nguyên nhóm theo chuyến, và khi xe nâng đang
-- đứng ở một điểm đặt dãy, nếu có việc của CHUYẾN KHÁC nằm trong bán kính R thì làm luôn thay vì
-- để lần sau quay lại. Đo được (hàng rải đều, 8 chuyến × 10 việc):
--
--      quãng đường   3.854 m → 3.242 m   (−16 %)
--      giải phóng cửa 2.071 m → 1.982 m  (−4 %, xe vẫn rời cửa SỚM HƠN)
--
--   hàng co cụm trong vài dãy thì lợi ít hơn hẳn (−2…−4 %) — đúng như trực giác, nên đây phải là
--   THAM SỐ CỦA KHO chứ không bật cứng cho tất cả (user chốt 13/09).
--
-- ⚠️ Đo gần/xa PHẢI bằng BFS trên bản vẽ, KHÔNG bằng khoảng cách hình học: đo cả hai thì hình học
-- chỉ lấy lại được một nửa lợi ích (−10 % so với −16 %) vì nó coi hai ô kề nhau qua một khối kệ là
-- gần, trong khi xe nâng phải đi vòng cả dãy.
--
-- Cột `cross_trip_pick_radius` = bán kính theo Ô LƯỚI (0 = TẮT, mặc định cho MỌI kho đang chạy —
-- bật tự động là đổi cách làm việc của người ta mà không ai khai). Bản vẽ Ba Vì 1 ô = 1,2 m nên
-- 12 ô ≈ 14 m.
--
-- CHỈ áp cho bảng "Cần hạ". Ở bảng "Cần đưa ra" mỗi việc đều kết thúc tại CỬA nên tổng quãng đường
-- KHÔNG phụ thuộc thứ tự — sắp lại ở đó chỉ làm người ta nhảy chuyến mà không được gì.
--
-- RPC nay trả thêm `from_location_id`/`drop_location_id` mỗi dòng (backend cần toạ độ để chạy BFS)
-- và `settings.cross_trip_pick_radius`. Việc sắp lại làm ở BACKEND, không làm trong SQL: BFS trên
-- lưới 200×200 không viết được bằng SQL cho ra hồn, và `utils/warehouseGrid.ts` đã là NGUỒN DUY
-- NHẤT của phép đo đường đi (BE⇄FE mirror) — chép bản thứ hai xuống SQL là đúng khuôn lỗi mà
-- ratchet `rotation_rule_hand_rolled` dựng ra để cấm.
--
-- Không đổi chữ ký hàm ⇒ CREATE OR REPLACE thay tại chỗ, không sinh bản nạp chồng.
-- ============================================================================

ALTER TABLE public."Warehouse"
  ADD COLUMN IF NOT EXISTS cross_trip_pick_radius integer NOT NULL DEFAULT 0;

ALTER TABLE public."Warehouse" DROP CONSTRAINT IF EXISTS warehouse_cross_trip_radius_range;
ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_cross_trip_radius_range
  CHECK (cross_trip_pick_radius >= 0 AND cross_trip_pick_radius <= 200);

COMMENT ON COLUMN public."Warehouse".cross_trip_pick_radius IS
  'NHẶT DỌC ĐƯỜNG — bán kính (số Ô LƯỚI) mà bảng "Cần hạ" được phép kéo việc của CHUYẾN KHÁC lên làm '
  'trước, khi ô đó nằm gần chỗ xe nâng vừa đứng. 0 = TẮT (mặc định, giữ nguyên nhóm theo chuyến). '
  'Đo 13/09 trên bản vẽ Ba Vì: 12 ô (≈ 14 m) tiết kiệm 16 % quãng đường mà xe vẫn rời cửa sớm hơn; '
  'kho có hàng co cụm trong vài dãy thì gần như không lợi gì.';

CREATE OR REPLACE FUNCTION public.directed_board(
  p_warehouse_id text,
  p_mode         text,
  p_gdo_id       text DEFAULT NULL,
  p_driver_id    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_rows   jsonb;
  v_tot    jsonb;
  v_alerts jsonb;
  v_trips  jsonb;
  v_sep    boolean;
  v_radius integer;
BEGIN
  SELECT COALESCE(w.separate_lowering_forklift, true), COALESCE(w.cross_trip_pick_radius, 0)
    INTO v_sep, v_radius
    FROM public."Warehouse" w WHERE w.id = p_warehouse_id;
  v_sep := COALESCE(v_sep, true);
  v_radius := COALESCE(v_radius, 0);

  WITH base AS (
    SELECT t.*,
           g.group_code, g.license_plate, g.status AS gdo_status, g.started_at,
           g.delivery_date,
           g.forklift_driver_ids, g.dock_location_id AS gdo_dock_id,
           fl.location_code AS from_code,
           dl.location_code AS drop_code, dl.row AS drop_name,
           tl.location_code AS to_code,   tl.row AS to_name,
           dk.row           AS dock_name,
           m.short_name     AS material_name,
           m.units_per_carton, m.entry_unit, m.base_unit,
           -- NGUYÊN LIỆU THÔ cho %Date (FE tính bằng computePctDate — xem đầu file)
           m.shelf_life_days              AS mat_shelf_days,
           m.supplier_shelf_life_overrides AS mat_overrides,
           ie.production_date, ie.expiry_date,
           ie.shelf_life_days AS entry_shelf_days,
           ie.ncc_id,
           -- YÊU CẦU của dòng đơn + NƠI NHẬN (câu hỏi 2 và 3 ở đầu file)
           oi.date_rule, oi.date_required, oi.header_text,
           od.distributor_name, od.delivery_code,
           ce.name          AS claimed_by_name,
           CASE
             WHEN t.lowered_at IS NULL           THEN fl.location_code
             WHEN t.kind = 'LOOSE_FEED'          THEN tl.location_code
             ELSE COALESCE(dl.location_code, fl.location_code)
           END AS current_code,
           (t.needs_lower AND t.lowered_at IS NULL AND t.status = 'PENDING') AS waiting_lower,
           (t.status = 'SKIPPED') AS skipped,
           -- Khoá mềm 10 phút: quá hạn coi như không ai giữ
           (t.status = 'PENDING' AND t.claimed_by IS NOT NULL
              AND t.claimed_at > now() - interval '10 minutes') AS claim_active
      FROM public.wms_tasks t
      JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
      LEFT JOIN public."Location" fl ON fl.id = t.from_location_id
      LEFT JOIN public."Location" dl ON dl.id = t.drop_location_id
      LEFT JOIN public."Location" tl ON tl.id = t.to_location_id
      LEFT JOIN public."Location" dk ON dk.id = g.dock_location_id
      LEFT JOIN public."Material"  m  ON m.id  = t.material_id
      -- entry_id là ON DELETE SET NULL ⇒ LEFT JOIN; pallet đã bị xoá thì chỉ mất phần date, dòng việc vẫn hiện
      LEFT JOIN public."InventoryEntry"   ie ON ie.id = t.entry_id
      LEFT JOIN public."OutboundItem"     oi ON oi.id = t.item_id
      LEFT JOIN public."OutboundDelivery" od ON od.id = oi.do_id
      LEFT JOIN public."Employee"  ce ON ce.id = t.claimed_by
     WHERE t.warehouse_id = p_warehouse_id
       AND t.status IN ('PENDING', 'DONE', 'SKIPPED')
       AND g.status IN ('IN_PROGRESS', 'PAUSED')
       AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id)
  ),
  gdo_flag AS (
    SELECT gdo_id,
           bool_and(NOT (status = 'PENDING' AND NOT waiting_lower)) AS truck_idle
      FROM base WHERE NOT skipped GROUP BY gdo_id
  ),
  filtered AS (
    SELECT b.*, COALESCE(f.truck_idle, false) AS truck_idle
      FROM base b LEFT JOIN gdo_flag f ON f.gdo_id = b.gdo_id
     -- LOWER = riêng việc phải hạ. MOVE = TOÀN BỘ việc phải mang đi đâu đó (kể cả việc về vị trí
     -- nhặt lẻ còn trên kệ) — bảng của xe chuyển phải nói hết phần việc, không lọc theo việc người
     -- khác đã bấm hay chưa.
     WHERE CASE p_mode WHEN 'LOWER' THEN b.needs_lower ELSE true END
       AND (p_driver_id IS NULL OR p_driver_id = ANY (COALESCE(b.forklift_driver_ids, ARRAY[]::text[])))
  ),
  grouped AS (
    SELECT
      CASE WHEN p_mode = 'SCAN' THEN t.id
           ELSE t.gdo_id || '|' || COALESCE(t.current_code, '?') || '|' || COALESCE(t.to_code, '?') || '|' || t.kind
                || CASE WHEN t.skipped THEN '|S' ELSE '' END
      END                                        AS group_key,
      min(t.seq)                                 AS seq,
      jsonb_agg(t.id ORDER BY t.seq)             AS task_ids,
      count(*)                                   AS n_pallets,
      sum(t.qty_base)                            AS qty_base,
      bool_or(t.is_partial)                      AS is_partial,
      min(t.units_per_carton)                    AS units_per_carton,
      min(t.entry_unit)                          AS entry_unit,
      min(t.base_unit)                           AS base_unit,
      min(t.gdo_id)                              AS gdo_id,
      min(t.group_code)                          AS group_code,
      min(t.license_plate)                       AS license_plate,
      min(t.started_at)                          AS started_at,
      min(t.delivery_date)                       AS delivery_date,
      min(t.dock_name)                           AS dock_name,
      min(t.kind)                                AS kind,
      min(t.current_code)                        AS current_code,
      min(t.from_code)                           AS from_code,
      min(t.from_location_id)                    AS from_location_id,
      min(t.drop_location_id)                    AS drop_location_id,
      max(t.level_no)                            AS level_no,
      min(t.to_code)                             AS to_code,
      min(t.to_name)                             AS to_name,
      min(t.drop_name)                           AS drop_name,
      min(t.dist_cells)                          AS dist_cells,
      bool_or(t.needs_lower)                     AS needs_lower,
      bool_or(t.waiting_lower)                   AS waiting_lower,
      bool_or(t.truck_idle)                      AS truck_idle,
      bool_or(t.skipped)                         AS skipped,
      min(t.skip_reason)                         AS skip_reason,
      bool_or(t.claim_active)                    AS claim_active,
      min(t.claimed_by)      FILTER (WHERE t.claim_active) AS claimed_by,
      min(t.claimed_by_name) FILTER (WHERE t.claim_active) AS claimed_by_name,
      bool_and(t.status = 'DONE' OR CASE p_mode WHEN 'LOWER' THEN t.lowered_at IS NOT NULL
                                                WHEN 'MOVE'  THEN t.moved_at   IS NOT NULL
                                                ELSE t.done_at IS NOT NULL END) AS stage_done,
      bool_and(t.status = 'DONE')                AS all_scanned,
      max(COALESCE(t.done_at, t.moved_at, t.lowered_at, t.updated_at)) AS last_at,
      min(t.lowered_by)                          AS lowered_by,
      min(t.moved_by)                            AS moved_by,
      jsonb_agg(DISTINCT t.material_code)        AS material_codes,
      jsonb_agg(DISTINCT jsonb_build_object('id', t.material_id, 'code', t.material_code))
        FILTER (WHERE t.material_id IS NOT NULL) AS materials,
      min(t.material_name)                       AS material_name,
      jsonb_agg(DISTINCT t.pallet_code)          AS pallet_codes,
      -- ── MỚI 13/09 ───────────────────────────────────────────────────────────────────────────
      -- TỪNG PALLET của nhóm: tem + nguyên liệu thô để FE tính %Date. Một dòng bảng xe nâng có thể
      -- gom nhiều pallet trong cùng ô, và đó chính là lúc "lấy cái nào" trở thành câu hỏi thật.
      jsonb_agg(jsonb_build_object(
        'task_id',         t.id,
        'code',            t.pallet_code,
        'material_code',   t.material_code,
        'qty_base',        t.qty_base,
        'is_partial',      t.is_partial,
        'level_no',        t.level_no,
        'loc_code',        t.current_code,
        'production_date', t.production_date,
        'expiry_date',     t.expiry_date,
        'shelf_life_days', t.entry_shelf_days,
        'ncc_id',          t.ncc_id,
        'mat_shelf_days',  t.mat_shelf_days,
        'mat_overrides',   t.mat_overrides,
        'done',            (t.status = 'DONE'),
        'skipped',         t.skipped
      ) ORDER BY t.seq)                          AS pallets,
      -- YÊU CẦU date của (các) dòng đơn trong nhóm — thường đúng 1; gom nhiều mã thì có thể nhiều mức
      jsonb_agg(DISTINCT t.date_rule) FILTER (WHERE t.date_rule IS NOT NULL) AS date_rules,
      max(t.date_required)                       AS date_required,
      string_agg(DISTINCT t.distributor_name, ' · ') AS customer_name,
      string_agg(DISTINCT t.delivery_code, ' · ')    AS do_codes,
      string_agg(DISTINCT t.header_text, ' · ')      AS cs_note
      FROM filtered t
     GROUP BY 1
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'group_key',      g.group_key,
      'task_ids',       g.task_ids,
      'seq',            g.seq,
      'gdo_id',         g.gdo_id,
      'group_code',     g.group_code,
      'license_plate',  g.license_plate,
      'started_at',     g.started_at,
      'delivery_date',  g.delivery_date,
      'dock_name',      g.dock_name,
      'kind',           g.kind,
      'current_code',   g.current_code,
      'from_code',      g.from_code,
      -- ID vị trí (13/09): backend cần toạ độ trên lưới để sắp "nhặt dọc đường"; mã chữ không tra được
      'from_location_id', g.from_location_id,
      'drop_location_id', g.drop_location_id,
      'level_no',       g.level_no,
      'to_code',        g.to_code,
      'to_name',        g.to_name,
      'drop_name',      g.drop_name,
      'dist_cells',     g.dist_cells,
      'n_pallets',      g.n_pallets,
      'qty_base',       g.qty_base,
      'is_partial',     g.is_partial,
      'units_per_carton', g.units_per_carton,
      'entry_unit',     g.entry_unit,
      'base_unit',      g.base_unit,
      'material_codes', g.material_codes,
      'materials',      COALESCE(g.materials, '[]'::jsonb),
      'material_name',  g.material_name,
      'pallet_codes',   g.pallet_codes,
      'pallets',        COALESCE(g.pallets, '[]'::jsonb),
      'date_rules',     COALESCE(g.date_rules, '[]'::jsonb),
      'date_required',  g.date_required,
      'customer_name',  g.customer_name,
      'do_codes',       g.do_codes,
      'cs_note',        g.cs_note,
      'needs_lower',    g.needs_lower,
      'waiting_lower',  g.waiting_lower,
      'skipped',        g.skipped,
      'skip_reason',    g.skip_reason,
      'claim_active',   g.claim_active,
      'claimed_by',     g.claimed_by,
      'claimed_by_name', g.claimed_by_name,
      'stage_done',     g.stage_done,
      'all_scanned',    g.all_scanned,
      'last_at',        g.last_at,
      'done_by_name',   COALESCE(g.moved_by, g.lowered_by),
      -- Việc còn trên kệ nhìn từ bảng XE CHUYỂN = MỘT nút "Hạ & đưa ra" (stage BOTH). Không còn phụ
      -- thuộc `separate_lowering_forklift`: cờ đó chỉ còn quyết định có HIỆN tab Cần hạ hay không.
      'combined_lower', (p_mode = 'MOVE' AND g.waiting_lower),
      -- Không tự khoá tay ai nữa: việc chưa xong và chưa bị bỏ thì bấm được, ở cả ba bảng.
      'can_confirm',    (NOT g.stage_done) AND (NOT g.skipped)
    ) ORDER BY
        (g.stage_done OR g.skipped),
        g.skipped,
        CASE WHEN p_mode = 'LOWER' THEN (NOT g.truck_idle)::int ELSE 0 END,
        g.started_at,
        -- BỎ hai khoá 'gần cửa trước' + 'tầng cao trước' (13/09 — xem đầu file): thứ tự đi đã nằm
        -- trong `seq` do assignSeq tính bằng vòng láng giềng gần nhất trên Sơ đồ kho; sắp lại theo
        -- khoảng-cách-tới-cửa là VỨT BỎ chính cái vòng đó. "Tầng cao trước" vẫn đúng nhưng chỉ có
        -- nghĩa TRONG một ô (assignSeq đã sắp), áp giữa các ô khác nhau thì không mang nghĩa gì.
        g.seq
    ), '[]'::jsonb)
    INTO v_rows
    FROM grouped g;

  SELECT jsonb_build_object(
           'pending',   count(*) FILTER (WHERE t.status = 'PENDING'),
           'done',      count(*) FILTER (WHERE t.status = 'DONE'),
           'skipped',   count(*) FILTER (WHERE t.status = 'SKIPPED'),
           'to_lower',  count(*) FILTER (WHERE t.status = 'PENDING' AND t.needs_lower AND t.lowered_at IS NULL),
           'to_move',   count(*) FILTER (WHERE t.status = 'PENDING' AND t.moved_at IS NULL),
           'trips',     count(DISTINCT t.gdo_id) FILTER (WHERE t.status <> 'SKIPPED')
         )
    INTO v_tot
    FROM public.wms_tasks t
    JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
   WHERE t.warehouse_id = p_warehouse_id AND t.status IN ('PENDING', 'DONE', 'SKIPPED')
     AND g.status IN ('IN_PROGRESS', 'PAUSED')
     AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id);

  -- ── HỒ SƠ CHUYẾN (mới 13/09) — người đang lấy hàng phải biết mình đang phục vụ chuyến nào, giao
  --    cho ai, còn bao nhiêu. Đếm theo DÒNG HÀNG, KHÔNG cộng thùng cross-mã (luật base-unit).
  WITH tt AS (
    SELECT g.id, g.group_code, g.license_plate, g.started_at, g.delivery_date,
           dk.row AS dock_name,
           string_agg(DISTINCT d.distributor_name, ' · ')                   AS customers,
           count(DISTINCT d.id)                                             AS n_do,
           count(DISTINCT i.id)                                             AS lines_total,
           count(DISTINCT i.id) FILTER (
             WHERE COALESCE(i.cartons_scanned, 0) >= COALESCE(i.cartons_ordered, 0)) AS lines_done,
           count(DISTINCT i.id) FILTER (
             WHERE i.date_rule IS NULL AND COALESCE(i.date_required, 0) <= 0
               AND COALESCE(i.cartons_ordered, 0) > COALESCE(i.cartons_scanned, 0))  AS lines_unset
      FROM public."GroupDeliveryOrder" g
      LEFT JOIN public."Location"          dk ON dk.id  = g.dock_location_id
      LEFT JOIN public."OutboundDelivery"  d  ON d.gdo_id = g.id
      LEFT JOIN public."OutboundItem"      i  ON i.do_id  = d.id
     WHERE g.warehouse_id = p_warehouse_id
       AND g.status IN ('IN_PROGRESS', 'PAUSED')
       AND (p_gdo_id IS NULL OR g.id = p_gdo_id)
     GROUP BY g.id, g.group_code, g.license_plate, g.started_at, g.delivery_date, dk.row
  ), tk AS (
    SELECT t.gdo_id,
           count(*) FILTER (WHERE t.status = 'PENDING') AS tasks_pending,
           count(*) FILTER (WHERE t.status = 'DONE')    AS tasks_done
      FROM public.wms_tasks t
     WHERE t.warehouse_id = p_warehouse_id
     GROUP BY t.gdo_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'gdo_id',        tt.id,
           'group_code',    tt.group_code,
           'license_plate', tt.license_plate,
           'dock_name',     tt.dock_name,
           'started_at',    tt.started_at,
           'delivery_date', tt.delivery_date,
           'customers',     tt.customers,
           'n_do',          tt.n_do,
           'lines_total',   tt.lines_total,
           'lines_done',    tt.lines_done,
           'lines_unset',   tt.lines_unset,
           'tasks_pending', COALESCE(tk.tasks_pending, 0),
           'tasks_done',    COALESCE(tk.tasks_done, 0)
         ) ORDER BY tt.started_at NULLS LAST, tt.group_code), '[]'::jsonb)
    INTO v_trips
    FROM tt LEFT JOIN tk ON tk.gdo_id = tt.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'gdo_id', x.gdo_id, 'group_code', x.group_code, 'item_id', x.item_id,
           'material_code', x.material_code_raw, 'remaining', x.remaining, 'note', x.header_text,
           'delivery_date', x.delivery_date
         ) ORDER BY x.group_code, x.material_code_raw), '[]'::jsonb)
    INTO v_alerts
    FROM (
      SELECT g.id AS gdo_id, g.group_code, g.delivery_date, i.id AS item_id, i.material_code_raw, i.header_text,
             (COALESCE(i.cartons_ordered, 0) - COALESCE(i.cartons_scanned, 0)) AS remaining
        FROM public."GroupDeliveryOrder" g
        JOIN public."OutboundDelivery"   d ON d.gdo_id = g.id
        JOIN public."OutboundItem"       i ON i.do_id  = d.id
       WHERE g.warehouse_id = p_warehouse_id
         AND g.status IN ('IN_PROGRESS', 'PAUSED')
         AND (p_gdo_id IS NULL OR g.id = p_gdo_id)
         AND i.date_rule IS NULL
         AND COALESCE(i.date_required, 0) <= 0
         AND COALESCE(i.cartons_ordered, 0) > COALESCE(i.cartons_scanned, 0)
    ) x;

  RETURN jsonb_build_object(
    'rows', v_rows, 'totals', v_tot, 'unset_items', v_alerts, 'trips', v_trips,
    'settings', jsonb_build_object('separate_lowering_forklift', v_sep,
                                   'cross_trip_pick_radius', COALESCE(v_radius, 0))
  );
END;
$$;

COMMENT ON FUNCTION public.directed_board IS
  'Bảng Việc cần làm theo vai (LOWER/MOVE/SCAN). Từ 13/09 trả thêm: pallets[] (tem + nguyên liệu thô '
  'để FE tính %Date bằng computePctDate), date_rules/date_required (yêu cầu date của dòng đơn), '
  'customer_name/do_codes/cs_note (giao cho ai), và trips[] (hồ sơ chuyến + tiến độ theo DÒNG hàng). '
  'KHÔNG tính %Date trong SQL — luật một nguồn utils/shelfLife.ts.';



-- ─────────────────────────────────────────────────────────────────────────
-- [20260913e_qa_ok_is_not_hold.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- QA "OK" KHÔNG PHẢI LÀ GIỮ HÀNG — một nguồn cho luật "pallet có bị QA giữ không".
--
-- VÌ SAO (đo staging 13/09/2026): danh mục QAStatus có 4 mã — X · XCQ (X cảm quan) · X7 (X 7 ngày)
-- là GIỮ, còn **OK là ĐÃ DUYỆT**. Cửa QUÉT XUẤT vốn hiểu đúng (`qa_status.code <> 'OK'`) nhưng
-- mọi cửa THỐNG KÊ / CHỈ ĐƯỜNG lại coi "có giá trị = đang giữ" ⇒ cùng một pallet: quét thì xuất
-- được, mà Giám sát vận hành đếm là "kẹt" và bộ sinh việc bảo "hết hàng".
--
-- Số đo trước khi vá (Kho Ba Vì, tồn > 0):
--   • Giám sát vận hành "kẹt": 8.760 pallet — thực tế bị giữ chỉ 5
--   • Vị trí bị coi là QA giữ: 227/230 — thực tế 4
--   • 83 mã không chốt được BẤT KỲ mức %Date nào dù kho còn hàng xuất được
-- Không phải rác dữ liệu: quét nhập tem V2 (`;`) TỰ đóng dấu OK (`qa_ok ? 'OK' : 'X'`), nên đơn vị
-- dùng tem chấm phẩy sẽ có 100 % tồn vô hình. Migration đầu tiên cũng đã ghi rõ ý định:
-- "bỏ trống = mặc định OK, không cần lưu vào qa_status_id" ⇒ dấu OK phải được coi NHƯ BỎ TRỐNG.
--
-- Bản TypeScript của cùng luật: backend/src/services/qaStatus.ts (`qaHoldIds` / `qaNotHeldFilter`).
-- Thêm chỗ đọc QA mới → gọi `public.qa_is_hold()`, ĐỪNG viết lại `qa_status_id IS NOT NULL`.

CREATE OR REPLACE FUNCTION public.qa_is_hold(p_qa_status_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT p_qa_status_id IS NOT NULL
     AND coalesce((SELECT q.code FROM public."QAStatus" q WHERE q.id = p_qa_status_id), 'X') <> 'OK';
$function$;

COMMENT ON FUNCTION public.qa_is_hold(text) IS
  'Pallet có đang bị QA GIỮ không. Dấu OK = đã duyệt (xuất được); không tra được mã coi như giữ.';

-- ── control_tower_resources ──
CREATE OR REPLACE FUNCTION public.control_tower_resources(p_warehouse_ids text[] DEFAULT NULL::text[], p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
with day_range as (
  select ((p_today::timestamp at time zone 'Asia/Ho_Chi_Minh') at time zone 'UTC')       as t0,  -- naive UTC
         (((p_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') at time zone 'UTC') as t1,
         (p_today::timestamp at time zone 'Asia/Ho_Chi_Minh')       as z0,                        -- timestamptz
         ((p_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') as z1
),
scan_today as (
  select se.scanned_by
  from "OutboundScanEntry" se, day_range r
  where se.scanned_at >= r.t0 and se.scanned_at < r.t1
    and (p_warehouse_ids is null or exists (
      select 1 from "OutboundItem" oi
      join "OutboundDelivery" d on d.id = oi.do_id
      join "GroupDeliveryOrder" g on g.id = d.gdo_id
      where oi.id = se.item_id and g.warehouse_id = any(p_warehouse_ids)))
),
staff_out as (
  select count(distinct scanned_by) as n, count(*) as scans from scan_today where scanned_by is not null
),
top_out as (
  select coalesce(e.name, '—') as name, count(*) as scans
  from scan_today s
  left join "Employee" e on e.id::text = s.scanned_by
  where s.scanned_by is not null
  group by 1 order by 2 desc limit 5
),
staff_in as (
  select count(distinct ie.created_by) filter (where ie.created_by is not null) as n,
         count(*) as pallets
  from "InventoryEntry" ie
  where ie.import_date::date = p_today
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
),
stk as (
  select count(distinct st.counted_by) filter (where st.counted_by is not null) as n,
         count(*) as checks,
         count(*) filter (where st.location_changed_to is not null) as moves
  from "StocktakeLog" st, day_range r
  where st.counted_at >= r.z0 and st.counted_at < r.z1
    and (p_warehouse_ids is null or st.warehouse_id = any(p_warehouse_ids))
),
fk as (
  select l.status, coalesce(l.issue_count, 0) as issue_count, (l.id is not null) as checked
  from forklift_vehicles v
  left join forklift_daily_logs l on l.forklift_id = v.id and l.log_date = p_today
  where coalesce(v.is_active, true)
    and (p_warehouse_ids is null or v.warehouse_id = any(p_warehouse_ids))
),
fk_agg as (
  select count(*) as total,
         count(*) filter (where status = 'ACTIVE') as active,
         count(*) filter (where status = 'IDLE')   as idle,
         count(*) filter (where not checked)       as unchecked,
         coalesce(sum(issue_count), 0)             as issues
  from fk
),
inv as (
  select count(*) as total,
         count(*) filter (where public.qa_is_hold(ie.qa_status_id) or ie.status = 'QUARANTINE') as locked
  from "InventoryEntry" ie
  where ie.cartons_remaining > 0
    and ie.status in ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
),
gate_cycle as (
  select count(*) filter (where exit_at is not null)                                    as done_n,
         round(avg(extract(epoch from (exit_at - entry_at)) / 60)
               filter (where exit_at is not null and exit_at > entry_at))               as inout_mins,
         round(avg(extract(epoch from (entry_at - registered_at)) / 60)
               filter (where registered_at is not null and entry_at > registered_at))   as wait_mins
  from gate_registrations g
  where g.date = p_today and g.entry_at is not null
    and (p_warehouse_ids is null or g.warehouse_id = any(p_warehouse_ids))
)
select jsonb_build_object(
  'staff_out', (select jsonb_build_object('n', n, 'scans', scans) from staff_out),
  'top_out',   (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'scans', scans) order by scans desc), '[]'::jsonb) from top_out),
  'staff_in',  (select jsonb_build_object('n', coalesce(n, 0), 'pallets', pallets) from staff_in),
  'stocktake', (select jsonb_build_object('n', coalesce(n, 0), 'checks', checks, 'moves', moves) from stk),
  'forklift',  (select jsonb_build_object('total', total, 'active', active, 'idle', idle, 'unchecked', unchecked, 'issues', issues) from fk_agg),
  'inventory', (select jsonb_build_object('total', total, 'locked', locked) from inv),
  'gate_cycle',(select jsonb_build_object('done_n', done_n, 'inout_mins', inout_mins, 'wait_mins', wait_mins) from gate_cycle)
)
$function$;

-- ── outbound_shortage_stats ──
CREATE OR REPLACE FUNCTION public.outbound_shortage_stats(p_warehouse_id text, p_date date)
 RETURNS TABLE(material_id text, demand numeric, available numeric, planned_remaining numeric)
 LANGUAGE sql
 STABLE
AS $function$
WITH demand AS (
  SELECT oi.material_id,
         SUM(GREATEST(COALESCE(oi.cartons_ordered, 0) - COALESCE(oi.cartons_scanned, 0), 0)) AS demand
  FROM "OutboundItem" oi
  JOIN "OutboundDelivery" od ON od.id = oi.do_id
  JOIN "GroupDeliveryOrder" g ON g.id = od.gdo_id
  WHERE g.warehouse_id = p_warehouse_id
    AND g.delivery_date = p_date
    AND g.status <> 'CANCELLED'
    AND oi.material_id IS NOT NULL
  GROUP BY oi.material_id
),
avail AS (
  SELECT ie.material_id, SUM(ie.cartons_remaining) AS available
  FROM "InventoryEntry" ie
  LEFT JOIN "Location" l ON l.id = ie.location_id
  WHERE COALESCE(l.warehouse_id, ie.warehouse_id::text) = p_warehouse_id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING')
    AND ie.cartons_remaining > 0
    AND NOT public.qa_is_hold(ie.qa_status_id)
    AND ie.material_id IN (SELECT d.material_id FROM demand d)
  GROUP BY ie.material_id
),
plan AS (
  SELECT ipl.material_id, ipl.tms_order_id, SUM(COALESCE(ipl.planned_boxes, 0)) AS planned
  FROM inbound_plan_lines ipl
  WHERE ipl.warehouse_id = p_warehouse_id
    AND ipl.status = 'ACTIVE'
    AND ipl.date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    AND ipl.date <= p_date
    AND ipl.material_id IN (SELECT d.material_id FROM demand d)
  GROUP BY ipl.material_id, ipl.tms_order_id
),
received AS (
  SELECT COALESCE(pi.tms_order_id, gr.tms_order_id) AS tms_order_id, pi.material_id,
         SUM(COALESCE(ie.cartons_imported, 0)) AS received
  FROM "ProductionImport" pi
  LEFT JOIN gate_registrations gr ON gr.id = pi.gate_registration_id
  JOIN "InventoryEntry" ie ON ie.import_order_id = pi.id
  WHERE COALESCE(pi.tms_order_id, gr.tms_order_id) IN (SELECT p.tms_order_id FROM plan p WHERE p.tms_order_id IS NOT NULL)
  GROUP BY 1, 2
),
plan_net AS (
  SELECT p.material_id, SUM(GREATEST(p.planned - COALESCE(r.received, 0), 0)) AS planned_remaining
  FROM plan p
  LEFT JOIN received r ON r.tms_order_id = p.tms_order_id AND r.material_id = p.material_id
  GROUP BY p.material_id
)
SELECT d.material_id, d.demand,
       COALESCE(a.available, 0)          AS available,
       COALESCE(pn.planned_remaining, 0) AS planned_remaining
FROM demand d
LEFT JOIN avail a     ON a.material_id = d.material_id
LEFT JOIN plan_net pn ON pn.material_id = d.material_id
WHERE d.demand > 0
$function$;

-- ── putaway_slot_facts ──
CREATE OR REPLACE FUNCTION public.putaway_slot_facts(p_loc_ids text[], p_material_id text DEFAULT NULL::text, p_with_lots boolean DEFAULT false, p_with_mats boolean DEFAULT false)
 RETURNS TABLE(location_id text, pallets integer, materials integer, same_material boolean, qa_hold boolean, nccs uuid[], mats text[], lots jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  WITH live AS (
    SELECT ie.location_id, ie.material_id, ie.ncc_id, ie.qa_status_id,
           ie.production_date, ie.expiry_date, ie.shelf_life_days
    FROM public."InventoryEntry" ie
    WHERE ie.location_id = ANY(p_loc_ids)
      AND ie.stack_layer = 1
      AND ie.status IN ('IN_STOCK', 'PARTIAL')
      AND COALESCE(ie.cartons_remaining, 0) > 0
  ),
  grp AS (
    SELECT l.location_id, l.material_id, l.ncc_id, l.shelf_life_days,
           (l.expiry_date IS NULL)  AS no_exp,
           min(l.production_date)   AS pmin,
           max(l.production_date)   AS pmax,
           min(l.expiry_date)       AS emin,
           max(l.expiry_date)       AS emax
    FROM live l
    GROUP BY l.location_id, l.material_id, l.ncc_id, l.shelf_life_days, (l.expiry_date IS NULL)
  )
  SELECT l.location_id,
         count(*)::int                                                        AS pallets,
         count(DISTINCT l.material_id)::int                                   AS materials,
         bool_or(p_material_id IS NOT NULL AND l.material_id = p_material_id) AS same_material,
         bool_or(public.qa_is_hold(l.qa_status_id))                                  AS qa_hold,
         -- NULL = pallet chưa khai NCC → không kết luận (quy ước null-inclusive toàn app)
         COALESCE(array_remove(array_agg(DISTINCT l.ncc_id), NULL), '{}'::uuid[]) AS nccs,
         CASE WHEN NOT p_with_mats THEN '{}'::text[]
              ELSE COALESCE(array_remove(array_agg(DISTINCT l.material_id), NULL), '{}'::text[])
         END                                                                  AS mats,
         CASE WHEN NOT p_with_lots THEN '[]'::jsonb ELSE COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'm', g.material_id, 'n', g.ncc_id, 's', g.shelf_life_days,
                    'no_exp', g.no_exp, 'pmin', g.pmin, 'pmax', g.pmax,
                    'emin', g.emin, 'emax', g.emax))
           FROM grp g WHERE g.location_id = l.location_id
         ), '[]'::jsonb) END                                                  AS lots
  FROM live l
  GROUP BY l.location_id
$function$;


COMMIT;
-- === HẾT PART 7/10 ===
