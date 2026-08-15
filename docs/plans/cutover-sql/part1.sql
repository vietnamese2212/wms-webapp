-- ══════════════════════════════════════════════════════════════════════════
-- CUTOVER production 15/08/2026 — PART1 (13 migration)
-- Dán TRỌN file này vào Supabase SQL Editor (project production svicyfquresxaigfxsdb) → Run.
-- Bọc trong 1 transaction: lỗi bất kỳ đâu là ROLLBACK toàn bộ part → sửa rồi chạy lại,
-- KHÔNG để schema dở dang. Chạy các part theo ĐÚNG THỨ TỰ part1 → part5.
-- ══════════════════════════════════════════════════════════════════════════
BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 20260728_hr_paged_rpc.sql
-- ───────────────────────────────────────────────────────────────────────
-- HR: phân trang SERVER cho Quản lý người dùng + Bảng công (ma trận).
--
-- ĐO THẬT 28/07 trên staging (bơm nhân sự theo mốc, gọi API thật):
--   · GET /masterdata/employees — 385 NV chạy 0,7s; **395 NV = HTTP 500 sau 8,5s** (đã vá bằng
--     chunk 300 ở commit trước). Sau vá: 3.000 NV = 2.495KB — chạm trần 4,5MB response của
--     Vercel ở khoảng 5.400 NV.
--   · GET /hr/attendance 1 tháng — 552 byte/dòng × NV × ngày. 3.000 NV × 28 ngày = 82.914 dòng
--     = **44.665KB / 18,9s** ⇒ vượt trần 4,5MB từ khoảng ~290 NV, và tiến sát maxDuration 60s.
-- ⇒ Cả 2 trang phải phân trang theo NGƯỜI, không nạp cả bảng nhân sự về trình duyệt.
--
-- Scope nhân sự (`visibleEmployeeIds`: kho được gán ∩ cấp dưới theo JobTitle.parent_id đệ quy)
-- vẫn resolve ở backend — đã audit, không đưa vào SQL để không nới quyền. Truyền xuống bằng
-- THAM SỐ MẢNG của RPC (POST body) nên thoát trần ~300 id trên URL.
--
-- `p_work_dates` = danh sách ngày CẦN chấm công, do FRONTEND tính và truyền xuống (nó giữ bảng
-- ngày lễ VN + luật bỏ Chủ nhật + chỉ tính ngày đã qua). Tối đa 31 phần tử ≈ 340 byte — nhỏ,
-- và giữ đúng chỗ sở hữu quy tắc thay vì nhân bản bảng lễ xuống DB.

-- ── 1. Danh sách nhân sự phân trang (Quản lý người dùng) ─────────────────────
CREATE OR REPLACE FUNCTION hr_employees_page(
  p_scope_ids   text[],   -- null = không giới hạn (superadmin / NATIONAL)
  p_dept        text,
  p_jt_id       text,     -- chức danh theo ID (trang Quản lý người dùng lọc bằng id)
  p_wh          text,     -- kho được gán (qua UserWarehouseAccess)
  p_search      text,
  p_active      text,     -- 'true' | 'false' | null = tất cả
  p_incl_deleted boolean,
  p_status      text,     -- 'active' | 'hidden' (chỉ NV đã ẩn) | 'all'
  p_offset      int,
  p_limit       int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE s text;
BEGIN
  s := CASE WHEN p_search IS NULL OR btrim(p_search) = '' THEN NULL
            ELSE lower(immutable_unaccent(btrim(p_search))) END;
  RETURN (
    WITH f AS (
      SELECT e.id, e.name, e.is_active, e.deleted_at
      FROM "Employee" e
      WHERE (p_incl_deleted OR e.deleted_at IS NULL)
        -- 'hidden' = CHỈ nhân viên đã ẩn (mirror bộ lọc Tình trạng cũ ở FE)
        AND (p_status IS DISTINCT FROM 'hidden' OR e.deleted_at IS NOT NULL)
        AND (p_scope_ids IS NULL OR e.id = ANY (p_scope_ids))
        AND (p_dept      IS NULL OR e.department_id = p_dept)
        AND (p_jt_id     IS NULL OR e.job_title_id = p_jt_id)
        AND (p_active    IS NULL OR e.is_active = (p_active = 'true'))
        AND (p_wh IS NULL OR EXISTS (
              SELECT 1 FROM "UserWarehouseAccess" w
              WHERE w.employee_id = e.id AND w.warehouse_id = p_wh))
        AND (s IS NULL OR lower(immutable_unaccent(
              concat_ws(' ', e.name, e.employee_code, e.email))) LIKE '%' || s || '%')
    ),
    pg AS (
      SELECT id, row_number() OVER (ORDER BY name, id) rn
      FROM f ORDER BY name, id OFFSET p_offset LIMIT p_limit
    )
    -- 3 ô SummaryBand đếm trên TOÀN BỘ bộ lọc (đếm ở FE = đếm trang đang xem)
    SELECT jsonb_build_object(
      'ids',    COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb),
      'total',  (SELECT count(*) FROM f),
      'active', (SELECT count(*) FROM f WHERE deleted_at IS NULL AND is_active),
      'paused', (SELECT count(*) FROM f WHERE deleted_at IS NULL AND NOT is_active),
      'hidden', (SELECT count(*) FROM f WHERE deleted_at IS NOT NULL)
    )
  );
END $$;

