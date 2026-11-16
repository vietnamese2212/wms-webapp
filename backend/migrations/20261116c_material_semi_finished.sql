-- MÃ HÀNG: CỜ "BÁN THÀNH PHẨM" (rà MES 16/11, lớp C117).
-- Trước đây Sản xuất coi MỌI mã tính L / KG là bán thành phẩm (BTP). Danh mục chưa có mã BTP nào, nên ô
-- "Mã bán thành phẩm" (Mở mẻ · Định mức · Hạn lưu bồn) chỉ toàn nguyên liệu RM01 và bao bì PK01 — mở mẻ với
-- mã "Màu caramel" là app hiểu mẻ đó SẢN XUẤT RA màu caramel. User chốt 16/11: BTP là mã riêng cho từng
-- loại dịch trộn, đánh dấu ở Mã hàng; Sản xuất chỉ nhận mã đã đánh dấu.
--   • cột Material.is_semi_finished (mặc định false = hành vi kho không đổi);
--   • ràng buộc: mã BTP phải có đơn vị gốc L hoặc KG, không là mã phi hàng hoá, không là pallet mang hàng
--     (lưới cuối cho mọi cửa ghi Mã hàng: form · upload · API — controller báo câu dễ hiểu trước);
--   • bộ lọc "Cờ" của trang Mã hàng thêm 'semi_finished' (materials_page / materials_summary — chép nguyên
--     định nghĩa đang chạy, chỉ thêm cột f_semi + một nhánh OR).
-- Staging 16/11: 0 mẻ · 0 định mức · 0 bồn · 0 mã có hạn lưu bồn ⇒ không có dữ liệu cũ phải chuyển.
BEGIN;

ALTER TABLE public."Material" ADD COLUMN IF NOT EXISTS is_semi_finished boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public."Material".is_semi_finished IS
  'Bán thành phẩm (dịch trộn từ NVL theo định mức, vào bồn). Chỉ mã này mới mở mẻ / khai định mức / hạn lưu bồn được. Bắt buộc base_unit L hoặc KG.';

ALTER TABLE public."Material" DROP CONSTRAINT IF EXISTS material_semi_finished_chk;
ALTER TABLE public."Material" ADD CONSTRAINT material_semi_finished_chk CHECK (
  NOT is_semi_finished
  OR (upper(btrim(COALESCE(base_unit, ''))) IN ('L', 'KG') AND NOT COALESCE(is_non_stock, false) AND NOT COALESCE(is_pallet_carrier, false))
);

CREATE OR REPLACE FUNCTION public.materials_page(p_offset integer, p_limit integer, p_tokens text[] DEFAULT NULL::text[], p_categories text[] DEFAULT NULL::text[], p_scope_cats text[] DEFAULT NULL::text[], p_status text[] DEFAULT NULL::text[], p_qr text[] DEFAULT NULL::text[], p_dq text[] DEFAULT NULL::text[], p_cat_rules jsonb DEFAULT '[]'::jsonb, p_legacy_no_sl text[] DEFAULT NULL::text[], p_legacy_pe text[] DEFAULT NULL::text[], p_dims text[] DEFAULT NULL::text[], p_flags text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
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
           COALESCE(m.stack_on_top, false)      AS f_on_top,
           COALESCE(m.is_semi_finished, false)  AS f_semi
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
           OR (x.f_on_top    AND 'stack_on_top' = ANY (p_flags))
           OR (x.f_semi      AND 'semi_finished' = ANY (p_flags)))
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
END $function$;

CREATE OR REPLACE FUNCTION public.materials_summary(p_tokens text[] DEFAULT NULL::text[], p_categories text[] DEFAULT NULL::text[], p_scope_cats text[] DEFAULT NULL::text[], p_status text[] DEFAULT NULL::text[], p_qr text[] DEFAULT NULL::text[], p_dq text[] DEFAULT NULL::text[], p_cat_rules jsonb DEFAULT '[]'::jsonb, p_legacy_no_sl text[] DEFAULT NULL::text[], p_legacy_pe text[] DEFAULT NULL::text[], p_dims text[] DEFAULT NULL::text[], p_flags text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
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
           COALESCE(m.stack_on_top, false)      AS f_on_top,
           COALESCE(m.is_semi_finished, false)  AS f_semi
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
           OR (x.f_on_top    AND 'stack_on_top' = ANY (p_flags))
           OR (x.f_semi      AND 'semi_finished' = ANY (p_flags)))
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
END $function$;

COMMIT;
