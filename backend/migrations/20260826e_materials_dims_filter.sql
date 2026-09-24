-- Trang Mã hàng: lọc theo KÍCH THƯỚC THÙNG đã khai hay chưa + theo CỜ đặc biệt (phi hàng hóa /
-- pallet mang hàng / hàng nhẹ lên nóc), và đếm "chưa khai KT thùng" cho SummaryBand.
--
-- Vì sao phải nằm trong RPC: danh mục 2.740 mã đã phân trang SERVER (20260728_materials_paged_rpc)
-- — lọc ở máy chỉ lọc được 200 dòng đang xem, số ô band cũng sai. Cùng lý do với 'incomplete'/'dup'.
--
-- Bối cảnh 26/08: sơ đồ xếp xe 3D cần D×R×C thùng; đo trên đơn thật 15/08 thì 201/202 mã đang dùng
-- CHƯA khai kích thước ⇒ phải có đường tìm nhanh "mã nào chưa khai" rồi áp hàng loạt.
--
-- ⚠️ plpgsql + force_custom_plan (bài học 27/07: LANGUAGE sql bị generic plan).
-- ⚠️ Giữ 2 hàm KHỚP NHAU khi sửa mệnh đề lọc.

DROP FUNCTION IF EXISTS materials_page(int, int, text[], text[], text[], text[], text[], text[], jsonb, text[], text[]);
CREATE FUNCTION materials_page(
  p_offset       int,
  p_limit        int,
  p_tokens       text[] DEFAULT NULL,   -- từ khoá ĐÃ chuẩn hoá (bỏ dấu, thường) — khớp AND từng token
  p_categories   text[] DEFAULT NULL,   -- lọc Loại hàng
  p_scope_cats   text[] DEFAULT NULL,   -- scope Loại hàng theo quyền (NULL = đủ quyền)
  p_status       text[] DEFAULT NULL,   -- 'active' | 'inactive'
  p_qr           text[] DEFAULT NULL,   -- 'has_qr' | 'no_qr'
  p_dq           text[] DEFAULT NULL,   -- 'incomplete' | 'dup'
  p_cat_rules    jsonb  DEFAULT '[]',   -- [{"c":"FG01","sl":true,"pe":false}]
  p_legacy_no_sl text[] DEFAULT NULL,   -- loại KHÔNG bắt HSD khi chưa khai cờ
  p_legacy_pe    text[] DEFAULT NULL,   -- loại BẮT Pallet/EA khi chưa khai cờ
  p_dims         text[] DEFAULT NULL,   -- 'has_dims' | 'no_dims' (kích thước thùng D×R×C)
  p_flags        text[] DEFAULT NULL    -- 'non_stock' | 'pallet_carrier' | 'stack_on_top'
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH rules AS (
    SELECT r->>'c' AS c, (r->>'sl')::boolean AS sl, (r->>'pe')::boolean AS pe
    FROM jsonb_array_elements(COALESCE(p_cat_rules, '[]'::jsonb)) r
  ),
  base AS (
    SELECT m.id, m.material_code, m.material_description, m.short_name, m.old_code, m.category,
           m.base_unit, m.entry_unit, m.is_active, m.no_qr_tracking,
           m.cartons_per_pallet, m.shelf_life_days, m.pallet_per_ea, m.search_norm,
           (COALESCE(m.carton_length_mm, 0) > 0 AND COALESCE(m.carton_width_mm, 0) > 0
            AND COALESCE(m.carton_height_mm, 0) > 0) AS has_dims,
           COALESCE(m.is_non_stock, false)     AS f_non_stock,
           COALESCE(m.is_pallet_carrier, false) AS f_pallet,
           COALESCE(m.stack_on_top, false)      AS f_on_top
    FROM "Material" m
    WHERE (p_scope_cats IS NULL OR m.category IS NULL OR m.category = ANY (p_scope_cats))
  ),
  dup AS (
    SELECT lower(btrim(material_description)) AS k
    FROM base WHERE btrim(COALESCE(material_description, '')) <> ''
    GROUP BY 1 HAVING count(*) > 1
  ),
  flagged AS (
    SELECT b.*,
           (lower(btrim(COALESCE(b.material_description, ''))) IN (SELECT k FROM dup)) AS is_dup,
           (b.category IS NULL OR b.category = ''
            OR b.base_unit IS NULL OR b.base_unit = ''
            OR b.cartons_per_pallet IS NULL OR b.cartons_per_pallet <= 0
            OR (COALESCE(r.sl, b.category IS NOT NULL AND NOT (b.category = ANY (COALESCE(p_legacy_no_sl, '{}'))))
                AND b.shelf_life_days IS NULL)
            OR (COALESCE(r.pe, b.category IS NOT NULL AND (b.category = ANY (COALESCE(p_legacy_pe, '{}'))))
                AND b.pallet_per_ea IS NULL)) AS is_incomplete
    FROM base b LEFT JOIN rules r ON r.c = b.category
  ),
  f AS (
    SELECT * FROM flagged x
    WHERE (p_status IS NULL OR (x.is_active AND 'active' = ANY (p_status)) OR (NOT x.is_active AND 'inactive' = ANY (p_status)))
      AND (p_qr IS NULL OR (x.no_qr_tracking AND 'no_qr' = ANY (p_qr)) OR (NOT x.no_qr_tracking AND 'has_qr' = ANY (p_qr)))
      AND (p_categories IS NULL OR COALESCE(x.category, '') = ANY (p_categories))
      AND (p_dq IS NULL OR (x.is_incomplete AND 'incomplete' = ANY (p_dq)) OR (x.is_dup AND 'dup' = ANY (p_dq)))
      AND (p_dims IS NULL OR (x.has_dims AND 'has_dims' = ANY (p_dims)) OR (NOT x.has_dims AND 'no_dims' = ANY (p_dims)))
      AND (p_flags IS NULL
           OR (x.f_non_stock AND 'non_stock' = ANY (p_flags))
           OR (x.f_pallet    AND 'pallet_carrier' = ANY (p_flags))
           OR (x.f_on_top    AND 'stack_on_top' = ANY (p_flags)))
      -- tìm kiếm: MỌI token phải có mặt (giống omniMatch ở FE), gộp cột chuẩn hoá + loại/ĐVT
      AND (p_tokens IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p_tokens) t
            WHERE position(t IN (COALESCE(x.search_norm, '') || ' ' ||
                   lower(COALESCE(x.category, '') || ' ' || COALESCE(x.base_unit, '') || ' ' || COALESCE(x.entry_unit, '')))) = 0))
  )
  , pg AS (
    SELECT id, material_code, is_dup FROM f ORDER BY material_code
    LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    'ids',     COALESCE((SELECT jsonb_agg(id ORDER BY material_code) FROM pg), '[]'::jsonb),
    'dup_ids', COALESCE((SELECT jsonb_agg(id) FROM pg WHERE is_dup), '[]'::jsonb),
    'total',   (SELECT count(*) FROM f)
  ) INTO result;
  RETURN result;
