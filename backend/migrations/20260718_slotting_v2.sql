-- SLOTTING v2 (user chỉnh rule 17/07 sau khi review đợt 1):
-- 1) Mức độ (Easy/Normal/Hard) + Nguyên tắc (FIFO/FEFO/LIFO) = FILTER trên trang (không cột trên Warehouse).
-- 2) NHÓM RIÊNG (segregation, vd SCA lạnh): WarehouseZone.slot_group + Material.slot_group —
--    khu có nhóm chỉ nhận mã cùng nhóm; mã có nhóm bị kéo VỀ khu nhóm (ưu tiên cao nhất);
--    hàng lạ trong khu riêng chỉ CẢNH BÁO, không tự sinh lệnh.
-- 3) Luồng cửa per khu (SAME_END = xuất nhập cùng 1 đầu / FLOW_THROUGH = nhập 1 đầu xuất 1 đầu)
--    → hướng dẫn xếp trong dãy in trên phiếu.
-- 4) Dòng kế hoạch GOM theo (mã + date): "Mã A date X — N pallet: vị trí 1 → vị trí 2",
--    KHÔNG per-pallet → thay bảng SlottingPlanLine (bảng cũ rỗng — đợt 1 chưa có data thật).
--    entry_ids jsonb = danh sách pallet lúc sinh, để suy tiến độ x/N sống từ vị trí hiện tại.
-- Production: chạy 20260717_slotting.sql TRƯỚC rồi file này.

ALTER TABLE public."WarehouseZone" ADD COLUMN IF NOT EXISTS slot_group text;
ALTER TABLE public."WarehouseZone" ADD COLUMN IF NOT EXISTS flow_type text;   -- 'SAME_END' | 'FLOW_THROUGH' | null
ALTER TABLE public."Material"      ADD COLUMN IF NOT EXISTS slot_group text;

ALTER TABLE public."SlottingPlan" ADD COLUMN IF NOT EXISTS level text;        -- EASY | NORMAL | HARD (lúc tạo)
ALTER TABLE public."SlottingPlan" ADD COLUMN IF NOT EXISTS principle text;    -- FIFO | FEFO | LIFO (lúc tạo)

DROP TABLE IF EXISTS public."SlottingPlanLine";
CREATE TABLE public."SlottingPlanLine" (
  id                 text PRIMARY KEY,
  plan_id            text NOT NULL REFERENCES public."SlottingPlan"(id) ON DELETE CASCADE,
  material_id        text NOT NULL,
  material_code      text,
  material_name      text,
  date_key           text,                        -- 'YYYY-MM-DD' theo nguyên tắc (FEFO=HSD, FIFO/LIFO=NSX); null = không date
  n_pallets          integer NOT NULL,
  entry_ids          jsonb NOT NULL,              -- danh sách InventoryEntry.id lúc sinh (suy tiến độ)
  abc                text,
  reason             text,
  flow_note          text,                        -- hướng dẫn xếp trong dãy theo luồng cửa khu đích
  from_location_id   text,
  from_location_code text,
  to_location_id     text NOT NULL,
  to_location_code   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spl_plan ON public."SlottingPlanLine"(plan_id);
ALTER TABLE public."SlottingPlanLine" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'SlottingPlanLine') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."SlottingPlanLine";
  END IF;
END $$;

-- RPC REPLACE (cùng chữ ký): + materials.slot_group + zones.slot_group/flow_type
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
stock AS (
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
mats AS (
  SELECT mu.material_id, m.material_code, m.short_name, m.category, m.slot_group,
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
loc_used AS (
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
      'category', c.category, 'slot_group', c.slot_group,
      'picks', c.picks, 'cartons_out', c.cartons_out,
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
      'pick_rank', z.pick_rank, 'slot_group', z.slot_group, 'flow_type', z.flow_type,
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
