-- 20260908c — TAB KPI trên Dashboard (user đưa "Warehouse KPI Master List" 40 KPI, 08/09/2026).
--
-- Khảo sát nguồn (08/09): 24/40 KPI app ĐÃ CÓ CHỖ GHI dữ liệu (14 đủ + 10 phụ thuộc kỷ luật nhập
-- liệu/định nghĩa), 16 KPI chưa có nguồn — quy về 5 mảnh: giá vốn mã hàng · doanh thu theo kho/kỳ ·
-- sổ sự cố có mã lý do · giờ công theo công việc · thể tích vị trí (memory `kpi-master-list-gaps`).
-- Đợt này đưa 24 KPI lên; 16 KPI kia hiện ô trống trên UI kèm "cần bổ sung gì".
--
-- NGUYÊN TẮC MỘT NGUỒN: RPC `warehouse_kpi` KHÔNG tính lại công thức đã có — gọi lại `service_level`
-- (OTIF/fill), `warehouse_productivity` (tấn/giờ công/tăng ca/chi phí) và `zone_capacity_rows` (sức
-- chứa khu), chỉ THÊM các phép đo chưa có. Mỗi KPI trả về cặp {num, den} theo TỪNG KHO; tổng toàn
-- phạm vi = Σnum/Σden (không lấy trung bình của các %). Đèn G/Y/R + mục tiêu tính ở BE (utils/kpiDefs.ts).
--
-- Chú thích đo (phải nói trên màn hình, đừng để người đọc tưởng kho kém):
--   · gate_dwell: chỉ chuyến/xe có ĐĂNG KÝ CỔNG có giờ vào & ra.
--   · loading: Bắt đầu → Hoàn thành chuyến; loại dòng âm/quá 48h (dữ liệu bậy).
--   · dock_to_stock: chỉ phiếu nhập GẮN cổng (vào cổng → phiếu hoàn thành).
--   · recv_acc: chỉ phiếu NCC/chuyển kho có số kế hoạch (phiếu nhà máy planned_cartons khác nghĩa).
--   · unload_prod / pick_prod / pick_lines: mẫu số = TỔNG giờ công kho (chấm công chưa tách theo việc).
--   · expiry_risk: %Date tính trong SQL theo đúng thứ tự computePctDate (HSD tường minh → NSX+shelf life),
--     BỎ QUA override shelf life theo NCC (không tra jsonb trong SQL) — lệch nhỏ, chấp nhận.
--   · slow/dead: pallet nhập quá N ngày VÀ mã đó không xuất khỏi kho này quá N ngày (đếm theo pallet).
--   · doh/turnover: theo TẤN (tồn tấn hiện tại ÷ tấn xuất/ngày) — không có giá vốn.

