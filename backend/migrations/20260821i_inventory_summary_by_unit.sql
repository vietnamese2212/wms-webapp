-- 20260821i — Nhánh "Tổng hợp" của trang Tồn kho cũng TÁCH ĐƠN VỊ (đi kèm 20260821g).
--
-- 20260821g đã thêm 'by_unit' cho ô band của chế độ xem CHI TIẾT (RPC inventory_band_totals).
-- Trang Tồn kho có 2 chế độ xem dùng 2 RPC khác nhau, nên nếu chỉ sửa một bên thì CÙNG một trang
-- lúc hiện phần tách đơn vị lúc không — đúng kiểu "sửa 1 chỗ, chỗ kia lệch" mà CLAUDE.md dặn.
-- Nhánh by_unit ở đây phải KHỚP TUYỆT ĐỐI công thức của 20260821g + dashboard_stats.

CREATE OR REPLACE FUNCTION inventory_summary_page(
  p_ids            text[],   -- lọc %Date: tập id đã áp đủ filter khác (null = không dùng)
  p_status         text,     -- ''/null = "Còn tồn" (mặc định) · 'ALL' = mọi trạng thái · khác = đúng trạng thái đó
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
  p_import_to      timestamptz,
  p_offset         int,
  p_limit          int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH e AS (
    SELECT COALESCE(l.warehouse_id, ie.warehouse_id::text) AS wh_id,
           ie.material_id, ie.production_date, ie.ncc_id, ie.shelf_life_days, ie.expiry_date,
           ie.cartons_imported, ie.cartons_remaining
    FROM "InventoryEntry" ie
    -- INNER JOIN = `material:Material!inner` ở select cũ: entry không có mã hàng bị loại HẲN
    JOIN "Material" m ON m.id = ie.material_id
    LEFT JOIN "Location" l ON l.id = ie.location_id
    WHERE (p_ids IS NULL OR ie.id = ANY (p_ids))
      -- "Còn tồn" = trạng thái hoạt động VÀ tồn > 0 (upload cho phép tồn=0 → không lọt list)
      AND (CASE
             WHEN p_status IS NULL OR p_status = '' THEN
               ie.status = ANY (ARRAY['IN_STOCK','PARTIAL','LOOSE_PICKING']) AND ie.cartons_remaining > 0
             WHEN p_status = 'ALL' THEN TRUE
             ELSE ie.status = p_status
           END)
      -- Lọc KHO đi thẳng cột warehouse_id (KHÔNG liệt kê vị trí của kho — bug 504 Bàu Bàng 27/07)
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
      -- Omni-search: mã pallet HOẶC mã/tên hàng HOẶC mã vị trí (2 tập id resolve sẵn ở tầng TS)
      AND (p_search IS NULL
           OR ie.pallet_code ILIKE '%' || p_search || '%'
           OR (p_search_mat_ids IS NOT NULL AND ie.material_id = ANY (p_search_mat_ids))
           OR (p_search_loc_ids IS NOT NULL AND ie.location_id = ANY (p_search_loc_ids)))
  ),
  g AS (
    SELECT wh_id, material_id, production_date, ncc_id, shelf_life_days, expiry_date,
           sum(cartons_imported)  AS cartons_imported,
           sum(cartons_remaining) AS cartons_remaining,
           -- chỉ đếm pallet CÒN TỒN (user chốt 05/07)
           count(*) FILTER (WHERE cartons_remaining > 0) AS pallet_count
    FROM e
    GROUP BY 1,2,3,4,5,6
  ),
  gg AS (
    SELECT g.*, m.material_code, m.short_name, m.category, m.base_unit, m.entry_unit,
           m.units_per_carton, m.shelf_life_days AS mat_shelf_life_days,
           m.supplier_shelf_life_overrides,
           COALESCE(w.name, '—') AS warehouse_name, tc.name AS ncc_name
    FROM g
    JOIN "Material" m ON m.id = g.material_id
    LEFT JOIN "Warehouse" w ON w.id = g.wh_id
    LEFT JOIN "TransportCompany" tc ON tc.id = g.ncc_id
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM gg),
    -- BASE UNIT: tổng cross-mã phải quy đổi THEO TỪNG MÃ trước khi cộng (cộng base thô rồi gắn
    -- nhãn "thùng" là thổi tổng). Dùng chung helper qty_entry_decimal — mirror utils/qtyUnits.
    'total_cartons_remaining',
      (SELECT COALESCE(sum(qty_entry_decimal(cartons_remaining, entry_unit, units_per_carton)), 0) FROM gg),
    -- TÁCH theo ĐƠN VỊ HIỂN THỊ — phải KHỚP nhánh by_unit của inventory_band_totals (20260821g)
    -- và dashboard_stats, không thì 2 chế độ xem của CÙNG trang Tồn kho hiện khác nhau.
    'by_unit', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('unit', u.unit, 'qty', u.qty) ORDER BY u.qty DESC)
      FROM (
        SELECT CASE WHEN entry_unit IS NOT NULL AND COALESCE(units_per_carton, 0) > 0
                    THEN entry_unit ELSE COALESCE(base_unit, 'CAR') END AS unit,
               sum(qty_entry_decimal(cartons_remaining, entry_unit, units_per_carton)) AS qty
        FROM gg GROUP BY 1
      ) u WHERE u.qty <> 0), '[]'::jsonb),
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'warehouse_id',     wh_id,
               'warehouse_name',   warehouse_name,
               'material_id',      material_id,
               'material_code',    material_code,
               'short_name',       short_name,
               'category',         category,
               'production_date',  production_date,
               'expiry_date',      expiry_date,
               'ncc_id',           ncc_id,
               'ncc_name',         ncc_name,
               'shelf_life_days',  shelf_life_days,
               'mat_shelf_life_days', mat_shelf_life_days,
               'supplier_shelf_life_overrides', supplier_shelf_life_overrides,
               'cartons_imported',  cartons_imported,
               'cartons_remaining', cartons_remaining,
               'cartons_exported',  GREATEST(0, cartons_imported - cartons_remaining),
               'pallet_count',      pallet_count,
               'base_unit',         base_unit,
               'entry_unit',        entry_unit,
               'units_per_carton',  units_per_carton) ORDER BY ord)
      FROM (
        -- Sắp giống bản JS cũ: mã hàng ↑, tên kho ↑, ngày SX MỚI NHẤT trước
        SELECT gg.*, row_number() OVER (ORDER BY material_code, warehouse_name, production_date DESC NULLS LAST) AS ord
        FROM gg ORDER BY material_code, warehouse_name, production_date DESC NULLS LAST
        OFFSET p_offset LIMIT p_limit
      ) pg), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;
