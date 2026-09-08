-- 20260908b — Ô có KÍCH THƯỚC trên bản vẽ (user bổ sung ngay khi đang dựng đợt 0).
--
-- Hai tầng kích thước:
--   • `warehouse_maps.cell_m` (đã có) = một ô lưới bằng mấy mét → khoảng cách ra MÉT = số ô × cell_m.
--   • `Location.grid_w/grid_h` (thêm ở đây) = vị trí chiếm mấy ô lưới. Ô kệ = 1×1; ô sàn xếp khối
--     32 pallet phải vẽ thành khối 4×8 thì bản vẽ mới giống kho thật và ô chắn mới đúng chỗ.
--   Neo (grid_x, grid_y) = góc trên-trái của khối; các tầng cùng chân kệ dùng chung neo + kích thước.
ALTER TABLE public."Location"
  ADD COLUMN IF NOT EXISTS grid_w integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS grid_h integer NOT NULL DEFAULT 1;
ALTER TABLE public."Location" DROP CONSTRAINT IF EXISTS location_grid_span;
ALTER TABLE public."Location" ADD CONSTRAINT location_grid_span
  CHECK (grid_w BETWEEN 1 AND 100 AND grid_h BETWEEN 1 AND 100);
COMMENT ON COLUMN public."Location".grid_w IS 'Số ô lưới vị trí chiếm theo chiều ngang trên Sơ đồ kho (ô sàn lớn > 1).';
COMMENT ON COLUMN public."Location".grid_h IS 'Số ô lưới vị trí chiếm theo chiều dọc trên Sơ đồ kho.';

-- RPC gán ô: nhận thêm grid_w/grid_h; kiểm trùng theo HÌNH CHỮ NHẬT (hai chân kệ khác nhau không
-- được giao nhau), vẫn all-or-nothing trong một transaction.
-- p_items: [{"location_id","grid_x","grid_y","grid_w"?,"grid_h"?}] — grid null = gỡ khỏi bản vẽ.
DROP FUNCTION IF EXISTS public.warehouse_map_assign_cells(text, jsonb, text);
CREATE OR REPLACE FUNCTION public.warehouse_map_assign_cells(p_warehouse_id text, p_items jsonb, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_n       integer;
  v_bad     integer;
  v_w       integer;
  v_h       integer;
  v_conf    jsonb;
  v_updated integer;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_ITEMS');
  END IF;
  SELECT count(*) INTO v_n FROM jsonb_array_elements(p_items);
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', true, 'updated', 0); END IF;
  IF v_n > 2000 THEN RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY'); END IF;

  DROP TABLE IF EXISTS tmp_assign;
  CREATE TEMP TABLE tmp_assign ON COMMIT DROP AS
    SELECT (e->>'location_id')::text AS location_id,
           NULLIF(e->>'grid_x', '')::int AS gx,
           NULLIF(e->>'grid_y', '')::int AS gy,
           greatest(1, least(100, coalesce(NULLIF(e->>'grid_w', '')::int, 1))) AS gw,
           greatest(1, least(100, coalesce(NULLIF(e->>'grid_h', '')::int, 1))) AS gh
      FROM jsonb_array_elements(p_items) e;

  SELECT count(*) INTO v_bad
    FROM tmp_assign t LEFT JOIN public."Location" l ON l.id = t.location_id
   WHERE l.id IS NULL OR l.warehouse_id IS DISTINCT FROM p_warehouse_id;
  IF v_bad > 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_IN_WAREHOUSE', 'count', v_bad); END IF;

  IF EXISTS (SELECT 1 FROM tmp_assign WHERE (gx IS NULL) <> (gy IS NULL)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'HALF_COORD');
  END IF;

  SELECT width, height INTO v_w, v_h FROM public.warehouse_maps WHERE warehouse_id = p_warehouse_id;
  IF v_w IS NOT NULL AND EXISTS (
       SELECT 1 FROM tmp_assign WHERE gx IS NOT NULL AND (gx < 0 OR gy < 0 OR gx + gw > v_w OR gy + gh > v_h)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_BOUNDS');
  END IF;

  WITH mine AS (
    SELECT t.location_id, t.gx, t.gy, t.gw, t.gh, l.location_code,
           CASE WHEN l.kind = 'STORAGE' THEN coalesce(l.sub_code, '') || '|' || coalesce(l.row, '') ELSE 'K|' || l.id END AS foot
      FROM tmp_assign t JOIN public."Location" l ON l.id = t.location_id
     WHERE t.gx IS NOT NULL
  ), others AS (
    SELECT l.id, l.grid_x gx, l.grid_y gy, l.grid_w gw, l.grid_h gh, l.location_code,
           CASE WHEN l.kind = 'STORAGE' THEN coalesce(l.sub_code, '') || '|' || coalesce(l.row, '') ELSE 'K|' || l.id END AS foot
      FROM public."Location" l
     WHERE l.warehouse_id = p_warehouse_id AND l.grid_x IS NOT NULL AND l.is_active
       AND l.id NOT IN (SELECT location_id FROM tmp_assign)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('location_code', c.a, 'other_code', c.b, 'x', c.x, 'y', c.y)), '[]'::jsonb)
    INTO v_conf
    FROM (
      SELECT m.location_code a, o.location_code b, m.gx x, m.gy y
        FROM mine m JOIN others o
          ON o.foot <> m.foot
         AND m.gx < o.gx + o.gw AND o.gx < m.gx + m.gw
         AND m.gy < o.gy + o.gh AND o.gy < m.gy + m.gh
      UNION ALL
      SELECT m1.location_code, m2.location_code, m1.gx, m1.gy
        FROM mine m1 JOIN mine m2
          ON m1.foot <> m2.foot AND m1.location_id < m2.location_id
         AND m1.gx < m2.gx + m2.gw AND m2.gx < m1.gx + m1.gw
         AND m1.gy < m2.gy + m2.gh AND m2.gy < m1.gy + m1.gh
      LIMIT 20
    ) c;
  IF jsonb_array_length(v_conf) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CELL_CONFLICT', 'conflicts', v_conf);
  END IF;

  UPDATE public."Location" l
     SET grid_x = t.gx, grid_y = t.gy, grid_w = t.gw, grid_h = t.gh, updated_at = now(), updated_by = p_actor
    FROM tmp_assign t
   WHERE l.id = t.location_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;
