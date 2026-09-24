-- ============================================================================
-- CUTOVER production 24/09/2026 — PART 5/10
-- 13 migration · 20260908c_warehouse_kpi.sql → 20260910i_dock_vehicle_kind.sql
-- Dán TRỌN file vào Supabase SQL Editor của project PRODUCTION svicyfquresxaigfxsdb rồi Run.
-- Cả part nằm trong MỘT transaction: lỗi bất kỳ đâu = rollback trọn part, schema không dở dang.
-- Chạy lại lần hai sẽ báo "đã tồn tại" rồi tự rollback — không hỏng gì.
-- ============================================================================
BEGIN;


-- ─────────────────────────────────────────────────────────────────────────
-- [20260908c_warehouse_kpi.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260908c — TAB KPI trên Dashboard (user đưa "Warehouse KPI Master List" 40 KPI, 08/09/2026).
--
-- Khảo sát nguồn (08/09): 27/40 KPI app ĐÃ CÓ CHỖ GHI dữ liệu (một số đo với ghi chú: phụ thuộc kỷ luật
-- nhập liệu, hoặc tạm theo tấn/pallet/tổng giờ công), 13 KPI chưa có nguồn — quy về 5 mảnh: giá vốn mã
-- hàng · doanh thu theo kho/kỳ · sổ sự cố có mã lý do · giờ công theo công việc · thể tích vị trí
-- (memory `kpi-master-list-gaps`). Đợt này đưa 27 KPI lên; 13 KPI kia hiện ô trống trên UI kèm "cần bổ sung gì".
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

-- ── 2. warehouse_kpi — 27 KPI, mỗi KPI {num, den} theo kho + tổng ────────────────────────────────
-- Chữ ký cũ (bản áp 08/09 sáng, chưa có p_skip_snapshot) phải DROP trước: thêm tham số có DEFAULT mà
-- giữ bản cũ = hai overload cùng khớp lời gọi 8 tham số → "function is not unique".
DROP FUNCTION IF EXISTS public.warehouse_kpi(text[], text[], date, date, numeric, numeric, int, int);
DROP FUNCTION IF EXISTS public.warehouse_kpi_cached(text[], text[], date, date, numeric, numeric, int, int, int);
-- p_skip_snapshot = TRUE khi tính CHUỖI theo kỳ (ngày/tuần/tháng): các KPI ảnh chụp tồn (blocked, cận
-- date, chậm, sức chứa…) cho mọi kỳ đều là số HIỆN TẠI nên không cần quét InventoryEntry mỗi kỳ —
-- điều kiện `NOT p_skip_snapshot` đứng đầu WHERE thành One-Time Filter, Postgres bỏ hẳn nhánh quét.
CREATE OR REPLACE FUNCTION public.warehouse_kpi(
  p_warehouse_ids text[] DEFAULT NULL,
  p_categories    text[] DEFAULT NULL,
  p_from          date    DEFAULT NULL,
  p_to            date    DEFAULT NULL,
  p_std_hours     numeric DEFAULT 8,
  p_pct_low       numeric DEFAULT 30,
  p_slow_days     int     DEFAULT 90,
  p_dead_days     int     DEFAULT 180,
  p_skip_snapshot boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET statement_timeout TO '30s'
AS $$
DECLARE
  v_svc  jsonb;
  v_prod jsonb;
  v_zone jsonb := '[]'::jsonb;
  v_out  jsonb;
  v_from_ts timestamptz := (p_from::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_to_ts   timestamptz := ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
BEGIN
  v_svc  := service_level(p_from, p_to, p_warehouse_ids, 5);
  v_prod := warehouse_productivity(p_warehouse_ids, p_categories, p_from, p_to, p_std_hours);
  IF NOT p_skip_snapshot THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('wid', z.warehouse_id, 'used', z.used, 'cap', z.capacity)), '[]'::jsonb)
      INTO v_zone FROM zone_capacity_rows(p_warehouse_ids, p_categories) z WHERE z.capacity > 0;
  END IF;

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
     WHERE NOT p_skip_snapshot
       AND ie.cartons_remaining > 0
       AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
       AND (p_warehouse_ids IS NULL OR ie.warehouse_id = ANY(p_warehouse_ids))
       AND (p_categories IS NULL OR m.category IS NULL OR m.category = ANY(p_categories))
  ),
  lastout AS (
    SELECT ie.warehouse_id AS wid, ie.material_id, max(se.scanned_at)::date AS last_d
      FROM "OutboundScanEntry" se
      JOIN "InventoryEntry" ie ON ie.id = se.inventory_entry_id
     WHERE NOT p_skip_snapshot
       AND se.scanned_at >= (current_date - p_dead_days)::timestamp
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
     WHERE NOT p_skip_snapshot
       AND ie.cartons_remaining > 0 AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
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
     WHERE NOT p_skip_snapshot
       AND l.is_active AND coalesce(l.kind, 'STORAGE') = 'STORAGE'
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
    SELECT x->>'wid' AS wid, sum((x->>'used')::numeric) AS used, sum((x->>'cap')::numeric) AS cap
      FROM jsonb_array_elements(v_zone) x GROUP BY 1
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
  p_ttl_seconds   int     DEFAULT 300,
  p_skip_snapshot boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SET statement_timeout TO '30s'
AS $$
DECLARE v_key text; v_hit jsonb; v_calc jsonb;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RETURN warehouse_kpi(p_warehouse_ids, p_categories, p_from, p_to, p_std_hours, p_pct_low, p_slow_days, p_dead_days, p_skip_snapshot);
  END IF;
  v_key := 'kpi|' || md5(
       coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p_warehouse_ids) x), '*')
    || '|' || coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p_categories) x), '*')
    || '|' || coalesce(p_from::text, '*') || '|' || coalesce(p_to::text, '*')
    || '|' || coalesce(p_std_hours::text, '*') || '|' || coalesce(p_pct_low::text, '*')
    || '|' || coalesce(p_slow_days::text, '*') || '|' || coalesce(p_dead_days::text, '*')
    || '|' || CASE WHEN p_skip_snapshot THEN 's' ELSE 'f' END);
  SELECT payload INTO v_hit FROM public.dashboard_cache
   WHERE key = v_key AND computed_at > now() - make_interval(secs => p_ttl_seconds);
  IF v_hit IS NOT NULL THEN RETURN v_hit || jsonb_build_object('cached', true); END IF;
  v_calc := warehouse_kpi(p_warehouse_ids, p_categories, p_from, p_to, p_std_hours, p_pct_low, p_slow_days, p_dead_days, p_skip_snapshot);
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
    v_one  := warehouse_kpi_cached(p_warehouse_ids, p_categories, v_from, v_to, p_std_hours, p_pct_low, p_slow_days, p_dead_days, p_ttl_seconds, true);
    v_out  := v_out || jsonb_build_object('month', to_char(v_from, 'YYYY-MM'), 'from', v_from, 'to', v_to,
                                          'days', (v_to - v_from + 1), 'totals', v_one->'totals',
                                          'cost_shared', v_one->'cost_shared');
  END LOOP;
  RETURN v_out;
END;
$$;

