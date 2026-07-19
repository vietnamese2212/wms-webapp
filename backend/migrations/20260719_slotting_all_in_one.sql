-- ═══════════════════════════════════════════════════════════════════════════
-- SLOTTING — GỘP 1 FILE cho PRODUCTION (user 19/07: copy-paste 1 lần).
-- = kết quả cuối của 4 migration (20260717_slotting → 20260718_slotting_v2 →
--   20260718_slotting_locations → 20260718_slotting_capacity_fix)
-- + FIX policy realtime rls_auth_select cho 2 bảng slotting (thiếu ở cả staging)
-- + đồng bộ cấu hình đã setup ở staging (hạng nhặt 10 khu + 13 vị trí đặc biệt Ba Vì).
-- IDEMPOTENT 100%: chạy lại không sao; chạy trên STAGING cũng an toàn (chỉ vá policy,
-- KHÔNG drop bảng đang có dữ liệu đúng shape).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Cột cấu hình ──────────────────────────────────────────────────────────
ALTER TABLE public."WarehouseZone" ADD COLUMN IF NOT EXISTS pick_rank integer;      -- hạng nhặt (1 = gần cửa xuất nhất)
ALTER TABLE public."WarehouseZone" ADD COLUMN IF NOT EXISTS flow_type text;         -- SAME_END | FLOW_THROUGH | null
ALTER TABLE public."Material"      DROP COLUMN IF EXISTS slot_group;                -- dọn bản nháp cũ nếu lỡ có
ALTER TABLE public."WarehouseZone" DROP COLUMN IF EXISTS slot_group;
ALTER TABLE public."Location" ADD COLUMN IF NOT EXISTS slot_no_in  boolean NOT NULL DEFAULT false;  -- vị trí KHÔNG đưa hàng vào (kho tạm)
ALTER TABLE public."Location" ADD COLUMN IF NOT EXISTS slot_no_out boolean NOT NULL DEFAULT false;  -- vị trí KHÔNG lấy hàng đi

-- ── 2) Bảng kế hoạch ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SlottingPlan" (
  id            text PRIMARY KEY,
  warehouse_id  text NOT NULL,
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | COMPLETED | CANCELLED
  level         text,                             -- EASY | NORMAL | HARD (lúc tạo)
  principle     text,                             -- FIFO | FEFO | LIFO (lúc tạo)
  note          text,
  window_days   integer,
  n_lines       integer NOT NULL DEFAULT 0,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  completed_by  text,
  updated_at    timestamptz NOT NULL,
  updated_by    text
);
ALTER TABLE public."SlottingPlan" ADD COLUMN IF NOT EXISTS level text;      -- nếu bảng đã có từ bản cũ
ALTER TABLE public."SlottingPlan" ADD COLUMN IF NOT EXISTS principle text;

-- Bảng dòng: shape CUỐI gom theo (mã + date), entry_ids jsonb. Nếu đã lỡ tạo shape CŨ
-- (per-pallet, thiếu entry_ids — bảng đó luôn rỗng) → drop tạo lại; shape đúng thì giữ nguyên.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='SlottingPlanLine')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='SlottingPlanLine' AND column_name='entry_ids') THEN
    DROP TABLE public."SlottingPlanLine";
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public."SlottingPlanLine" (
  id                 text PRIMARY KEY,
  plan_id            text NOT NULL REFERENCES public."SlottingPlan"(id) ON DELETE CASCADE,
  material_id        text NOT NULL,
  material_code      text,
  material_name      text,
  date_key           text,                        -- 'YYYY-MM-DD' theo nguyên tắc (FEFO=HSD, FIFO/LIFO=NSX)
  n_pallets          integer NOT NULL,
  entry_ids          jsonb NOT NULL,              -- pallet lúc sinh (suy tiến độ sống)
  abc                text,
  reason             text,
  flow_note          text,
  from_location_id   text,
  from_location_code text,
  to_location_id     text NOT NULL,
  to_location_code   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spl_plan ON public."SlottingPlanLine"(plan_id);
CREATE INDEX IF NOT EXISTS idx_sp_wh    ON public."SlottingPlan"(warehouse_id, status);

-- ── 3) RLS + policy realtime + publication ──────────────────────────────────
ALTER TABLE public."SlottingPlan"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SlottingPlanLine" ENABLE ROW LEVEL SECURITY;
-- Bảng mới sau đợt khóa RLS 12/07 PHẢI có rls_auth_select — thiếu là Realtime bị chặn ÂM THẦM
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='SlottingPlan' AND policyname='rls_auth_select') THEN
    CREATE POLICY rls_auth_select ON public."SlottingPlan" FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='SlottingPlanLine' AND policyname='rls_auth_select') THEN
    CREATE POLICY rls_auth_select ON public."SlottingPlanLine" FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='SlottingPlan') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."SlottingPlan";
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='SlottingPlanLine') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."SlottingPlanLine";
  END IF;
