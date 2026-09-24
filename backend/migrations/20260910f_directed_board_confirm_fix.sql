-- ============================================================================
-- 20260910f — VÁ: xe nâng HẠ không bấm được "✓ Xong" trên chính việc của mình
-- ============================================================================
-- Playwright bắt được ngay lượt kiểm giao diện đầu tiên: tab "Cần hạ" có 15 dòng việc nhưng KHÔNG
-- dòng nào có nút ✓ Xong.
--
-- GỐC: `can_confirm` dùng chung một điều kiện cho cả ba bảng —
--     (NOT stage_done) AND (p_mode = 'SCAN' OR NOT waiting_lower)
-- `waiting_lower` = "việc cần hạ mà CHƯA hạ". Ở bảng của XE CHUYỂN nó đúng là lý do chưa bấm được
-- (phải chờ người khác hạ xuống đã). Nhưng ở bảng của XE HẠ thì **chính nó là việc phải làm** ⇒
-- điều kiện tự khoá tay người trong cuộc: ai cũng nhìn thấy việc, không ai bấm xong được.
-- Không có lỗi nào nổ, chỉ là nút không hiện — đúng lớp lỗi im lặng mà chỉ kiểm SỐNG mới thấy.
--
-- SỬA: chỉ bảng MOVE mới bị `waiting_lower` khoá.
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
BEGIN
  WITH base AS (
    SELECT t.*,
           g.group_code, g.license_plate, g.status AS gdo_status, g.started_at,
           g.forklift_driver_ids, g.dock_location_id AS gdo_dock_id,
           fl.location_code AS from_code,
           dl.location_code AS drop_code, dl.row AS drop_name,
           tl.location_code AS to_code,   tl.row AS to_name,
           dk.row           AS dock_name,
           m.short_name     AS material_name,
           CASE
             WHEN t.lowered_at IS NULL           THEN fl.location_code
             WHEN t.kind = 'LOOSE_FEED'          THEN tl.location_code
             ELSE COALESCE(dl.location_code, fl.location_code)
           END AS current_code,
           (t.needs_lower AND t.lowered_at IS NULL AND t.status = 'PENDING') AS waiting_lower
      FROM public.wms_tasks t
      JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
      LEFT JOIN public."Location" fl ON fl.id = t.from_location_id
      LEFT JOIN public."Location" dl ON dl.id = t.drop_location_id
      LEFT JOIN public."Location" tl ON tl.id = t.to_location_id
      LEFT JOIN public."Location" dk ON dk.id = g.dock_location_id
      LEFT JOIN public."Material"  m  ON m.id  = t.material_id
     WHERE t.warehouse_id = p_warehouse_id
       AND t.status IN ('PENDING', 'DONE')
       AND g.status IN ('IN_PROGRESS', 'PAUSED')
       AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id)
  ),
  gdo_flag AS (
    SELECT gdo_id,
           bool_and(NOT (status = 'PENDING' AND NOT waiting_lower)) AS truck_idle
      FROM base GROUP BY gdo_id
  ),
  filtered AS (
    SELECT b.*, COALESCE(f.truck_idle, false) AS truck_idle
      FROM base b LEFT JOIN gdo_flag f ON f.gdo_id = b.gdo_id
     WHERE CASE p_mode
             WHEN 'LOWER' THEN b.needs_lower
             WHEN 'MOVE'  THEN NOT (b.kind = 'LOOSE_FEED' AND b.needs_lower)
             ELSE true
           END
       AND (p_driver_id IS NULL OR p_driver_id = ANY (COALESCE(b.forklift_driver_ids, ARRAY[]::text[])))
  ),
  grouped AS (
    SELECT
      CASE WHEN p_mode = 'SCAN' THEN t.id
           ELSE t.gdo_id || '|' || COALESCE(t.current_code, '?') || '|' || COALESCE(t.to_code, '?') || '|' || t.kind
      END                                        AS group_key,
      min(t.seq)                                 AS seq,
      jsonb_agg(t.id ORDER BY t.seq)             AS task_ids,
      count(*)                                   AS n_pallets,
      sum(t.qty_base)                            AS qty_base,
      min(t.gdo_id)                              AS gdo_id,
      min(t.group_code)                          AS group_code,
      min(t.license_plate)                       AS license_plate,
      min(t.started_at)                          AS started_at,
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
      bool_and(t.status = 'DONE' OR CASE p_mode WHEN 'LOWER' THEN t.lowered_at IS NOT NULL
                                                WHEN 'MOVE'  THEN t.moved_at   IS NOT NULL
                                                ELSE t.done_at IS NOT NULL END) AS stage_done,
      bool_and(t.status = 'DONE')                AS all_scanned,
      max(COALESCE(t.done_at, t.moved_at, t.lowered_at)) AS last_at,
      min(t.lowered_by)                          AS lowered_by,
      min(t.moved_by)                            AS moved_by,
      jsonb_agg(DISTINCT t.material_code)        AS material_codes,
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
      'material_codes', g.material_codes,
      'material_name',  g.material_name,
      'pallet_codes',   g.pallet_codes,
      'needs_lower',    g.needs_lower,
      'waiting_lower',  g.waiting_lower,
      'stage_done',     g.stage_done,
      'all_scanned',    g.all_scanned,
      'last_at',        g.last_at,
      'done_by_name',   COALESCE(g.moved_by, g.lowered_by),
      -- CHỈ bảng của XE CHUYỂN mới bị "chờ xe hạ" khoá. Ở bảng của XE HẠ thì việc chưa hạ CHÍNH LÀ
      -- việc phải làm — khoá nó là khoá tay đúng người trong cuộc (bug đo bằng Playwright 10/09).
      'can_confirm',    (NOT g.stage_done) AND (p_mode <> 'MOVE' OR NOT g.waiting_lower)
    ) ORDER BY
        g.stage_done,
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
           'to_lower',  count(*) FILTER (WHERE t.status = 'PENDING' AND t.needs_lower AND t.lowered_at IS NULL),
           'to_move',   count(*) FILTER (WHERE t.status = 'PENDING' AND t.moved_at IS NULL
                                           AND (NOT t.needs_lower OR t.lowered_at IS NOT NULL)),
           'trips',     count(DISTINCT t.gdo_id)
         )
    INTO v_tot
    FROM public.wms_tasks t
    JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
   WHERE t.warehouse_id = p_warehouse_id AND t.status IN ('PENDING', 'DONE')
     AND g.status IN ('IN_PROGRESS', 'PAUSED')
     AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'gdo_id', x.gdo_id, 'group_code', x.group_code, 'item_id', x.item_id,
           'material_code', x.material_code_raw, 'remaining', x.remaining, 'note', x.header_text
         ) ORDER BY x.group_code, x.material_code_raw), '[]'::jsonb)
    INTO v_alerts
    FROM (
      SELECT g.id AS gdo_id, g.group_code, i.id AS item_id, i.material_code_raw, i.header_text,
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

  RETURN jsonb_build_object('rows', v_rows, 'totals', v_tot, 'unset_items', v_alerts);
END;
$$;
