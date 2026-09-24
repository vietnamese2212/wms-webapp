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
