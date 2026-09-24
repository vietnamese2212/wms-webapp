-- 20260821g — Ô tổng Tồn kho: TÁCH THEO ĐƠN VỊ (user chốt 21/08).
--
-- Vấn đề: ô "SL (quy đổi)" là MỘT con số cộng gộp nhiều đơn vị vật lý khác nhau. Đo thật trên
-- staging (Kho Bàu Bàng): 132.762.662 — công thức ĐÚNG (quy đổi per-mã trước khi cộng, đã đối
-- chiếu oracle độc lập, lệch 0,008 do làm tròn) nhưng **131.209.050 trong đó là EA** của 2.169
-- pallet mã không khai quy cách thùng, cộng lẫn 784.654 KG và ~538.000 thùng thật. Tooltip đã nói
-- "không phải số thùng thực tế" — nhưng bắt người đọc tra tooltip mới hiểu con số thì con số đó
-- chưa dùng được.
--
-- Nay RPC trả THÊM 'by_unit' (mảng { unit, qty } sắp giảm dần). TỔNG GIỮ NGUYÊN — không đổi công
-- thức, chỉ nói rõ nó gồm những gì. Thêm khoá vào jsonb là ADDITIVE: bundle FE cũ bỏ qua, không vỡ.
--
-- ⚠️ Nhánh by_unit phải KHỚP cách phân đơn vị của dashboard_stats (entry_unit khi mã có quy cách
-- thùng, còn lại base_unit) — 2 chỗ lệch nhau thì Dashboard và Tồn kho đá nhau.

CREATE OR REPLACE FUNCTION inventory_band_totals(
  p_ids            text[],
  p_status         text,
  p_wh_ids         text[],
  p_location_ids   text[],
  p_material_ids   text[],
  p_categories     text[],
  p_qa_ids         text[],
  p_search         text,
  p_search_mat_ids text[],
  p_search_loc_ids text[],
  p_manufacturer   text,
  p_cycles         text[],
  p_machines       text[],
  p_nmsx           text[],
  p_ncc_ids        text[],
  p_import_from    timestamptz,
  p_import_to      timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH e AS (
    SELECT ie.material_id, ie.cartons_remaining
    FROM "InventoryEntry" ie
    JOIN "Material" m ON m.id = ie.material_id       -- = `material:Material!inner`
    WHERE (p_ids IS NULL OR ie.id = ANY (p_ids))
      AND (CASE
             WHEN p_status IS NULL OR p_status = '' THEN
               ie.status = ANY (ARRAY['IN_STOCK','PARTIAL','LOOSE_PICKING']) AND ie.cartons_remaining > 0
             WHEN p_status = 'ALL' THEN TRUE
             ELSE ie.status = p_status
           END)
      AND (p_wh_ids       IS NULL OR ie.warehouse_id::text = ANY (p_wh_ids))
      AND (p_location_ids IS NULL OR ie.location_id  = ANY (p_location_ids))
      AND (p_material_ids IS NULL OR ie.material_id  = ANY (p_material_ids))
      AND (p_categories   IS NULL OR m.category      = ANY (p_categories))
      AND (p_qa_ids       IS NULL OR ie.qa_status_id = ANY (p_qa_ids))
      AND (p_manufacturer IS NULL OR ie.manufacturer_id = p_manufacturer)
      AND (p_cycles       IS NULL OR ie.cycle        = ANY (p_cycles))
      AND (p_machines     IS NULL OR ie.machine_code = ANY (p_machines))
      AND (p_nmsx         IS NULL OR ie.nmsx         = ANY (p_nmsx))
      AND (p_ncc_ids      IS NULL OR ie.ncc_id::text = ANY (p_ncc_ids))
      AND (p_import_from  IS NULL OR ie.import_date >= p_import_from)
      AND (p_import_to    IS NULL OR ie.import_date <= p_import_to)
      AND (p_search IS NULL
           OR ie.pallet_code ILIKE '%' || p_search || '%'
           OR (p_search_mat_ids IS NOT NULL AND ie.material_id = ANY (p_search_mat_ids))
           OR (p_search_loc_ids IS NOT NULL AND ie.location_id = ANY (p_search_loc_ids)))
  ),
  g AS (
    SELECT e.material_id, sum(e.cartons_remaining) AS rem,
           -- ô "Pallet" chỉ đếm pallet CÒN TỒN (>0): list chỉ hiện pallet 0 khi chọn "Tất cả"
           count(*) FILTER (WHERE e.cartons_remaining > 0) AS n_pallet
    FROM e GROUP BY 1
  )
  SELECT jsonb_build_object(
    'total_cartons_remaining',
      (SELECT COALESCE(sum(qty_entry_decimal(g.rem, m.entry_unit, m.units_per_carton)), 0)
       FROM g JOIN "Material" m ON m.id = g.material_id),
    'total_pallets_in_stock', (SELECT COALESCE(sum(n_pallet), 0) FROM g),
    -- TÁCH theo ĐƠN VỊ HIỂN THỊ (21/08): ô tổng gộp cả thùng + EA + KG + BAG nên con số to bất
    -- thường (đo Bàu Bàng: 132.762.662 mà 131,2 triệu trong đó là EA của mã không khai thùng).
    -- Công thức TỔNG giữ nguyên — chỉ NÓI RÕ nó gồm những gì. Đơn vị hiển thị = entry_unit khi mã
    -- có quy cách thùng, còn lại base_unit (KHỚP nhánh by_unit của dashboard_stats).
    'by_unit', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('unit', u.unit, 'qty', u.qty) ORDER BY u.qty DESC)
      FROM (
        SELECT CASE WHEN m.entry_unit IS NOT NULL AND COALESCE(m.units_per_carton, 0) > 0
                    THEN m.entry_unit ELSE COALESCE(m.base_unit, 'CAR') END AS unit,
               sum(qty_entry_decimal(g.rem, m.entry_unit, m.units_per_carton)) AS qty
        FROM g JOIN "Material" m ON m.id = g.material_id
        GROUP BY 1
      ) u WHERE u.qty <> 0), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;
