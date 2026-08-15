-- 2026-07-30 — LOẠI KHO GHÉP trên 1 chuyến ("FG01+PM01") phải LỌT bộ lọc phân quyền
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- BUG THẬT (user báo 30/07): chuyến 20000016_X_290726_108 chở LẪN thành phẩm + POSM nên
-- GroupDeliveryOrder.warehouse_type lưu chuỗi GHÉP 'FG01+PM01' (upload KH xuất: loaiKhoSet.join('+')).
-- Mọi bộ lọc lại so khớp NGUYÊN CHUỖI (`= ANY(p_categories)`) với các giá trị ĐƠN → không khớp
-- → chuyến BIẾN MẤT khỏi danh sách của MỌI user có scope loại (kể cả người có ĐỦ CẢ HAI loại).
-- Đo trên staging: 67/122 chuyến toàn hệ; riêng Kho Ba Vì 32/58 chuyến bị ẩn oan.
--
-- LUẬT (user chốt 30/07): "xe ghép chung thì phải ĐƯỢC THẤY" ⇒ GIAO ≥1 loại là thấy.
-- Cách làm: helper wt_cats() tách chuỗi ghép thành mảng, mọi chỗ đổi `= ANY` → `&&` (overlap).
-- Giữ nguyên nhánh `warehouse_type IS NULL` (bản ghi chưa khai loại vẫn hiện — null-inclusive).
--
-- Phạm vi: 8 RPC đang đọc GroupDeliveryOrder.warehouse_type (định nghĩa lấy TỪ DB đang chạy,
-- chỉ thay đúng biểu thức so khớp — phần còn lại giữ nguyên 100%).
-- Bảng khác (TmsOrder / ProductionImport / gate_registrations / inbound_plan_lines) KHÔNG có
-- giá trị ghép (đã đếm: 0 dòng) nên KHÔNG đụng tới.

-- ── Helper DUY NHẤT tách loại ghép. Sửa quy tắc tách = sửa 1 chỗ này. ──
-- 'FG01+PM01' → {FG01,PM01} · 'FG01' → {FG01} · NULL/'' → NULL (để nhánh IS NULL vẫn đúng)
CREATE OR REPLACE FUNCTION public.wt_cats(p_raw text) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(ARRAY(
    SELECT btrim(x) FROM unnest(string_to_array(COALESCE(p_raw, ''), '+')) x WHERE btrim(x) <> ''
  ), '{}'::text[])
