-- Lịch sử Dồn/Tách pallet: phân trang SERVER + 4 ô SummaryBand tính trong DB.
--
-- VÌ SAO (đo 28/07 với 25.000 thao tác): `listOps` có `hardCap = 5.000` và trả về MẢNG TRẦN —
-- không `total`, không cờ `truncated`. Người dùng thấy đúng 5.000 dòng và KHÔNG có cách nào biết
-- còn 20.000 dòng nữa, cũng không có đường đi tới. Đây là mức sai nặng nhất: CẮT ÂM THẦM.
-- Payload 5.000 dòng đã 1.402KB; nâng trần lên 20.000 (giá trị max của tham số `limit`) thì
-- ~5,6MB → vượt trần 4,5MB của Vercel. Nâng trần không cứu được, chỉ phân trang mới cứu.
--
-- Mỗi lần dồn/tách = 1 dòng `PalletOperation`. Kho đang thao tác vài trăm lượt/ngày ⇒ ~100k
-- dòng/năm, tức trần 5.000 bị chạm trong khoảng 2 tuần.
--
-- LỌC "LOẠI KHO" PHẢI XUỐNG SQL: trang đang lọc Loại kho ở CLIENT bằng cách suy mã hàng từ tem
-- pallet rồi tra `Material.category`. Khi đã phân trang, lọc ở client = lọc trên ĐÚNG 1 TRANG
-- (trang 20 dòng lọc còn 3, ô tổng cũng sai). Nên bóc mã hàng ngay trong SQL, khớp 2 định dạng
-- tem: V1 `ddmmyy_MãHàng_...` (đoạn 2 của `_`) và V2 `MãHàng;QA;...` (đoạn 1 của `;`, có đệm
-- space nên phải btrim) — cùng quy tắc với `materialCodeOf` ở FE và `parseInboundQR` ở BE.

-- Mã hàng của 1 thao tác = suy từ tem đích, không có thì tem nguồn (mirror FE:
-- `o.target_codes?.[0] || o.source_codes?.[0]`).
-- NULLIF(...,'') là BẮT BUỘC: `split_part` trả '' khi tem không có đoạn đó (mã rác, tem tay).
-- Trả '' thì điều kiện null-inclusive bên dưới không bắt được ⇒ dòng đó bị LOẠI khi lọc Loại kho,
-- trái quy ước toàn app "bản ghi không khai loại vẫn hiện".
CREATE OR REPLACE FUNCTION pallet_op_material_code(p_target text[], p_source text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN code IS NULL OR code = '' THEN NULL
           WHEN position(';' IN code) > 0 THEN NULLIF(btrim(split_part(code, ';', 1)), '')
           ELSE NULLIF(btrim(split_part(code, '_', 2)), '')
         END
  FROM (SELECT COALESCE(p_target[1], p_source[1]) AS code) t
$$;

CREATE OR REPLACE FUNCTION pallet_ops_page(
  p_wh        uuid,      -- kho (trang bắt buộc chọn kho trước khi xem lịch sử)
  p_type      text,      -- MERGE | SPLIT | UNGROUP | null
  p_category  text,      -- Loại kho (suy từ mã hàng của tem) | null
  p_search    text,      -- mã tem pallet: khớp trong source_codes HOẶC target_codes
  p_from      timestamptz,
  p_to        timestamptz,
  p_offset    int,
  p_limit     int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH f AS (
    SELECT o.id, o.created_at, o.type, o.undone_at
    FROM "PalletOperation" o
    WHERE (p_wh     IS NULL OR o.warehouse_id = p_wh)
      AND (p_type   IS NULL OR o.type = p_type)
      AND (p_from   IS NULL OR o.created_at >= p_from)
      AND (p_to     IS NULL OR o.created_at <= p_to)
      AND (p_search IS NULL OR o.source_codes @> ARRAY[p_search] OR o.target_codes @> ARRAY[p_search])
      -- null-inclusive: thao tác không suy được mã hàng vẫn hiện (quy ước toàn app)
      AND (p_category IS NULL OR EXISTS (
            SELECT 1 FROM "Material" m
            WHERE m.material_code = pallet_op_material_code(o.target_codes, o.source_codes)
              AND m.category = p_category)
           OR pallet_op_material_code(o.target_codes, o.source_codes) IS NULL)
  )
  SELECT jsonb_build_object(
    'ids',      COALESCE((SELECT jsonb_agg(id ORDER BY created_at DESC, id)
                          FROM (SELECT id, created_at FROM f
                                ORDER BY created_at DESC, id OFFSET p_offset LIMIT p_limit) pg), '[]'::jsonb),
    -- 4 ô SummaryBand đếm trên TOÀN BỘ bộ lọc (đếm ở FE = chỉ đếm trang đang xem)
    'total',    (SELECT count(*) FROM f),
    'merge_n',  (SELECT count(*) FROM f WHERE type = 'MERGE'),
    'split_n',  (SELECT count(*) FROM f WHERE type = 'SPLIT'),
    'undone_n', (SELECT count(*) FROM f WHERE undone_at IS NOT NULL)
  ) INTO r;
  RETURN r;
END $$;

-- Lịch sử luôn lọc theo kho + sắp theo thời gian giảm dần.
CREATE INDEX IF NOT EXISTS idx_pallet_op_wh_created
  ON "PalletOperation" (warehouse_id, created_at DESC);
-- Tìm theo mã tem: quét mảng source/target.
CREATE INDEX IF NOT EXISTS idx_pallet_op_source_codes ON "PalletOperation" USING gin (source_codes);
CREATE INDEX IF NOT EXISTS idx_pallet_op_target_codes ON "PalletOperation" USING gin (target_codes);
