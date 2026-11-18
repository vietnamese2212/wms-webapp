-- MES 18/11 g — hai việc:
-- (1) DỮ LIỆU THÔ TIÊU HAO NVL (user 18/11: "Báo cáo NVL: về tiêu hao NVL phải làm dạng raw data, có đầy đủ thông tin hết cho tôi — để còn
--     làm việc với ERP SAP"). MỘT hàm mes_consumption_raw(p) cho màn "Dữ liệu thô", file xuất của nó, và sheet thô của báo cáo chu kỳ:
--       part 'events' — mỗi dòng MỘT PHÁT SINH như chứng từ kho của SAP: CẤP (lúc cấp, +SL) hoặc HUỶ CẤP (lúc huỷ, −SL), lọc theo NGÀY CỦA
--                       CHÍNH PHÁT SINH (giờ VN). Lần cấp hôm 17 bị huỷ hôm 19 ⇒ file ngày 19 có dòng −SL để hạch toán đảo.
--                       Σ SL có dấu của mọi phát sinh = Σ các lần cấp còn hiệu lực (lưới DO cuối file).
--       part 'req'    — mỗi dòng một (mẻ × NVL): định mức đang hiệu lực ↔ thực cấp còn hiệu lực. Mẻ lấy: ngày SX trong khoảng HOẶC có
--                       phát sinh cấp / huỷ trong khoảng (mọi mẻ của sheet phát sinh đều có mặt).
--       part 'fill'   — mỗi dòng một lần NẠP BỒN của mẻ (sản lượng BTP).
--     mode 'page' = dòng + tổng + dải số (màn hình, ≤1000 dòng / trang) · 'rows' = chỉ dòng (file xuất lật trang tới hết, ≤2000 / trang).
--     Mã SAP: Plant = Warehouse.sap_plant của kho chế biến, không khai thì của NHÀ MÁY cha; SLoc tương tự. Mã NCC = mã nhà cung cấp SAP.
-- (2) SƠ ĐỒ BỒN 2D (user 18/11: "bản đồ 2D làm đầy đủ ... zoom in zoom out, scroll ... chế độ fit bấm nút thì xem được bao quát"):
--     production_tank.map_x / map_y = chỗ của bồn trên sơ đồ (điểm của sơ đồ, tính trong khung kho chế biến; null = tự xếp).
--     mes_tank_layout_save(p) ghi chỗ đặt của nhiều bồn trong MỘT câu lệnh.
-- Bỏ mes_cycle_lines (18/11 f): sheet chi tiết của báo cáo chu kỳ nay đọc mes_consumption_raw(cycle) — hai file cùng một khuôn cột.
BEGIN;

ALTER TABLE public.production_tank ADD COLUMN IF NOT EXISTS map_x integer, ADD COLUMN IF NOT EXISTS map_y integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_tank_map_xy_chk') THEN
    ALTER TABLE public.production_tank ADD CONSTRAINT production_tank_map_xy_chk
      CHECK ((map_x IS NULL) = (map_y IS NULL) AND (map_x IS NULL OR (map_x BETWEEN 0 AND 100000 AND map_y BETWEEN 0 AND 100000)));
  END IF;
END $$;
COMMENT ON COLUMN public.production_tank.map_x IS 'Sơ đồ bồn 2D: toạ độ ngang của bồn trong khung kho chế biến (điểm sơ đồ); null = tự xếp';
COMMENT ON COLUMN public.production_tank.map_y IS 'Sơ đồ bồn 2D: toạ độ dọc của bồn trong khung kho chế biến (điểm sơ đồ); null = tự xếp';

-- lọc phát sinh theo ngày (sổ cấp lớn lên theo năm)
CREATE INDEX IF NOT EXISTS idx_batch_cons_created  ON public.batch_consumption (created_at);
CREATE INDEX IF NOT EXISTS idx_batch_cons_reversed ON public.batch_consumption (reversed_at) WHERE reversed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tank_mv_fill_at     ON public.tank_movement (created_at) WHERE kind = 'FILL';

DROP FUNCTION IF EXISTS public.mes_cycle_lines(text, text);

CREATE OR REPLACE FUNCTION public.mes_consumption_raw(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public' SET plan_cache_mode TO 'force_custom_plan' AS $$
DECLARE
  v_wh    text := nullif(p->>'warehouse_id', '');
  v_part  text := coalesce(nullif(p->>'part', ''), 'events');
  v_page_mode boolean := coalesce(p->>'mode', 'page') = 'page';
  v_from  date := nullif(p->>'date_from', '')::date;
  v_to    date := nullif(p->>'date_to', '')::date;
  v_cycle text := nullif(btrim(coalesce(p->>'cycle', '')), '');
  v_q     text := nullif(btrim(coalesce(p->>'search', '')), '');
  v_event text := nullif(p->>'event', '');
  v_flag  text := nullif(p->>'flag', '');
  v_desc  boolean := coalesce(p->>'sort', 'desc') = 'desc';
  v_size  int := least(greatest(coalesce((p->>'page_size')::int, 100), 1), 2000);
  v_page  int := greatest(coalesce((p->>'page')::int, 1), 1);
  v_t0    timestamptz;
  v_t1    timestamptz;
  v_like  text;
  v_out   jsonb;
BEGIN
  IF v_wh IS NULL THEN RAISE EXCEPTION 'MESERR:WAREHOUSE|Chọn kho chế biến'; END IF;
  IF (v_from IS NULL) <> (v_to IS NULL) THEN RAISE EXCEPTION 'MESERR:DATE_RANGE|Chọn đủ Từ ngày và Đến ngày'; END IF;
  IF v_cycle IS NULL AND v_from IS NULL THEN RAISE EXCEPTION 'MESERR:DATE_RANGE|Chọn khoảng ngày (hoặc một chu kỳ)'; END IF;
  IF v_from IS NOT NULL AND (v_to < v_from OR v_to - v_from > 366) THEN
    RAISE EXCEPTION 'MESERR:DATE_RANGE|Khoảng ngày không hợp lệ — Đến ngày phải sau Từ ngày, tối đa 367 ngày';
  END IF;
  IF v_part NOT IN ('events', 'req', 'fill') THEN RAISE EXCEPTION 'MESERR:KIND|Phần dữ liệu không hợp lệ'; END IF;
  -- ngày theo giờ Việt Nam: [00:00 Từ ngày, 00:00 ngày sau Đến ngày)
  IF v_from IS NOT NULL THEN
    v_t0 := v_from::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
    v_t1 := (v_to + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
  END IF;
  v_like := '%' || like_esc(coalesce(v_q, '')) || '%';

  IF v_part = 'events' THEN
    WITH ev AS MATERIALIZED (
      SELECT c.id, 'ISSUE'::text AS ev, c.created_at AS at
        FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
       WHERE b.warehouse_id = v_wh AND (v_cycle IS NULL OR b.cycle = v_cycle)
         AND (v_t0 IS NULL OR (c.created_at >= v_t0 AND c.created_at < v_t1))
         AND (v_event IS NULL OR v_event = 'ISSUE')
      UNION ALL
      SELECT c.id, 'REVERSAL'::text, c.reversed_at
        FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
       WHERE c.reversed_at IS NOT NULL AND b.warehouse_id = v_wh AND (v_cycle IS NULL OR b.cycle = v_cycle)
         AND (v_t0 IS NULL OR (c.reversed_at >= v_t0 AND c.reversed_at < v_t1))
         AND (v_event IS NULL OR v_event = 'REVERSAL')
    ), f AS MATERIALIZED (
      SELECT ev.id, ev.ev, ev.at, c.qty, c.batch_id, c.material_id, m.base_unit AS unit,
             COALESCE(c.rotation_violation, false) AS rot, c.expiry_approval_id IS NOT NULL AS xp
        FROM ev
        JOIN batch_consumption c ON c.id = ev.id
        JOIN production_batch b ON b.id = c.batch_id
        JOIN "Material" m ON m.id = c.material_id
       WHERE (v_q IS NULL OR b.batch_code ILIKE v_like OR m.material_code ILIKE v_like OR m.short_name ILIKE v_like
              OR c.pallet_code ILIKE v_like OR c.batch_lot ILIKE v_like)
         AND (v_flag IS NULL
              OR (v_flag = 'rotation' AND COALESCE(c.rotation_violation, false))
              OR (v_flag = 'expiry'   AND c.expiry_approval_id IS NOT NULL)
              OR (v_flag = 'reversed' AND c.reversed_at IS NOT NULL))
    ), pg AS (
      SELECT f.* FROM f
       ORDER BY CASE WHEN v_desc THEN f.at END DESC, CASE WHEN NOT v_desc THEN f.at END ASC, f.id, f.ev
       LIMIT v_size OFFSET (v_page - 1) * v_size
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'line_id', c.id, 'event', pg.ev, 'at', pg.at, 'qty', c.qty,
            'signed_qty', CASE WHEN pg.ev = 'REVERSAL' THEN -c.qty ELSE c.qty END,
            'by_name', CASE WHEN pg.ev = 'REVERSAL' THEN c.reversed_by_name ELSE c.created_by_name END,
            'by_code', CASE WHEN pg.ev = 'REVERSAL' THEN er.employee_code ELSE ei.employee_code END,
            'wh_code', w.code, 'wh_name', w.name, 'factory_code', pw.code, 'factory_name', pw.name,
            'sap_plant', COALESCE(w.sap_plant, pw.sap_plant),
            'sap_sloc', NULLIF(array_to_string(CASE WHEN cardinality(w.sap_storage_locations) > 0 THEN w.sap_storage_locations
                                                     ELSE pw.sap_storage_locations END, ','), ''),
            'nmsx', COALESCE(w.nmsx_code, pw.nmsx_code),
            'batch_id', b.id, 'batch_code', b.batch_code, 'cycle', b.cycle, 'batch_no', b.batch_no, 'shift', b.shift,
            'prod_date', b.prod_date, 'batch_status', b.status, 'batch_qa', b.qa_status, 'tank_code', tk.code, 'machine_code', b.machine_code,
            'btp_code', bm.material_code, 'btp_name', bm.short_name, 'btp_unit', bm.base_unit)
          || jsonb_build_object(
            'mat_code', m.material_code, 'mat_name', m.short_name, 'mat_desc', m.material_description, 'mat_category', m.category,
            'unit', m.base_unit, 'entry_unit', m.entry_unit, 'units_per_carton', m.units_per_carton,
            'source', c.source, 'pallet_code', c.pallet_code, 'batch_lot', c.batch_lot, 'production_date', c.production_date,
            'expiry_date', COALESCE(ie.expiry_date, ie.expiry_calc, xa.expiry_date),
            -- import_date là timestamp không múi giờ, ghi theo mốc UTC ⇒ đổi về NGÀY Việt Nam
            'import_date', ((ie.import_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
            'ncc_code', n.code, 'ncc_name', n.name, 'manufacturer', mf.name,
            'rotation_violation', COALESCE(c.rotation_violation, false), 'rotation_principle', c.rotation_principle,
            'rotation_best_date', c.rotation_best_date, 'rotation_reason', c.rotation_override_reason,
            'exp_approved', c.expiry_approval_id IS NOT NULL, 'exp_by', xa.decided_by_name, 'exp_at', xa.decided_at, 'exp_note', xa.note,
            'issued_at', c.created_at, 'issued_by', c.created_by_name,
            'reversed_at', c.reversed_at, 'reversed_by', c.reversed_by_name, 'reverse_reason', c.reverse_reason)
          ORDER BY CASE WHEN v_desc THEN pg.at END DESC, CASE WHEN NOT v_desc THEN pg.at END ASC, pg.id, pg.ev)
          FROM pg
          JOIN batch_consumption c ON c.id = pg.id
          JOIN production_batch b ON b.id = c.batch_id
          JOIN "Material" m ON m.id = c.material_id
          JOIN "Material" bm ON bm.id = b.material_id
          JOIN "Warehouse" w ON w.id = b.warehouse_id
          LEFT JOIN "Warehouse" pw ON pw.id = w.parent_warehouse_id
          LEFT JOIN production_tank tk ON tk.id = b.tank_id
          LEFT JOIN "InventoryEntry" ie ON ie.id = c.entry_id
          LEFT JOIN "TransportCompany" n ON n.id = c.ncc_id               -- NCC dùng chung bảng ĐVVT / NCC (mã = mã NCC của SAP)
          LEFT JOIN "Manufacturer" mf ON mf.id = COALESCE(ie.manufacturer_id, m.manufacturer_id)
          LEFT JOIN mes_expiry_approval xa ON xa.id = c.expiry_approval_id
          LEFT JOIN "Employee" ei ON ei.id = c.created_by
          LEFT JOIN "Employee" er ON er.id = c.reversed_by), '[]'::jsonb),
      'total', CASE WHEN v_page_mode THEN (SELECT count(*) FROM f) END,
      'summary', CASE WHEN v_page_mode THEN (
        SELECT jsonb_build_object(
          'events', count(*), 'issues', count(*) FILTER (WHERE f.ev = 'ISSUE'), 'reversals', count(*) FILTER (WHERE f.ev = 'REVERSAL'),
          'batches', count(DISTINCT f.batch_id), 'materials', count(DISTINCT f.material_id),
          'rotation', count(*) FILTER (WHERE f.ev = 'ISSUE' AND f.rot), 'expiry', count(*) FILTER (WHERE f.ev = 'ISSUE' AND f.xp),
          'by_unit', (SELECT COALESCE(jsonb_agg(jsonb_build_object('unit', u.unit, 'issued', u.iss, 'reversed', u.rev, 'net', u.iss - u.rev) ORDER BY u.unit), '[]'::jsonb)
                        FROM (SELECT COALESCE(f2.unit, '') AS unit,
                                     COALESCE(sum(f2.qty) FILTER (WHERE f2.ev = 'ISSUE'), 0) AS iss,
                                     COALESCE(sum(f2.qty) FILTER (WHERE f2.ev = 'REVERSAL'), 0) AS rev
                                FROM f f2 GROUP BY COALESCE(f2.unit, '')) u))
          FROM f) END)
    INTO v_out;

  ELSIF v_part = 'req' THEN
    WITH bs AS MATERIALIZED (
      SELECT b.id FROM production_batch b
       WHERE b.warehouse_id = v_wh AND (v_cycle IS NULL OR b.cycle = v_cycle) AND (v_from IS NULL OR b.prod_date BETWEEN v_from AND v_to)
      UNION
      SELECT c.batch_id FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
       WHERE v_t0 IS NOT NULL AND b.warehouse_id = v_wh AND (v_cycle IS NULL OR b.cycle = v_cycle)
         AND c.created_at >= v_t0 AND c.created_at < v_t1
      UNION
      SELECT c.batch_id FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
       WHERE v_t0 IS NOT NULL AND b.warehouse_id = v_wh AND (v_cycle IS NULL OR b.cycle = v_cycle)
         AND c.reversed_at >= v_t0 AND c.reversed_at < v_t1
    ), rq AS (
      SELECT r.batch_id, r.material_id, sum(r.qty_required) AS req, sum(r.qty_standard) AS std, max(r.tol_pct) AS tol, min(r.sort_order) AS so
        FROM batch_requirement r JOIN bs ON bs.id = r.batch_id
       WHERE r.removed_at IS NULL GROUP BY r.batch_id, r.material_id
    ), cs AS (
      SELECT c.batch_id, c.material_id,
             COALESCE(sum(c.qty) FILTER (WHERE c.reversed_at IS NULL), 0) AS iss, count(*) FILTER (WHERE c.reversed_at IS NULL) AS n,
             count(*) FILTER (WHERE c.reversed_at IS NOT NULL) AS n_rev, COALESCE(sum(c.qty) FILTER (WHERE c.reversed_at IS NOT NULL), 0) AS rev_qty,
             count(*) FILTER (WHERE c.reversed_at IS NULL AND COALESCE(c.rotation_violation, false)) AS n_rot,
             min(c.created_at) FILTER (WHERE c.reversed_at IS NULL) AS first_at, max(c.created_at) FILTER (WHERE c.reversed_at IS NULL) AS last_at
        FROM batch_consumption c JOIN bs ON bs.id = c.batch_id GROUP BY c.batch_id, c.material_id
    ), j AS (
      SELECT COALESCE(rq.batch_id, cs.batch_id) AS batch_id, COALESCE(rq.material_id, cs.material_id) AS material_id,
             rq.req, rq.std, rq.tol, rq.so, COALESCE(cs.iss, 0) AS iss, COALESCE(cs.n, 0) AS n, COALESCE(cs.n_rev, 0) AS n_rev,
             COALESCE(cs.rev_qty, 0) AS rev_qty, COALESCE(cs.n_rot, 0) AS n_rot, cs.first_at, cs.last_at
        FROM rq FULL JOIN cs ON cs.batch_id = rq.batch_id AND cs.material_id = rq.material_id
    ), k AS (
      SELECT j.*, b.prod_date, b.batch_no, b.batch_code, m.material_code
        FROM j JOIN production_batch b ON b.id = j.batch_id JOIN "Material" m ON m.id = j.material_id
       ORDER BY b.prod_date, b.batch_no NULLS LAST, b.batch_code, j.so NULLS LAST, m.material_code
       LIMIT v_size OFFSET (v_page - 1) * v_size
    )
    SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(
             jsonb_build_object(
               'batch_id', b.id, 'batch_code', b.batch_code, 'cycle', b.cycle, 'batch_no', b.batch_no, 'shift', b.shift, 'prod_date', b.prod_date,
               'batch_status', b.status, 'batch_qa', b.qa_status, 'tank_code', tk.code,
               'btp_code', bm.material_code, 'btp_name', bm.short_name, 'planned_qty', b.planned_qty, 'btp_unit', bm.base_unit,
               'wh_code', w.code, 'sap_plant', COALESCE(w.sap_plant, pw.sap_plant),
               'sap_sloc', NULLIF(array_to_string(CASE WHEN cardinality(w.sap_storage_locations) > 0 THEN w.sap_storage_locations
                                                        ELSE pw.sap_storage_locations END, ','), ''))
             || jsonb_build_object(
               'mat_code', m.material_code, 'mat_name', m.short_name, 'mat_desc', m.material_description, 'unit', m.base_unit,
               'in_sheet', k.req IS NOT NULL, 'req', k.req, 'std', k.std, 'tol_pct', k.tol, 'iss', k.iss,
               'diff', CASE WHEN k.req IS NULL THEN NULL ELSE k.iss - k.req END,
               'lines', k.n, 'reversed_lines', k.n_rev, 'reversed_qty', k.rev_qty, 'rotation_lines', k.n_rot,
               'first_at', k.first_at, 'last_at', k.last_at)
             ORDER BY k.prod_date, k.batch_no NULLS LAST, k.batch_code, k.so NULLS LAST, k.material_code), '[]'::jsonb))
      INTO v_out
      FROM k
      JOIN production_batch b ON b.id = k.batch_id
      JOIN "Material" m ON m.id = k.material_id
      JOIN "Material" bm ON bm.id = b.material_id
      JOIN "Warehouse" w ON w.id = b.warehouse_id
      LEFT JOIN "Warehouse" pw ON pw.id = w.parent_warehouse_id
      LEFT JOIN production_tank tk ON tk.id = b.tank_id;

  ELSE   -- 'fill'
    WITH fm AS (
      SELECT mv.id, mv.created_at FROM tank_movement mv JOIN production_batch b ON b.id = mv.batch_id
       WHERE mv.kind = 'FILL' AND b.warehouse_id = v_wh AND (v_cycle IS NULL OR b.cycle = v_cycle)
         AND (v_t0 IS NULL OR (mv.created_at >= v_t0 AND mv.created_at < v_t1))
       ORDER BY mv.created_at, mv.id
       LIMIT v_size OFFSET (v_page - 1) * v_size
    )
    SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
             'move_id', mv.id, 'at', mv.created_at, 'qty', mv.qty, 'by_name', mv.created_by_name, 'warning', mv.warning,
             'tank_code', tk.code, 'batch_id', b.id, 'batch_code', b.batch_code, 'cycle', b.cycle, 'batch_no', b.batch_no, 'shift', b.shift,
             'prod_date', b.prod_date, 'batch_status', b.status, 'batch_qa', b.qa_status,
             'btp_code', bm.material_code, 'btp_name', bm.short_name, 'btp_desc', bm.material_description, 'unit', bm.base_unit,
             'planned_qty', b.planned_qty, 'wh_code', w.code, 'sap_plant', COALESCE(w.sap_plant, pw.sap_plant),
             'sap_sloc', NULLIF(array_to_string(CASE WHEN cardinality(w.sap_storage_locations) > 0 THEN w.sap_storage_locations
                                                      ELSE pw.sap_storage_locations END, ','), ''))
             ORDER BY fm.created_at, fm.id), '[]'::jsonb))
      INTO v_out
      FROM fm
      JOIN tank_movement mv ON mv.id = fm.id
      JOIN production_batch b ON b.id = mv.batch_id
      JOIN "Material" bm ON bm.id = b.material_id
      JOIN "Warehouse" w ON w.id = b.warehouse_id
      LEFT JOIN "Warehouse" pw ON pw.id = w.parent_warehouse_id
      LEFT JOIN production_tank tk ON tk.id = mv.tank_id;
  END IF;
  RETURN v_out;