-- ── 5. CHUỖI THEO CHU KỲ ngày / tuần (ISO, thứ Hai) / tháng / năm — user chốt 08/09 chiều: "biểu đồ dạng
--    line, 1 line target 1 line thực tế; chọn Ngày thì từ ngày, Tuần thì từ tuần tới tuần, Tháng, Năm".
--    Một request; DB tự lặp từng kỳ qua bản _cached (kỳ đã QUA giữ cache ≥ 24h — số không đổi nữa; kỳ
--    đang chạy theo TTL cờ dashboard_cache_seconds). Trần 60 kỳ: quá là RAISE 'TOO_MANY_BUCKETS' để BE
--    trả 400 kèm hướng dẫn thu hẹp, không để người dùng chờ tới timeout. Chỉ TOTALS (biểu đồ đọc tổng).
CREATE OR REPLACE FUNCTION public.warehouse_kpi_series(
  p_warehouse_ids text[] DEFAULT NULL,
  p_categories    text[] DEFAULT NULL,
  p_grain         text    DEFAULT 'month',
  p_from          date    DEFAULT NULL,
  p_to            date    DEFAULT NULL,
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
  v_step interval;
  v_start date; v_end date; v_n int; v_key text; v_one jsonb; v_ttl int;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF p_grain NOT IN ('day', 'week', 'month', 'year') THEN RAISE EXCEPTION 'BAD_GRAIN'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'BAD_RANGE'; END IF;
  v_step  := CASE p_grain WHEN 'day' THEN interval '1 day' WHEN 'week' THEN interval '7 days'
                          WHEN 'month' THEN interval '1 month' ELSE interval '1 year' END;
  v_start := CASE p_grain WHEN 'day' THEN p_from ELSE date_trunc(p_grain, p_from)::date END;
  -- Số kỳ = số bước từ kỳ chứa p_from tới kỳ chứa p_to
  v_n := CASE p_grain
           WHEN 'day'   THEN (p_to - p_from) + 1
           WHEN 'week'  THEN ((date_trunc('week', p_to)::date - v_start) / 7) + 1
           WHEN 'month' THEN (extract(year FROM p_to) - extract(year FROM v_start)) * 12 + (extract(month FROM p_to) - extract(month FROM v_start)) + 1
           ELSE (extract(year FROM p_to) - extract(year FROM v_start)) + 1 END;
  IF v_n > 60 THEN RAISE EXCEPTION 'TOO_MANY_BUCKETS:%', v_n; END IF;

  FOR i IN 0..(v_n - 1) LOOP
    v_end := (v_start + v_step - interval '1 day')::date;
    v_key := CASE p_grain WHEN 'day' THEN to_char(v_start, 'YYYY-MM-DD') WHEN 'week' THEN to_char(v_start, 'IYYY-"W"IW')
                          WHEN 'month' THEN to_char(v_start, 'YYYY-MM') ELSE to_char(v_start, 'YYYY') END;
    v_ttl := CASE WHEN v_end < current_date THEN greatest(coalesce(p_ttl_seconds, 300), 86400) ELSE p_ttl_seconds END;
    v_one := warehouse_kpi_cached(p_warehouse_ids, p_categories, v_start, v_end, p_std_hours, p_pct_low, p_slow_days, p_dead_days, v_ttl, true);
    v_out := v_out || jsonb_build_object('key', v_key, 'from', v_start, 'to', v_end, 'days', (v_end - v_start + 1),
                                         'totals', v_one->'totals', 'cost_shared', v_one->'cost_shared');
    v_start := (v_start + v_step)::date;
  END LOOP;
  RETURN v_out;
END;
$$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260909_tms_orders_summary_done.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- Ô "Hoàn thành" của Kế hoạch VC đếm NHẦM NGUỒN — luôn ra 0 (phát hiện 09/09 khi rà từng báo cáo).
--
-- TRIỆU CHỨNG: SummaryBand trang Kế hoạch VC hiện `Hoàn thành 0/3.458` trong khi 3.143 lệnh của
-- khoảng đó đang mang `TmsOrder.status='DONE'`. Không lỗi, không cảnh báo — chỉ là số 0 vĩnh viễn.
--
-- NGUYÊN NHÂN: `tms_orders_summary` suy "đã xong" từ TRẠNG THÁI DÒNG XE:
--     done = lệnh có dòng xe VÀ không dòng nào status <> 'DONE'
--   Nhưng KHÔNG đường ghi nào trong app đặt `TmsVehicleSlot.status='DONE'` — đặt lịch chỉ ghi
--   'BOOKED' (vehicleSlotController / outboundController), còn 'ARRIVED'/'DONE' chỉ được ĐỌC trong
--   các gác an toàn. Đo staging 09/09: TmsVehicleSlot chỉ có BOOKED (3.264) và PENDING (230).
--   ⇒ điều kiện "mọi dòng xe = DONE" không bao giờ đúng ⇒ done ≡ 0.
--   Đây đúng lớp lỗi mà `20260907_tmsorder_status_enum.sql` đã cảnh báo trước: "báo cáo lệnh đã
--   hoàn thành đầu tiên sẽ mất số liệu — và mất IM LẶNG".
--
-- SỬA: "Hoàn thành" của Kế hoạch VC = LỆNH đã xong (`TmsOrder.status='DONE'`, do kho nhận xác nhận
--   qua inboundController/completeTransfer) — cùng đơn vị với mẫu số `orders`, đúng nhãn trên màn.
--   Trạng thái DÒNG XE là chuyện đặt lịch, không phải chuyện lệnh xong.
--
-- ÁP: Supabase Dashboard → SQL Editor, chạy nguyên file. STAGING trước, kiểm, rồi mới tới DB thật.
-- Chạy lại nhiều lần vô hại. Chỉ đổi MỘT biểu thức, phần còn lại giữ nguyên bản 20260728.
--
-- Kiểm sau khi chạy (phải khớp nhau):
--   SELECT (tms_orders_summary('2026-07-01','2026-08-31')->>'done')::int AS rpc_done,
--          (SELECT count(*) FROM "TmsOrder"
--            WHERE date BETWEEN '2026-07-01' AND '2026-08-31'
--              AND source_type <> 'TRANSFER' AND status = 'DONE') AS oracle_done;

CREATE OR REPLACE FUNCTION public.tms_orders_summary(
  p_date_from date, p_date_to date,
  p_warehouse_id text DEFAULT NULL, p_ncc_user uuid DEFAULT NULL,
  p_categories text[] DEFAULT NULL, p_scope_wh text[] DEFAULT NULL,
  p_directions text[] DEFAULT NULL, p_dvvt uuid[] DEFAULT NULL,
  p_wh_types text[] DEFAULT NULL, p_vehicle_types text[] DEFAULT NULL,
  p_slot_ids uuid[] DEFAULT NULL, p_unbooked boolean DEFAULT false,
  p_search text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  result jsonb;
  s text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  WITH base AS (
    SELECT o.id, o.date, o.created_at, o.direction, o.ncc_id, o.warehouse_type, o.vehicle_type,
           o.planned_boxes, o.planned_pallets, o.planned_tons, o.order_code, o.npp_name, o.notes,
           o.status
    FROM "TmsOrder" o
    WHERE o.date >= p_date_from AND o.date <= p_date_to
      AND o.source_type <> 'TRANSFER'
      AND (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id)
      AND (p_ncc_user     IS NULL OR o.ncc_id       = p_ncc_user)
      AND (p_scope_wh     IS NULL OR o.warehouse_id = ANY (p_scope_wh))
      AND (p_categories   IS NULL OR o.warehouse_type IS NULL OR wt_cats(o.warehouse_type) && p_categories)
  ),
  f AS (
    SELECT b.* FROM base b
    WHERE (p_directions IS NULL OR b.direction      = ANY (p_directions))
      AND (p_dvvt       IS NULL OR b.ncc_id         = ANY (p_dvvt))
      AND (p_wh_types   IS NULL OR wt_cats(b.warehouse_type) && p_wh_types)
      AND (p_vehicle_types IS NULL OR b.vehicle_type = ANY (p_vehicle_types) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s2
            JOIN "TmsVehicleSlot" s3 ON s3.consolidation_group_id = s2.consolidation_group_id
            JOIN base d ON d.id = s3.order_id
            WHERE s2.order_id = b.id AND s2.consolidation_group_id IS NOT NULL
              AND d.vehicle_type = ANY (p_vehicle_types)
              AND (p_directions IS NULL OR d.direction      = ANY (p_directions))
              AND (p_dvvt       IS NULL OR d.ncc_id         = ANY (p_dvvt))
              AND (p_wh_types   IS NULL OR wt_cats(d.warehouse_type) && p_wh_types)))
      AND ((p_slot_ids IS NULL AND NOT p_unbooked) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s2 WHERE s2.order_id = b.id
              AND ((p_unbooked AND s2.slot_id IS NULL)
                OR (p_slot_ids IS NOT NULL AND s2.slot_id = ANY (p_slot_ids)))))
      AND (s IS NULL
           OR unaccent(lower(coalesce(b.order_code, ''))) LIKE unaccent(lower('%' || s || '%'))
           OR unaccent(lower(coalesce(b.npp_name,   ''))) LIKE unaccent(lower('%' || s || '%'))
           OR unaccent(lower(coalesce(b.notes,      ''))) LIKE unaccent(lower('%' || s || '%'))
           OR EXISTS (SELECT 1 FROM "TmsVehicleSlot" s2
                      WHERE s2.order_id = b.id
                        AND unaccent(lower(coalesce(s2.license_plate, ''))) LIKE unaccent(lower('%' || s || '%'))))
  ),
  fslots AS (
    SELECT f.id AS order_id, s2.id AS slot_id, s2.consolidation_group_id, s2.is_consolidation_primary,
           row_number() OVER (PARTITION BY f.id ORDER BY s2.created_at, s2.id) - 1 AS slot_idx,
           (s2.id IS NULL OR s2.consolidation_group_id IS NULL OR s2.is_consolidation_primary) AS numbered
    FROM f LEFT JOIN "TmsVehicleSlot" s2 ON s2.order_id = f.id
  ),
  sec_f AS (
    SELECT DISTINCT s2.order_id
    FROM "TmsVehicleSlot" s2
    JOIN "TmsVehicleSlot" p ON p.consolidation_group_id = s2.consolidation_group_id AND p.is_consolidation_primary
    WHERE s2.consolidation_group_id IS NOT NULL AND NOT s2.is_consolidation_primary AND p.order_id <> s2.order_id
      AND EXISTS (SELECT 1 FROM f x WHERE x.id = s2.order_id)
      AND EXISTS (SELECT 1 FROM f x WHERE x.id = p.order_id)
  ),
  vehicles AS (
    SELECT count(*) AS n FROM (
      SELECT 1 FROM fslots WHERE numbered
      UNION ALL
      SELECT 1 FROM fslots c
      WHERE NOT c.numbered AND c.slot_idx = 0
        AND NOT EXISTS (SELECT 1 FROM fslots c2 WHERE c2.order_id = c.order_id AND c2.numbered)
        AND NOT EXISTS (SELECT 1 FROM sec_f sf WHERE sf.order_id = c.order_id)
    ) x
  ),
  -- ĐÃ SỬA 09/09: "xong" = trạng thái LỆNH, không suy từ trạng thái dòng xe (không đường ghi nào
  -- đặt TmsVehicleSlot.status='DONE' nên điều kiện cũ luôn sai ⇒ ô này đứng yên ở 0).
  done AS (
    SELECT count(*) AS n FROM f WHERE f.status = 'DONE'
  )
  SELECT jsonb_build_object(
    'orders',   (SELECT count(*) FROM f),
    'vehicles', (SELECT n FROM vehicles),
    'boxes',    (SELECT COALESCE(sum(planned_boxes),   0) FROM f),
    'pallets',  (SELECT COALESCE(sum(planned_pallets), 0) FROM f),
    'tons',     (SELECT COALESCE(sum(planned_tons),    0) FROM f),
    'done',     (SELECT n FROM done)
  ) INTO result;
  RETURN result;
END $function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260909b_tms_orders_summary_done_v2.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- Ô "Hoàn thành" của Kế hoạch VC — BẢN 2 (09/09, sau khi nạp dữ liệu vận hành tháng 9).
--
-- Bản 1 (20260909_tms_orders_summary_done.sql) đã bỏ cách suy từ TmsVehicleSlot.status='DONE'
-- (giá trị KHÔNG đường ghi nào đặt) và đếm TmsOrder.status='DONE'. Đúng cho dữ liệu 07–08/2026
-- nhưng LỘ RA THIẾU ngay khi có dữ liệu đi đúng luồng Kế hoạch xuất: 45/45 xe của 01–09/09 chạy
-- xong, chuyến đã COMPLETED, mà ô vẫn 0/45 — lệnh sinh từ KH xuất giữ nguyên PENDING vì "xong"
-- của nó nằm ở CHUYẾN chứ không ở lệnh.
-- Đo staging 09/09: 3.143 lệnh DONE của 07–08 KHÔNG có chuyến cùng Số xe; 45 lệnh của tháng 9 có
-- chuyến COMPLETED nhưng status PENDING — hai dân số tách bạch, phải cộng cả hai đường.
--
-- ÁP: Supabase Dashboard → SQL Editor, chạy nguyên file. STAGING trước. Chạy lại vô hại.
-- Kiểm sau khi chạy:
--   SELECT (tms_orders_summary('2026-09-01','2026-09-09')->>'done')::int;   -- kỳ vọng 45
--   SELECT (tms_orders_summary('2026-07-01','2026-08-31')->>'done')::int;   -- kỳ vọng 3143

