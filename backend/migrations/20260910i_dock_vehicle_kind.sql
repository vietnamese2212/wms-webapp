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
