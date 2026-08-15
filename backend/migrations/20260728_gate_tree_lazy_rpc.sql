-- Đăng ký cổng: CÂY LƯỜI (user chốt 28/07) thay cho "tải hết rồi dựng cây ở máy".
-- Trang này KHÔNG phải list phẳng mà là cây gập/mở 3 cấp Kho → Loại kho → Loại xe, nên không
-- áp khuôn phân trang của Nhập/Xuất/Kế hoạch VC được (gập nhóm + phân trang đá nhau). Cách dùng:
--   gate_tree        → thống kê TỪNG NHÓM + tổng SummaryBand (nhẹ: vài chục–vài trăm dòng nhóm)
--   gate_leaves_page → dòng chi tiết theo ĐÚNG thứ tự cây, cuộn tới đâu lấy tới đó
--
-- ⚠️ THỨ TỰ CÂY DO FE QUYẾT (kho theo TÊN, loại kho theo thứ tự Cài đặt WMS, loại xe theo Cài đặt
-- TMS + "Chỉ trả pallet/Khác" xuống cuối). Không chép các quy tắc đó vào SQL (sẽ lệch nhau lúc
-- người dùng đổi cài đặt) — FE gửi xuống 3 MẢNG THỨ TỰ đã sắp sẵn, SQL chỉ `array_position`.
--
-- ⚠️ plpgsql + force_custom_plan: bài học 27/07 (hàm LANGUAGE sql bị generic plan → nested loop).

CREATE INDEX IF NOT EXISTS idx_gate_reg_date_wh
  ON gate_registrations (date DESC, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_gate_reg_group_order
  ON gate_registrations (warehouse_id, warehouse_type, vehicle_type, booking_slot_from, registered_at);

-- ── THỐNG KÊ NHÓM + TỔNG ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS gate_tree(date, date, text, text, text[], uuid, text, text, text[], text[]);
CREATE FUNCTION gate_tree(
  p_date_from     date,
  p_date_to       date,
  p_warehouse_id  text   DEFAULT NULL,
  p_warehouse_type text  DEFAULT NULL,
  p_vehicle_types text[] DEFAULT NULL,
  p_company_id    uuid   DEFAULT NULL,
  p_direction     text   DEFAULT NULL,
  p_status        text   DEFAULT NULL,
  p_scope_wh      text[] DEFAULT NULL,     -- scope kho (NULL = đủ quyền)
  p_categories    text[] DEFAULT NULL      -- scope Loại hàng (NULL = đủ quyền)
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH f AS (
    SELECT g.warehouse_id, g.warehouse_type, g.vehicle_type, g.status
    FROM gate_registrations g
    WHERE g.date >= p_date_from AND g.date <= p_date_to
      AND (p_warehouse_id   IS NULL OR g.warehouse_id   = p_warehouse_id)
      AND (p_warehouse_type IS NULL OR g.warehouse_type = p_warehouse_type)
      AND (p_vehicle_types  IS NULL OR COALESCE(g.vehicle_type, '') = ANY (p_vehicle_types))
      AND (p_company_id     IS NULL OR g.company_id     = p_company_id)
      AND (p_direction      IS NULL OR g.direction      = p_direction)
      AND (p_status         IS NULL OR g.status         = p_status)
      AND (p_scope_wh       IS NULL OR g.warehouse_id   = ANY (p_scope_wh))
      -- null-inclusive + 'Khác' luôn hiện (mirror listGateRegistrations)
      AND (p_categories IS NULL OR g.warehouse_type IS NULL OR g.warehouse_type = 'Khác'
           OR g.warehouse_type = ANY (p_categories))
  ),
  nodes AS (
    SELECT COALESCE(warehouse_id, '') AS wh, warehouse_type AS wt, vehicle_type AS vt,
           count(*) AS total,
           count(*) FILTER (WHERE status = 'COMPLETED') AS done,
           count(*) FILTER (WHERE status = 'IN')        AS inside,
           count(*) FILTER (WHERE status IN ('REGISTERED', 'CALLED')) AS waiting
    FROM f GROUP BY 1, 2, 3
  )
  SELECT jsonb_build_object(
    'nodes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'wh', wh, 'wt', wt, 'vt', vt,
                'total', total, 'done', done, 'inside', inside, 'waiting', waiting)) FROM nodes), '[]'::jsonb),
    'totals', jsonb_build_object(
                'total',   (SELECT count(*) FROM f),
                'done',    (SELECT count(*) FROM f WHERE status = 'COMPLETED'),
                'inside',  (SELECT count(*) FROM f WHERE status = 'IN'),
                'waiting', (SELECT count(*) FROM f WHERE status IN ('REGISTERED', 'CALLED')))
  ) INTO result;
  RETURN result;
END $$;