CREATE OR REPLACE FUNCTION public.tms_orders_summary(
  p_date_from date, p_date_to date,
  p_warehouse_id text DEFAULT NULL, p_ncc_user uuid DEFAULT NULL,
  p_categories text[] DEFAULT NULL, p_scope_wh text[] DEFAULT NULL,
  p_directions text[] DEFAULT NULL, p_dvvt uuid[] DEFAULT NULL,
  p_wh_types text[] DEFAULT NULL, p_vehicle_types text[] DEFAULT NULL,
  p_slot_ids uuid[] DEFAULT NULL, p_unbooked boolean DEFAULT false,
  p_search text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  result jsonb;
  s text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  WITH base AS (
    SELECT o.id, o.date, o.created_at, o.direction, o.ncc_id, o.warehouse_type, o.vehicle_type,
           o.planned_boxes, o.planned_pallets, o.planned_tons, o.order_code, o.npp_name, o.notes,
           o.status
    FROM "TmsOrder" o
    WHERE o.date >= p_date_from AND o.date <= p_date_to
      AND o.source_type <> 'TRANSFER'
      AND (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id)
      AND (p_ncc_user     IS NULL OR o.ncc_id       = p_ncc_user)
      AND (p_scope_wh     IS NULL OR o.warehouse_id = ANY (p_scope_wh))
      AND (p_categories   IS NULL OR o.warehouse_type IS NULL OR wt_cats(o.warehouse_type) && p_categories)
  ),
  f AS (
    SELECT b.* FROM base b
    WHERE (p_directions IS NULL OR b.direction      = ANY (p_directions))
      AND (p_dvvt       IS NULL OR b.ncc_id         = ANY (p_dvvt))
      AND (p_wh_types   IS NULL OR wt_cats(b.warehouse_type) && p_wh_types)
      AND (p_vehicle_types IS NULL OR b.vehicle_type = ANY (p_vehicle_types) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s2
            JOIN "TmsVehicleSlot" s3 ON s3.consolidation_group_id = s2.consolidation_group_id
            JOIN base d ON d.id = s3.order_id
            WHERE s2.order_id = b.id AND s2.consolidation_group_id IS NOT NULL
              AND d.vehicle_type = ANY (p_vehicle_types)
              AND (p_directions IS NULL OR d.direction      = ANY (p_directions))
              AND (p_dvvt       IS NULL OR d.ncc_id         = ANY (p_dvvt))
              AND (p_wh_types   IS NULL OR wt_cats(d.warehouse_type) && p_wh_types)))
      AND ((p_slot_ids IS NULL AND NOT p_unbooked) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s2 WHERE s2.order_id = b.id
              AND ((p_unbooked AND s2.slot_id IS NULL)
                OR (p_slot_ids IS NOT NULL AND s2.slot_id = ANY (p_slot_ids)))))
      AND (s IS NULL
           OR unaccent(lower(coalesce(b.order_code, ''))) LIKE unaccent(lower('%' || s || '%'))
           OR unaccent(lower(coalesce(b.npp_name,   ''))) LIKE unaccent(lower('%' || s || '%'))
           OR unaccent(lower(coalesce(b.notes,      ''))) LIKE unaccent(lower('%' || s || '%'))
           OR EXISTS (SELECT 1 FROM "TmsVehicleSlot" s2
                      WHERE s2.order_id = b.id
                        AND unaccent(lower(coalesce(s2.license_plate, ''))) LIKE unaccent(lower('%' || s || '%'))))
  ),
  fslots AS (
    SELECT f.id AS order_id, s2.id AS slot_id, s2.consolidation_group_id, s2.is_consolidation_primary,
           row_number() OVER (PARTITION BY f.id ORDER BY s2.created_at, s2.id) - 1 AS slot_idx,
           (s2.id IS NULL OR s2.consolidation_group_id IS NULL OR s2.is_consolidation_primary) AS numbered
    FROM f LEFT JOIN "TmsVehicleSlot" s2 ON s2.order_id = f.id
  ),
  sec_f AS (
    SELECT DISTINCT s2.order_id
    FROM "TmsVehicleSlot" s2
    JOIN "TmsVehicleSlot" p ON p.consolidation_group_id = s2.consolidation_group_id AND p.is_consolidation_primary
    WHERE s2.consolidation_group_id IS NOT NULL AND NOT s2.is_consolidation_primary AND p.order_id <> s2.order_id
      AND EXISTS (SELECT 1 FROM f x WHERE x.id = s2.order_id)
      AND EXISTS (SELECT 1 FROM f x WHERE x.id = p.order_id)
  ),
  vehicles AS (
    SELECT count(*) AS n FROM (
      SELECT 1 FROM fslots WHERE numbered
      UNION ALL
      SELECT 1 FROM fslots c
      WHERE NOT c.numbered AND c.slot_idx = 0
        AND NOT EXISTS (SELECT 1 FROM fslots c2 WHERE c2.order_id = c.order_id AND c2.numbered)
        AND NOT EXISTS (SELECT 1 FROM sec_f sf WHERE sf.order_id = c.order_id)
    ) x
  ),
  -- "Xong" đến từ HAI ĐƯỜNG KHÁC NHAU trên cùng một trang, phải cộng cả hai:
  --   · lệnh nhập / chuyển kho: kho nhận xác nhận ⇒ chính lệnh mang status='DONE'
  --   · lệnh sinh từ Kế hoạch xuất: việc xong nằm ở CHUYẾN (cùng Số xe) chuyển COMPLETED,
  --     bản thân lệnh vẫn PENDING — không cộng đường này thì mọi xe của luồng KH xuất báo 0.
  done AS (
    SELECT count(*) AS n FROM f
    WHERE f.status = 'DONE'
       OR EXISTS (SELECT 1 FROM "GroupDeliveryOrder" g
                   WHERE g.group_code = f.order_code AND g.status = 'COMPLETED')
  )
  SELECT jsonb_build_object(
    'orders',   (SELECT count(*) FROM f),
    'vehicles', (SELECT n FROM vehicles),
    'boxes',    (SELECT COALESCE(sum(planned_boxes),   0) FROM f),
    'pallets',  (SELECT COALESCE(sum(planned_pallets), 0) FROM f),
    'tons',     (SELECT COALESCE(sum(planned_tons),    0) FROM f),
    'done',     (SELECT n FROM done)
  ) INTO result;
  RETURN result;
END $function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260909c_kpi_series_stale_cache.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- KPI · biểu đồ theo chu kỳ: "kỳ đã qua" KHÔNG có nghĩa là "kỳ đã chốt".
--
-- Bản cũ giữ cache TỐI THIỂU 24 GIỜ cho mọi kỳ kết thúc trước hôm nay, với giả định số của kỳ cũ
-- không đổi nữa. Giả định đó sai trong kho: phiếu nhập ghi bù ca đêm, chuyến hoàn thành muộn, sửa
-- chấm công, khai chi phí tháng trước, VL06O dội xuống trễ — tất cả đều đổi số của kỳ ĐÃ kết thúc.
-- Đo thật 09/09/2026: nạp trọn dữ liệu vận hành 01–09/09 xong, ô tổng cả khoảng ra đúng (23/23
-- chuyến, 97 pallet) nhưng biểu đồ theo NGÀY chỉ có điểm ở 09/09 — 8 kỳ còn lại đọc bản cache tính
-- lúc chưa có dữ liệu, và không có đường nào làm mới trong 24h.
--
-- Hai sửa đổi, đều nằm gọn trong warehouse_kpi_series (hàm tính không đổi):
--   1. Cache dài chỉ áp cho kỳ kết thúc đã QUÁ 7 NGÀY. Trong 7 ngày gần nhất dùng TTL chung
--      (cờ dashboard_cache_seconds) nên dữ liệu về muộn hiện ra trong vòng một nhịp cache.
--      Vì sao không bỏ hẳn cache dài: đo 09/09 mỗi kỳ tốn ~1,3–1,7s (1 kho hay 153 kho đều vậy),
--      chart 60 kỳ tính tươi hết ≈ 90s > statement_timeout 55s. Cửa sổ 7 ngày = 4–8 kỳ tươi (~6–12s),
--      vẫn trong hạn, và với chu kỳ THÁNG thì tháng trước còn sống hết tuần đầu tháng sau — đúng lúc
--      người ta khai chi phí và chốt công.
--   2. Tắt cache thì phải tắt được CẢ chuỗi: greatest(0, 86400) khiến dashboard_cache_seconds = 0
--      vẫn cho ra cache 24h ở kỳ cũ, tức cái nút tắt không tắt được gì.
--
-- CÒN LẠI (chưa xử ở bản này): sửa dữ liệu của kỳ CŨ HƠN 7 ngày vẫn phải chờ hết 24h. Muốn đúng
-- tuyệt đối thì cần mốc "dữ liệu quá khứ vừa đổi" do trigger ghi rồi đối chiếu với computed_at —
-- việc riêng, có đánh đổi hiệu năng, chưa làm.

