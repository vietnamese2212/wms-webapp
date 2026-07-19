-- ============================================================================
-- BASE UNIT — ĐỢT 2 SEMANTIC FLIP (user duyệt 19/07/2026, "flip ngay")
-- Đổi NGHĨA các cột số lượng từ THÙNG THẬP PHÂN → BASE UNIT (×units_per_carton)
-- CHỈ với mã có entry_unit + hệ số > 0. Mã không entry (KG/EA/BAG…) GIỮ NGUYÊN.
--
-- CHẠY QUA SCRIPT runner (scripts/base-unit-flip/run-flip.mjs) — từng transaction,
-- verify tổng sau mỗi bảng, dừng ngay nếu lệch ngoài danh sách round.
-- PHẢI deploy code base-semantics (dev >= commit flip) CÙNG cửa sổ với migration này.
-- Rollback: restore từ bảng x_flip_bak_* (script run-flip.mjs --rollback).
-- ============================================================================

-- ─── 0. Bảng báo cáo ROUND (dòng thùng lẻ → hộp nguyên, chênh lệch 1 lần duy nhất) ──
CREATE TABLE IF NOT EXISTS base_unit_flip_round_report (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tbl         text        NOT NULL,
  row_id      text        NOT NULL,
  col         text        NOT NULL,
  old_val     numeric     NOT NULL,   -- giá trị thùng thập phân cũ
  factor      integer     NOT NULL,   -- units_per_carton
  exact_base  numeric     NOT NULL,   -- old_val × factor (chưa round)
  new_val     numeric     NOT NULL,   -- round(exact_base) — giá trị ghi vào DB
  diff_base   numeric     NOT NULL,   -- new_val − exact_base (chênh theo base)
  flipped_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── 1. BACKUP (id + các cột bị nhân — đủ để rollback bằng UPDATE join) ─────
CREATE TABLE IF NOT EXISTS x_flip_bak_inventory_entry AS
  SELECT id, cartons_imported, cartons_remaining, cartons_reserved, adjustment_qty FROM "InventoryEntry";
CREATE TABLE IF NOT EXISTS x_flip_bak_outbound_item AS
  SELECT id, cartons_ordered, cartons_scanned, loose_picking FROM "OutboundItem";
CREATE TABLE IF NOT EXISTS x_flip_bak_outbound_scan_entry AS
  SELECT id, cartons_scanned FROM "OutboundScanEntry";
CREATE TABLE IF NOT EXISTS x_flip_bak_adjustment_log AS
  SELECT id, delta, cartons_before, cartons_after FROM "InventoryAdjustmentLog";
CREATE TABLE IF NOT EXISTS x_flip_bak_production_import AS
  SELECT id, planned_cartons, posm_cartons FROM "ProductionImport";
CREATE TABLE IF NOT EXISTS x_flip_bak_inbound_plan_lines AS
  SELECT id, planned_boxes FROM inbound_plan_lines;

-- ─── 2. ROUND REPORT + UPDATE ×hệ_số (runner chạy từng khối trong 1 transaction) ──

-- 2.1 InventoryEntry
INSERT INTO base_unit_flip_round_report (tbl, row_id, col, old_val, factor, exact_base, new_val, diff_base)
SELECT 'InventoryEntry', e.id, c.col, c.v, m.units_per_carton,
       c.v * m.units_per_carton, round(c.v * m.units_per_carton),
       round(c.v * m.units_per_carton) - c.v * m.units_per_carton
FROM "InventoryEntry" e
JOIN "Material" m ON m.id = e.material_id AND m.entry_unit IS NOT NULL AND coalesce(m.units_per_carton, 0) > 0
CROSS JOIN LATERAL (VALUES
  ('cartons_imported',  e.cartons_imported),
  ('cartons_remaining', e.cartons_remaining),
  ('cartons_reserved',  e.cartons_reserved),
  ('adjustment_qty',    e.adjustment_qty)
) AS c(col, v)
WHERE c.v IS NOT NULL AND (c.v * m.units_per_carton) % 1 <> 0;

UPDATE "InventoryEntry" e SET
  cartons_imported  = round(e.cartons_imported  * m.units_per_carton),
  cartons_remaining = round(e.cartons_remaining * m.units_per_carton),
  cartons_reserved  = round(e.cartons_reserved  * m.units_per_carton),
  adjustment_qty    = round(e.adjustment_qty    * m.units_per_carton)
FROM "Material" m
WHERE m.id = e.material_id AND m.entry_unit IS NOT NULL AND coalesce(m.units_per_carton, 0) > 0;

-- 2.2 OutboundItem
INSERT INTO base_unit_flip_round_report (tbl, row_id, col, old_val, factor, exact_base, new_val, diff_base)
SELECT 'OutboundItem', i.id, c.col, c.v, m.units_per_carton,
       c.v * m.units_per_carton, round(c.v * m.units_per_carton),
       round(c.v * m.units_per_carton) - c.v * m.units_per_carton
FROM "OutboundItem" i
JOIN "Material" m ON m.id = i.material_id AND m.entry_unit IS NOT NULL AND coalesce(m.units_per_carton, 0) > 0
CROSS JOIN LATERAL (VALUES
  ('cartons_ordered', i.cartons_ordered::numeric),
  ('cartons_scanned', i.cartons_scanned::numeric),
  ('loose_picking',   i.loose_picking::numeric)
) AS c(col, v)
WHERE c.v IS NOT NULL AND (c.v * m.units_per_carton) % 1 <> 0;

UPDATE "OutboundItem" i SET
  cartons_ordered = round(i.cartons_ordered * m.units_per_carton),
  cartons_scanned = round(i.cartons_scanned * m.units_per_carton),
  loose_picking   = round(i.loose_picking   * m.units_per_carton)
FROM "Material" m
WHERE m.id = i.material_id AND m.entry_unit IS NOT NULL AND coalesce(m.units_per_carton, 0) > 0;

-- 2.3 OutboundScanEntry (join qua item → material)
INSERT INTO base_unit_flip_round_report (tbl, row_id, col, old_val, factor, exact_base, new_val, diff_base)
SELECT 'OutboundScanEntry', s.id, 'cartons_scanned', s.cartons_scanned, m.units_per_carton,
       s.cartons_scanned * m.units_per_carton, round(s.cartons_scanned * m.units_per_carton),
       round(s.cartons_scanned * m.units_per_carton) - s.cartons_scanned * m.units_per_carton
FROM "OutboundScanEntry" s
JOIN "OutboundItem" i ON i.id = s.item_id
JOIN "Material" m ON m.id = i.material_id AND m.entry_unit IS NOT NULL AND coalesce(m.units_per_carton, 0) > 0
WHERE s.cartons_scanned IS NOT NULL AND (s.cartons_scanned * m.units_per_carton) % 1 <> 0;

UPDATE "OutboundScanEntry" s SET
  cartons_scanned = round(s.cartons_scanned * m.units_per_carton)
FROM "OutboundItem" i, "Material" m
WHERE i.id = s.item_id AND m.id = i.material_id
  AND m.entry_unit IS NOT NULL AND coalesce(m.units_per_carton, 0) > 0;

-- 2.4 InventoryAdjustmentLog (join qua entry → material)
INSERT INTO base_unit_flip_round_report (tbl, row_id, col, old_val, factor, exact_base, new_val, diff_base)
SELECT 'InventoryAdjustmentLog', l.id, c.col, c.v, m.units_per_carton,
       c.v * m.units_per_carton, round(c.v * m.units_per_carton),
       round(c.v * m.units_per_carton) - c.v * m.units_per_carton
FROM "InventoryAdjustmentLog" l
JOIN "InventoryEntry" e ON e.id = l.entry_id
JOIN "Material" m ON m.id = e.material_id AND m.entry_unit IS NOT NULL AND coalesce(m.units_per_carton, 0) > 0
CROSS JOIN LATERAL (VALUES
  ('delta',          l.delta),
  ('cartons_before', l.cartons_before),
  ('cartons_after',  l.cartons_after)
) AS c(col, v)
WHERE c.v IS NOT NULL AND (c.v * m.units_per_carton) % 1 <> 0;

UPDATE "InventoryAdjustmentLog" l SET
  delta          = round(l.delta          * m.units_per_carton),
  cartons_before = round(l.cartons_before * m.units_per_carton),
  cartons_after  = round(l.cartons_after  * m.units_per_carton)
FROM "InventoryEntry" e, "Material" m
WHERE e.id = l.entry_id AND m.id = e.material_id
  AND m.entry_unit IS NOT NULL AND coalesce(m.units_per_carton, 0) > 0;

-- 2.5 ProductionImport (cột INTEGER — thùng nguyên ×hệ_số vẫn nguyên, không có round)
UPDATE "ProductionImport" p SET
  planned_cartons = p.planned_cartons * m.units_per_carton,
  posm_cartons    = p.posm_cartons    * m.units_per_carton
FROM "Material" m
WHERE m.id = p.material_id AND m.entry_unit IS NOT NULL AND coalesce(m.units_per_carton, 0) > 0;

-- 2.6 inbound_plan_lines
INSERT INTO base_unit_flip_round_report (tbl, row_id, col, old_val, factor, exact_base, new_val, diff_base)
SELECT 'inbound_plan_lines', pl.id, 'planned_boxes', pl.planned_boxes, m.units_per_carton,
       pl.planned_boxes * m.units_per_carton, round(pl.planned_boxes * m.units_per_carton),
       round(pl.planned_boxes * m.units_per_carton) - pl.planned_boxes * m.units_per_carton
FROM inbound_plan_lines pl
JOIN "Material" m ON m.id = pl.material_id AND m.entry_unit IS NOT NULL AND coalesce(m.units_per_carton, 0) > 0
WHERE pl.planned_boxes IS NOT NULL AND (pl.planned_boxes * m.units_per_carton) % 1 <> 0;

UPDATE inbound_plan_lines pl SET
  planned_boxes = round(pl.planned_boxes * m.units_per_carton)
FROM "Material" m
WHERE m.id = pl.material_id AND m.entry_unit IS NOT NULL AND coalesce(m.units_per_carton, 0) > 0;

-- LƯU Ý (đã xác minh 19/07): TmsOrder.planned_boxes KHÔNG nhân (material_id NULL toàn bộ —
-- cache tổng cross-mã cấp lệnh, nghĩa giữ "thùng quy đổi"); PalletLabelPrint.qty KHÔNG nhân
-- (số thùng in trên tem = vật lý); pallets_estimated/planned_pallets/weight/tons KHÔNG nhân.

-- ============================================================================
-- 3. RPC — thay ruột: mọi SUM cross-mã đổi sang "THÙNG QUY ĐỔI" = Σ(qty ÷ hệ_số)
--    (mã không entry giữ nguyên số). Nhãn "thùng" trên FE giữ nguyên ý nghĩa.
-- ============================================================================

-- 3.1 dashboard_stats — chia hệ số mọi tổng thùng
CREATE OR REPLACE FUNCTION public.dashboard_stats(p_warehouse_ids text[] DEFAULT NULL::text[], p_categories text[] DEFAULT NULL::text[], p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
with inv as (
  select
    w.id                           as warehouse_id,
    w.name                         as warehouse_name,
    w.inventory_mode               as inventory_mode,
    coalesce(m.category, 'Khác')   as category,
    count(*)                       as pallets,
    coalesce(sum(ie.cartons_remaining / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as cartons,
    count(distinct ie.material_id) as materials
  from "InventoryEntry" ie
  join "Warehouse" w on w.id = ie.warehouse_id::text
  left join "Material" m on m.id = ie.material_id
  where ie.cartons_remaining > 0
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by w.id, w.name, w.inventory_mode, coalesce(m.category, 'Khác')
),
tin as (
  select count(*) as inbound_orders
  from "ProductionImport" pi
  where pi.import_date::date = p_today
    and (p_warehouse_ids is null or pi.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or pi.warehouse_type is null or pi.warehouse_type = any(p_categories))
),
tin_cartons as (
  select coalesce(sum(ie.cartons_imported / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as inbound_cartons
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date::date = p_today
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
),
tout as (
  select
    count(distinct g.id)                   as outbound_gdos,
    coalesce(sum(oi.cartons_ordered / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as outbound_planned,
    coalesce(sum(oi.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as outbound_scanned
  from "GroupDeliveryOrder" g
  left join "OutboundDelivery" d on d.gdo_id = g.id
  left join "OutboundItem" oi on oi.do_id = d.id
  left join "Material" m on m.id = oi.material_id
  where g.delivery_date = p_today
    and g.status <> 'CANCELLED'
    and (p_warehouse_ids is null or g.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or g.warehouse_type is null or g.warehouse_type = any(p_categories))
)
select jsonb_build_object(
  'inventory', coalesce(
    (select jsonb_agg(to_jsonb(inv.*) order by inv.warehouse_name, inv.category) from inv),
    '[]'::jsonb
  ),
  'today', (
    select to_jsonb(t.*) || to_jsonb(tc.*) || to_jsonb(o.*)
    from tin t, tin_cartons tc, tout o
  )
);
$function$;

-- 3.2 control_tower_stats — chia hệ số mọi tổng (kể cả per-material rows + hourly)
CREATE OR REPLACE FUNCTION public.control_tower_stats(p_warehouse_ids text[] DEFAULT NULL::text[], p_categories text[] DEFAULT NULL::text[], p_today date DEFAULT NULL::date, p_material_codes text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
with day_range as (
  select ((p_today::timestamp at time zone 'Asia/Ho_Chi_Minh') at time zone 'UTC')       as t0,
         (((p_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') at time zone 'UTC') as t1
),
gdo_today as (
  select g.id, g.group_code, g.status, g.license_plate, g.started_at, g.warehouse_id, g.warehouse_type
  from "GroupDeliveryOrder" g
  where g.delivery_date = p_today and g.status <> 'CANCELLED'
    and (p_warehouse_ids is null or g.warehouse_id is null or g.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or g.warehouse_type is null or g.warehouse_type = any(p_categories))
),
gate as (
  select
    count(*) filter (where status = 'REGISTERED') as registered,
    count(*) filter (where status = 'CALLED')     as called,
    count(*) filter (where status = 'IN')         as inside,
    count(*) filter (where status = 'COMPLETED')  as completed
  from gate_registrations g
  where g.date = p_today
    and (p_warehouse_ids is null or g.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or g.warehouse_type is null or g.warehouse_type = any(p_categories))
),
gate_inside as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'plate', s.license_plate, 'company', s.company_name_raw, 'direction', s.direction,
    'entry_at', s.entry_at, 'warehouse_name', w.name, 'content', s.content,
    'warehouse_type', s.warehouse_type, 'vehicle_type', s.vehicle_type
  ) order by s.entry_at), '[]'::jsonb) as list
  from (
    select g.* from gate_registrations g
    where g.date = p_today and g.status = 'IN'
      and (p_warehouse_ids is null or g.warehouse_id = any(p_warehouse_ids))
      and (p_categories is null or g.warehouse_type is null or g.warehouse_type = any(p_categories))
    order by g.entry_at limit 40
  ) s left join "Warehouse" w on w.id = s.warehouse_id
),
out_gdo as (
  select
    count(*) filter (where status = 'PENDING')     as pending,
    count(*) filter (where status = 'IN_PROGRESS') as in_progress,
    count(*) filter (where status = 'PAUSED')      as paused,
    count(*) filter (where status = 'COMPLETED')   as completed,
    count(*)                                       as total
  from gdo_today
),
out_cartons as (
  select coalesce(sum(oi.cartons_ordered / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as planned,
         coalesce(sum(oi.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as scanned,
         coalesce(sum(oi.loose_picking   / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as loose_planned
  from gdo_today g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi on oi.do_id = d.id
  left join "Material" m on m.id = oi.material_id
),
loose_scan as (
  select coalesce(sum(ose.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as loose_scanned
  from gdo_today g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi on oi.do_id = d.id
  join "OutboundScanEntry" ose on ose.item_id = oi.id
  left join "Material" m on m.id = oi.material_id
  where ose.is_loose_picking
),
out_mat_rows as (
  select coalesce(m.material_code, oi.material_code_raw, '—') as code,
         coalesce(m.short_name, oi.material_code_raw, '—')    as name,
         coalesce(m.category, 'Khác')                         as category,
         sum(oi.cartons_ordered / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)) as ordered,
         sum(oi.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)) as scanned,
         sum(oi.loose_picking   / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)) as loose
  from gdo_today g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi on oi.do_id = d.id
  left join "Material" m on m.id = oi.material_id
  where (p_material_codes is null
         or coalesce(m.material_code, oi.material_code_raw) = any(p_material_codes))
  group by 1, 2, 3
),
out_by_mat as (
  select
    (select count(*) from out_mat_rows)                                          as n_materials,
    (select count(*) from out_mat_rows where scanned >= ordered and ordered > 0) as n_done,
    (select count(*) from out_mat_rows where scanned < ordered)                  as n_short,
    coalesce((select jsonb_agg(to_jsonb(t.*) order by (t.ordered - t.scanned) desc, t.ordered desc)
      from (select * from out_mat_rows order by (ordered - scanned) desc, ordered desc limit 30) t), '[]'::jsonb) as list
),
in_mat_rows as (
  select coalesce(m.material_code, '—') as code,
         coalesce(m.short_name, '—')    as name,
         coalesce(m.category, 'Khác')   as category,
         count(*)                              as pallets,
         coalesce(sum(ie.cartons_imported / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as cartons
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date::date = p_today
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
    and (p_material_codes is null or m.material_code = any(p_material_codes))
  group by 1, 2, 3
),
in_by_mat as (
  select
    (select count(*) from in_mat_rows) as n_materials,
    coalesce((select jsonb_agg(to_jsonb(t.*) order by t.cartons desc)
      from (select * from in_mat_rows order by cartons desc limit 30) t), '[]'::jsonb) as list
),
out_active as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'group_code', t.group_code, 'status', t.status, 'plate', t.license_plate,
    'warehouse_name', t.wname, 'planned', t.planned, 'scanned', t.scanned, 'started_at', t.started_at,
    'npp', t.npp, 'n_materials', t.n_mats,
    'warehouse_type', t.warehouse_type, 'export_type', t.export_type
  ) order by t.started_at desc nulls last), '[]'::jsonb) as list
  from (
    select g.id, g.group_code, g.status, g.license_plate, g.started_at, g.warehouse_type, w.name as wname,
           coalesce(sum(oi.cartons_ordered / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as planned,
           coalesce(sum(oi.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as scanned,
           string_agg(distinct d.distributor_name, ', ')            as npp,
           string_agg(distinct oi.export_type, ', ')                as export_type,
           count(distinct coalesce(oi.material_id, oi.material_code_raw)) as n_mats
    from gdo_today g
    left join "Warehouse" w on w.id = g.warehouse_id
    left join "OutboundDelivery" d on d.gdo_id = g.id
    left join "OutboundItem" oi on oi.do_id = d.id
    left join "Material" m on m.id = oi.material_id
    where g.status in ('IN_PROGRESS', 'PAUSED')
    group by g.id, g.group_code, g.status, g.license_plate, g.started_at, g.warehouse_type, w.name
    order by g.started_at desc nulls last limit 40
  ) t
),
inb as (
  select count(*) as orders
  from "ProductionImport" pi
  where pi.import_date::date = p_today
    and (p_warehouse_ids is null or pi.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or pi.warehouse_type is null or pi.warehouse_type = any(p_categories))
),
inb_pallets as (
  select count(*) as pallets,
         coalesce(sum(ie.cartons_imported / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as cartons
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date::date = p_today
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
),
weigh as (
  select count(*)                                                  as tickets,
         count(*) filter (where not wt.is_complete)                as pending2,
         coalesce(sum(wt.net_kg) filter (where wt.is_complete), 0) as net_kg
  from "WeighTicket" wt
  where wt.weigh_date = p_today
    and (p_warehouse_ids is null or wt.warehouse_id is null or wt.warehouse_id = any(p_warehouse_ids))
),
hourly_out as (
  select extract(hour from (ose.scanned_at at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh'))::int as h,
         count(*) as scans,
         coalesce(sum(ose.cartons_scanned / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as cartons
  from "OutboundScanEntry" ose
  join "OutboundItem" oi on oi.id = ose.item_id
  join "OutboundDelivery" d on d.id = oi.do_id
  join "GroupDeliveryOrder" g on g.id = d.gdo_id
  left join "Material" m on m.id = oi.material_id
  cross join day_range r
  where ose.scanned_at >= r.t0 and ose.scanned_at < r.t1
    and (p_warehouse_ids is null or g.warehouse_id is null or g.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or g.warehouse_type is null or g.warehouse_type = any(p_categories))
  group by 1
),
hourly_in as (
  select extract(hour from (ie.created_at at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh'))::int as h,
         count(*) as pallets
  from "InventoryEntry" ie
  cross join day_range r
  where ie.created_at >= r.t0 and ie.created_at < r.t1
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
  group by 1
),
hourly as (
  select coalesce(o.h, i.h) as h,
         coalesce(o.cartons, 0) as out_cartons,
         coalesce(o.scans, 0)   as out_scans,
         coalesce(i.pallets, 0) as in_pallets
  from hourly_out o full outer join hourly_in i on i.h = o.h
)
select jsonb_build_object(
  'gate',     (select to_jsonb(g.*) from gate g) || jsonb_build_object('inside_list', (select list from gate_inside)),
  'outbound', (select to_jsonb(o.*) from out_gdo o) || (select to_jsonb(c.*) from out_cartons c)
              || (select to_jsonb(l.*) from loose_scan l)
              || jsonb_build_object('active', (select list from out_active)),
  'out_by_material', (select to_jsonb(x.*) from out_by_mat x),
  'in_by_material',  (select to_jsonb(x.*) from in_by_mat x),
  'inbound',  (select to_jsonb(i.*) from inb i) || (select to_jsonb(p.*) from inb_pallets p),
  'weigh',    (select to_jsonb(w.*) from weigh w),
  'hourly',   coalesce((select jsonb_agg(to_jsonb(h.*) order by h.h) from hourly h), '[]'::jsonb)
);
$function$;

-- 3.3 slotting_stats — cartons_out/stock_cartons/placement chia hệ số (thùng quy đổi)
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
         COALESCE(sum(ose.cartons_scanned), 0)      AS cartons_out_base,
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
         COALESCE(sum(ie.cartons_remaining), 0) AS cartons_base
  FROM "InventoryEntry" ie
  LEFT JOIN "Location" l ON l.id = ie.location_id
  WHERE ie.warehouse_id::text = p_warehouse_id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  GROUP BY ie.material_id, l.sub_code
),
stock_tot AS (
  SELECT material_id, sum(pallets)::int AS pallets, sum(cartons_base) AS cartons_base
  FROM stock GROUP BY material_id
),
mats AS (
  SELECT mu.material_id, m.material_code, m.short_name, m.category,
         COALESCE(p.picks, 0)           AS picks,
         COALESCE(p.cartons_out_base, 0) / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end) AS cartons_out,
         COALESCE(p.pallets_touched, 0) AS pallets_touched,
         COALESCE(st.pallets, 0)        AS stock_pallets,
         COALESCE(st.cartons_base, 0) / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end) AS stock_cartons
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
      'pallets', s.pallets,
      'cartons', s.cartons_base / (case when m2.entry_unit is not null and coalesce(m2.units_per_carton,0) > 0 then m2.units_per_carton else 1 end)))
    FROM stock s JOIN "Material" m2 ON m2.id = s.material_id
    WHERE s.material_id IN (SELECT material_id FROM mats)), '[]'::jsonb),
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

-- 3.4 Scan log — THÊM 3 cột units ở CUỐI (base_unit, entry_unit, units_per_carton)
--     để FE format "N thùng + M hộp". Đổi RETURNS TABLE → phải DROP trước.
--     (Overload CŨ 10 tham số giữ nguyên — chỉ là fallback legacy, không còn được gọi.)
DROP FUNCTION IF EXISTS public.get_outbound_scan_log(text, text, text, text, text, text, text, text, text, text, text, text, text, integer, integer, text);

CREATE FUNCTION public.get_outbound_scan_log(p_from_date text DEFAULT NULL::text, p_to_date text DEFAULT NULL::text, p_warehouse_ids text DEFAULT NULL::text, p_material_category text DEFAULT NULL::text, p_group_code text DEFAULT NULL::text, p_distributor text DEFAULT NULL::text, p_delivery_code text DEFAULT NULL::text, p_pallet_code text DEFAULT NULL::text, p_material text DEFAULT NULL::text, p_machine_codes text DEFAULT NULL::text, p_cycles text DEFAULT NULL::text, p_scanner_name text DEFAULT NULL::text, p_nmsx text DEFAULT NULL::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_allowed_categories text DEFAULT NULL::text)
 RETURNS TABLE(id text, pallet_code text, cartons_scanned numeric, production_date text, best_available_date text, scanned_at timestamp with time zone, is_loose_picking boolean, loose_confirmed_at timestamp with time zone, loose_confirmed_by_name text, group_code text, delivery_date date, license_plate text, container_number text, forklift_driver_names text, loader_name text, assigned_at timestamp with time zone, started_at timestamp with time zone, last_scanned_at timestamp with time zone, completed_at timestamp with time zone, warehouse_name text, delivery_code text, distributor_name text, header_text text, material_code_raw text, material_code text, material_name text, material_category text, shelf_life_days integer, cycle text, machine_code text, nmsx text, import_date timestamp with time zone, location_code text, scanner_name text, total_count bigint, base_unit text, entry_unit text, units_per_carton integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    ose.id,
    ose.pallet_code,
    ose.cartons_scanned,
    ose.production_date,
    ose.best_available_date,
    ose.scanned_at,
    ose.is_loose_picking,
    ose.loose_confirmed_at,
    ec.name                AS loose_confirmed_by_name,
    gdo.group_code,
    CASE
      WHEN ose.is_loose_picking
        THEN (ose.loose_confirmed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      ELSE
        (ose.scanned_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    END                    AS delivery_date,
    gdo.license_plate,
    gdo.container_number,
    gdo.forklift_driver_names,
    gdo.loader_name,
    gdo.assigned_at,
    gdo.started_at,
    gdo.last_scanned_at,
    gdo.completed_at,
    w.name                 AS warehouse_name,
    od.delivery_code,
    od.distributor_name,
    oi.header_text,
    oi.material_code_raw,
    m.material_code,
    m.short_name           AS material_name,
    m.category             AS material_category,
    m.shelf_life_days,
    ie.cycle,
    ie.machine_code,
    ose.nmsx,
    ie.import_date,
    l.location_code,
    e.name                 AS scanner_name,
    COUNT(*) OVER()        AS total_count,
    m.base_unit,
    m.entry_unit,
    m.units_per_carton
  FROM "OutboundScanEntry"   ose
  JOIN "OutboundItem"        oi  ON oi.id  = ose.item_id
  JOIN "OutboundDelivery"    od  ON od.id  = oi.do_id
  JOIN "GroupDeliveryOrder"  gdo ON gdo.id = od.gdo_id
  JOIN "Warehouse"           w   ON w.id   = gdo.warehouse_id
  LEFT JOIN "Material"       m   ON m.id   = oi.material_id
  LEFT JOIN "InventoryEntry" ie  ON ie.id  = ose.inventory_entry_id
  LEFT JOIN "Location"       l   ON l.id   = ie.location_id
  LEFT JOIN "Employee"       e   ON e.id   = ose.scanned_by
  LEFT JOIN "Employee"       ec  ON ec.id  = ose.loose_confirmed_by
  WHERE
    (p_from_date IS NULL OR
      CASE WHEN ose.is_loose_picking
        THEN (ose.loose_confirmed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
        ELSE (ose.scanned_at         AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      END >= p_from_date::date)
    AND (p_to_date IS NULL OR
      CASE WHEN ose.is_loose_picking
        THEN (ose.loose_confirmed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
        ELSE (ose.scanned_at         AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      END <= p_to_date::date)
    AND (p_warehouse_ids     IS NULL OR gdo.warehouse_id  = ANY(string_to_array(p_warehouse_ids, ',')))
    AND (p_material_category IS NULL OR m.category        = p_material_category)
    AND (p_allowed_categories IS NULL OR m.category IS NULL OR m.category = ANY(string_to_array(p_allowed_categories, ',')))
    AND (p_group_code        IS NULL OR gdo.group_code      ILIKE '%' || p_group_code    || '%')
    AND (p_distributor       IS NULL OR od.distributor_name ILIKE '%' || p_distributor   || '%')
    AND (p_delivery_code     IS NULL OR od.delivery_code    ILIKE '%' || p_delivery_code || '%')
    AND (p_pallet_code       IS NULL OR ose.pallet_code     ILIKE '%' || p_pallet_code   || '%')
    AND (
      p_material IS NULL
      OR CASE
        WHEN p_material LIKE '%,%' THEN m.id = ANY(string_to_array(p_material, ','))
        ELSE (
          m.material_code      ILIKE '%' || p_material || '%'
          OR m.short_name      ILIKE '%' || p_material || '%'
          OR oi.material_code_raw ILIKE '%' || p_material || '%'
        )
      END
    )
    AND (p_machine_codes IS NULL OR ie.machine_code = ANY(string_to_array(p_machine_codes, ',')))
    AND (p_cycles        IS NULL OR ie.cycle         = ANY(string_to_array(p_cycles, ',')))
    AND (p_scanner_name  IS NULL OR e.name           ILIKE '%' || p_scanner_name  || '%')
    AND (p_nmsx          IS NULL OR ose.nmsx         = ANY(string_to_array(p_nmsx, ',')))
    AND (NOT ose.is_loose_picking OR ose.loose_confirmed = true)
  ORDER BY ose.scanned_at DESC
  LIMIT  p_limit
  OFFSET p_offset
$function$;

DROP FUNCTION IF EXISTS public.search_outbound_scan_log(text, text, text, integer, integer);

CREATE FUNCTION public.search_outbound_scan_log(
  p_q text,
  p_warehouse_ids text DEFAULT NULL,
  p_allowed_categories text DEFAULT NULL,
  p_limit integer DEFAULT 500, p_offset integer DEFAULT 0
)
RETURNS TABLE(id text, pallet_code text, cartons_scanned numeric, production_date text, best_available_date text, scanned_at timestamp with time zone, is_loose_picking boolean, loose_confirmed_at timestamp with time zone, loose_confirmed_by_name text, group_code text, delivery_date date, license_plate text, container_number text, forklift_driver_names text, loader_name text, assigned_at timestamp with time zone, started_at timestamp with time zone, last_scanned_at timestamp with time zone, completed_at timestamp with time zone, warehouse_name text, delivery_code text, distributor_name text, header_text text, material_code_raw text, material_code text, material_name text, material_category text, shelf_life_days integer, cycle text, machine_code text, nmsx text, import_date timestamp with time zone, location_code text, scanner_name text, total_count bigint, gdo_id text, item_id text, base_unit text, entry_unit text, units_per_carton integer)
LANGUAGE sql STABLE
AS $function$
  SELECT
    ose.id,
    ose.pallet_code,
    ose.cartons_scanned,
    ose.production_date,
    ose.best_available_date,
    ose.scanned_at,
    ose.is_loose_picking,
    ose.loose_confirmed_at,
    ec.name                AS loose_confirmed_by_name,
    gdo.group_code,
    CASE
      WHEN ose.is_loose_picking
        THEN (ose.loose_confirmed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      ELSE
        (ose.scanned_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    END                    AS delivery_date,
    gdo.license_plate,
    gdo.container_number,
    gdo.forklift_driver_names,
    gdo.loader_name,
    gdo.assigned_at,
    gdo.started_at,
    gdo.last_scanned_at,
    gdo.completed_at,
    w.name                 AS warehouse_name,
    od.delivery_code,
    od.distributor_name,
    oi.header_text,
    oi.material_code_raw,
    m.material_code,
    m.short_name           AS material_name,
    m.category             AS material_category,
    m.shelf_life_days,
    ie.cycle,
    ie.machine_code,
    ose.nmsx,
    ie.import_date,
    l.location_code,
    e.name                 AS scanner_name,
    COUNT(*) OVER()        AS total_count,
    gdo.id::text           AS gdo_id,
    oi.id::text            AS item_id,
    m.base_unit,
    m.entry_unit,
    m.units_per_carton
  FROM "OutboundScanEntry"   ose
  JOIN "OutboundItem"        oi  ON oi.id  = ose.item_id
  JOIN "OutboundDelivery"    od  ON od.id  = oi.do_id
  JOIN "GroupDeliveryOrder"  gdo ON gdo.id = od.gdo_id
  JOIN "Warehouse"           w   ON w.id   = gdo.warehouse_id
  LEFT JOIN "Material"       m   ON m.id   = oi.material_id
  LEFT JOIN "InventoryEntry" ie  ON ie.id  = ose.inventory_entry_id
  LEFT JOIN "Location"       l   ON l.id   = ie.location_id
  LEFT JOIN "Employee"       e   ON e.id   = ose.scanned_by
  LEFT JOIN "Employee"       ec  ON ec.id  = ose.loose_confirmed_by
  WHERE
    (p_warehouse_ids      IS NULL OR gdo.warehouse_id = ANY(string_to_array(p_warehouse_ids, ',')))
    AND (p_allowed_categories IS NULL OR m.category IS NULL OR m.category = ANY(string_to_array(p_allowed_categories, ',')))
    AND (NOT ose.is_loose_picking OR ose.loose_confirmed = true)
    AND (
      ose.pallet_code          ILIKE '%' || p_q || '%'
      OR ose.carton_scans::text ILIKE '%' || p_q || '%'
      OR gdo.group_code        ILIKE '%' || p_q || '%'
      OR gdo.license_plate     ILIKE '%' || p_q || '%'
      OR gdo.container_number  ILIKE '%' || p_q || '%'
      OR od.distributor_name   ILIKE '%' || p_q || '%'
      OR od.delivery_code      ILIKE '%' || p_q || '%'
      OR m.material_code       ILIKE '%' || p_q || '%'
      OR m.short_name          ILIKE '%' || p_q || '%'
      OR oi.material_code_raw  ILIKE '%' || p_q || '%'
      OR e.name                ILIKE '%' || p_q || '%'
      OR l.location_code       ILIKE '%' || p_q || '%'
      OR w.name                ILIKE '%' || p_q || '%'
    )
  ORDER BY ose.scanned_at DESC
  LIMIT  p_limit
  OFFSET p_offset
$function$;

-- outbound_shortage_stats: KHÔNG đổi — so sánh ordered vs available CÙNG MÃ, 2 vế cùng flip.
