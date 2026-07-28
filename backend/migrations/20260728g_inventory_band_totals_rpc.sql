-- Tồn kho · 2 ô SummaryBand ("Thùng tồn" + "Pallet") gom trong MỘT lời gọi.
--
-- VÌ SAO (đo 28/07 bằng gói QA `06-readload` + đường cong sức chứa):
-- Mỗi lần đổi trang, `/wms/inventory` bắn 3 việc nặng song song, trong đó ô "Thùng tồn" là
-- tệ nhất — nó KHÔNG phải 1 query mà là một chuỗi round-trip:
--   (1) `fetchAllPaged` nạp nhóm SUM theo material_id (tới ~2.700 dòng, phân trang 1000/lần)
--   (2) rồi chunk 300 để tra `Material` lấy hệ số thùng, quy đổi trong Node.
-- Dưới tải ghi đồng thời, trang Tồn kho đi từ 1.955ms (0 người ghi) → **19.774ms ở 24 người ghi**
-- và vượt trần 8s của PostgREST thành 500. Câu NHẸ cùng lúc đó vẫn 1.147ms ⇒ nút thắt nằm ở
-- chính mấy việc nặng này, không phải DB bị bóp toàn cục (connection đỉnh chỉ 26/60).
--
-- Nay: 1 lời gọi, DB quét 1 lượt, quy đổi thùng ngay trong SQL bằng `qty_entry_decimal`
-- (helper dùng chung, mirror `utils/qtyUnits.qtyEntryDecimal` — BASE UNIT: phải quy đổi THEO
-- TỪNG MÃ rồi mới cộng, cộng base thô rồi gắn nhãn "thùng" là thổi tổng).
--
-- ⚠️ Mệnh đề WHERE phải KHỚP `applyInventoryFilters` (giống RPC inventory_summary_page) — lệch
-- một điều kiện là ô tổng và bảng đá nhau.

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
    'total_pallets_in_stock', (SELECT COALESCE(sum(n_pallet), 0) FROM g)
  ) INTO r;
  RETURN r;
END $$;