CREATE OR REPLACE FUNCTION public.warehouse_kpi_series(
  p_warehouse_ids text[] DEFAULT NULL,
  p_categories    text[] DEFAULT NULL,
  p_grain         text    DEFAULT 'month',
  p_from          date    DEFAULT NULL,
  p_to            date    DEFAULT NULL,
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
  v_step interval;
  v_start date; v_end date; v_n int; v_key text; v_one jsonb; v_ttl int;
  v_out jsonb := '[]'::jsonb;
  -- Số ngày một kỳ đã kết thúc còn được coi là "có thể còn nhận dữ liệu muộn".
  c_grace_days constant int := 7;
BEGIN
  IF p_grain NOT IN ('day', 'week', 'month', 'year') THEN RAISE EXCEPTION 'BAD_GRAIN'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'BAD_RANGE'; END IF;
  v_step  := CASE p_grain WHEN 'day' THEN interval '1 day' WHEN 'week' THEN interval '7 days'
                          WHEN 'month' THEN interval '1 month' ELSE interval '1 year' END;
  v_start := CASE p_grain WHEN 'day' THEN p_from ELSE date_trunc(p_grain, p_from)::date END;
  -- Số kỳ = số bước từ kỳ chứa p_from tới kỳ chứa p_to
  v_n := CASE p_grain
           WHEN 'day'   THEN (p_to - p_from) + 1
           WHEN 'week'  THEN ((date_trunc('week', p_to)::date - v_start) / 7) + 1
           WHEN 'month' THEN (extract(year FROM p_to) - extract(year FROM v_start)) * 12 + (extract(month FROM p_to) - extract(month FROM v_start)) + 1
           ELSE (extract(year FROM p_to) - extract(year FROM v_start)) + 1 END;
  IF v_n > 60 THEN RAISE EXCEPTION 'TOO_MANY_BUCKETS:%', v_n; END IF;

  FOR i IN 0..(v_n - 1) LOOP
    v_end := (v_start + v_step - interval '1 day')::date;
    v_key := CASE p_grain WHEN 'day' THEN to_char(v_start, 'YYYY-MM-DD') WHEN 'week' THEN to_char(v_start, 'IYYY-"W"IW')
                          WHEN 'month' THEN to_char(v_start, 'YYYY-MM') ELSE to_char(v_start, 'YYYY') END;
    v_ttl := CASE
               WHEN coalesce(p_ttl_seconds, 0) <= 0            THEN p_ttl_seconds            -- tắt cache = tắt cả chuỗi
               WHEN v_end < current_date - c_grace_days        THEN greatest(p_ttl_seconds, 86400)
               ELSE p_ttl_seconds END;
    v_one := warehouse_kpi_cached(p_warehouse_ids, p_categories, v_start, v_end, p_std_hours, p_pct_low, p_slow_days, p_dead_days, v_ttl, true);
    v_out := v_out || jsonb_build_object('key', v_key, 'from', v_start, 'to', v_end, 'days', (v_end - v_start + 1),
                                         'totals', v_one->'totals', 'cost_shared', v_one->'cost_shared');
    v_start := (v_start + v_step)::date;
  END LOOP;
  RETURN v_out;
END;
$$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260910_dock_capacity.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260910 — CỬA XUẤT CÓ SỨC CHỨA XE + CHUYẾN GHI CỬA (Directed Work đợt 1a — user chốt 09/09/2026)
-- ============================================================================
-- VÌ SAO: kế hoạch lấy hàng (đợt 1c) tính đường đi TỪ CỬA mà chuyến hiện không ghi đậu cửa nào; Ba Vì có
-- 5 cửa xuất. User chốt: "chuyến phải ghi cửa, cửa có tối đa xe, xe hoàn thành đơn thì xe tiếp theo mới
-- chọn được, thủ kho chọn cửa lúc Bắt đầu; kho nào có cửa trên bản vẽ thì kho đó mới bắt".
--
-- MÔ HÌNH:
--   • `Location.dock_capacity` = số XE tối đa đứng cùng lúc ở cửa (chỉ có nghĩa với kind DOCK_OUT/DOCK_IN).
--     NULL = không giới hạn. Cửa đã có trên bản vẽ backfill = 1 (một xe một cửa là mặc định an toàn).
--     Điểm đầu dãy (DROP) KHÔNG dùng cột này — sức chứa pallet chờ của nó là `max_pallets` (0 = không giới hạn).
--   • `GroupDeliveryOrder.dock_location_id` + `dock_assigned_at`: chuyến đậu cửa nào từ lúc nào. GIỮ LẠI sau
--     Hoàn thành (báo cáo cửa nào bốc chuyến nào) — suất cửa được nhả theo TRẠNG THÁI, không theo cột:
--     chuyến chiếm suất khi status IN ('IN_PROGRESS','PAUSED').
--   • Đếm theo XE, không theo chuyến: cùng biển số đang ở cửa thì chuyến thứ hai gắn cùng cửa KHÔNG tốn
--     suất (một xe bốc nhiều đơn là ca thường). Chuyến không biển (đã duyệt bỏ cổng) đếm là một xe.
--   • Gán cửa đi qua RPC khoá dòng cửa (FOR UPDATE) — hai thủ kho bấm cùng lúc chỉ một người lấy suất cuối.
--
-- KHÔNG đụng hành vi hiện có: cột nullable; startGDO chỉ đòi cửa khi kho CÓ cửa xuất trên bản vẽ.
-- ============================================================================

-- ── 1. Sức chứa xe của cửa ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public."Location" ADD COLUMN IF NOT EXISTS dock_capacity integer;
ALTER TABLE public."Location" DROP CONSTRAINT IF EXISTS location_dock_capacity_range;
ALTER TABLE public."Location" ADD CONSTRAINT location_dock_capacity_range
  CHECK (dock_capacity IS NULL OR (dock_capacity >= 1 AND dock_capacity <= 50));
COMMENT ON COLUMN public."Location".dock_capacity IS 'Số xe tối đa đứng cùng lúc ở cửa (kind DOCK_OUT/DOCK_IN). NULL = không giới hạn. Không dùng cho STORAGE/DROP.';

-- Cửa đã vẽ trước migration này: mặc định 1 xe / cửa
UPDATE public."Location" SET dock_capacity = 1
 WHERE kind IN ('DOCK_OUT', 'DOCK_IN') AND dock_capacity IS NULL;

-- ── 2. Chuyến ghi cửa ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public."GroupDeliveryOrder"
  ADD COLUMN IF NOT EXISTS dock_location_id text REFERENCES public."Location"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dock_assigned_at timestamptz;
COMMENT ON COLUMN public."GroupDeliveryOrder".dock_location_id IS 'Cửa xuất (Location kind DOCK_OUT) chuyến đậu — chọn lúc Bắt đầu. Giữ lại sau Hoàn thành; suất cửa tính theo status IN_PROGRESS/PAUSED.';
COMMENT ON COLUMN public."GroupDeliveryOrder".dock_assigned_at IS 'Lúc gán cửa (đổi cửa giữa chuyến thì cập nhật).';

-- Đếm xe đang chiếm cửa: chỉ dòng đang chiếm suất
CREATE INDEX IF NOT EXISTS idx_gdo_dock_active
  ON public."GroupDeliveryOrder" (dock_location_id)
  WHERE dock_location_id IS NOT NULL AND status IN ('IN_PROGRESS', 'PAUSED');

-- ── 3. RPC gán cửa cho chuyến — khoá dòng cửa, đếm XE ────────────────────────────────────────────
-- p_plate = biển số ĐÃ CHUẨN HOÁ của chuyến sắp bắt đầu (chưa nằm trên dòng lúc Bắt đầu) — NULL = chuyến không biển.
-- Trả jsonb:
--   {ok:true, occupied, capacity}
--   {ok:false, error:'NOT_FOUND'|'NOT_DOCK'|'WRONG_WAREHOUSE'|'DOCK_FULL', occupied, capacity, plates:[...]}
-- Không GRANT (default đã đóng PUBLIC — backend đi service_role).
CREATE OR REPLACE FUNCTION public.gdo_assign_dock(p_gdo_id text, p_dock_id text, p_plate text, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_dock   record;
  v_gdo    record;
  v_occ    integer;
  v_same   boolean;
  v_plates jsonb;
BEGIN
  -- Khoá dòng cửa TRƯỚC: mọi lượt gán vào cùng cửa xếp hàng sau nhau
  SELECT id, warehouse_id, kind, is_active, dock_capacity, location_code, row
    INTO v_dock
    FROM public."Location" WHERE id = p_dock_id FOR UPDATE;
  IF v_dock.id IS NULL OR v_dock.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_dock.kind <> 'DOCK_OUT' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_DOCK');
  END IF;

  SELECT id, warehouse_id, status INTO v_gdo FROM public."GroupDeliveryOrder" WHERE id = p_gdo_id FOR UPDATE;
  IF v_gdo.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_gdo.warehouse_id IS DISTINCT FROM v_dock.warehouse_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'WRONG_WAREHOUSE');
  END IF;

  -- Xe đang chiếm cửa (trừ chính chuyến này): biển khác nhau = xe khác nhau; không biển = mỗi chuyến một xe
  WITH occ AS (
    SELECT g.license_plate
      FROM public."GroupDeliveryOrder" g
     WHERE g.dock_location_id = p_dock_id
       AND g.status IN ('IN_PROGRESS', 'PAUSED')
       AND g.id <> p_gdo_id
  )
  SELECT count(DISTINCT license_plate) FILTER (WHERE license_plate IS NOT NULL)
         + count(*) FILTER (WHERE license_plate IS NULL),
         bool_or(p_plate IS NOT NULL AND license_plate = p_plate),
         coalesce(jsonb_agg(DISTINCT license_plate) FILTER (WHERE license_plate IS NOT NULL), '[]'::jsonb)
    INTO v_occ, v_same, v_plates
    FROM occ;
  v_occ  := coalesce(v_occ, 0);
  v_same := coalesce(v_same, false);

  IF v_dock.dock_capacity IS NOT NULL AND NOT v_same AND v_occ >= v_dock.dock_capacity THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DOCK_FULL',
                              'occupied', v_occ, 'capacity', v_dock.dock_capacity, 'plates', v_plates,
                              'dock_name', v_dock.row, 'dock_code', v_dock.location_code);
  END IF;

  UPDATE public."GroupDeliveryOrder"
     SET dock_location_id = p_dock_id, dock_assigned_at = now(), updated_at = now()
   WHERE id = p_gdo_id;

  RETURN jsonb_build_object('ok', true, 'occupied', v_occ + (CASE WHEN v_same THEN 0 ELSE 1 END),
                            'capacity', v_dock.dock_capacity, 'dock_name', v_dock.row, 'dock_code', v_dock.location_code);
END;
$$;

-- ── 4. RPC tình trạng các cửa của một kho — 1 round-trip, nuôi ô chọn cửa lúc Bắt đầu + lớp phủ Cửa ──
-- Mỗi cửa: sức chứa, số xe đang chiếm, danh sách chuyến đang ở cửa (biển, mã chuyến, giờ vào cửa, trạng thái).
CREATE OR REPLACE FUNCTION public.warehouse_docks_status(p_warehouse_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH docks AS (
    SELECT l.id, l.location_code, l.row AS name, l.kind, l.dock_capacity, l.grid_x, l.grid_y
      FROM public."Location" l
     WHERE l.warehouse_id = p_warehouse_id AND l.is_active AND l.kind IN ('DOCK_OUT', 'DOCK_IN')
  ), veh AS (
    SELECT g.dock_location_id, g.id AS gdo_id, g.group_code, g.license_plate, g.status,
           g.dock_assigned_at, g.started_at
      FROM public."GroupDeliveryOrder" g
      JOIN docks d ON d.id = g.dock_location_id
     WHERE g.status IN ('IN_PROGRESS', 'PAUSED')
  ), agg AS (
    SELECT dock_location_id,
           count(DISTINCT license_plate) FILTER (WHERE license_plate IS NOT NULL)
           + count(*) FILTER (WHERE license_plate IS NULL) AS occupied,
           jsonb_agg(jsonb_build_object('gdo_id', gdo_id, 'group_code', group_code, 'license_plate', license_plate,
                                        'status', status, 'dock_assigned_at', dock_assigned_at, 'started_at', started_at)
                     ORDER BY dock_assigned_at) AS vehicles
      FROM veh GROUP BY dock_location_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'location_code', d.location_code, 'name', d.name, 'kind', d.kind,
           'capacity', d.dock_capacity, 'occupied', coalesce(a.occupied, 0),
           'vehicles', coalesce(a.vehicles, '[]'::jsonb),
           'grid_x', d.grid_x, 'grid_y', d.grid_y) ORDER BY d.kind, d.name), '[]'::jsonb)
    FROM docks d LEFT JOIN agg a ON a.dock_location_id = d.id;
$$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260910b_dock_reservation_window.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260910b — SUẤT CỬA: đếm cả chuyến VỪA ĐƯỢC GÁN CỬA nhưng chưa kịp sang "Đang xuất" (vá đua, 09/09)
-- ============================================================================
-- BUG đo thật bằng gói QA 56 [6a] ngay sau bản 20260910: 5 xe khác biển cùng bấm Bắt đầu vào cửa còn 1 suất
-- → 2×200, cửa 2/2 thành 3/2. Vì sao: gdo_assign_dock khoá dòng cửa và đếm chuyến `status IN (IN_PROGRESS,
-- PAUSED)`, nhưng lúc RPC chạy chuyến của người vừa thắng vẫn là PENDING — status chỉ đổi ở câu CAS phía Node
-- SAU RPC. Người thứ hai vào khoá kế tiếp, đếm không thấy người trước ⇒ cũng được gán. Khoá dòng đúng mà đếm
-- sai tập ⇒ khoá vô nghĩa.
--
-- Vá: một chuyến PENDING đã có `dock_assigned_at` trong 2 phút gần nhất = ĐANG GIỮ SUẤT (Bắt đầu đang bay).
-- Node nhả ngay khi CAS Bắt đầu thua (đặt dock về NULL); nếu tiến trình chết giữa đường thì suất tự hết hạn
-- sau 2 phút — không có cửa "kẹt" vĩnh viễn vì một request đứt. Cùng vị từ cho warehouse_docks_status để ô chọn
-- và bản vẽ nói cùng một con số với RPC gán.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gdo_holds_dock(p_status text, p_dock_assigned_at timestamptz)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status IN ('IN_PROGRESS', 'PAUSED')
      OR (p_status = 'PENDING' AND p_dock_assigned_at IS NOT NULL AND p_dock_assigned_at > now() - interval '2 minutes');
$$;
COMMENT ON FUNCTION public.gdo_holds_dock(text, timestamptz) IS 'Chuyến đang chiếm suất cửa: đang xuất/tạm dừng, hoặc PENDING vừa được gán cửa <2 phút (Bắt đầu đang bay).';

-- Index cũ chỉ phủ IN_PROGRESS/PAUSED — mở rộng để đếm cả dòng đang giữ suất (số dòng nhỏ, không đáng kể)
DROP INDEX IF EXISTS public.idx_gdo_dock_active;
CREATE INDEX IF NOT EXISTS idx_gdo_dock_active
  ON public."GroupDeliveryOrder" (dock_location_id)
  WHERE dock_location_id IS NOT NULL AND status IN ('IN_PROGRESS', 'PAUSED', 'PENDING');

