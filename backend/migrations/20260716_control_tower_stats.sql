-- Control Tower (Giám sát vận hành): aggregate toàn bộ số liệu thời-gian-thực của 1 ngày
-- phía DB (PostgREST tắt aggregate + các bảng nghiệp vụ hàng triệu dòng — không kéo về client).
-- BE gọi supabase.rpc('control_tower_stats', ...); function chưa apply → controller trả 503 NOT_READY.
--
-- Kiểu cột (như dashboard_stats): Warehouse.id TEXT, InventoryEntry.warehouse_id uuid (cast ::text),
-- gate_registrations/GDO/ProductionImport/WeighTicket.warehouse_id TEXT. Tham số text[].
-- Mọi cắt scope đều null-inclusive theo quy ước (bản ghi không khai loại/kho vẫn tính).

-- Index thời gian cho 2 truy vấn theo-ngày (chưa có — tránh seq scan bảng triệu dòng mỗi lần refresh)
CREATE INDEX IF NOT EXISTS idx_ose_scanned_at ON public."OutboundScanEntry" (scanned_at);
CREATE INDEX IF NOT EXISTS idx_ie_created_at  ON public."InventoryEntry" (created_at);

create or replace function control_tower_stats(
  p_warehouse_ids text[] default null,  -- scope kho (JWT ∩ filter user chọn; null = tất cả)
  p_categories    text[] default null,  -- scope loại hàng (null = tất cả)
  p_today         date   default null   -- ngày VN (BE truyền — tránh lệch timezone DB)
) returns jsonb
language sql
stable
as $$
with day_range as (
  select (p_today::timestamp at time zone 'Asia/Ho_Chi_Minh')       as t0,
         ((p_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') as t1
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
    count(*) filter (where g.status = 'PENDING')     as pending,
    count(*) filter (where g.status = 'IN_PROGRESS') as in_progress,
    count(*) filter (where g.status = 'PAUSED')      as paused,
    count(*) filter (where g.status = 'COMPLETED')   as completed,
    count(*)                                         as total
  from "GroupDeliveryOrder" g
  where g.delivery_date = p_today and g.status <> 'CANCELLED'
    and (p_warehouse_ids is null or g.warehouse_id is null or g.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or g.warehouse_type is null or g.warehouse_type = any(p_categories))
),
out_cartons as (
  select coalesce(sum(oi.cartons_ordered), 0) as planned,
         coalesce(sum(oi.cartons_scanned), 0) as scanned
  from "GroupDeliveryOrder" g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi on oi.do_id = d.id
  where g.delivery_date = p_today and g.status <> 'CANCELLED'
    and (p_warehouse_ids is null or g.warehouse_id is null or g.warehouse_id = any(p_warehouse_ids))
    and (p_categories is null or g.warehouse_type is null or g.warehouse_type = any(p_categories))
),
out_active as (
  -- Chuyến đang chạy/tạm dừng (top 40 mới bắt đầu nhất) + tiến độ thùng
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'group_code', t.group_code, 'status', t.status, 'plate', t.license_plate,
    'warehouse_name', t.wname, 'planned', t.planned, 'scanned', t.scanned, 'started_at', t.started_at
  ) order by t.started_at desc nulls last), '[]'::jsonb) as list
  from (
    select g.id, g.group_code, g.status, g.license_plate, g.started_at, w.name as wname,
           coalesce(sum(oi.cartons_ordered), 0) as planned,
           coalesce(sum(oi.cartons_scanned), 0) as scanned
    from "GroupDeliveryOrder" g
    left join "Warehouse" w on w.id = g.warehouse_id
    left join "OutboundDelivery" d on d.gdo_id = g.id
    left join "OutboundItem" oi on oi.do_id = d.id
    where g.delivery_date = p_today and g.status in ('IN_PROGRESS', 'PAUSED')
      and (p_warehouse_ids is null or g.warehouse_id is null or g.warehouse_id = any(p_warehouse_ids))
      and (p_categories is null or g.warehouse_type is null or g.warehouse_type = any(p_categories))
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
  select count(*)                                                    as tickets,
         count(*) filter (where not wt.is_complete)                  as pending2,
         coalesce(sum(wt.net_kg) filter (where wt.is_complete), 0)   as net_kg
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
              || jsonb_build_object('active', (select list from out_active)),
  'inbound',  (select to_jsonb(i.*) from inb i) || (select to_jsonb(p.*) from inb_pallets p),
  'weigh',    (select to_jsonb(w.*) from weigh w),
  'hourly',   coalesce((select jsonb_agg(to_jsonb(h.*) order by h.h) from hourly h), '[]'::jsonb)
);
$$;
