-- ══════════════════════════════════════════════════════════════════════════
-- CUTOVER production 15/08/2026 — PART2 (10 migration)
-- Dán TRỌN file này vào Supabase SQL Editor (project production svicyfquresxaigfxsdb) → Run.
-- Bọc trong 1 transaction: lỗi bất kỳ đâu là ROLLBACK toàn bộ part → sửa rồi chạy lại,
-- KHÔNG để schema dở dang. Chạy các part theo ĐÚNG THỨ TỰ part1 → part5.
-- ══════════════════════════════════════════════════════════════════════════
BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 20260729_rpc_return_rows_batch.sql
-- ───────────────────────────────────────────────────────────────────────
-- CẮT ROUND-TRIP đợt 2 — 6 đường còn lại chuyển sang "RPC trả DÒNG" (luật CLAUDE.md 28/07:
-- mỗi request PostgREST chiếm 1 khe trong pool ~10 khe nội bộ + tốn 3 câu SQL; có hàng đợi thì
-- độ trễ ≈ SỐ REQUEST × thời gian chờ — nút thắt là pool PostgREST, KHÔNG phải máy DB).
--
-- Đo 29/07 trên ~350k dòng seed (số câu SQL mỗi lần mở trang, ÷3 ≈ số request):
--   Bảng công 12 · Nhặt lẻ 12 · Vị trí kho 10 · TMS Xe 10 · Nghỉ phép 8 · Phiếu cân 8 · Dashboard 5
-- Sau file này: mỗi trang = 1 request (RPC trả luôn dòng đã ghép quan hệ + đã sort trong SQL).
--
-- NGUYÊN TẮC GIỮ KHỚP (mỗi hàm ghi rõ tại chỗ):
--  · Giữ NGUYÊN khoá cũ trong jsonb trả về (`ids`/`emp_ids`/`gdo_ids`) — cửa sổ triển khai:
--    code cũ đang chạy trên Preview vẫn đọc được RPC mới, code mới có nhánh fallback khi RPC cũ.
--  · Payload dòng phải Y HỆT đường cũ (từng khoá, từng embed) — FE không đổi.
--  · plpgsql + force_custom_plan (bẫy LANGUAGE sql generic plan >300s — bài học 27/07).

-- ═══ 1. BẢNG CÔNG · hr_attendance_matrix: trả thêm employees + rows (4 request → 1) ═══
-- Đường cũ: RPC trả emp_ids → controller nạp Employee (chunk) + Attendance (chunk) + JobTitle (chunk).
CREATE OR REPLACE FUNCTION hr_attendance_matrix(
  p_scope_ids  text[],
  p_wh         text,
  p_dept       text,
  p_jt_name    text,
  p_search     text,
  p_from       date,
  p_to         date,
  p_work_dates date[],
  p_status     text,
  p_offset     int,
  p_limit      int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE s text;
BEGIN
  s := CASE WHEN p_search IS NULL OR btrim(p_search) = '' THEN NULL
            ELSE lower(immutable_unaccent(btrim(p_search))) END;
  RETURN (
    WITH emp AS (
      SELECT e.id, e.name
      FROM "Employee" e
      LEFT JOIN "JobTitle" j ON j.id = e.job_title_id
      WHERE e.deleted_at IS NULL AND e.is_active
        AND (p_scope_ids IS NULL OR e.id = ANY (p_scope_ids))
        AND (p_dept    IS NULL OR e.department_id = p_dept)
        AND (p_jt_name IS NULL OR j.name = p_jt_name)
        AND (p_wh IS NULL OR EXISTS (
              SELECT 1 FROM "UserWarehouseAccess" w
              WHERE w.employee_id = e.id AND w.warehouse_id = p_wh))
        AND (s IS NULL OR lower(immutable_unaccent(
              concat_ws(' ', e.name, e.employee_code))) LIKE '%' || s || '%')
    ),
    att AS (
      SELECT a.employee_id, a.work_date, a.kind, a.ot_hours, a.early_leave_hours
      FROM "Attendance" a
      WHERE a.work_date >= p_from AND a.work_date <= p_to
        AND a.employee_id IN (SELECT id FROM emp)
    ),
    miss AS (
      SELECT e.id, COALESCE(cardinality(p_work_dates), 0) - count(a.work_date) AS n
      FROM emp e
      LEFT JOIN att a ON a.employee_id = e.id
                     AND a.work_date = ANY (COALESCE(p_work_dates, '{}'::date[]))
      GROUP BY e.id
    ),
    e2 AS (
      SELECT emp.id, emp.name, GREATEST(0, miss.n) AS missing
      FROM emp JOIN miss ON miss.id = emp.id
    ),
    f AS (
      SELECT * FROM e2
      WHERE CASE p_status WHEN 'done' THEN missing = 0
                          WHEN 'missing' THEN missing > 0
                          ELSE TRUE END
    ),
    pg AS (
      SELECT id, row_number() OVER (ORDER BY name, id) rn
      FROM f ORDER BY name, id OFFSET p_offset LIMIT p_limit
    )
    SELECT jsonb_build_object(
      'emp_ids',       COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb),
      -- MỚI: thông tin nhân sự của ĐÚNG trang (mirror payload controller cũ dựng từ 3 lần nạp chunk)
      'employees',     COALESCE((SELECT jsonb_agg(jsonb_build_object(
                          'id', e.id, 'name', e.name, 'code', e.employee_code,
                          'job', jt.name) ORDER BY pg.rn)
                        FROM pg JOIN "Employee" e ON e.id = pg.id
                        LEFT JOIN "JobTitle" jt ON jt.id = e.job_title_id), '[]'::jsonb),
      -- MỚI: công của ĐÚNG trang trong khoảng ngày — từng khoá Y HỆT SEL của controller
      'rows',          COALESCE((SELECT jsonb_agg(jsonb_build_object(
                          'id', a.id, 'employee_id', a.employee_id, 'warehouse_id', a.warehouse_id,
                          'work_date', a.work_date, 'kind', a.kind, 'ot_hours', a.ot_hours,
                          'early_leave_hours', a.early_leave_hours, 'note', a.note,
                          'created_at', a.created_at, 'updated_at', a.updated_at)
                          ORDER BY a.work_date DESC, a.id)
                        FROM "Attendance" a
                        WHERE a.employee_id IN (SELECT id FROM pg)
                          AND a.work_date >= p_from AND a.work_date <= p_to), '[]'::jsonb),
      'total',         (SELECT count(*) FROM f),
      'roster_total',  (SELECT count(*) FROM e2),
      'missing_total', (SELECT COALESCE(sum(missing), 0) FROM e2),
      'work_days',     (SELECT count(*)                     FROM att WHERE kind <> 'LEAVE'),
      'leave_days',    (SELECT count(*)                     FROM att WHERE kind  = 'LEAVE'),
      'ot',            (SELECT COALESCE(sum(ot_hours), 0)   FROM att WHERE kind <> 'LEAVE'),
      'early',         (SELECT COALESCE(sum(early_leave_hours), 0) FROM att WHERE kind <> 'LEAVE')
    )
  );
END $$;

-- ═══ 2. NGHỈ PHÉP · hr_leaves_page: trả thêm rows + employee embed (4 request → 1) ═══
-- Đường cũ: RPC trả ids → nạp LeaveRequest (chunk) → attachEmployees (Employee + JobTitle).
CREATE OR REPLACE FUNCTION hr_leaves_page(
  p_scope_emp_ids text[],
  p_warehouse     text,
  p_dept          text,
  p_employee      text,
  p_jt_name       text,
  p_status        text,
  p_from          date,
  p_to            date,
  p_offset        int,
  p_limit         int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH f AS (
    SELECT l.id, l.date_from, l.status
    FROM "LeaveRequest" l
    JOIN "Employee" e ON e.id = l.employee_id
    LEFT JOIN "JobTitle" j ON j.id = e.job_title_id
    WHERE (p_scope_emp_ids IS NULL OR l.employee_id = ANY (p_scope_emp_ids))
      AND (p_warehouse IS NULL OR l.warehouse_id   = p_warehouse)
      AND (p_dept      IS NULL OR e.department_id   = p_dept)
      AND (p_employee  IS NULL OR l.employee_id     = p_employee)
      AND (p_jt_name   IS NULL OR j.name            = p_jt_name)
      AND (p_status     IS NULL OR l.status          = p_status)
      AND (p_to        IS NULL OR l.date_from <= p_to)
      AND (p_from      IS NULL OR l.date_to   >= p_from)
  ),
  pg AS (
    SELECT id, row_number() OVER (ORDER BY date_from DESC, id) rn
    FROM f ORDER BY date_from DESC, id OFFSET p_offset LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'ids', COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb),
    -- MỚI: dòng đơn nghỉ + employee embed — từng khoá Y HỆT LEAVE_SELECT + attachEmployees cũ
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', l.id, 'employee_id', l.employee_id, 'warehouse_id', l.warehouse_id,
              'date_from', l.date_from, 'date_to', l.date_to, 'leave_type', l.leave_type,
              'reason', l.reason, 'status', l.status, 'approved_by', l.approved_by,
              'approved_at', l.approved_at, 'created_at', l.created_at, 'updated_at', l.updated_at,
              'employee', CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object(
                'id', e.id, 'name', e.name, 'employee_code', e.employee_code,
                'department_id', e.department_id, 'job_title_id', e.job_title_id,
                'warehouse_scope', e.warehouse_scope, 'job_title', jt.name) END)
              ORDER BY pg.rn)
            FROM pg JOIN "LeaveRequest" l ON l.id = pg.id
            LEFT JOIN "Employee" e ON e.id = l.employee_id
            LEFT JOIN "JobTitle" jt ON jt.id = e.job_title_id), '[]'::jsonb),
    'total',    (SELECT count(*) FROM f),
    'pending',  (SELECT count(*) FROM f WHERE status = 'PENDING'),
    'approved', (SELECT count(*) FROM f WHERE status = 'APPROVED'),
    'rejected', (SELECT count(*) FROM f WHERE status = 'REJECTED')
  ) INTO r;
  RETURN r;
END $$;

-- ═══ 3. NHẶT LẺ · loose_picking_page: trả thêm items đầy đủ (5 request → 1) ═══
-- Đường cũ: RPC trả gdo_ids → nạp GDO + OutboundDelivery + OutboundItem(+material) + OutboundScanEntry.
CREATE OR REPLACE FUNCTION loose_picking_page(
  p_wh_scope     text[],
  p_cat_scope    text[],
  p_warehouse_id text,
  p_from         date,
  p_to           date,
  p_wh_types     text[],
  p_export_types text[],
  p_dvvts        text[],
  p_npps         text[],
  p_search       text,
  p_offset       int,
  p_limit        int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb; s text;
BEGIN
  s := CASE WHEN p_search IS NULL OR btrim(p_search) = '' THEN NULL
            ELSE lower(immutable_unaccent(btrim(p_search))) END;

  WITH it AS (
    SELECT i.id, i.do_id, i.material_id, i.material_code_raw,
           i.cartons_ordered, i.cartons_scanned, i.loose_picking, i.export_type
    FROM "OutboundItem" i
    WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
  ),
  j AS (
    SELECT it.*, d.gdo_id, d.distributor_name,
           g.group_code, g.dvvt, g.warehouse_type, g.delivery_date,
           m.entry_unit, m.units_per_carton, m.short_name, m.material_code,
           COALESCE(ls.done, 0) AS loose_scanned
    FROM it
    JOIN "OutboundDelivery"    d ON d.id = it.do_id
    JOIN "GroupDeliveryOrder"  g ON g.id = d.gdo_id AND g.status <> 'CANCELLED'
    LEFT JOIN "Material"       m ON m.id = it.material_id
    LEFT JOIN LATERAL (
      SELECT sum(se.cartons_scanned) AS done
      FROM "OutboundScanEntry" se
      WHERE se.item_id = it.id AND se.is_loose_picking
    ) ls ON TRUE
    WHERE (p_from IS NULL OR g.delivery_date >= p_from)
      AND (p_to   IS NULL OR g.delivery_date <= p_to)
      AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
      AND (p_wh_scope  IS NULL OR g.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR g.warehouse_type = ANY (p_cat_scope))
  ),
  st AS (
    SELECT j.*,
           GREATEST(0, loose_picking
                       - GREATEST(0, (cartons_scanned - loose_scanned)
                                     - (cartons_ordered - loose_picking))) AS effective
    FROM j
  ),
  st2 AS (
    SELECT st.*, LEAST(loose_scanned, effective) AS done FROM st
  ),
  gg AS (
    SELECT gdo_id,
           max(group_code)     AS group_code,
           max(delivery_date)  AS delivery_date,
           count(*)            AS items_n,
           count(*) FILTER (WHERE effective - done > 0) AS pending_n,
           sum(qty_entry_decimal(effective, entry_unit, units_per_carton)) AS loose_total,
           sum(qty_entry_decimal(done,      entry_unit, units_per_carton)) AS loose_done,
           max(export_type)    AS export_type,
           max(dvvt)           AS dvvt,
           max(warehouse_type) AS warehouse_type,
           array_agg(DISTINCT distributor_name) FILTER (WHERE distributor_name IS NOT NULL) AS npps,
           lower(immutable_unaccent(
             concat_ws(' ', max(group_code), max(export_type), max(dvvt),
                            string_agg(DISTINCT distributor_name, ' '),
                            string_agg(DISTINCT COALESCE(material_code, material_code_raw), ' '),
                            string_agg(DISTINCT short_name, ' ')))) AS hay
    FROM st2 GROUP BY gdo_id
  ),
  f AS (
    SELECT * FROM gg
    WHERE (p_wh_types     IS NULL OR warehouse_type = ANY (p_wh_types))
      AND (p_export_types IS NULL OR export_type    = ANY (p_export_types))
      AND (p_dvvts        IS NULL OR dvvt           = ANY (p_dvvts))
      AND (p_npps         IS NULL OR npps && p_npps)
      AND (s IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(string_to_array(s, ' ')) t
            WHERE t <> '' AND position(t IN hay) = 0))
  ),
  pg AS (
    SELECT gdo_id FROM f ORDER BY delivery_date, group_code, gdo_id OFFSET p_offset LIMIT p_limit
  ),
  -- gdo object dựng MỘT LẦN per chuyến (mirror payload controller cũ: gdo + warehouse embed +
  -- distributor_names từ MỌI delivery của chuyến + export_type = item nhặt lẻ ĐẦU TIÊN có khai)
  gdoj AS (
    SELECT pg.gdo_id,
           jsonb_build_object(
             'id', g.id, 'group_code', g.group_code, 'delivery_date', g.delivery_date,
             'planned_date', g.planned_date, 'status', g.status, 'started_at', g.started_at,
             'dvvt', g.dvvt, 'warehouse_type', g.warehouse_type,
             'warehouse', CASE WHEN w.id IS NULL THEN NULL ELSE
               jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name) END,
             'distributor_names', COALESCE((
               SELECT jsonb_agg(DISTINCT d2.distributor_name)
               FROM "OutboundDelivery" d2
               WHERE d2.gdo_id = g.id AND d2.distributor_name IS NOT NULL), '[]'::jsonb),
             'export_type', (
               SELECT i2.export_type
               FROM "OutboundDelivery" d3 JOIN "OutboundItem" i2 ON i2.do_id = d3.id
               WHERE d3.gdo_id = g.id AND i2.loose_picking > 0 AND i2.status <> 'CANCELLED'
                 AND i2.export_type IS NOT NULL
               ORDER BY i2.id LIMIT 1)
           ) AS gdo
    FROM pg
    JOIN "GroupDeliveryOrder" g ON g.id = pg.gdo_id
    LEFT JOIN "Warehouse" w ON w.id = g.warehouse_id
  )
  SELECT jsonb_build_object(
    'gdo_ids',     COALESCE((SELECT jsonb_agg(gdo_id) FROM pg), '[]'::jsonb),
    -- MỚI: item đầy đủ (to_jsonb toàn bộ cột như select '*' cũ) + material + gdo + loose_scanned
    'items',       COALESCE((
      SELECT jsonb_agg(to_jsonb(i)
               || jsonb_build_object(
                    'material', CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object(
                      'id', m.id, 'material_code', m.material_code, 'short_name', m.short_name,
                      'base_unit', m.base_unit, 'entry_unit', m.entry_unit,
                      'units_per_carton', m.units_per_carton) END,
                    'gdo', gdoj.gdo,
                    'loose_scanned', COALESCE(ls.done, 0))
               ORDER BY i.id)
      FROM gdoj
      JOIN "OutboundDelivery" d ON d.gdo_id = gdoj.gdo_id
      JOIN "OutboundItem" i ON i.do_id = d.id AND i.loose_picking > 0 AND i.status <> 'CANCELLED'
      LEFT JOIN "Material" m ON m.id = i.material_id
      LEFT JOIN LATERAL (
        SELECT sum(se.cartons_scanned) AS done
        FROM "OutboundScanEntry" se
        WHERE se.item_id = i.id AND se.is_loose_picking
      ) ls ON TRUE), '[]'::jsonb),
    'total',       (SELECT count(*)                FROM f),
    'items_n',     (SELECT COALESCE(sum(items_n), 0)     FROM f),
    'pending_n',   (SELECT COALESCE(sum(pending_n), 0)   FROM f),
    'loose_total', (SELECT COALESCE(sum(loose_total), 0)  FROM f),
    'loose_done',  (SELECT COALESCE(sum(loose_done), 0)   FROM f)
  ) INTO r;
  RETURN r;
