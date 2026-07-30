-- DASHBOARD: PALLET LÀM SỐ CHỦ ĐẠO + TỒN TÁCH THEO TỪNG ĐƠN VỊ (user chốt 30/07).
-- Bối cảnh: ô "Tồn (quy đổi)" là tổng TRỘN đơn vị (thùng TP + cái POSM + kg NVL...) — đo staging
-- 133,4tr thì 131,2tr là CÁI (ly/sticker), thùng thật chỉ 1,39tr → con số không trả lời được
-- "kho có bao nhiêu hàng". Hướng xử: Pallet (đơn vị vật lý so được giữa mọi loại hàng) lên tile
-- chủ đạo; tile "quy đổi" thay bằng BẢNG TÁCH THEO ĐƠN VỊ — xem được số riêng từng đơn vị khi cần.
--
-- File này CHỈ thêm khóa `by_unit` vào dashboard_stats (giữ nguyên inventory/today — không đổi
-- hành vi cũ; dashboard_all bọc dashboard_stats nên tự có theo). Nhóm theo ĐVT HIỂN THỊ của mã:
-- có entry_unit + units_per_carton>0 → entry_unit (số = base ÷ hệ số, "thùng quy đổi" per-mã);
-- không có → base_unit (số = base nguyên). Cùng công thức per-row với CTE `inv` ⇒
-- Σ by_unit.qty = Σ inv.cartons và Σ by_unit.pallets = Σ inv.pallets (bất biến — QA gói 07 kiểm).
--
-- ⚠️ PHỤ THUỘC: Material.entry_unit/units_per_carton (bộ base-unit 20260719+) — như 20260722.

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
-- Tồn tách theo ĐƠN VỊ HIỂN THỊ — cùng phạm vi + cùng công thức quy đổi với `inv`
by_unit as (
  select
    case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0
         then m.entry_unit else coalesce(m.base_unit, 'CAR') end as unit,
    count(*)                       as pallets,
    coalesce(sum(ie.cartons_remaining / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as qty,
    count(distinct ie.material_id) as materials
  from "InventoryEntry" ie
  join "Warehouse" w on w.id = ie.warehouse_id::text
  left join "Material" m on m.id = ie.material_id
  where ie.cartons_remaining > 0
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by 1
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
  'by_unit', coalesce(
    (select jsonb_agg(to_jsonb(b.*) order by b.qty desc) from by_unit b),
    '[]'::jsonb
  ),
  'today', (
    select to_jsonb(t.*) || to_jsonb(tc.*) || to_jsonb(o.*)
    from tin t, tin_cartons tc, tout o
  )
);
$function$;