-- ── 2. Bảng công ma trận: TRANG = NGƯỜI, tổng tính trên TOÀN BỘ bộ lọc ───────
-- Ma trận có dòng = nhân viên, cột = ngày. Cắt trang theo NGƯỜI (không theo dòng công) để 1
-- người không bị xẻ đôi qua 2 trang. Các ô tổng + số "thiếu công" phải đếm trên toàn bộ bộ
-- lọc: đếm ở FE sau khi phân trang là đếm 1 trang, đứng cạnh ô tổng thành hai số đá nhau.
CREATE OR REPLACE FUNCTION hr_attendance_matrix(
  p_scope_ids  text[],
  p_wh         text,
  p_dept       text,
  p_jt_name    text,
  p_search     text,
  p_from       date,
  p_to         date,
  p_work_dates date[],   -- ngày CẦN chấm (FE tính: đã qua, không CN, không lễ)
  p_status     text,     -- 'all' | 'done' | 'missing'
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
    WITH emp AS (       -- roster trong phạm vi lọc (mirror bộ lọc client cũ)
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
    att AS (            -- công trong khoảng ngày, chỉ của roster trên
      SELECT a.employee_id, a.work_date, a.kind, a.ot_hours, a.early_leave_hours
      FROM "Attendance" a
      WHERE a.work_date >= p_from AND a.work_date <= p_to
        AND a.employee_id IN (SELECT id FROM emp)
    ),
    miss AS (           -- số ngày CẦN chấm mà chưa có bản ghi, per nhân viên
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
      'total',         (SELECT count(*) FROM f),
      'roster_total',  (SELECT count(*) FROM e2),                       -- trước lọc trạng thái
      'missing_total', (SELECT COALESCE(sum(missing), 0) FROM e2),       -- tổng ngày thiếu công
      -- 4 ô SummaryBand: đếm trên MỌI dòng công của roster (không phải trang đang xem)
      'work_days',     (SELECT count(*)                     FROM att WHERE kind <> 'LEAVE'),
      'leave_days',    (SELECT count(*)                     FROM att WHERE kind  = 'LEAVE'),
      'ot',            (SELECT COALESCE(sum(ot_hours), 0)   FROM att WHERE kind <> 'LEAVE'),
      'early',         (SELECT COALESCE(sum(early_leave_hours), 0) FROM att WHERE kind <> 'LEAVE')
    )
  );
END $$;

-- Vào bảng theo (nhân viên, ngày) — truy vấn chính của ma trận
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON "Attendance" (employee_id, work_date);
-- Lọc roster theo kho được gán
CREATE INDEX IF NOT EXISTS idx_uwa_wh_emp ON "UserWarehouseAccess" (warehouse_id, employee_id);
-- Sắp roster theo tên (mọi trang đều ORDER BY name, id)
CREATE INDEX IF NOT EXISTS idx_employee_name_id ON "Employee" (name, id) WHERE deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────
-- 20260728_loose_picking_paged_rpc.sql
-- ───────────────────────────────────────────────────────────────────────
-- Nhặt lẻ: phân trang SERVER theo CHUYẾN XE + đảo chiều truy vấn.
--
-- HAI VẤN ĐỀ CỦA ĐƯỜNG CŨ:
--  1. Không có trần: controller nạp HẾT GroupDeliveryOrder trong khoảng ngày → HẾT
--     OutboundDelivery → HẾT OutboundItem → HẾT OutboundScanEntry rồi mới lọc `loose_picking > 0`
--     ở tầng thứ ba. Người dùng nới khoảng ngày là fan-out 4 tầng không giới hạn.
--  2. Sai chiều: điều kiện CHỌN LỌC NHẤT (`loose_picking > 0` — rất ít dòng) bị áp CUỐI CÙNG,
--     nên phải kéo về cả nghìn chuyến không liên quan chỉ để bỏ đi.
-- Ở đây lọc item nhặt lẻ TRƯỚC rồi mới join ngược lên chuyến ⇒ tập làm việc nhỏ ngay từ đầu.
--
-- ĐƠN VỊ TRANG = CHUYẾN XE (màn hình gập/mở theo chuyến, không phải theo dòng hàng).
-- Mọi bộ lọc + 4 ô SummaryBand đều ở đây: lọc/đếm ở FE sau khi phân trang = lọc/đếm 1 trang.

-- Quy đổi THÙNG per-mã trước khi cộng cross-mã (luật BASE UNIT: cộng base thô rồi gắn nhãn
-- "thùng" là thổi tổng — mỗi mã một hệ số units_per_carton). Mirror utils/qtyUnits.qtyEntryDecimal.
CREATE OR REPLACE FUNCTION qty_entry_decimal(p_qty numeric, p_entry_unit text, p_upc numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN p_entry_unit IS NULL OR p_entry_unit = '' OR COALESCE(p_upc, 0) <= 0 THEN COALESCE(p_qty, 0)
           ELSE round(COALESCE(p_qty, 0) / p_upc, 3)
         END
$$;

CREATE OR REPLACE FUNCTION loose_picking_page(
  p_wh_scope     text[],   -- kho được giao (null = NATIONAL)
  p_cat_scope    text[],   -- loại hàng được phép (null-inclusive)
  p_warehouse_id text,     -- kho người dùng chọn ở thanh lọc
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

  RETURN (
    WITH it AS (   -- ① lọc chọn-lọc-nhất TRƯỚC: chỉ dòng hàng CÓ nhặt lẻ
      SELECT i.id, i.do_id, i.material_id, i.material_code_raw,
             i.cartons_ordered, i.cartons_scanned, i.loose_picking, i.export_type
      FROM "OutboundItem" i
      WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
    ),
    j AS (         -- ② join ngược lên chuyến, áp scope + khoảng ngày
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
        -- loại hàng NULL-INCLUSIVE (chuyến chưa khai loại vẫn hiện) — quy ước chung toàn app
        AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR g.warehouse_type = ANY (p_cat_scope))
    ),
    st AS (        -- ③ công thức nhặt lẻ per dòng (mirror itemLooseStats ở FE)
      SELECT j.*,
             GREATEST(0, loose_picking
                         - GREATEST(0, (cartons_scanned - loose_scanned)
                                       - (cartons_ordered - loose_picking))) AS effective
      FROM j
    ),
    st2 AS (
      SELECT st.*, LEAST(loose_scanned, effective) AS done FROM st
    ),
    gg AS (        -- ④ gom theo CHUYẾN + cộng THÙNG đã quy đổi per-mã
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
    f AS (         -- ⑤ bộ lọc người dùng — áp ở mức CHUYẾN (đúng như bảng đang hiển thị)
      SELECT * FROM gg
      WHERE (p_wh_types     IS NULL OR warehouse_type = ANY (p_wh_types))
        AND (p_export_types IS NULL OR export_type    = ANY (p_export_types))
        AND (p_dvvts        IS NULL OR dvvt           = ANY (p_dvvts))
        AND (p_npps         IS NULL OR npps && p_npps)
        -- tìm kiếm: MỌI từ khoá phải khớp (mirror omniMatch ở FE), bỏ dấu 2 phía
        AND (s IS NULL OR NOT EXISTS (
              SELECT 1 FROM unnest(string_to_array(s, ' ')) t
              WHERE t <> '' AND position(t IN hay) = 0))
    ),
    pg AS (
      SELECT gdo_id FROM f ORDER BY delivery_date, group_code, gdo_id OFFSET p_offset LIMIT p_limit
    )
    SELECT jsonb_build_object(
      'gdo_ids',     COALESCE((SELECT jsonb_agg(gdo_id) FROM pg), '[]'::jsonb),
      'total',       (SELECT count(*)                FROM f),   -- số CHUYẾN khớp lọc
      'items_n',     (SELECT COALESCE(sum(items_n), 0)     FROM f),
      'pending_n',   (SELECT COALESCE(sum(pending_n), 0)   FROM f),
      'loose_total', (SELECT COALESCE(sum(loose_total), 0)  FROM f),
      'loose_done',  (SELECT COALESCE(sum(loose_done), 0)   FROM f)
    )
  );
END $$;

-- Ô chọn bộ lọc: lấy trên phạm vi NGÀY + KHO (không phụ thuộc các filter khác) — giống hệt
-- đường cũ dựng option từ tập `grouped` trước khi lọc client.
CREATE OR REPLACE FUNCTION loose_picking_facets(
  p_wh_scope     text[],
  p_cat_scope    text[],
  p_warehouse_id text,
  p_from         date,
  p_to           date
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
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
        AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR g.warehouse_type = ANY (p_cat_scope))
    )
    SELECT jsonb_build_object(
      'dvvts',        COALESCE((SELECT jsonb_agg(DISTINCT dvvt)             FROM j WHERE dvvt IS NOT NULL), '[]'::jsonb),
      'npps',         COALESCE((SELECT jsonb_agg(DISTINCT distributor_name) FROM j WHERE distributor_name IS NOT NULL), '[]'::jsonb),
      'wh_types',     COALESCE((SELECT jsonb_agg(DISTINCT warehouse_type)   FROM j WHERE warehouse_type IS NOT NULL), '[]'::jsonb),
      'export_types', COALESCE((SELECT jsonb_agg(DISTINCT export_type)      FROM j WHERE export_type IS NOT NULL), '[]'::jsonb)
    )
  );
END $$;

-- Vào bảng theo đúng chiều mới: item nhặt lẻ (rất ít dòng) → chuyến
CREATE INDEX IF NOT EXISTS idx_outbound_item_loose
  ON "OutboundItem" (do_id) WHERE loose_picking > 0 AND status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS idx_scan_entry_loose_item
  ON "OutboundScanEntry" (item_id) WHERE is_loose_picking;

-- ───────────────────────────────────────────────────────────────────────
-- 20260728_pallet_ops_paged_rpc.sql
-- ───────────────────────────────────────────────────────────────────────
-- Lịch sử Dồn/Tách pallet: phân trang SERVER + 4 ô SummaryBand tính trong DB.
--
-- VÌ SAO (đo 28/07 với 25.000 thao tác): `listOps` có `hardCap = 5.000` và trả về MẢNG TRẦN —
-- không `total`, không cờ `truncated`. Người dùng thấy đúng 5.000 dòng và KHÔNG có cách nào biết
-- còn 20.000 dòng nữa, cũng không có đường đi tới. Đây là mức sai nặng nhất: CẮT ÂM THẦM.
-- Payload 5.000 dòng đã 1.402KB; nâng trần lên 20.000 (giá trị max của tham số `limit`) thì
-- ~5,6MB → vượt trần 4,5MB của Vercel. Nâng trần không cứu được, chỉ phân trang mới cứu.
--
-- Mỗi lần dồn/tách = 1 dòng `PalletOperation`. Kho đang thao tác vài trăm lượt/ngày ⇒ ~100k
-- dòng/năm, tức trần 5.000 bị chạm trong khoảng 2 tuần.
--
-- LỌC "LOẠI KHO" PHẢI XUỐNG SQL: trang đang lọc Loại kho ở CLIENT bằng cách suy mã hàng từ tem
-- pallet rồi tra `Material.category`. Khi đã phân trang, lọc ở client = lọc trên ĐÚNG 1 TRANG
-- (trang 20 dòng lọc còn 3, ô tổng cũng sai). Nên bóc mã hàng ngay trong SQL, khớp 2 định dạng
-- tem: V1 `ddmmyy_MãHàng_...` (đoạn 2 của `_`) và V2 `MãHàng;QA;...` (đoạn 1 của `;`, có đệm
-- space nên phải btrim) — cùng quy tắc với `materialCodeOf` ở FE và `parseInboundQR` ở BE.

-- Mã hàng của 1 thao tác = suy từ tem đích, không có thì tem nguồn (mirror FE:
-- `o.target_codes?.[0] || o.source_codes?.[0]`).
-- NULLIF(...,'') là BẮT BUỘC: `split_part` trả '' khi tem không có đoạn đó (mã rác, tem tay).
-- Trả '' thì điều kiện null-inclusive bên dưới không bắt được ⇒ dòng đó bị LOẠI khi lọc Loại kho,
-- trái quy ước toàn app "bản ghi không khai loại vẫn hiện".
CREATE OR REPLACE FUNCTION pallet_op_material_code(p_target text[], p_source text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN code IS NULL OR code = '' THEN NULL
           WHEN position(';' IN code) > 0 THEN NULLIF(btrim(split_part(code, ';', 1)), '')
           ELSE NULLIF(btrim(split_part(code, '_', 2)), '')
         END
  FROM (SELECT COALESCE(p_target[1], p_source[1]) AS code) t
$$;

CREATE OR REPLACE FUNCTION pallet_ops_page(
  p_wh        uuid,      -- kho (trang bắt buộc chọn kho trước khi xem lịch sử)
  p_type      text,      -- MERGE | SPLIT | UNGROUP | null
  p_category  text,      -- Loại kho (suy từ mã hàng của tem) | null
  p_search    text,      -- mã tem pallet: khớp trong source_codes HOẶC target_codes
  p_from      timestamptz,
  p_to        timestamptz,
  p_offset    int,
  p_limit     int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH f AS (
    SELECT o.id, o.created_at, o.type, o.undone_at
    FROM "PalletOperation" o
    WHERE (p_wh     IS NULL OR o.warehouse_id = p_wh)
      AND (p_type   IS NULL OR o.type = p_type)
      AND (p_from   IS NULL OR o.created_at >= p_from)
      AND (p_to     IS NULL OR o.created_at <= p_to)
      AND (p_search IS NULL OR o.source_codes @> ARRAY[p_search] OR o.target_codes @> ARRAY[p_search])
      -- null-inclusive: thao tác không suy được mã hàng vẫn hiện (quy ước toàn app)
      AND (p_category IS NULL OR EXISTS (
            SELECT 1 FROM "Material" m
            WHERE m.material_code = pallet_op_material_code(o.target_codes, o.source_codes)
              AND m.category = p_category)
           OR pallet_op_material_code(o.target_codes, o.source_codes) IS NULL)
  )
  SELECT jsonb_build_object(
    'ids',      COALESCE((SELECT jsonb_agg(id ORDER BY created_at DESC, id)
                          FROM (SELECT id, created_at FROM f
                                ORDER BY created_at DESC, id OFFSET p_offset LIMIT p_limit) pg), '[]'::jsonb),
    -- 4 ô SummaryBand đếm trên TOÀN BỘ bộ lọc (đếm ở FE = chỉ đếm trang đang xem)
    'total',    (SELECT count(*) FROM f),
    'merge_n',  (SELECT count(*) FROM f WHERE type = 'MERGE'),
    'split_n',  (SELECT count(*) FROM f WHERE type = 'SPLIT'),
    'undone_n', (SELECT count(*) FROM f WHERE undone_at IS NOT NULL)
  ) INTO r;
  RETURN r;
END $$;

-- Lịch sử luôn lọc theo kho + sắp theo thời gian giảm dần.
CREATE INDEX IF NOT EXISTS idx_pallet_op_wh_created
  ON "PalletOperation" (warehouse_id, created_at DESC);
-- Tìm theo mã tem: quét mảng source/target.
CREATE INDEX IF NOT EXISTS idx_pallet_op_source_codes ON "PalletOperation" USING gin (source_codes);
CREATE INDEX IF NOT EXISTS idx_pallet_op_target_codes ON "PalletOperation" USING gin (target_codes);

-- ───────────────────────────────────────────────────────────────────────
-- 20260728_pallet_prints_paged_rpc.sql
-- ───────────────────────────────────────────────────────────────────────
-- Lịch sử in tem: phân trang SERVER theo PHIẾU IN (batch), + facet tính trong DB.
--
-- VÌ SAO: `listPrints` trả MẢNG tối đa 20.000 dòng, không cờ cắt, không phân trang. Mỗi tem in
-- là 1 dòng ⇒ kho in vài nghìn tem/ngày là ~1 triệu dòng/năm: xem 1 tháng đã vượt trần và bị
-- cắt ÂM THẦM. FE lại lọc tiếp Chế độ/Tên hàng/Chu kỳ/Máy/Người in trên tập đã tải ⇒ lọc trên
-- phần cụt, và các ô chọn của bộ lọc cũng chỉ liệt kê giá trị có trong phần cụt.
--
-- ĐƠN VỊ TRANG = PHIẾU IN, không phải tem: màn hình gom tem theo lần bấm In (gập/mở). Cắt giữa
-- phiếu thì 1 lệnh in nằm vắt qua 2 trang — vô nghĩa với người dùng. Cùng nguyên tắc "trang theo
-- CỤM" đã dùng cho lưới Kế hoạch vận chuyển.
--
-- Lọc dòng TRƯỚC rồi mới gom phiếu (giữ đúng hành vi cũ: lọc theo mã hàng thì phiếu chỉ hiện
-- những tem khớp). Khoá phiếu = batch_id, log cũ chưa có batch_id thì gom theo created_at|mode|người in.

CREATE OR REPLACE FUNCTION pallet_prints_page(
  p_wh_scope   text[],   -- null = không giới hạn kho (scope NATIONAL)
  p_cat_scope  text[],   -- null = không giới hạn loại hàng
  p_from       timestamptz,
  p_to         timestamptz,
  p_search     text,
  p_modes      text[],
  p_materials  text[],
  p_cycles     text[],
  p_machines   text[],
  p_printers   text[],
  p_offset     int,
  p_limit      int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH f AS (
    SELECT p.id, p.created_at, p.mode,
           COALESCE(p.batch_id::text,
                    p.created_at::text || '|' || p.mode || '|' || COALESCE(p.printed_by_name, '')) AS bkey
    FROM "PalletLabelPrint" p
    WHERE (p_from IS NULL OR p.created_at >= p_from)
      AND (p_to   IS NULL OR p.created_at <= p_to)
      -- scope NULL-INCLUSIVE (dòng cũ chưa gắn kho/loại vẫn hiện) — giữ đúng quy ước toàn app
      AND (p_wh_scope  IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR p.category     IS NULL OR p.category     = ANY (p_cat_scope))
      AND (p_search    IS NULL OR p.qr_code ILIKE '%' || p_search || '%'
                               OR p.material_code ILIKE '%' || p_search || '%'
                               OR p.printed_by_name ILIKE '%' || p_search || '%')
      AND (p_modes     IS NULL OR p.mode            = ANY (p_modes))
      AND (p_materials IS NULL OR p.material_code   = ANY (p_materials))
      AND (p_cycles    IS NULL OR p.cycle           = ANY (p_cycles))
      AND (p_machines  IS NULL OR p.machine         = ANY (p_machines))
      AND (p_printers  IS NULL OR p.printed_by_name = ANY (p_printers))
  ),
  b AS (
    SELECT bkey, max(created_at) AS at, max(mode) AS mode FROM f GROUP BY bkey
  ),
  pg AS (
    SELECT bkey FROM b ORDER BY at DESC, bkey OFFSET p_offset LIMIT p_limit
  )
  -- 4 ô SummaryBand đếm trên TOÀN BỘ bộ lọc (đếm ở FE = đếm mỗi trang đang xem)
  SELECT jsonb_build_object(
    'ids',        COALESCE((SELECT jsonb_agg(f.id) FROM f WHERE f.bkey IN (SELECT bkey FROM pg)), '[]'::jsonb),
    'total',      (SELECT count(*) FROM b),                            -- tổng PHIẾU IN khớp lọc
    'total_rows', (SELECT count(*) FROM f),                            -- tổng TEM khớp lọc
    'new_n',      (SELECT count(*) FROM b WHERE mode <> 'REPRINT'),    -- phiếu sinh mới
    'reprint_n',  (SELECT count(*) FROM b WHERE mode  = 'REPRINT')     -- phiếu in lại
  ) INTO r;
  RETURN r;
END $$;

-- Ô chọn của bộ lọc phải liệt kê giá trị của TOÀN BỘ bộ lọc, không phải của trang đang xem.
CREATE OR REPLACE FUNCTION pallet_prints_facets(
  p_wh_scope  text[],
  p_cat_scope text[],
  p_from      timestamptz,
  p_to        timestamptz,
  p_search    text
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH f AS (
    SELECT p.mode, p.material_code, p.cycle, p.machine, p.category, p.printed_by_name
    FROM "PalletLabelPrint" p
    WHERE (p_from IS NULL OR p.created_at >= p_from)
      AND (p_to   IS NULL OR p.created_at <= p_to)
      AND (p_wh_scope  IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR p.category     IS NULL OR p.category     = ANY (p_cat_scope))
      AND (p_search    IS NULL OR p.qr_code ILIKE '%' || p_search || '%'
                               OR p.material_code ILIKE '%' || p_search || '%'
                               OR p.printed_by_name ILIKE '%' || p_search || '%')
  )
  SELECT jsonb_build_object(
    'modes',     COALESCE((SELECT jsonb_agg(DISTINCT mode)          FROM f WHERE mode IS NULL = FALSE), '[]'::jsonb),
    'materials', COALESCE((SELECT jsonb_agg(DISTINCT material_code) FROM f WHERE material_code IS NOT NULL), '[]'::jsonb),
    'cycles',    COALESCE((SELECT jsonb_agg(DISTINCT cycle)         FROM f WHERE cycle IS NOT NULL), '[]'::jsonb),
    -- Máy/NCC: nhãn hiển thị phụ thuộc loại hàng (hàng NCC hiện TÊN NCC) nên trả kèm category
    'machines',  COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('v', machine, 'c', category))
                           FROM f WHERE machine IS NOT NULL), '[]'::jsonb),
    'printers',  COALESCE((SELECT jsonb_agg(DISTINCT printed_by_name) FROM f WHERE printed_by_name IS NOT NULL), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;

-- Trang lọc gần như luôn có khoảng ngày; batch_id dùng để gom phiếu.
CREATE INDEX IF NOT EXISTS idx_pallet_print_created_batch
  ON "PalletLabelPrint" (created_at DESC, batch_id);

-- ───────────────────────────────────────────────────────────────────────
-- 20260728_stocktake_paged_rpc.sql
-- ───────────────────────────────────────────────────────────────────────
-- Kiểm kê: phân trang SERVER cho 2 bảng lớn nhất của module.
--
-- VÌ SAO: cả 2 endpoint trước đây chặn cứng CAP 2000 dòng rồi treo cờ `truncated` để FE hiện
-- banner "thu hẹp phạm vi". Đo thật 28/07 trên staging: Kho Bàu Bàng có 8.074 pallet còn tồn
-- ⇒ người kiểm chỉ thấy 25% số pallet và KHÔNG có cách nào xem nốt. Ô thống kê thì đúng (đếm
-- trong DB) nên bảng và ô số đá nhau — kiểu sai khó phát hiện nhất.
--
-- Thiết kế: cùng khuôn với các trang đã phân trang (memory `server-pagination-campaign`):
--   • ORDER BY + OFFSET/LIMIT + COUNT nằm TRONG SQL, chung 1 mệnh đề WHERE ⇒ tổng/thứ tự/trang
--     không thể lệch nhau.
--   • Danh sách vị trí truyền qua THAM SỐ MẢNG của RPC (POST body) — không đi qua URL nên thoát
--     cả 2 trần id-trong-URL (~300 id tới PostgREST, ~800 id tới Vercel). Kho 1.517 vị trí trước
--     đây phải chunk 300 → 6 lô × 4 câu đếm = 24 round-trip; giờ còn 1.
--   • plpgsql + force_custom_plan: LANGUAGE sql sinh generic plan, bỏ qua index khi tham số mảng
--     lớn (bẫy đã dính ở đợt phân trang Xuất kho — plan chung chạy >300s).
-- Scope kho/loại vẫn resolve ở backend (đã audit) rồi truyền id xuống — SQL không tự nới quyền.

-- ── 1. Tổng hợp kiểm kê (tab "Tổng hợp KK") ──────────────────────────────────
-- Trả ids của ĐÚNG 1 trang + tổng của TOÀN BỘ bộ lọc + 3 ô thống kê (đếm trên tập chưa lọc view).
CREATE OR REPLACE FUNCTION stocktake_entries_page(
  p_loc_ids text[],
  p_from    timestamptz,
  p_to      timestamptz,
  p_view    text,
  p_offset  int,
  p_limit   int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH base AS (
    SELECT e.id, e.stocktake_at, e.stocktake_flagged,
           (e.stocktake_at IS NOT NULL AND e.stocktake_at >= p_from AND e.stocktake_at <= p_to) AS is_checked
    FROM "InventoryEntry" e
    WHERE e.location_id = ANY (p_loc_ids)
      AND e.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING')
      AND e.cartons_remaining > 0          -- pallet đã xuất hết không phải việc của đợt kiểm
  ),
  f AS (
    SELECT * FROM base
    WHERE CASE p_view
            WHEN 'flagged'   THEN is_checked AND stocktake_flagged
            WHEN 'unchecked' THEN NOT is_checked
            WHEN 'checked'   THEN is_checked
            WHEN 'problem'   THEN (is_checked AND stocktake_flagged) OR NOT is_checked
            ELSE TRUE
          END
  ),
  pg AS (
    -- Thứ tự phải KHỚP đường cũ: chưa kiểm lên đầu → trong nhóm thì lệch trước → cũ trước.
    -- (Đường cũ sort trong JS SAU khi đã cắt 2000 nên thứ tự chỉ đúng trong phần bị cắt.)
    SELECT id, row_number() OVER (
             ORDER BY is_checked, stocktake_flagged DESC, stocktake_at ASC NULLS FIRST, id
           ) rn
    FROM f
    ORDER BY is_checked, stocktake_flagged DESC, stocktake_at ASC NULLS FIRST, id
    OFFSET p_offset LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'ids',      COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb),
    'total',    (SELECT count(*) FROM f),
    'st_total', (SELECT count(*) FROM base),
    'checked',  (SELECT count(*) FROM base WHERE is_checked),
    'flagged',  (SELECT count(*) FROM base WHERE is_checked AND stocktake_flagged)
  ) INTO r;
  RETURN r;
END $$;

-- ── 2. Lịch sử kiểm (tab "Lịch sử kiểm", bảng StocktakeLog append-only) ──────
-- 1 lần quét kiểm = 1 dòng ⇒ kho 12k pallet kiểm hằng tháng là ~150k dòng/năm: CAP 2000 chặn
-- ngay tháng đầu. Lọc loại hàng giữ nguyên quy ước NULL-INCLUSIVE (dòng chưa khai loại vẫn hiện).
CREATE OR REPLACE FUNCTION stocktake_log_page(
  p_wh_ids     text[],
  p_loc_ids    text[],
  p_category   text,
  p_scope_cats text[],
  p_search     text,
  p_from       timestamptz,
  p_to         timestamptz,
  p_offset     int,
  p_limit      int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH f AS (
    SELECT s.id, s.counted_at, s.is_flagged, s.physical_qty
    FROM "StocktakeLog" s
    WHERE s.counted_at >= p_from AND s.counted_at <= p_to
      AND (p_wh_ids  IS NULL OR s.warehouse_id = ANY (p_wh_ids))
      AND (p_loc_ids IS NULL OR s.location_id  = ANY (p_loc_ids))
      AND (p_category IS NULL OR s.categories @> ARRAY[p_category])
      AND (p_scope_cats IS NULL OR s.categories IS NULL OR s.categories && p_scope_cats)
      AND (p_search IS NULL OR s.pallet_code ILIKE '%' || p_search || '%')
  ),
  pg AS (
    SELECT id, row_number() OVER (ORDER BY counted_at DESC, id) rn
    FROM f ORDER BY counted_at DESC, id OFFSET p_offset LIMIT p_limit
  )
  -- 3 ô SummaryBand phải đếm trên TOÀN BỘ bộ lọc. Đếm ở FE trên `rows` là đếm 1 trang, đứng
  -- cạnh ô "Lượt kiểm" (toàn bộ) → hai con số đá nhau mà không có gì báo.
  SELECT jsonb_build_object(
    'ids',     COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb),
    'total',   (SELECT count(*) FROM f),
    'counted', (SELECT count(*) FROM f WHERE physical_qty IS NOT NULL),
    'flagged', (SELECT count(*) FROM f WHERE is_flagged)
  ) INTO r;
  RETURN r;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260728b_pallet_prints_rpc_perf.sql
-- ───────────────────────────────────────────────────────────────────────
-- In tem pallet: sửa HIỆU NĂNG 2 RPC phân trang (thay thế bản trong 20260728_pallet_prints_paged_rpc.sql).
-- Giữ NGUYÊN chữ ký + hình dạng trả về — chỉ đổi cách tính.
--
-- ĐO THẬT 28/07 với 250.000 tem (≈3 tháng của kho in ~3.000 tem/ngày):
--   pallet_prints_page   6.674ms  → có lúc 500 "canceling statement due to statement timeout"
--   pallet_prints_facets 9.790ms
--
-- NGUYÊN NHÂN 1 — page: CTE `f` (mọi dòng khớp lọc) bị VẬT HOÁ rồi quét lại 5 lần; EXPLAIN cho
-- `temp read=4700 written=2350` ⇒ ghi ~18MB ra đĩa tạm chỉ để đếm. Sửa: gom thẳng thành cụm
-- phiếu in bằng 1 GROUP BY (kết quả 8.334 dòng, quét lại bao nhiêu lần cũng rẻ), lấy tổng TEM
-- bằng `sum(n)` thay vì đếm lần hai trên `f`, và lấy id của trang qua KHOẢNG created_at của
-- chính trang đó nên dùng được index thay vì quét bảng lần nữa. → 2.823ms, hết ghi temp.
--
-- NGUYÊN NHÂN 2 — facets: 5 lần `jsonb_agg(DISTINCT ...)` = 5 lần SORT toàn bộ dòng khớp lọc
-- (EXPLAIN: `external merge Disk` 2,4MB + 3,4MB + 2MB + 11,5MB + 6MB). Sửa: `GROUP BY GROUPING
-- SETS` — MỘT lượt quét, hash-agg riêng cho từng chiều, trả đúng tập giá trị phân biệt
-- (281kB bộ nhớ, không tràn đĩa). → 668ms, nhanh hơn 14,7 lần.
--
-- Bài học ghi lại: trong RPC phân trang, đừng vật hoá tập dòng thô rồi đếm nhiều lần trên nó —
-- gom về đơn vị hiển thị (cụm/phiếu) TRƯỚC rồi mới đếm. Và cần nhiều tập giá trị phân biệt
-- trong một lượt thì dùng GROUPING SETS, không dùng nhiều agg(DISTINCT).

CREATE OR REPLACE FUNCTION pallet_prints_page(
  p_wh_scope   text[],
  p_cat_scope  text[],
  p_from       timestamptz,
  p_to         timestamptz,
  p_search     text,
  p_modes      text[],
  p_materials  text[],
  p_cycles     text[],
  p_machines   text[],
  p_printers   text[],
  p_offset     int,
  p_limit      int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH b AS (
    -- Gom NGAY thành PHIẾU IN (đơn vị trang) — không vật hoá tập tem thô.
    -- Khoá phiếu = batch_id; log cũ chưa có batch_id thì gom theo created_at|mode|người in.
    SELECT COALESCE(p.batch_id::text,
                    p.created_at::text || '|' || p.mode || '|' || COALESCE(p.printed_by_name, '')) AS bkey,
           max(p.created_at) AS at, max(p.mode) AS md, count(*) AS n
    FROM "PalletLabelPrint" p
    WHERE (p_from IS NULL OR p.created_at >= p_from)
      AND (p_to   IS NULL OR p.created_at <= p_to)
      -- scope NULL-INCLUSIVE (dòng cũ chưa gắn kho/loại vẫn hiện) — giữ đúng quy ước toàn app
      AND (p_wh_scope  IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR p.category     IS NULL OR p.category     = ANY (p_cat_scope))
      AND (p_search    IS NULL OR p.qr_code ILIKE '%' || p_search || '%'
                               OR p.material_code ILIKE '%' || p_search || '%'
                               OR p.printed_by_name ILIKE '%' || p_search || '%')
      AND (p_modes     IS NULL OR p.mode            = ANY (p_modes))
      AND (p_materials IS NULL OR p.material_code   = ANY (p_materials))
      AND (p_cycles    IS NULL OR p.cycle           = ANY (p_cycles))
      AND (p_machines  IS NULL OR p.machine         = ANY (p_machines))
      AND (p_printers  IS NULL OR p.printed_by_name = ANY (p_printers))
    GROUP BY 1
  ),
  pg AS (SELECT bkey, at FROM b ORDER BY at DESC, bkey OFFSET p_offset LIMIT p_limit),
  -- Khoảng thời gian của ĐÚNG trang này → lấy id tem bằng index, không quét bảng lần hai
  w  AS (SELECT min(at) AS lo, max(at) AS hi FROM pg),
  ids AS (
    SELECT p.id
    FROM "PalletLabelPrint" p, w
    WHERE p.created_at >= w.lo AND p.created_at <= w.hi
      AND (p_wh_scope  IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR p.category     IS NULL OR p.category     = ANY (p_cat_scope))
      AND (p_search    IS NULL OR p.qr_code ILIKE '%' || p_search || '%'
                               OR p.material_code ILIKE '%' || p_search || '%'
                               OR p.printed_by_name ILIKE '%' || p_search || '%')
      AND (p_modes     IS NULL OR p.mode            = ANY (p_modes))
      AND (p_materials IS NULL OR p.material_code   = ANY (p_materials))
      AND (p_cycles    IS NULL OR p.cycle           = ANY (p_cycles))
      AND (p_machines  IS NULL OR p.machine         = ANY (p_machines))
      AND (p_printers  IS NULL OR p.printed_by_name = ANY (p_printers))
      AND COALESCE(p.batch_id::text,
                   p.created_at::text || '|' || p.mode || '|' || COALESCE(p.printed_by_name, ''))
          IN (SELECT bkey FROM pg)
  )
  SELECT jsonb_build_object(
    'ids',        COALESCE((SELECT jsonb_agg(id) FROM ids), '[]'::jsonb),
    'total',      (SELECT count(*) FROM b),                          -- tổng PHIẾU IN khớp lọc
    'total_rows', (SELECT COALESCE(sum(n), 0) FROM b),               -- tổng TEM khớp lọc
    'new_n',      (SELECT count(*) FROM b WHERE md <> 'REPRINT'),
    'reprint_n',  (SELECT count(*) FROM b WHERE md  = 'REPRINT')
  ) INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION pallet_prints_facets(
  p_wh_scope  text[],
  p_cat_scope text[],
  p_from      timestamptz,
  p_to        timestamptz,
  p_search    text
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH g AS (
    -- MỘT lượt quét, 5 hash key — thay 5 lần agg(DISTINCT) (mỗi lần 1 sort tràn đĩa)
    SELECT p.mode, p.material_code, p.cycle, p.machine, p.category, p.printed_by_name,
           grouping(p.mode)            AS g_mode,
           grouping(p.material_code)   AS g_mat,
           grouping(p.cycle)           AS g_cyc,
           grouping(p.machine)         AS g_mac,
           grouping(p.printed_by_name) AS g_prt
    FROM "PalletLabelPrint" p
    WHERE (p_from IS NULL OR p.created_at >= p_from)
      AND (p_to   IS NULL OR p.created_at <= p_to)
      AND (p_wh_scope  IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR p.category     IS NULL OR p.category     = ANY (p_cat_scope))
      AND (p_search    IS NULL OR p.qr_code ILIKE '%' || p_search || '%'
                               OR p.material_code ILIKE '%' || p_search || '%'
                               OR p.printed_by_name ILIKE '%' || p_search || '%')
    GROUP BY GROUPING SETS ((p.mode), (p.material_code), (p.cycle), (p.machine, p.category), (p.printed_by_name))
  )
  SELECT jsonb_build_object(
    'modes',     COALESCE((SELECT jsonb_agg(mode)          FROM g WHERE g_mode = 0 AND mode IS NOT NULL), '[]'::jsonb),
    'materials', COALESCE((SELECT jsonb_agg(material_code) FROM g WHERE g_mat  = 0 AND material_code IS NOT NULL), '[]'::jsonb),
    'cycles',    COALESCE((SELECT jsonb_agg(cycle)         FROM g WHERE g_cyc  = 0 AND cycle IS NOT NULL), '[]'::jsonb),
    -- Máy/NCC: nhãn hiển thị phụ thuộc loại hàng (hàng NCC hiện TÊN NCC) nên trả kèm category
    'machines',  COALESCE((SELECT jsonb_agg(jsonb_build_object('v', machine, 'c', category))
                           FROM g WHERE g_mac = 0 AND machine IS NOT NULL), '[]'::jsonb),
    'printers',  COALESCE((SELECT jsonb_agg(printed_by_name) FROM g WHERE g_prt = 0 AND printed_by_name IS NOT NULL), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260728c_inventory_summary_paged_rpc.sql
-- ───────────────────────────────────────────────────────────────────────
-- Tồn kho · view TỔNG HỢP: gom + phân trang NGAY TRONG SQL.
--
-- ĐO THẬT 28/07 với 52.635 pallet → 41.107 nhóm:
--   trước:            18.147KB / 12.798ms   (trả HẾT nhóm, FE tự slice → 4× trần 4,5MB Vercel)
--   sau bước 1 (JS):      87KB / 10.019ms   (payload đã cứu, nhưng MỖI lần đổi trang vẫn đọc lại
--                                            52.635 dòng qua PostgREST ⇒ duyệt 42 trang = 251s)
--   sau RPC này:          87KB / ~1s        (gom 1 lượt trong DB, chỉ trả 1 trang)
--
-- VÌ SAO GOM TRONG SQL: nhóm là đơn vị hiển thị, còn pallet là dữ liệu thô. Kéo 52.635 dòng thô
-- qua mạng để cộng lại trong Node là làm việc của DB ở sai chỗ — và làm lại nguyên vẹn ở MỖI
-- lần bấm sang trang.
--
-- %DATE CỐ TÌNH KHÔNG TÍNH Ở ĐÂY: shelf-life còn ngoại lệ theo NCC (`supplier_shelf_life_overrides`),
-- công thức phải nằm ở ĐÚNG MỘT chỗ là `utils/shelfLife.computePctDate` (BE↔FE khớp nhau — luật
-- CLAUDE.md). RPC trả các trường thô của nhóm (ngày SX, HSD, shelflife, NCC) để Node tính %Date
-- cho ĐÚNG 200 nhóm của trang. Khoá gom đã bao (production_date, ncc_id, shelf_life_days,
-- expiry_date) nên %Date của một nhóm là duy nhất — tính ở tầng nào cũng cùng kết quả.
--
-- Bộ lọc PHẢI KHỚP `applyInventoryFilters` (backend/src/controllers/wms/inventoryController.ts).
-- Đổi một bên mà quên bên kia = bảng và ô tổng lệch nhau. Riêng p_ids: khi lọc %Date, tầng TS đã
-- resolve sẵn tập id ĐÃ áp đủ mọi filter khác ⇒ chỉ cần lọc theo id (đi POST body, không dính
-- trần URL ~300 id).

CREATE OR REPLACE FUNCTION inventory_summary_page(
  p_ids            text[],   -- lọc %Date: tập id đã áp đủ filter khác (null = không dùng)
  p_status         text,     -- ''/null = "Còn tồn" (mặc định) · 'ALL' = mọi trạng thái · khác = đúng trạng thái đó
  p_wh_ids         text[],
  p_location_ids   text[],
  p_material_ids   text[],
  p_categories     text[],
  p_qa_ids         text[],
  p_search         text,
  p_search_mat_ids text[],
  p_search_loc_ids text[],
  p_manufacturer   text,
  p_cycles         text[],
  p_machines       text[],
  p_nmsx           text[],
  p_ncc_ids        text[],
  p_import_from    timestamptz,
  p_import_to      timestamptz,
  p_offset         int,
  p_limit          int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH e AS (
    SELECT COALESCE(l.warehouse_id, ie.warehouse_id::text) AS wh_id,
           ie.material_id, ie.production_date, ie.ncc_id, ie.shelf_life_days, ie.expiry_date,
           ie.cartons_imported, ie.cartons_remaining
    FROM "InventoryEntry" ie
    -- INNER JOIN = `material:Material!inner` ở select cũ: entry không có mã hàng bị loại HẲN
    JOIN "Material" m ON m.id = ie.material_id
    LEFT JOIN "Location" l ON l.id = ie.location_id
    WHERE (p_ids IS NULL OR ie.id = ANY (p_ids))
      -- "Còn tồn" = trạng thái hoạt động VÀ tồn > 0 (upload cho phép tồn=0 → không lọt list)
      AND (CASE
             WHEN p_status IS NULL OR p_status = '' THEN
               ie.status = ANY (ARRAY['IN_STOCK','PARTIAL','LOOSE_PICKING']) AND ie.cartons_remaining > 0
             WHEN p_status = 'ALL' THEN TRUE
             ELSE ie.status = p_status
           END)
      -- Lọc KHO đi thẳng cột warehouse_id (KHÔNG liệt kê vị trí của kho — bug 504 Bàu Bàng 27/07)
      AND (p_wh_ids       IS NULL OR ie.warehouse_id::text = ANY (p_wh_ids))
      AND (p_location_ids IS NULL OR ie.location_id  = ANY (p_location_ids))
      AND (p_material_ids IS NULL OR ie.material_id  = ANY (p_material_ids))
      AND (p_categories   IS NULL OR m.category      = ANY (p_categories))
      AND (p_qa_ids       IS NULL OR ie.qa_status_id = ANY (p_qa_ids))
      AND (p_manufacturer IS NULL OR ie.manufacturer_id = p_manufacturer)
      AND (p_cycles       IS NULL OR ie.cycle        = ANY (p_cycles))
      AND (p_machines     IS NULL OR ie.machine_code = ANY (p_machines))
      AND (p_nmsx         IS NULL OR ie.nmsx         = ANY (p_nmsx))
      AND (p_ncc_ids      IS NULL OR ie.ncc_id::text = ANY (p_ncc_ids))
      AND (p_import_from  IS NULL OR ie.import_date >= p_import_from)
      AND (p_import_to    IS NULL OR ie.import_date <= p_import_to)
      -- Omni-search: mã pallet HOẶC mã/tên hàng HOẶC mã vị trí (2 tập id resolve sẵn ở tầng TS)
      AND (p_search IS NULL
           OR ie.pallet_code ILIKE '%' || p_search || '%'
           OR (p_search_mat_ids IS NOT NULL AND ie.material_id = ANY (p_search_mat_ids))
           OR (p_search_loc_ids IS NOT NULL AND ie.location_id = ANY (p_search_loc_ids)))
  ),
  g AS (
    SELECT wh_id, material_id, production_date, ncc_id, shelf_life_days, expiry_date,
           sum(cartons_imported)  AS cartons_imported,
           sum(cartons_remaining) AS cartons_remaining,
           -- chỉ đếm pallet CÒN TỒN (user chốt 05/07)
           count(*) FILTER (WHERE cartons_remaining > 0) AS pallet_count
    FROM e
    GROUP BY 1,2,3,4,5,6
  ),
  gg AS (
    SELECT g.*, m.material_code, m.short_name, m.category, m.base_unit, m.entry_unit,
           m.units_per_carton, m.shelf_life_days AS mat_shelf_life_days,
           m.supplier_shelf_life_overrides,
           COALESCE(w.name, '—') AS warehouse_name, tc.name AS ncc_name
    FROM g
    JOIN "Material" m ON m.id = g.material_id
    LEFT JOIN "Warehouse" w ON w.id = g.wh_id
    LEFT JOIN "TransportCompany" tc ON tc.id = g.ncc_id
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM gg),
    -- BASE UNIT: tổng cross-mã phải quy đổi THEO TỪNG MÃ trước khi cộng (cộng base thô rồi gắn
    -- nhãn "thùng" là thổi tổng). Dùng chung helper qty_entry_decimal — mirror utils/qtyUnits.
    'total_cartons_remaining',
      (SELECT COALESCE(sum(qty_entry_decimal(cartons_remaining, entry_unit, units_per_carton)), 0) FROM gg),
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'warehouse_id',     wh_id,
               'warehouse_name',   warehouse_name,
               'material_id',      material_id,
               'material_code',    material_code,
               'short_name',       short_name,
               'category',         category,
               'production_date',  production_date,
               'expiry_date',      expiry_date,
               'ncc_id',           ncc_id,
               'ncc_name',         ncc_name,
               'shelf_life_days',  shelf_life_days,
               'mat_shelf_life_days', mat_shelf_life_days,
               'supplier_shelf_life_overrides', supplier_shelf_life_overrides,
               'cartons_imported',  cartons_imported,
               'cartons_remaining', cartons_remaining,
               'cartons_exported',  GREATEST(0, cartons_imported - cartons_remaining),
               'pallet_count',      pallet_count,
               'base_unit',         base_unit,
               'entry_unit',        entry_unit,
               'units_per_carton',  units_per_carton) ORDER BY ord)
      FROM (
        -- Sắp giống bản JS cũ: mã hàng ↑, tên kho ↑, ngày SX MỚI NHẤT trước
        SELECT gg.*, row_number() OVER (ORDER BY material_code, warehouse_name, production_date DESC NULLS LAST) AS ord
        FROM gg ORDER BY material_code, warehouse_name, production_date DESC NULLS LAST
        OFFSET p_offset LIMIT p_limit
      ) pg), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260728d_zone_used_pallets_rpc.sql
-- ───────────────────────────────────────────────────────────────────────
-- Dashboard · sức chứa KHU: gom "pallet đã dùng" trong SQL thay vì kéo cả bảng tồn về Node.
--
-- VÌ SAO: `computeZoneCapacity` thử gom bằng aggregate của PostgREST, nhưng project này TẮT
-- aggregate (`pgrst.db_aggregates_enabled` off) ⇒ nhánh `try` LUÔN thất bại và rơi xuống fallback
-- "gom trong JS": mỗi lần vào Dashboard kéo **toàn bộ dòng tồn đang hoạt động có vị trí** về.
-- Đo 28/07 với 52.635 pallet: dashboard 8,3s, trong đó RPC `dashboard_stats` chỉ 1,56s — gần 4s
-- còn lại là khâu kéo + gom này. Dashboard là trang ĐẦU TIÊN mọi người mở sau khi đăng nhập.
--
-- Giữ NGUYÊN công thức cũ để số không đổi:
--   pallet dùng của 1 (vị trí × mã) = nếu mã khai `pallet_per_ea` > 0 thì (tồn quy đổi THÙNG ×
--   pallet_per_ea), ngược lại = SỐ DÒNG tồn (mỗi dòng 1 pallet).
--   `qty_entry_decimal` = helper dùng chung, mirror `utils/qtyUnits.qtyEntryDecimal` (BASE UNIT:
--   pallet_per_ea tính trên THÙNG nên phải quy đổi base→thùng TRƯỚC khi nhân).
-- Chỉ tính vị trí `is_active` và có `sub_code` — đúng như vòng lặp cũ trên danh sách vị trí.

CREATE OR REPLACE FUNCTION zone_used_pallets(p_wh_ids text[])
RETURNS TABLE (warehouse_id text, sub_code text, used numeric)
LANGUAGE sql STABLE
AS $$
  WITH g AS (
    SELECT l.warehouse_id, l.sub_code, ie.material_id,
           count(*)                    AS n,
           sum(ie.cartons_remaining)   AS qty
    FROM "InventoryEntry" ie
    JOIN "Location" l ON l.id = ie.location_id
    WHERE ie.status = ANY (ARRAY['IN_STOCK','PARTIAL','QUARANTINE'])
      AND ie.cartons_remaining > 0
      AND l.sub_code IS NOT NULL
      AND l.is_active
      AND (p_wh_ids IS NULL OR ie.warehouse_id::text = ANY (p_wh_ids))
    GROUP BY 1, 2, 3
  )
  SELECT g.warehouse_id, g.sub_code,
         sum(CASE
               WHEN COALESCE(m.pallet_per_ea, 0) > 0
                 THEN qty_entry_decimal(g.qty, m.entry_unit, m.units_per_carton) * m.pallet_per_ea
               ELSE g.n
             END) AS used
  FROM g
  LEFT JOIN "Material" m ON m.id = g.material_id
  GROUP BY 1, 2
$$;

-- Gom theo vị trí của dòng tồn đang hoạt động.
CREATE INDEX IF NOT EXISTS idx_inventory_active_loc_mat
  ON "InventoryEntry" (location_id, material_id)
  WHERE status = ANY (ARRAY['IN_STOCK','PARTIAL','QUARANTINE']) AND cartons_remaining > 0;

-- ───────────────────────────────────────────────────────────────────────
-- 20260728e_leaves_paged_rpc.sql
-- ───────────────────────────────────────────────────────────────────────
-- Nghỉ phép: phân trang SERVER + 4 ô SummaryBand tính trong DB.
--
-- VÌ SAO: trang trả TOÀN BỘ đơn khớp lọc, và bộ lọc NGÀY MẶC ĐỊNH của trang là **từ 01/01 tới
-- hôm nay** (cả năm). Đo 28/07 với 6.001 đơn: 3.812KB — sát trần 4,5MB của Vercel, và ~650 B/đơn
-- nghĩa là công ty vài nghìn người (mỗi người vài đơn/năm) là vượt trần NGAY Ở MÀN HÌNH MẶC ĐỊNH.
-- Hàng rào `rowCapForBytes(650)` chặn đúng chỗ nhưng lại chặn chính màn hình mặc định ⇒ phải
-- phân trang thật, không thể chỉ dựa vào hàng rào.
--
-- Lọc CHỨC DANH cũng đưa xuống SQL: trước đây lọc ở client trên tập đã tải (`leavesRaw.filter`),
-- mà lọc client sau khi phân trang = lọc trên đúng 1 trang (số dòng và 4 ô tổng đều sai).
--
-- SCOPE KHO là vấn đề BẢO MẬT, không chỉ hiệu năng: đơn nghỉ có cột LÝ DO (dữ liệu cá nhân).
-- Ai có quyền `leave.view` chỉ được thấy đơn của nhân sự thuộc kho mình + đơn của CHÍNH MÌNH.
-- Tầng TS resolve danh sách id nhân sự trong scope rồi truyền vào `p_scope_emp_ids` (đi POST body
-- của RPC nên không dính trần ~300 id của URL). NULL = không giới hạn (superadmin / NATIONAL).

CREATE OR REPLACE FUNCTION hr_leaves_page(
  p_scope_emp_ids text[],   -- null = không giới hạn
  p_warehouse     text,
  p_dept          text,
  p_employee      text,
  p_jt_name       text,     -- lọc theo TÊN chức danh (trang hiển thị tên, không phải id)
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
      -- chồng lấn khoảng ngày: date_from <= đến AND date_to >= từ (giữ đúng ngữ nghĩa cũ)
      AND (p_to        IS NULL OR l.date_from <= p_to)
      AND (p_from      IS NULL OR l.date_to   >= p_from)
  )
  SELECT jsonb_build_object(
    'ids', COALESCE((SELECT jsonb_agg(id ORDER BY date_from DESC, id)
                     FROM (SELECT id, date_from FROM f
                           ORDER BY date_from DESC, id OFFSET p_offset LIMIT p_limit) pg), '[]'::jsonb),
    -- 4 ô SummaryBand đếm trên TOÀN BỘ bộ lọc (đếm ở FE = chỉ đếm trang đang xem)
    'total',    (SELECT count(*) FROM f),
    'pending',  (SELECT count(*) FROM f WHERE status = 'PENDING'),
    'approved', (SELECT count(*) FROM f WHERE status = 'APPROVED'),
    'rejected', (SELECT count(*) FROM f WHERE status = 'REJECTED')
  ) INTO r;
  RETURN r;
END $$;

-- Lọc chủ yếu theo nhân sự + sắp theo ngày bắt đầu giảm dần.
CREATE INDEX IF NOT EXISTS idx_leave_emp_from ON "LeaveRequest" (employee_id, date_from DESC);
CREATE INDEX IF NOT EXISTS idx_leave_from     ON "LeaveRequest" (date_from DESC);

-- ───────────────────────────────────────────────────────────────────────
-- 20260728f_tms_order_fk_indexes.sql
-- ───────────────────────────────────────────────────────────────────────
-- Index cho 2 cột KHOÁ NGOẠI của TmsOrder đang KHÔNG có index.
--
-- Postgres KHÔNG tự tạo index cho cột phía "con" của khoá ngoại. Thiếu index thì mỗi lần XOÁ /
-- UPDATE dòng phía "cha", Postgres phải QUÉT TOÀN BỘ bảng con để kiểm ràng buộc.
--
-- PHÁT HIỆN 28/07 (tình cờ khi dọn dữ liệu test): xoá 12.000 chuyến (`GroupDeliveryOrder`) bị
-- **statement timeout**, EXPLAIN chỉ ra `SELECT 1 FROM ONLY "TmsOrder" WHERE $1 = transfer_gdo_id
-- FOR KEY SHARE` — tức mỗi chuyến xoá là một lần quét 25.000 dòng TmsOrder.
--
-- ĐÂY LÀ ĐƯỜNG NGHIỆP VỤ THẬT, không phải chỉ chuyện dọn dữ liệu: "Bỏ hoàn thành" chuyến chuyển
-- kho có xoá chuyến kèm cascade xoá lệnh (memory outbound-transfer-all-modes). Với vài trăm nghìn
-- lệnh TmsOrder/năm, một cú xoá sẽ ngày càng lâu rồi timeout — mà người dùng chỉ thấy "không xoá
-- được", không có cách nào đoán ra nguyên nhân.
--
-- Cùng lý do cho `destination_warehouse_id` (đổi/xoá Kho phải quét bảng lệnh).

CREATE INDEX IF NOT EXISTS idx_tms_order_transfer_gdo
  ON "TmsOrder" (transfer_gdo_id) WHERE transfer_gdo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tms_order_dest_wh
  ON "TmsOrder" (destination_warehouse_id) WHERE destination_warehouse_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────
-- 20260728g_inventory_band_totals_rpc.sql
-- ───────────────────────────────────────────────────────────────────────
-- Tồn kho · 2 ô SummaryBand ("Thùng tồn" + "Pallet") gom trong MỘT lời gọi.
--
-- VÌ SAO (đo 28/07 bằng gói QA `06-readload` + đường cong sức chứa):
-- Mỗi lần đổi trang, `/wms/inventory` bắn 3 việc nặng song song, trong đó ô "Thùng tồn" là
-- tệ nhất — nó KHÔNG phải 1 query mà là một chuỗi round-trip:
--   (1) `fetchAllPaged` nạp nhóm SUM theo material_id (tới ~2.700 dòng, phân trang 1000/lần)
--   (2) rồi chunk 300 để tra `Material` lấy hệ số thùng, quy đổi trong Node.
-- Dưới tải ghi đồng thời, trang Tồn kho đi từ 1.955ms (0 người ghi) → **19.774ms ở 24 người ghi**
-- và vượt trần 8s của PostgREST thành 500. Câu NHẸ cùng lúc đó vẫn 1.147ms ⇒ nút thắt nằm ở
-- chính mấy việc nặng này, không phải DB bị bóp toàn cục (connection đỉnh chỉ 26/60).
--
-- Nay: 1 lời gọi, DB quét 1 lượt, quy đổi thùng ngay trong SQL bằng `qty_entry_decimal`
-- (helper dùng chung, mirror `utils/qtyUnits.qtyEntryDecimal` — BASE UNIT: phải quy đổi THEO
-- TỪNG MÃ rồi mới cộng, cộng base thô rồi gắn nhãn "thùng" là thổi tổng).
--
-- ⚠️ Mệnh đề WHERE phải KHỚP `applyInventoryFilters` (giống RPC inventory_summary_page) — lệch
-- một điều kiện là ô tổng và bảng đá nhau.

CREATE OR REPLACE FUNCTION inventory_band_totals(
  p_ids            text[],
  p_status         text,
  p_wh_ids         text[],
  p_location_ids   text[],
  p_material_ids   text[],
  p_categories     text[],
  p_qa_ids         text[],
  p_search         text,
  p_search_mat_ids text[],
  p_search_loc_ids text[],
  p_manufacturer   text,
  p_cycles         text[],
  p_machines       text[],
  p_nmsx           text[],
  p_ncc_ids        text[],
  p_import_from    timestamptz,
  p_import_to      timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH e AS (
    SELECT ie.material_id, ie.cartons_remaining
    FROM "InventoryEntry" ie
    JOIN "Material" m ON m.id = ie.material_id       -- = `material:Material!inner`
    WHERE (p_ids IS NULL OR ie.id = ANY (p_ids))
      AND (CASE
             WHEN p_status IS NULL OR p_status = '' THEN
               ie.status = ANY (ARRAY['IN_STOCK','PARTIAL','LOOSE_PICKING']) AND ie.cartons_remaining > 0
             WHEN p_status = 'ALL' THEN TRUE
             ELSE ie.status = p_status
           END)
      AND (p_wh_ids       IS NULL OR ie.warehouse_id::text = ANY (p_wh_ids))
      AND (p_location_ids IS NULL OR ie.location_id  = ANY (p_location_ids))
      AND (p_material_ids IS NULL OR ie.material_id  = ANY (p_material_ids))
      AND (p_categories   IS NULL OR m.category      = ANY (p_categories))
      AND (p_qa_ids       IS NULL OR ie.qa_status_id = ANY (p_qa_ids))
      AND (p_manufacturer IS NULL OR ie.manufacturer_id = p_manufacturer)
      AND (p_cycles       IS NULL OR ie.cycle        = ANY (p_cycles))
      AND (p_machines     IS NULL OR ie.machine_code = ANY (p_machines))
      AND (p_nmsx         IS NULL OR ie.nmsx         = ANY (p_nmsx))
      AND (p_ncc_ids      IS NULL OR ie.ncc_id::text = ANY (p_ncc_ids))
      AND (p_import_from  IS NULL OR ie.import_date >= p_import_from)
      AND (p_import_to    IS NULL OR ie.import_date <= p_import_to)
      AND (p_search IS NULL
           OR ie.pallet_code ILIKE '%' || p_search || '%'
           OR (p_search_mat_ids IS NOT NULL AND ie.material_id = ANY (p_search_mat_ids))
           OR (p_search_loc_ids IS NOT NULL AND ie.location_id = ANY (p_search_loc_ids)))
  ),
  g AS (
    SELECT e.material_id, sum(e.cartons_remaining) AS rem,
           -- ô "Pallet" chỉ đếm pallet CÒN TỒN (>0): list chỉ hiện pallet 0 khi chọn "Tất cả"
           count(*) FILTER (WHERE e.cartons_remaining > 0) AS n_pallet
    FROM e GROUP BY 1
  )
  SELECT jsonb_build_object(
    'total_cartons_remaining',
      (SELECT COALESCE(sum(qty_entry_decimal(g.rem, m.entry_unit, m.units_per_carton)), 0)
       FROM g JOIN "Material" m ON m.id = g.material_id),
    'total_pallets_in_stock', (SELECT COALESCE(sum(n_pallet), 0) FROM g)
  ) INTO r;
  RETURN r;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260728h_pallet_prints_page_returns_rows.sql
-- ───────────────────────────────────────────────────────────────────────
-- In tem pallet · `pallet_prints_page` trả LUÔN CÁC DÒNG (jsonb) thay vì trả danh sách id.
-- Chữ ký (tham số) KHÔNG đổi; chỉ đổi khoá trả về: `ids` → `rows`.
--
-- VÌ SAO (đo thật 28/07, phép đo phân biệt tầng dưới tải 24 luồng ghi):
-- Cái làm trang này gãy KHÔNG phải máy Postgres. Đo song song 3 đường đi cùng một câu CỰC NHẸ:
--     pg trực tiếp (bỏ qua PostgREST)   p50 309ms · p95   338ms   ← máy DB hoàn toàn khoẻ
--     PostgREST trực tiếp               p50 182ms · p95 2.432ms   ← XẾP HÀNG ở đây
--     qua backend                       p50 680ms · p95 5.023ms
-- Đỉnh connection chỉ 24/60, riêng `postgrest` giữ 11 ⇒ nút thắt là **pool ~10 khe NỘI BỘ của
-- PostgREST**, không phải `max_connections`. Mỗi request HTTP tới PostgREST tốn 1 khe và 3 câu SQL
-- (`set_config` + câu thật + `COMMIT`).
--
-- Mà 1 lần mở trang Lịch sử in tem = **11 request PostgREST**: 1 RPC lấy id + **10 lần nạp chunk 300**
-- (100 phiếu × ~30 tem ≈ 3.000 id). Đo: 6.818ms/trang, và dưới tải thì 24.230ms + lỗi 500 thật
-- "canceling statement due to statement timeout".
-- Nay RPC trả thẳng dòng ⇒ **1 request**. Tem đã lọc/gom xong trong DB nên không có gì phải nạp lại.
--
-- Luật rút ra (áp cho mọi RPC phân trang mới): **RPC trả về DÒNG, đừng trả id rồi để backend đi
-- nạp lại** — trả id biến 1 request thành 1 + n/300 request, mỗi request lại chen 1 khe pool.
-- Sắp xếp cũng làm trong SQL luôn (trước đây backend sort lại trong JS sau khi ghép chunk).

CREATE OR REPLACE FUNCTION pallet_prints_page(
  p_wh_scope   text[],
  p_cat_scope  text[],
  p_from       timestamptz,
  p_to         timestamptz,
  p_search     text,
  p_modes      text[],
  p_materials  text[],
  p_cycles     text[],
  p_machines   text[],
  p_printers   text[],
  p_offset     int,
  p_limit      int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH b AS (
    -- Gom NGAY thành PHIẾU IN (đơn vị trang) — không vật hoá tập tem thô.
    -- Khoá phiếu = batch_id; log cũ chưa có batch_id thì gom theo created_at|mode|người in.
    SELECT COALESCE(p.batch_id::text,
                    p.created_at::text || '|' || p.mode || '|' || COALESCE(p.printed_by_name, '')) AS bkey,
           max(p.created_at) AS at, max(p.mode) AS md, count(*) AS n
    FROM "PalletLabelPrint" p
    WHERE (p_from IS NULL OR p.created_at >= p_from)
      AND (p_to   IS NULL OR p.created_at <= p_to)
      -- scope NULL-INCLUSIVE (dòng cũ chưa gắn kho/loại vẫn hiện) — giữ đúng quy ước toàn app
      AND (p_wh_scope  IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR p.category     IS NULL OR p.category     = ANY (p_cat_scope))
      AND (p_search    IS NULL OR p.qr_code ILIKE '%' || p_search || '%'
                               OR p.material_code ILIKE '%' || p_search || '%'
                               OR p.printed_by_name ILIKE '%' || p_search || '%')
      AND (p_modes     IS NULL OR p.mode            = ANY (p_modes))
      AND (p_materials IS NULL OR p.material_code   = ANY (p_materials))
      AND (p_cycles    IS NULL OR p.cycle           = ANY (p_cycles))
      AND (p_machines  IS NULL OR p.machine         = ANY (p_machines))
      AND (p_printers  IS NULL OR p.printed_by_name = ANY (p_printers))
    GROUP BY 1
  ),
  pg AS (SELECT bkey, at FROM b ORDER BY at DESC, bkey OFFSET p_offset LIMIT p_limit),
  -- Khoảng thời gian của ĐÚNG trang này → lấy tem bằng index, không quét bảng lần hai
  w  AS (SELECT min(at) AS lo, max(at) AS hi FROM pg),
  t AS (
    SELECT p.id, p.batch_id, p.qr_code, p.material_code, p.category, p.cycle, p.machine,
           p.seq, p.nmsx, p.qty, p.mode, p.printed_by_name, p.created_at
    FROM "PalletLabelPrint" p, w
    WHERE p.created_at >= w.lo AND p.created_at <= w.hi
      AND (p_wh_scope  IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR p.category     IS NULL OR p.category     = ANY (p_cat_scope))
      AND (p_search    IS NULL OR p.qr_code ILIKE '%' || p_search || '%'
                               OR p.material_code ILIKE '%' || p_search || '%'
                               OR p.printed_by_name ILIKE '%' || p_search || '%')
      AND (p_modes     IS NULL OR p.mode            = ANY (p_modes))
      AND (p_materials IS NULL OR p.material_code   = ANY (p_materials))
      AND (p_cycles    IS NULL OR p.cycle           = ANY (p_cycles))
      AND (p_machines  IS NULL OR p.machine         = ANY (p_machines))
      AND (p_printers  IS NULL OR p.printed_by_name = ANY (p_printers))
      AND COALESCE(p.batch_id::text,
                   p.created_at::text || '|' || p.mode || '|' || COALESCE(p.printed_by_name, ''))
          IN (SELECT bkey FROM pg)
  )
  SELECT jsonb_build_object(
    -- Sắp xếp NGAY trong SQL (mới nhất trước) — backend không phải ghép chunk rồi sort lại
    'rows',       COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC, x.id) FROM t x), '[]'::jsonb),
    'total',      (SELECT count(*) FROM b),                          -- tổng PHIẾU IN khớp lọc
    'total_rows', (SELECT COALESCE(sum(n), 0) FROM b),               -- tổng TEM khớp lọc
    'new_n',      (SELECT count(*) FROM b WHERE md <> 'REPRINT'),
    'reprint_n',  (SELECT count(*) FROM b WHERE md  = 'REPRINT')
  ) INTO r;
  RETURN r;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260728i_zone_capacity_one_call.sql
-- ───────────────────────────────────────────────────────────────────────
-- Dashboard · dải "Sức chứa theo khu" gom về MỘT lời gọi: `zone_capacity_rows`.
-- Thay `zone_used_pallets` (chỉ trả pallet đã dùng) — nay trả LUÔN cả danh sách khu + sức chứa +
-- tên kho, đã lọc loại hàng và đã SẮP XẾP đúng thứ tự hiển thị.
--
-- VÌ SAO (đo 28/07): Dashboard tự nó chỉ tốn ~267ms trong DB, nhưng nó bắn **5 request PostgREST**
-- mỗi lần vào trang (2× WarehouseZone phân trang, 1× Warehouse, 1× dashboard_stats, 1× zone_used_pallets).
-- Dưới tải 24 luồng ghi nó lên 22.422ms — KHÔNG phải vì tự nó nặng, mà vì mỗi request phải chờ khe
-- trong pool ~10 khe NỘI BỘ của PostgREST (phép đo phân biệt tầng: pg trực tiếp p95 338ms — máy DB
-- hoàn toàn khoẻ). Với hàng đợi thì độ trễ ≈ SỐ REQUEST × thời gian chờ ⇒ giảm số request là đòn
-- trực tiếp, kể cả với đường vốn đã rẻ. Dashboard là trang ai cũng mở đầu tiên nên đáng làm.
-- Nay: 5 request → 2 (dashboard_stats + hàm này).
--
-- GIỮ NGUYÊN NGỮ NGHĨA (số phải khớp tuyệt đối với đường cũ, đã verify 15/15 khu):
--   · chỉ khu `is_active`; chỉ vị trí `is_active` và có `sub_code`
--   · lọc loại hàng NULL-INCLUSIVE: khu không khai loại VẪN hiện (quy ước toàn app)
--   · quy đổi pallet theo `pallet_per_ea` qua `qty_entry_decimal` (BASE UNIT: quy đổi THEO TỪNG MÃ
--     rồi mới cộng — cộng base thô rồi gắn nhãn "pallet" là thổi tổng)
--   · `category` trả về là chuỗi các loại nối bằng ', ' (FE hiển thị thẳng, giữ đúng payload cũ)
--   · thứ tự: tên kho → sort_order → mã khu

CREATE OR REPLACE FUNCTION zone_capacity_rows(
  p_wh_ids     text[],
  p_categories text[]
) RETURNS TABLE (
  zone_id        text,
  warehouse_id   text,
  warehouse_name text,
  code           text,
  name           text,
  category       text,
  capacity       numeric,
  used           numeric
)
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
BEGIN
  RETURN QUERY
  WITH z AS (
    SELECT wz.id, wz.warehouse_id, wz.code, wz.name, wz.categories,
           wz.sort_order, COALESCE(wz.max_pallets, 0) AS cap
    FROM "WarehouseZone" wz
    WHERE wz.is_active
      AND (p_wh_ids IS NULL OR wz.warehouse_id = ANY (p_wh_ids))
      -- null-inclusive: khu chưa khai loại vẫn hiện; khai rồi thì cần GIAO ≥1 loại
      AND (p_categories IS NULL
           OR wz.categories IS NULL
           OR cardinality(wz.categories) = 0
           OR wz.categories && p_categories)
  ),
  -- ⚠️ Thân 2 CTE dưới đây là NGUYÊN VĂN `zone_used_pallets` (migration 20260728d) — bản đã verify
  -- khớp 15/15 khu với đường tính cũ. CỐ Ý copy thay vì tự diễn giải lại: lần đầu viết lại "cho
  -- gọn" tôi làm lệch 4 điểm (thiếu lọc status, thiếu cartons_remaining>0, truyền sai tham số thứ 3
  -- của qty_entry_decimal, và bỏ nhánh "mã KHÔNG khai pallet_per_ea thì đếm SỐ DÒNG") → used sai
  -- gấp hàng nghìn lần. Sửa công thức pallet-đã-dùng thì phải sửa CẢ HAI hàm cho khớp.
  g AS (
    SELECT l.warehouse_id, l.sub_code, ie.material_id,
           count(*)                  AS n,
           sum(ie.cartons_remaining) AS qty
    FROM "InventoryEntry" ie
    JOIN "Location" l ON l.id = ie.location_id
    WHERE ie.status = ANY (ARRAY['IN_STOCK','PARTIAL','QUARANTINE'])
      AND ie.cartons_remaining > 0
      AND l.sub_code IS NOT NULL
      AND l.is_active
      AND (p_wh_ids IS NULL OR ie.warehouse_id::text = ANY (p_wh_ids))
    GROUP BY 1, 2, 3
  ),
  u AS (
    SELECT g.warehouse_id AS wh, g.sub_code AS sub,
           sum(CASE
                 WHEN COALESCE(m.pallet_per_ea, 0) > 0
                   THEN qty_entry_decimal(g.qty, m.entry_unit, m.units_per_carton) * m.pallet_per_ea
                 ELSE g.n
               END) AS used
    FROM g
    LEFT JOIN "Material" m ON m.id = g.material_id
    GROUP BY 1, 2
  )
  -- CAST TƯỜNG MINH từng cột: `WarehouseZone.id` là uuid, `code`/`name` là varchar, `max_pallets`
  -- là integer — khai text/numeric mà không cast thì RPC chết với "structure of query does not
  -- match function result type", và ở Dashboard lỗi đó bị `.catch()` nuốt thành DẢI RỖNG (không
  -- báo gì). Đã dính đúng bẫy này khi viết hàm.
  SELECT z.id::text, z.warehouse_id::text,
         COALESCE(w.name, z.warehouse_id)::text,
         z.code::text, z.name::text,
         (CASE WHEN z.categories IS NULL OR cardinality(z.categories) = 0
               THEN NULL ELSE array_to_string(z.categories, ', ') END)::text,
         z.cap::numeric,
         round(COALESCE(u.used, 0)::numeric, 1)
  FROM z
  LEFT JOIN "Warehouse" w ON w.id = z.warehouse_id
  LEFT JOIN u ON u.wh = z.warehouse_id AND u.sub = z.code
  ORDER BY COALESCE(w.name, z.warehouse_id), COALESCE(z.sort_order, 1000000000), z.code;
END $$;

COMMIT;