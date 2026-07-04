-- Dashboard tồn kho: aggregate phía DB (PostgREST tắt aggregate + InventoryEntry sẽ hàng triệu dòng —
-- không được kéo cả bảng về client). BE gọi qua supabase.rpc('dashboard_stats', ...); khi function
-- CHƯA apply, controller tự fallback tính bằng JS (chậm hơn) nên app không hỏng — apply xong là nhanh.
--
-- Lưu ý kiểu cột (đã verify information_schema): Warehouse.id/Material.id = TEXT,
-- InventoryEntry.warehouse_id = uuid (cast ::text khi join/so), ProductionImport/GDO.warehouse_id = text.
-- Tham số nhận text[] cho đồng nhất.

create or replace function dashboard_stats(
  p_warehouse_ids text[] default null,  -- scope kho của user (null = tất cả)
  p_categories    text[] default null,  -- scope loại hàng (null = tất cả; null-inclusive: bản ghi không khai loại vẫn tính)
  p_today         date   default null   -- ngày VN hôm nay (BE truyền, tránh lệch timezone DB)
) returns jsonb
language sql
stable
as $$
with inv as (
  select
    w.id                           as warehouse_id,
    w.name                         as warehouse_name,
    w.inventory_mode               as inventory_mode,
    coalesce(m.category, 'Khác')   as category,
    count(*)                       as pallets,
    coalesce(sum(ie.cartons_remaining), 0) as cartons,
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
  select coalesce(sum(ie.cartons_imported), 0) as inbound_cartons
  from "InventoryEntry" ie
  where ie.import_date::date = p_today
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
),
tout as (
  select
    count(distinct g.id)                   as outbound_gdos,
    coalesce(sum(oi.cartons_ordered), 0)   as outbound_planned,
    coalesce(sum(oi.cartons_scanned), 0)   as outbound_scanned
  from "GroupDeliveryOrder" g
  left join "OutboundDelivery" d on d.gdo_id = g.id
  left join "OutboundItem" oi on oi.do_id = d.id
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
$$;