CREATE OR REPLACE FUNCTION public.gdo_assign_dock(p_gdo_id text, p_dock_id text, p_plate text, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_dock   record;
  v_gdo    record;
  v_occ    integer;
  v_same   boolean;
  v_plates jsonb;
BEGIN
  SELECT id, warehouse_id, kind, is_active, dock_capacity, location_code, row
    INTO v_dock
    FROM public."Location" WHERE id = p_dock_id FOR UPDATE;
  IF v_dock.id IS NULL OR v_dock.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_dock.kind <> 'DOCK_OUT' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_DOCK');
  END IF;

  SELECT id, warehouse_id, status INTO v_gdo FROM public."GroupDeliveryOrder" WHERE id = p_gdo_id FOR UPDATE;
  IF v_gdo.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_gdo.warehouse_id IS DISTINCT FROM v_dock.warehouse_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'WRONG_WAREHOUSE');
  END IF;

  -- Xe đang chiếm cửa (trừ chính chuyến này) — kể cả chuyến PENDING vừa được gán (<2 phút, Bắt đầu đang bay)
  WITH occ AS (
    SELECT g.license_plate
      FROM public."GroupDeliveryOrder" g
     WHERE g.dock_location_id = p_dock_id
       AND public.gdo_holds_dock(g.status, g.dock_assigned_at)
       AND g.id <> p_gdo_id
  )
  SELECT count(DISTINCT license_plate) FILTER (WHERE license_plate IS NOT NULL)
         + count(*) FILTER (WHERE license_plate IS NULL),
         bool_or(p_plate IS NOT NULL AND license_plate = p_plate),
         coalesce(jsonb_agg(DISTINCT license_plate) FILTER (WHERE license_plate IS NOT NULL), '[]'::jsonb)
    INTO v_occ, v_same, v_plates
    FROM occ;
  v_occ  := coalesce(v_occ, 0);
  v_same := coalesce(v_same, false);

  IF v_dock.dock_capacity IS NOT NULL AND NOT v_same AND v_occ >= v_dock.dock_capacity THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DOCK_FULL',
                              'occupied', v_occ, 'capacity', v_dock.dock_capacity, 'plates', v_plates,
                              'dock_name', v_dock.row, 'dock_code', v_dock.location_code);
  END IF;

  -- Chỉ ghi cửa + mốc giờ; biển số do câu CAS Bắt đầu ghi (không đặt biển lên dòng PENDING — thua CAS thì
  -- dòng chờ không được mang biển của người thua)
  UPDATE public."GroupDeliveryOrder"
     SET dock_location_id = p_dock_id, dock_assigned_at = now(), updated_at = now()
   WHERE id = p_gdo_id;

  RETURN jsonb_build_object('ok', true, 'occupied', v_occ + (CASE WHEN v_same THEN 0 ELSE 1 END),
                            'capacity', v_dock.dock_capacity, 'dock_name', v_dock.row, 'dock_code', v_dock.location_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.warehouse_docks_status(p_warehouse_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH docks AS (
    SELECT l.id, l.location_code, l.row AS name, l.kind, l.dock_capacity, l.grid_x, l.grid_y
      FROM public."Location" l
     WHERE l.warehouse_id = p_warehouse_id AND l.is_active AND l.kind IN ('DOCK_OUT', 'DOCK_IN')
  ), veh AS (
    SELECT g.dock_location_id, g.id AS gdo_id, g.group_code, g.license_plate, g.status,
           g.dock_assigned_at, g.started_at
      FROM public."GroupDeliveryOrder" g
      JOIN docks d ON d.id = g.dock_location_id
     WHERE public.gdo_holds_dock(g.status, g.dock_assigned_at)
  ), agg AS (
    SELECT dock_location_id,
           count(DISTINCT license_plate) FILTER (WHERE license_plate IS NOT NULL)
           + count(*) FILTER (WHERE license_plate IS NULL) AS occupied,
           jsonb_agg(jsonb_build_object('gdo_id', gdo_id, 'group_code', group_code, 'license_plate', license_plate,
                                        'status', status, 'dock_assigned_at', dock_assigned_at, 'started_at', started_at)
                     ORDER BY dock_assigned_at) AS vehicles
      FROM veh GROUP BY dock_location_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'location_code', d.location_code, 'name', d.name, 'kind', d.kind,
           'capacity', d.dock_capacity, 'occupied', coalesce(a.occupied, 0),
           'vehicles', coalesce(a.vehicles, '[]'::jsonb),
           'grid_x', d.grid_x, 'grid_y', d.grid_y) ORDER BY d.kind, d.name), '[]'::jsonb)
    FROM docks d LEFT JOIN agg a ON a.dock_location_id = d.id;
$$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260910c_directed_work.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260910c — DIRECTED WORK đợt 1c: KẾ HOẠCH LẤY HÀNG THEO VỊ TRÍ + 3 BẢNG THEO VAI
-- (user chốt 10/09/2026 qua 6 vòng brainstorm — plan: docs/plans/DIRECTED_WORK_1C_PLAN.md)
-- ============================================================================
-- VÌ SAO: đo Ba Vì 10/09 — 5.973 pallet trong 216 ô, 62 % nằm tầng ≥ 2 (phải có xe nâng hạ),
-- mã lớn nhất rải 33 dãy · 3 khu · 10 NSX. Thủ kho hiện phải TỰ NHỚ thứ tự luân chuyển và tự chọn
-- dãy gần cửa; xe nâng hạ không có thứ tự nên xe chuyển đứng chờ. App đã có đủ nền để tính hộ:
-- bản vẽ lưới (đợt 0), cửa của chuyến (đợt 1a), luật luân chuyển (rotation.ts), BFS (warehouseGrid.ts).
--
-- MÔ HÌNH (3 vai nhìn 3 bảng, CÙNG một kế hoạch):
--   • Bắt đầu chuyến ở kho HƯỚNG DẪN ⇒ sinh `wms_tasks`: mỗi dòng = lấy bao nhiêu thùng của ĐÚNG
--     pallet nào, từ vị trí nào, đưa tới đâu, thứ tự mấy.
--   • Xe nâng HẠ xem tab "Cần hạ" (toàn kho, có thứ tự) · xe nâng CHUYỂN xem "Cần đưa ra"
--     (của mình) · thủ kho xem "Sắp quét" trên trang chuyến. Quét đủ ⇒ việc tự xong.
--   • Vai nào cũng có nút "✓ Xong" để tự đánh dấu (phòng quên) — mốc giờ, KHÔNG phải trạng thái
--     riêng: `lowered_at` (đã hạ) · `moved_at` (đã đưa ra) · `done_at` (thủ kho quét đủ).
--
-- QUY TẮC DATE (user chốt vòng 4 — điểm khó nhất): kho KHÔNG chạy FEFO toàn bộ. NPP đi ≥ 60 % nếu
-- CS không ghi chú; CS ghi chú bằng CHỮ (khi %, khi ngày) nên KHÔNG CÓ parser nào bền. Vì thế:
-- thủ kho BẮT BUỘC chốt quy tắc date cho từng dòng đơn trước khi xuất, và **FEFO là một LỰA CHỌN
-- phải bấm xác nhận**, không phải mặc định ngầm. Dòng chưa chốt ⇒ KHÔNG sinh việc (không ai
-- "tưởng mặc định rồi đi làm, sau mới update = làm sai").
--
-- KHÔNG đụng hành vi hiện có: mọi cột mới nullable hoặc có DEFAULT giữ nguyên nghĩa cũ;
-- `work_mode` mặc định 'MANUAL' = đúng cách kho đang chạy hôm nay.
-- ============================================================================

-- ── 1. Cờ CÁCH LÀM VIỆC — 2 tầng Kho + Loại kho (khuôn rotation/putaway đã có) ─────────────────
ALTER TABLE public."Warehouse"
  ADD COLUMN IF NOT EXISTS work_mode        text    NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS lower_from_level integer NOT NULL DEFAULT 2;

ALTER TABLE public."Warehouse" DROP CONSTRAINT IF EXISTS warehouse_work_mode_check;
ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_work_mode_check
  CHECK (work_mode IN ('MANUAL', 'GUIDED'));
ALTER TABLE public."Warehouse" DROP CONSTRAINT IF EXISTS warehouse_lower_from_level_range;
ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_lower_from_level_range
  CHECK (lower_from_level >= 1 AND lower_from_level <= 50);

COMMENT ON COLUMN public."Warehouse".work_mode IS
  'MANUAL = người tự chọn hàng (mặc định, hành vi cũ) · GUIDED = hệ thống sinh việc có thứ tự khi Bắt đầu chuyến (Directed Work 1c). Bật được khi kho quản theo tem QR và đã vẽ Sơ đồ kho.';
COMMENT ON COLUMN public."Warehouse".lower_from_level IS
  'Từ tầng này trở lên thì pallet phải qua XE NÂNG HẠ (mặc định 2 = T1 và sàn xe chuyển lấy trực tiếp). Đặt 1 nếu kho muốn mọi pallet trên kệ đều do xe hạ lấy.';

ALTER TABLE public.warehouse_type_configs
  ADD COLUMN IF NOT EXISTS work_mode        text,
  ADD COLUMN IF NOT EXISTS lower_from_level integer;

ALTER TABLE public.warehouse_type_configs DROP CONSTRAINT IF EXISTS whtc_work_mode_check;
ALTER TABLE public.warehouse_type_configs ADD CONSTRAINT whtc_work_mode_check
  CHECK (work_mode IS NULL OR work_mode IN ('MANUAL', 'GUIDED'));
ALTER TABLE public.warehouse_type_configs DROP CONSTRAINT IF EXISTS whtc_lower_from_level_range;
ALTER TABLE public.warehouse_type_configs ADD CONSTRAINT whtc_lower_from_level_range
  CHECK (lower_from_level IS NULL OR (lower_from_level >= 1 AND lower_from_level <= 50));

COMMENT ON COLUMN public.warehouse_type_configs.work_mode        IS 'Ghi đè cách làm việc cho LOẠI KHO này. NULL = theo kho.';
COMMENT ON COLUMN public.warehouse_type_configs.lower_from_level IS 'Ghi đè ngưỡng tầng cần xe hạ cho LOẠI KHO này. NULL = theo kho.';

