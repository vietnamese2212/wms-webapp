-- ============================================================================
-- 20260908 — SƠ ĐỒ KHO bản một (nền cho Directed Work — user chốt 08/09/2026)
-- ============================================================================
-- VÌ SAO: hệ thống muốn chỉ "tới ô nào, lấy hàng nào trước" thì phải biết ô nằm ĐÂU trong kho.
-- Hôm nay Location chỉ có `row`/`shelf` dạng CHỮ (sort chuỗi: "10" đứng trước "2"), không toạ độ,
-- không thứ tự đường đi; thước đo gần cửa duy nhất là `WarehouseZone.pick_rank` (thủ công, cấp KHU).
--
-- MÔ HÌNH (user chốt qua 8 vòng): bản vẽ 2D nhìn từ trên xuống, 1 ô lưới ≈ 1 chân pallet (~1,2 m).
--   • Mỗi vị trí có toạ độ ô (grid_x, grid_y). Các TẦNG của cùng chân kệ (A12_T1..T4) DÙNG CHUNG
--     một ô lưới, chỉ khác `level_no` — tầng KHÔNG đổi quãng đường, chỉ đổi AI làm (xe hạ) và
--     THỜI GIAN thao tác. Đây là điều user nhấn mạnh: "tôi có các tầng trên 1 vị trí".
--   • Cửa xuất / cửa nhập / bãi / điểm đầu dãy CŨNG LÀ VỊ TRÍ (cột `kind`) — kho đã có sẵn các ô đặt
--     tên như "SX CHỜ XỬ LÝ", "CONT LẠNH", nên không đẻ bảng mới.
--   • Ô có vị trí (kind STORAGE) hoặc tường = CHẮN; ô trống = LỐI ĐI ⇒ khoảng cách = tìm đường
--     trên lưới (BFS, utils/warehouseGrid.ts — BE + FE cùng một bản). KHÔNG lưu khoảng cách: một
--     nguồn sự thật là bản vẽ.
--   • `is_rack` + `level_no`: tự suy từ mã ô (đuôi T1..T4 = kệ có tầng; không đuôi = ô sàn tầng 1),
--     thủ kho sửa tay chỗ sai. Ngưỡng "từ tầng mấy cần xe hạ" nằm ở cấp kho (đợt 1).
--
-- KHÔNG đụng hành vi hiện có: mọi cột mới nullable/default, không route nào đang chạy đọc chúng.
-- ============================================================================

-- ── 1. Cột mới trên Location ─────────────────────────────────────────────────────────────────────
ALTER TABLE public."Location"
  ADD COLUMN IF NOT EXISTS is_rack  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS level_no integer,
  ADD COLUMN IF NOT EXISTS grid_x   integer,
  ADD COLUMN IF NOT EXISTS grid_y   integer,
  ADD COLUMN IF NOT EXISTS kind     text NOT NULL DEFAULT 'STORAGE';

ALTER TABLE public."Location" DROP CONSTRAINT IF EXISTS location_kind_check;
ALTER TABLE public."Location" ADD CONSTRAINT location_kind_check
  CHECK (kind IN ('STORAGE', 'DOCK_IN', 'DOCK_OUT', 'DROP'));
-- Tầng 0..50 (cột integer — số rác 1e12 tràn kiểu thành 500, cùng bài học max_materials 26/08)
ALTER TABLE public."Location" DROP CONSTRAINT IF EXISTS location_level_no_range;
ALTER TABLE public."Location" ADD CONSTRAINT location_level_no_range
  CHECK (level_no IS NULL OR (level_no >= 0 AND level_no <= 50));
-- Toạ độ lưới: cả hai cùng NULL (chưa đặt) hoặc cả hai ≥ 0 — không có trạng thái "nửa toạ độ"
ALTER TABLE public."Location" DROP CONSTRAINT IF EXISTS location_grid_pair;
ALTER TABLE public."Location" ADD CONSTRAINT location_grid_pair
  CHECK ((grid_x IS NULL AND grid_y IS NULL)
      OR (grid_x IS NOT NULL AND grid_y IS NOT NULL AND grid_x >= 0 AND grid_y >= 0 AND grid_x < 1000 AND grid_y < 1000));

