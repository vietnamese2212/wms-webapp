-- Facet Tồn kho: lấy GIÁ TRỊ RỜI RẠC (Chu kỳ / Máy / NCC) bằng DISTINCT dưới DB,
-- thay cho việc KÉO TOÀN BỘ dòng tồn về Node rồi mới gom.
--
-- Trước: controller `listFacets` fetch mọi InventoryEntry IN_STOCK/PARTIAL (phân trang 1000/lượt)
-- chỉ để lấy tập cycle/machine_code/ncc_id. Hôm nay 12.637 dòng ≈ 13 round-trip; ở quy mô
-- vài triệu dòng/năm (luật CLAUDE.md) là hàng NGHÌN round-trip mỗi lần mở trang Tồn kho.
-- Sau: 1 câu DISTINCT, trả vài chục dòng.
--
-- Lọc kho dùng cột `InventoryEntry.warehouse_id` TRỰC TIẾP (đã backfill + đồng bộ trong
-- migration 20260727_entry_warehouse_id_direct.sql) — không liệt kê location_id của kho.

CREATE OR REPLACE FUNCTION inventory_facet_values(
  p_warehouse_ids uuid[] DEFAULT NULL,
  p_categories    text[] DEFAULT NULL
)
RETURNS TABLE (kind text, val text)
LANGUAGE sql
STABLE
AS $$
  WITH scoped AS (
    SELECT e.cycle, e.machine_code, e.ncc_id
    FROM "InventoryEntry" e
    WHERE e.status IN ('IN_STOCK', 'PARTIAL')
      AND (p_warehouse_ids IS NULL OR cardinality(p_warehouse_ids) = 0
           OR e.warehouse_id = ANY (p_warehouse_ids))
      AND (p_categories IS NULL OR cardinality(p_categories) = 0
           OR EXISTS (SELECT 1 FROM "Material" m
                      WHERE m.id = e.material_id AND m.category = ANY (p_categories)))
  )
  SELECT 'cycle'::text,   cycle        FROM scoped WHERE cycle        IS NOT NULL AND cycle <> ''        GROUP BY cycle
  UNION ALL
  SELECT 'machine'::text, machine_code FROM scoped WHERE machine_code IS NOT NULL AND machine_code <> '' GROUP BY machine_code
  UNION ALL
  SELECT 'ncc'::text,     ncc_id::text FROM scoped WHERE ncc_id       IS NOT NULL                        GROUP BY ncc_id;
$$;

-- Chỉ số hỗ trợ quét theo kho + trạng thái (facet luôn lọc 2 điều kiện này)
CREATE INDEX IF NOT EXISTS idx_ie_facet_wh_status
  ON "InventoryEntry" (warehouse_id, status)
  INCLUDE (cycle, machine_code, ncc_id, material_id);
