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
