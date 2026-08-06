-- FIX RULE "TỒN CẬN DATE" CHẾT CÂM (check-app 06/08 bắt ngay lượt khảo sát đầu).
--
-- Triệu chứng: `alerts_expiry_candidates` nổ 42883 `operator does not exist: timestamp without
-- time zone + integer` ⇒ scanner bọc try/catch per-rule nên NUỐT lỗi ⇒ rule EXPIRY KHÔNG BAO GIỜ
-- chạy: staging có 120 nhóm (kho,mã) = 6,43 triệu base đang trong cửa sổ 120 ngày mà 0 cảnh báo.
-- Nguyên nhân: `InventoryEntry.production_date` là **timestamp without time zone** (không phải
-- `date` như `expiry_date`) — Postgres KHÔNG có toán tử `timestamp + integer`.
-- Fix: ép `::date` trước khi cộng số ngày (giữ nguyên mọi điều kiện khác).
-- Bài học đi kèm (bug chết hai lần): scanner từ nay GHI error_logs khi 1 rule lỗi (không chỉ
-- console.error — serverless không ai đọc), + QA gói 20 kiểm TỪNG rule chạy được.
CREATE OR REPLACE FUNCTION alerts_expiry_candidates(p_days int DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql STABLE SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_j), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object(
      'warehouse_id',   g.warehouse_id,
      'warehouse_name', w.name,
      'material_id',    g.material_id,
      'material_code',  m.material_code,
      'short_name',     m.short_name,
      'category',       m.category,
      'production_date', g.production_date,
      'expiry_date',     g.expiry_date,
      'shelf_life_days', g.shelf_life_days,
      'ncc_id',          g.ncc_id,
      'mat_shelf_life_days', m.shelf_life_days,
      'supplier_shelf_life_overrides', m.supplier_shelf_life_overrides,
      'qty_base',        g.qty_base,
      'pallets',         g.pallets
    ) AS row_j
    FROM (
      SELECT e.warehouse_id, e.material_id, e.production_date, e.expiry_date,
             e.shelf_life_days, e.ncc_id,
             SUM(e.cartons_remaining) AS qty_base, COUNT(*) AS pallets
      FROM "InventoryEntry" e
      JOIN "Material" mm ON mm.id = e.material_id
      WHERE e.cartons_remaining > 0
        AND e.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
        AND (
          (e.expiry_date IS NOT NULL AND e.expiry_date <= current_date + p_days)
          OR (e.expiry_date IS NULL AND e.production_date IS NOT NULL
              AND COALESCE(e.shelf_life_days, mm.shelf_life_days, 0) > 0
              AND e.production_date::date + COALESCE(e.shelf_life_days, mm.shelf_life_days, 0) <= current_date + p_days)
          OR (e.production_date IS NOT NULL
              AND jsonb_typeof(mm.supplier_shelf_life_overrides) = 'array'
              AND jsonb_array_length(mm.supplier_shelf_life_overrides) > 0)
        )
      GROUP BY e.warehouse_id, e.material_id, e.production_date, e.expiry_date, e.shelf_life_days, e.ncc_id
    ) g
    JOIN "Material" m ON m.id = g.material_id
    LEFT JOIN "Warehouse" w ON w.id::text = g.warehouse_id::text
    ORDER BY COALESCE(g.expiry_date, g.production_date::date) NULLS LAST
    LIMIT 2000   -- cầu chì: quá 2000 nhóm cận date là chuyện bất thường, cắt có chủ đích
  ) t;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION alerts_expiry_candidates(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION alerts_expiry_candidates(int) TO service_role;
