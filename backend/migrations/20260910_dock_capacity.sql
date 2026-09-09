-- ============================================================================
-- 20260910 — CỬA XUẤT CÓ SỨC CHỨA XE + CHUYẾN GHI CỬA (Directed Work đợt 1a — user chốt 09/09/2026)
-- ============================================================================
-- VÌ SAO: kế hoạch lấy hàng (đợt 1c) tính đường đi TỪ CỬA mà chuyến hiện không ghi đậu cửa nào; Ba Vì có
-- 5 cửa xuất. User chốt: "chuyến phải ghi cửa, cửa có tối đa xe, xe hoàn thành đơn thì xe tiếp theo mới
-- chọn được, thủ kho chọn cửa lúc Bắt đầu; kho nào có cửa trên bản vẽ thì kho đó mới bắt".
--
-- MÔ HÌNH:
--   • `Location.dock_capacity` = số XE tối đa đứng cùng lúc ở cửa (chỉ có nghĩa với kind DOCK_OUT/DOCK_IN).
--     NULL = không giới hạn. Cửa đã có trên bản vẽ backfill = 1 (một xe một cửa là mặc định an toàn).
--     Điểm đầu dãy (DROP) KHÔNG dùng cột này — sức chứa pallet chờ của nó là `max_pallets` (0 = không giới hạn).
--   • `GroupDeliveryOrder.dock_location_id` + `dock_assigned_at`: chuyến đậu cửa nào từ lúc nào. GIỮ LẠI sau
--     Hoàn thành (báo cáo cửa nào bốc chuyến nào) — suất cửa được nhả theo TRẠNG THÁI, không theo cột:
--     chuyến chiếm suất khi status IN ('IN_PROGRESS','PAUSED').
--   • Đếm theo XE, không theo chuyến: cùng biển số đang ở cửa thì chuyến thứ hai gắn cùng cửa KHÔNG tốn
--     suất (một xe bốc nhiều đơn là ca thường). Chuyến không biển (đã duyệt bỏ cổng) đếm là một xe.
--   • Gán cửa đi qua RPC khoá dòng cửa (FOR UPDATE) — hai thủ kho bấm cùng lúc chỉ một người lấy suất cuối.
--
-- KHÔNG đụng hành vi hiện có: cột nullable; startGDO chỉ đòi cửa khi kho CÓ cửa xuất trên bản vẽ.
-- ============================================================================

-- ── 1. Sức chứa xe của cửa ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public."Location" ADD COLUMN IF NOT EXISTS dock_capacity integer;
ALTER TABLE public."Location" DROP CONSTRAINT IF EXISTS location_dock_capacity_range;
ALTER TABLE public."Location" ADD CONSTRAINT location_dock_capacity_range
  CHECK (dock_capacity IS NULL OR (dock_capacity >= 1 AND dock_capacity <= 50));
COMMENT ON COLUMN public."Location".dock_capacity IS 'Số xe tối đa đứng cùng lúc ở cửa (kind DOCK_OUT/DOCK_IN). NULL = không giới hạn. Không dùng cho STORAGE/DROP.';

-- Cửa đã vẽ trước migration này: mặc định 1 xe / cửa
UPDATE public."Location" SET dock_capacity = 1
 WHERE kind IN ('DOCK_OUT', 'DOCK_IN') AND dock_capacity IS NULL;

-- ── 2. Chuyến ghi cửa ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public."GroupDeliveryOrder"
  ADD COLUMN IF NOT EXISTS dock_location_id text REFERENCES public."Location"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dock_assigned_at timestamptz;
COMMENT ON COLUMN public."GroupDeliveryOrder".dock_location_id IS 'Cửa xuất (Location kind DOCK_OUT) chuyến đậu — chọn lúc Bắt đầu. Giữ lại sau Hoàn thành; suất cửa tính theo status IN_PROGRESS/PAUSED.';
COMMENT ON COLUMN public."GroupDeliveryOrder".dock_assigned_at IS 'Lúc gán cửa (đổi cửa giữa chuyến thì cập nhật).';

-- Đếm xe đang chiếm cửa: chỉ dòng đang chiếm suất
CREATE INDEX IF NOT EXISTS idx_gdo_dock_active
  ON public."GroupDeliveryOrder" (dock_location_id)
  WHERE dock_location_id IS NOT NULL AND status IN ('IN_PROGRESS', 'PAUSED');

-- ── 3. RPC gán cửa cho chuyến — khoá dòng cửa, đếm XE ────────────────────────────────────────────
-- p_plate = biển số ĐÃ CHUẨN HOÁ của chuyến sắp bắt đầu (chưa nằm trên dòng lúc Bắt đầu) — NULL = chuyến không biển.
-- Trả jsonb:
--   {ok:true, occupied, capacity}
--   {ok:false, error:'NOT_FOUND'|'NOT_DOCK'|'WRONG_WAREHOUSE'|'DOCK_FULL', occupied, capacity, plates:[...]}
-- Không GRANT (default đã đóng PUBLIC — backend đi service_role).
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
  -- Khoá dòng cửa TRƯỚC: mọi lượt gán vào cùng cửa xếp hàng sau nhau
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

  -- Xe đang chiếm cửa (trừ chính chuyến này): biển khác nhau = xe khác nhau; không biển = mỗi chuyến một xe
  WITH occ AS (
    SELECT g.license_plate
      FROM public."GroupDeliveryOrder" g
     WHERE g.dock_location_id = p_dock_id
       AND g.status IN ('IN_PROGRESS', 'PAUSED')
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

  UPDATE public."GroupDeliveryOrder"
     SET dock_location_id = p_dock_id, dock_assigned_at = now(), updated_at = now()
   WHERE id = p_gdo_id;

  RETURN jsonb_build_object('ok', true, 'occupied', v_occ + (CASE WHEN v_same THEN 0 ELSE 1 END),
                            'capacity', v_dock.dock_capacity, 'dock_name', v_dock.row, 'dock_code', v_dock.location_code);
END;
$$;

-- ── 4. RPC tình trạng các cửa của một kho — 1 round-trip, nuôi ô chọn cửa lúc Bắt đầu + lớp phủ Cửa ──
-- Mỗi cửa: sức chứa, số xe đang chiếm, danh sách chuyến đang ở cửa (biển, mã chuyến, giờ vào cửa, trạng thái).
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
     WHERE g.status IN ('IN_PROGRESS', 'PAUSED')
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
