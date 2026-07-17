-- SLOTTING OPTIMIZATION (Tối ưu vị trí — mục 6 roadmap, user chốt 17/07).
-- 1) WarehouseZone.pick_rank: hạng nhặt của khu (1 = gần cửa xuất nhất) — user khai trong tab Khu vực.
-- 2) SlottingPlan + SlottingPlanLine: kế hoạch sắp xếp lại kho (pallet từ vị trí → vị trí).
--    Tiến độ dòng KHÔNG lưu status — suy sống từ InventoryEntry.location_id hiện tại
--    (công nhân dùng tính năng đổi vị trí sẵn có; pallet về đúng đích = DONE).
-- 3) RPC slotting_stats: aggregate ABC velocity phía DB (PostgREST tắt aggregate, bảng scan triệu dòng).

ALTER TABLE public."WarehouseZone" ADD COLUMN IF NOT EXISTS pick_rank integer;

CREATE TABLE IF NOT EXISTS public."SlottingPlan" (
  id            text PRIMARY KEY,
  warehouse_id  text NOT NULL,
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | COMPLETED | CANCELLED
  note          text,
  window_days   integer,                          -- cửa sổ phân tích lúc sinh kế hoạch (30/60/90)
  n_lines       integer NOT NULL DEFAULT 0,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  completed_by  text,
  updated_at    timestamptz NOT NULL,
  updated_by    text
);

CREATE TABLE IF NOT EXISTS public."SlottingPlanLine" (
  id                 text PRIMARY KEY,
  plan_id            text NOT NULL REFERENCES public."SlottingPlan"(id) ON DELETE CASCADE,
  inventory_entry_id text NOT NULL,
  pallet_code        text NOT NULL,
  material_code      text,
  material_name      text,
  abc                text,                        -- hạng ABC của mã lúc sinh kế hoạch (A/B/C)
  reason             text,                        -- vd 'Mã A đang ở khu xa' / 'Mã C chiếm khu gần cửa'
  from_location_id   text,
  from_location_code text,                        -- snapshot (vị trí có thể đổi tên/xóa sau này)
  to_location_id     text NOT NULL,
  to_location_code   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spl_plan  ON public."SlottingPlanLine"(plan_id);
CREATE INDEX IF NOT EXISTS idx_sp_wh     ON public."SlottingPlan"(warehouse_id, status);

ALTER TABLE public."SlottingPlan"     ENABLE ROW LEVEL SECURITY;  -- chặn anon (service role bypass)
ALTER TABLE public."SlottingPlanLine" ENABLE ROW LEVEL SECURITY;

-- Realtime CÓ ĐIỀU KIỆN (tránh 42710 nếu publication FOR ALL TABLES / đã thêm)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'SlottingPlan') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."SlottingPlan";
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'SlottingPlanLine') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."SlottingPlanLine";
  END IF;
END $$;

