-- ============================================================================
-- CUTOVER production 24/09/2026 — PART 8/10
-- 9 migration · 20260914_directed_board_item_units.sql → 20260915d_fill_reconcile_queue.sql
-- Dán TRỌN file vào Supabase SQL Editor của project PRODUCTION svicyfquresxaigfxsdb rồi Run.
-- Cả part nằm trong MỘT transaction: lỗi bất kỳ đâu = rollback trọn part, schema không dở dang.
-- Chạy lại lần hai sẽ báo "đã tồn tại" rồi tự rollback — không hỏng gì.
-- ============================================================================
BEGIN;


-- ─────────────────────────────────────────────────────────────────────────
-- [20260914_directed_board_item_units.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260914 — Việc cần làm: xử lý TẠI CHỖ, không rời trang (bậc 1+2 đề nghị 14/09, user duyệt)
-- ============================================================================
-- Hai bổ sung cho RPC directed_board, cùng chữ ký ⇒ CREATE OR REPLACE thay tại chỗ, không nạp chồng:
--   • rows[].item_id — tab Sắp quét: dòng việc NHẶT LẺ có lối "Trừ tồn nhặt lẻ ›" trỏ thẳng tới
--     dòng hàng (bước trừ tồn thật nằm ở nút "Check nhặt lẻ (n)" của trang dòng hàng, trang này
--     chỉ CHỈ ĐƯỜNG, không mở cửa sau).
--   • unset_items[] mang material_id · tên · loại · quy cách (units_per_carton/entry_unit/base_unit)
--     · tên NPP — để băng vàng "chưa khai quy định date" mở thẳng SetDateRuleSheet ngay trên trang
--     ("Khai ngay") thay vì bắt người chốt đi sang trang chuyến rồi quay lại tay.
-- Sinh từ định nghĩa đang chạy trên staging bằng scratchpad/ops/gen_mig_board.mjs (thay đúng 4 chỗ).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.directed_board(p_warehouse_id text, p_mode text, p_gdo_id text DEFAULT NULL::text, p_driver_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
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
      min(t.item_id)                             AS item_id,
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
      'item_id',        g.item_id,
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
           'delivery_date', x.delivery_date,
           'material_id', x.material_id, 'material_name', x.material_name, 'material_category', x.material_category,
           'units_per_carton', x.units_per_carton, 'entry_unit', x.entry_unit, 'base_unit', x.base_unit,
           'customer_name', x.distributor_name
         ) ORDER BY x.group_code, x.material_code_raw), '[]'::jsonb)
    INTO v_alerts
    FROM (
      SELECT g.id AS gdo_id, g.group_code, g.delivery_date, i.id AS item_id, i.material_code_raw, i.header_text,
             (COALESCE(i.cartons_ordered, 0) - COALESCE(i.cartons_scanned, 0)) AS remaining,
             i.material_id, m.short_name AS material_name, m.category AS material_category,
             m.units_per_carton, m.entry_unit, m.base_unit, d.distributor_name
        FROM public."GroupDeliveryOrder" g
        JOIN public."OutboundDelivery"   d ON d.gdo_id = g.id
        JOIN public."OutboundItem"       i ON i.do_id  = d.id
        LEFT JOIN public."Material"      m ON m.id = i.material_id
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
$function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260914b_directed_board_equiv.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260914b — Việc cần làm: LỆNH = "lấy N pallet ở ô X", tem pallet chỉ là gợi ý (user chốt 14/09)
-- ============================================================================
-- "Trên dãy có 43 pallet đều thoả điều kiện (chung một date) thì pallet nào cũng được." Kế hoạch ghim
-- một entry_id chỉ để giữ chỗ mềm giữa các chuyến, KHÔNG phải mệnh lệnh. Đo Ba Vì 14/09: 14/17 việc
-- đang treo có pallet tương đương ngay trong cùng ô (TB 5, nhiều nhất 10). Trước đó bảng in tem ghim
-- như lệnh và quét pallet khác cái ghim bị huỷ OTHER_PALLET ⇒ "% làm đúng kế hoạch" trừ điểm người
-- làm ĐÚNG nghiệp vụ.
-- RPC directed_board (cùng chữ ký ⇒ CREATE OR REPLACE tại chỗ):
--   • rows[].n_equiv  — số pallet trong ô cùng mã + cùng NSX/HSD/mã lô với pallet ghim
--   • rows[].cell_ndates — ô có mấy NSX khác nhau của mã đó (> 1 thì bảng phải nói rõ lấy NSX nào)
--   • rows[].n_done — đã quét mấy pallet trong nhóm (Sắp quét nay gom theo Ô như hai bảng kia)
-- Cửa quét (services/directedTasks.ts markTaskDoneByScan / skipTasksOnForeignScan): pallet tương
-- đương = đúng việc, đổi ghim rồi đóng; chỉ khác ô / khác date mới là OTHER_PALLET.
-- Sinh từ định nghĩa đang chạy trên staging bằng scratchpad/ops/gen_mig_board2.mjs (thay đúng 4 chỗ).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.directed_board(p_warehouse_id text, p_mode text, p_gdo_id text DEFAULT NULL::text, p_driver_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
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
           -- PALLET TƯƠNG ĐƯƠNG (user 14/09: "43 pallet chung một date thì pallet nào cũng được"): bảng
           -- chỉ ra lệnh "lấy N pallet ở ô X"; cái ghim chỉ là gợi ý. n_equiv = số pallet trong ô cùng
           -- mã + cùng NSX/HSD/mã lô với pallet ghim; cell_ndates = ô có mấy NSX khác nhau của mã đó
           -- (> 1 ⇒ phải nói rõ lấy NSX nào, vì lúc đó "lấy pallet nào" mới là câu hỏi thật).
           (SELECT count(*) FROM public."InventoryEntry" x
             WHERE x.location_id = t.from_location_id AND x.material_id = t.material_id
               AND x.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') AND x.cartons_remaining > 0
               AND COALESCE(x.production_date::text, '') = COALESCE(ie.production_date::text, '')
               AND COALESCE(x.expiry_date::text, '')     = COALESCE(ie.expiry_date::text, '')
               AND COALESCE(x.batch, '')                 = COALESCE(ie.batch, '')) AS n_equiv,
           (SELECT count(DISTINCT x.production_date) FROM public."InventoryEntry" x
             WHERE x.location_id = t.from_location_id AND x.material_id = t.material_id
               AND x.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') AND x.cartons_remaining > 0) AS cell_ndates,
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
      -- MỌI bảng gom theo Ô (14/09): "lấy N pallet ở ô X". Trước đó Sắp quét mỗi tem một dòng, tức
      -- bảng đọc như mệnh lệnh phải quét ĐÚNG tem đó — trong khi ô cùng date thì pallet nào cũng được.
      t.gdo_id || '|' || COALESCE(t.current_code, '?') || '|' || COALESCE(t.to_code, '?') || '|' || t.kind
        || CASE WHEN t.skipped THEN '|S' ELSE '' END AS group_key,
      min(t.seq)                                 AS seq,
      jsonb_agg(t.id ORDER BY t.seq)             AS task_ids,
      count(*)                                   AS n_pallets,
      count(*) FILTER (WHERE t.status = 'DONE')  AS n_done,
      min(t.n_equiv)                             AS n_equiv,
      max(t.cell_ndates)                         AS cell_ndates,
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
      min(t.item_id)                             AS item_id,
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
      'item_id',        g.item_id,
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
      'n_done',         g.n_done,
      'n_equiv',        g.n_equiv,
      'cell_ndates',    g.cell_ndates,
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
           'delivery_date', x.delivery_date,
           'material_id', x.material_id, 'material_name', x.material_name, 'material_category', x.material_category,
           'units_per_carton', x.units_per_carton, 'entry_unit', x.entry_unit, 'base_unit', x.base_unit,
           'customer_name', x.distributor_name
         ) ORDER BY x.group_code, x.material_code_raw), '[]'::jsonb)
    INTO v_alerts
    FROM (
      SELECT g.id AS gdo_id, g.group_code, g.delivery_date, i.id AS item_id, i.material_code_raw, i.header_text,
             (COALESCE(i.cartons_ordered, 0) - COALESCE(i.cartons_scanned, 0)) AS remaining,
             i.material_id, m.short_name AS material_name, m.category AS material_category,
             m.units_per_carton, m.entry_unit, m.base_unit, d.distributor_name
        FROM public."GroupDeliveryOrder" g
        JOIN public."OutboundDelivery"   d ON d.gdo_id = g.id
        JOIN public."OutboundItem"       i ON i.do_id  = d.id
        LEFT JOIN public."Material"      m ON m.id = i.material_id
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
$function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260914c_directed_board_arg_limit.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260914c — directed_board: rows vượt TRẦN 100 THAM SỐ của jsonb_build_object (đo thật 14/09)
-- ============================================================================
-- Sau 20260914b, object mỗi dòng việc có 51 khoá ⇒ Postgres từ chối "cannot pass more than 100
-- arguments to a function" ⇒ GET /wms/directed/board 500, bảng trống (gói 57 [10a] bắt ngay khi chạy
-- trên Preview). Vá: tách thành hai jsonb_build_object nối bằng || ngay trong jsonb_agg — kết quả
-- JSON y hệt, không đổi chữ ký. Bài học: RPC trả dòng jsonb "rộng" thì đếm khoá trước khi thêm; trần
-- này không có ở tsc/QA tĩnh, chỉ lộ khi gọi thật.
-- Sinh bằng scratchpad/ops/gen_mig_board3.mjs (thay đúng 1 chỗ).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.directed_board(p_warehouse_id text, p_mode text, p_gdo_id text DEFAULT NULL::text, p_driver_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
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
           -- PALLET TƯƠNG ĐƯƠNG (user 14/09: "43 pallet chung một date thì pallet nào cũng được"): bảng
           -- chỉ ra lệnh "lấy N pallet ở ô X"; cái ghim chỉ là gợi ý. n_equiv = số pallet trong ô cùng
           -- mã + cùng NSX/HSD/mã lô với pallet ghim; cell_ndates = ô có mấy NSX khác nhau của mã đó
           -- (> 1 ⇒ phải nói rõ lấy NSX nào, vì lúc đó "lấy pallet nào" mới là câu hỏi thật).
           (SELECT count(*) FROM public."InventoryEntry" x
             WHERE x.location_id = t.from_location_id AND x.material_id = t.material_id
               AND x.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') AND x.cartons_remaining > 0
               AND COALESCE(x.production_date::text, '') = COALESCE(ie.production_date::text, '')
               AND COALESCE(x.expiry_date::text, '')     = COALESCE(ie.expiry_date::text, '')
               AND COALESCE(x.batch, '')                 = COALESCE(ie.batch, '')) AS n_equiv,
           (SELECT count(DISTINCT x.production_date) FROM public."InventoryEntry" x
             WHERE x.location_id = t.from_location_id AND x.material_id = t.material_id
               AND x.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') AND x.cartons_remaining > 0) AS cell_ndates,
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
      -- MỌI bảng gom theo Ô (14/09): "lấy N pallet ở ô X". Trước đó Sắp quét mỗi tem một dòng, tức
      -- bảng đọc như mệnh lệnh phải quét ĐÚNG tem đó — trong khi ô cùng date thì pallet nào cũng được.
      t.gdo_id || '|' || COALESCE(t.current_code, '?') || '|' || COALESCE(t.to_code, '?') || '|' || t.kind
        || CASE WHEN t.skipped THEN '|S' ELSE '' END AS group_key,
      min(t.seq)                                 AS seq,
      jsonb_agg(t.id ORDER BY t.seq)             AS task_ids,
      count(*)                                   AS n_pallets,
      count(*) FILTER (WHERE t.status = 'DONE')  AS n_done,
      min(t.n_equiv)                             AS n_equiv,
      max(t.cell_ndates)                         AS cell_ndates,
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
      min(t.item_id)                             AS item_id,
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
      'item_id',        g.item_id,
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
      'n_pallets',      g.n_pallets
    ) || jsonb_build_object(   -- tách hai object: một jsonb_build_object chỉ nhận ≤ 100 tham số (50 khoá)
      'n_done',         g.n_done,
      'n_equiv',        g.n_equiv,
      'cell_ndates',    g.cell_ndates,
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
           'delivery_date', x.delivery_date,
           'material_id', x.material_id, 'material_name', x.material_name, 'material_category', x.material_category,
           'units_per_carton', x.units_per_carton, 'entry_unit', x.entry_unit, 'base_unit', x.base_unit,
           'customer_name', x.distributor_name
         ) ORDER BY x.group_code, x.material_code_raw), '[]'::jsonb)
    INTO v_alerts
    FROM (
      SELECT g.id AS gdo_id, g.group_code, g.delivery_date, i.id AS item_id, i.material_code_raw, i.header_text,
             (COALESCE(i.cartons_ordered, 0) - COALESCE(i.cartons_scanned, 0)) AS remaining,
             i.material_id, m.short_name AS material_name, m.category AS material_category,
             m.units_per_carton, m.entry_unit, m.base_unit, d.distributor_name
        FROM public."GroupDeliveryOrder" g
        JOIN public."OutboundDelivery"   d ON d.gdo_id = g.id
        JOIN public."OutboundItem"       i ON i.do_id  = d.id
        LEFT JOIN public."Material"      m ON m.id = i.material_id
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
$function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260914d_work_inbox_trip_name.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260914d — work_inbox: tên chuyến trong Hộp việc = SỐ XE · biển số (user chốt 14/09)
-- ============================================================================
-- "Trong nội dung luôn phải gắn kèm với số xe." Bản cũ in COALESCE(biển số, Số xe) nên chuyến có biển
-- thì Số xe (group_code — khoá điều vận / SAP / Kế hoạch xuất cùng gọi) biến mất khỏi dòng việc.
-- Nay: Số xe trước, biển số sau (bỏ lặp khi hai giá trị trùng). Cùng chữ ký, CREATE OR REPLACE.
-- FE cùng đợt: helper tripName() ở TaskDetailSheet.tsx dùng cho bảng · thẻ · panel chi tiết · giám sát.
-- Sinh bằng scratchpad/ops/gen_mig_inbox.mjs (thay đúng 2 chỗ).
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



-- ─────────────────────────────────────────────────────────────────────────
-- [20260914e_replan_queue.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260914e — HÀNG ĐỢI SẮP LẠI THEO TỒN: kế hoạch lấy hàng phải theo tồn HIỆN TẠI (user chốt 14/09)
-- ============================================================================
-- User: "khi lái xe nâng hạ hàng, tại thời điểm hạ họ check được tồn mới nhất; hệ thống chỉ đặt việc lúc
-- Bắt đầu thì không realtime bằng trước — bước lùi." Đúng. Kế hoạch chụp lúc Bắt đầu sống mãi dù hàng
-- date ngắn hơn vừa về, pallet ghim vừa bị chuyển chỗ / QA giữ / xuất cho chuyến khác.
--
-- Cách làm: TRIGGER trên InventoryEntry ghi (kho, mã) vào hàng đợi khi mã đó ĐANG có việc treo chưa ai
-- đụng; máy chủ XẢ hàng đợi mỗi lần bảng Việc cần làm tải (PDA tự tải lại theo tín hiệu realtime) —
-- chạy thử kế hoạch, khác bộ pallet mới bỏ việc chưa ai đụng và ghim lại (`services/directedTasks.ts`
-- `drainReplanQueue`). Vì sao không sắp lại trong trigger: luật chọn pallet (luân chuyển · %Date · BFS)
-- nằm ở Node, chép xuống SQL là đúng khuôn "4 bản chép tay". Vì sao không xả trong đường ghi tồn: đường
-- ghi tồn có ~10 cửa (quét nhập · chuyển vị trí · QA · dồn/tách · upload · quét xuất…), gắn từng cửa là
-- sót; trigger ở DB bắt MỌI đường ghi kể cả script. Chi phí trigger: một EXISTS trên index riêng phần +
-- một upsert — không đụng độ trễ quét.
--
-- Bảng nội bộ: KHÔNG policy cho authenticated/anon (mặc định đã đóng), KHÔNG bắn realtime (bỏ trigger
-- wms_notify mà event trigger tự gắn lúc CREATE TABLE).
-- ============================================================================

-- ⚠ `InventoryEntry.warehouse_id` / `material_id` là TEXT (48/82 bảng khoá text — memory pg-error-is-user-error),
-- bản đầu khai uuid ⇒ INSERT trong trigger nổ 42804 và bị EXCEPTION nuốt: hàng đợi im lặng rỗng, gói 57 [24b] bắt.
DROP TABLE IF EXISTS public.wms_replan_queue;
CREATE TABLE public.wms_replan_queue (
  warehouse_id text        NOT NULL,
  material_id  text        NOT NULL,
  queued_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, material_id)
);
DROP TRIGGER IF EXISTS trg_wms_notify ON public.wms_replan_queue;
ALTER TABLE public.wms_replan_queue ENABLE ROW LEVEL SECURITY;

-- Trigger hỏi "mã này đang có việc treo chưa ai đụng không?" — index riêng phần để câu đó rẻ
CREATE INDEX IF NOT EXISTS idx_wms_tasks_pending_wh_mat
  ON public.wms_tasks (warehouse_id, material_id)
  WHERE status = 'PENDING' AND lowered_at IS NULL AND moved_at IS NULL;

CREATE OR REPLACE FUNCTION public.wms_replan_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
BEGIN
  r := COALESCE(NEW, OLD);
  IF r.warehouse_id IS NULL OR r.material_id IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (
    SELECT 1 FROM public.wms_tasks t
    WHERE t.warehouse_id = r.warehouse_id AND t.material_id = r.material_id
      AND t.status = 'PENDING' AND t.lowered_at IS NULL AND t.moved_at IS NULL
    LIMIT 1
  ) THEN
    INSERT INTO public.wms_replan_queue (warehouse_id, material_id, queued_at)
    VALUES (r.warehouse_id, r.material_id, now())
    ON CONFLICT (warehouse_id, material_id) DO UPDATE SET queued_at = EXCLUDED.queued_at;
  END IF;
  -- Pallet CHUYỂN KHO: kho cũ cũng mất một pallet
  IF TG_OP = 'UPDATE' AND OLD.warehouse_id IS DISTINCT FROM NEW.warehouse_id AND OLD.warehouse_id IS NOT NULL THEN
    INSERT INTO public.wms_replan_queue (warehouse_id, material_id, queued_at)
    SELECT OLD.warehouse_id, OLD.material_id, now()
    WHERE EXISTS (SELECT 1 FROM public.wms_tasks t WHERE t.warehouse_id = OLD.warehouse_id AND t.material_id = OLD.material_id
                    AND t.status = 'PENDING' AND t.lowered_at IS NULL AND t.moved_at IS NULL LIMIT 1)
    ON CONFLICT (warehouse_id, material_id) DO UPDATE SET queued_at = EXCLUDED.queued_at;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;   -- hàng đợi hỏng không được làm hỏng giao dịch tồn kho
END $$;

DROP TRIGGER IF EXISTS trg_wms_replan_enqueue ON public."InventoryEntry";
CREATE TRIGGER trg_wms_replan_enqueue
  AFTER INSERT OR DELETE OR UPDATE OF status, cartons_remaining, cartons_reserved, location_id, qa_status_id,
    production_date, expiry_date, warehouse_id, material_id
  ON public."InventoryEntry"
  FOR EACH ROW EXECUTE FUNCTION public.wms_replan_enqueue();



-- ─────────────────────────────────────────────────────────────────────────
-- [20260915_auto_fill.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260915 — FILL HÀNG TỰ RA LỆNH (user chốt 15/09: "fill hàng phục vụ nhặt lẻ — ra lệnh tự động được không?")
--
-- Vì sao: đo staging 15/09 — module Fill ra 05/08 mà tới nay có **0 lệnh fill** nào được tạo, trong khi
-- đường TỰ ĐỘNG (việc LOOSE_FEED do bộ lập kế hoạch đặt lúc Bắt đầu chuyến) đã chạy thật (9 việc, 3 xong).
-- Nút "Ra lệnh fill" là một nhát bấm nằm giữa "máy đã biết phải hạ gì" và "người đi hạ", và sáu tuần cho
-- thấy không ai đi qua nó. Nay máy tự ra lệnh; người vẫn quyết AI LÀM và LÚC NÀO (lệnh không gán ai, hiện
-- ở Hộp việc → "Việc chung của kho" — nhánh đó `work_inbox` đã có sẵn).
--
-- MẶC ĐỊNH TẮT cho cả 153 kho: tự ra lệnh là đổi hành vi, không tự bật hộ ai (cùng khuôn `date_rule_policy`).

-- CÔNG TẮC 2 TẦNG như mọi chiến thuật khác (user chốt 15/09: "tự động hoặc bằng tay thì cần có
-- setting cho Kho và loại kho nha"): mặc định của KHO + ghi đè theo LOẠI KHO. Ở tầng loại, NULL =
-- "kế thừa kho" — nên `false` của loại vẫn TẮT được cái mà kho đang bật (vd kho bật auto, riêng
-- POSM thì thôi vì hàng POSM không đo được date, hạ xuống ô lẻ cũng chẳng theo lô nào).
alter table "Warehouse"              add column if not exists auto_fill    boolean not null default false;
alter table "warehouse_type_configs" add column if not exists auto_fill    boolean;
alter table "FillOrder"              add column if not exists auto_created boolean not null default false;

comment on column "Warehouse".auto_fill is
  'Tự ra lệnh fill hàng nhặt lẻ cho NGÀY XUẤT HÔM NAY (không gán ai). Mặc định TẮT.';
comment on column "warehouse_type_configs".auto_fill is
  'Ghi đè công tắc tự ra lệnh fill theo LOẠI KHO. NULL = theo cấu hình của kho.';
comment on column "FillOrder".auto_created is
  'Lệnh do hệ thống tự đặt (không phải người bấm) — để còn phân biệt khi soi lại.';

-- Dòng do máy đặt mà nhu cầu đã hết (đơn huỷ / đổi ngày / hàng đã có đủ ở ô lẻ) thì phải TỰ THU HỒI,
-- nếu không sẽ có người đi hạ một pallet không ai cần và chiếm mất ô nhặt lẻ. Chỉ thu hồi dòng CHƯA AI
-- ĐỤNG — cùng luật với "sắp lại kế hoạch" của Việc cần làm. Index riêng phần cho câu quét đó.
create index if not exists idx_filltask_auto_pending
  on "FillTask" (warehouse_id, target_date)
  where status = 'PENDING' and assignee_id is null and coalesce(scanned_pallets, 0) = 0;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260915b_fill_order_daily.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260915b — LỆNH FILL THEO NGÀY (user chốt 15/09):
--   "1 ngày, 1 kho, 1 loại kho chỉ có 1 lệnh fill — chi tiết trong đó thay đổi, cuối ngày Hoàn thành"
--   + "lệnh fill có thể được vào gán người, và người đó sẽ nhận kế hoạch cả ngày".
--
-- VÌ SAO ĐỔI MÔ HÌNH: bản 05/08 đóng đinh "một lần bấm Ra lệnh = MỘT lệnh" — đúng khi fill 100% do
-- người bấm (mỗi mẻ là một quyết định có chủ). Nhưng từ 15/09 MÁY cũng ra lệnh, mà máy không quyết
-- từng mẻ: nó liên tục trả lời MỘT câu hỏi "hôm nay kho này còn thiếu gì ở ô lẻ". Đơn vị công việc
-- đúng vì thế là TRẠNG THÁI của một ngày, không phải SỰ KIỆN của một lần bấm. Hệ quả đo được của mô
-- hình cũ: đơn phát sinh làm tăng nhu cầu cho mã ĐÃ có dòng treo cùng NSX thì dòng mới đụng khoá
-- uq_filltask_pending_matdate ⇒ đường tự động nuốt 23505 và phần tăng KHÔNG BAO GIỜ thành lệnh
-- (đường bấm tay thì cộng dồn — hai cửa cùng một sổ mà khác luật, lớp lỗi quen thuộc).
--
-- SAU MIGRATION NÀY:
--   · khoá ổn định (kho, ngày xuất, loại kho) ⇒ mọi thay đổi là UPDATE dòng, không còn tranh INSERT;
--   · giảm được TỪNG PHẦN (không còn "thừa 30 mà dòng 100 nên không rút gì"), sàn = phần ĐÃ QUÉT;
--   · lệnh KHÔNG tự DONE khi hết dòng treo — nếu tự đóng thì 10h sáng đóng, 11h có đơn mới là phải
--     mở lại một chứng từ đã đóng. Lệnh chỉ ĐANG MỞ (PENDING) → ĐÃ CHỐT (DONE, cuối ngày);
--   · gán người ở cấp LỆNH = nhận kế hoạch cả ngày, dòng máy thêm sau tự kế thừa người đó.
--
-- Idempotent (chạy lại không hỏng).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Cột mới trên FillOrder
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "FillOrder"
  ADD COLUMN IF NOT EXISTS warehouse_type text,                       -- NULL = mã chưa khai Loại kho
  ADD COLUMN IF NOT EXISTS assignee_id    text REFERENCES "Employee"(id),
  ADD COLUMN IF NOT EXISTS assignee_name  text,
  ADD COLUMN IF NOT EXISTS assigned_by    text,
  ADD COLUMN IF NOT EXISTS assigned_at    timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by      text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) GỘP lệnh đang mở về đúng một lệnh cho mỗi (kho, ngày, loại kho)
--    Chỉ đụng lệnh/dòng còn PENDING — lịch sử đã chốt giữ nguyên hình dạng cũ.
-- ─────────────────────────────────────────────────────────────────────────────
WITH tcat AS (
  SELECT t.id AS task_id, t.fill_order_id, t.warehouse_id, t.target_date,
         COALESCE(m.category, '') AS cat
  FROM "FillTask" t
  LEFT JOIN "Material" m ON m.id = t.material_id
  WHERE t.status = 'PENDING' AND t.fill_order_id IS NOT NULL
), grp AS (
  -- lệnh đích của mỗi nhóm = lệnh CŨ NHẤT đang chứa dòng của nhóm đó (giữ mã lệnh người đã nhìn thấy)
  SELECT DISTINCT ON (c.warehouse_id, c.target_date, c.cat)
         c.warehouse_id, c.target_date, c.cat, o.id AS order_id
  FROM tcat c JOIN "FillOrder" o ON o.id = c.fill_order_id
  ORDER BY c.warehouse_id, c.target_date, c.cat, o.created_at, o.id
)
UPDATE "FillTask" t
   SET fill_order_id = g.order_id, updated_at = now()
  FROM tcat c
  JOIN grp g ON g.warehouse_id = c.warehouse_id AND g.target_date = c.target_date AND g.cat = c.cat
 WHERE t.id = c.task_id AND t.fill_order_id IS DISTINCT FROM g.order_id;

-- Vết quét đi theo dòng của nó (cột fill_order_id trên FillTaskScan là bản sao để lọc nhanh)
UPDATE "FillTaskScan" s
   SET fill_order_id = t.fill_order_id
  FROM "FillTask" t
 WHERE t.id = s.task_id AND s.fill_order_id IS DISTINCT FROM t.fill_order_id;

-- Khai Loại kho cho lệnh còn mở (sau khi gộp thì mỗi lệnh chỉ còn một loại)
WITH oc AS (
  SELECT t.fill_order_id AS oid,
         min(COALESCE(m.category, ''))                AS cat,
         count(DISTINCT COALESCE(m.category, ''))     AS n
  FROM "FillTask" t
  LEFT JOIN "Material" m ON m.id = t.material_id
  WHERE t.status = 'PENDING' AND t.fill_order_id IS NOT NULL
  GROUP BY 1
)
UPDATE "FillOrder" o
   SET warehouse_type = NULLIF(oc.cat, ''), updated_at = now()
  FROM oc
 WHERE o.id = oc.oid AND oc.n = 1 AND o.warehouse_type IS DISTINCT FROM NULLIF(oc.cat, '');

-- Lệnh bị rút hết dòng treo: còn dòng lịch sử ⇒ coi như ĐÃ CHỐT; rỗng hoàn toàn ⇒ xoá vỏ
UPDATE "FillOrder" o
   SET status = 'DONE', closed_at = now(), closed_by = 'Hệ thống (gộp lệnh theo ngày)', updated_at = now()
 WHERE o.status = 'PENDING'
   AND EXISTS (SELECT 1 FROM "FillTask" t WHERE t.fill_order_id = o.id)
   AND NOT EXISTS (SELECT 1 FROM "FillTask" t WHERE t.fill_order_id = o.id AND t.status = 'PENDING');

DELETE FROM "FillOrder" o
 WHERE o.status = 'PENDING'
   AND NOT EXISTS (SELECT 1 FROM "FillTask"     t WHERE t.fill_order_id = o.id)
   AND NOT EXISTS (SELECT 1 FROM "FillTaskScan" s WHERE s.fill_order_id = o.id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Khoá "một lệnh ĐANG MỞ cho mỗi (kho, ngày, loại)"
--    Chỉ áp cho PENDING: ngày đã chốt rồi mà phát sinh đơn muộn thì vẫn mở được lệnh mới —
--    khoá cả DONE là biến "chốt sổ" thành ngõ cụt.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE dup int;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT 1 FROM "FillOrder" WHERE status = 'PENDING'
     GROUP BY warehouse_id, target_date, COALESCE(warehouse_type, '') HAVING count(*) > 1
  ) d;
  IF dup > 0 THEN
    RAISE EXCEPTION 'Còn % nhóm (kho, ngày, loại) có >1 lệnh đang mở — dừng migration, xem lại bước gộp', dup;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fillorder_open
  ON "FillOrder" (warehouse_id, target_date, COALESCE(warehouse_type, ''))
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_fillorder_assignee
  ON "FillOrder" (assignee_id, target_date) WHERE assignee_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Rollup KHÔNG còn tự đóng lệnh
--    Giữ nguyên chữ ký (fill_scan_apply + fill_scan_wh_direct + controller đang gọi) nhưng đổi
--    nghĩa: lệnh của một ngày sống tới lúc được CHỐT. Tiến độ hiện bằng số dòng/thùng đã xong,
--    không bằng trạng thái lệnh.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fill_order_rollup(p_order_id text, p_now timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM "FillOrder" WHERE id = p_order_id;
  IF st IS NULL THEN RETURN NULL; END IF;
  UPDATE "FillOrder" SET updated_at = p_now WHERE id = p_order_id;
  RETURN st;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) fill_order_ensure — lấy-hoặc-tạo lệnh ĐANG MỞ của (kho, ngày, loại)
--    Trả cả người đang giữ kế hoạch để dòng mới KẾ THỪA: gán ở cấp lệnh = "nhận kế hoạch cả ngày",
--    nên dòng máy thêm lúc 11h phải thuộc về đúng người đã nhận từ 7h, không thì lời hứa đó rỗng.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fill_order_ensure(
  p_id           text,      -- id dựng sẵn ở caller (chỉ dùng khi phải TẠO)
  p_warehouse_id text,
  p_target_date  date,
  p_type         text,      -- NULL = mã chưa khai Loại kho
  p_order_code   text,
  p_auto         boolean,
  p_actor        text,
  p_now          text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE o "FillOrder"%ROWTYPE;
BEGIN
  FOR i IN 1..3 LOOP
    SELECT * INTO o FROM "FillOrder"
     WHERE warehouse_id = p_warehouse_id AND target_date = p_target_date
       AND COALESCE(warehouse_type, '') = COALESCE(p_type, '') AND status = 'PENDING'
     LIMIT 1;
    IF FOUND THEN RETURN to_jsonb(o) || jsonb_build_object('created', false); END IF;

    BEGIN
      INSERT INTO "FillOrder"(id, order_code, warehouse_id, target_date, warehouse_type,
                              status, auto_created, created_by, created_at, updated_at)
      VALUES (p_id, p_order_code, p_warehouse_id, p_target_date, p_type,
              'PENDING', COALESCE(p_auto, false), p_actor, p_now::timestamptz, p_now::timestamptz)
      RETURNING * INTO o;
      RETURN to_jsonb(o) || jsonb_build_object('created', true);
    EXCEPTION WHEN unique_violation THEN
      -- người khác vừa tạo (khoá ngày HOẶC khoá mã lệnh) → vòng sau đọc lại / caller đổi mã
      IF i = 3 THEN RETURN NULL; END IF;
      PERFORM pg_sleep(0.05 * i);
    END;
  END LOOP;
  RETURN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) fill_task_reduce — HẠ số lượng một dòng (thay cho "huỷ trọn dòng")
--    Sàn = phần ĐÃ QUÉT (user chốt): người đã hạ 60/100 thì dòng thành 60 và đóng, không thành 40.
--    Chỉ đụng dòng do MÁY đặt — giảm dòng người đặt là rút quyết định của người.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fill_task_reduce(
  p_task_id    text,
  p_target_qty numeric,
  p_reason     text,
  p_now        text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  t        "FillTask"%ROWTYPE;
  v_done   numeric;
  v_new    numeric;
  v_pal    int;
BEGIN
  SELECT * INTO t FROM "FillTask" WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND                     THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF t.status <> 'PENDING'         THEN RETURN jsonb_build_object('code', 'NOT_PENDING'); END IF;
  IF COALESCE(t.created_by,'') <> 'Hệ thống' THEN RETURN jsonb_build_object('code', 'MANUAL'); END IF;

  v_done := COALESCE(t.qty_done_base, 0);
  v_new  := GREATEST(COALESCE(p_target_qty, 0), v_done);
  IF v_new >= t.qty_base THEN RETURN jsonb_build_object('code', 'NOOP'); END IF;

  IF v_new <= 0 THEN
    UPDATE "FillTask"
       SET status = 'CANCELLED', cancel_reason = p_reason, updated_at = p_now::timestamptz
     WHERE id = t.id;
    RETURN jsonb_build_object('code', 'CANCELLED', 'freed', t.qty_base - v_done);
  END IF;

  -- Số pallet co theo SL, nhưng không thấp hơn số pallet đã quét (đã hạ rồi thì có thật)
  v_pal := GREATEST(COALESCE(t.scanned_pallets, 0), 1,
                    CEIL(v_new / NULLIF(t.qty_base, 0) * GREATEST(t.required_pallets, 1))::int);
  UPDATE "FillTask"
     SET qty_base = v_new, required_pallets = v_pal,
         status   = CASE WHEN v_done > 0 AND v_new <= v_done THEN 'DONE' ELSE 'PENDING' END,
         done_at  = CASE WHEN v_done > 0 AND v_new <= v_done THEN p_now::timestamptz ELSE done_at END,
         updated_at = p_now::timestamptz
   WHERE id = t.id;
  RETURN jsonb_build_object('code', 'REDUCED', 'freed', t.qty_base - v_new, 'qty', v_new);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) fill_order_close — CHỐT NGÀY
--    Dòng còn treo lúc chốt thì huỷ kèm lý do (xe đã đi rồi) — để lại dòng PENDING trong một lệnh
--    đã đóng là đẻ ra việc mồ côi không ai nhìn. Phần huỷ này cũng chính là mẫu số của báo cáo
--    "tỷ lệ hoàn thành" nên nó phải có vết, không được xoá.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fill_order_close(
  p_order_id text,
  p_actor    text,
  p_now      text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE o "FillOrder"%ROWTYPE; n int;
BEGIN
  SELECT * INTO o FROM "FillOrder" WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND              THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF o.status <> 'PENDING'  THEN RETURN jsonb_build_object('code', 'NOT_OPEN', 'status', o.status); END IF;

  UPDATE "FillTask"
     SET status = 'CANCELLED', cancel_reason = 'Chốt ngày — chưa thực hiện', updated_at = p_now::timestamptz
   WHERE fill_order_id = o.id AND status = 'PENDING';
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE "FillOrder"
     SET status = 'DONE', closed_at = p_now::timestamptz, closed_by = p_actor, updated_at = p_now::timestamptz
   WHERE id = o.id;
  RETURN jsonb_build_object('code', 'CLOSED', 'order_code', o.order_code, 'cancelled_lines', n);
END $$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260915c_rename_wh_type_fill_order.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260915c — Đổi tên Loại kho phải quét CẢ "FillOrder.warehouse_type" (cột sinh 15/09)
--
-- Bất biến gói 00 bắt ngay lần đầu có lệnh fill theo NGÀY: rename_warehouse_type cascade theo bản
-- đồ GHI TAY nên cột MỚI luôn bị bỏ lại — lần thứ BA cùng lớp lỗi (15/08 OutboundItem.material_type
-- + alert_events.category · 11/09 date_rule_master.category · nay FillOrder.warehouse_type).
--
-- Hậu quả nếu để nguyên: đổi tên một Loại kho xong, lệnh fill đang mở của loại đó trỏ vào mã KHÔNG
-- CÒN TỒN TẠI ⇒ fill_order_ensure không khớp lệnh nào và MỞ LỆNH THỨ HAI cho cùng ngày, phá đúng
-- bất biến "1 kho × 1 ngày × 1 loại kho = 1 lệnh" vừa dựng. Không lỗi, không cảnh báo.
--
-- Chỉ THÊM một câu UPDATE vào cascade; phần còn lại giữ nguyên bản 20260911j.
-- (Thân hàm được ghép tự động từ bản trước để không chép tay 114 dòng — xem phần dưới.)

CREATE OR REPLACE FUNCTION public.rename_warehouse_type(p_old text, p_new text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  counts jsonb := '{}'::jsonb;
  n bigint;
BEGIN
  p_new := btrim(p_new);
  IF p_old IS NULL OR p_new IS NULL OR p_new = '' OR p_old = p_new THEN
    RAISE EXCEPTION 'Tên mới không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = p_old) THEN
    RAISE EXCEPTION 'Loại kho "%" không tồn tại', p_old USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = p_new) THEN
    RAISE EXCEPTION 'Loại kho "%" đã tồn tại', p_new USING ERRCODE = '23505';
  END IF;

  UPDATE "LookupValue" SET value = p_new, updated_at = now()
    WHERE type = 'warehouse_type' AND value = p_old;

  UPDATE "Material" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Material', n);

  -- MẢNG (multi-loại 27/07): Location / WarehouseZone / StocktakeLog
  UPDATE "Location" SET categories = array_replace(categories, p_old, p_new)
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Location', n);

  UPDATE "WarehouseZone" SET categories = array_replace(categories, p_old, p_new)
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('WarehouseZone', n);

  UPDATE "StocktakeLog" SET categories = array_replace(categories, p_old, p_new), updated_at = now()
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('StocktakeLog', n);

  UPDATE "Employee" SET allowed_categories = array_replace(allowed_categories, p_old, p_new)
    WHERE p_old = ANY(allowed_categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Employee', n);

  UPDATE "Warehouse" SET carton_scan_categories = array_replace(carton_scan_categories, p_old, p_new)
    WHERE p_old = ANY(carton_scan_categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Warehouse', n);

  UPDATE warehouse_type_configs SET type_code = p_new, updated_at = now() WHERE type_code = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('warehouse_type_configs', n);

  UPDATE "SlotTemplate" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('SlotTemplate', n);

  UPDATE "DeliverySlot" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('DeliverySlot', n);

  UPDATE "TmsOrder" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('TmsOrder', n);

  -- Cửa đặt lịch (03/08) — giá trị ĐƠN, tách khỏi luật giao ≥1 nhưng vẫn là Loại kho
  UPDATE "TmsOrder" SET booking_category = p_new WHERE booking_category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('TmsOrder.booking_category', n);

  UPDATE khvc_lines SET booking_category = p_new WHERE booking_category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('khvc_lines', n);

  -- Chuyến chở lẫn: thay ĐÚNG phần tử trong chuỗi ghép (DISTINCT phòng khi ghép ra trùng)
  UPDATE "GroupDeliveryOrder"
     SET warehouse_type = (SELECT string_agg(DISTINCT c, '+')
                             FROM unnest(array_replace(wt_cats(warehouse_type), p_old, p_new)) c)
   WHERE wt_cats(warehouse_type) @> ARRAY[p_old];
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('GroupDeliveryOrder', n);

  -- snapshot Loại kho trên DÒNG ĐƠN XUẤT (= Material.category lúc tạo)
  UPDATE "OutboundItem" SET material_type = p_new WHERE material_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('OutboundItem', n);

  -- snapshot Loại kho trong cảnh báo vận hành
  UPDATE alert_events SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('alert_events', n);

  UPDATE gate_registrations SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('gate_registrations', n);

  UPDATE inbound_plan_lines SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('inbound_plan_lines', n);

  UPDATE "ProductionImport" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('ProductionImport', n);

  UPDATE "PalletLabelPrint" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('PalletLabelPrint', n);

  -- ⭐ MỚI 11/09 — MỨC QUY ĐỊNH DATE khai riêng theo LOẠI HÀNG (đợt 2). Sót cột này = đổi tên loại
  -- xong thì mức riêng của loại đó không khớp dòng nào và lặng lẽ rơi về mức "mọi loại còn lại".
  UPDATE date_rule_master SET category = p_new, updated_at = now() WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('date_rule_master', n);

  -- MỚI 15/09 — LỆNH FILL THEO NGÀY: khoá lệnh là (kho, ngày, LOẠI KHO).
  UPDATE "FillOrder" SET warehouse_type = p_new, updated_at = now() WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('FillOrder', n);

  RETURN counts;
END;
$function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260915d_fill_reconcile_queue.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260915d — FILL HÀNG: HÀNG ĐỢI ĐỐI CHIẾU THEO (kho, ngày xuất) + báo cáo tính dòng "chốt ngày — chưa thực hiện"
--
-- Ba việc user chốt 15/09 (vòng 3) sau khi rà rủi ro:
--
-- (1) "Đơn nhặt lẻ của NGÀY nào đổi thì máy ra lệnh cho NGÀY đó" — thay cho "có người mở trang thì soát
--     lại HÔM NAY, nghỉ 10 phút giữa hai lượt". Khuôn = `wms_replan_queue` (14/09): trigger ghi (kho, ngày)
--     vào hàng đợi khi đơn / chuyến / tồn ở ô lẻ / việc LOOSE_FEED đổi; lần đọc kế tiếp lấy dòng ra (DELETE
--     … RETURNING = nguyên tử, chỉ MỘT instance lấy được) rồi đối chiếu đúng ngày đó. Chân trời = hôm nay
--     và ngày mai: ca 22h chuẩn bị cho chuyến NGÀY MAI là lúc kho cần lệnh fill nhất, mà bản "chỉ hôm nay"
--     bỏ đúng ca đó. Không có pg_cron nên vẫn giữ một lượt QUÉT AN TOÀN mỗi 30 phút (thứ trigger bỏ sót:
--     quét nhặt lẻ làm nhu cầu tụt, đổi công tắc…) — nhưng mốc quét nằm Ở DB, không trong RAM lambda.
--
-- (2) THUÊ (lease) theo kho: hai instance cùng thấy "thiếu 100" thì `fill_task_topup` cộng delta hai lần —
--     dòng máy đặt tự hạ lại ở lượt sau, dòng NGƯỜI đặt thì thừa vĩnh viễn (máy không hạ dòng người).
--     `fill_reconcile_take` khoá dòng trạng thái của kho (FOR UPDATE), cấp lease 90 s; ai không có lease
--     thì để yên hàng đợi cho lượt sau. Lease hết hạn tự nhả — tiến trình chết không khoá kho mãi.
--
-- (3) Báo cáo Kết quả: `fill_report` lọc `status <> 'CANCELLED'` nên dòng "Chốt ngày — chưa thực hiện"
--     BIẾN MẤT khỏi mẫu số ⇒ sau chốt ai cũng 100 % — đúng lớp "đo mức phục vụ xoá dấu vết" (28/08).
--     Migration 20260915b tự hứa "phần huỷ này là mẫu số" mà RPC báo cáo không đọc. Nay chữ lý do có MỘT
--     nguồn (`fill_close_reason()`), cửa chốt ghi bằng nó, báo cáo đếm theo nó (cột `missed_n`).
--
-- Idempotent (chạy lại không hỏng).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) fill_close_reason — một chuỗi, hai chỗ dùng (cửa chốt + báo cáo)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fill_close_reason() RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'Chốt ngày — chưa thực hiện'::text $$;

CREATE OR REPLACE FUNCTION fill_order_close(
  p_order_id text,
  p_actor    text,
  p_now      text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE o "FillOrder"%ROWTYPE; n int;
BEGIN
  SELECT * INTO o FROM "FillOrder" WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND              THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF o.status <> 'PENDING'  THEN RETURN jsonb_build_object('code', 'NOT_OPEN', 'status', o.status); END IF;

  UPDATE "FillTask"
     SET status = 'CANCELLED', cancel_reason = fill_close_reason(), updated_at = p_now::timestamptz
   WHERE fill_order_id = o.id AND status = 'PENDING';
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE "FillOrder"
     SET status = 'DONE', closed_at = p_now::timestamptz, closed_by = p_actor, updated_at = p_now::timestamptz
   WHERE id = o.id;
  RETURN jsonb_build_object('code', 'CLOSED', 'order_code', o.order_code, 'cancelled_lines', n);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) fill_report — dòng huỷ vì CHỐT NGÀY ở lại mẫu số (missed_n); dòng máy thu hồi / người huỷ vẫn bỏ
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fill_report(
  p_wh_scope     text[],
  p_warehouse_id text,
  p_from         date,
  p_to           date
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
BEGIN
  IF p_wh_scope IS NOT NULL AND p_warehouse_id IS NOT NULL
     AND NOT (p_warehouse_id = ANY (p_wh_scope)) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'total', 0, 'done', 0, 'missed', 0, 'qty_entry', 0, 'unassigned', 0);
  END IF;

  RETURN (
    WITH t AS (
      SELECT f.*,
             qty_entry_decimal(f.qty_base, m.entry_unit, m.units_per_carton)      AS qty_entry,
             qty_entry_decimal(f.qty_done_base, m.entry_unit, m.units_per_carton) AS qty_done_entry,
             (f.status = 'CANCELLED' AND f.cancel_reason = fill_close_reason())   AS missed
      FROM "FillTask" f
      LEFT JOIN "Material" m ON m.id = f.material_id
      WHERE (f.status <> 'CANCELLED' OR f.cancel_reason = fill_close_reason())
        AND (p_warehouse_id IS NULL OR f.warehouse_id = p_warehouse_id)
        AND (p_wh_scope     IS NULL OR f.warehouse_id = ANY (p_wh_scope))
        AND (p_from IS NULL OR f.target_date >= p_from)
        AND (p_to   IS NULL OR f.target_date <= p_to)
    ),
    g AS (
      SELECT COALESCE(assignee_id, '__none__')                       AS assignee_id,
             COALESCE(max(assignee_name), 'Chưa gán')                AS assignee_name,
             count(*)                                                AS total_n,
             count(*) FILTER (WHERE status = 'DONE')                 AS done_n,
             count(*) FILTER (WHERE missed)                          AS missed_n,
             sum(qty_done_entry)                                     AS done_qty_entry,
             sum(qty_entry)                                          AS total_qty_entry,
             avg(EXTRACT(EPOCH FROM (done_at - COALESCE(assigned_at, created_at))) / 60.0)
               FILTER (WHERE status = 'DONE' AND done_at IS NOT NULL) AS avg_minutes
      FROM t GROUP BY COALESCE(assignee_id, '__none__')
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'assignee_id',     CASE WHEN assignee_id = '__none__' THEN NULL ELSE assignee_id END,
                 'assignee_name',   assignee_name,
                 'total_n',         total_n,
                 'done_n',          done_n,
                 'missed_n',        missed_n,
                 'pending_n',       total_n - done_n - missed_n,
                 'done_qty_entry',  COALESCE(done_qty_entry, 0),
                 'total_qty_entry', COALESCE(total_qty_entry, 0),
                 'avg_minutes',     CASE WHEN avg_minutes IS NULL THEN NULL ELSE round(avg_minutes::numeric, 1) END,
                 'rate',            CASE WHEN total_n = 0 THEN 0 ELSE round(done_n::numeric * 100 / total_n, 1) END)
               ORDER BY done_n::numeric / NULLIF(total_n, 0) NULLS FIRST, total_n DESC)
               FROM g), '[]'::jsonb),
      'total',      (SELECT count(*) FROM t),
      'done',       (SELECT count(*) FROM t WHERE status = 'DONE'),
      'missed',     (SELECT count(*) FROM t WHERE missed),
      'unassigned', (SELECT count(*) FROM t WHERE assignee_id IS NULL),
      'qty_entry',  (SELECT COALESCE(sum(qty_done_entry), 0) FROM t)
    )
  );
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Hàng đợi + trạng thái đối chiếu (bảng NỘI BỘ: không realtime, RLS đóng như wms_replan_queue)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fill_reconcile_queue (
  warehouse_id text        NOT NULL,
  target_date  date        NOT NULL,
  queued_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, target_date)
);
DROP TRIGGER IF EXISTS trg_wms_notify ON public.fill_reconcile_queue;
ALTER TABLE public.fill_reconcile_queue ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.fill_reconcile_state (
  warehouse_id text PRIMARY KEY,
  last_sweep   timestamptz,            -- lượt quét an toàn gần nhất (thay throttle trong RAM lambda)
  lease_until  timestamptz,            -- instance đang đối chiếu giữ kho tới lúc này
  updated_at   timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_wms_notify ON public.fill_reconcile_state;
ALTER TABLE public.fill_reconcile_state ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) fill_reconcile_enqueue — ghi (kho, ngày) nếu kho có bật tự ra lệnh và ngày trong chân trời
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fill_reconcile_enqueue(p_wh text, p_date date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
BEGIN
  IF p_wh IS NULL OR p_date IS NULL THEN RETURN; END IF;
  -- CHÂN TRỜI hôm nay + mai: ngày xa hơn được lượt quét an toàn bắt khi tới lượt; ngày đã qua thì xe đi rồi
  IF p_date < today OR p_date > today + 1 THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Warehouse" w WHERE w.id = p_wh AND w.auto_fill = true)
     AND NOT EXISTS (SELECT 1 FROM warehouse_type_configs c WHERE c.warehouse_id = p_wh AND c.auto_fill = true)
  THEN RETURN; END IF;
  INSERT INTO fill_reconcile_queue (warehouse_id, target_date, queued_at)
  VALUES (p_wh, p_date, now())
  ON CONFLICT (warehouse_id, target_date) DO UPDATE SET queued_at = EXCLUDED.queued_at;
EXCEPTION WHEN OTHERS THEN
  RETURN;   -- hàng đợi hỏng không được làm hỏng giao dịch nghiệp vụ
END $$;

-- 4a) Đơn nhặt lẻ đổi (nhu cầu) — chỉ dòng CÓ nhặt lẻ; KHÔNG bắt cartons_scanned (đường nóng của PDA,
--     quét từ ô lẻ làm cần và có cùng tụt nên "thiếu" không đổi; lượt quét an toàn bù ca lấy nguyên pallet)
CREATE OR REPLACE FUNCTION public.fill_enqueue_from_item() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; g record;
BEGIN
  r := COALESCE(NEW, OLD);
  IF r.do_id IS NULL THEN RETURN NULL; END IF;
  IF COALESCE(NEW.loose_picking, 0) <= 0 AND COALESCE(OLD.loose_picking, 0) <= 0 THEN RETURN NULL; END IF;
  SELECT g2.warehouse_id, g2.delivery_date INTO g
  FROM "OutboundDelivery" d JOIN "GroupDeliveryOrder" g2 ON g2.id = d.gdo_id
  WHERE d.id = r.do_id;
  IF FOUND THEN PERFORM fill_reconcile_enqueue(g.warehouse_id, g.delivery_date); END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_fill_enqueue_item ON public."OutboundItem";
