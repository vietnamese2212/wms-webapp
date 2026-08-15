-- Dashboard · dải "Sức chứa theo khu" gom về MỘT lời gọi: `zone_capacity_rows`.
-- Thay `zone_used_pallets` (chỉ trả pallet đã dùng) — nay trả LUÔN cả danh sách khu + sức chứa +
-- tên kho, đã lọc loại hàng và đã SẮP XẾP đúng thứ tự hiển thị.
--
-- VÌ SAO (đo 28/07): Dashboard tự nó chỉ tốn ~267ms trong DB, nhưng nó bắn **5 request PostgREST**
-- mỗi lần vào trang (2× WarehouseZone phân trang, 1× Warehouse, 1× dashboard_stats, 1× zone_used_pallets).
-- Dưới tải 24 luồng ghi nó lên 22.422ms — KHÔNG phải vì tự nó nặng, mà vì mỗi request phải chờ khe
-- trong pool ~10 khe NỘI BỘ của PostgREST (phép đo phân biệt tầng: pg trực tiếp p95 338ms — máy DB
-- hoàn toàn khoẻ). Với hàng đợi thì độ trễ ≈ SỐ REQUEST × thời gian chờ ⇒ giảm số request là đòn
-- trực tiếp, kể cả với đường vốn đã rẻ. Dashboard là trang ai cũng mở đầu tiên nên đáng làm.
-- Nay: 5 request → 2 (dashboard_stats + hàm này).
--
-- GIỮ NGUYÊN NGỮ NGHĨA (số phải khớp tuyệt đối với đường cũ, đã verify 15/15 khu):
--   · chỉ khu `is_active`; chỉ vị trí `is_active` và có `sub_code`
--   · lọc loại hàng NULL-INCLUSIVE: khu không khai loại VẪN hiện (quy ước toàn app)
--   · quy đổi pallet theo `pallet_per_ea` qua `qty_entry_decimal` (BASE UNIT: quy đổi THEO TỪNG MÃ
--     rồi mới cộng — cộng base thô rồi gắn nhãn "pallet" là thổi tổng)
--   · `category` trả về là chuỗi các loại nối bằng ', ' (FE hiển thị thẳng, giữ đúng payload cũ)
--   · thứ tự: tên kho → sort_order → mã khu

CREATE OR REPLACE FUNCTION zone_capacity_rows(
  p_wh_ids     text[],
  p_categories text[]
) RETURNS TABLE (
  zone_id        text,
  warehouse_id   text,
  warehouse_name text,
  code           text,
  name           text,
  category       text,
  capacity       numeric,
  used           numeric
)
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
BEGIN
  RETURN QUERY
  WITH z AS (
    SELECT wz.id, wz.warehouse_id, wz.code, wz.name, wz.categories,
           wz.sort_order, COALESCE(wz.max_pallets, 0) AS cap
    FROM "WarehouseZone" wz
    WHERE wz.is_active
      AND (p_wh_ids IS NULL OR wz.warehouse_id = ANY (p_wh_ids))
      -- null-inclusive: khu chưa khai loại vẫn hiện; khai rồi thì cần GIAO ≥1 loại
      AND (p_categories IS NULL
           OR wz.categories IS NULL
           OR cardinality(wz.categories) = 0
           OR wz.categories && p_categories)
  ),
  -- ⚠️ Thân 2 CTE dưới đây là NGUYÊN VĂN `zone_used_pallets` (migration 20260728d) — bản đã verify
  -- khớp 15/15 khu với đường tính cũ. CỐ Ý copy thay vì tự diễn giải lại: lần đầu viết lại "cho
  -- gọn" tôi làm lệch 4 điểm (thiếu lọc status, thiếu cartons_remaining>0, truyền sai tham số thứ 3
  -- của qty_entry_decimal, và bỏ nhánh "mã KHÔNG khai pallet_per_ea thì đếm SỐ DÒNG") → used sai
  -- gấp hàng nghìn lần. Sửa công thức pallet-đã-dùng thì phải sửa CẢ HAI hàm cho khớp.
  g AS (
    SELECT l.warehouse_id, l.sub_code, ie.material_id,
           count(*)                  AS n,
           sum(ie.cartons_remaining) AS qty
    FROM "InventoryEntry" ie
    JOIN "Location" l ON l.id = ie.location_id
    WHERE ie.status = ANY (ARRAY['IN_STOCK','PARTIAL','QUARANTINE'])
      AND ie.cartons_remaining > 0
      AND l.sub_code IS NOT NULL
      AND l.is_active
      AND (p_wh_ids IS NULL OR ie.warehouse_id::text = ANY (p_wh_ids))
    GROUP BY 1, 2, 3
  ),
  u AS (
    SELECT g.warehouse_id AS wh, g.sub_code AS sub,
           sum(CASE
                 WHEN COALESCE(m.pallet_per_ea, 0) > 0
                   THEN qty_entry_decimal(g.qty, m.entry_unit, m.units_per_carton) * m.pallet_per_ea
                 ELSE g.n
               END) AS used
    FROM g
    LEFT JOIN "Material" m ON m.id = g.material_id
    GROUP BY 1, 2
  )
  -- CAST TƯỜNG MINH từng cột: `WarehouseZone.id` là uuid, `code`/`name` là varchar, `max_pallets`
  -- là integer — khai text/numeric mà không cast thì RPC chết với "structure of query does not
  -- match function result type", và ở Dashboard lỗi đó bị `.catch()` nuốt thành DẢI RỖNG (không
  -- báo gì). Đã dính đúng bẫy này khi viết hàm.
  SELECT z.id::text, z.warehouse_id::text,
         COALESCE(w.name, z.warehouse_id)::text,
         z.code::text, z.name::text,
         (CASE WHEN z.categories IS NULL OR cardinality(z.categories) = 0
               THEN NULL ELSE array_to_string(z.categories, ', ') END)::text,
         z.cap::numeric,
         round(COALESCE(u.used, 0)::numeric, 1)
  FROM z
  LEFT JOIN "Warehouse" w ON w.id = z.warehouse_id
  LEFT JOIN u ON u.wh = z.warehouse_id AND u.sub = z.code
  ORDER BY COALESCE(w.name, z.warehouse_id), COALESCE(z.sort_order, 1000000000), z.code;
END $$;
