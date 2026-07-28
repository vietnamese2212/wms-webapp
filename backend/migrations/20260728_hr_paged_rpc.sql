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