-- ── DÒNG CHI TIẾT THEO THỨ TỰ CÂY (cuộn tới đâu lấy tới đó) ─────────────────────────────────────
DROP FUNCTION IF EXISTS gate_leaves_page(int, int, date, date, text, text, text[], uuid, text, text, text[], text[], text[], text[], text[], text[], text[], text[]);
DROP FUNCTION IF EXISTS gate_leaves_page(int, int, date, date, text, text, text[], uuid, text, text, text[], text[], text[], text[], text[], text[], text[], text[], text, text);
CREATE FUNCTION gate_leaves_page(
  p_offset        int,
  p_limit         int,
  p_date_from     date,
  p_date_to       date,
  p_warehouse_id  text   DEFAULT NULL,
  p_warehouse_type text  DEFAULT NULL,
  p_vehicle_types text[] DEFAULT NULL,
  p_company_id    uuid   DEFAULT NULL,
  p_direction     text   DEFAULT NULL,
  p_status        text   DEFAULT NULL,
  p_scope_wh      text[] DEFAULT NULL,
  p_categories    text[] DEFAULT NULL,
  p_wh_order      text[] DEFAULT NULL,     -- thứ tự nhóm do FE sắp (kho / loại kho / loại xe)
  p_wt_order      text[] DEFAULT NULL,
  p_vt_order      text[] DEFAULT NULL,
  p_collapsed_wh  text[] DEFAULT NULL,     -- nhóm ĐANG GẬP → bỏ qua dòng của nhóm đó
  p_collapsed_wt  text[] DEFAULT NULL,     -- phần tử = '<wh>|<wt>'
  p_collapsed_vt  text[] DEFAULT NULL,     -- phần tử = '<wh>|<wt>|<vt>'
  -- Nhãn nhóm RỖNG do FE quy định (vd '— Chưa rõ loại kho —'): dùng CHUNG một khoá cho cả thứ tự,
  -- trạng thái gập và nhóm hiển thị — tránh 2 hệ khoá lệch nhau giữa FE và SQL.
  p_wt_null       text   DEFAULT '∅',
  p_vt_null       text   DEFAULT '∅'
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH f AS (
    SELECT g.id, COALESCE(g.warehouse_id, '') AS wh,
           COALESCE(g.warehouse_type, p_wt_null) AS wt_key, COALESCE(g.vehicle_type, p_vt_null) AS vt_key,
           g.warehouse_type, g.vehicle_type, g.booking_slot_from, g.registered_at
    FROM gate_registrations g
    WHERE g.date >= p_date_from AND g.date <= p_date_to
      AND (p_warehouse_id   IS NULL OR g.warehouse_id   = p_warehouse_id)
      AND (p_warehouse_type IS NULL OR g.warehouse_type = p_warehouse_type)
      AND (p_vehicle_types  IS NULL OR COALESCE(g.vehicle_type, '') = ANY (p_vehicle_types))
      AND (p_company_id     IS NULL OR g.company_id     = p_company_id)
      AND (p_direction      IS NULL OR g.direction      = p_direction)
      AND (p_status         IS NULL OR g.status         = p_status)
      AND (p_scope_wh       IS NULL OR g.warehouse_id   = ANY (p_scope_wh))
      AND (p_categories IS NULL OR g.warehouse_type IS NULL OR g.warehouse_type = 'Khác'
           OR g.warehouse_type = ANY (p_categories))
  ),
  vis AS (   -- bỏ dòng thuộc nhóm đang GẬP (mọi cấp)
    SELECT * FROM f
    WHERE NOT (p_collapsed_wh IS NOT NULL AND wh = ANY (p_collapsed_wh))
      AND NOT (p_collapsed_wt IS NOT NULL AND (wh || '|' || wt_key) = ANY (p_collapsed_wt))
      AND NOT (p_collapsed_vt IS NOT NULL AND (wh || '|' || wt_key || '|' || vt_key) = ANY (p_collapsed_vt))
  ),
  ord AS (
    SELECT id,
           COALESCE(array_position(p_wh_order, wh),     999999) AS o1,
           COALESCE(array_position(p_wt_order, wt_key), 999999) AS o2,
           COALESCE(array_position(p_vt_order, vt_key), 999999) AS o3,
           booking_slot_from, registered_at
    FROM vis
  )
  SELECT jsonb_build_object(
    'ids', COALESCE((SELECT jsonb_agg(id ORDER BY o1, o2, o3, booking_slot_from NULLS LAST, registered_at NULLS FIRST, id)
                     FROM (SELECT * FROM ord
                           ORDER BY o1, o2, o3, booking_slot_from NULLS LAST, registered_at NULLS FIRST, id
                           LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)) w), '[]'::jsonb),
    'total', (SELECT count(*) FROM vis)
  ) INTO result;
  RETURN result;
END $$;