CREATE TRIGGER trg_fill_enqueue_item
  AFTER INSERT OR DELETE OR UPDATE OF loose_picking, cartons_ordered, status, date_rule, material_id
  ON public."OutboundItem"
  FOR EACH ROW EXECUTE FUNCTION public.fill_enqueue_from_item();

-- 4b) Chuyến đổi ngày / huỷ / bất động / sống lại / đổi kho — ghi CẢ ngày cũ lẫn ngày mới
CREATE OR REPLACE FUNCTION public.fill_enqueue_from_gdo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM fill_reconcile_enqueue(OLD.warehouse_id, OLD.delivery_date); END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN PERFORM fill_reconcile_enqueue(NEW.warehouse_id, NEW.delivery_date); END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_fill_enqueue_gdo ON public."GroupDeliveryOrder";
CREATE TRIGGER trg_fill_enqueue_gdo
  AFTER INSERT OR DELETE OR UPDATE OF delivery_date, status, awaiting_sap, plan_dropped, warehouse_id
  ON public."GroupDeliveryOrder"
  FOR EACH ROW EXECUTE FUNCTION public.fill_enqueue_from_gdo();

-- 4c) Tồn ở Ô NHẶT LẺ đổi (hàng vào/ra ô lẻ bằng bất kỳ đường nào: fill tay, phiếu nhập cất thẳng,
--     chuyển vị trí, nhặt lẻ trừ dần) — ngày nào cũng có thể bị ảnh hưởng ⇒ ghi cả hôm nay lẫn mai
CREATE OR REPLACE FUNCTION public.fill_enqueue_from_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE wh text; today date; pf boolean;
BEGIN
  SELECT true INTO pf FROM "Location" l
   WHERE l.is_pick_face AND l.id IN (NEW.location_id, OLD.location_id) LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  wh := COALESCE(NEW.warehouse_id, OLD.warehouse_id);
  today := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  PERFORM fill_reconcile_enqueue(wh, today);
  PERFORM fill_reconcile_enqueue(wh, today + 1);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_fill_enqueue_entry ON public."InventoryEntry";
