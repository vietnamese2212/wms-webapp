-- Control Tower v2 (user chốt 16/07 sau khi xem bản 1): thêm CHIỀU HÀNG HÓA —
-- (a) tổng KH xuất / đã xuất / còn lại + nhặt lẻ (KH + đã quét lẻ) cho progress strip;
-- (b) hàng XUẤT hôm nay theo mã (top 15 + tổng số mã); (c) hàng NHẬP hôm nay theo mã (top 15);
-- (d) chuyến đang soạn kèm NPP + số mã hàng. CREATE OR REPLACE — chạy đè bản 20260716_control_tower_stats.

create or replace function control_tower_stats(
  p_warehouse_ids text[] default null,
  p_categories    text[] default null,
  p_today         date   default null
) returns jsonb
language sql
stable
as $$
with day_range as (
  select (p_today::timestamp at time zone 'Asia/Ho_Chi_Minh')       as t0,
         ((p_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') as t1
),
-- Chuyến xuất hôm nay trong scope (dùng chung cho mọi nhánh outbound)
gdo_today as (
  select g.id, g.group_code, g.status, g.license_plate, g.started_at, g.warehouse_id
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
    'entry_at', s.entry_at, 'warehouse_name', w.name, 'content', s.content
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
  select coalesce(sum(oi.cartons_ordered), 0) as planned,
         coalesce(sum(oi.cartons_scanned), 0) as scanned,
         coalesce(sum(oi.loose_picking), 0)   as loose_planned
  from gdo_today g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi on oi.do_id = d.id
),
loose_scan as (
  select coalesce(sum(ose.cartons_scanned), 0) as loose_scanned
  from gdo_today g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi on oi.do_id = d.id
  join "OutboundScanEntry" ose on ose.item_id = oi.id
  where ose.is_loose_picking
),
-- Hàng XUẤT hôm nay theo mã (top 15 theo KH đặt) + tổng số mã
out_mat_rows as (
  select coalesce(m.material_code, oi.material_code_raw, '—') as code,
         coalesce(m.short_name, oi.material_code_raw, '—')    as name,
         coalesce(m.category, 'Khác')                         as category,
         sum(oi.cartons_ordered) as ordered,
         sum(oi.cartons_scanned) as scanned,
         sum(oi.loose_picking)   as loose
  from gdo_today g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi on oi.do_id = d.id
  left join "Material" m on m.id = oi.material_id
  group by 1, 2, 3
),
out_by_mat as (
  select
    (select count(*) from out_mat_rows) as n_materials,
    coalesce((select jsonb_agg(to_jsonb(t.*) order by t.ordered desc)
      from (select * from out_mat_rows order by ordered desc limit 15) t), '[]'::jsonb) as list
),
-- Hàng NHẬP hôm nay theo mã (top 15 theo thùng)
in_mat_rows as (
  select coalesce(m.material_code, '—') as code,
         coalesce(m.short_name, '—')    as name,
         coalesce(m.category, 'Khác')   as category,
         count(*)                              as pallets,
         coalesce(sum(ie.cartons_imported), 0) as cartons
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date::date = p_today
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
  group by 1, 2, 3
),
in_by_mat as (
  select
    (select count(*) from in_mat_rows) as n_materials,
    coalesce((select jsonb_agg(to_jsonb(t.*) order by t.cartons desc)
      from (select * from in_mat_rows order by cartons desc limit 15) t), '[]'::jsonb) as list
),
out_active as (
  -- Chuyến đang chạy/tạm dừng (top 40) + tiến độ + NPP + số mã hàng
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'group_code', t.group_code, 'status', t.status, 'plate', t.license_plate,
    'warehouse_name', t.wname, 'planned', t.planned, 'scanned', t.scanned, 'started_at', t.started_at,
    'npp', t.npp, 'n_materials', t.n_mats
  ) order by t.started_at desc nulls last), '[]'::jsonb) as list
  from (
    select g.id, g.group_code, g.status, g.license_plate, g.started_at, w.name as wname,
           coalesce(sum(oi.cartons_ordered), 0) as planned,
           coalesce(sum(oi.cartons_scanned), 0) as scanned,
           string_agg(distinct d.distributor_name, ', ')            as npp,
           count(distinct coalesce(oi.material_id, oi.material_code_raw)) as n_mats
    from gdo_today g
    left join "Warehouse" w on w.id = g.warehouse_id
    left join "OutboundDelivery" d on d.gdo_id = g.id
    left join "OutboundItem" oi on oi.do_id = d.id
    where g.status in ('IN_PROGRESS', 'PAUSED')
    group by g.id, g.group_code, g.status, g.license_plate, g.started_at, w.name
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
  select count(*) as pallets, coalesce(sum(ie.cartons_imported), 0) as cartons
  from "InventoryEntry" ie
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
  select extract(hour from (ose.scanned_at at time zone 'Asia/Ho_Chi_Minh'))::int as h,
         count(*) as scans, coalesce(sum(ose.cartons_scanned), 0) as cartons
  from "OutboundScanEntry" ose
  join "OutboundItem" oi on oi.id = ose.item_id
  join "OutboundDelivery" d on d.id = oi.do_id
  join "GroupDeliveryOrder" g on g.id = d.gdo_id
  cross join day_range r
  where ose.scanned_at >= r.t0 and ose.scanned_at < r.t1
    and (p_warehouse_ids is null or g.warehouse_id is null or g.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or g.warehouse_type is null or g.warehouse_type = any(p_categories))
  group by 1
),
hourly_in as (
  select extract(hour from (ie.created_at at time zone 'Asia/Ho_Chi_Minh'))::int as h,
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
$$;
