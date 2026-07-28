-- Kiểm kê: phân trang SERVER cho 2 bảng lớn nhất của module.
--
-- VÌ SAO: cả 2 endpoint trước đây chặn cứng CAP 2000 dòng rồi treo cờ `truncated` để FE hiện
-- banner "thu hẹp phạm vi". Đo thật 28/07 trên staging: Kho Bàu Bàng có 8.074 pallet còn tồn
-- ⇒ người kiểm chỉ thấy 25% số pallet và KHÔNG có cách nào xem nốt. Ô thống kê thì đúng (đếm
-- trong DB) nên bảng và ô số đá nhau — kiểu sai khó phát hiện nhất.
--
-- Thiết kế: cùng khuôn với các trang đã phân trang (memory `server-pagination-campaign`):
--   • ORDER BY + OFFSET/LIMIT + COUNT nằm TRONG SQL, chung 1 mệnh đề WHERE ⇒ tổng/thứ tự/trang
--     không thể lệch nhau.
--   • Danh sách vị trí truyền qua THAM SỐ MẢNG của RPC (POST body) — không đi qua URL nên thoát
--     cả 2 trần id-trong-URL (~300 id tới PostgREST, ~800 id tới Vercel). Kho 1.517 vị trí trước
--     đây phải chunk 300 → 6 lô × 4 câu đếm = 24 round-trip; giờ còn 1.
--   • plpgsql + force_custom_plan: LANGUAGE sql sinh generic plan, bỏ qua index khi tham số mảng
--     lớn (bẫy đã dính ở đợt phân trang Xuất kho — plan chung chạy >300s).
-- Scope kho/loại vẫn resolve ở backend (đã audit) rồi truyền id xuống — SQL không tự nới quyền.

-- ── 1. Tổng hợp kiểm kê (tab "Tổng hợp KK") ──────────────────────────────────
-- Trả ids của ĐÚNG 1 trang + tổng của TOÀN BỘ bộ lọc + 3 ô thống kê (đếm trên tập chưa lọc view).
CREATE OR REPLACE FUNCTION stocktake_entries_page(
  p_loc_ids text[],
  p_from    timestamptz,
  p_to      timestamptz,
  p_view    text,
  p_offset  int,
  p_limit   int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH base AS (
    SELECT e.id, e.stocktake_at, e.stocktake_flagged,
           (e.stocktake_at IS NOT NULL AND e.stocktake_at >= p_from AND e.stocktake_at <= p_to) AS is_checked
    FROM "InventoryEntry" e
    WHERE e.location_id = ANY (p_loc_ids)
      AND e.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING')
      AND e.cartons_remaining > 0          -- pallet đã xuất hết không phải việc của đợt kiểm
  ),
  f AS (
    SELECT * FROM base
    WHERE CASE p_view
            WHEN 'flagged'   THEN is_checked AND stocktake_flagged
            WHEN 'unchecked' THEN NOT is_checked
            WHEN 'checked'   THEN is_checked
            WHEN 'problem'   THEN (is_checked AND stocktake_flagged) OR NOT is_checked
            ELSE TRUE
          END
  ),
  pg AS (
    -- Thứ tự phải KHỚP đường cũ: chưa kiểm lên đầu → trong nhóm thì lệch trước → cũ trước.
    -- (Đường cũ sort trong JS SAU khi đã cắt 2000 nên thứ tự chỉ đúng trong phần bị cắt.)
    SELECT id, row_number() OVER (
             ORDER BY is_checked, stocktake_flagged DESC, stocktake_at ASC NULLS FIRST, id
           ) rn
    FROM f
    ORDER BY is_checked, stocktake_flagged DESC, stocktake_at ASC NULLS FIRST, id
    OFFSET p_offset LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'ids',      COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb),
    'total',    (SELECT count(*) FROM f),
    'st_total', (SELECT count(*) FROM base),
    'checked',  (SELECT count(*) FROM base WHERE is_checked),
    'flagged',  (SELECT count(*) FROM base WHERE is_checked AND stocktake_flagged)
  ) INTO r;
  RETURN r;
END $$;

-- ── 2. Lịch sử kiểm (tab "Lịch sử kiểm", bảng StocktakeLog append-only) ──────
-- 1 lần quét kiểm = 1 dòng ⇒ kho 12k pallet kiểm hằng tháng là ~150k dòng/năm: CAP 2000 chặn
-- ngay tháng đầu. Lọc loại hàng giữ nguyên quy ước NULL-INCLUSIVE (dòng chưa khai loại vẫn hiện).
CREATE OR REPLACE FUNCTION stocktake_log_page(
  p_wh_ids     text[],
  p_loc_ids    text[],
  p_category   text,
  p_scope_cats text[],
  p_search     text,
  p_from       timestamptz,
  p_to         timestamptz,
  p_offset     int,
  p_limit      int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH f AS (
    SELECT s.id, s.counted_at, s.is_flagged, s.physical_qty
    FROM "StocktakeLog" s
    WHERE s.counted_at >= p_from AND s.counted_at <= p_to
      AND (p_wh_ids  IS NULL OR s.warehouse_id = ANY (p_wh_ids))
      AND (p_loc_ids IS NULL OR s.location_id  = ANY (p_loc_ids))
      AND (p_category IS NULL OR s.categories @> ARRAY[p_category])
      AND (p_scope_cats IS NULL OR s.categories IS NULL OR s.categories && p_scope_cats)
      AND (p_search IS NULL OR s.pallet_code ILIKE '%' || p_search || '%')
  ),
  pg AS (
    SELECT id, row_number() OVER (ORDER BY counted_at DESC, id) rn
    FROM f ORDER BY counted_at DESC, id OFFSET p_offset LIMIT p_limit
  )
  -- 3 ô SummaryBand phải đếm trên TOÀN BỘ bộ lọc. Đếm ở FE trên `rows` là đếm 1 trang, đứng
  -- cạnh ô "Lượt kiểm" (toàn bộ) → hai con số đá nhau mà không có gì báo.
  SELECT jsonb_build_object(
    'ids',     COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb),
    'total',   (SELECT count(*) FROM f),
    'counted', (SELECT count(*) FROM f WHERE physical_qty IS NOT NULL),
    'flagged', (SELECT count(*) FROM f WHERE is_flagged)
  ) INTO r;
  RETURN r;
END $$;