END $$;

-- ── 4) RPC slotting_stats — bản CUỐI (capacity đếm MỌI tầng, khớp move RPC) ──
DROP FUNCTION IF EXISTS public.slotting_stats(text, text[], integer);
CREATE OR REPLACE FUNCTION public.slotting_stats(p_warehouse_id text, p_categories text[] DEFAULT NULL::text[], p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
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
loc_used AS (
  SELECT l.id, l.location_code, l.sub_code, l.max_pallets, l.category,
         l.slot_no_in, l.slot_no_out,
         count(ie.id)::int AS used_slots
  FROM "Location" l
  LEFT JOIN "InventoryEntry" ie ON ie.location_id = l.id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  WHERE l.warehouse_id = p_warehouse_id AND l.is_active = true
  GROUP BY l.id, l.location_code, l.sub_code, l.max_pallets, l.category, l.slot_no_in, l.slot_no_out
)
SELECT jsonb_build_object(
  'total_picks', COALESCE((SELECT sum(picks) FROM mats), 0),
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
      'pallets', s.pallets, 'cartons', s.cartons))
    FROM stock s WHERE s.material_id IN (SELECT material_id FROM mats)), '[]'::jsonb),
  'zones', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', z.id, 'code', z.code, 'name', z.name, 'category', z.category,
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

-- ── 5) Đồng bộ cấu hình đã setup ở staging (khớp theo TÊN kho + MÃ khu/vị trí) ──
-- Hạng nhặt + luồng cửa 10 khu Kho Ba Vì
WITH cfg(code, pick_rank, flow_type) AS (VALUES
  ('K4GIAY', 1, 'SAME_END'), ('SCA', 1, 'SAME_END'), ('K4RAW', 1, 'SAME_END'),
  ('K2THUNG', 1, 'SAME_END'), ('K4POSM', 1, 'SAME_END'), ('NVLMAT', 1, 'SAME_END'),
  ('TP1', 1, 'SAME_END'), ('K4THUNG', 2, 'SAME_END'), ('TP2', 2, 'SAME_END'), ('TP3', 3, 'SAME_END')
)
UPDATE "WarehouseZone" z
SET pick_rank = cfg.pick_rank, flow_type = cfg.flow_type, updated_at = now()
FROM cfg, "Warehouse" w
WHERE w.name = 'Kho Ba Vì' AND z.warehouse_id = w.id AND z.code = cfg.code;

-- 13 vị trí đặc biệt Kho Ba Vì (no_in; riêng B_TP2_Mặt đất thêm no_out)
UPDATE "Location" l
SET slot_no_in = true,
    slot_no_out = (l.location_code = 'B_TP2_Mặt đất'),
    updated_at = now()
FROM "Warehouse" w
WHERE w.name = 'Kho Ba Vì' AND l.warehouse_id = w.id
  AND l.location_code IN (
    'B_TP1_Kho 1 lẻ','B_TP1_Kho QA','B_TP1_Kho SX','B_TP1_Không rõ','B_TP1_KPH',
    'B_TP1_Ngoài đường Cont','B_TP1_Ngoài đường PL1','B_TP1_Ngoài đường PL2',
    'B_TP1_Ngoài đường SCA','B_TP1_Pin robot','B_TP2_Mặt đất','B_TP3_Kho 3 lẻ','B_TP3_Rack lẻ'
  );

-- Quét tem thùng Kho Ba Vì (khớp staging)
UPDATE "Warehouse" SET carton_scan_override = true, carton_scan_categories = ARRAY['Thành phẩm'],
  carton_scan_require_full = false, updated_at = now()
WHERE name = 'Kho Ba Vì';

-- ── KIỂM SAU KHI CHẠY (kỳ vọng: 10 khu · 13 vị trí · hàm tồn tại) ────────────
-- SELECT count(*) FROM "WarehouseZone" z JOIN "Warehouse" w ON w.id=z.warehouse_id WHERE w.name='Kho Ba Vì' AND z.pick_rank IS NOT NULL;
-- SELECT count(*) FROM "Location" l JOIN "Warehouse" w ON w.id=l.warehouse_id WHERE w.name='Kho Ba Vì' AND l.slot_no_in;
-- SELECT proname FROM pg_proc WHERE proname='slotting_stats';