-- ── 2. LOẠI KHO PHỤC VỤ của cửa / điểm đầu dãy (user 10/09: "cửa nhập cửa xuất đầu dãy cũng cần
--      phân loại nó là Loại kho nào") — bằng chứng: Ba Vì đặt tên cửa "Cửa FG01", "Cửa sca" ─────────
ALTER TABLE public."Location" ADD COLUMN IF NOT EXISTS serve_categories text[];
COMMENT ON COLUMN public."Location".serve_categories IS
  'Loại kho mà cửa / điểm đầu dãy này phục vụ (chỉ có nghĩa với kind <> STORAGE). NULL hoặc rỗng = phục vụ MỌI loại (mặc định — bản vẽ cũ không đổi hành vi). Khớp theo GIAO ≥ 1 như luật chuyến chở lẫn.';

-- ── 3. QUY TẮC DATE trên từng dòng đơn ─────────────────────────────────────────────────────────
-- `date_rule` = {kind: 'FEFO'|'MIN_PCT'|'EXACT', value, set_by, set_at}. NULL = CHƯA CHỐT ⇒ không sinh việc.
-- `date_required` (cột cũ, %) vẫn là luật CHẶN lúc quét — đọc tương thích: > 0 mà chưa có date_rule
-- thì coi như đã chốt MIN_PCT (dữ liệu cũ đã có % nghĩa là đã có người quyết).
ALTER TABLE public."OutboundItem"
  ADD COLUMN IF NOT EXISTS date_rule      jsonb,
  ADD COLUMN IF NOT EXISTS pinned_pallets text[];

ALTER TABLE public."OutboundItem" DROP CONSTRAINT IF EXISTS outbounditem_date_rule_kind;
ALTER TABLE public."OutboundItem" ADD CONSTRAINT outbounditem_date_rule_kind
  CHECK (date_rule IS NULL OR (date_rule->>'kind') IN ('FEFO', 'MIN_PCT', 'EXACT'));

COMMENT ON COLUMN public."OutboundItem".date_rule IS
  'Quy tắc lấy hàng theo date do THỦ KHO chốt: {kind FEFO|MIN_PCT|EXACT, value, set_by, set_at}. NULL = chưa chốt ⇒ dòng KHÔNG lên "Việc cần làm" (user chốt 10/09: FEFO phải bấm xác nhận, không mặc định ngầm).';
COMMENT ON COLUMN public."OutboundItem".pinned_pallets IS
  'Tem pallet ghim tay cho dòng này (dạng EXACT theo tem). Rỗng = không ghim.';

-- ── 4. XE NÂNG CHUYỂN — nhiều người, bổ sung/bớt được (user 10/09 vòng 6) ──────────────────────
-- Giữ nguyên `forklift_driver_id` / `forklift_driver_names` cũ (bundle PWA cũ + báo cáo cũ đọc chúng);
-- controller ghi CẢ HAI: id = người đầu danh sách, names = tên nối ", ".
ALTER TABLE public."GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS forklift_driver_ids text[];
COMMENT ON COLUMN public."GroupDeliveryOrder".forklift_driver_ids IS
  'Danh sách nhân sự lái xe nâng CHUYỂN của chuyến (kho HƯỚNG DẪN bắt buộc ≥ 1 lúc Bắt đầu). Cột cũ forklift_driver_id/names giữ đồng bộ để bundle cũ không vỡ.';

-- ── 5. BẢNG VIỆC ──────────────────────────────────────────────────────────────────────────────
-- MỘT dòng = lấy `qty_base` thùng của ĐÚNG pallet `entry_id` từ `from_location_id` đưa tới `to_location_id`.
-- Trạng thái chỉ 4 giá trị; GIAI ĐOẠN là MỐC GIỜ (lowered_at/moved_at/done_at) — user chốt "một nút
-- ✓ Xong", nên không đẻ thêm status cho từng chặng (status càng nhiều càng dễ có đường ghi lệch).
CREATE TABLE IF NOT EXISTS public.wms_tasks (
  id                 text PRIMARY KEY,
  warehouse_id       text NOT NULL REFERENCES public."Warehouse"(id),
  gdo_id             text NOT NULL REFERENCES public."GroupDeliveryOrder"(id) ON DELETE CASCADE,
  item_id            text NOT NULL REFERENCES public."OutboundItem"(id) ON DELETE CASCADE,
  entry_id           text REFERENCES public."InventoryEntry"(id) ON DELETE SET NULL,
  pallet_code        text NOT NULL,
  material_id        text,
  material_code      text,
  qty_base           numeric NOT NULL CHECK (qty_base > 0),
  is_partial         boolean NOT NULL DEFAULT false,
  -- PICK = nguyên pallet ra cửa · LOOSE_FEED = đưa pallet về VỊ TRÍ NHẶT LẺ để thủ kho lấy thùng lẻ
  kind               text NOT NULL DEFAULT 'PICK',
  from_location_id   text REFERENCES public."Location"(id),
  from_location_code text,
  level_no           integer,
  needs_lower        boolean NOT NULL DEFAULT false,
  drop_location_id   text REFERENCES public."Location"(id) ON DELETE SET NULL,
  to_location_id     text REFERENCES public."Location"(id) ON DELETE SET NULL,
  to_kind            text,
  dist_cells         integer,
  seq                integer NOT NULL,
  status             text NOT NULL DEFAULT 'PENDING',
  lowered_at         timestamptz,
  lowered_by         text,
  moved_at           timestamptz,
  moved_by           text,
  confirm_source     text,
  done_at            timestamptz,
  done_by            text,
  scan_entry_id      text,
  skip_reason        text,
  plan_version       integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL
);

ALTER TABLE public.wms_tasks DROP CONSTRAINT IF EXISTS wms_tasks_kind_check;
ALTER TABLE public.wms_tasks ADD CONSTRAINT wms_tasks_kind_check
  CHECK (kind IN ('PICK', 'LOOSE_FEED'));
ALTER TABLE public.wms_tasks DROP CONSTRAINT IF EXISTS wms_tasks_status_check;
ALTER TABLE public.wms_tasks ADD CONSTRAINT wms_tasks_status_check
  CHECK (status IN ('PENDING', 'DONE', 'SKIPPED', 'CANCELLED'));
ALTER TABLE public.wms_tasks DROP CONSTRAINT IF EXISTS wms_tasks_to_kind_check;
ALTER TABLE public.wms_tasks ADD CONSTRAINT wms_tasks_to_kind_check
  CHECK (to_kind IS NULL OR to_kind IN ('DOCK', 'PICK_FACE'));
ALTER TABLE public.wms_tasks DROP CONSTRAINT IF EXISTS wms_tasks_confirm_source_check;
ALTER TABLE public.wms_tasks ADD CONSTRAINT wms_tasks_confirm_source_check
  CHECK (confirm_source IS NULL OR confirm_source IN ('MANUAL', 'SCAN'));

COMMENT ON TABLE  public.wms_tasks IS 'Việc lấy hàng sinh khi Bắt đầu chuyến ở kho HƯỚNG DẪN (Directed Work 1c). Mọi thay đổi trạng thái đi qua backend/src/services/directedTasks.ts — ratchet task_status_written_outside_service gác.';
COMMENT ON COLUMN public.wms_tasks.kind        IS 'PICK = nguyên pallet ra cửa · LOOSE_FEED = đưa pallet về vị trí nhặt lẻ (thủ kho lấy thùng lẻ tại đó; ✓ Xong sẽ CHUYỂN pallet trong tồn).';
COMMENT ON COLUMN public.wms_tasks.needs_lower IS 'Cần XE NÂNG HẠ. PICK: level_no >= ngưỡng kho. LOOSE_FEED: mọi ô KỆ kể cả T1 (user 10/09: "xe nâng chuyển không tự lấy trên kệ").';
COMMENT ON COLUMN public.wms_tasks.dist_cells  IS 'Số ô lưới từ cửa của chuyến tới ô này (BFS trên Sơ đồ kho). NULL = ô chưa đặt lên bản vẽ hoặc không có đường — xếp cuối, bảng ghi rõ, KHÔNG để việc biến mất âm thầm.';
COMMENT ON COLUMN public.wms_tasks.seq         IS 'Thứ tự đi (1 = làm trước) — vòng đi ngắn nhất từ cửa; cùng vị trí thì tầng cao trước.';
COMMENT ON COLUMN public.wms_tasks.lowered_at  IS 'Xe nâng hạ bấm ✓ Xong (hoặc suy ra khi thủ kho quét đủ).';
COMMENT ON COLUMN public.wms_tasks.moved_at    IS 'Xe nâng chuyển bấm ✓ Xong (hoặc suy ra khi thủ kho quét đủ).';
COMMENT ON COLUMN public.wms_tasks.done_at     IS 'Thủ kho đã quét đủ pallet này — việc hoàn tất.';

CREATE INDEX IF NOT EXISTS idx_wms_tasks_wh_pending  ON public.wms_tasks (warehouse_id, status) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_wms_tasks_gdo         ON public.wms_tasks (gdo_id, status);
CREATE INDEX IF NOT EXISTS idx_wms_tasks_entry_open  ON public.wms_tasks (entry_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_wms_tasks_item        ON public.wms_tasks (item_id, status);

-- Một chuyến KHÔNG lập hai việc còn treo trên cùng một pallet (bộ sinh bắt 23505 → bỏ pallet đó, thử tiếp)
CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_tasks_gdo_entry_open
  ON public.wms_tasks (gdo_id, entry_id) WHERE status = 'PENDING' AND entry_id IS NOT NULL;

-- ── 6. SỔ SỰ KIỆN VIỆC ────────────────────────────────────────────────────────────────────────
-- Nguồn "giờ công theo việc" cho KPI sau (memory kpi-master-list-gaps, mảnh 4).
CREATE TABLE IF NOT EXISTS public.wms_task_events (
  id      text PRIMARY KEY,
  task_id text NOT NULL REFERENCES public.wms_tasks(id) ON DELETE CASCADE,
  event   text NOT NULL,
  actor   text,
  at      timestamptz NOT NULL,
  note    text
);
CREATE INDEX IF NOT EXISTS idx_wms_task_events_task ON public.wms_task_events (task_id, at);
COMMENT ON TABLE public.wms_task_events IS 'Nhật ký việc (PLANNED/LOWERED/MOVED/DONE/SKIPPED/CANCELLED/REPLANNED). Bảng NỘI BỘ: KHÔNG bắn tín hiệu realtime (trigger bị gỡ dưới đây) — màn hình đọc wms_tasks, sổ này để truy vết + tính giờ công.';

-- Bảng log nội bộ: gỡ trigger phát tín hiệu realtime do event trigger tự gắn lúc CREATE TABLE
-- (skill security-hardening: bảng nội bộ đừng bắn tín hiệu vô nghĩa cho mọi client).
DROP TRIGGER IF EXISTS trg_wms_notify ON public.wms_task_events;

-- ── 7. RPC nuôi 3 bảng theo vai — MỘT round-trip ──────────────────────────────────────────────
-- p_mode: 'LOWER' (xe nâng hạ, TOÀN KHO) · 'MOVE' (xe nâng chuyển) · 'SCAN' (thủ kho, theo chuyến).
--
-- LOWER/MOVE gom theo VỊ TRÍ (một dòng = "vị trí X · hạ 4 pallet → điểm đặt dãy Y") vì xe nâng
-- KHÔNG quét tem; SCAN trả từng pallet vì thủ kho quét theo tem.
-- Việc đã xong VẪN TRẢ VỀ (gạch ngang ở FE) tới khi chuyến kết thúc — user chốt "phòng tình huống
-- bị quên", biến mất là mất đối chiếu.
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
  -- Tập việc đang xét: chuyến còn hoạt động (đã Bắt đầu, chưa kết thúc) của kho này.
  WITH base AS (
    SELECT t.*,
           g.group_code, g.license_plate, g.status AS gdo_status, g.started_at,
           g.forklift_driver_ids, g.dock_location_id AS gdo_dock_id,
           fl.location_code AS from_code,
           dl.location_code AS drop_code, dl.row AS drop_name,
           tl.location_code AS to_code,   tl.row AS to_name,
           dk.row           AS dock_name,
           m.short_name     AS material_name,
           -- Vị trí HIỆN TẠI của pallet (user 10/09: "cần xem được vị trí hiện tại của pallet cần
           -- lấy, kể cả nó đang ở trên rack"): chưa hạ → ô gốc; đã hạ PICK → điểm đặt dãy;
           -- LOOSE_FEED đã hạ → vị trí nhặt lẻ (tồn đã chuyển thật).
           CASE
             WHEN t.lowered_at IS NULL           THEN fl.location_code
             WHEN t.kind = 'LOOSE_FEED'          THEN tl.location_code
             ELSE COALESCE(dl.location_code, fl.location_code)
           END AS current_code,
           -- Chờ xe hạ: dòng hiện mờ ở bảng xe chuyển, không bấm được
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
  -- Xe đứng bãi chỉ còn chờ hạ = chuyến KHÔNG còn việc nào sẵn sàng chuyển ⇒ ưu tiên hạ trước
  gdo_flag AS (
    SELECT gdo_id,
           bool_and(NOT (status = 'PENDING' AND NOT waiting_lower)) AS truck_idle
      FROM base GROUP BY gdo_id
  ),
  filtered AS (
    SELECT b.*, COALESCE(f.truck_idle, false) AS truck_idle
      FROM base b LEFT JOIN gdo_flag f ON f.gdo_id = b.gdo_id
     WHERE CASE p_mode
             -- Xe nâng hạ: mọi việc cần hạ (đã hạ rồi vẫn hiện, gạch ngang)
             WHEN 'LOWER' THEN b.needs_lower
             -- Xe nâng chuyển: mọi việc TRỪ loose-feed trên kệ (đó là việc của xe hạ, hạ thẳng
             -- xuống vị trí nhặt lẻ là xong). Dòng chưa hạ vẫn hiện (mờ) để thấy pallet đang ở đâu.
             WHEN 'MOVE'  THEN NOT (b.kind = 'LOOSE_FEED' AND b.needs_lower)
             ELSE true
           END
       AND (p_driver_id IS NULL OR p_driver_id = ANY (COALESCE(b.forklift_driver_ids, ARRAY[]::text[])))
  ),
  -- LOWER/MOVE: gom theo (chuyến, vị trí hiện tại, đích). SCAN: mỗi pallet một dòng.
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
      -- Xong Ở CHẶNG NÀY: LOWER nhìn lowered_at, MOVE nhìn moved_at; quét đủ (DONE) là xong mọi chặng
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
      'can_confirm',    (NOT g.stage_done) AND (p_mode = 'SCAN' OR NOT g.waiting_lower)
    ) ORDER BY
        -- Chưa xong lên trước (việc đã xong vẫn giữ trong bảng nhưng nằm dưới)
        g.stage_done,
        CASE WHEN p_mode = 'LOWER' THEN (NOT g.truck_idle)::int ELSE 0 END,
        g.started_at,
        CASE WHEN p_mode = 'LOWER' THEN g.dist_cells END NULLS LAST,
        CASE WHEN p_mode = 'LOWER' THEN -g.level_no END,
        g.seq
    ), '[]'::jsonb)
    INTO v_rows
    FROM grouped g;

  -- Ô tổng + cảnh báo: dòng đơn CHƯA CHỐT quy tắc date (không sinh việc) và phần còn thiếu
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

  -- Dòng hàng chưa chốt %Date của các chuyến đang chạy: KHÔNG có việc nào, phải nói ra
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

COMMENT ON FUNCTION public.directed_board(text, text, text, text) IS
  'Nuôi 3 bảng Việc cần làm (LOWER/MOVE/SCAN) trong MỘT round-trip. Gom theo vị trí cho xe nâng, theo pallet cho thủ kho; việc đã xong vẫn trả về để FE gạch ngang.';



-- ─────────────────────────────────────────────────────────────────────────
-- [20260910d_dock_serve_categories.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260910d — CỬA TRẢ THÊM "LOẠI KHO PHỤC VỤ" (đi kèm 20260910c)
-- ============================================================================
-- `warehouse_docks_status` nuôi CẢ ô chọn cửa lúc Bắt đầu LẪN lớp phủ Cửa trên Sơ đồ kho. Từ 10/09
-- cửa khai được `serve_categories` (Cửa sca chỉ nhận SCA, Cửa FG01 chỉ nhận thành phẩm) ⇒ RPC phải
-- trả cột đó, nếu không thì FE không mờ được cửa lệch loại và BE phải hỏi thêm một câu cho việc lẽ
-- ra nằm sẵn trong cùng round-trip.
--
-- ⚠️ THÂN HÀM CHÉP NGUYÊN bản 20260910 — CHỈ THÊM một khoá `serve_categories` vào payload.
-- Công thức `occupied` (đếm theo XE: distinct biển + mỗi chuyến không biển là một xe) và điều kiện
-- `gdo_holds_dock` là kết quả của lần vá ĐUA 09/09 (5 xe tranh 1 suất thì 2 xe lọt) — viết lại cho
-- "gọn" là đường nhanh nhất làm sống lại bug đó.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.warehouse_docks_status(p_warehouse_id text)
RETURNS jsonb
LANGUAGE sql STABLE
AS $function$
  WITH docks AS (
    SELECT l.id, l.location_code, l.row AS name, l.kind, l.dock_capacity, l.grid_x, l.grid_y,
           l.serve_categories
      FROM public."Location" l
     WHERE l.warehouse_id = p_warehouse_id AND l.is_active AND l.kind IN ('DOCK_OUT', 'DOCK_IN')
  ), veh AS (
    SELECT g.dock_location_id, g.id AS gdo_id, g.group_code, g.license_plate, g.status,
           g.dock_assigned_at, g.started_at
      FROM public."GroupDeliveryOrder" g
      JOIN docks d ON d.id = g.dock_location_id
     WHERE public.gdo_holds_dock(g.status, g.dock_assigned_at)
  ), agg AS (
    SELECT dock_location_id,
           count(DISTINCT license_plate) FILTER (WHERE license_plate IS NOT NULL)
           + count(*) FILTER (WHERE license_plate IS NULL) AS occupied,
           jsonb_agg(jsonb_build_object('gdo_id', gdo_id, 'group_code', group_code, 'license_plate', license_plate,
                                        'status', status, 'dock_assigned_at', dock_assigned_at, 'started_at', started_at)
                     ORDER BY dock_assigned_at) AS vehicles
      FROM veh GROUP BY dock_location_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'location_code', d.location_code, 'name', d.name, 'kind', d.kind,
           'capacity', d.dock_capacity, 'occupied', coalesce(a.occupied, 0),
           'serve_categories', coalesce(d.serve_categories, ARRAY[]::text[]),
           'vehicles', coalesce(a.vehicles, '[]'::jsonb),
           'grid_x', d.grid_x, 'grid_y', d.grid_y) ORDER BY d.kind, d.name), '[]'::jsonb)
    FROM docks d LEFT JOIN agg a ON a.dock_location_id = d.id;
