-- 20260827c — DÒNG TỪNG KHO CHỈ MANG CHI PHÍ RIÊNG CỦA KHO (bỏ phân bổ chi phí chung xuống kho).
--
-- Vì sao đổi (bắt được khi soi màn hình thật ngay sau khi làm xong 20260827b): bản đầu chia chi phí
-- CHUNG xuống từng kho theo tấn — nghe hợp lý, nhưng mẫu số là "tấn của các kho ĐANG LỌC". Người
-- dùng lọc 1 kho (Kho Ba Vì) thì kho đó GÁNH 100% chi phí chung toàn công ty ⇒ chi phí/tấn của kho
-- phồng lên vô lý, mà nhìn số thì không ai biết vì sao. Muốn chia đúng thì mẫu số phải là tấn của
-- TOÀN CÔNG TY, tức phải quét thêm một lượt không lọc kho — đắt, và vẫn khó giải thích.
--
-- Chốt cách đơn giản mà không đọc sai được:
--   · Dòng từng kho  = chi phí RIÊNG của kho đó (chi phí/tấn của kho = tiền của kho ÷ tấn của kho).
--   · Ô tổng         = Σ chi phí riêng + chi phí CHUNG, kèm dòng ghi rõ "gồm N chi phí chung".
-- Ai muốn biết phần chung đã cộng vào đâu thì nhìn `cost_shared` — không giấu, không chia lén.

