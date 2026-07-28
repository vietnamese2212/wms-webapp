-- Dashboard · sức chứa KHU: gom "pallet đã dùng" trong SQL thay vì kéo cả bảng tồn về Node.
--
-- VÌ SAO: `computeZoneCapacity` thử gom bằng aggregate của PostgREST, nhưng project này TẮT
-- aggregate (`pgrst.db_aggregates_enabled` off) ⇒ nhánh `try` LUÔN thất bại và rơi xuống fallback
-- "gom trong JS": mỗi lần vào Dashboard kéo **toàn bộ dòng tồn đang hoạt động có vị trí** về.
-- Đo 28/07 với 52.635 pallet: dashboard 8,3s, trong đó RPC `dashboard_stats` chỉ 1,56s — gần 4s
-- còn lại là khâu kéo + gom này. Dashboard là trang ĐẦU TIÊN mọi người mở sau khi đăng nhập.
--
-- Giữ NGUYÊN công thức cũ để số không đổi:
--   pallet dùng của 1 (vị trí × mã) = nếu mã khai `pallet_per_ea` > 0 thì (tồn quy đổi THÙNG ×
--   pallet_per_ea), ngược lại = SỐ DÒNG tồn (mỗi dòng 1 pallet).
--   `qty_entry_decimal` = helper dùng chung, mirror `utils/qtyUnits.qtyEntryDecimal` (BASE UNIT:
--   pallet_per_ea tính trên THÙNG nên phải quy đổi base→thùng TRƯỚC khi nhân).
-- Chỉ tính vị trí `is_active` và có `sub_code` — đúng như vòng lặp cũ trên danh sách vị trí.

CREATE OR REPLACE FUNCTION zone_used_pallets(p_wh_ids text[])
RETURNS TABLE (warehouse_id text, sub_code text, used numeric)
LANGUAGE sql STABLE
AS $$
  WITH g AS (
    SELECT l.warehouse_id, l.sub_code, ie.material_id,
           count(*)                    AS n,
           sum(ie.cartons_remaining)   AS qty
    FROM "InventoryEntry" ie
    JOIN "Location" l ON l.id = ie.location_id
    WHERE ie.status = ANY (ARRAY['IN_STOCK','PARTIAL','QUARANTINE'])
      AND ie.cartons_remaining > 0
      AND l.sub_code IS NOT NULL
      AND l.is_active
      AND (p_wh_ids IS NULL OR ie.warehouse_id::text = ANY (p_wh_ids))
    GROUP BY 1, 2, 3
  )
  SELECT g.warehouse_id, g.sub_code,
         sum(CASE
               WHEN COALESCE(m.pallet_per_ea, 0) > 0
                 THEN qty_entry_decimal(g.qty, m.entry_unit, m.units_per_carton) * m.pallet_per_ea
               ELSE g.n
             END) AS used
  FROM g
  LEFT JOIN "Material" m ON m.id = g.material_id
  GROUP BY 1, 2
$$;

-- Gom theo vị trí của dòng tồn đang hoạt động.
CREATE INDEX IF NOT EXISTS idx_inventory_active_loc_mat
  ON "InventoryEntry" (location_id, material_id)
  WHERE status = ANY (ARRAY['IN_STOCK','PARTIAL','QUARANTINE']) AND cartons_remaining > 0;