$function$;

COMMENT ON FUNCTION public.warehouse_docks_status(text) IS
  'Tình trạng cửa xuất/nhập của kho trong 1 round-trip: sức chứa xe, xe đang đậu, toạ độ trên bản vẽ, và LOẠI KHO cửa phục vụ (rỗng = mọi loại).';



-- ─────────────────────────────────────────────────────────────────────────
-- [20260910e_directed_work_rls.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260910e — BẬT RLS CHO 2 BẢNG VIỆC (vá lỗ của 20260910c)
-- ============================================================================
-- Gói QA 00 mục "Mọi bảng public đều bật RLS" bắt được ngay lượt CI đầu tiên sau khi apply
-- 20260910c: `wms_tasks` và `wms_task_events` tạo ra mà QUÊN bật RLS.
--
-- VÌ SAO NGHIÊM TRỌNG dù `authenticated`/`anon` đã bị thu hết quyền bảng (20260902c): hai lớp
-- gác đó ĐỘC LẬP nhau, và bảng mới sinh sau là đúng chỗ default privileges có thể hở lại. Luật
-- dự án từ 03/08: **mọi bảng trong schema public phải bật RLS** — không có ngoại lệ "vì đã đóng
-- ở chỗ khác rồi". Bảng việc chứa lịch trình lấy hàng của cả kho (mã hàng, tem pallet, vị trí,
-- ai làm lúc nào), rò ra là lộ toàn bộ hoạt động kho.
--
-- KHÔNG tạo policy nào: backend đi service_role (bỏ qua RLS), FE không đọc bảng nào qua Supabase
-- (chỉ nhận tín hiệu realtime). RLS bật + 0 policy = đóng hoàn toàn với anon/authenticated.
-- ============================================================================
ALTER TABLE public.wms_tasks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_task_events ENABLE ROW LEVEL SECURITY;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260910f_directed_board_confirm_fix.sql]
-- ─────────────────────────────────────────────────────────────────────────
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



