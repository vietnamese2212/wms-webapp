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
