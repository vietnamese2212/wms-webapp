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