COMMENT ON COLUMN public."Location".is_rack  IS 'Ô kệ (true) hay ô sàn (false). Tự suy từ đuôi tầng của mã ô lúc backfill 08/09; sửa tay được.';
COMMENT ON COLUMN public."Location".level_no IS 'Tầng của ô kệ (1 = sát sàn). Các tầng cùng chân kệ dùng CHUNG một ô lưới. NULL = không suy được từ mã.';
COMMENT ON COLUMN public."Location".grid_x   IS 'Cột ô lưới trên Sơ đồ kho (1 ô ≈ 1 chân pallet). NULL = chưa đặt lên bản vẽ.';
COMMENT ON COLUMN public."Location".grid_y   IS 'Hàng ô lưới trên Sơ đồ kho. Đi cặp với grid_x.';
COMMENT ON COLUMN public."Location".kind     IS 'STORAGE = ô chứa hàng · DOCK_OUT = cửa/bãi xuất · DOCK_IN = cửa/bãi nhập · DROP = điểm đầu dãy (xe hạ đặt pallet xuống).';

-- Backfill tầng + kệ từ mã ô. Không đụng vị trí kind ≠ STORAGE (chưa có dòng nào lúc này).
--   shelf 'T3' / '3' / 'T03' → level 3, is_rack true    (kệ có tầng)
--   shelf ''                 → level 1, is_rack false   (ô sàn / ô đặt tên)
--   shelf chữ khác ('MẶT ĐẤT'…) → level NULL, is_rack false
UPDATE public."Location"
   SET level_no = CASE
                    WHEN coalesce(shelf, '') = '' THEN 1
                    WHEN shelf ~ '^[Tt]?0*[0-9]{1,2}$' THEN least(50, (regexp_replace(shelf, '^[Tt]?0*', ''))::int)
                    ELSE NULL
                  END,
       is_rack  = (shelf ~ '^[Tt]?0*[0-9]{1,2}$')
 WHERE kind = 'STORAGE' AND level_no IS NULL;

-- Tra "ô nào ở toạ độ này" khi gán/kiểm trùng + vẽ lưới theo kho
CREATE INDEX IF NOT EXISTS idx_location_grid ON public."Location" (warehouse_id, grid_x, grid_y) WHERE grid_x IS NOT NULL;

-- ── 2. Khung bản vẽ theo kho ─────────────────────────────────────────────────────────────────────
-- 1 dòng / kho. `blocked` = danh sách ô tường/cột [[x,y],…] (ô có vị trí đã tự là ô chắn, không lặp ở đây).
-- Trần 400×400 = 160.000 ô — BFS vẫn mili-giây; kho thật ~100×60.
CREATE TABLE IF NOT EXISTS public.warehouse_maps (
  warehouse_id text PRIMARY KEY REFERENCES public."Warehouse"(id) ON DELETE CASCADE,
  width        integer NOT NULL CHECK (width  BETWEEN 5 AND 400),
  height       integer NOT NULL CHECK (height BETWEEN 5 AND 400),
  cell_m       numeric(4,2) NOT NULL DEFAULT 1.2 CHECK (cell_m > 0 AND cell_m <= 10),
  blocked      jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);
ALTER TABLE public.warehouse_maps ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.warehouse_maps IS 'Sơ đồ kho 2D: khung lưới + ô chắn. Vị trí/cửa/bãi đặt lên lưới qua Location.grid_x/grid_y/kind.';
-- Giữ trigger realtime (event-trigger tự gắn trg_wms_notify): người khác sửa bản vẽ → màn sơ đồ tự nạp lại.