-- ─────────────────────────────────────────────────────────────────────────
-- [20260910g_date_rule_lines.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- CHỐT %DATE HÀNG LOẠT TRÊN NHIỀU CHUYẾN — nguồn dữ liệu cho màn "Chốt %Date" (user chốt 10/09):
--   "trước lúc xuất hàng, nv SAP vào kiểm tra TẤT CẢ các đơn hàng sau đó input dữ liệu vào …
--    cần nhìn hết đơn hàng (dạng filter được) và thấy tất cả các dòng sau đó input"
--
-- Vì sao là RPC chứ không phải vài câu PostgREST: màn này đọc DÒNG HÀNG của MỌI chuyến trong một
-- khoảng ngày (một ngày ở Ba Vì ≈ 50 chuyến × 8 dòng; cả tuần vài nghìn dòng) — kéo về Node rồi lọc
-- là dính trần 1.000 dòng và tốn nhiều lượt trên pool 10 khe của PostgREST. Một lời gọi trả CẢ
-- dòng + tổng + số trang.
--
-- Luật đã có, KHÔNG chép lại: loại kho ghép ('FG01+PM01') so bằng wt_cats() && mảng (giao ≥ 1);
-- chuỗi tìm kiếm escape bằng like_esc().
-- ══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.outbound_date_rule_lines(
  p_from          date,
  p_to            date,
  p_scope_wh      text[] DEFAULT NULL,   -- phạm vi kho của NGƯỜI GỌI (NULL = toàn quốc)
  p_warehouse_id  text   DEFAULT NULL,   -- bộ lọc "Kho" trên màn
  p_categories    text[] DEFAULT NULL,   -- phạm vi Loại kho của người gọi (NULL = mọi loại)
  p_state         text   DEFAULT 'ALL',  -- ALL | SET (đã chốt) | UNSET (chưa chốt)
  p_search        text   DEFAULT NULL,
  p_limit         int    DEFAULT 200,
  p_offset        int    DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  v_like  text := CASE WHEN coalesce(p_search, '') = '' THEN NULL
                       ELSE '%' || public.like_esc(lower(p_search)) || '%' END;
  v_rows  jsonb;
  v_total bigint;
  v_sum   jsonb;
BEGIN
  WITH base AS (
    SELECT
      i.id                                   AS item_id,
      g.id                                   AS gdo_id,
      g.group_code, g.license_plate, g.delivery_date, g.status AS gdo_status,
      g.warehouse_id, w.name                 AS warehouse_name,
      g.warehouse_type,
      d.delivery_code, d.distributor_name,
      i.material_id,
      i.material_code_raw                    AS material_code,
      m.short_name                           AS material_name,
      m.units_per_carton, m.base_unit, m.entry_unit,
      i.cartons_ordered, i.cartons_scanned,
      greatest(0, coalesce(i.cartons_ordered, 0) - coalesce(i.cartons_scanned, 0)) AS remaining,
      i.header_text, i.batch_required, i.date_required, i.date_rule,
      -- ĐÃ CHỐT = có date_rule mới, HOẶC %Date yêu cầu cũ của VL06O > 0 (đọc tương thích)
      (i.date_rule IS NOT NULL OR coalesce(i.date_required, 0) > 0) AS is_set
      FROM public."OutboundItem" i
      JOIN public."OutboundDelivery" d   ON d.id = i.do_id
      JOIN public."GroupDeliveryOrder" g ON g.id = d.gdo_id
      LEFT JOIN public."Warehouse" w     ON w.id = g.warehouse_id
      LEFT JOIN public."Material" m      ON m.id = i.material_id
     WHERE g.delivery_date BETWEEN p_from AND p_to
       -- Chỉ chuyến CÒN LÀM ĐƯỢC: hoàn thành/huỷ thì chốt date không còn ý nghĩa
       AND g.status IN ('PENDING', 'PAUSED', 'IN_PROGRESS')
       AND coalesce(i.status, '') <> 'CANCELLED'
       AND (p_scope_wh IS NULL OR g.warehouse_id = ANY (p_scope_wh))
       AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
       -- Loại kho: chuyến chở LẪN mang chuỗi ghép ⇒ giao ≥ 1 (null-inclusive như mọi chỗ cắt scope)
       AND (p_categories IS NULL OR g.warehouse_type IS NULL OR public.wt_cats(g.warehouse_type) && p_categories)
  ),
  filtered AS (
    SELECT * FROM base b
     WHERE (p_state <> 'SET'   OR b.is_set)
       AND (p_state <> 'UNSET' OR NOT b.is_set)
       AND (v_like IS NULL OR (
              lower(coalesce(b.group_code, ''))       LIKE v_like OR
              lower(coalesce(b.license_plate, ''))    LIKE v_like OR
              lower(coalesce(b.distributor_name, '')) LIKE v_like OR
              lower(coalesce(b.delivery_code, ''))    LIKE v_like OR
              lower(coalesce(b.material_code, ''))    LIKE v_like OR
              lower(coalesce(b.material_name, ''))    LIKE v_like OR
              lower(coalesce(b.header_text, ''))      LIKE v_like))
  )
  SELECT
    coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.delivery_date, t.group_code, t.delivery_code, t.material_code), '[]'::jsonb),
    (SELECT count(*) FROM filtered),
    (SELECT jsonb_build_object(
        'lines',     count(*),
        'set',       count(*) FILTER (WHERE is_set),
        'unset',     count(*) FILTER (WHERE NOT is_set),
        'with_note', count(*) FILTER (WHERE coalesce(header_text, '') <> ''),
        'trips',     count(DISTINCT gdo_id))
       FROM filtered)
    INTO v_rows, v_total, v_sum
    FROM (SELECT * FROM filtered
           ORDER BY delivery_date, group_code, delivery_code, material_code
           LIMIT greatest(1, least(coalesce(p_limit, 200), 1000)) OFFSET greatest(0, coalesce(p_offset, 0))) t;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total, 'summary', v_sum);
END $$;

REVOKE ALL ON FUNCTION public.outbound_date_rule_lines(date, date, text[], text, text[], text, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outbound_date_rule_lines(date, date, text[], text, text[], text, text, int, int) TO service_role;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260910h_date_rule_split.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- MỘT DÒNG ĐƠN, NHIỀU MỨC DATE THEO SỐ LƯỢNG (user 10/09: "đơn 280 thùng nhưng 250 thùng date 60,
-- 30 thùng date 90"). Dòng đơn đến từ SAP nên không tách đôi được ⇒ chia ngay trên quy tắc:
--   {kind:'SPLIT', parts:[{qty_base, kind, value}, …]}
-- Ràng buộc cũ chỉ cho FEFO|MIN_PCT|EXACT nên mọi lần lưu SPLIT đều 23514 → app trả 400 (gói QA 57
-- [15m] bắt được ngay lượt đầu).
--
-- CHECK của Postgres KHÔNG nhận truy vấn con / hàm trả tập ⇒ đưa luật vào một hàm IMMUTABLE rồi gọi
-- trong CHECK. Kiểm cả HÌNH DẠNG parts để đường ghi khác (script, SQL tay) cũng không nhét được rác.
-- `qty_base` so bằng CASE + regex chứ không ép kiểu thẳng: chuỗi không phải số sẽ làm CHECK NÉM LỖI
-- thay vì trả false, tức là một dòng rác làm hỏng cả câu UPDATE của người khác.
CREATE OR REPLACE FUNCTION public.date_rule_valid(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p IS NULL
      OR (p->>'kind') IN ('FEFO', 'MIN_PCT', 'EXACT')
      OR (
        (p->>'kind') = 'SPLIT'
        AND jsonb_typeof(p->'parts') = 'array'
        AND jsonb_array_length(p->'parts') BETWEEN 1 AND 10
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p->'parts') e
           WHERE (e->>'kind') IS DISTINCT FROM 'FEFO'
             AND (e->>'kind') IS DISTINCT FROM 'MIN_PCT'
             AND (e->>'kind') IS DISTINCT FROM 'EXACT'
        )
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p->'parts') e
           WHERE CASE WHEN (e->>'qty_base') ~ '^[0-9]+(\.[0-9]+)?$'
                      THEN (e->>'qty_base')::numeric ELSE 0 END <= 0
        )
      )
$$;
REVOKE ALL ON FUNCTION public.date_rule_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.date_rule_valid(jsonb) TO service_role;

ALTER TABLE public."OutboundItem" DROP CONSTRAINT IF EXISTS outbounditem_date_rule_kind;
ALTER TABLE public."OutboundItem" ADD CONSTRAINT outbounditem_date_rule_kind
  CHECK (public.date_rule_valid(date_rule));

COMMENT ON COLUMN public."OutboundItem".date_rule IS
  'Quy tắc lấy hàng theo date do THỦ KHO chốt: {kind FEFO|MIN_PCT|EXACT, value, set_by, set_at} hoặc {kind:''SPLIT'', parts:[{qty_base,kind,value}]} khi một dòng cần nhiều mức date theo số lượng. NULL = chưa chốt ⇒ dòng KHÔNG lên "Việc cần làm" (user chốt 10/09: FEFO phải bấm xác nhận, không mặc định ngầm).';



-- ─────────────────────────────────────────────────────────────────────────
-- [20260910i_dock_vehicle_kind.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260910i — CỬA TRẢ THÊM LOẠI XE + SỐ CONTAINER CỦA XE ĐANG ĐẬU
-- ============================================================================
-- Sơ đồ kho 3D vẽ xe ở cửa. User chốt 10/09: "container khác mà xe tải khác, có bánh và nhìn giống
-- xe" ⇒ phải biết chuyến đó là XE CONTAINER hay XE TẢI. Loại xe KHÔNG nằm trên GroupDeliveryOrder:
-- chuyến đã gắn biển thì tra `Vehicle` → `VehicleType`; chuyến còn đang lên kế hoạch thì lấy loại
-- khai ở lệnh vận chuyển (`TmsOrder.order_code` = Số xe) — đúng chuỗi mà sơ đồ Xếp xe 3D đang dùng.
-- FE không tự tra được: đội xe staging 952 biển, kéo cả danh mục về trình duyệt là phạm luật
-- "danh mục lớn không nạp cả vào trình duyệt".
--
-- ⚠️ THÂN HÀM CHÉP NGUYÊN bản 20260910d. Hai giá trị mới đi bằng TRUY VẤN CON TRONG jsonb_build_object,
-- KHÔNG thêm JOIN vào CTE `veh`: một biển có 2 dòng `Vehicle` (hay một Số xe có 2 lệnh vận chuyển
-- khác ngày) sẽ NHÂN ĐÔI dòng ⇒ `occupied` đếm sai ⇒ sống lại đúng con bug đua suất cửa đã vá 09/09.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.warehouse_docks_status(p_warehouse_id text)
RETURNS jsonb
LANGUAGE sql STABLE
AS $function$
  WITH docks AS (
    SELECT l.id, l.location_code, l.row AS name, l.kind, l.dock_capacity, l.grid_x, l.grid_y,
           l.serve_categories
      FROM public."Location" l
     WHERE l.warehouse_id = p_warehouse_id AND l.is_active AND l.kind IN ('DOCK_OUT', 'DOCK_IN')
  ), veh AS (
    SELECT g.dock_location_id, g.id AS gdo_id, g.group_code, g.license_plate, g.status,
           g.dock_assigned_at, g.started_at, g.container_number
      FROM public."GroupDeliveryOrder" g
      JOIN docks d ON d.id = g.dock_location_id
     WHERE public.gdo_holds_dock(g.status, g.dock_assigned_at)
  ), agg AS (
    SELECT dock_location_id,
           count(DISTINCT license_plate) FILTER (WHERE license_plate IS NOT NULL)
           + count(*) FILTER (WHERE license_plate IS NULL) AS occupied,
           jsonb_agg(jsonb_build_object('gdo_id', gdo_id, 'group_code', group_code, 'license_plate', license_plate,
                                        'status', status, 'dock_assigned_at', dock_assigned_at, 'started_at', started_at,
                                        'container_number', container_number,
                                        'vehicle_type', coalesce(
                                          (SELECT vt.name FROM public."Vehicle" v
                                             JOIN public."VehicleType" vt ON vt.id = v.vehicle_type_id
                                            WHERE v.license_plate = veh.license_plate
                                            LIMIT 1),
                                          (SELECT t.vehicle_type FROM public."TmsOrder" t
                                            WHERE t.order_code = veh.group_code AND t.vehicle_type IS NOT NULL
                                            ORDER BY t.created_at DESC NULLS LAST
                                            LIMIT 1)))
                     ORDER BY dock_assigned_at) AS vehicles
      FROM veh GROUP BY dock_location_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'location_code', d.location_code, 'name', d.name, 'kind', d.kind,
           'capacity', d.dock_capacity, 'occupied', coalesce(a.occupied, 0),
           'serve_categories', coalesce(d.serve_categories, ARRAY[]::text[]),
           'vehicles', coalesce(a.vehicles, '[]'::jsonb),
           'grid_x', d.grid_x, 'grid_y', d.grid_y) ORDER BY d.kind, d.name), '[]'::jsonb)
    FROM docks d LEFT JOIN agg a ON a.dock_location_id = d.id;
$function$;

COMMENT ON FUNCTION public.warehouse_docks_status(text) IS
  'Tình trạng cửa xuất/nhập của kho trong 1 round-trip: sức chứa xe, xe đang đậu (kèm LOẠI XE + số container để 3D vẽ đúng kiểu xe), toạ độ trên bản vẽ, và LOẠI KHO cửa phục vụ (rỗng = mọi loại).';


COMMIT;
-- === HẾT PART 5/10 ===