-- ── 1. service_level: thêm 3 SỐ ĐẾM theo kho (on_time/in_full/otif) để gộp tổng đúng ──────────
-- by_warehouse trước chỉ có % — không cộng được giữa các kho. Thân hàm giữ NGUYÊN bản 20260830.
CREATE OR REPLACE FUNCTION public.service_level(p_from date, p_to date, p_wh_ids text[] DEFAULT NULL::text[], p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE v_out jsonb; v_lim int := least(greatest(coalesce(p_limit, 20), 5), 100);
BEGIN
  WITH trips AS (
    SELECT g.id, g.group_code, g.warehouse_id, g.delivery_date, g.completed_at,
           w.name AS warehouse_name,
           (g.completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= g.delivery_date AS on_time
      FROM "GroupDeliveryOrder" g
      LEFT JOIN "Warehouse" w ON w.id = g.warehouse_id
     WHERE g.status = 'COMPLETED'
       AND g.delivery_date BETWEEN p_from AND p_to
       AND (p_wh_ids IS NULL OR g.warehouse_id = ANY(p_wh_ids))
  ),
  red AS (
    SELECT e.group_code, coalesce(e.do_number, '') AS do_number, e.material_code,
           sum(e.old_value::numeric - e.new_value::numeric) AS cut
      FROM outbound_events e
     WHERE e.event_type IN ('QTY_REDUCED_TO_ACTUAL', 'QTY_REDUCED')
       AND e.old_value ~ '^[0-9.]+$' AND e.new_value ~ '^[0-9.]+$'
     GROUP BY 1, 2, 3
  ),
  raw_lines AS (
    SELECT t.id AS trip_id, t.group_code, t.warehouse_id, t.warehouse_name, t.on_time,
           coalesce(d.delivery_code, '') AS do_number,
           oi.material_code_raw AS material_code,
           sum(coalesce(oi.cartons_scanned, 0))::numeric AS shipped,
           sum(oi.cartons_ordered)::numeric              AS ordered
      FROM trips t
      JOIN "OutboundDelivery" d ON d.gdo_id = t.id
      JOIN "OutboundItem" oi    ON oi.do_id = d.id
     GROUP BY 1, 2, 3, 4, 5, 6, 7
  ),
  lines AS (
    SELECT l.trip_id, l.group_code, l.warehouse_id, l.warehouse_name, l.on_time,
           l.material_code, l.shipped,
           l.ordered + coalesce(r.cut, 0) AS demand
      FROM raw_lines l
      LEFT JOIN red r
             ON r.group_code = l.group_code
            AND r.do_number  = l.do_number
            AND r.material_code = l.material_code
  ),
  by_trip AS (
    SELECT trip_id, group_code, warehouse_id, warehouse_name, on_time,
           sum(demand) AS demand, sum(shipped) AS shipped,
           bool_and(shipped >= demand) AS in_full
      FROM lines GROUP BY 1, 2, 3, 4, 5
  )
  SELECT jsonb_build_object(
    'summary', (
      SELECT jsonb_build_object(
        'trips',        count(*),
        'lines',        (SELECT count(*) FROM lines),
        'lines_short',  (SELECT count(*) FROM lines WHERE shipped < demand),
        'demand',       coalesce((SELECT sum(demand)  FROM lines), 0),
        'shipped',      coalesce((SELECT sum(shipped) FROM lines), 0),
        'fill_rate',    CASE WHEN coalesce((SELECT sum(demand) FROM lines), 0) > 0
                             THEN round(100.0 * (SELECT sum(shipped) FROM lines) / (SELECT sum(demand) FROM lines), 1)
                             ELSE NULL END,
        'on_time_pct',  CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE on_time) / count(*), 1) ELSE NULL END,
        'in_full_pct',  CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE in_full) / count(*), 1) ELSE NULL END,
        'otif_pct',     CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE on_time AND in_full) / count(*), 1) ELSE NULL END,
        'avg_stars',    (SELECT round(avg(rr.stars)::numeric, 2) FROM receipt_ratings rr
                          JOIN trips t2 ON t2.id = rr.gdo_id),
        'rated_trips',  (SELECT count(*) FROM receipt_ratings rr JOIN trips t2 ON t2.id = rr.gdo_id),
        'ratable_trips', (SELECT count(*) FROM trips t3
                           WHERE EXISTS (SELECT 1 FROM "TmsOrder" o
                                          WHERE o.transfer_gdo_id = t3.id
                                            AND coalesce(o.delivery_mode, '') <> 'SELF'))
      ) FROM by_trip
    ),
    'by_warehouse', coalesce((
      SELECT jsonb_agg(x ORDER BY (x->>'trips')::int DESC) FROM (
        SELECT jsonb_build_object(
          'warehouse_id', warehouse_id, 'warehouse_name', coalesce(warehouse_name, '(không rõ)'),
          'trips', count(*),
          -- 08/09: SỐ ĐẾM để tab KPI gộp tổng theo Σ, không cộng %
          'on_time_trips', count(*) FILTER (WHERE on_time),
          'in_full_trips', count(*) FILTER (WHERE in_full),
          'otif_trips',    count(*) FILTER (WHERE on_time AND in_full),
          'on_time_pct', round(100.0 * count(*) FILTER (WHERE on_time) / count(*), 1),
          'in_full_pct', round(100.0 * count(*) FILTER (WHERE in_full) / count(*), 1),
          'demand', sum(demand), 'shipped', sum(shipped),
          'fill_rate', CASE WHEN sum(demand) > 0 THEN round(100.0 * sum(shipped) / sum(demand), 1) ELSE NULL END
        ) x
        FROM by_trip GROUP BY warehouse_id, warehouse_name
      ) s), '[]'::jsonb),
    'top_short', coalesce((
      SELECT jsonb_agg(x ORDER BY (x->>'missing')::numeric DESC) FROM (
        SELECT jsonb_build_object(
          'material_code', material_code, 'lines', count(*),
          'missing', sum(demand - shipped), 'demand', sum(demand)
        ) x
        FROM lines WHERE shipped < demand
        GROUP BY material_code ORDER BY sum(demand - shipped) DESC LIMIT v_lim
      ) s), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $function$;

-- ── 2. warehouse_kpi — 24 KPI, mỗi KPI {num, den} theo kho + tổng ────────────────────────────────
CREATE OR REPLACE FUNCTION public.warehouse_kpi(
  p_warehouse_ids text[] DEFAULT NULL,
  p_categories    text[] DEFAULT NULL,
  p_from          date    DEFAULT NULL,
  p_to            date    DEFAULT NULL,
  p_std_hours     numeric DEFAULT 8,
  p_pct_low       numeric DEFAULT 30,
  p_slow_days     int     DEFAULT 90,
  p_dead_days     int     DEFAULT 180
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET statement_timeout TO '30s'
AS $$
DECLARE
  v_svc  jsonb;
  v_prod jsonb;
  v_out  jsonb;
  v_from_ts timestamptz := (p_from::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_to_ts   timestamptz := ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
BEGIN
  v_svc  := service_level(p_from, p_to, p_warehouse_ids, 5);
  v_prod := warehouse_productivity(p_warehouse_ids, p_categories, p_from, p_to, p_std_hours);

  WITH wh AS (
    SELECT w.id, w.name FROM "Warehouse" w
     WHERE (p_warehouse_ids IS NULL OR w.id = ANY(p_warehouse_ids))
  ),
  svc AS (
    SELECT x->>'warehouse_id' AS wid,
           (x->>'trips')::numeric AS trips, (x->>'otif_trips')::numeric AS otif,
           (x->>'demand')::numeric AS demand, (x->>'shipped')::numeric AS shipped
      FROM jsonb_array_elements(coalesce(v_svc->'by_warehouse', '[]'::jsonb)) x
  ),
  prod AS (
    SELECT x->>'warehouse_id' AS wid,
           (x->>'tons')::numeric AS tons, (x->>'tons_out')::numeric AS tons_out,
           (x->>'pallets_in')::numeric AS pallets_in, (x->>'work_hours')::numeric AS work_hours,
           (x->>'ot_hours')::numeric AS ot_hours, (x->>'cost')::numeric AS cost
      FROM jsonb_array_elements(coalesce(v_prod->'rows', '[]'::jsonb)) x
  ),
  gate AS (
    SELECT gr.warehouse_id AS wid,
           sum(extract(epoch FROM (gr.exit_at - gr.entry_at)) / 60) AS num, count(*) AS den
      FROM gate_registrations gr
     WHERE gr.entry_at IS NOT NULL AND gr.exit_at > gr.entry_at
       AND gr.exit_at < gr.entry_at + interval '72 hours'
       AND gr.date BETWEEN p_from AND p_to
       AND (p_warehouse_ids IS NULL OR gr.warehouse_id = ANY(p_warehouse_ids))
     GROUP BY 1
  ),
  load AS (
    -- started_at là timestamp KHÔNG tz lưu UTC → ép về timestamptz trước khi trừ
    SELECT g.warehouse_id AS wid,
           sum(extract(epoch FROM (g.completed_at - (g.started_at AT TIME ZONE 'UTC'))) / 60) AS num, count(*) AS den
      FROM "GroupDeliveryOrder" g
     WHERE g.status = 'COMPLETED' AND g.delivery_date BETWEEN p_from AND p_to
       AND g.started_at IS NOT NULL AND g.completed_at IS NOT NULL
       AND g.completed_at > (g.started_at AT TIME ZONE 'UTC')
       AND g.completed_at < (g.started_at AT TIME ZONE 'UTC') + interval '48 hours'
       AND (p_warehouse_ids IS NULL OR g.warehouse_id = ANY(p_warehouse_ids))
     GROUP BY 1
  ),
  d2s AS (
    SELECT pi.warehouse_id AS wid,
           sum(extract(epoch FROM ((pi.updated_at AT TIME ZONE 'UTC') - gr.entry_at)) / 3600) AS num, count(*) AS den
      FROM "ProductionImport" pi
      JOIN gate_registrations gr ON gr.id = pi.gate_registration_id
     WHERE pi.status = 'COMPLETED' AND gr.entry_at IS NOT NULL
       AND (pi.updated_at AT TIME ZONE 'UTC') > gr.entry_at
       AND (pi.updated_at AT TIME ZONE 'UTC') < gr.entry_at + interval '14 days'
       AND pi.import_date >= p_from AND pi.import_date < (p_to + 1)
       AND (p_warehouse_ids IS NULL OR pi.warehouse_id = ANY(p_warehouse_ids))
     GROUP BY 1
  ),
  recv AS (
    SELECT pi.warehouse_id AS wid,
           count(*) FILTER (WHERE coalesce(a.act, 0) = pi.planned_cartons) AS num, count(*) AS den
      FROM "ProductionImport" pi
      LEFT JOIN LATERAL (SELECT sum(ie.cartons_imported) AS act FROM "InventoryEntry" ie WHERE ie.import_order_id = pi.id) a ON true
     WHERE pi.status = 'COMPLETED' AND pi.source_type IN ('NCC', 'TRANSFER')
       AND coalesce(pi.planned_cartons, 0) > 0
       AND pi.import_date >= p_from AND pi.import_date < (p_to + 1)
       AND (p_warehouse_ids IS NULL OR pi.warehouse_id = ANY(p_warehouse_ids))
     GROUP BY 1
  ),
  pa AS (
    SELECT ie.warehouse_id AS wid,
           count(*) FILTER (WHERE ie.putaway_violation IS NULL) AS num, count(*) AS den
      FROM "InventoryEntry" ie
     WHERE ie.putaway_checked
       AND ie.import_date >= p_from AND ie.import_date < (p_to + 1)
       AND (p_warehouse_ids IS NULL OR ie.warehouse_id = ANY(p_warehouse_ids))
     GROUP BY 1
  ),
  st AS (
    SELECT s.warehouse_id AS wid,
           sum(abs(coalesce(s.diff, 0))) AS absdiff, sum(coalesce(s.app_qty, 0)) AS book,
           count(*) AS n, count(*) FILTER (WHERE s.location_changed_to IS NULL) AS loc_ok
      FROM "StocktakeLog" s
     WHERE s.counted_at >= v_from_ts AND s.counted_at < v_to_ts
       AND (p_warehouse_ids IS NULL OR s.warehouse_id = ANY(p_warehouse_ids))
     GROUP BY 1
  ),
  cc AS (
    SELECT l.warehouse_id AS wid,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM "StocktakeLog" s WHERE s.location_id = l.id AND s.counted_at >= v_from_ts AND s.counted_at < v_to_ts)) AS num,
           count(*) AS den
      FROM "Location" l
     WHERE l.is_active AND l.requires_stocktake AND coalesce(l.kind, 'STORAGE') = 'STORAGE'
       AND (p_warehouse_ids IS NULL OR l.warehouse_id = ANY(p_warehouse_ids))
     GROUP BY 1
  ),
  fefo AS (
    SELECT ie.warehouse_id AS wid,
           count(*) FILTER (WHERE NOT se.rotation_violation) AS num, count(*) AS den
      FROM "OutboundScanEntry" se
      JOIN "InventoryEntry" ie ON ie.id = se.inventory_entry_id
     WHERE se.rotation_violation IS NOT NULL
       AND (se.scanned_at AT TIME ZONE 'UTC') >= v_from_ts AND (se.scanned_at AT TIME ZONE 'UTC') < v_to_ts
       AND (p_warehouse_ids IS NULL OR ie.warehouse_id = ANY(p_warehouse_ids))
     GROUP BY 1
  ),
  -- ẢNH CHỤP TỒN HIỆN TẠI (không theo kỳ) — lọc loại hàng null-inclusive như mọi nơi
  stock AS (
    SELECT ie.warehouse_id AS wid, ie.location_id, ie.material_id, ie.cartons_remaining AS qty, ie.status,
           ie.import_date, ie.production_date, ie.expiry_date,
           coalesce(ie.shelf_life_days, m.shelf_life_days) AS sl,
           q.code AS qa, m.weight_kg, m.units_per_carton AS upc
      FROM "InventoryEntry" ie
      LEFT JOIN "Material" m ON m.id = ie.material_id
      LEFT JOIN "QAStatus" q ON q.id = ie.qa_status_id
     WHERE ie.cartons_remaining > 0
       AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
       AND (p_warehouse_ids IS NULL OR ie.warehouse_id = ANY(p_warehouse_ids))
       AND (p_categories IS NULL OR m.category IS NULL OR m.category = ANY(p_categories))
  ),
  lastout AS (
    SELECT ie.warehouse_id AS wid, ie.material_id, max(se.scanned_at)::date AS last_d
      FROM "OutboundScanEntry" se
      JOIN "InventoryEntry" ie ON ie.id = se.inventory_entry_id
     WHERE se.scanned_at >= (current_date - p_dead_days)::timestamp
       AND (p_warehouse_ids IS NULL OR ie.warehouse_id = ANY(p_warehouse_ids))
     GROUP BY 1, 2
  ),
  stk AS (
    SELECT s.wid,
           count(*) AS n,
           count(*) FILTER (WHERE s.status = 'QUARANTINE' OR (s.qa IS NOT NULL AND s.qa <> 'OK')) AS blocked,
           count(*) FILTER (WHERE p.pct IS NOT NULL AND p.pct < p_pct_low) AS risk,
           count(*) FILTER (WHERE s.import_date < (current_date - p_slow_days)
                              AND (lo.last_d IS NULL OR lo.last_d < current_date - p_slow_days)) AS slow,
           count(*) FILTER (WHERE s.import_date < (current_date - p_dead_days)
                              AND (lo.last_d IS NULL OR lo.last_d < current_date - p_dead_days)) AS dead,
           sum(CASE WHEN coalesce(s.weight_kg, 0) > 0
                    THEN s.qty / (CASE WHEN coalesce(s.upc, 0) > 0 THEN s.upc ELSE 1 END) * s.weight_kg
                    ELSE 0 END) / 1000.0 AS tons
      FROM stock s
      LEFT JOIN lastout lo ON lo.wid = s.wid AND lo.material_id = s.material_id
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN s.expiry_date IS NOT NULL AND s.production_date IS NOT NULL AND s.expiry_date > s.production_date::date
            THEN 100.0 * (s.expiry_date - current_date) / (s.expiry_date - s.production_date::date)
          WHEN s.expiry_date IS NOT NULL AND coalesce(s.sl, 0) > 0
            THEN 100.0 * (s.expiry_date - current_date) / s.sl
          WHEN s.production_date IS NOT NULL AND coalesce(s.sl, 0) > 0
            THEN 100.0 * ((s.production_date::date + s.sl) - current_date) / s.sl
          ELSE NULL END AS pct
      ) p
     GROUP BY 1
  ),
  -- Sức chứa vị trí: dùng KHÔNG lọc loại hàng (chỗ chứa là vật lý)
  used AS (
    SELECT ie.location_id, count(*) AS n
      FROM "InventoryEntry" ie
     WHERE ie.cartons_remaining > 0 AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
       AND (p_warehouse_ids IS NULL OR ie.warehouse_id = ANY(p_warehouse_ids))
     GROUP BY 1
  ),
  -- Sức chứa 1..1000 mới coi là KHAI THẬT. Đo staging 08/09: Bàu Bàng có 479 vị trí sàn khai 200.000 /
  -- 1.000.000 nghĩa là "không giới hạn" — cộng vào mẫu số thì % sử dụng của kho về 0,2% (vô nghĩa).
  -- Vị trí như vậy vẫn đếm ở "vị trí trống", chỉ loại khỏi % chỗ pallet + tràn chỗ; số bị loại trả về
  -- `loc_uncapped` để màn hình nói ra.
  locs AS (
    SELECT l.warehouse_id AS wid,
           CASE WHEN l.max_pallets BETWEEN 1 AND 1000 THEN l.max_pallets END AS cap,
           coalesce(u.n, 0) AS used
      FROM "Location" l LEFT JOIN used u ON u.location_id = l.id
     WHERE l.is_active AND coalesce(l.kind, 'STORAGE') = 'STORAGE'
       AND (p_warehouse_ids IS NULL OR l.warehouse_id = ANY(p_warehouse_ids))
  ),
  loc AS (
    SELECT wid,
           sum(least(used, cap)) FILTER (WHERE cap IS NOT NULL) AS used_cap,
           sum(cap) FILTER (WHERE cap IS NOT NULL) AS cap,
           count(*) FILTER (WHERE used = 0) AS empty, count(*) AS n,
           sum(greatest(used - cap, 0)) FILTER (WHERE cap IS NOT NULL) AS over_n,
           sum(used) FILTER (WHERE cap IS NOT NULL) AS used_all,
           count(*) FILTER (WHERE cap IS NULL) AS uncapped
      FROM locs GROUP BY 1
  ),
  zone AS (
    SELECT z.warehouse_id AS wid, sum(z.used) AS used, sum(z.capacity) AS cap
      FROM zone_capacity_rows(p_warehouse_ids, p_categories) z
     WHERE z.capacity > 0 GROUP BY 1
  ),
  pick AS (
    SELECT g.warehouse_id AS wid,
           sum(qty_entry_decimal(coalesce(oi.cartons_scanned, 0), m.entry_unit, m.units_per_carton)) AS cases,
           count(*) FILTER (WHERE coalesce(oi.cartons_scanned, 0) > 0) AS lines
      FROM "GroupDeliveryOrder" g
      JOIN "OutboundDelivery" d ON d.gdo_id = g.id
      JOIN "OutboundItem" oi    ON oi.do_id = d.id
      LEFT JOIN "Material" m    ON m.id = oi.material_id
     WHERE g.delivery_date BETWEEN p_from AND p_to AND coalesce(g.status, '') <> 'CANCELLED'
       AND (p_warehouse_ids IS NULL OR g.warehouse_id = ANY(p_warehouse_ids))
       AND (p_categories IS NULL OR m.category IS NULL OR m.category = ANY(p_categories))
     GROUP BY 1
  ),
  cin AS (
    SELECT ie.warehouse_id AS wid,
           sum(qty_entry_decimal(coalesce(ie.cartons_imported, 0), m.entry_unit, m.units_per_carton)) AS cases
      FROM "InventoryEntry" ie LEFT JOIN "Material" m ON m.id = ie.material_id
     WHERE ie.import_date >= p_from AND ie.import_date < (p_to + 1)
       AND (p_warehouse_ids IS NULL OR ie.warehouse_id = ANY(p_warehouse_ids))
       AND (p_categories IS NULL OR m.category IS NULL OR m.category = ANY(p_categories))
     GROUP BY 1
  ),
  per AS (
    SELECT w.id AS wid, w.name,
      jsonb_build_object(
        'otif',          jsonb_build_object('num', s.otif,               'den', s.trips),
        'fill',          jsonb_build_object('num', s.shipped,            'den', s.demand),
        'gate_dwell',    jsonb_build_object('num', ga.num,               'den', ga.den),
        'loading',       jsonb_build_object('num', ld.num,               'den', ld.den),
        'dock_to_stock', jsonb_build_object('num', d.num,                'den', d.den),
        'recv_acc',      jsonb_build_object('num', rc.num,               'den', rc.den),
        'unload_prod',   jsonb_build_object('num', pr.pallets_in,        'den', pr.work_hours),
        'putaway_acc',   jsonb_build_object('num', pa.num,               'den', pa.den),
        'inv_acc',       jsonb_build_object('num', st.book - st.absdiff, 'den', st.book),
        'loc_acc',       jsonb_build_object('num', st.loc_ok,            'den', st.n),
        'cc_compl',      jsonb_build_object('num', cc.num,               'den', cc.den),
        'fefo',          jsonb_build_object('num', fe.num,               'den', fe.den),
        'blocked',       jsonb_build_object('num', sk.blocked,           'den', sk.n),
        'expiry_risk',   jsonb_build_object('num', sk.risk,              'den', sk.n),
        'slow',          jsonb_build_object('num', sk.slow,              'den', sk.n),
        'dead',          jsonb_build_object('num', sk.dead,              'den', sk.n),
        'doh',           jsonb_build_object('num', sk.tons,              'den', pr.tons_out),
        'turnover',      jsonb_build_object('num', sk.tons,              'den', pr.tons_out),
        'util_zone',     jsonb_build_object('num', z.used,               'den', z.cap),
        'util_pos',      jsonb_build_object('num', lc.used_cap,          'den', lc.cap),
        'empty_loc',     jsonb_build_object('num', lc.empty,             'den', lc.n),
        'overflow',      jsonb_build_object('num', lc.over_n,            'den', lc.used_all),
        'pick_prod',     jsonb_build_object('num', pk.cases,             'den', pr.work_hours),
        'pick_lines',    jsonb_build_object('num', pk.lines,             'den', pr.work_hours),
        'labor_prod',    jsonb_build_object('num', pr.tons,              'den', pr.work_hours),
        'ot_rate',       jsonb_build_object('num', pr.ot_hours,          'den', pr.work_hours),
        'cost_case',     jsonb_build_object('num', pr.cost,              'den', coalesce(pk.cases, 0) + coalesce(ci.cases, 0))
      ) AS m
      FROM wh w
      LEFT JOIN svc  s  ON s.wid  = w.id
      LEFT JOIN prod pr ON pr.wid = w.id
      LEFT JOIN gate ga ON ga.wid = w.id
      LEFT JOIN load ld ON ld.wid = w.id
      LEFT JOIN d2s  d  ON d.wid  = w.id
      LEFT JOIN recv rc ON rc.wid = w.id
      LEFT JOIN pa      ON pa.wid = w.id
      LEFT JOIN st      ON st.wid = w.id
      LEFT JOIN cc      ON cc.wid = w.id
      LEFT JOIN fefo fe ON fe.wid = w.id
      LEFT JOIN stk  sk ON sk.wid = w.id
      LEFT JOIN zone z  ON z.wid  = w.id
      LEFT JOIN loc  lc ON lc.wid = w.id
      LEFT JOIN pick pk ON pk.wid = w.id
      LEFT JOIN cin  ci ON ci.wid = w.id
  ),
  tot AS (
    SELECT e.key, sum((e.value->>'num')::numeric) AS num, sum((e.value->>'den')::numeric) AS den
      FROM per, jsonb_each(per.m) e
     GROUP BY e.key
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to, 'days', (p_to - p_from + 1),
    'pct_low', p_pct_low, 'slow_days', p_slow_days, 'dead_days', p_dead_days,
    'by_warehouse', coalesce((SELECT jsonb_agg(jsonb_build_object('warehouse_id', wid, 'warehouse_name', name, 'm', m) ORDER BY name) FROM per), '[]'::jsonb),
    'totals', coalesce((SELECT jsonb_object_agg(key, jsonb_build_object('num', num, 'den', den)) FROM tot), '{}'::jsonb),
    -- chi phí CHUNG (chưa gán kho) chỉ có khi xem toàn phạm vi — cộng vào tử số tổng, không vào kho nào
    'cost_shared', coalesce((v_prod->>'cost_shared')::numeric, 0),
    'lines_no_weight', coalesce((v_prod->'totals'->>'lines_no_weight')::numeric, 0),
    'loc_uncapped', coalesce((SELECT sum(uncapped) FROM loc), 0),
    'warehouses_no_labor', coalesce((v_prod->'totals'->>'warehouses_no_labor')::numeric, 0),
    'categories_filtered', (p_categories IS NOT NULL)
  ) INTO v_out;

  RETURN v_out;
