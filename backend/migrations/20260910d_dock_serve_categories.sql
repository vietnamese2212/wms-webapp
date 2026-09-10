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