END $$;

-- ═══ 4. VỊ TRÍ KHO · locations_page: trả thêm rows khi p_with_rows (3 request → 1) ═══
-- Thêm tham số CÓ DEFAULT ở cuối = đổi chữ ký ⇒ phải DROP đúng chữ ký cũ (tránh 2 overload
-- làm PostgREST mơ hồ). Caller export (p_limit 1 triệu, chỉ cần ids) không truyền → false.
DROP FUNCTION IF EXISTS locations_page(int, int, text[], text, text[], text[], boolean, boolean);
-- DROP cả chữ ký MỚI để file chạy lại được (idempotent — apply production không được gãy giữa chừng)
DROP FUNCTION IF EXISTS locations_page(int, int, text[], text, text[], text[], boolean, boolean, boolean);
CREATE FUNCTION locations_page(
  p_offset      int,
  p_limit       int,
  p_wh_ids      text[]  DEFAULT NULL,
  p_category    text    DEFAULT NULL,
  p_scope_cats  text[]  DEFAULT NULL,
  p_tokens      text[]  DEFAULT NULL,
  p_flag        boolean DEFAULT false,
  p_incl_inactive boolean DEFAULT false,
  p_with_rows   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH f AS (
    SELECT l.id, l.sub_code, l.row, l.shelf
    FROM "Location" l
    LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
    WHERE (p_wh_ids IS NULL OR l.warehouse_id = ANY (p_wh_ids))
      AND (p_incl_inactive OR l.is_active)
      AND (p_category IS NULL OR l.categories IS NULL OR l.categories @> ARRAY[p_category])
      AND (p_scope_cats IS NULL OR l.categories IS NULL OR l.categories && p_scope_cats)
      AND (NOT p_flag OR l.requires_stocktake)
      AND (p_tokens IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p_tokens) t
            WHERE position(t IN (COALESCE(l.search_norm, '') || ' ' ||
                   lower(COALESCE(array_to_string(l.categories, ' '), '') || ' ' ||
                         COALESCE(l.sub_type, '') || ' ' || COALESCE(l.row, '') || ' ' ||
                         COALESCE(l.shelf, '') || ' ' || COALESCE(w.code, '') || ' ' || COALESCE(w.name, '')))) = 0))
  ),
  pg AS (
    SELECT id, row_number() OVER (ORDER BY sub_code, row, shelf, id) rn
    FROM f ORDER BY sub_code, row, shelf, id
    LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    'ids',   COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb),
    'total', (SELECT count(*) FROM f),
    -- MỚI (chỉ khi p_with_rows): dòng Location đầy đủ + warehouse + _count + used_slots.
    -- used_slots = ĐỊNH NGHĨA DUY NHẤT (khớp usedSlotsFor cũ + locations_summary):
    -- stack_layer=1 AND status IN ('IN_STOCK','PARTIAL') AND cartons_remaining>0.
    'rows',  CASE WHEN NOT p_with_rows THEN NULL ELSE COALESCE((
      SELECT jsonb_agg(to_jsonb(l)
               || jsonb_build_object(
                    'warehouse', CASE WHEN w.id IS NULL THEN NULL ELSE
                      jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name) END,
                    '_count', jsonb_build_object('inventory_entries', COALESCE(cnt.n, 0)),
                    'used_slots', COALESCE(us.n, 0),
                    'has_same_material', false)
               ORDER BY p.rn)
      FROM pg p
      JOIN "Location" l ON l.id = p.id
      LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
      LEFT JOIN LATERAL (
        SELECT count(*) n FROM "InventoryEntry" e WHERE e.location_id = l.id) cnt ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*) n FROM "InventoryEntry" e
        WHERE e.location_id = l.id AND e.stack_layer = 1
          AND e.status IN ('IN_STOCK', 'PARTIAL') AND e.cartons_remaining > 0) us ON TRUE), '[]'::jsonb) END
  ) INTO result;
  RETURN result;
END $$;

-- ═══ 5. TMS XE · tms_vehicles_page (MỚI): 5 request → 1 ═══
-- Đường cũ: 3 câu đếm/lấy trang (đã rút còn 2 đếm ngày 28/07) + withRelations nạp
-- TransportCompany + VehicleType. WHERE mirror buildQ của listVehiclesPaged.
CREATE OR REPLACE FUNCTION tms_vehicles_page(
  p_ncc_ids text[],
  p_vt_ids  text[],
  p_active  boolean,
  p_search  text,     -- controller đã escape %_ (safeSearch) trước khi truyền
  p_offset  int,
  p_limit   int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH f AS (
    SELECT v.id, v.license_plate, v.is_active
    FROM "Vehicle" v
    -- ::text phía CỘT: Vehicle.ncc_id/vehicle_type_id là uuid, param là text[] — thiếu cast là
    -- 42883 "operator does not exist: uuid = text" (đã dính khi viết hàm). Bảng danh mục nhỏ,
    -- không cần index cho 2 filter này.
    WHERE (p_ncc_ids IS NULL OR v.ncc_id::text = ANY (p_ncc_ids))
      AND (p_vt_ids  IS NULL OR v.vehicle_type_id::text = ANY (p_vt_ids))
      AND (p_active  IS NULL OR v.is_active = p_active)
      AND (p_search  IS NULL OR v.license_plate ILIKE '%' || p_search || '%')
  ),
  pg AS (
    SELECT id, row_number() OVER (ORDER BY license_plate, id) rn
    FROM f ORDER BY license_plate, id OFFSET GREATEST(p_offset, 0) LIMIT GREATEST(p_limit, 0)
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(v)
              || jsonb_build_object(
                   'ncc', CASE WHEN c.id IS NULL THEN NULL ELSE
                     jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name) END,
                   'vehicle_type', CASE WHEN t.id IS NULL THEN NULL ELSE
                     jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name) END)
              ORDER BY p.rn)
            FROM pg p JOIN "Vehicle" v ON v.id = p.id
            LEFT JOIN "TransportCompany" c ON c.id = v.ncc_id
            LEFT JOIN "VehicleType" t ON t.id = v.vehicle_type_id), '[]'::jsonb),
    'total',  (SELECT count(*) FROM f),
    -- inactive = total − active (Vehicle.is_active NOT NULL) — controller tự trừ
    'active', (SELECT count(*) FROM f WHERE is_active)
  ) INTO r;
  RETURN r;
END $$;

-- ═══ 6. PHIẾU CÂN · weigh_tickets_page (MỚI): 5 request → 1 ═══
-- Đường cũ: trang + 2 câu đếm (done/matched) + nạp tên Kho + nạp group_code chuyến đã gắn.
-- WHERE mirror applyFilters của listWeighTickets (kể cả null-inclusive theo scope kho).
CREATE OR REPLACE FUNCTION weigh_tickets_page(
  p_wh_ids   text[],   -- kho được lọc/scope (null = không giới hạn)
  p_null_ok  boolean,  -- true = phiếu CHƯA gắn kho vẫn hiện (chế độ scope, không phải user chọn kho)
  p_from     date,
  p_to       date,
  p_direction text,
  p_match    text,     -- matched | unmatched | pending | null
  p_q        text,     -- từ khoá thô (đã strip ký tự đặc biệt ở controller)
  p_plate    text,     -- biển số chuẩn hoá từ p_q (normPlate)
  p_offset   int,
  p_limit    int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH f AS (
    SELECT w.id, w.is_complete, w.gdo_id, w.in_time, w.source_id
    FROM "WeighTicket" w
    WHERE (p_wh_ids IS NULL
           OR w.warehouse_id = ANY (p_wh_ids)
           OR (p_null_ok AND w.warehouse_id IS NULL))
      AND (p_from IS NULL OR w.weigh_date >= p_from)
      AND (p_to   IS NULL OR w.weigh_date <= p_to)
      AND (p_direction IS NULL OR w.direction = p_direction)
      AND (p_match IS NULL
           OR (p_match = 'matched'   AND w.gdo_id IS NOT NULL)
           OR (p_match = 'unmatched' AND w.gdo_id IS NULL)
           OR (p_match = 'pending'   AND NOT w.is_complete))
      AND (p_q IS NULL
           OR w.license_plate_norm ILIKE '%' || COALESCE(p_plate, p_q) || '%'
           OR w.ticket_no  ILIKE '%' || p_q || '%'
           OR w.goods_name ILIKE '%' || p_q || '%')
  ),
  pg AS (
    SELECT id, row_number() OVER (ORDER BY in_time DESC NULLS LAST, source_id DESC) rn
    FROM f ORDER BY in_time DESC NULLS LAST, source_id DESC
    OFFSET GREATEST(p_offset, 0) LIMIT GREATEST(p_limit, 0)
  )
  SELECT jsonb_build_object(
    -- to_jsonb(w) = select '*' cũ (gồm cả cột raw); đắp thêm 3 khoá controller từng join tay
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(w)
              || jsonb_build_object(
                   'warehouse_name', wh.name,
                   'gdo_group_code', g.group_code,
                   'gdo_status',     g.status)
              ORDER BY p.rn)
            FROM pg p JOIN "WeighTicket" w ON w.id = p.id
            LEFT JOIN "Warehouse" wh ON wh.id = w.warehouse_id
            LEFT JOIN "GroupDeliveryOrder" g ON g.id = w.gdo_id), '[]'::jsonb),
    'total',   (SELECT count(*) FROM f),
    'done',    (SELECT count(*) FROM f WHERE is_complete),
    'matched', (SELECT count(*) FROM f WHERE gdo_id IS NOT NULL)
  ) INTO r;
  RETURN r;
END $$;