END;
$$;

-- ── 3. Bản CACHE (cùng khuôn warehouse_productivity_cached, TTL = cờ dashboard_cache_seconds) ─────
CREATE OR REPLACE FUNCTION public.warehouse_kpi_cached(
  p_warehouse_ids text[] DEFAULT NULL,
  p_categories    text[] DEFAULT NULL,
  p_from          date    DEFAULT NULL,
  p_to            date    DEFAULT NULL,
  p_std_hours     numeric DEFAULT 8,
  p_pct_low       numeric DEFAULT 30,
  p_slow_days     int     DEFAULT 90,
  p_dead_days     int     DEFAULT 180,
  p_ttl_seconds   int     DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql
SET statement_timeout TO '30s'
AS $$
DECLARE v_key text; v_hit jsonb; v_calc jsonb;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RETURN warehouse_kpi(p_warehouse_ids, p_categories, p_from, p_to, p_std_hours, p_pct_low, p_slow_days, p_dead_days);
  END IF;
  v_key := 'kpi|' || md5(
       coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p_warehouse_ids) x), '*')
    || '|' || coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p_categories) x), '*')
    || '|' || coalesce(p_from::text, '*') || '|' || coalesce(p_to::text, '*')
    || '|' || coalesce(p_std_hours::text, '*') || '|' || coalesce(p_pct_low::text, '*')
    || '|' || coalesce(p_slow_days::text, '*') || '|' || coalesce(p_dead_days::text, '*'));
  SELECT payload INTO v_hit FROM public.dashboard_cache
   WHERE key = v_key AND computed_at > now() - make_interval(secs => p_ttl_seconds);
  IF v_hit IS NOT NULL THEN RETURN v_hit || jsonb_build_object('cached', true); END IF;
  v_calc := warehouse_kpi(p_warehouse_ids, p_categories, p_from, p_to, p_std_hours, p_pct_low, p_slow_days, p_dead_days);
  INSERT INTO public.dashboard_cache(key, payload, computed_at) VALUES (v_key, v_calc, now())
  ON CONFLICT (key) DO UPDATE SET payload = excluded.payload, computed_at = excluded.computed_at;
  RETURN v_calc;