$$;
REVOKE ALL ON FUNCTION public.wt_cats(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wt_cats(text) TO service_role;

-- ── control_tower_stats ──
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
    and (p_categories is null or g.warehouse_type is null or wt_cats(g.warehouse_type) && p_categories)
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
    and (p_categories is null or g.warehouse_type is null or wt_cats(g.warehouse_type) && p_categories)
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
      and (p_categories is null or g.warehouse_type is null or wt_cats(g.warehouse_type) && p_categories)
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
         -- Đơn vị THẬT của số ở cột SL: mã có quy cách thùng → entry_unit (số là thùng quy đổi);
         -- mã không quy cách → base_unit (số là base thô: EA/KG) — FE in kèm để không đọc nhầm.
         case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0
              then m.entry_unit else m.base_unit end as unit,
         count(*)                              as pallets,
         coalesce(sum(ie.cartons_imported / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)), 0) as cartons
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date::date = p_today
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
    and (p_material_codes is null or m.material_code = any(p_material_codes))
  group by 1, 2, 3, 4
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
    -- FIX 29/07: thiếu dòng này → ô "Pallet nhập" đếm CẢ loại kho không được chọn
    and (p_categories is null or m.category is null or m.category = any(p_categories))
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
    and (p_categories is null or g.warehouse_type is null or wt_cats(g.warehouse_type) && p_categories)
  group by 1
),
hourly_in as (
  select extract(hour from (ie.created_at at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh'))::int as h,
         count(*) as pallets
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id     -- FIX 29/07: để lọc được Loại kho
  cross join day_range r
  where ie.created_at >= r.t0 and ie.created_at < r.t1
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
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

-- ── dashboard_stats ──
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
    and (p_categories is null or g.warehouse_type is null or wt_cats(g.warehouse_type) && p_categories)
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

-- ── loose_picking_facets ──
CREATE OR REPLACE FUNCTION public.loose_picking_facets(p_wh_scope text[], p_cat_scope text[], p_warehouse_id text, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
  RETURN (
    WITH j AS (
      SELECT DISTINCT g.id, i.export_type, g.dvvt, g.warehouse_type, d.distributor_name
      FROM "OutboundItem" i
      JOIN "OutboundDelivery"   d ON d.id = i.do_id
      JOIN "GroupDeliveryOrder" g ON g.id = d.gdo_id AND g.status <> 'CANCELLED'
      WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
        AND (p_from IS NULL OR g.delivery_date >= p_from)
        AND (p_to   IS NULL OR g.delivery_date <= p_to)
        AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
        AND (p_wh_scope  IS NULL OR g.warehouse_id = ANY (p_wh_scope))
        AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR wt_cats(g.warehouse_type) && p_cat_scope)
    )
    SELECT jsonb_build_object(
      'dvvts',        COALESCE((SELECT jsonb_agg(DISTINCT dvvt)             FROM j WHERE dvvt IS NOT NULL), '[]'::jsonb),
      'npps',         COALESCE((SELECT jsonb_agg(DISTINCT distributor_name) FROM j WHERE distributor_name IS NOT NULL), '[]'::jsonb),
      'wh_types',     COALESCE((SELECT jsonb_agg(DISTINCT c) FROM j, LATERAL unnest(wt_cats(j.warehouse_type)) c), '[]'::jsonb),
      'export_types', COALESCE((SELECT jsonb_agg(DISTINCT export_type)      FROM j WHERE export_type IS NOT NULL), '[]'::jsonb)
    )
  );
END $function$;

-- ── loose_picking_page ──
CREATE OR REPLACE FUNCTION public.loose_picking_page(p_wh_scope text[], p_cat_scope text[], p_warehouse_id text, p_from date, p_to date, p_wh_types text[], p_export_types text[], p_dvvts text[], p_npps text[], p_search text, p_offset integer, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE r jsonb; s text;
BEGIN
  s := CASE WHEN p_search IS NULL OR btrim(p_search) = '' THEN NULL
            ELSE lower(immutable_unaccent(btrim(p_search))) END;

  WITH it AS (
    SELECT i.id, i.do_id, i.material_id, i.material_code_raw,
           i.cartons_ordered, i.cartons_scanned, i.loose_picking, i.export_type
    FROM "OutboundItem" i
    WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
  ),
  j AS (
    SELECT it.*, d.gdo_id, d.distributor_name,
           g.group_code, g.dvvt, g.warehouse_type, g.delivery_date,
           m.entry_unit, m.units_per_carton, m.short_name, m.material_code,
           COALESCE(ls.done, 0) AS loose_scanned
    FROM it
    JOIN "OutboundDelivery"    d ON d.id = it.do_id
    JOIN "GroupDeliveryOrder"  g ON g.id = d.gdo_id AND g.status <> 'CANCELLED'
    LEFT JOIN "Material"       m ON m.id = it.material_id
    LEFT JOIN LATERAL (
      SELECT sum(se.cartons_scanned) AS done
      FROM "OutboundScanEntry" se
      WHERE se.item_id = it.id AND se.is_loose_picking
    ) ls ON TRUE
    WHERE (p_from IS NULL OR g.delivery_date >= p_from)
      AND (p_to   IS NULL OR g.delivery_date <= p_to)
      AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
      AND (p_wh_scope  IS NULL OR g.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR wt_cats(g.warehouse_type) && p_cat_scope)
  ),
  st AS (
    SELECT j.*,
           GREATEST(0, loose_picking
                       - GREATEST(0, (cartons_scanned - loose_scanned)
                                     - (cartons_ordered - loose_picking))) AS effective
    FROM j
  ),
  st2 AS (
    SELECT st.*, LEAST(loose_scanned, effective) AS done FROM st
  ),
  gg AS (
    SELECT gdo_id,
           max(group_code)     AS group_code,
           max(delivery_date)  AS delivery_date,
           count(*)            AS items_n,
           count(*) FILTER (WHERE effective - done > 0) AS pending_n,
           sum(qty_entry_decimal(effective, entry_unit, units_per_carton)) AS loose_total,
           sum(qty_entry_decimal(done,      entry_unit, units_per_carton)) AS loose_done,
           max(export_type)    AS export_type,
           max(dvvt)           AS dvvt,
           max(warehouse_type) AS warehouse_type,
           array_agg(DISTINCT distributor_name) FILTER (WHERE distributor_name IS NOT NULL) AS npps,
           lower(immutable_unaccent(
             concat_ws(' ', max(group_code), max(export_type), max(dvvt),
                            string_agg(DISTINCT distributor_name, ' '),
                            string_agg(DISTINCT COALESCE(material_code, material_code_raw), ' '),
                            string_agg(DISTINCT short_name, ' ')))) AS hay
    FROM st2 GROUP BY gdo_id
  ),
  f AS (
    SELECT * FROM gg
    WHERE (p_wh_types     IS NULL OR wt_cats(warehouse_type) && p_wh_types)
      AND (p_export_types IS NULL OR export_type    = ANY (p_export_types))
      AND (p_dvvts        IS NULL OR dvvt           = ANY (p_dvvts))
      AND (p_npps         IS NULL OR npps && p_npps)
      AND (s IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(string_to_array(s, ' ')) t
            WHERE t <> '' AND position(t IN hay) = 0))
  ),
  pg AS (
    SELECT gdo_id FROM f ORDER BY delivery_date, group_code, gdo_id OFFSET p_offset LIMIT p_limit
  ),
  -- gdo object dựng MỘT LẦN per chuyến (mirror payload controller cũ: gdo + warehouse embed +
  -- distributor_names từ MỌI delivery của chuyến + export_type = item nhặt lẻ ĐẦU TIÊN có khai)
  gdoj AS (
    SELECT pg.gdo_id,
           jsonb_build_object(
             'id', g.id, 'group_code', g.group_code, 'delivery_date', g.delivery_date,
             'planned_date', g.planned_date, 'status', g.status, 'started_at', g.started_at,
             'dvvt', g.dvvt, 'warehouse_type', g.warehouse_type,
             'warehouse', CASE WHEN w.id IS NULL THEN NULL ELSE
               jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name) END,
             'distributor_names', COALESCE((
               SELECT jsonb_agg(DISTINCT d2.distributor_name)
               FROM "OutboundDelivery" d2
               WHERE d2.gdo_id = g.id AND d2.distributor_name IS NOT NULL), '[]'::jsonb),
             'export_type', (
               SELECT i2.export_type
               FROM "OutboundDelivery" d3 JOIN "OutboundItem" i2 ON i2.do_id = d3.id
               WHERE d3.gdo_id = g.id AND i2.loose_picking > 0 AND i2.status <> 'CANCELLED'
                 AND i2.export_type IS NOT NULL
               ORDER BY i2.id LIMIT 1)
           ) AS gdo
    FROM pg
    JOIN "GroupDeliveryOrder" g ON g.id = pg.gdo_id
    LEFT JOIN "Warehouse" w ON w.id = g.warehouse_id
  )
  SELECT jsonb_build_object(
    'gdo_ids',     COALESCE((SELECT jsonb_agg(gdo_id) FROM pg), '[]'::jsonb),
    -- MỚI: item đầy đủ (to_jsonb toàn bộ cột như select '*' cũ) + material + gdo + loose_scanned
    'items',       COALESCE((
      SELECT jsonb_agg(to_jsonb(i)
               || jsonb_build_object(
                    'material', CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object(
                      'id', m.id, 'material_code', m.material_code, 'short_name', m.short_name,
                      'base_unit', m.base_unit, 'entry_unit', m.entry_unit,
                      'units_per_carton', m.units_per_carton) END,
                    'gdo', gdoj.gdo,
                    'loose_scanned', COALESCE(ls.done, 0))
               ORDER BY i.id)
      FROM gdoj
      JOIN "OutboundDelivery" d ON d.gdo_id = gdoj.gdo_id
      JOIN "OutboundItem" i ON i.do_id = d.id AND i.loose_picking > 0 AND i.status <> 'CANCELLED'
      LEFT JOIN "Material" m ON m.id = i.material_id
      LEFT JOIN LATERAL (
        SELECT sum(se.cartons_scanned) AS done
        FROM "OutboundScanEntry" se
        WHERE se.item_id = i.id AND se.is_loose_picking
      ) ls ON TRUE), '[]'::jsonb),
    'total',       (SELECT count(*)                FROM f),
    'items_n',     (SELECT COALESCE(sum(items_n), 0)     FROM f),
    'pending_n',   (SELECT COALESCE(sum(pending_n), 0)   FROM f),
    'loose_total', (SELECT COALESCE(sum(loose_total), 0)  FROM f),
    'loose_done',  (SELECT COALESCE(sum(loose_done), 0)   FROM f)
  ) INTO r;
  RETURN r;
END $function$;

-- ── outbound_gdos_facets ──
CREATE OR REPLACE FUNCTION public.outbound_gdos_facets(p_warehouse_ids text[] DEFAULT NULL::text[], p_scope_categories text[] DEFAULT NULL::text[], p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE result jsonb;
BEGIN
  WITH g AS (
    SELECT gd.id, gd.dvvt, gd.warehouse_type, gd.status, gd.assigned_at
    FROM "GroupDeliveryOrder" gd
    WHERE (p_warehouse_ids IS NULL OR gd.warehouse_id = ANY (p_warehouse_ids))
      AND (p_scope_categories IS NULL OR gd.warehouse_type IS NULL
           OR wt_cats(gd.warehouse_type) && p_scope_categories)
      AND (p_date_from IS NULL OR gd.delivery_date >= p_date_from)
      AND (p_date_to   IS NULL OR gd.delivery_date <= p_date_to)
  ),
  it AS (
    SELECT DISTINCT i.export_type, i.material_code_raw, m.short_name, d.distributor_name
    FROM g
    JOIN "OutboundDelivery" d ON d.gdo_id = g.id
    JOIN "OutboundItem" i     ON i.do_id  = d.id
    LEFT JOIN "Material" m    ON m.id     = i.material_id
  )
  SELECT jsonb_build_object(
    'export_types',    COALESCE((SELECT jsonb_agg(DISTINCT export_type) FROM it WHERE export_type IS NOT NULL AND export_type <> ''), '[]'::jsonb),
    'dvvts',           COALESCE((SELECT jsonb_agg(DISTINCT dvvt) FROM g WHERE dvvt IS NOT NULL AND dvvt <> ''), '[]'::jsonb),
    'warehouse_types', COALESCE((SELECT jsonb_agg(DISTINCT c) FROM g, LATERAL unnest(wt_cats(g.warehouse_type)) c), '[]'::jsonb),
    'npps',            COALESCE((SELECT jsonb_agg(DISTINCT distributor_name) FROM it WHERE distributor_name IS NOT NULL AND distributor_name <> ''), '[]'::jsonb),
    'status_labels',   COALESCE((SELECT jsonb_agg(DISTINCT lbl) FROM (
                          SELECT gdo_status_label(status, assigned_at) AS lbl FROM g) s
                          WHERE lbl <> '—'), '[]'::jsonb),
    'materials',       COALESCE((SELECT jsonb_agg(jsonb_build_object('value', material_code_raw,
                          'label', CASE WHEN short_name IS NOT NULL AND short_name <> ''
                                        THEN material_code_raw || ' · ' || short_name
                                        ELSE material_code_raw END) ORDER BY material_code_raw)
                          FROM (SELECT DISTINCT ON (material_code_raw) material_code_raw, short_name
                                  FROM it WHERE material_code_raw IS NOT NULL AND material_code_raw <> ''
                                 ORDER BY material_code_raw, short_name NULLS LAST) mm), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$function$;

-- ── outbound_gdos_page ──
CREATE OR REPLACE FUNCTION public.outbound_gdos_page(p_offset integer, p_limit integer, p_warehouse_ids text[] DEFAULT NULL::text[], p_scope_categories text[] DEFAULT NULL::text[], p_warehouse_types text[] DEFAULT NULL::text[], p_status text DEFAULT NULL::text, p_transfer_status text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_export_types text[] DEFAULT NULL::text[], p_dvvts text[] DEFAULT NULL::text[], p_npps text[] DEFAULT NULL::text[], p_material_codes text[] DEFAULT NULL::text[], p_status_labels text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_search_gdo_ids text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE result jsonb;
BEGIN
  WITH f AS (
    SELECT g.id, g.delivery_date, g.group_code, g.gate_registration_id, g.license_plate
    FROM "GroupDeliveryOrder" g
    WHERE (p_warehouse_ids IS NULL OR g.warehouse_id = ANY (p_warehouse_ids))
      AND (p_scope_categories IS NULL OR g.warehouse_type IS NULL
           OR wt_cats(g.warehouse_type) && p_scope_categories)
      AND (p_warehouse_types  IS NULL OR wt_cats(g.warehouse_type) && p_warehouse_types)
      AND (p_status           IS NULL OR g.status = p_status)
      AND (p_transfer_status  IS NULL OR g.transfer_status = p_transfer_status)
      AND (p_date_from        IS NULL OR g.delivery_date >= p_date_from)
      AND (p_date_to          IS NULL OR g.delivery_date <= p_date_to)
      AND (p_dvvts            IS NULL OR g.dvvt = ANY (p_dvvts))
      AND (p_status_labels    IS NULL OR gdo_status_label(g.status, g.assigned_at) = ANY (p_status_labels))
      AND (p_npps IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d
            WHERE d.gdo_id = g.id AND d.distributor_name = ANY (p_npps)))
      AND (p_export_types IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
            WHERE d.gdo_id = g.id AND i.export_type = ANY (p_export_types)))
      AND (p_material_codes IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
            WHERE d.gdo_id = g.id AND i.material_code_raw = ANY (p_material_codes)))
      AND (p_search IS NULL
           OR g.group_code ILIKE '%' || p_search || '%'
           OR g.id = ANY (COALESCE(p_search_gdo_ids, ARRAY[]::text[])))
  ),
  -- export_type (= item ĐẦU TIÊN theo id có khai) chỉ cần cho SẮP XẾP.
  -- Gom MỘT LƯỢT bằng DISTINCT ON, KHÔNG dùng LATERAL per-row: LATERAL chạy 1 truy vấn con cho
  -- MỖI chuyến khớp lọc (đo 28/07: 50k chuyến → ~0,9s chỉ để lấy khoá sắp xếp).
  et AS (
    SELECT DISTINCT ON (d.gdo_id) d.gdo_id, i.export_type
    FROM f
    JOIN "OutboundDelivery" d ON d.gdo_id = f.id
    JOIN "OutboundItem" i     ON i.do_id  = d.id
    WHERE i.export_type IS NOT NULL
    ORDER BY d.gdo_id, i.id
  ),
  s AS (
    SELECT f.id, f.delivery_date, f.group_code,
           CASE WHEN f.gate_registration_id IS NOT NULL THEN 'gate:' || f.gate_registration_id::text
                WHEN NULLIF(btrim(COALESCE(f.license_plate, '')), '') IS NOT NULL
                  THEN 'plate:' || upper(btrim(f.license_plate))
                ELSE NULL END AS grp,
           et.export_type,
           COALESCE(NULLIF(substring(f.group_code from '(\d+)$'), '')::bigint, 0) AS code_num
    FROM f LEFT JOIN et ON et.gdo_id = f.id
  ),
  -- `count(*) OVER ()` lấy TỔNG trong CÙNG lần quét (window tính trước LIMIT) — trước đây
  -- `(SELECT count(*) FROM f)` riêng khiến CTE f bị tham chiếu 2 lần ⇒ vật chất hoá + quét lại.
  pg AS (
    SELECT id, count(*) OVER () AS total, row_number() OVER (
             ORDER BY delivery_date DESC, (grp IS NULL), COALESCE(grp, ''),
                      COALESCE(export_type, '') DESC, code_num, group_code) AS rn
    FROM s
    ORDER BY delivery_date DESC, (grp IS NULL), COALESCE(grp, ''),
             COALESCE(export_type, '') DESC, code_num, group_code
    LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    -- pg rỗng (trang vượt tầm / không kết quả) → phải đếm lại, nhưng đó là trường hợp hiếm
    'total', COALESCE((SELECT max(total) FROM pg), (SELECT count(*) FROM s)),
    'ids',   COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$function$;

-- ── outbound_gdos_summary ──
CREATE OR REPLACE FUNCTION public.outbound_gdos_summary(p_warehouse_ids text[] DEFAULT NULL::text[], p_scope_categories text[] DEFAULT NULL::text[], p_warehouse_types text[] DEFAULT NULL::text[], p_status text DEFAULT NULL::text, p_transfer_status text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_export_types text[] DEFAULT NULL::text[], p_dvvts text[] DEFAULT NULL::text[], p_npps text[] DEFAULT NULL::text[], p_material_codes text[] DEFAULT NULL::text[], p_status_labels text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_search_gdo_ids text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  result  jsonb;
  n_items bigint;
  -- Trần AN TOÀN cho phép tính tổng. Căn cứ đo 28/07 (50.000 chuyến / 200.000 dòng hàng):
  -- tính tổng ~800ms, ĐẾM dòng chỉ ~160ms; role `authenticator` của PostgREST có
  -- statement_timeout = 8s CỐ ĐỊNH ⇒ 12 người cùng quét toàn bộ kho × 90 ngày thì 10/24
  -- request bị huỷ → 500 trắng màn.
  -- Trần tính theo SỐ DÒNG HÀNG (không phải số chuyến): chi phí tỉ lệ với dòng hàng, mà mỗi
  -- chuyến có thể 2 hay 50 dòng — đặt trần theo chuyến sẽ vừa chặn oan vừa lọt.
  -- Vượt trần: vẫn trả SỐ CHUYẾN (đếm rẻ) + cờ too_wide để FE hiện "—" kèm hướng dẫn thu hẹp;
  -- KHÔNG tính tổng, KHÔNG để user nhận lỗi. Danh sách vẫn lật trang bình thường.
  -- 150k dòng ≈ 0,6s tính tổng. Đo thật: 1 THÁNG toàn bộ 40 kho = 69k dòng (có tổng, ~0,6s);
  -- 3 THÁNG toàn bộ 40 kho = 200k dòng (vượt trần → hiện số chuyến + hướng dẫn thu hẹp).
  -- Lọc 1 kho thì cả năm vẫn dưới trần ⇒ người vận hành bình thường KHÔNG bao giờ chạm.
  MAX_ITEMS_FOR_TOTALS constant bigint := 150000;
BEGIN
  -- Đếm trước SỐ DÒNG HÀNG (join index-only, ~160ms/200k — rẻ hơn 5 lần so với tính tổng).
  -- KHÔNG dùng count(DISTINCT gd.id): distinct trên bảng join là phép SORT/HASH đắt, chính nó
  -- lại thành nút nghẽn (đo 28/07). Số chuyến khi vượt trần lấy từ `total` của endpoint danh
  -- sách (FE đã có sẵn) — không cần đếm ở đây.
  SELECT count(*) INTO n_items
  FROM "GroupDeliveryOrder" gd
  JOIN "OutboundDelivery" d ON d.gdo_id = gd.id
  JOIN "OutboundItem" i     ON i.do_id  = d.id
  WHERE (p_warehouse_ids IS NULL OR gd.warehouse_id = ANY (p_warehouse_ids))
    AND (p_scope_categories IS NULL OR gd.warehouse_type IS NULL
         OR wt_cats(gd.warehouse_type) && p_scope_categories)
    AND (p_warehouse_types  IS NULL OR wt_cats(gd.warehouse_type) && p_warehouse_types)
    AND (p_status           IS NULL OR gd.status = p_status)
    AND (p_transfer_status  IS NULL OR gd.transfer_status = p_transfer_status)
    AND (p_date_from        IS NULL OR gd.delivery_date >= p_date_from)
    AND (p_date_to          IS NULL OR gd.delivery_date <= p_date_to)
    AND (p_dvvts            IS NULL OR gd.dvvt = ANY (p_dvvts))
    AND (p_status_labels    IS NULL OR gdo_status_label(gd.status, gd.assigned_at) = ANY (p_status_labels))
    AND (p_npps IS NULL OR EXISTS (
          SELECT 1 FROM "OutboundDelivery" d
          WHERE d.gdo_id = gd.id AND d.distributor_name = ANY (p_npps)))
    AND (p_export_types IS NULL OR EXISTS (
          SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
          WHERE d.gdo_id = gd.id AND i.export_type = ANY (p_export_types)))
    AND (p_material_codes IS NULL OR EXISTS (
          SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
          WHERE d.gdo_id = gd.id AND i.material_code_raw = ANY (p_material_codes)))
    AND (p_search IS NULL
         OR gd.group_code ILIKE '%' || p_search || '%'
         OR gd.id = ANY (COALESCE(p_search_gdo_ids, ARRAY[]::text[])));

  IF n_items > MAX_ITEMS_FOR_TOTALS THEN
    RETURN jsonb_build_object(
      'count', NULL, 'completed', NULL,
      'cartons', NULL, 'cartons_noqr', NULL, 'cartons_qr', NULL, 'pallets', NULL,
      'npp_breakdown', '[]'::jsonb,
      'too_wide', true, 'items_scanned', n_items, 'max_items_for_totals', MAX_ITEMS_FOR_TOTALS);
  END IF;

  WITH g AS (
    SELECT gd.id, gd.status, gd.warehouse_id
    FROM "GroupDeliveryOrder" gd
    WHERE (p_warehouse_ids IS NULL OR gd.warehouse_id = ANY (p_warehouse_ids))
      AND (p_scope_categories IS NULL OR gd.warehouse_type IS NULL
           OR wt_cats(gd.warehouse_type) && p_scope_categories)
      AND (p_warehouse_types  IS NULL OR wt_cats(gd.warehouse_type) && p_warehouse_types)
      AND (p_status           IS NULL OR gd.status = p_status)
      AND (p_transfer_status  IS NULL OR gd.transfer_status = p_transfer_status)
      AND (p_date_from        IS NULL OR gd.delivery_date >= p_date_from)
      AND (p_date_to          IS NULL OR gd.delivery_date <= p_date_to)
      AND (p_dvvts            IS NULL OR gd.dvvt = ANY (p_dvvts))
      AND (p_status_labels    IS NULL OR gdo_status_label(gd.status, gd.assigned_at) = ANY (p_status_labels))
      AND (p_npps IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d
            WHERE d.gdo_id = gd.id AND d.distributor_name = ANY (p_npps)))
      AND (p_export_types IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
            WHERE d.gdo_id = gd.id AND i.export_type = ANY (p_export_types)))
      AND (p_material_codes IS NULL OR EXISTS (
            SELECT 1 FROM "OutboundDelivery" d JOIN "OutboundItem" i ON i.do_id = d.id
            WHERE d.gdo_id = gd.id AND i.material_code_raw = ANY (p_material_codes)))
      AND (p_search IS NULL
           OR gd.group_code ILIKE '%' || p_search || '%'
           OR gd.id = ANY (COALESCE(p_search_gdo_ids, ARRAY[]::text[])))
  ),
  -- Ngoại lệ Thùng/Pallet theo kho: bung jsonb MỘT LẦN cho bảng mã hàng (vài nghìn dòng),
  -- KHÔNG gọi hàm cho từng dòng hàng (xem ghi chú ở đầu file — chênh 1,6s/200k dòng).
  ov AS (
    SELECT m.id AS material_id, o->>'warehouse_id' AS wh,
           GREATEST((o->>'cartons_per_pallet')::numeric, 0) AS cpp
    FROM "Material" m
    CROSS JOIN LATERAL jsonb_array_elements(m.warehouse_pallet_overrides) o
    WHERE jsonb_typeof(m.warehouse_pallet_overrides) = 'array'
  ),
  -- MỘT lần quét dòng hàng, tính sẵn mọi đại lượng (trước đây 4 subquery quét lại CTE 4 lần).
  it AS (
    SELECT COALESCE(d.distributor_name, '(không tên)') AS npp, i.material_code_raw,
           COALESCE(m.no_qr_tracking, false) AS no_qr,
           CASE WHEN m.entry_unit IS NOT NULL AND btrim(m.entry_unit) <> ''
                     AND COALESCE(m.units_per_carton, 0) > 0
                THEN ROUND(COALESCE(i.cartons_ordered, 0) / m.units_per_carton, 3)
                ELSE COALESCE(i.cartons_ordered, 0) END AS c_ord,
           CASE WHEN m.entry_unit IS NOT NULL AND btrim(m.entry_unit) <> ''
                     AND COALESCE(m.units_per_carton, 0) > 0
                THEN ROUND(COALESCE(i.cartons_scanned, 0) / m.units_per_carton, 3)
                ELSE COALESCE(i.cartons_scanned, 0) END AS c_scan,
           -- palletsOf: mã pallet-mang-hàng → 0 · có pallets_estimated → dùng · else thùng ÷ cpp
           CASE WHEN COALESCE(m.is_pallet_carrier, false) THEN 0
                WHEN COALESCE(i.pallets_estimated, 0) > 0 THEN i.pallets_estimated
                ELSE (CASE WHEN COALESCE(NULLIF(ov.cpp, 0), m.cartons_per_pallet, 0) > 0
                           THEN (CASE WHEN m.entry_unit IS NOT NULL AND btrim(m.entry_unit) <> ''
                                           AND COALESCE(m.units_per_carton, 0) > 0
                                      THEN ROUND(COALESCE(i.cartons_ordered, 0) / m.units_per_carton, 3)
                                      ELSE COALESCE(i.cartons_ordered, 0) END)
                                / COALESCE(NULLIF(ov.cpp, 0), m.cartons_per_pallet, 0)
                           ELSE 0 END)
                END AS pallets
    FROM g
    JOIN "OutboundDelivery" d ON d.gdo_id = g.id
    JOIN "OutboundItem" i     ON i.do_id  = d.id
    LEFT JOIN "Material" m    ON m.id     = i.material_id
    LEFT JOIN ov              ON ov.material_id = i.material_id AND ov.wh = g.warehouse_id
  ),
  -- MỘT lần quét cho CẢ tổng lẫn phân bổ NPP (GROUPING SETS).
  -- Tách 2 truy vấn riêng thì CTE `it` bị tham chiếu 2 lần ⇒ Postgres VẬT CHẤT HOÁ 200k dòng
  -- ra tuplestore rồi đọc lại — đo 28/07: chiếm ~2/3 thời gian (900ms), trong khi bản thân
  -- phép cộng chỉ ~230ms. Gộp lại thì `it` được inline, không materialize.
  -- Dòng GROUPING(npp)=1 là TỔNG; các dòng còn lại là từng NPP.
  -- Cột *_mat = phần khớp p_material_codes (FE cũ: đang lọc mã hàng thì breakdown chỉ tính mã đó).
  rollup AS (
    SELECT GROUPING(npp) AS is_total, npp,
           SUM(c_ord)                                   AS c_ord,
           SUM(c_ord) FILTER (WHERE no_qr)              AS c_noqr,
           SUM(pallets)                                 AS pallets,
           SUM(c_ord)  FILTER (WHERE mat_ok)            AS c_ord_mat,
           SUM(c_scan) FILTER (WHERE mat_ok)            AS c_scan_mat,
           count(*)    FILTER (WHERE mat_ok)            AS n_mat
    FROM (SELECT it.*, (p_material_codes IS NULL OR material_code_raw = ANY (p_material_codes)) AS mat_ok
            FROM it) x
    GROUP BY GROUPING SETS ((npp), ())
  ),
  gagg AS (
    SELECT count(*) AS cnt, count(*) FILTER (WHERE status = 'COMPLETED') AS done FROM g
  )
  SELECT jsonb_build_object(
    'count',         (SELECT cnt  FROM gagg),
    'completed',     (SELECT done FROM gagg),
    'cartons',       COALESCE((SELECT c_ord   FROM rollup WHERE is_total = 1), 0),
    'cartons_noqr',  COALESCE((SELECT c_noqr  FROM rollup WHERE is_total = 1), 0),
    'cartons_qr',    COALESCE((SELECT c_ord - COALESCE(c_noqr, 0) FROM rollup WHERE is_total = 1), 0),
    'pallets',       COALESCE((SELECT pallets FROM rollup WHERE is_total = 1), 0),
    'npp_breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'npp', npp, 'planned', c_ord_mat, 'scanned', c_scan_mat)
                        ORDER BY c_ord_mat DESC, npp)
                        FROM rollup WHERE is_total = 0 AND n_mat > 0), '[]'::jsonb),
    'too_wide', false
  ) INTO result;
  RETURN result;