-- ═══ 7. DASHBOARD · dashboard_all (MỚI): stats + zones trong 1 lời gọi (2 request → 1) ═══
-- Dashboard là trang ai cũng mở đầu tiên — dưới tải, 2 request = 2 lượt xếp hàng pool.
CREATE OR REPLACE FUNCTION dashboard_all(
  p_warehouse_ids text[],
  p_categories    text[],
  p_today         date
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  SELECT COALESCE(dashboard_stats(p_warehouse_ids, p_categories, p_today), '{}'::jsonb)
      || jsonb_build_object('zones', COALESCE((
           -- WITH ORDINALITY giữ đúng THỨ TỰ hiển thị mà zone_capacity_rows đã sort
           SELECT jsonb_agg(jsonb_build_object(
                    'zone_id', z.zone_id, 'warehouse_id', z.warehouse_id,
                    'warehouse_name', z.warehouse_name, 'code', z.code, 'name', z.name,
                    'category', z.category, 'capacity', z.capacity, 'used', z.used)
                  ORDER BY z.ord)
           FROM zone_capacity_rows(p_warehouse_ids, p_categories)
                WITH ORDINALITY AS z(zone_id, warehouse_id, warehouse_name, code, name,
                                     category, capacity, used, ord)), '[]'::jsonb))
  INTO r;
  RETURN r;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260729b_error_logs.sql
-- ───────────────────────────────────────────────────────────────────────
-- ============================================================================
-- TAI MẮT PRODUCTION (29/07/2026) — bảng gom lỗi runtime để app TỰ BÁO lỗi,
-- thay vì chỉ phát hiện khi có người ngồi kiểm ("mỗi lần kiểm lại lòi một đống").
-- Ghi vào từ 2 nguồn:
--   - BE: mọi response 5xx đi qua maskServerMessage (utils/response.ts) — fire-and-forget.
--   - FE: window.onerror / unhandledrejection → POST /api/telemetry/client-error (public,
--         rate-limit + dedupe phía client, tối đa 5 lỗi/phiên).
-- Đọc ra qua GET /api/telemetry/digest (chỉ ĐẾM 24h, không lộ nội dung) — workflow keepalive
-- gọi hằng ngày: đếm BE > 0 → job đỏ → GitHub email user.
-- Bảng MỚI nên có DEFAULT (luật "INSERT phải tự cấp id/updated_at" là cho bảng CŨ thiếu default).
-- RLS bật + KHÔNG policy → anon/authenticated không đọc/ghi được; chỉ service role (BE) đụng vào.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.error_logs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL    DEFAULT now(),
  source     text        NOT NULL    CHECK (source IN ('be', 'fe')),
  status     integer,            -- HTTP status (BE) / null (FE)
  code       text,               -- mã lỗi app (SERVER_ERROR…) nếu có
  message    text NOT NULL,      -- đã cắt 500 ký tự phía ghi
  url        text,               -- FE: trang đang mở; BE: để trống (message thường đã có ngữ cảnh)
  ua         text                -- FE: user-agent rút gọn
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created ON public.error_logs (created_at DESC);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- Tự dọn: giữ 30 ngày là quá đủ cho digest — dọn lười mỗi lần BE ghi (xác suất 1%, xem response.ts).
-- (Không dùng pg_cron — free tier không bật sẵn; dọn lười đủ tốt cho bảng chỉ-ghi-ít này.)

-- ───────────────────────────────────────────────────────────────────────
-- 20260729c_control_tower_inbound_fix.sql
-- ───────────────────────────────────────────────────────────────────────
-- 29/07/2026 — Giám sát vận hành: sửa phần NHẬP (phát hiện khi user soi số sau upload)
--  (1) inb_pallets (ô "Pallet nhập") KHÔNG lọc theo Loại kho trong khi khối "Hàng nhập theo mã"
--      CÓ lọc → chọn lọc PK01: ô vẫn 2.374 pallet còn danh sách chỉ 252 (lệch 9,4×).
--  (2) hourly_in (cột xanh "pallet nhập" của biểu đồ giờ) cũng thiếu lọc Loại kho — cùng gốc.
--  (3) in_mat_rows trả thêm `unit` (entry_unit nếu mã có quy cách thùng, ngược lại base_unit)
--      để FE in ĐÚNG đơn vị từng dòng: cột cũ ghi "Thùng" nhưng mã không quy cách (EA/KG) trả
--      base thô → 1 dòng hiện 2.816.800 "thùng" cho 22 pallet (thực chất 2,8 triệu CÁI).
-- Phần còn lại giữ NGUYÊN như bản đang chạy (20260722_dashboard_control_tower_baseunit_rpc).
create or replace function control_tower_stats(
  p_warehouse_ids text[] default null,
  p_categories    text[] default null,
  p_today         date   default null,
  p_material_codes text[] default null
) returns jsonb language sql stable as $$
with day_range as (
  select ((p_today::timestamp at time zone 'Asia/Ho_Chi_Minh') at time zone 'UTC')       as t0,
         (((p_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') at time zone 'UTC') as t1
),
gdo_today as (
  select g.id, g.group_code, g.status, g.license_plate, g.started_at, g.warehouse_id, g.warehouse_type
  from "GroupDeliveryOrder" g
  where g.delivery_date = p_today and g.status <> 'CANCELLED'
    and (p_warehouse_ids is null or g.warehouse_id is null or g.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or g.warehouse_type is null or g.warehouse_type = any(p_categories))
),
gate as (
  select
    count(*) filter (where status = 'REGISTERED') as registered,
    count(*) filter (where status = 'CALLED')     as called,
    count(*) filter (where status = 'IN')         as inside,
    count(*) filter (where status = 'COMPLETED')  as completed
  from gate_registrations g
  where g.date = p_today
    and (p_warehouse_ids is null or g.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or g.warehouse_type is null or g.warehouse_type = any(p_categories))
),
gate_inside as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'plate', s.license_plate, 'company', s.company_name_raw, 'direction', s.direction,
    'entry_at', s.entry_at, 'warehouse_name', w.name, 'content', s.content,
    'warehouse_type', s.warehouse_type, 'vehicle_type', s.vehicle_type
  ) order by s.entry_at), '[]'::jsonb) as list
  from (
    select g.* from gate_registrations g
    where g.date = p_today and g.status = 'IN'
      and (p_warehouse_ids is null or g.warehouse_id = any(p_warehouse_ids))
      and (p_categories is null or g.warehouse_type is null or g.warehouse_type = any(p_categories))
    order by g.entry_at limit 40
  ) s left join "Warehouse" w on w.id = s.warehouse_id
),
out_gdo as (
  select
    count(*) filter (where status = 'PENDING')     as pending,
    count(*) filter (where status = 'IN_PROGRESS') as in_progress,
    count(*) filter (where status = 'PAUSED')      as paused,
    count(*) filter (where status = 'COMPLETED')   as completed,
    count(*)                                       as total
  from gdo_today
),
out_cartons as (
  select coalesce(sum(oi.cartons_ordered / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as planned,
         coalesce(sum(oi.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as scanned,
         coalesce(sum(oi.loose_picking   / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as loose_planned
  from gdo_today g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi on oi.do_id = d.id
  left join "Material" m on m.id = oi.material_id
),
loose_scan as (
  select coalesce(sum(ose.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as loose_scanned
  from gdo_today g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi on oi.do_id = d.id
  join "OutboundScanEntry" ose on ose.item_id = oi.id
  left join "Material" m on m.id = oi.material_id
  where ose.is_loose_picking
),
out_mat_rows as (
  select coalesce(m.material_code, oi.material_code_raw, '—') as code,
         coalesce(m.short_name, oi.material_code_raw, '—')    as name,
         coalesce(m.category, 'Khác')                         as category,
         sum(oi.cartons_ordered / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)) as ordered,
         sum(oi.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)) as scanned,
         sum(oi.loose_picking   / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)) as loose
  from gdo_today g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi on oi.do_id = d.id
  left join "Material" m on m.id = oi.material_id
  where (p_material_codes is null
         or coalesce(m.material_code, oi.material_code_raw) = any(p_material_codes))
  group by 1, 2, 3
),
out_by_mat as (
  select
    (select count(*) from out_mat_rows)                                          as n_materials,
    (select count(*) from out_mat_rows where scanned >= ordered and ordered > 0) as n_done,
    (select count(*) from out_mat_rows where scanned < ordered)                  as n_short,
    coalesce((select jsonb_agg(to_jsonb(t.*) order by (t.ordered - t.scanned) desc, t.ordered desc)
      from (select * from out_mat_rows order by (ordered - scanned) desc, ordered desc limit 30) t), '[]'::jsonb) as list
),
in_mat_rows as (
  select coalesce(m.material_code, '—') as code,
         coalesce(m.short_name, '—')    as name,
         coalesce(m.category, 'Khác')   as category,
         -- Đơn vị THẬT của số ở cột SL: mã có quy cách thùng → entry_unit (số là thùng quy đổi);
         -- mã không quy cách → base_unit (số là base thô: EA/KG) — FE in kèm để không đọc nhầm.
         case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0
              then m.entry_unit else m.base_unit end as unit,
         count(*)                              as pallets,
         coalesce(sum(ie.cartons_imported / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as cartons
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date::date = p_today
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
    and (p_material_codes is null or m.material_code = any(p_material_codes))
  group by 1, 2, 3, 4
),
in_by_mat as (
  select
    (select count(*) from in_mat_rows) as n_materials,
    coalesce((select jsonb_agg(to_jsonb(t.*) order by t.cartons desc)
      from (select * from in_mat_rows order by cartons desc limit 30) t), '[]'::jsonb) as list
),
out_active as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'group_code', t.group_code, 'status', t.status, 'plate', t.license_plate,
    'warehouse_name', t.wname, 'planned', t.planned, 'scanned', t.scanned, 'started_at', t.started_at,
    'npp', t.npp, 'n_materials', t.n_mats,
    'warehouse_type', t.warehouse_type, 'export_type', t.export_type
  ) order by t.started_at desc nulls last), '[]'::jsonb) as list
  from (
    select g.id, g.group_code, g.status, g.license_plate, g.started_at, g.warehouse_type, w.name as wname,
           coalesce(sum(oi.cartons_ordered / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as planned,
           coalesce(sum(oi.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as scanned,
           string_agg(distinct d.distributor_name, ', ')            as npp,
           string_agg(distinct oi.export_type, ', ')                as export_type,
           count(distinct coalesce(oi.material_id, oi.material_code_raw)) as n_mats
    from gdo_today g
    left join "Warehouse" w on w.id = g.warehouse_id
    left join "OutboundDelivery" d on d.gdo_id = g.id
    left join "OutboundItem" oi on oi.do_id = d.id
    left join "Material" m on m.id = oi.material_id
    where g.status in ('IN_PROGRESS', 'PAUSED')
    group by g.id, g.group_code, g.status, g.license_plate, g.started_at, g.warehouse_type, w.name
    order by g.started_at desc nulls last limit 40
  ) t
),
inb as (
  select count(*) as orders
  from "ProductionImport" pi
  where pi.import_date::date = p_today
    and (p_warehouse_ids is null or pi.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or pi.warehouse_type is null or pi.warehouse_type = any(p_categories))
),
inb_pallets as (
  select count(*) as pallets,
         coalesce(sum(ie.cartons_imported / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as cartons
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date::date = p_today
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    -- FIX 29/07: thiếu dòng này → ô "Pallet nhập" đếm CẢ loại kho không được chọn
    and (p_categories is null or m.category is null or m.category = any(p_categories))
),
weigh as (
  select count(*)                                                  as tickets,
         count(*) filter (where not wt.is_complete)                as pending2,
         coalesce(sum(wt.net_kg) filter (where wt.is_complete), 0) as net_kg
  from "WeighTicket" wt
  where wt.weigh_date = p_today
    and (p_warehouse_ids is null or wt.warehouse_id is null or wt.warehouse_id = any(p_warehouse_ids))
),
hourly_out as (
  select extract(hour from (ose.scanned_at at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh'))::int as h,
         count(*) as scans,
         coalesce(sum(ose.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as cartons
  from "OutboundScanEntry" ose
  join "OutboundItem" oi on oi.id = ose.item_id
  join "OutboundDelivery" d on d.id = oi.do_id
  join "GroupDeliveryOrder" g on g.id = d.gdo_id
  left join "Material" m on m.id = oi.material_id
  cross join day_range r
  where ose.scanned_at >= r.t0 and ose.scanned_at < r.t1
    and (p_warehouse_ids is null or g.warehouse_id is null or g.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or g.warehouse_type is null or g.warehouse_type = any(p_categories))
  group by 1
),
hourly_in as (
  select extract(hour from (ie.created_at at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh'))::int as h,
         count(*) as pallets
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id     -- FIX 29/07: để lọc được Loại kho
  cross join day_range r
  where ie.created_at >= r.t0 and ie.created_at < r.t1
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by 1
),
hourly as (
  select coalesce(o.h, i.h) as h,
         coalesce(o.cartons, 0) as out_cartons,
         coalesce(o.scans, 0)   as out_scans,
         coalesce(i.pallets, 0) as in_pallets
  from hourly_out o full outer join hourly_in i on i.h = o.h
)
select jsonb_build_object(
  'gate',     (select to_jsonb(g.*) from gate g) || jsonb_build_object('inside_list', (select list from gate_inside)),
  'outbound', (select to_jsonb(o.*) from out_gdo o) || (select to_jsonb(c.*) from out_cartons c)
              || (select to_jsonb(l.*) from loose_scan l)
              || jsonb_build_object('active', (select list from out_active)),
  'out_by_material', (select to_jsonb(x.*) from out_by_mat x),
  'in_by_material',  (select to_jsonb(x.*) from in_by_mat x),
  'inbound',  (select to_jsonb(i.*) from inb i) || (select to_jsonb(p.*) from inb_pallets p),
  'weigh',    (select to_jsonb(w.*) from weigh w),
  'hourly',   coalesce((select jsonb_agg(to_jsonb(h.*) order by h.h) from hourly h), '[]'::jsonb)
);
$$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260729d_tms_orders_page_sort.sql
-- ───────────────────────────────────────────────────────────────────────
-- Thứ tự hiển thị lưới "Kế hoạch vận chuyển" (tab Kế hoạch) — chỉ thay tms_orders_page.
-- Trước: cụm xếp theo `date DESC, created_at` ⇒ trong 1 ngày là THỨ TỰ UPLOAD (file nào dòng nào
-- trước thì đứng trước) → Xuất/Nhập, loại kho, loại xe, ĐVVT trộn lẫn nhau, người đặt giờ phải
-- nhảy khắp bảng. Nay xếp theo cách người dùng LÀM VIỆC trên trang này:
--
--   1. Ngày GIẢM dần        — ngày gần nhất (mới nhất) nằm TRÊN, user chốt 29/07
--   2. Ưu tiên (UT = x)     — việc gấp luôn nằm đầu ngày
--   3. Hướng: Xuất → Nhập   — 2 luồng khác đội/khác cửa, không xen kẽ
--   4. Loại kho (A→Z)       — khung giờ ràng theo cargo_type ⇒ đơn cùng loại hàng đứng liền nhau
--   5. Loại xe (A→Z)        — khung giờ ràng theo vehicle_type ⇒ đặt được cả loạt trong 1 mạch
--   6. ĐVVT (A→Z)           — gọi 1 nhà vận tải là thấy hết xe của họ liền khối
--   7. Mã đơn (A→Z)         — giữ dãy số thứ tự của SAP trong cùng nhóm (dễ đối chiếu file)
--   8. created_at, id       — chốt hạ, bảo đảm thứ tự TẤT ĐỊNH (không đổi giữa 2 lần tải)
--
-- CỐ Ý KHÔNG xếp theo GIỜ ĐÃ ĐẶT: nếu xếp theo giờ thì mỗi lần đặt xong 1 xe, dòng đó NHẢY khỏi
-- chỗ đang làm (và phân trang server kéo dòng trang sau lên) — đúng lúc user đang đặt giờ hàng loạt.
-- Xem lịch theo giờ đã có nút "Xem booking" (tình trạng khung giờ) + filter Khung giờ.
--
-- STT xe đánh theo ĐÚNG các khóa trên (trên tập NỀN, chưa áp filter) để: (a) STT tăng dần theo
-- chiều đọc, (b) màu vằn xen kẽ theo cụm (FE: groupParity = stt % 2) không bị vón cục.

DROP FUNCTION IF EXISTS tms_orders_page(int, int, date, date, text, uuid, text[], text[], text[], uuid[], text[], text[], uuid[], boolean, boolean);
CREATE FUNCTION tms_orders_page(
  p_offset        int,                        -- bỏ qua bao nhiêu CỤM
  p_limit         int,                        -- lấy bao nhiêu CỤM
  p_date_from     date,
  p_date_to       date,
  p_warehouse_id  text    DEFAULT NULL,
  p_ncc_user      uuid    DEFAULT NULL,       -- user ĐVVT: chỉ thấy lệnh của công ty mình
  p_categories    text[]  DEFAULT NULL,       -- scope Loại kho (NULL = đủ quyền)
  p_scope_wh      text[]  DEFAULT NULL,       -- scope Kho    (NULL = đủ quyền)
  p_directions    text[]  DEFAULT NULL,       -- lọc Hướng
  p_dvvt          uuid[]  DEFAULT NULL,       -- lọc ĐVVT
  p_wh_types      text[]  DEFAULT NULL,       -- lọc Loại kho
  p_vehicle_types text[]  DEFAULT NULL,       -- lọc Loại xe
  p_slot_ids      uuid[]  DEFAULT NULL,       -- lọc Khung giờ
  p_unbooked      boolean DEFAULT false,      -- lọc Khung giờ = "Chưa đặt"
  p_with_stt      boolean DEFAULT true        -- false + p_limit lớn = chỉ lấy TẬP ID của bộ lọc
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH base AS (   -- PHẠM VI NỀN: ngày + kho + scope. CHƯA áp filter người dùng (STT/facet đọc ở đây).
    SELECT o.id, o.date, o.created_at, o.direction, o.ncc_id, o.warehouse_type, o.vehicle_type,
           o.priority, o.order_code
    FROM "TmsOrder" o
    WHERE o.date >= p_date_from AND o.date <= p_date_to
      AND o.source_type <> 'TRANSFER'
      AND (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id)
      AND (p_ncc_user     IS NULL OR o.ncc_id       = p_ncc_user)
      AND (p_scope_wh     IS NULL OR o.warehouse_id = ANY (p_scope_wh))
      AND (p_categories   IS NULL OR o.warehouse_type IS NULL OR o.warehouse_type = ANY (p_categories))
  ),
  skey AS (        -- KHÓA SẮP XẾP HIỂN THỊ của từng đơn — dùng CHUNG cho STT và cho xếp cụm
    SELECT b.id, b.date, b.created_at,
           COALESCE(b.priority, false)                             AS pri,
           (CASE WHEN b.direction = 'OUTBOUND' THEN 0 ELSE 1 END)   AS dir_rank,
           b.warehouse_type, b.vehicle_type, nc.name AS dvvt_name, b.order_code
    FROM base b LEFT JOIN "TransportCompany" nc ON nc.id = b.ncc_id
  ),
  bslots AS (      -- mọi slot của tập nền; đơn CHƯA có xe → 1 dòng ảo (slot_id NULL) để vẫn có STT
    SELECT b.id AS order_id, s.id AS slot_id, s.consolidation_group_id, s.is_consolidation_primary,
           b.date, b.created_at,
           row_number() OVER (PARTITION BY b.id ORDER BY s.created_at, s.id) - 1 AS slot_idx,
           (s.id IS NULL OR s.consolidation_group_id IS NULL OR s.is_consolidation_primary) AS numbered
    FROM base b LEFT JOIN "TmsVehicleSlot" s ON s.order_id = b.id
  ),
  sec_base AS (    -- đơn thứ cấp ĐÃ BỊ KÉO vào cụm của đơn chủ → KHÔNG có dòng xe riêng, KHÔNG có STT
    SELECT DISTINCT s.order_id
    FROM "TmsVehicleSlot" s
    JOIN "TmsVehicleSlot" p ON p.consolidation_group_id = s.consolidation_group_id AND p.is_consolidation_primary
    WHERE s.consolidation_group_id IS NOT NULL AND NOT s.is_consolidation_primary AND p.order_id <> s.order_id
      AND EXISTS (SELECT 1 FROM base b WHERE b.id = s.order_id)
      AND EXISTS (SELECT 1 FROM base b WHERE b.id = p.order_id)
  ),
  pick AS (        -- dòng được đánh STT: xe chính/độc lập; đơn TOÀN xe phụ mà đơn chủ KHÔNG có
                   -- trong tập (mồ côi) → vẫn 1 dòng riêng. Còn nếu đơn chủ có mặt thì đơn này là
                   -- DÒNG CON trong cụm ⇒ không đánh STT (đếm ở đây = đếm thừa xe).
    SELECT * FROM bslots WHERE numbered
    UNION ALL
    SELECT c.* FROM bslots c
    WHERE NOT c.numbered AND c.slot_idx = 0
      AND NOT EXISTS (SELECT 1 FROM bslots c2 WHERE c2.order_id = c.order_id AND c2.numbered)
      AND NOT EXISTS (SELECT 1 FROM sec_base sb WHERE sb.order_id = c.order_id)
  ),
  stt AS (         -- STT tăng dần theo ĐÚNG chiều đọc của lưới
    SELECT p.order_id, p.slot_id,
           row_number() OVER (ORDER BY k.date DESC, k.pri DESC, k.dir_rank,
                                       k.warehouse_type NULLS LAST, k.vehicle_type NULLS LAST,
                                       k.dvvt_name NULLS LAST, k.order_code NULLS LAST,
                                       k.created_at, p.order_id, p.slot_idx) AS n
    FROM pick p JOIN skey k ON k.id = p.order_id
  ),
  f AS (           -- ÁP FILTER NGƯỜI DÙNG (thứ tự khớp FE: hướng/ĐVVT/loại kho → loại xe → khung giờ)
    SELECT b.* FROM base b
    WHERE (p_directions IS NULL OR b.direction      = ANY (p_directions))
      AND (p_dvvt       IS NULL OR b.ncc_id         = ANY (p_dvvt))
      AND (p_wh_types   IS NULL OR b.warehouse_type = ANY (p_wh_types))
      -- Loại xe: khớp trực tiếp HOẶC đi GOM CHUNG XE với một đơn khớp (giữ nguyên cụm, không xé lẻ)
      AND (p_vehicle_types IS NULL OR b.vehicle_type = ANY (p_vehicle_types) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s
            JOIN "TmsVehicleSlot" s2 ON s2.consolidation_group_id = s.consolidation_group_id
            JOIN base d ON d.id = s2.order_id
            WHERE s.order_id = b.id AND s.consolidation_group_id IS NOT NULL
              AND d.vehicle_type = ANY (p_vehicle_types)
              AND (p_directions IS NULL OR d.direction      = ANY (p_directions))
              AND (p_dvvt       IS NULL OR d.ncc_id         = ANY (p_dvvt))
              AND (p_wh_types   IS NULL OR d.warehouse_type = ANY (p_wh_types))))
      AND ((p_slot_ids IS NULL AND NOT p_unbooked) OR EXISTS (
            SELECT 1 FROM "TmsVehicleSlot" s WHERE s.order_id = b.id
              AND ((p_unbooked AND s.slot_id IS NULL)
                OR (p_slot_ids IS NOT NULL AND s.slot_id = ANY (p_slot_ids)))))
  ),
  sec AS (         -- đơn thứ cấp → đơn CHỦ (chỉ khi đơn chủ cũng còn trong tập lọc)
    SELECT DISTINCT ON (s.order_id) s.order_id, p.order_id AS leader_id
    FROM "TmsVehicleSlot" s
    JOIN "TmsVehicleSlot" p ON p.consolidation_group_id = s.consolidation_group_id AND p.is_consolidation_primary
    WHERE s.consolidation_group_id IS NOT NULL AND NOT s.is_consolidation_primary
      AND p.order_id <> s.order_id
      AND EXISTS (SELECT 1 FROM f fs WHERE fs.id = s.order_id)
      AND EXISTS (SELECT 1 FROM f fp WHERE fp.id = p.order_id)
    ORDER BY s.order_id, s.created_at, s.id
  ),
  blk AS (         -- mỗi đơn thuộc ĐÚNG 1 cụm → cụm phân hoạch tập lọc, không đơn nào lọt 2 trang
    SELECT f.id, f.date, f.created_at, f.order_code, COALESCE(f.priority, false) AS pri,
           COALESCE(sec.leader_id, f.id) AS leader_id
    FROM f LEFT JOIN sec ON sec.order_id = f.id
  ),
  branked AS (     -- cụm xếp theo khóa của ĐƠN CHỦ; ưu tiên tính bool_or cả cụm (đơn gom gấp cũng kéo cụm lên)
    SELECT b.leader_id, count(*) AS n_orders,
           row_number() OVER (ORDER BY k.date DESC, bool_or(b.pri) DESC, k.dir_rank,
                                       k.warehouse_type NULLS LAST, k.vehicle_type NULLS LAST,
                                       k.dvvt_name NULLS LAST, k.order_code NULLS LAST,
                                       k.created_at, b.leader_id) AS brank
    FROM blk b JOIN skey k ON k.id = b.leader_id
    GROUP BY b.leader_id, k.date, k.dir_rank, k.warehouse_type, k.vehicle_type, k.dvvt_name,
             k.order_code, k.created_at
  ),
  win AS (
    SELECT * FROM branked WHERE brank > GREATEST(p_offset, 0) AND brank <= GREATEST(p_offset, 0) + GREATEST(p_limit, 0)
  ),
  page_ids AS (    -- thứ tự hiển thị: cụm theo brank; trong cụm: đơn chủ trước, rồi đơn gom theo mã đơn
    SELECT b.id, w.brank, (CASE WHEN b.id = b.leader_id THEN 0 ELSE 1 END) AS inblk,
           b.order_code, b.created_at
    FROM blk b JOIN win w ON w.leader_id = b.leader_id
  )
  SELECT jsonb_build_object(
    'ids',           COALESCE((SELECT jsonb_agg(id ORDER BY brank, inblk, order_code NULLS LAST, created_at, id) FROM page_ids), '[]'::jsonb),
    'total_orders',  (SELECT count(*) FROM f),
    'total_blocks',  (SELECT count(*) FROM branked),
    'page_from',     1 + COALESCE((SELECT sum(n_orders) FROM branked WHERE brank <= GREATEST(p_offset, 0)), 0),
    'page_orders',   (SELECT count(*) FROM page_ids),
    -- STT xe của riêng các đơn trong trang; khoá = "<order_id>/<slot_id>" (slot_id rỗng = đơn chưa có xe)
    'stt',           CASE WHEN p_with_stt THEN
                       COALESCE((SELECT jsonb_object_agg(order_id::text || '/' || COALESCE(slot_id::text, ''), n)
                                 FROM stt WHERE order_id IN (SELECT id FROM page_ids)), '{}'::jsonb)
                     ELSE '{}'::jsonb END
  ) INTO result;
  RETURN result;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260730_dashboard_stock_by_unit.sql
-- ───────────────────────────────────────────────────────────────────────
-- DASHBOARD: PALLET LÀM SỐ CHỦ ĐẠO + TỒN TÁCH THEO TỪNG ĐƠN VỊ (user chốt 30/07).
-- Bối cảnh: ô "Tồn (quy đổi)" là tổng TRỘN đơn vị (thùng TP + cái POSM + kg NVL...) — đo staging
-- 133,4tr thì 131,2tr là CÁI (ly/sticker), thùng thật chỉ 1,39tr → con số không trả lời được
-- "kho có bao nhiêu hàng". Hướng xử: Pallet (đơn vị vật lý so được giữa mọi loại hàng) lên tile
-- chủ đạo; tile "quy đổi" thay bằng BẢNG TÁCH THEO ĐƠN VỊ — xem được số riêng từng đơn vị khi cần.
--
-- File này CHỈ thêm khóa `by_unit` vào dashboard_stats (giữ nguyên inventory/today — không đổi
-- hành vi cũ; dashboard_all bọc dashboard_stats nên tự có theo). Nhóm theo ĐVT HIỂN THỊ của mã:
-- có entry_unit + units_per_carton>0 → entry_unit (số = base ÷ hệ số, "thùng quy đổi" per-mã);
-- không có → base_unit (số = base nguyên). Cùng công thức per-row với CTE `inv` ⇒
-- Σ by_unit.qty = Σ inv.cartons và Σ by_unit.pallets = Σ inv.pallets (bất biến — QA gói 07 kiểm).
--
-- ⚠️ PHỤ THUỘC: Material.entry_unit/units_per_carton (bộ base-unit 20260719+) — như 20260722.

CREATE OR REPLACE FUNCTION public.dashboard_stats(p_warehouse_ids text[] DEFAULT NULL::text[], p_categories text[] DEFAULT NULL::text[], p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
with inv as (
  select
    w.id                           as warehouse_id,
    w.name                         as warehouse_name,
    w.inventory_mode               as inventory_mode,
    coalesce(m.category, 'Khác')   as category,
    count(*)                       as pallets,
    coalesce(sum(ie.cartons_remaining / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as cartons,
    count(distinct ie.material_id) as materials
  from "InventoryEntry" ie
  join "Warehouse" w on w.id = ie.warehouse_id::text
  left join "Material" m on m.id = ie.material_id
  where ie.cartons_remaining > 0
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by w.id, w.name, w.inventory_mode, coalesce(m.category, 'Khác')
),
-- Tồn tách theo ĐƠN VỊ HIỂN THỊ — cùng phạm vi + cùng công thức quy đổi với `inv`
by_unit as (
  select
    case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0
         then m.entry_unit else coalesce(m.base_unit, 'CAR') end as unit,
    count(*)                       as pallets,
    coalesce(sum(ie.cartons_remaining / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as qty,
    count(distinct ie.material_id) as materials
  from "InventoryEntry" ie
  join "Warehouse" w on w.id = ie.warehouse_id::text
  left join "Material" m on m.id = ie.material_id
  where ie.cartons_remaining > 0
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by 1
),
tin as (
  select count(*) as inbound_orders
  from "ProductionImport" pi
  where pi.import_date::date = p_today
    and (p_warehouse_ids is null or pi.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or pi.warehouse_type is null or pi.warehouse_type = any(p_categories))
),
tin_cartons as (
  select coalesce(sum(ie.cartons_imported / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as inbound_cartons
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date::date = p_today
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
),
tout as (
  select
    count(distinct g.id)                   as outbound_gdos,
    coalesce(sum(oi.cartons_ordered / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as outbound_planned,
    coalesce(sum(oi.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as outbound_scanned
  from "GroupDeliveryOrder" g
  left join "OutboundDelivery" d on d.gdo_id = g.id
  left join "OutboundItem" oi on oi.do_id = d.id
  left join "Material" m on m.id = oi.material_id
  where g.delivery_date = p_today
    and g.status <> 'CANCELLED'
    and (p_warehouse_ids is null or g.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or g.warehouse_type is null or g.warehouse_type = any(p_categories))
)
select jsonb_build_object(
  'inventory', coalesce(
    (select jsonb_agg(to_jsonb(inv.*) order by inv.warehouse_name, inv.category) from inv),
    '[]'::jsonb
  ),
  'by_unit', coalesce(
    (select jsonb_agg(to_jsonb(b.*) order by b.qty desc) from by_unit b),
    '[]'::jsonb
  ),
  'today', (
    select to_jsonb(t.*) || to_jsonb(tc.*) || to_jsonb(o.*)
    from tin t, tin_cartons tc, tout o
  )
);
$function$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260730b_gdo_multi_category_scope.sql
-- ───────────────────────────────────────────────────────────────────────
-- 2026-07-30 — LOẠI KHO GHÉP trên 1 chuyến ("FG01+PM01") phải LỌT bộ lọc phân quyền
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- BUG THẬT (user báo 30/07): chuyến 20000016_X_290726_108 chở LẪN thành phẩm + POSM nên
-- GroupDeliveryOrder.warehouse_type lưu chuỗi GHÉP 'FG01+PM01' (upload KH xuất: loaiKhoSet.join('+')).
-- Mọi bộ lọc lại so khớp NGUYÊN CHUỖI (`= ANY(p_categories)`) với các giá trị ĐƠN → không khớp
-- → chuyến BIẾN MẤT khỏi danh sách của MỌI user có scope loại (kể cả người có ĐỦ CẢ HAI loại).
-- Đo trên staging: 67/122 chuyến toàn hệ; riêng Kho Ba Vì 32/58 chuyến bị ẩn oan.
--
-- LUẬT (user chốt 30/07): "xe ghép chung thì phải ĐƯỢC THẤY" ⇒ GIAO ≥1 loại là thấy.
-- Cách làm: helper wt_cats() tách chuỗi ghép thành mảng, mọi chỗ đổi `= ANY` → `&&` (overlap).
-- Giữ nguyên nhánh `warehouse_type IS NULL` (bản ghi chưa khai loại vẫn hiện — null-inclusive).
--
-- Phạm vi: 8 RPC đang đọc GroupDeliveryOrder.warehouse_type (định nghĩa lấy TỪ DB đang chạy,
-- chỉ thay đúng biểu thức so khớp — phần còn lại giữ nguyên 100%).
-- Bảng khác (TmsOrder / ProductionImport / gate_registrations / inbound_plan_lines) KHÔNG có
-- giá trị ghép (đã đếm: 0 dòng) nên KHÔNG đụng tới.

-- ── Helper DUY NHẤT tách loại ghép. Sửa quy tắc tách = sửa 1 chỗ này. ──
-- 'FG01+PM01' → {FG01,PM01} · 'FG01' → {FG01} · NULL/'' → NULL (để nhánh IS NULL vẫn đúng)
CREATE OR REPLACE FUNCTION public.wt_cats(p_raw text) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(ARRAY(
    SELECT btrim(x) FROM unnest(string_to_array(COALESCE(p_raw, ''), '+')) x WHERE btrim(x) <> ''
  ), '{}'::text[])
$$;
REVOKE ALL ON FUNCTION public.wt_cats(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wt_cats(text) TO service_role;

-- ── control_tower_stats ──
CREATE OR REPLACE FUNCTION public.control_tower_stats(p_warehouse_ids text[] DEFAULT NULL::text[], p_categories text[] DEFAULT NULL::text[], p_today date DEFAULT NULL::date, p_material_codes text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
with day_range as (
  select ((p_today::timestamp at time zone 'Asia/Ho_Chi_Minh') at time zone 'UTC')       as t0,
         (((p_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') at time zone 'UTC') as t1
),
gdo_today as (
  select g.id, g.group_code, g.status, g.license_plate, g.started_at, g.warehouse_id, g.warehouse_type
  from "GroupDeliveryOrder" g
  where g.delivery_date = p_today and g.status <> 'CANCELLED'
    and (p_warehouse_ids is null or g.warehouse_id is null or g.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or g.warehouse_type is null or wt_cats(g.warehouse_type) && p_categories)
),
gate as (
  select
    count(*) filter (where status = 'REGISTERED') as registered,
    count(*) filter (where status = 'CALLED')     as called,
    count(*) filter (where status = 'IN')         as inside,
    count(*) filter (where status = 'COMPLETED')  as completed
  from gate_registrations g
  where g.date = p_today
    and (p_warehouse_ids is null or g.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or g.warehouse_type is null or wt_cats(g.warehouse_type) && p_categories)
),
gate_inside as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'plate', s.license_plate, 'company', s.company_name_raw, 'direction', s.direction,
    'entry_at', s.entry_at, 'warehouse_name', w.name, 'content', s.content,
    'warehouse_type', s.warehouse_type, 'vehicle_type', s.vehicle_type
  ) order by s.entry_at), '[]'::jsonb) as list
  from (
    select g.* from gate_registrations g
    where g.date = p_today and g.status = 'IN'
      and (p_warehouse_ids is null or g.warehouse_id = any(p_warehouse_ids))
      and (p_categories is null or g.warehouse_type is null or wt_cats(g.warehouse_type) && p_categories)
    order by g.entry_at limit 40
  ) s left join "Warehouse" w on w.id = s.warehouse_id
),
out_gdo as (
  select
    count(*) filter (where status = 'PENDING')     as pending,
    count(*) filter (where status = 'IN_PROGRESS') as in_progress,
    count(*) filter (where status = 'PAUSED')      as paused,
    count(*) filter (where status = 'COMPLETED')   as completed,
    count(*)                                       as total
  from gdo_today
),
out_cartons as (
  select coalesce(sum(oi.cartons_ordered / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as planned,
         coalesce(sum(oi.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as scanned,
         coalesce(sum(oi.loose_picking   / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as loose_planned
  from gdo_today g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi on oi.do_id = d.id
  left join "Material" m on m.id = oi.material_id
),
loose_scan as (
  select coalesce(sum(ose.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as loose_scanned
  from gdo_today g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi on oi.do_id = d.id
  join "OutboundScanEntry" ose on ose.item_id = oi.id
  left join "Material" m on m.id = oi.material_id
  where ose.is_loose_picking
),
out_mat_rows as (
  select coalesce(m.material_code, oi.material_code_raw, '—') as code,
         coalesce(m.short_name, oi.material_code_raw, '—')    as name,
         coalesce(m.category, 'Khác')                         as category,
         sum(oi.cartons_ordered / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)) as ordered,
         sum(oi.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)) as scanned,
         sum(oi.loose_picking   / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)) as loose
  from gdo_today g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi on oi.do_id = d.id
  left join "Material" m on m.id = oi.material_id
  where (p_material_codes is null
         or coalesce(m.material_code, oi.material_code_raw) = any(p_material_codes))
  group by 1, 2, 3
),
out_by_mat as (
  select
    (select count(*) from out_mat_rows)                                          as n_materials,
    (select count(*) from out_mat_rows where scanned >= ordered and ordered > 0) as n_done,
    (select count(*) from out_mat_rows where scanned < ordered)                  as n_short,
    coalesce((select jsonb_agg(to_jsonb(t.*) order by (t.ordered - t.scanned) desc, t.ordered desc)
      from (select * from out_mat_rows order by (ordered - scanned) desc, ordered desc limit 30) t), '[]'::jsonb) as list
),
in_mat_rows as (
  select coalesce(m.material_code, '—') as code,
         coalesce(m.short_name, '—')    as name,
         coalesce(m.category, 'Khác')   as category,
         -- Đơn vị THẬT của số ở cột SL: mã có quy cách thùng → entry_unit (số là thùng quy đổi);
         -- mã không quy cách → base_unit (số là base thô: EA/KG) — FE in kèm để không đọc nhầm.
         case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0
              then m.entry_unit else m.base_unit end as unit,
         count(*)                              as pallets,
         coalesce(sum(ie.cartons_imported / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as cartons
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date::date = p_today
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
    and (p_material_codes is null or m.material_code = any(p_material_codes))
  group by 1, 2, 3, 4
),
in_by_mat as (
  select
    (select count(*) from in_mat_rows) as n_materials,
    coalesce((select jsonb_agg(to_jsonb(t.*) order by t.cartons desc)
      from (select * from in_mat_rows order by cartons desc limit 30) t), '[]'::jsonb) as list
),
out_active as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'group_code', t.group_code, 'status', t.status, 'plate', t.license_plate,
    'warehouse_name', t.wname, 'planned', t.planned, 'scanned', t.scanned, 'started_at', t.started_at,
    'npp', t.npp, 'n_materials', t.n_mats,
    'warehouse_type', t.warehouse_type, 'export_type', t.export_type
  ) order by t.started_at desc nulls last), '[]'::jsonb) as list
  from (
    select g.id, g.group_code, g.status, g.license_plate, g.started_at, g.warehouse_type, w.name as wname,
           coalesce(sum(oi.cartons_ordered / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as planned,
           coalesce(sum(oi.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as scanned,
           string_agg(distinct d.distributor_name, ', ')            as npp,
           string_agg(distinct oi.export_type, ', ')                as export_type,
           count(distinct coalesce(oi.material_id, oi.material_code_raw)) as n_mats
    from gdo_today g
    left join "Warehouse" w on w.id = g.warehouse_id
    left join "OutboundDelivery" d on d.gdo_id = g.id
    left join "OutboundItem" oi on oi.do_id = d.id
    left join "Material" m on m.id = oi.material_id
    where g.status in ('IN_PROGRESS', 'PAUSED')
    group by g.id, g.group_code, g.status, g.license_plate, g.started_at, g.warehouse_type, w.name
    order by g.started_at desc nulls last limit 40
  ) t
),
inb as (
  select count(*) as orders
  from "ProductionImport" pi
  where pi.import_date::date = p_today
    and (p_warehouse_ids is null or pi.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or pi.warehouse_type is null or pi.warehouse_type = any(p_categories))
),
inb_pallets as (
  select count(*) as pallets,
         coalesce(sum(ie.cartons_imported / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as cartons
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date::date = p_today
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    -- FIX 29/07: thiếu dòng này → ô "Pallet nhập" đếm CẢ loại kho không được chọn
    and (p_categories is null or m.category is null or m.category = any(p_categories))
),
weigh as (
  select count(*)                                                  as tickets,
         count(*) filter (where not wt.is_complete)                as pending2,
         coalesce(sum(wt.net_kg) filter (where wt.is_complete), 0) as net_kg
  from "WeighTicket" wt
  where wt.weigh_date = p_today
    and (p_warehouse_ids is null or wt.warehouse_id is null or wt.warehouse_id = any(p_warehouse_ids))
),
hourly_out as (
  select extract(hour from (ose.scanned_at at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh'))::int as h,
         count(*) as scans,
         coalesce(sum(ose.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as cartons
  from "OutboundScanEntry" ose
  join "OutboundItem" oi on oi.id = ose.item_id
  join "OutboundDelivery" d on d.id = oi.do_id
  join "GroupDeliveryOrder" g on g.id = d.gdo_id
  left join "Material" m on m.id = oi.material_id
  cross join day_range r
  where ose.scanned_at >= r.t0 and ose.scanned_at < r.t1
    and (p_warehouse_ids is null or g.warehouse_id is null or g.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or g.warehouse_type is null or wt_cats(g.warehouse_type) && p_categories)
  group by 1
),
hourly_in as (
  select extract(hour from (ie.created_at at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh'))::int as h,
         count(*) as pallets
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id     -- FIX 29/07: để lọc được Loại kho
  cross join day_range r
  where ie.created_at >= r.t0 and ie.created_at < r.t1
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by 1
),
hourly as (
  select coalesce(o.h, i.h) as h,
         coalesce(o.cartons, 0) as out_cartons,
         coalesce(o.scans, 0)   as out_scans,
         coalesce(i.pallets, 0) as in_pallets
  from hourly_out o full outer join hourly_in i on i.h = o.h
)
select jsonb_build_object(
  'gate',     (select to_jsonb(g.*) from gate g) || jsonb_build_object('inside_list', (select list from gate_inside)),
  'outbound', (select to_jsonb(o.*) from out_gdo o) || (select to_jsonb(c.*) from out_cartons c)
              || (select to_jsonb(l.*) from loose_scan l)
              || jsonb_build_object('active', (select list from out_active)),
  'out_by_material', (select to_jsonb(x.*) from out_by_mat x),
  'in_by_material',  (select to_jsonb(x.*) from in_by_mat x),
  'inbound',  (select to_jsonb(i.*) from inb i) || (select to_jsonb(p.*) from inb_pallets p),
  'weigh',    (select to_jsonb(w.*) from weigh w),
  'hourly',   coalesce((select jsonb_agg(to_jsonb(h.*) order by h.h) from hourly h), '[]'::jsonb)
);
$function$;

-- ── dashboard_stats ──
CREATE OR REPLACE FUNCTION public.dashboard_stats(p_warehouse_ids text[] DEFAULT NULL::text[], p_categories text[] DEFAULT NULL::text[], p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
with inv as (
  select
    w.id                           as warehouse_id,
    w.name                         as warehouse_name,
    w.inventory_mode               as inventory_mode,
    coalesce(m.category, 'Khác')   as category,
    count(*)                       as pallets,
    coalesce(sum(ie.cartons_remaining / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as cartons,
    count(distinct ie.material_id) as materials
  from "InventoryEntry" ie
  join "Warehouse" w on w.id = ie.warehouse_id::text
  left join "Material" m on m.id = ie.material_id
  where ie.cartons_remaining > 0
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by w.id, w.name, w.inventory_mode, coalesce(m.category, 'Khác')
),
-- Tồn tách theo ĐƠN VỊ HIỂN THỊ — cùng phạm vi + cùng công thức quy đổi với `inv`
by_unit as (
  select
    case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0
         then m.entry_unit else coalesce(m.base_unit, 'CAR') end as unit,
    count(*)                       as pallets,
    coalesce(sum(ie.cartons_remaining / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as qty,
    count(distinct ie.material_id) as materials
  from "InventoryEntry" ie
  join "Warehouse" w on w.id = ie.warehouse_id::text
  left join "Material" m on m.id = ie.material_id
  where ie.cartons_remaining > 0
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by 1
),
tin as (
  select count(*) as inbound_orders
  from "ProductionImport" pi
  where pi.import_date::date = p_today
    and (p_warehouse_ids is null or pi.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or pi.warehouse_type is null or pi.warehouse_type = any(p_categories))
),
tin_cartons as (
  select coalesce(sum(ie.cartons_imported / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as inbound_cartons
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date::date = p_today
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
),
tout as (
  select
    count(distinct g.id)                   as outbound_gdos,
    coalesce(sum(oi.cartons_ordered / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as outbound_planned,
    coalesce(sum(oi.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as outbound_scanned
  from "GroupDeliveryOrder" g
  left join "OutboundDelivery" d on d.gdo_id = g.id
  left join "OutboundItem" oi on oi.do_id = d.id
  left join "Material" m on m.id = oi.material_id
  where g.delivery_date = p_today
    and g.status <> 'CANCELLED'
    and (p_warehouse_ids is null or g.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or g.warehouse_type is null or wt_cats(g.warehouse_type) && p_categories)
)
select jsonb_build_object(
  'inventory', coalesce(
    (select jsonb_agg(to_jsonb(inv.*) order by inv.warehouse_name, inv.category) from inv),
    '[]'::jsonb
  ),
  'by_unit', coalesce(
    (select jsonb_agg(to_jsonb(b.*) order by b.qty desc) from by_unit b),
    '[]'::jsonb
  ),
  'today', (
    select to_jsonb(t.*) || to_jsonb(tc.*) || to_jsonb(o.*)
    from tin t, tin_cartons tc, tout o
  )
);
$function$;

-- ── loose_picking_facets ──
CREATE OR REPLACE FUNCTION public.loose_picking_facets(p_wh_scope text[], p_cat_scope text[], p_warehouse_id text, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
  RETURN (
    WITH j AS (
      SELECT DISTINCT g.id, i.export_type, g.dvvt, g.warehouse_type, d.distributor_name
      FROM "OutboundItem" i
      JOIN "OutboundDelivery"   d ON d.id = i.do_id
      JOIN "GroupDeliveryOrder" g ON g.id = d.gdo_id AND g.status <> 'CANCELLED'
      WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
        AND (p_from IS NULL OR g.delivery_date >= p_from)
        AND (p_to   IS NULL OR g.delivery_date <= p_to)
        AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
        AND (p_wh_scope  IS NULL OR g.warehouse_id = ANY (p_wh_scope))
        AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR wt_cats(g.warehouse_type) && p_cat_scope)
    )
    SELECT jsonb_build_object(
      'dvvts',        COALESCE((SELECT jsonb_agg(DISTINCT dvvt)             FROM j WHERE dvvt IS NOT NULL), '[]'::jsonb),
      'npps',         COALESCE((SELECT jsonb_agg(DISTINCT distributor_name) FROM j WHERE distributor_name IS NOT NULL), '[]'::jsonb),
      'wh_types',     COALESCE((SELECT jsonb_agg(DISTINCT c) FROM j, LATERAL unnest(wt_cats(j.warehouse_type)) c), '[]'::jsonb),
      'export_types', COALESCE((SELECT jsonb_agg(DISTINCT export_type)      FROM j WHERE export_type IS NOT NULL), '[]'::jsonb)
    )
  );
END $function$;

-- ── loose_picking_page ──
CREATE OR REPLACE FUNCTION public.loose_picking_page(p_wh_scope text[], p_cat_scope text[], p_warehouse_id text, p_from date, p_to date, p_wh_types text[], p_export_types text[], p_dvvts text[], p_npps text[], p_search text, p_offset integer, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE r jsonb; s text;
BEGIN
  s := CASE WHEN p_search IS NULL OR btrim(p_search) = '' THEN NULL
            ELSE lower(immutable_unaccent(btrim(p_search))) END;

  WITH it AS (
    SELECT i.id, i.do_id, i.material_id, i.material_code_raw,
           i.cartons_ordered, i.cartons_scanned, i.loose_picking, i.export_type
    FROM "OutboundItem" i
    WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
  ),
  j AS (
    SELECT it.*, d.gdo_id, d.distributor_name,
           g.group_code, g.dvvt, g.warehouse_type, g.delivery_date,
           m.entry_unit, m.units_per_carton, m.short_name, m.material_code,
           COALESCE(ls.done, 0) AS loose_scanned
    FROM it
    JOIN "OutboundDelivery"    d ON d.id = it.do_id
    JOIN "GroupDeliveryOrder"  g ON g.id = d.gdo_id AND g.status <> 'CANCELLED'
    LEFT JOIN "Material"       m ON m.id = it.material_id
    LEFT JOIN LATERAL (
      SELECT sum(se.cartons_scanned) AS done
      FROM "OutboundScanEntry" se
      WHERE se.item_id = it.id AND se.is_loose_picking
    ) ls ON TRUE
    WHERE (p_from IS NULL OR g.delivery_date >= p_from)
      AND (p_to   IS NULL OR g.delivery_date <= p_to)
      AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
      AND (p_wh_scope  IS NULL OR g.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR wt_cats(g.warehouse_type) && p_cat_scope)
  ),
  st AS (
    SELECT j.*,
           GREATEST(0, loose_picking
                       - GREATEST(0, (cartons_scanned - loose_scanned)
                                     - (cartons_ordered - loose_picking))) AS effective
    FROM j
  ),
  st2 AS (
    SELECT st.*, LEAST(loose_scanned, effective) AS done FROM st
  ),
  gg AS (
    SELECT gdo_id,
           max(group_code)     AS group_code,
           max(delivery_date)  AS delivery_date,
           count(*)            AS items_n,
           count(*) FILTER (WHERE effective - done > 0) AS pending_n,
           sum(qty_entry_decimal(effective, entry_unit, units_per_carton)) AS loose_total,
           sum(qty_entry_decimal(done,      entry_unit, units_per_carton)) AS loose_done,
           max(export_type)    AS export_type,
           max(dvvt)           AS dvvt,
           max(warehouse_type) AS warehouse_type,
           array_agg(DISTINCT distributor_name) FILTER (WHERE distributor_name IS NOT NULL) AS npps,
           lower(immutable_unaccent(
             concat_ws(' ', max(group_code), max(export_type), max(dvvt),
                            string_agg(DISTINCT distributor_name, ' '),
                            string_agg(DISTINCT COALESCE(material_code, material_code_raw), ' '),
                            string_agg(DISTINCT short_name, ' ')))) AS hay
    FROM st2 GROUP BY gdo_id
  ),
  f AS (
    SELECT * FROM gg
    WHERE (p_wh_types     IS NULL OR wt_cats(warehouse_type) && p_wh_types)
      AND (p_export_types IS NULL OR export_type    = ANY (p_export_types))
      AND (p_dvvts        IS NULL OR dvvt           = ANY (p_dvvts))
      AND (p_npps         IS NULL OR npps && p_npps)
      AND (s IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(string_to_array(s, ' ')) t
            WHERE t <> '' AND position(t IN hay) = 0))
  ),
  pg AS (
    SELECT gdo_id FROM f ORDER BY delivery_date, group_code, gdo_id OFFSET p_offset LIMIT p_limit
  ),
  -- gdo object dựng MỘT LẦN per chuyến (mirror payload controller cũ: gdo + warehouse embed +
  -- distributor_names từ MỌI delivery của chuyến + export_type = item nhặt lẻ ĐẦU TIÊN có khai)
  gdoj AS (
    SELECT pg.gdo_id,
           jsonb_build_object(
             'id', g.id, 'group_code', g.group_code, 'delivery_date', g.delivery_date,
             'planned_date', g.planned_date, 'status', g.status, 'started_at', g.started_at,
             'dvvt', g.dvvt, 'warehouse_type', g.warehouse_type,
             'warehouse', CASE WHEN w.id IS NULL THEN NULL ELSE
               jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name) END,
             'distributor_names', COALESCE((
               SELECT jsonb_agg(DISTINCT d2.distributor_name)
               FROM "OutboundDelivery" d2
               WHERE d2.gdo_id = g.id AND d2.distributor_name IS NOT NULL), '[]'::jsonb),
             'export_type', (
               SELECT i2.export_type
               FROM "OutboundDelivery" d3 JOIN "OutboundItem" i2 ON i2.do_id = d3.id
               WHERE d3.gdo_id = g.id AND i2.loose_picking > 0 AND i2.status <> 'CANCELLED'
                 AND i2.export_type IS NOT NULL
               ORDER BY i2.id LIMIT 1)
           ) AS gdo
    FROM pg
    JOIN "GroupDeliveryOrder" g ON g.id = pg.gdo_id
    LEFT JOIN "Warehouse" w ON w.id = g.warehouse_id
  )
  SELECT jsonb_build_object(
    'gdo_ids',     COALESCE((SELECT jsonb_agg(gdo_id) FROM pg), '[]'::jsonb),
    -- MỚI: item đầy đủ (to_jsonb toàn bộ cột như select '*' cũ) + material + gdo + loose_scanned
    'items',       COALESCE((
      SELECT jsonb_agg(to_jsonb(i)
               || jsonb_build_object(
                    'material', CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object(
                      'id', m.id, 'material_code', m.material_code, 'short_name', m.short_name,
                      'base_unit', m.base_unit, 'entry_unit', m.entry_unit,
                      'units_per_carton', m.units_per_carton) END,
                    'gdo', gdoj.gdo,
                    'loose_scanned', COALESCE(ls.done, 0))
               ORDER BY i.id)
      FROM gdoj
      JOIN "OutboundDelivery" d ON d.gdo_id = gdoj.gdo_id
      JOIN "OutboundItem" i ON i.do_id = d.id AND i.loose_picking > 0 AND i.status <> 'CANCELLED'
      LEFT JOIN "Material" m ON m.id = i.material_id
      LEFT JOIN LATERAL (
        SELECT sum(se.cartons_scanned) AS done
        FROM "OutboundScanEntry" se
        WHERE se.item_id = i.id AND se.is_loose_picking
      ) ls ON TRUE), '[]'::jsonb),
    'total',       (SELECT count(*)                FROM f),
    'items_n',     (SELECT COALESCE(sum(items_n), 0)     FROM f),
    'pending_n',   (SELECT COALESCE(sum(pending_n), 0)   FROM f),
    'loose_total', (SELECT COALESCE(sum(loose_total), 0)  FROM f),
    'loose_done',  (SELECT COALESCE(sum(loose_done), 0)   FROM f)
  ) INTO r;
  RETURN r;
END $function$;

-- ── outbound_gdos_facets ──
CREATE OR REPLACE FUNCTION public.outbound_gdos_facets(p_warehouse_ids text[] DEFAULT NULL::text[], p_scope_categories text[] DEFAULT NULL::text[], p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE result jsonb;
BEGIN
  WITH g AS (
    SELECT gd.id, gd.dvvt, gd.warehouse_type, gd.status, gd.assigned_at
    FROM "GroupDeliveryOrder" gd
    WHERE (p_warehouse_ids IS NULL OR gd.warehouse_id = ANY (p_warehouse_ids))
      AND (p_scope_categories IS NULL OR gd.warehouse_type IS NULL
           OR wt_cats(gd.warehouse_type) && p_scope_categories)
      AND (p_date_from IS NULL OR gd.delivery_date >= p_date_from)
      AND (p_date_to   IS NULL OR gd.delivery_date <= p_date_to)
  ),
  it AS (
    SELECT DISTINCT i.export_type, i.material_code_raw, m.short_name, d.distributor_name
    FROM g
    JOIN "OutboundDelivery" d ON d.gdo_id = g.id
    JOIN "OutboundItem" i     ON i.do_id  = d.id
    LEFT JOIN "Material" m    ON m.id     = i.material_id
  )
  SELECT jsonb_build_object(
    'export_types',    COALESCE((SELECT jsonb_agg(DISTINCT export_type) FROM it WHERE export_type IS NOT NULL AND export_type <> ''), '[]'::jsonb),
    'dvvts',           COALESCE((SELECT jsonb_agg(DISTINCT dvvt) FROM g WHERE dvvt IS NOT NULL AND dvvt <> ''), '[]'::jsonb),
    'warehouse_types', COALESCE((SELECT jsonb_agg(DISTINCT c) FROM g, LATERAL unnest(wt_cats(g.warehouse_type)) c), '[]'::jsonb),
    'npps',            COALESCE((SELECT jsonb_agg(DISTINCT distributor_name) FROM it WHERE distributor_name IS NOT NULL AND distributor_name <> ''), '[]'::jsonb),
    'status_labels',   COALESCE((SELECT jsonb_agg(DISTINCT lbl) FROM (
                          SELECT gdo_status_label(status, assigned_at) AS lbl FROM g) s
                          WHERE lbl <> '—'), '[]'::jsonb),
    'materials',       COALESCE((SELECT jsonb_agg(jsonb_build_object('value', material_code_raw,
                          'label', CASE WHEN short_name IS NOT NULL AND short_name <> ''
                                        THEN material_code_raw || ' · ' || short_name
                                        ELSE material_code_raw END) ORDER BY material_code_raw)
                          FROM (SELECT DISTINCT ON (material_code_raw) material_code_raw, short_name
                                  FROM it WHERE material_code_raw IS NOT NULL AND material_code_raw <> ''
                                 ORDER BY material_code_raw, short_name NULLS LAST) mm), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$function$;

-- ── outbound_gdos_page ──
CREATE OR REPLACE FUNCTION public.outbound_gdos_page(p_offset integer, p_limit integer, p_warehouse_ids text[] DEFAULT NULL::text[], p_scope_categories text[] DEFAULT NULL::text[], p_warehouse_types text[] DEFAULT NULL::text[], p_status text DEFAULT NULL::text, p_transfer_status text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_export_types text[] DEFAULT NULL::text[], p_dvvts text[] DEFAULT NULL::text[], p_npps text[] DEFAULT NULL::text[], p_material_codes text[] DEFAULT NULL::text[], p_status_labels text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_search_gdo_ids text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE result jsonb;
BEGIN
  WITH f AS (
    SELECT g.id, g.delivery_date, g.group_code, g.gate_registration_id, g.license_plate
    FROM "GroupDeliveryOrder" g
    WHERE (p_warehouse_ids IS NULL OR g.warehouse_id = ANY (p_warehouse_ids))
      AND (p_scope_categories IS NULL OR g.warehouse_type IS NULL
           OR wt_cats(g.warehouse_type) && p_scope_categories)
      AND (p_warehouse_types  IS NULL OR wt_cats(g.warehouse_type) && p_warehouse_types)
      AND (p_status           IS NULL OR g.status = p_status)
      AND (p_transfer_status  IS NULL OR g.transfer_status = p_transfer_status)
      AND (p_date_from        IS NULL OR g.delivery_date >= p_date_from)
      AND (p_date_to          IS NULL OR g.delivery_date <= p_date_to)
      AND (p_dvvts            IS NULL OR g.dvvt = ANY (p_dvvts))
      AND (p_status_labels    IS NULL OR gdo_status_label(g.status, g.assigned_at) = ANY (p_status_labels))
      AND (p_npps IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d
            WHERE d.gdo_id = g.id AND d.distributor_name = ANY (p_npps)))
      AND (p_export_types IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
            WHERE d.gdo_id = g.id AND i.export_type = ANY (p_export_types)))
      AND (p_material_codes IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
            WHERE d.gdo_id = g.id AND i.material_code_raw = ANY (p_material_codes)))
      AND (p_search IS NULL
           OR g.group_code ILIKE '%' || p_search || '%'
           OR g.id = ANY (COALESCE(p_search_gdo_ids, ARRAY[]::text[])))
  ),
  -- export_type (= item ĐẦU TIÊN theo id có khai) chỉ cần cho SẮP XẾP.
  -- Gom MỘT LƯỢT bằng DISTINCT ON, KHÔNG dùng LATERAL per-row: LATERAL chạy 1 truy vấn con cho
  -- MỖI chuyến khớp lọc (đo 28/07: 50k chuyến → ~0,9s chỉ để lấy khoá sắp xếp).
  et AS (
    SELECT DISTINCT ON (d.gdo_id) d.gdo_id, i.export_type
    FROM f
    JOIN "OutboundDelivery" d ON d.gdo_id = f.id
    JOIN "OutboundItem" i     ON i.do_id  = d.id
    WHERE i.export_type IS NOT NULL
    ORDER BY d.gdo_id, i.id
  ),
  s AS (
    SELECT f.id, f.delivery_date, f.group_code,
           CASE WHEN f.gate_registration_id IS NOT NULL THEN 'gate:' || f.gate_registration_id::text
                WHEN NULLIF(btrim(COALESCE(f.license_plate, '')), '') IS NOT NULL
                  THEN 'plate:' || upper(btrim(f.license_plate))
                ELSE NULL END AS grp,
           et.export_type,
           COALESCE(NULLIF(substring(f.group_code from '(\d+)$'), '')::bigint, 0) AS code_num
    FROM f LEFT JOIN et ON et.gdo_id = f.id
  ),
  -- `count(*) OVER ()` lấy TỔNG trong CÙNG lần quét (window tính trước LIMIT) — trước đây
  -- `(SELECT count(*) FROM f)` riêng khiến CTE f bị tham chiếu 2 lần ⇒ vật chất hoá + quét lại.
  pg AS (
    SELECT id, count(*) OVER () AS total, row_number() OVER (
             ORDER BY delivery_date DESC, (grp IS NULL), COALESCE(grp, ''),
                      COALESCE(export_type, '') DESC, code_num, group_code) AS rn
    FROM s
    ORDER BY delivery_date DESC, (grp IS NULL), COALESCE(grp, ''),
             COALESCE(export_type, '') DESC, code_num, group_code
    LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    -- pg rỗng (trang vượt tầm / không kết quả) → phải đếm lại, nhưng đó là trường hợp hiếm
    'total', COALESCE((SELECT max(total) FROM pg), (SELECT count(*) FROM s)),
    'ids',   COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$function$;

-- ── outbound_gdos_summary ──
CREATE OR REPLACE FUNCTION public.outbound_gdos_summary(p_warehouse_ids text[] DEFAULT NULL::text[], p_scope_categories text[] DEFAULT NULL::text[], p_warehouse_types text[] DEFAULT NULL::text[], p_status text DEFAULT NULL::text, p_transfer_status text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_export_types text[] DEFAULT NULL::text[], p_dvvts text[] DEFAULT NULL::text[], p_npps text[] DEFAULT NULL::text[], p_material_codes text[] DEFAULT NULL::text[], p_status_labels text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_search_gdo_ids text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  result  jsonb;
  n_items bigint;
  -- Trần AN TOÀN cho phép tính tổng. Căn cứ đo 28/07 (50.000 chuyến / 200.000 dòng hàng):
  -- tính tổng ~800ms, ĐẾM dòng chỉ ~160ms; role `authenticator` của PostgREST có
  -- statement_timeout = 8s CỐ ĐỊNH ⇒ 12 người cùng quét toàn bộ kho × 90 ngày thì 10/24
  -- request bị huỷ → 500 trắng màn.
  -- Trần tính theo SỐ DÒNG HÀNG (không phải số chuyến): chi phí tỉ lệ với dòng hàng, mà mỗi
  -- chuyến có thể 2 hay 50 dòng — đặt trần theo chuyến sẽ vừa chặn oan vừa lọt.
  -- Vượt trần: vẫn trả SỐ CHUYẾN (đếm rẻ) + cờ too_wide để FE hiện "—" kèm hướng dẫn thu hẹp;
  -- KHÔNG tính tổng, KHÔNG để user nhận lỗi. Danh sách vẫn lật trang bình thường.
  -- 150k dòng ≈ 0,6s tính tổng. Đo thật: 1 THÁNG toàn bộ 40 kho = 69k dòng (có tổng, ~0,6s);
  -- 3 THÁNG toàn bộ 40 kho = 200k dòng (vượt trần → hiện số chuyến + hướng dẫn thu hẹp).
  -- Lọc 1 kho thì cả năm vẫn dưới trần ⇒ người vận hành bình thường KHÔNG bao giờ chạm.
  MAX_ITEMS_FOR_TOTALS constant bigint := 150000;
BEGIN
  -- Đếm trước SỐ DÒNG HÀNG (join index-only, ~160ms/200k — rẻ hơn 5 lần so với tính tổng).
  -- KHÔNG dùng count(DISTINCT gd.id): distinct trên bảng join là phép SORT/HASH đắt, chính nó
  -- lại thành nút nghẽn (đo 28/07). Số chuyến khi vượt trần lấy từ `total` của endpoint danh
  -- sách (FE đã có sẵn) — không cần đếm ở đây.
  SELECT count(*) INTO n_items
  FROM "GroupDeliveryOrder" gd
  JOIN "OutboundDelivery" d ON d.gdo_id = gd.id
  JOIN "OutboundItem" i     ON i.do_id  = d.id
  WHERE (p_warehouse_ids IS NULL OR gd.warehouse_id = ANY (p_warehouse_ids))
    AND (p_scope_categories IS NULL OR gd.warehouse_type IS NULL
         OR wt_cats(gd.warehouse_type) && p_scope_categories)
    AND (p_warehouse_types  IS NULL OR wt_cats(gd.warehouse_type) && p_warehouse_types)
    AND (p_status           IS NULL OR gd.status = p_status)
    AND (p_transfer_status  IS NULL OR gd.transfer_status = p_transfer_status)
    AND (p_date_from        IS NULL OR gd.delivery_date >= p_date_from)
    AND (p_date_to          IS NULL OR gd.delivery_date <= p_date_to)
    AND (p_dvvts            IS NULL OR gd.dvvt = ANY (p_dvvts))
    AND (p_status_labels    IS NULL OR gdo_status_label(gd.status, gd.assigned_at) = ANY (p_status_labels))
    AND (p_npps IS NULL OR EXISTS (
          SELECT 1 FROM "OutboundDelivery" d
          WHERE d.gdo_id = gd.id AND d.distributor_name = ANY (p_npps)))
    AND (p_export_types IS NULL OR EXISTS (
          SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
          WHERE d.gdo_id = gd.id AND i.export_type = ANY (p_export_types)))
    AND (p_material_codes IS NULL OR EXISTS (
          SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
          WHERE d.gdo_id = gd.id AND i.material_code_raw = ANY (p_material_codes)))
    AND (p_search IS NULL
         OR gd.group_code ILIKE '%' || p_search || '%'
         OR gd.id = ANY (COALESCE(p_search_gdo_ids, ARRAY[]::text[])));

  IF n_items > MAX_ITEMS_FOR_TOTALS THEN
    RETURN jsonb_build_object(
      'count', NULL, 'completed', NULL,
      'cartons', NULL, 'cartons_noqr', NULL, 'cartons_qr', NULL, 'pallets', NULL,
      'npp_breakdown', '[]'::jsonb,
      'too_wide', true, 'items_scanned', n_items, 'max_items_for_totals', MAX_ITEMS_FOR_TOTALS);
  END IF;

  WITH g AS (
    SELECT gd.id, gd.status, gd.warehouse_id
    FROM "GroupDeliveryOrder" gd
    WHERE (p_warehouse_ids IS NULL OR gd.warehouse_id = ANY (p_warehouse_ids))
      AND (p_scope_categories IS NULL OR gd.warehouse_type IS NULL
           OR wt_cats(gd.warehouse_type) && p_scope_categories)
      AND (p_warehouse_types  IS NULL OR wt_cats(gd.warehouse_type) && p_warehouse_types)
      AND (p_status           IS NULL OR gd.status = p_status)
      AND (p_transfer_status  IS NULL OR gd.transfer_status = p_transfer_status)
      AND (p_date_from        IS NULL OR gd.delivery_date >= p_date_from)
      AND (p_date_to          IS NULL OR gd.delivery_date <= p_date_to)
      AND (p_dvvts            IS NULL OR gd.dvvt = ANY (p_dvvts))
      AND (p_status_labels    IS NULL OR gdo_status_label(gd.status, gd.assigned_at) = ANY (p_status_labels))
      AND (p_npps IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d
            WHERE d.gdo_id = gd.id AND d.distributor_name = ANY (p_npps)))
      AND (p_export_types IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
            WHERE d.gdo_id = gd.id AND i.export_type = ANY (p_export_types)))
      AND (p_material_codes IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
            WHERE d.gdo_id = gd.id AND i.material_code_raw = ANY (p_material_codes)))
      AND (p_search IS NULL
           OR gd.group_code ILIKE '%' || p_search || '%'
           OR gd.id = ANY (COALESCE(p_search_gdo_ids, ARRAY[]::text[])))
  ),
  -- Ngoại lệ Thùng/Pallet theo kho: bung jsonb MỘT LẦN cho bảng mã hàng (vài nghìn dòng),
  -- KHÔNG gọi hàm cho từng dòng hàng (xem ghi chú ở đầu file — chênh 1,6s/200k dòng).
  ov AS (
    SELECT m.id AS material_id, o->>'warehouse_id' AS wh,
           GREATEST((o->>'cartons_per_pallet')::numeric, 0) AS cpp
    FROM "Material" m
    CROSS JOIN LATERAL jsonb_array_elements(m.warehouse_pallet_overrides) o
    WHERE jsonb_typeof(m.warehouse_pallet_overrides) = 'array'
  ),
  -- MỘT lần quét dòng hàng, tính sẵn mọi đại lượng (trước đây 4 subquery quét lại CTE 4 lần).
  it AS (
    SELECT COALESCE(d.distributor_name, '(không tên)') AS npp, i.material_code_raw,
           COALESCE(m.no_qr_tracking, false) AS no_qr,
           CASE WHEN m.entry_unit IS NOT NULL AND btrim(m.entry_unit) <> ''
                     AND COALESCE(m.units_per_carton, 0) > 0
                THEN ROUND(COALESCE(i.cartons_ordered, 0) / m.units_per_carton, 3)
                ELSE COALESCE(i.cartons_ordered, 0) END AS c_ord,
           CASE WHEN m.entry_unit IS NOT NULL AND btrim(m.entry_unit) <> ''
                     AND COALESCE(m.units_per_carton, 0) > 0
                THEN ROUND(COALESCE(i.cartons_scanned, 0) / m.units_per_carton, 3)
                ELSE COALESCE(i.cartons_scanned, 0) END AS c_scan,
           -- palletsOf: mã pallet-mang-hàng → 0 · có pallets_estimated → dùng · else thùng ÷ cpp
           CASE WHEN COALESCE(m.is_pallet_carrier, false) THEN 0
                WHEN COALESCE(i.pallets_estimated, 0) > 0 THEN i.pallets_estimated
                ELSE (CASE WHEN COALESCE(NULLIF(ov.cpp, 0), m.cartons_per_pallet, 0) > 0
                           THEN (CASE WHEN m.entry_unit IS NOT NULL AND btrim(m.entry_unit) <> ''
                                           AND COALESCE(m.units_per_carton, 0) > 0
                                      THEN ROUND(COALESCE(i.cartons_ordered, 0) / m.units_per_carton, 3)
                                      ELSE COALESCE(i.cartons_ordered, 0) END)
                                / COALESCE(NULLIF(ov.cpp, 0), m.cartons_per_pallet, 0)
                           ELSE 0 END)
                END AS pallets
    FROM g
    JOIN "OutboundDelivery" d ON d.gdo_id = g.id
    JOIN "OutboundItem" i     ON i.do_id  = d.id
    LEFT JOIN "Material" m    ON m.id     = i.material_id
    LEFT JOIN ov              ON ov.material_id = i.material_id AND ov.wh = g.warehouse_id
  ),
  -- MỘT lần quét cho CẢ tổng lẫn phân bổ NPP (GROUPING SETS).
  -- Tách 2 truy vấn riêng thì CTE `it` bị tham chiếu 2 lần ⇒ Postgres VẬT CHẤT HOÁ 200k dòng
  -- ra tuplestore rồi đọc lại — đo 28/07: chiếm ~2/3 thời gian (900ms), trong khi bản thân
  -- phép cộng chỉ ~230ms. Gộp lại thì `it` được inline, không materialize.
  -- Dòng GROUPING(npp)=1 là TỔNG; các dòng còn lại là từng NPP.
  -- Cột *_mat = phần khớp p_material_codes (FE cũ: đang lọc mã hàng thì breakdown chỉ tính mã đó).
  rollup AS (
    SELECT GROUPING(npp) AS is_total, npp,
           SUM(c_ord)                                   AS c_ord,
           SUM(c_ord) FILTER (WHERE no_qr)              AS c_noqr,
           SUM(pallets)                                 AS pallets,
           SUM(c_ord)  FILTER (WHERE mat_ok)            AS c_ord_mat,
           SUM(c_scan) FILTER (WHERE mat_ok)            AS c_scan_mat,
           count(*)    FILTER (WHERE mat_ok)            AS n_mat
    FROM (SELECT it.*, (p_material_codes IS NULL OR material_code_raw = ANY (p_material_codes)) AS mat_ok
            FROM it) x
    GROUP BY GROUPING SETS ((npp), ())
  ),
  gagg AS (
    SELECT count(*) AS cnt, count(*) FILTER (WHERE status = 'COMPLETED') AS done FROM g
  )
  SELECT jsonb_build_object(
    'count',         (SELECT cnt  FROM gagg),
    'completed',     (SELECT done FROM gagg),
    'cartons',       COALESCE((SELECT c_ord   FROM rollup WHERE is_total = 1), 0),
    'cartons_noqr',  COALESCE((SELECT c_noqr  FROM rollup WHERE is_total = 1), 0),
    'cartons_qr',    COALESCE((SELECT c_ord - COALESCE(c_noqr, 0) FROM rollup WHERE is_total = 1), 0),
    'pallets',       COALESCE((SELECT pallets FROM rollup WHERE is_total = 1), 0),
    'npp_breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'npp', npp, 'planned', c_ord_mat, 'scanned', c_scan_mat)
                        ORDER BY c_ord_mat DESC, npp)
                        FROM rollup WHERE is_total = 0 AND n_mat > 0), '[]'::jsonb),
    'too_wide', false
  ) INTO result;
  RETURN result;
END;
$function$;

-- ── rename_warehouse_type ──
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

  UPDATE "SlotTemplate" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('SlotTemplate', n);

  UPDATE "DeliverySlot" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('DeliverySlot', n);

  UPDATE "TmsOrder" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('TmsOrder', n);

  -- Chuyến chở lẫn: thay ĐÚNG phần tử trong chuỗi ghép (DISTINCT phòng khi ghép ra trùng)
  UPDATE "GroupDeliveryOrder"
     SET warehouse_type = (SELECT string_agg(DISTINCT c, '+')
                             FROM unnest(array_replace(wt_cats(warehouse_type), p_old, p_new)) c)
   WHERE wt_cats(warehouse_type) @> ARRAY[p_old];
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('GroupDeliveryOrder', n);

  UPDATE gate_registrations SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('gate_registrations', n);

  UPDATE inbound_plan_lines SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('inbound_plan_lines', n);

  UPDATE "ProductionImport" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('ProductionImport', n);

  UPDATE "PalletLabelPrint" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('PalletLabelPrint', n);

  RETURN counts;
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260731b_forklift.sql
-- ───────────────────────────────────────────────────────────────────────
-- ============================================================================
-- MODULE XE NÂNG (31/07/2026) — check list an toàn hàng ngày + đồng hồ giờ vận hành.
-- Nghiệp vụ (user chốt):
--   - Đội xe nâng MỖI NGÀY check list an toàn từng xe + ghi số ĐỒNG HỒ GIỜ (hour meter,
--     số tích lũy trên xe). Giờ chạy của 1 ngày = số lần ghi KẾ TIẾP − số lần ghi hôm đó
--     (vd hôm qua 1480, hôm nay 1500 → hôm qua chạy 20h).
--   - Xe NGHỈ hôm đó = 1 trạng thái của bản ghi ngày (IDLE, không cần số đồng hồ) —
--     vẫn tính là "đã check list".
--   - Kiểm soát xe nào CHƯA check list trong ngày (board = xe active × log ngày).
--   - Check list snapshot label vào jsonb → đổi tên hạng mục sau này KHÔNG phá lịch sử.
-- Bảng MỚI nên có DEFAULT id/updated_at (luật "INSERT tự cấp id" là cho bảng CŨ thiếu default).
-- RLS bật + KHÔNG policy → anon/authenticated không đọc/ghi thẳng; chỉ service role (BE).
-- ============================================================================

-- 1. Danh mục xe nâng
CREATE TABLE IF NOT EXISTS public.forklift_vehicles (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text        NOT NULL,             -- mã xe (vd XN01) — unique không phân biệt hoa/thường
  name         text,                             -- tên/mô tả (hãng, model…) tùy chọn
  warehouse_id text        NOT NULL REFERENCES public."Warehouse"(id),
  is_active    boolean     NOT NULL DEFAULT true,
  created_by   text,
  updated_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_forklift_code ON public.forklift_vehicles (upper(code));
CREATE INDEX IF NOT EXISTS idx_forklift_wh ON public.forklift_vehicles (warehouse_id) WHERE is_active;

-- 2. Danh mục hạng mục check list (dùng CHUNG mọi xe)
CREATE TABLE IF NOT EXISTS public.forklift_checklist_items (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text        NOT NULL,               -- nội dung kiểm tra (phanh, còi, đèn, lốp…)
  sort_order integer     NOT NULL DEFAULT 0,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Bản ghi check list NGÀY — mỗi xe mỗi ngày ĐÚNG 1 dòng (unique = chống đua đa-user,
--    BE bắt 23505 → chuyển thành UPDATE). Ghi lại trong ngày = cập nhật đè.
CREATE TABLE IF NOT EXISTS public.forklift_daily_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  forklift_id   uuid        NOT NULL REFERENCES public.forklift_vehicles(id) ON DELETE CASCADE,
  log_date      date        NOT NULL,            -- ngày VN (business date)
  status        text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'IDLE')),
  hour_meter    numeric(12,1),                   -- số đồng hồ giờ lúc check (bắt buộc khi ACTIVE)
  checklist     jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- [{item_id, label(snapshot), ok, note}]
  issue_count   integer     NOT NULL DEFAULT 0,  -- đếm sẵn số hạng mục KHÔNG đạt (BE tính khi ghi)
  note          text,
  checked_by    text,                            -- tên người check (snapshot)
  checked_by_id uuid,                            -- Employee.id
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_forklift_log_day UNIQUE (forklift_id, log_date),
  CONSTRAINT forklift_log_meter_required CHECK (status <> 'ACTIVE' OR hour_meter IS NOT NULL),
  CONSTRAINT forklift_log_meter_positive CHECK (hour_meter IS NULL OR hour_meter >= 0)
);
CREATE INDEX IF NOT EXISTS idx_fdl_date ON public.forklift_daily_logs (log_date DESC);
-- (forklift_id, log_date) đã có index qua UNIQUE constraint — lateral "số kế tiếp" dùng index này.

ALTER TABLE public.forklift_vehicles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forklift_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forklift_daily_logs      ENABLE ROW LEVEL SECURITY;

-- Realtime CÓ ĐIỀU KIỆN (tránh 42710 nếu đã thêm)
DO $$ DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['forklift_vehicles', 'forklift_checklist_items', 'forklift_daily_logs'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = tbl) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;

-- ─── RPC: forklift_report ────────────────────────────────────────────────────
-- Báo cáo vận hành 1 khoảng ngày: trả DÒNG jsonb (không trả id — luật pool PostgREST),
-- mỗi dòng = 1 log kèm hours_run đã tính sẵn:
--   hours_run = số đồng hồ của LẦN GHI KẾ TIẾP (bỏ qua ngày nghỉ không số) − số hôm đó.
--   Ngày IDLE → 0. Chưa có lần ghi kế tiếp → NULL (FE hiện "chờ số hôm sau").
-- plpgsql + force_custom_plan (bẫy LANGUAGE sql generic plan — memory server-pagination-campaign).
CREATE OR REPLACE FUNCTION public.forklift_report(
  p_from date, p_to date, p_warehouse_ids text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE v_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.log_date DESC, c.code), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT l.id, l.forklift_id, v.code, v.name AS forklift_name, v.warehouse_id,
           l.log_date, l.status, l.hour_meter, l.issue_count, l.checked_by, l.note,
           nxt.hour_meter AS next_meter, nxt.log_date AS next_date,
           CASE WHEN l.status = 'IDLE' THEN 0
                WHEN nxt.hour_meter IS NOT NULL THEN round(nxt.hour_meter - l.hour_meter, 1)
                ELSE NULL END AS hours_run
    FROM public.forklift_daily_logs l
    JOIN public.forklift_vehicles v ON v.id = l.forklift_id
    LEFT JOIN LATERAL (
      SELECT n.hour_meter, n.log_date FROM public.forklift_daily_logs n
      WHERE n.forklift_id = l.forklift_id AND n.log_date > l.log_date AND n.hour_meter IS NOT NULL
      ORDER BY n.log_date LIMIT 1
    ) nxt ON true
    WHERE l.log_date BETWEEN p_from AND p_to
      AND (p_warehouse_ids IS NULL OR v.warehouse_id = ANY(p_warehouse_ids))
  ) c;
  RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION public.forklift_report(date, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forklift_report(date, date, text[]) TO service_role;

-- Seed hạng mục check list mặc định (chỉ khi bảng RỖNG — không đè danh mục user đã sửa)
INSERT INTO public.forklift_checklist_items (label, sort_order)
SELECT * FROM (VALUES
  ('Phanh (thắng) hoạt động tốt', 1),
  ('Còi / đèn cảnh báo hoạt động', 2),
  ('Lốp xe / bánh xe không mòn vẹt, nứt', 3),
  ('Càng nâng không cong vênh, nứt gãy', 4),
  ('Xích / thủy lực không rò rỉ dầu', 5),
  ('Dây an toàn / khung bảo vệ đầy đủ', 6),
  ('Bình điện / nhiên liệu đủ mức', 7),
  ('Gương chiếu hậu / tầm nhìn rõ', 8)
) AS seed(label, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.forklift_checklist_items);

-- ───────────────────────────────────────────────────────────────────────
-- 20260731c_forklift_item_warehouse.sql
-- ───────────────────────────────────────────────────────────────────────
-- ============================================================================
-- XE NÂNG đợt 2 (31/07/2026) — user chốt sau nghiệm thu đợt 1:
-- 1. HẠNG MỤC CHECK LIST THEO RIÊNG TỪNG KHO: thêm warehouse_id vào
--    forklift_checklist_items. NULL = dùng chung mọi kho (8 dòng seed giữ nguyên
--    là bộ chung); có giá trị = chỉ áp cho xe của kho đó. Check list 1 xe =
--    hạng mục chung + hạng mục riêng kho của xe.
-- 2. LỊCH SỬ PHẢI BIẾT AI CHECK / CHECK LÚC NÀO: RPC forklift_report trả thêm
--    checked_at (= updated_at của log — lần ghi/sửa cuối).
-- ============================================================================

ALTER TABLE public.forklift_checklist_items
  ADD COLUMN IF NOT EXISTS warehouse_id text REFERENCES public."Warehouse"(id);
CREATE INDEX IF NOT EXISTS idx_fci_wh ON public.forklift_checklist_items (warehouse_id);

CREATE OR REPLACE FUNCTION public.forklift_report(
  p_from date, p_to date, p_warehouse_ids text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE v_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.log_date DESC, c.code), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT l.id, l.forklift_id, v.code, v.name AS forklift_name, v.warehouse_id,
           l.log_date, l.status, l.hour_meter, l.issue_count, l.checked_by, l.note,
           l.updated_at AS checked_at,
           nxt.hour_meter AS next_meter, nxt.log_date AS next_date,
           CASE WHEN l.status = 'IDLE' THEN 0
                WHEN nxt.hour_meter IS NOT NULL THEN round(nxt.hour_meter - l.hour_meter, 1)
                ELSE NULL END AS hours_run
    FROM public.forklift_daily_logs l
    JOIN public.forklift_vehicles v ON v.id = l.forklift_id
    LEFT JOIN LATERAL (
      SELECT n.hour_meter, n.log_date FROM public.forklift_daily_logs n
      WHERE n.forklift_id = l.forklift_id AND n.log_date > l.log_date AND n.hour_meter IS NOT NULL
      ORDER BY n.log_date LIMIT 1
    ) nxt ON true
    WHERE l.log_date BETWEEN p_from AND p_to
      AND (p_warehouse_ids IS NULL OR v.warehouse_id = ANY(p_warehouse_ids))
  ) c;
  RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION public.forklift_report(date, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forklift_report(date, date, text[]) TO service_role;

-- ───────────────────────────────────────────────────────────────────────
-- 20260731d_forklift_photo.sql
-- ───────────────────────────────────────────────────────────────────────
-- ============================================================================
-- XE NÂNG đợt 3 (31/07/2026) — user chốt: xe HOẠT ĐỘNG phải CHỤP ẢNH xe mới
-- được lưu check list (xe nghỉ thì không cần check an toàn / không cần ảnh).
-- 1. Cột photo_path trên forklift_daily_logs — đường dẫn object trong bucket.
-- 2. Bucket Storage RIÊNG TƯ 'forklift-photos' (bucket ĐẦU TIÊN của app):
--    - public=false + KHÔNG policy trên storage.objects → anon/authenticated
--      không đọc/ghi thẳng; chỉ BE (service role) upload + phát signed URL 1h.
--    - Ảnh đã nén client-side (~200-400KB JPEG) trước khi gửi — không đụng
--      trần 4,5MB Vercel; BE vẫn chặn cứng 4MB.
-- ============================================================================

ALTER TABLE public.forklift_daily_logs ADD COLUMN IF NOT EXISTS photo_path text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('forklift-photos', 'forklift-photos', false)
ON CONFLICT (id) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 20260731e_forklift_report_dashboard.sql
-- ───────────────────────────────────────────────────────────────────────
-- ============================================================================
-- XE NÂNG đợt 4 (31/07/2026) — user chốt: "Báo cáo vận hành nhìn vào là raw data,
-- đánh giá rất kém" → tab báo cáo thành DASHBOARD. RPC forklift_report đổi shape:
--   cũ: jsonb ARRAY các dòng log
--   mới: jsonb OBJECT { rows: [...], issue_items: [{label, cnt}] }
-- issue_items = TOP 10 hạng mục check bị đánh LỖI nhiều nhất trong khoảng ngày
-- (bóc từ jsonb checklist — cột label đã snapshot nên gom theo label là đúng
-- lịch sử, không lệ thuộc danh mục hiện tại). BE bump cùng commit nên không có
-- cửa sổ lệch shape (staging-only, production nhận cả cụm khi merge).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.forklift_report(
  p_from date, p_to date, p_warehouse_ids text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE v_rows jsonb; v_issues jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.log_date DESC, c.code), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT l.id, l.forklift_id, v.code, v.name AS forklift_name, v.warehouse_id,
           l.log_date, l.status, l.hour_meter, l.issue_count, l.checked_by, l.note,
           l.updated_at AS checked_at,
           nxt.hour_meter AS next_meter, nxt.log_date AS next_date,
           CASE WHEN l.status = 'IDLE' THEN 0
                WHEN nxt.hour_meter IS NOT NULL THEN round(nxt.hour_meter - l.hour_meter, 1)
                ELSE NULL END AS hours_run
    FROM public.forklift_daily_logs l
    JOIN public.forklift_vehicles v ON v.id = l.forklift_id
    LEFT JOIN LATERAL (
      SELECT n.hour_meter, n.log_date FROM public.forklift_daily_logs n
      WHERE n.forklift_id = l.forklift_id AND n.log_date > l.log_date AND n.hour_meter IS NOT NULL
      ORDER BY n.log_date LIMIT 1
    ) nxt ON true
    WHERE l.log_date BETWEEN p_from AND p_to
      AND (p_warehouse_ids IS NULL OR v.warehouse_id = ANY(p_warehouse_ids))
  ) c;

  SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.cnt DESC), '[]'::jsonb)
  INTO v_issues
  FROM (
    SELECT c->>'label' AS label, count(*) AS cnt
    FROM public.forklift_daily_logs l
    JOIN public.forklift_vehicles v ON v.id = l.forklift_id,
    LATERAL jsonb_array_elements(l.checklist) c
    WHERE l.log_date BETWEEN p_from AND p_to
      AND (p_warehouse_ids IS NULL OR v.warehouse_id = ANY(p_warehouse_ids))
      AND (c->>'ok') = 'false'
    GROUP BY c->>'label'
    ORDER BY count(*) DESC
    LIMIT 10
  ) i;

  RETURN jsonb_build_object('rows', v_rows, 'issue_items', v_issues);
END $$;

REVOKE ALL ON FUNCTION public.forklift_report(date, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forklift_report(date, date, text[]) TO service_role;

COMMIT;