END;
$$;

-- ── 4. XU HƯỚNG THEO THÁNG — MỘT request, DB tự lặp từng tháng (không bắn 12 request từ trình duyệt:
--    mỗi request là 1 lượt xếp hàng ở pool ~10 khe PostgREST). Mỗi tháng đi qua bản _cached riêng nên
--    tháng cũ xem lại là đọc 1 dòng. Chỉ trả TOTALS (không theo kho) — biểu đồ xu hướng đọc tổng.
--    KPI ảnh chụp tồn (blocked/expiry/slow/util…) cho MỌI tháng đều là số hiện tại — BE loại khỏi biểu đồ.
CREATE OR REPLACE FUNCTION public.warehouse_kpi_trend(
  p_warehouse_ids text[] DEFAULT NULL,
  p_categories    text[] DEFAULT NULL,
  p_months        int     DEFAULT 12,
  p_end           date    DEFAULT current_date,
  p_std_hours     numeric DEFAULT 8,
  p_pct_low       numeric DEFAULT 30,
  p_slow_days     int     DEFAULT 90,
  p_dead_days     int     DEFAULT 180,
  p_ttl_seconds   int     DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql
SET statement_timeout TO '55s'
AS $$
DECLARE
  v_n   int := least(greatest(coalesce(p_months, 12), 2), 24);
  v_out jsonb := '[]'::jsonb;
  v_m0  date := date_trunc('month', p_end)::date;
  v_from date; v_to date; v_one jsonb; i int;
BEGIN
  FOR i IN REVERSE (v_n - 1)..0 LOOP
    v_from := (v_m0 - make_interval(months => i))::date;
    v_to   := least((v_from + interval '1 month - 1 day')::date, p_end);
    v_one  := warehouse_kpi_cached(p_warehouse_ids, p_categories, v_from, v_to, p_std_hours, p_pct_low, p_slow_days, p_dead_days, p_ttl_seconds);
    v_out  := v_out || jsonb_build_object('month', to_char(v_from, 'YYYY-MM'), 'from', v_from, 'to', v_to,
                                          'days', (v_to - v_from + 1), 'totals', v_one->'totals',
                                          'cost_shared', v_one->'cost_shared');
  END LOOP;
  RETURN v_out;
END;
$$;
