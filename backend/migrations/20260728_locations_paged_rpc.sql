-- Phân trang SERVER cho trang danh mục Vị trí kho (wms/Locations).
-- Trang bắt buộc chọn KHO trước nên phạm vi đã hẹp, nhưng 1 kho có thể vài nghìn vị trí
-- (Bàu Bàng 1.517) và trước đây render HẾT + tính tổng ở máy.
--   locations_page    → ids của trang + tổng
--   locations_summary → 4 ô SummaryBand (Vị trí · Pallet đang dùng · Sức chứa · Đầy) trên TOÀN BỘ
--                       bộ lọc, CHỈ tính vị trí đang dùng (is_active) — mirror `activeFiltered` cũ
--
-- "Pallet đang dùng" (used_slots) = số pallet lớp 1 còn hàng tại vị trí đó — ĐỊNH NGHĨA DUY NHẤT
-- phải khớp listLocations: stack_layer = 1 AND status IN ('IN_STOCK','PARTIAL') AND cartons_remaining > 0.
-- ⚠️ plpgsql + force_custom_plan (bài học 27/07).

CREATE INDEX IF NOT EXISTS idx_ie_loc_used
  ON "InventoryEntry" (location_id) WHERE stack_layer = 1 AND cartons_remaining > 0;

DROP FUNCTION IF EXISTS locations_page(int, int, text[], text, text[], text[], boolean, boolean);
CREATE FUNCTION locations_page(
  p_offset      int,
  p_limit       int,
  p_wh_ids      text[]  DEFAULT NULL,   -- kho được xem (đã giao với scope)
  p_category    text    DEFAULT NULL,   -- lọc Loại hàng (mảng categories CHỨA giá trị này)
  p_scope_cats  text[]  DEFAULT NULL,   -- scope Loại hàng theo quyền (null-inclusive)
  p_tokens      text[]  DEFAULT NULL,   -- từ khoá đã chuẩn hoá, khớp AND
  p_flag        boolean DEFAULT false,  -- chỉ vị trí gắn cờ kiểm kê
  p_incl_inactive boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH f AS (
    SELECT l.id, l.sub_code, l.row, l.shelf
    FROM "Location" l
    LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
    WHERE (p_wh_ids IS NULL OR l.warehouse_id = ANY (p_wh_ids))
      AND (p_incl_inactive OR l.is_active)
      AND (p_category IS NULL OR l.categories IS NULL OR l.categories @> ARRAY[p_category])
      AND (p_scope_cats IS NULL OR l.categories IS NULL OR l.categories && p_scope_cats)
      AND (NOT p_flag OR l.requires_stocktake)
      AND (p_tokens IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p_tokens) t
            WHERE position(t IN (COALESCE(l.search_norm, '') || ' ' ||
                   lower(COALESCE(array_to_string(l.categories, ' '), '') || ' ' ||
                         COALESCE(l.sub_type, '') || ' ' || COALESCE(l.row, '') || ' ' ||
                         COALESCE(l.shelf, '') || ' ' || COALESCE(w.code, '') || ' ' || COALESCE(w.name, '')))) = 0))
  )
  SELECT jsonb_build_object(
    'ids',   COALESCE((SELECT jsonb_agg(id ORDER BY sub_code, row, shelf, id)
                       FROM (SELECT * FROM f ORDER BY sub_code, row, shelf, id
                             LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)) w), '[]'::jsonb),
    'total', (SELECT count(*) FROM f)
  ) INTO result;
  RETURN result;
END $$;

DROP FUNCTION IF EXISTS locations_summary(text[], text, text[], text[], boolean);
CREATE FUNCTION locations_summary(
  p_wh_ids     text[]  DEFAULT NULL,
  p_category   text    DEFAULT NULL,
  p_scope_cats text[]  DEFAULT NULL,
  p_tokens     text[]  DEFAULT NULL,
  p_flag       boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH f AS (   -- SummaryBand luôn tính trên vị trí ĐANG DÙNG (mirror activeFiltered của FE cũ)
    SELECT l.id, l.max_pallets
    FROM "Location" l
    LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
    WHERE (p_wh_ids IS NULL OR l.warehouse_id = ANY (p_wh_ids))
      AND l.is_active
      AND (p_category IS NULL OR l.categories IS NULL OR l.categories @> ARRAY[p_category])
      AND (p_scope_cats IS NULL OR l.categories IS NULL OR l.categories && p_scope_cats)
      AND (NOT p_flag OR l.requires_stocktake)
      AND (p_tokens IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p_tokens) t
            WHERE position(t IN (COALESCE(l.search_norm, '') || ' ' ||
                   lower(COALESCE(array_to_string(l.categories, ' '), '') || ' ' ||
                         COALESCE(l.sub_type, '') || ' ' || COALESCE(l.row, '') || ' ' ||
                         COALESCE(l.shelf, '') || ' ' || COALESCE(w.code, '') || ' ' || COALESCE(w.name, '')))) = 0))
  ),
  used AS (
    SELECT f.id, f.max_pallets, count(e.id) AS used_slots
    FROM f LEFT JOIN "InventoryEntry" e
      ON e.location_id = f.id AND e.stack_layer = 1
     AND e.status IN ('IN_STOCK', 'PARTIAL') AND e.cartons_remaining > 0
    GROUP BY f.id, f.max_pallets
  )
  SELECT jsonb_build_object(
    'count',    (SELECT count(*) FROM used),
    'capacity', (SELECT COALESCE(sum(max_pallets), 0) FROM used),
    'used',     (SELECT COALESCE(sum(used_slots), 0) FROM used),
    'full',     (SELECT count(*) FROM used WHERE max_pallets > 0 AND used_slots >= max_pallets)
  ) INTO result;
  RETURN result;
END $$;