CREATE TRIGGER trg_fill_enqueue_entry
  AFTER INSERT OR DELETE OR UPDATE OF status, cartons_remaining, cartons_reserved, location_id, warehouse_id
  ON public."InventoryEntry"
  FOR EACH ROW EXECUTE FUNCTION public.fill_enqueue_from_entry();

-- 4d) Việc LOOSE_FEED của bộ lập kế hoạch (đường hạ hàng thứ hai — Fill trừ nó vào "đang có lệnh")
CREATE OR REPLACE FUNCTION public.fill_enqueue_from_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; g record;
BEGIN
  r := COALESCE(NEW, OLD);
  IF r.kind IS DISTINCT FROM 'LOOSE_FEED' OR r.gdo_id IS NULL THEN RETURN NULL; END IF;
  SELECT warehouse_id, delivery_date INTO g FROM "GroupDeliveryOrder" WHERE id = r.gdo_id;
  IF FOUND THEN PERFORM fill_reconcile_enqueue(g.warehouse_id, g.delivery_date); END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_fill_enqueue_task ON public.wms_tasks;
CREATE TRIGGER trg_fill_enqueue_task
  AFTER INSERT OR DELETE OR UPDATE OF status, qty_base
  ON public.wms_tasks
  FOR EACH ROW EXECUTE FUNCTION public.fill_enqueue_from_task();