END;
$function$;

-- ── rename_warehouse_type ──
CREATE OR REPLACE FUNCTION public.rename_warehouse_type(p_old text, p_new text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  counts jsonb := '{}'::jsonb;
  n bigint;
BEGIN
  p_new := btrim(p_new);
  IF p_old IS NULL OR p_new IS NULL OR p_new = '' OR p_old = p_new THEN
    RAISE EXCEPTION 'Tên mới không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = p_old) THEN
    RAISE EXCEPTION 'Loại kho "%" không tồn tại', p_old USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = p_new) THEN
    RAISE EXCEPTION 'Loại kho "%" đã tồn tại', p_new USING ERRCODE = '23505';
  END IF;

  UPDATE "LookupValue" SET value = p_new, updated_at = now()
    WHERE type = 'warehouse_type' AND value = p_old;

  UPDATE "Material" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Material', n);

  -- MẢNG (multi-loại 27/07): Location / WarehouseZone / StocktakeLog
  UPDATE "Location" SET categories = array_replace(categories, p_old, p_new)
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Location', n);

  UPDATE "WarehouseZone" SET categories = array_replace(categories, p_old, p_new)
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('WarehouseZone', n);

  UPDATE "StocktakeLog" SET categories = array_replace(categories, p_old, p_new), updated_at = now()
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('StocktakeLog', n);

  UPDATE "Employee" SET allowed_categories = array_replace(allowed_categories, p_old, p_new)
    WHERE p_old = ANY(allowed_categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Employee', n);

  UPDATE "Warehouse" SET carton_scan_categories = array_replace(carton_scan_categories, p_old, p_new)
    WHERE p_old = ANY(carton_scan_categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Warehouse', n);

  UPDATE "SlotTemplate" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('SlotTemplate', n);

  UPDATE "DeliverySlot" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('DeliverySlot', n);

  UPDATE "TmsOrder" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('TmsOrder', n);

  -- Chuyến chở lẫn: thay ĐÚNG phần tử trong chuỗi ghép (DISTINCT phòng khi ghép ra trùng)
  UPDATE "GroupDeliveryOrder"
     SET warehouse_type = (SELECT string_agg(DISTINCT c, '+')
                             FROM unnest(array_replace(wt_cats(warehouse_type), p_old, p_new)) c)
   WHERE wt_cats(warehouse_type) @> ARRAY[p_old];
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('GroupDeliveryOrder', n);

  UPDATE gate_registrations SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('gate_registrations', n);

  UPDATE inbound_plan_lines SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('inbound_plan_lines', n);

  UPDATE "ProductionImport" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('ProductionImport', n);

  UPDATE "PalletLabelPrint" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('PalletLabelPrint', n);

  RETURN counts;
END;
$function$;