END $$;

-- chỗ đặt bồn trên sơ đồ 2D: items = [{id, x, y}] (x / y null ⇒ về tự xếp); chỉ bồn thuộc các kho trong `warehouse_ids` (backend đã cắt phạm vi)
CREATE OR REPLACE FUNCTION public.mes_tank_layout_save(p jsonb) RETURNS integer
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_n int;
BEGIN
  UPDATE production_tank t
     SET map_x = x.x, map_y = CASE WHEN x.x IS NULL THEN NULL ELSE x.y END, updated_at = now(), updated_by = p->>'actor_name'
    FROM jsonb_to_recordset(COALESCE(p->'items', '[]'::jsonb)) AS x(id text, x int, y int)
   WHERE t.id = x.id
     AND t.warehouse_id IN (SELECT jsonb_array_elements_text(COALESCE(p->'warehouse_ids', '[]'::jsonb)))
     AND (t.map_x IS DISTINCT FROM x.x OR t.map_y IS DISTINCT FROM CASE WHEN x.x IS NULL THEN NULL ELSE x.y END);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.mes_consumption_raw(jsonb), public.mes_tank_layout_save(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_consumption_raw(jsonb), public.mes_tank_layout_save(jsonb) TO service_role;

-- Lưới: mọi chu kỳ đang có — số phát sinh = số lần cấp + số lần huỷ · Σ SL có dấu = Σ lần cấp còn hiệu lực ·
-- Σ thực cấp của sheet định mức = cũng con số đó · số dòng nạp bồn = số lần FILL của các mẻ trong chu kỳ
DO $$
DECLARE r record; ev jsonb; rq jsonb; fl jsonb; v_db numeric; v_n int; v_rev int; v_fill int; v_sum numeric;
BEGIN
  FOR r IN SELECT DISTINCT warehouse_id, cycle FROM production_batch WHERE cycle IS NOT NULL LOOP
    ev := mes_consumption_raw(jsonb_build_object('warehouse_id', r.warehouse_id, 'cycle', r.cycle, 'page_size', 2000, 'sort', 'asc'));
    SELECT count(*), count(*) FILTER (WHERE c.reversed_at IS NOT NULL), COALESCE(sum(c.qty) FILTER (WHERE c.reversed_at IS NULL), 0)
      INTO v_n, v_rev, v_db
      FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id WHERE b.warehouse_id = r.warehouse_id AND b.cycle = r.cycle;
    IF (ev->>'total')::int <> v_n + v_rev THEN
      RAISE EXCEPTION 'mes_consumption_raw: kho % chu kỳ % — % phát sinh, sổ có % lần cấp + % lần huỷ', r.warehouse_id, r.cycle, ev->>'total', v_n, v_rev;
    END IF;
    SELECT COALESCE(sum((x->>'signed_qty')::numeric), 0) INTO v_sum FROM jsonb_array_elements(ev->'rows') x;
    IF v_sum <> v_db THEN RAISE EXCEPTION 'mes_consumption_raw: kho % chu kỳ % — Σ SL có dấu % ≠ Σ cấp còn hiệu lực %', r.warehouse_id, r.cycle, v_sum, v_db; END IF;
    rq := mes_consumption_raw(jsonb_build_object('warehouse_id', r.warehouse_id, 'cycle', r.cycle, 'part', 'req', 'mode', 'rows', 'page_size', 2000));
    SELECT COALESCE(sum((x->>'iss')::numeric), 0) INTO v_sum FROM jsonb_array_elements(rq->'rows') x;
    IF v_sum <> v_db THEN RAISE EXCEPTION 'mes_consumption_raw(req): kho % chu kỳ % — Σ thực cấp % ≠ %', r.warehouse_id, r.cycle, v_sum, v_db; END IF;
    fl := mes_consumption_raw(jsonb_build_object('warehouse_id', r.warehouse_id, 'cycle', r.cycle, 'part', 'fill', 'mode', 'rows', 'page_size', 2000));
    SELECT count(*) INTO v_fill FROM tank_movement mv JOIN production_batch b ON b.id = mv.batch_id
     WHERE mv.kind = 'FILL' AND b.warehouse_id = r.warehouse_id AND b.cycle = r.cycle;
    IF jsonb_array_length(fl->'rows') <> v_fill THEN
      RAISE EXCEPTION 'mes_consumption_raw(fill): kho % chu kỳ % — % dòng nạp ≠ % lần FILL', r.warehouse_id, r.cycle, jsonb_array_length(fl->'rows'), v_fill;
    END IF;
  END LOOP;
END $$;

COMMIT;
