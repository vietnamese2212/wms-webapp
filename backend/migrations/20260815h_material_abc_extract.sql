-- QUY TẮC CẤT HÀNG — đợt C: bóc luật ABC thành MỘT NGUỒN rồi cho cả Slotting lẫn Putaway dùng chung.
--
-- Vì sao phải bóc: luật "mã nào hạng A/B/C" đang nằm TRONG SQL của `slotting_stats`. Chiến thuật cất
-- hàng "Theo ABC" cần đúng luật đó — chép sang chỗ khác là đẻ bản thứ hai, tức tái phạm đúng thứ
-- chiến dịch 14–15/08 vừa dọn (rotation 4 bản, ★ 3 bản). Nên: một hàm `material_abc`, `slotting_stats`
-- gọi lại nó, không ai chép gì cả.
--
-- AN TOÀN: `slotting_stats` đang chạy thật (trang Tối ưu vị trí + Kiểm kê luân phiên ABC). Bản này
-- GIỮ NGUYÊN TỪNG BIỂU THỨC (kể cả `cum_picks`/`total_picks` để dòng `cum_share` không đổi cách tính)
-- và được nghiệm bằng cách DIFF NGUYÊN KHỐI jsonb đầu ra trước/sau trên mọi kho × 4 cửa sổ ngày ×
-- từng Loại kho. Lệch một ký tự = lùi lại.

BEGIN;

-- ─── NGUỒN DUY NHẤT của luật ABC ────────────────────────────────────────────
-- Ngưỡng: dồn theo lượt nhặt giảm dần — dưới 80% luỹ kế = A, dưới 95% = B, còn lại = C.
-- Mã KHÔNG có lượt nhặt nào → C (không phải "chưa xếp hạng": không ai lấy thì đúng là hạng C).
-- ABC là hạng TƯƠNG ĐỐI trong phạm vi (kho, loại hàng, cửa sổ ngày) — đổi phạm vi là đổi hạng,
-- nên 3 tham số này phải đi cùng nhau ở MỌI nơi gọi.
CREATE OR REPLACE FUNCTION public.material_abc(
  p_warehouse_id text,
  p_categories   text[] DEFAULT NULL,
  p_days         integer DEFAULT 30
)
RETURNS TABLE (
  material_id     text,
  material_code   text,
  short_name      text,
  category        text,
  picks           int,
  cartons_out     numeric,
  pallets_touched int,
  stock_pallets   int,
  stock_cartons   numeric,
  abc             text,
  cum_picks       numeric,
  total_picks     numeric
)
LANGUAGE sql
STABLE
AS $function$
WITH win AS (
  SELECT (now() AT TIME ZONE 'UTC') - make_interval(days => GREATEST(COALESCE(p_days, 30), 1)) AS t0
),
picks AS (
  SELECT ie.material_id,
         count(*)::int                              AS picks,
         COALESCE(sum(ose.cartons_scanned), 0)      AS cartons_out_base,
         count(DISTINCT ose.inventory_entry_id)::int AS pallets_touched
  FROM "OutboundScanEntry" ose
  JOIN "InventoryEntry" ie ON ie.id = ose.inventory_entry_id
  WHERE ie.warehouse_id::text = p_warehouse_id
    AND ose.scanned_at >= (SELECT t0 FROM win)
  GROUP BY ie.material_id
),
stock AS (
  SELECT ie.material_id,
         count(*)::int                          AS pallets,
         COALESCE(sum(ie.cartons_remaining), 0) AS cartons_base
  FROM "InventoryEntry" ie
  WHERE ie.warehouse_id::text = p_warehouse_id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  GROUP BY ie.material_id
),
mats AS (
  SELECT mu.material_id, m.material_code, m.short_name, m.category,
         COALESCE(p.picks, 0)           AS picks,
         COALESCE(p.cartons_out_base, 0) / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end) AS cartons_out,
         COALESCE(p.pallets_touched, 0) AS pallets_touched,
         COALESCE(st.pallets, 0)        AS stock_pallets,
         COALESCE(st.cartons_base, 0) / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end) AS stock_cartons
  FROM (SELECT material_id FROM picks UNION SELECT material_id FROM stock) mu
  JOIN "Material" m ON m.id = mu.material_id
  LEFT JOIN picks p  ON p.material_id  = mu.material_id
  LEFT JOIN stock st ON st.material_id = mu.material_id
  WHERE p_categories IS NULL OR m.category IS NULL OR m.category = ANY(p_categories)
)
SELECT material_id, material_code, short_name, category,
       picks, cartons_out, pallets_touched, stock_pallets, stock_cartons,
       CASE
         WHEN picks = 0 OR sum(picks) OVER () = 0 THEN 'C'
         WHEN (sum(picks) OVER (ORDER BY picks DESC, material_code) - picks)::numeric
              / NULLIF(sum(picks) OVER (), 0) < 0.80 THEN 'A'
         WHEN (sum(picks) OVER (ORDER BY picks DESC, material_code) - picks)::numeric
              / NULLIF(sum(picks) OVER (), 0) < 0.95 THEN 'B'
         ELSE 'C'
       END AS abc,
       sum(picks) OVER (ORDER BY picks DESC, material_code) AS cum_picks,
       sum(picks) OVER ()                                   AS total_picks