-- ── 3. RPC gán ô theo LÔ — 1 câu UPDATE, all-or-nothing ─────────────────────────────────────────
-- p_items: [{"location_id":"…","grid_x":3,"grid_y":7}, {"location_id":"…","grid_x":null,"grid_y":null}]
--   grid null = gỡ khỏi bản vẽ. Kiểm trong transaction:
--   (a) mọi id thuộc đúng kho (id kho khác → NOT_IN_WAREHOUSE, chống IDOR theo cặp id);
--   (b) trong biên khung (nếu kho đã có khung);
--   (c) hai CHÂN KỆ khác nhau không được chung ô — chân kệ = (sub_code, row); các tầng cùng chân
--       kệ thì chung ô là ĐÚNG THIẾT KẾ. Ô DOCK/DROP là chân riêng của chính nó.
-- Trả jsonb {ok, updated, conflicts:[{location_code, other_code, x, y}], error}.
-- Không GRANT (default đã đóng PUBLIC từ 20260815i/j — backend đi service_role).
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

  -- Pooler transaction-mode dùng chung phiên server: bảng tạm của lượt trước có thể còn tới COMMIT
  DROP TABLE IF EXISTS tmp_assign;
  CREATE TEMP TABLE tmp_assign ON COMMIT DROP AS
    SELECT (e->>'location_id')::text AS location_id,
           NULLIF(e->>'grid_x', '')::int AS gx,
           NULLIF(e->>'grid_y', '')::int AS gy
      FROM jsonb_array_elements(p_items) e;

  -- (a) id lạ hoặc kho khác
  SELECT count(*) INTO v_bad
    FROM tmp_assign t LEFT JOIN public."Location" l ON l.id = t.location_id
   WHERE l.id IS NULL OR l.warehouse_id IS DISTINCT FROM p_warehouse_id;
  IF v_bad > 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_IN_WAREHOUSE', 'count', v_bad); END IF;

  -- nửa toạ độ
  IF EXISTS (SELECT 1 FROM tmp_assign WHERE (gx IS NULL) <> (gy IS NULL)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'HALF_COORD');
  END IF;

  -- (b) trong biên khung
  SELECT width, height INTO v_w, v_h FROM public.warehouse_maps WHERE warehouse_id = p_warehouse_id;
  IF v_w IS NOT NULL AND EXISTS (SELECT 1 FROM tmp_assign WHERE gx IS NOT NULL AND (gx < 0 OR gy < 0 OR gx >= v_w OR gy >= v_h)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_BOUNDS');
  END IF;

  -- (c) hai chân kệ khác nhau chung một ô: so với dòng ĐÃ CÓ trong kho (không nằm trong lô) và
  --     so lẫn nhau trong lô. Chân kệ = (sub_code, row); kind ≠ STORAGE = chân riêng theo id.
  WITH mine AS (
    SELECT t.location_id, t.gx, t.gy, l.location_code,
           CASE WHEN l.kind = 'STORAGE' THEN coalesce(l.sub_code, '') || '|' || coalesce(l.row, '') ELSE 'K|' || l.id END AS foot
      FROM tmp_assign t JOIN public."Location" l ON l.id = t.location_id
     WHERE t.gx IS NOT NULL
  ), others AS (
    SELECT l.id, l.grid_x, l.grid_y, l.location_code,
           CASE WHEN l.kind = 'STORAGE' THEN coalesce(l.sub_code, '') || '|' || coalesce(l.row, '') ELSE 'K|' || l.id END AS foot
      FROM public."Location" l
     WHERE l.warehouse_id = p_warehouse_id AND l.grid_x IS NOT NULL AND l.is_active
       AND l.id NOT IN (SELECT location_id FROM tmp_assign)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('location_code', c.a, 'other_code', c.b, 'x', c.x, 'y', c.y)), '[]'::jsonb)
    INTO v_conf
    FROM (
      SELECT m.location_code a, o.location_code b, m.gx x, m.gy y
        FROM mine m JOIN others o ON o.grid_x = m.gx AND o.grid_y = m.gy AND o.foot <> m.foot
      UNION ALL
      SELECT m1.location_code, m2.location_code, m1.gx, m1.gy
        FROM mine m1 JOIN mine m2 ON m1.gx = m2.gx AND m1.gy = m2.gy AND m1.foot <> m2.foot AND m1.location_id < m2.location_id
      LIMIT 20
    ) c;
  IF jsonb_array_length(v_conf) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CELL_CONFLICT', 'conflicts', v_conf);
  END IF;

  UPDATE public."Location" l
     SET grid_x = t.gx, grid_y = t.gy, updated_at = now(), updated_by = p_actor
    FROM tmp_assign t
   WHERE l.id = t.location_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

-- ── 4. RPC tồn theo ô — 1 round-trip, trả jsonb (không dính trần 1000 dòng của PostgREST) ────────
-- Mỗi ô: số pallet còn tồn, số mã khác nhau, tổng base (chỉ để so giữa cùng mã — FE KHÔNG gắn nhãn
-- "thùng" cho tổng cross-mã), số pallet QA giữ. Chỉ đếm dòng còn hàng — cùng luật với used_slots.
CREATE OR REPLACE FUNCTION public.warehouse_map_occupancy(p_warehouse_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'location_id', s.location_id,
           'pallets', s.pallets, 'materials', s.materials, 'qty_base', s.qty_base, 'quarantine', s.quarantine)), '[]'::jsonb)
    FROM (
      SELECT e.location_id,
             count(*)::int AS pallets,
             count(DISTINCT e.material_id)::int AS materials,
             sum(e.cartons_remaining)::numeric AS qty_base,
             count(*) FILTER (WHERE e.status = 'QUARANTINE')::int AS quarantine
        FROM public."InventoryEntry" e
        JOIN public."Location" l ON l.id = e.location_id
       WHERE l.warehouse_id = p_warehouse_id
         AND e.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
         AND e.cartons_remaining > 0
       GROUP BY e.location_id
    ) s;
$$;