-- 4e) Bật công tắc (kho hoặc loại kho) ⇒ soát ngay, không chờ lượt quét an toàn
CREATE OR REPLACE FUNCTION public.fill_enqueue_from_switch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE wh text; today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
BEGIN
  wh := CASE WHEN TG_TABLE_NAME = 'Warehouse' THEN NEW.id ELSE NEW.warehouse_id END;
  PERFORM fill_reconcile_enqueue(wh, today);
  PERFORM fill_reconcile_enqueue(wh, today + 1);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_fill_enqueue_switch_wh ON public."Warehouse";
CREATE TRIGGER trg_fill_enqueue_switch_wh
  AFTER UPDATE OF auto_fill ON public."Warehouse"
  FOR EACH ROW WHEN (NEW.auto_fill = true) EXECUTE FUNCTION public.fill_enqueue_from_switch();
DROP TRIGGER IF EXISTS trg_fill_enqueue_switch_type ON public.warehouse_type_configs;
CREATE TRIGGER trg_fill_enqueue_switch_type
  AFTER INSERT OR UPDATE OF auto_fill ON public.warehouse_type_configs
  FOR EACH ROW WHEN (NEW.auto_fill = true) EXECUTE FUNCTION public.fill_enqueue_from_switch();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) fill_reconcile_take — MỘT round-trip: lấy ngày cần soát + thuê kho