CREATE OR REPLACE FUNCTION public.warehouse_productivity(
  p_warehouse_ids text[]  DEFAULT NULL::text[],
  p_categories    text[]  DEFAULT NULL::text[],
  p_from          date    DEFAULT NULL::date,
  p_to            date    DEFAULT NULL::date,
  p_std_hours     numeric DEFAULT 8
) RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
with
wh as (
  select w.id, w.name
  from "Warehouse" w
  where (p_warehouse_ids is null or w.id = any(p_warehouse_ids))
),
tin as (
  select ie.warehouse_id::text                        as wid,
         date_trunc('month', ie.import_date)::date    as mon,
         sum(case when coalesce(m.weight_kg,0) > 0
                  then ie.cartons_imported
                       / (case when coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)
                       * m.weight_kg
                  else 0 end) / 1000.0                as tons,
         count(*)                                     as pallets,
         count(*) filter (where coalesce(m.weight_kg,0) <= 0) as lines_no_weight
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date >= p_from and ie.import_date < (p_to + 1)
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by 1, 2
),
tout as (
  select g.warehouse_id::text                         as wid,
         date_trunc('month', g.delivery_date)::date   as mon,
         sum(case when coalesce(m.weight_kg,0) > 0
                  then oi.cartons_scanned
                       / (case when coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)
                       * m.weight_kg
                  else 0 end) / 1000.0                as tons,
         count(*) filter (where coalesce(m.weight_kg,0) <= 0 and coalesce(oi.cartons_scanned,0) > 0) as lines_no_weight
  from "GroupDeliveryOrder" g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi    on oi.do_id = d.id
  left join "Material" m    on m.id = oi.material_id
  where g.delivery_date between p_from and p_to
    and coalesce(g.status, '') <> 'CANCELLED'
    and (p_warehouse_ids is null or g.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by 1, 2
),
trips as (
  select g.warehouse_id::text                         as wid,
         date_trunc('month', g.delivery_date)::date   as mon,
         count(*)                                     as trips
  from "GroupDeliveryOrder" g
  where g.delivery_date between p_from and p_to
    and g.status = 'COMPLETED'
    and (p_warehouse_ids is null or g.warehouse_id::text = any(p_warehouse_ids))
  group by 1, 2
),
lab as (
  select coalesce(a.warehouse_id, e.warehouse_id)::text as wid,
         date_trunc('month', a.work_date)::date         as mon,
         count(*) filter (where a.kind in ('CA1','CA2','CA3','HC'))                      as work_days,
         count(distinct a.employee_id) filter (where a.kind in ('CA1','CA2','CA3','HC')) as headcount,
         count(*) filter (where a.kind = 'LEAVE')                                        as leave_days,
         coalesce(sum(a.ot_hours), 0)                                                    as ot_hours,
         coalesce(sum(a.early_leave_hours), 0)                                           as early_hours
  from "Attendance" a
  left join "Employee" e on e.id = a.employee_id
  where a.work_date between p_from and p_to
    and (p_warehouse_ids is null or coalesce(a.warehouse_id, e.warehouse_id)::text = any(p_warehouse_ids))
  group by 1, 2
),
-- Chi phí: tỷ lệ ngày của THÁNG nằm trong khoảng đang xem (khoảng tròn tháng ⇒ frac = 1)
cost_raw as (
  select wc.warehouse_id                                     as wid,
         wc.amount * (
           greatest(0, (least(p_to, (wc.period + interval '1 month - 1 day')::date)
                        - greatest(p_from, wc.period) + 1))::numeric
           / extract(day from (wc.period + interval '1 month - 1 day'))::numeric
         )                                                   as amount,
         coalesce((li.meta->>'is_labor')::boolean, false)     as is_labor,
         (greatest(p_from, wc.period) > wc.period
          or least(p_to, (wc.period + interval '1 month - 1 day')::date) < (wc.period + interval '1 month - 1 day')::date) as partial
  from public.warehouse_costs wc
  left join "LookupValue" li on li.type = 'cost_item' and li.value = wc.cost_item
  where wc.period between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
    and (wc.warehouse_id is null or p_warehouse_ids is null or wc.warehouse_id = any(p_warehouse_ids))
),
cost_own as (
  select wid, sum(amount) as amount, sum(amount) filter (where is_labor) as labor
  from cost_raw where wid is not null group by wid
),
cost_shared as (
  select coalesce(sum(amount), 0) as amount, coalesce(sum(amount) filter (where is_labor), 0) as labor
  from cost_raw where wid is null
),
cell as (
  select k.wid, k.mon,
         coalesce(tin.tons, 0)            as tons_in,
         coalesce(tout.tons, 0)           as tons_out,
         coalesce(tin.pallets, 0)         as pallets_in,
         coalesce(trips.trips, 0)         as trips,
         coalesce(lab.work_days, 0)       as work_days,
         coalesce(lab.headcount, 0)       as headcount,
         coalesce(lab.leave_days, 0)      as leave_days,
         coalesce(lab.ot_hours, 0)        as ot_hours,
         coalesce(lab.early_hours, 0)     as early_hours,
         coalesce(tin.lines_no_weight, 0) + coalesce(tout.lines_no_weight, 0) as lines_no_weight
  from (
    select wid, mon from tin
    union select wid, mon from tout
    union select wid, mon from trips
    union select wid, mon from lab
  ) k
  left join tin   on tin.wid = k.wid   and tin.mon = k.mon
  left join tout  on tout.wid = k.wid  and tout.mon = k.mon
  left join trips on trips.wid = k.wid and trips.mon = k.mon
  left join lab   on lab.wid = k.wid   and lab.mon = k.mon
  where k.wid is not null
),
per_wh as (
  select w.id                                  as warehouse_id,
         w.name                                as warehouse_name,
         coalesce(sum(c.tons_in), 0)           as tons_in,
         coalesce(sum(c.tons_out), 0)          as tons_out,
         coalesce(sum(c.pallets_in), 0)        as pallets_in,
         coalesce(sum(c.trips), 0)             as trips,
         coalesce(sum(c.work_days), 0)         as work_days,
         coalesce(max(c.headcount), 0)         as headcount,
         coalesce(sum(c.leave_days), 0)        as leave_days,
         coalesce(sum(c.ot_hours), 0)          as ot_hours,
         coalesce(sum(c.early_hours), 0)       as early_hours,
         coalesce(sum(c.lines_no_weight), 0)   as lines_no_weight,
         coalesce(max(co.amount), 0)           as cost_own,
         coalesce(max(co.labor), 0)            as cost_labor_own
  from wh w
  left join cell c    on c.wid = w.id
  left join cost_own co on co.wid = w.id
  group by w.id, w.name
),
per_mon as (
  select c.mon                          as month,
         sum(c.tons_in)                 as tons_in,
         sum(c.tons_out)                as tons_out,
         sum(c.trips)                   as trips,
         sum(c.work_days)               as work_days,
         sum(c.ot_hours)                as ot_hours,
         sum(c.early_hours)             as early_hours
  from cell c
  join wh w on w.id = c.wid
  group by c.mon
)
select jsonb_build_object(
  'from',       p_from,
  'to',         p_to,
  'std_hours',  p_std_hours,
  'categories_filtered', (p_categories is not null),
  'cost_prorated', coalesce((select bool_or(partial) from cost_raw), false),
  'cost_shared',   round(coalesce((select amount from cost_shared), 0)::numeric, 0),
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'warehouse_id',    r.warehouse_id,
      'warehouse_name',  r.warehouse_name,
      'tons_in',         round(r.tons_in::numeric, 3),
      'tons_out',        round(r.tons_out::numeric, 3),
      'tons',            round((r.tons_in + r.tons_out)::numeric, 3),
      'pallets_in',      r.pallets_in,
      'trips',           r.trips,
      'work_days',       r.work_days,
      'work_hours',      round((r.work_days * p_std_hours + r.ot_hours - r.early_hours)::numeric, 2),
      'ot_hours',        round(r.ot_hours::numeric, 2),
      'early_hours',     round(r.early_hours::numeric, 2),
      'leave_days',      r.leave_days,
      'headcount',       r.headcount,
      'lines_no_weight', r.lines_no_weight,
      -- CHI PHÍ RIÊNG của kho — KHÔNG gánh phần chung (xem ghi chú đầu file)
      'cost',            round(r.cost_own::numeric, 0),
      'cost_own',        round(r.cost_own::numeric, 0),
      'cost_labor',      round(r.cost_labor_own::numeric, 0)
    ) order by (r.tons_in + r.tons_out) desc, r.warehouse_name)
    from per_wh r), '[]'::jsonb),
  'by_month', coalesce((
    select jsonb_agg(jsonb_build_object(
      'month',      to_char(p.month, 'YYYY-MM'),
      'tons_in',    round(p.tons_in::numeric, 3),
      'tons_out',   round(p.tons_out::numeric, 3),
      'tons',       round((p.tons_in + p.tons_out)::numeric, 3),
      'trips',      p.trips,
      'work_days',  p.work_days,
      'work_hours', round((p.work_days * p_std_hours + p.ot_hours - p.early_hours)::numeric, 2),
      'ot_hours',   round(p.ot_hours::numeric, 2)
    ) order by p.month)
    from per_mon p), '[]'::jsonb),
  'totals', (
    select jsonb_build_object(
      'tons_in',         round(coalesce(sum(r.tons_in), 0)::numeric, 3),
      'tons_out',        round(coalesce(sum(r.tons_out), 0)::numeric, 3),
      'tons',            round(coalesce(sum(r.tons_in + r.tons_out), 0)::numeric, 3),
      'pallets_in',      coalesce(sum(r.pallets_in), 0),
      'trips',           coalesce(sum(r.trips), 0),
      'work_days',       coalesce(sum(r.work_days), 0),
      'work_hours',      round(coalesce(sum(r.work_days * p_std_hours + r.ot_hours - r.early_hours), 0)::numeric, 2),
      'ot_hours',        round(coalesce(sum(r.ot_hours), 0)::numeric, 2),
      'early_hours',     round(coalesce(sum(r.early_hours), 0)::numeric, 2),
      'leave_days',      coalesce(sum(r.leave_days), 0),
      'headcount',       coalesce(sum(r.headcount), 0),
      'lines_no_weight', coalesce(sum(r.lines_no_weight), 0),
      -- Tổng = Σ chi phí riêng các kho + chi phí CHUNG (ô tổng nói rõ "gồm N chi phí chung")
      'cost',            round(coalesce(sum(r.cost_own), 0)::numeric + coalesce((select amount from cost_shared), 0)::numeric, 0),
      'cost_labor',      round(coalesce(sum(r.cost_labor_own), 0)::numeric + coalesce((select labor from cost_shared), 0)::numeric, 0),
      'warehouses_no_labor', coalesce(count(*) filter (where r.work_days = 0 and (r.tons_in + r.tons_out) > 0), 0),
      'warehouses_no_cost',  coalesce(count(*) filter (where r.cost_own = 0 and (r.tons_in + r.tons_out) > 0), 0)
    ) from per_wh r)
);
$function$;
