-- Lịch sử in tem: phân trang SERVER theo PHIẾU IN (batch), + facet tính trong DB.
--
-- VÌ SAO: `listPrints` trả MẢNG tối đa 20.000 dòng, không cờ cắt, không phân trang. Mỗi tem in
-- là 1 dòng ⇒ kho in vài nghìn tem/ngày là ~1 triệu dòng/năm: xem 1 tháng đã vượt trần và bị
-- cắt ÂM THẦM. FE lại lọc tiếp Chế độ/Tên hàng/Chu kỳ/Máy/Người in trên tập đã tải ⇒ lọc trên
-- phần cụt, và các ô chọn của bộ lọc cũng chỉ liệt kê giá trị có trong phần cụt.
--
-- ĐƠN VỊ TRANG = PHIẾU IN, không phải tem: màn hình gom tem theo lần bấm In (gập/mở). Cắt giữa
-- phiếu thì 1 lệnh in nằm vắt qua 2 trang — vô nghĩa với người dùng. Cùng nguyên tắc "trang theo
-- CỤM" đã dùng cho lưới Kế hoạch vận chuyển.
--
-- Lọc dòng TRƯỚC rồi mới gom phiếu (giữ đúng hành vi cũ: lọc theo mã hàng thì phiếu chỉ hiện
-- những tem khớp). Khoá phiếu = batch_id, log cũ chưa có batch_id thì gom theo created_at|mode|người in.

CREATE OR REPLACE FUNCTION pallet_prints_page(
  p_wh_scope   text[],   -- null = không giới hạn kho (scope NATIONAL)
  p_cat_scope  text[],   -- null = không giới hạn loại hàng
  p_from       timestamptz,
  p_to         timestamptz,
  p_search     text,
  p_modes      text[],
  p_materials  text[],
  p_cycles     text[],
  p_machines   text[],
  p_printers   text[],
  p_offset     int,
  p_limit      int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH f AS (
    SELECT p.id, p.created_at, p.mode,
           COALESCE(p.batch_id::text,
                    p.created_at::text || '|' || p.mode || '|' || COALESCE(p.printed_by_name, '')) AS bkey
    FROM "PalletLabelPrint" p
    WHERE (p_from IS NULL OR p.created_at >= p_from)
      AND (p_to   IS NULL OR p.created_at <= p_to)
      -- scope NULL-INCLUSIVE (dòng cũ chưa gắn kho/loại vẫn hiện) — giữ đúng quy ước toàn app
      AND (p_wh_scope  IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR p.category     IS NULL OR p.category     = ANY (p_cat_scope))
      AND (p_search    IS NULL OR p.qr_code ILIKE '%' || p_search || '%'
                               OR p.material_code ILIKE '%' || p_search || '%'
                               OR p.printed_by_name ILIKE '%' || p_search || '%')
      AND (p_modes     IS NULL OR p.mode            = ANY (p_modes))
      AND (p_materials IS NULL OR p.material_code   = ANY (p_materials))
      AND (p_cycles    IS NULL OR p.cycle           = ANY (p_cycles))
      AND (p_machines  IS NULL OR p.machine         = ANY (p_machines))
      AND (p_printers  IS NULL OR p.printed_by_name = ANY (p_printers))
  ),
  b AS (
    SELECT bkey, max(created_at) AS at, max(mode) AS mode FROM f GROUP BY bkey
  ),
  pg AS (
    SELECT bkey FROM b ORDER BY at DESC, bkey OFFSET p_offset LIMIT p_limit
  )
  -- 4 ô SummaryBand đếm trên TOÀN BỘ bộ lọc (đếm ở FE = đếm mỗi trang đang xem)
  SELECT jsonb_build_object(
    'ids',        COALESCE((SELECT jsonb_agg(f.id) FROM f WHERE f.bkey IN (SELECT bkey FROM pg)), '[]'::jsonb),
    'total',      (SELECT count(*) FROM b),                            -- tổng PHIẾU IN khớp lọc
    'total_rows', (SELECT count(*) FROM f),                            -- tổng TEM khớp lọc
    'new_n',      (SELECT count(*) FROM b WHERE mode <> 'REPRINT'),    -- phiếu sinh mới
    'reprint_n',  (SELECT count(*) FROM b WHERE mode  = 'REPRINT')     -- phiếu in lại
  ) INTO r;
  RETURN r;
END $$;

-- Ô chọn của bộ lọc phải liệt kê giá trị của TOÀN BỘ bộ lọc, không phải của trang đang xem.
CREATE OR REPLACE FUNCTION pallet_prints_facets(
  p_wh_scope  text[],
  p_cat_scope text[],
  p_from      timestamptz,
  p_to        timestamptz,
  p_search    text
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH f AS (
    SELECT p.mode, p.material_code, p.cycle, p.machine, p.category, p.printed_by_name
    FROM "PalletLabelPrint" p
    WHERE (p_from IS NULL OR p.created_at >= p_from)
      AND (p_to   IS NULL OR p.created_at <= p_to)
      AND (p_wh_scope  IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR p.category     IS NULL OR p.category     = ANY (p_cat_scope))
      AND (p_search    IS NULL OR p.qr_code ILIKE '%' || p_search || '%'
                               OR p.material_code ILIKE '%' || p_search || '%'
                               OR p.printed_by_name ILIKE '%' || p_search || '%')
  )
  SELECT jsonb_build_object(
    'modes',     COALESCE((SELECT jsonb_agg(DISTINCT mode)          FROM f WHERE mode IS NULL = FALSE), '[]'::jsonb),
    'materials', COALESCE((SELECT jsonb_agg(DISTINCT material_code) FROM f WHERE material_code IS NOT NULL), '[]'::jsonb),
    'cycles',    COALESCE((SELECT jsonb_agg(DISTINCT cycle)         FROM f WHERE cycle IS NOT NULL), '[]'::jsonb),
    -- Máy/NCC: nhãn hiển thị phụ thuộc loại hàng (hàng NCC hiện TÊN NCC) nên trả kèm category
    'machines',  COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('v', machine, 'c', category))
                           FROM f WHERE machine IS NOT NULL), '[]'::jsonb),
    'printers',  COALESCE((SELECT jsonb_agg(DISTINCT printed_by_name) FROM f WHERE printed_by_name IS NOT NULL), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;

-- Trang lọc gần như luôn có khoảng ngày; batch_id dùng để gom phiếu.
CREATE INDEX IF NOT EXISTS idx_pallet_print_created_batch
  ON "PalletLabelPrint" (created_at DESC, batch_id);
