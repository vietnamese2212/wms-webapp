-- CYCLE COUNTING THEO ABC (Đợt 3 roadmap 06/08) — kiểm kê LUÂN PHIÊN thay kiểm full:
-- hạng A (nhặt nhiều) kiểm 7 ngày/lần, B 30 ngày, C 90 ngày (ngưỡng ở BE inventoryController).
--
-- Hạng ABC KHÔNG tính lại ở đây — nguồn DUY NHẤT là RPC slotting_stats (công thức 80/95% lượt
-- nhặt lũy kế). RPC này chỉ trả 2 thứ còn thiếu để BE ghép: (1) lần kiểm GẦN NHẤT per mã từ
-- StocktakeLog (append-only, không mất dấu khi pallet xuất đi), (2) danh sách vị trí đang chứa
-- từng mã (để nút "Kiểm các mã đã chọn" prefill bộ lọc Tổng hợp KK).

-- Index cho MAX(counted_at) GROUP BY material — StocktakeLog sẽ hàng trăm nghìn dòng/năm
CREATE INDEX IF NOT EXISTS idx_stocktakelog_wh_mat_counted
  ON "StocktakeLog" (warehouse_id, material_id, counted_at DESC);

CREATE OR REPLACE FUNCTION cycle_count_info(p_warehouse_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'last_counted', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('material_id', material_id, 'last_at', last_at))
      FROM (
        SELECT material_id, MAX(counted_at) AS last_at
        FROM "StocktakeLog"
        WHERE warehouse_id::text = p_warehouse_id AND material_id IS NOT NULL
        GROUP BY material_id
        LIMIT 10000   -- cầu chì: nhiều hơn 10k mã từng kiểm trong 1 kho là bất thường
      ) t
    ), '[]'::jsonb),
    'material_locs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('material_id', material_id, 'loc_ids', loc_ids, 'loc_codes', loc_codes))
      FROM (
        SELECT e.material_id,
               (array_agg(DISTINCT l.id::text))[1:200]           AS loc_ids,   -- cap 200 vị trí/mã
               (array_agg(DISTINCT l.location_code))[1:5]        AS loc_codes  -- mẫu hiển thị
        FROM "InventoryEntry" e
        JOIN "Location" l ON l.id = e.location_id
        WHERE e.warehouse_id::text = p_warehouse_id
          AND e.cartons_remaining > 0
          AND e.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
        GROUP BY e.material_id
        LIMIT 10000
      ) t
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION cycle_count_info(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cycle_count_info(text) TO service_role;