-- ─── RPC: slotting_stats ─────────────────────────────────────────────────────
-- ABC velocity theo LƯỢT NHẶT (số scan xuất) trong cửa sổ p_days, 1 kho / 1 lần gọi.
-- Ngưỡng chuẩn: A = 80% lượt nhặt lũy kế, B = 15% kế, C = còn lại.
-- Class tính theo lũy-kế-TRƯỚC-mã (mã top luôn là A kể cả khi 1 mã > 80%).
-- scanned_at = timestamp naive chứa UTC → so với (now() AT TIME ZONE 'UTC') (bẫy naive-UTC).
-- p_categories: null-inclusive theo quy ước app (mã chưa khai loại vẫn hiện).
DROP FUNCTION IF EXISTS public.slotting_stats(text, text[], integer);
CREATE OR REPLACE FUNCTION public.slotting_stats(
  p_warehouse_id text,
  p_categories   text[] DEFAULT NULL,
  p_days         integer DEFAULT 30
) RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH win AS (
  SELECT (now() AT TIME ZONE 'UTC') - make_interval(days => GREATEST(COALESCE(p_days, 30), 1)) AS t0
),
picks AS (
  SELECT ie.material_id,
         count(*)::int                              AS picks,
         COALESCE(sum(ose.cartons_scanned), 0)      AS cartons_out,
         count(DISTINCT ose.inventory_entry_id)::int AS pallets_touched
  FROM "OutboundScanEntry" ose
  JOIN "InventoryEntry" ie ON ie.id = ose.inventory_entry_id
  WHERE ie.warehouse_id::text = p_warehouse_id
    AND ose.scanned_at >= (SELECT t0 FROM win)
  GROUP BY ie.material_id
),
stock AS (   -- tồn hiện tại theo mã × khu (sub_code); pallet không vị trí → sub_code null
  SELECT ie.material_id, l.sub_code,
         count(*)::int                          AS pallets,
         COALESCE(sum(ie.cartons_remaining), 0) AS cartons
  FROM "InventoryEntry" ie
  LEFT JOIN "Location" l ON l.id = ie.location_id
  WHERE ie.warehouse_id::text = p_warehouse_id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  GROUP BY ie.material_id, l.sub_code
),
stock_tot AS (
  SELECT material_id, sum(pallets)::int AS pallets, sum(cartons) AS cartons
  FROM stock GROUP BY material_id
),
mats AS (    -- vũ trụ mã = có lượt nhặt HOẶC còn tồn (mã tồn chết cũng cần xếp hạng C)
  SELECT mu.material_id, m.material_code, m.short_name, m.category,
         COALESCE(p.picks, 0)           AS picks,
         COALESCE(p.cartons_out, 0)     AS cartons_out,
         COALESCE(p.pallets_touched, 0) AS pallets_touched,
         COALESCE(st.pallets, 0)        AS stock_pallets,
         COALESCE(st.cartons, 0)        AS stock_cartons
  FROM (SELECT material_id FROM picks UNION SELECT material_id FROM stock_tot) mu
  JOIN "Material" m ON m.id = mu.material_id
  LEFT JOIN picks p      ON p.material_id  = mu.material_id
  LEFT JOIN stock_tot st ON st.material_id = mu.material_id
  WHERE p_categories IS NULL OR m.category IS NULL OR m.category = ANY(p_categories)
),
classed AS (
  SELECT *,
    sum(picks) OVER () AS total_picks,
    sum(picks) OVER (ORDER BY picks DESC, material_code) AS cum_picks,
    CASE
      WHEN picks = 0 OR sum(picks) OVER () = 0 THEN 'C'
      WHEN (sum(picks) OVER (ORDER BY picks DESC, material_code) - picks)::numeric
           / NULLIF(sum(picks) OVER (), 0) < 0.80 THEN 'A'
      WHEN (sum(picks) OVER (ORDER BY picks DESC, material_code) - picks)::numeric
           / NULLIF(sum(picks) OVER (), 0) < 0.95 THEN 'B'
      ELSE 'C'
    END AS abc
  FROM mats
),
loc_used AS (   -- sức chứa vị trí: pallet chiếm chỗ = stack_layer=1 + tồn>0 (khớp move RPC/gợi ý nhập)
  SELECT l.id, l.location_code, l.sub_code, l.max_pallets, l.category,
         count(ie.id)::int AS used_slots
  FROM "Location" l
  LEFT JOIN "InventoryEntry" ie ON ie.location_id = l.id
    AND ie.stack_layer = 1
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  WHERE l.warehouse_id = p_warehouse_id AND l.is_active = true
  GROUP BY l.id, l.location_code, l.sub_code, l.max_pallets, l.category
)
SELECT jsonb_build_object(
  'total_picks', COALESCE((SELECT sum(picks) FROM mats), 0),
  'materials', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'material_id', c.material_id, 'code', c.material_code, 'name', c.short_name,
      'category', c.category, 'picks', c.picks, 'cartons_out', c.cartons_out,
      'pallets_touched', c.pallets_touched, 'stock_pallets', c.stock_pallets,
      'stock_cartons', c.stock_cartons, 'abc', c.abc,
      'cum_share', CASE WHEN c.total_picks > 0 THEN round(c.cum_picks::numeric / c.total_picks, 4) ELSE 0 END
    ) ORDER BY c.picks DESC, c.material_code) FROM classed c), '[]'::jsonb),
  'placement', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'material_id', s.material_id, 'sub_code', s.sub_code,
      'pallets', s.pallets, 'cartons', s.cartons))
    FROM stock s WHERE s.material_id IN (SELECT material_id FROM mats)), '[]'::jsonb),
  'zones', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', z.id, 'code', z.code, 'name', z.name, 'category', z.category,
      'pick_rank', z.pick_rank,
      'capacity', COALESCE(zc.capacity, 0), 'used_slots', COALESCE(zc.used_slots, 0))
      ORDER BY z.pick_rank NULLS LAST, z.sort_order)
    FROM "WarehouseZone" z
    LEFT JOIN (SELECT sub_code, sum(max_pallets)::int AS capacity, sum(used_slots)::int AS used_slots
               FROM loc_used GROUP BY sub_code) zc ON zc.sub_code = z.code
    WHERE z.warehouse_id = p_warehouse_id AND z.is_active = true), '[]'::jsonb),
  'locations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', lu.id, 'location_code', lu.location_code, 'sub_code', lu.sub_code,
      'max_pallets', lu.max_pallets, 'used_slots', lu.used_slots)
      ORDER BY lu.location_code)
    FROM loc_used lu), '[]'::jsonb)
);
$$;