END $$;

DROP FUNCTION IF EXISTS materials_summary(text[], text[], text[], text[], text[], text[], jsonb, text[], text[]);
CREATE FUNCTION materials_summary(
  p_tokens       text[] DEFAULT NULL,
  p_categories   text[] DEFAULT NULL,
  p_scope_cats   text[] DEFAULT NULL,
  p_status       text[] DEFAULT NULL,
  p_qr           text[] DEFAULT NULL,
  p_dq           text[] DEFAULT NULL,
  p_cat_rules    jsonb  DEFAULT '[]',
  p_legacy_no_sl text[] DEFAULT NULL,
  p_legacy_pe    text[] DEFAULT NULL,
  p_dims         text[] DEFAULT NULL,
  p_flags        text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH rules AS (
    SELECT r->>'c' AS c, (r->>'sl')::boolean AS sl, (r->>'pe')::boolean AS pe
    FROM jsonb_array_elements(COALESCE(p_cat_rules, '[]'::jsonb)) r
  ),
  base AS (
    SELECT m.id, m.material_code, m.material_description, m.category,
           m.base_unit, m.entry_unit, m.is_active, m.no_qr_tracking,
           m.cartons_per_pallet, m.shelf_life_days, m.pallet_per_ea, m.search_norm,
           (COALESCE(m.carton_length_mm, 0) > 0 AND COALESCE(m.carton_width_mm, 0) > 0
            AND COALESCE(m.carton_height_mm, 0) > 0) AS has_dims,
           COALESCE(m.is_non_stock, false)      AS f_non_stock,
           COALESCE(m.is_pallet_carrier, false) AS f_pallet,
           COALESCE(m.stack_on_top, false)      AS f_on_top
    FROM "Material" m
    WHERE (p_scope_cats IS NULL OR m.category IS NULL OR m.category = ANY (p_scope_cats))
  ),
  dup AS (
    SELECT lower(btrim(material_description)) AS k
    FROM base WHERE btrim(COALESCE(material_description, '')) <> ''
    GROUP BY 1 HAVING count(*) > 1
  ),
  flagged AS (
    SELECT b.*,
           (lower(btrim(COALESCE(b.material_description, ''))) IN (SELECT k FROM dup)) AS is_dup,
           (b.category IS NULL OR b.category = ''
            OR b.base_unit IS NULL OR b.base_unit = ''
            OR b.cartons_per_pallet IS NULL OR b.cartons_per_pallet <= 0
            OR (COALESCE(r.sl, b.category IS NOT NULL AND NOT (b.category = ANY (COALESCE(p_legacy_no_sl, '{}'))))
                AND b.shelf_life_days IS NULL)
            OR (COALESCE(r.pe, b.category IS NOT NULL AND (b.category = ANY (COALESCE(p_legacy_pe, '{}'))))
                AND b.pallet_per_ea IS NULL)) AS is_incomplete
    FROM base b LEFT JOIN rules r ON r.c = b.category
  ),
  f AS (
    SELECT * FROM flagged x
    WHERE (p_status IS NULL OR (x.is_active AND 'active' = ANY (p_status)) OR (NOT x.is_active AND 'inactive' = ANY (p_status)))
      AND (p_qr IS NULL OR (x.no_qr_tracking AND 'no_qr' = ANY (p_qr)) OR (NOT x.no_qr_tracking AND 'has_qr' = ANY (p_qr)))
      AND (p_categories IS NULL OR COALESCE(x.category, '') = ANY (p_categories))
      AND (p_dq IS NULL OR (x.is_incomplete AND 'incomplete' = ANY (p_dq)) OR (x.is_dup AND 'dup' = ANY (p_dq)))
      AND (p_dims IS NULL OR (x.has_dims AND 'has_dims' = ANY (p_dims)) OR (NOT x.has_dims AND 'no_dims' = ANY (p_dims)))
      AND (p_flags IS NULL
           OR (x.f_non_stock AND 'non_stock' = ANY (p_flags))
           OR (x.f_pallet    AND 'pallet_carrier' = ANY (p_flags))
           OR (x.f_on_top    AND 'stack_on_top' = ANY (p_flags)))
      AND (p_tokens IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p_tokens) t
            WHERE position(t IN (COALESCE(x.search_norm, '') || ' ' ||
                   lower(COALESCE(x.category, '') || ' ' || COALESCE(x.base_unit, '') || ' ' || COALESCE(x.entry_unit, '')))) = 0))
  )
  SELECT jsonb_build_object(
    'total',      (SELECT count(*) FROM f),
    'active',     (SELECT count(*) FROM f WHERE is_active),
    'inactive',   (SELECT count(*) FROM f WHERE NOT is_active),
    'no_qr',      (SELECT count(*) FROM f WHERE no_qr_tracking),
    'incomplete', (SELECT count(*) FROM f WHERE is_incomplete),
    'dup',        (SELECT count(*) FROM f WHERE is_dup),
    'no_dims',    (SELECT count(*) FROM f WHERE NOT has_dims)
  ) INTO result;
  RETURN result;
END $$;