--    Trả {leased, days[]}. leased=false ⇒ kho đang có instance khác đối chiếu (hoặc không có gì để làm);
--    hàng đợi để nguyên cho lượt sau. days gồm dòng hàng đợi (≤ hôm nay+1) và, tới hạn quét an toàn,
--    cả hôm nay lẫn mai. Dòng của ngày ĐÃ QUA bị xoá (xe đi rồi, chốt lười lo phần còn lại).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fill_reconcile_take(
  p_wh      text,
  p_today   date,
  p_sweep_s int DEFAULT 1800,
  p_lease_s int DEFAULT 90
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st fill_reconcile_state%ROWTYPE; days date[] := '{}';
BEGIN
  INSERT INTO fill_reconcile_state (warehouse_id) VALUES (p_wh) ON CONFLICT (warehouse_id) DO NOTHING;
  SELECT * INTO st FROM fill_reconcile_state WHERE warehouse_id = p_wh FOR UPDATE;
  IF st.lease_until IS NOT NULL AND st.lease_until > now() THEN
    RETURN jsonb_build_object('leased', false, 'busy', true, 'days', '[]'::jsonb);
  END IF;

  DELETE FROM fill_reconcile_queue WHERE warehouse_id = p_wh AND target_date < p_today;
  WITH x AS (
    DELETE FROM fill_reconcile_queue
     WHERE warehouse_id = p_wh AND target_date <= p_today + 1
     RETURNING target_date
  )
  SELECT COALESCE(array_agg(target_date), '{}') INTO days FROM x;

  IF st.last_sweep IS NULL OR st.last_sweep < now() - make_interval(secs => p_sweep_s) THEN
    days := days || p_today || (p_today + 1);
    UPDATE fill_reconcile_state SET last_sweep = now(), updated_at = now() WHERE warehouse_id = p_wh;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), '{}') INTO days FROM unnest(days) u;
  IF COALESCE(array_length(days, 1), 0) = 0 THEN
    RETURN jsonb_build_object('leased', false, 'busy', false, 'days', '[]'::jsonb);
  END IF;

  UPDATE fill_reconcile_state
     SET lease_until = now() + make_interval(secs => p_lease_s), updated_at = now()
   WHERE warehouse_id = p_wh;
  RETURN jsonb_build_object('leased', true, 'busy', false, 'days', to_jsonb(days));
END $$;

-- Thuê riêng cho đường BẤM TAY (POST /wms/fill/auto): cùng một ổ khoá với đường tự động
CREATE OR REPLACE FUNCTION public.fill_reconcile_lease(p_wh text, p_lease_s int DEFAULT 90) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st fill_reconcile_state%ROWTYPE;
BEGIN
  INSERT INTO fill_reconcile_state (warehouse_id) VALUES (p_wh) ON CONFLICT (warehouse_id) DO NOTHING;
  SELECT * INTO st FROM fill_reconcile_state WHERE warehouse_id = p_wh FOR UPDATE;
  IF st.lease_until IS NOT NULL AND st.lease_until > now() THEN RETURN false; END IF;
  UPDATE fill_reconcile_state
     SET lease_until = now() + make_interval(secs => p_lease_s), updated_at = now()
   WHERE warehouse_id = p_wh;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.fill_reconcile_release(p_wh text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE fill_reconcile_state SET lease_until = NULL, updated_at = now() WHERE warehouse_id = p_wh
$$;


COMMIT;
-- === HẾT PART 8/10 ===