FROM mats
$function$;

GRANT EXECUTE ON FUNCTION public.material_abc(text, text[], integer) TO service_role;

-- ─── slotting_stats: GỌI LẠI hàm trên, không còn giữ bản luật riêng ─────────
-- `stock_by_zone` giữ ở đây vì khối `placement` cần tách theo sub_code (không phải luật ABC).
CREATE OR REPLACE FUNCTION public.slotting_stats(p_warehouse_id text, p_categories text[] DEFAULT NULL::text[], p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
WITH classed AS (
  SELECT * FROM public.material_abc(p_warehouse_id, p_categories, p_days)
),
stock_by_zone AS (
  SELECT ie.material_id, l.sub_code,
         count(*)::int                          AS pallets,
         COALESCE(sum(ie.cartons_remaining), 0) AS cartons_base
  FROM "InventoryEntry" ie
  LEFT JOIN "Location" l ON l.id = ie.location_id
  WHERE ie.warehouse_id::text = p_warehouse_id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  GROUP BY ie.material_id, l.sub_code
),
loc_used AS (
  SELECT l.id, l.location_code, l.sub_code, l.max_pallets, l.categories,
         l.slot_no_in, l.slot_no_out,
         count(ie.id)::int AS used_slots
  FROM "Location" l
  LEFT JOIN "InventoryEntry" ie ON ie.location_id = l.id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  WHERE l.warehouse_id = p_warehouse_id AND l.is_active = true
  GROUP BY l.id, l.location_code, l.sub_code, l.max_pallets, l.categories, l.slot_no_in, l.slot_no_out
)
SELECT jsonb_build_object(
  'total_picks', COALESCE((SELECT sum(picks) FROM classed), 0),
  'materials', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'material_id', c.material_id, 'code', c.material_code, 'name', c.short_name,
      'category', c.category,
      'picks', c.picks, 'cartons_out', c.cartons_out,
      'pallets_touched', c.pallets_touched, 'stock_pallets', c.stock_pallets,
      'stock_cartons', c.stock_cartons, 'abc', c.abc,
      'cum_share', CASE WHEN c.total_picks > 0 THEN round(c.cum_picks::numeric / c.total_picks, 4) ELSE 0 END
    ) ORDER BY c.picks DESC, c.material_code) FROM classed c), '[]'::jsonb),
  'placement', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'material_id', s.material_id, 'sub_code', s.sub_code,
      'pallets', s.pallets,
      'cartons', s.cartons_base / (case when m2.entry_unit is not null and coalesce(m2.units_per_carton,0) > 0 then m2.units_per_carton else 1 end)))
    FROM stock_by_zone s JOIN "Material" m2 ON m2.id = s.material_id
    WHERE s.material_id IN (SELECT material_id FROM classed)), '[]'::jsonb),
  'zones', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', z.id, 'code', z.code, 'name', z.name, 'categories', z.categories,
      'pick_rank', z.pick_rank, 'flow_type', z.flow_type,
      'capacity', COALESCE(zc.capacity, 0), 'used_slots', COALESCE(zc.used_slots, 0))
      ORDER BY z.pick_rank NULLS LAST, z.sort_order)
    FROM "WarehouseZone" z
    LEFT JOIN (SELECT sub_code, sum(max_pallets)::int AS capacity, sum(used_slots)::int AS used_slots
               FROM loc_used GROUP BY sub_code) zc ON zc.sub_code = z.code
    WHERE z.warehouse_id = p_warehouse_id AND z.is_active = true), '[]'::jsonb),
  'locations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', lu.id, 'location_code', lu.location_code, 'sub_code', lu.sub_code,
      'max_pallets', lu.max_pallets, 'used_slots', lu.used_slots,
      'slot_no_in', lu.slot_no_in, 'slot_no_out', lu.slot_no_out)
      ORDER BY lu.location_code)
    FROM loc_used lu), '[]'::jsonb)
);
$function$;

COMMIT;
