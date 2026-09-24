-- ============================================================================
-- CUTOVER production 24/09/2026 — PART 3/10
-- 16 migration · 20260827e_months_without_cost.sql → 20260901e_trace_prod_flex.sql
-- Dán TRỌN file vào Supabase SQL Editor của project PRODUCTION svicyfquresxaigfxsdb rồi Run.
-- Cả part nằm trong MỘT transaction: lỗi bất kỳ đâu = rollback trọn part, schema không dở dang.
-- Chạy lại lần hai sẽ báo "đã tồn tại" rồi tự rollback — không hỏng gì.
-- ============================================================================
BEGIN;


-- ─────────────────────────────────────────────────────────────────────────
-- [20260827e_months_without_cost.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260827e — ĐẾM SỐ THÁNG CÓ HÀNG MÀ CHƯA KHAI CHI PHÍ (`totals.months_no_cost`).
--
-- Bắt được khi soi màn hình thật trong lượt check-app 27/08: chọn kỳ "12 tháng gần nhất" thì ô
-- "Chi phí / tấn" ra **25.753 đ/tấn** — nhìn rất đẹp, nhưng MẪU SỐ là tấn của 12 tháng còn TỬ SỐ
-- chỉ có chi phí của tháng 8 (11 tháng kia chưa khai). Cảnh báo cũ chỉ bắt được "kho có hàng mà
-- CHƯA KHAI ĐỒNG NÀO" (`warehouses_no_cost`) nên ca này lọt lưới: kho ĐÃ khai — chỉ thiếu tháng.
-- Nay trả thêm số THÁNG có hàng mà không có chi phí để màn hình nói thẳng, thay vì để người đọc
-- tưởng chi phí/tấn đang rẻ.
--
-- Giữ nguyên luật 20260827d: chi phí CHUNG chỉ cộng khi xem TOÀN BỘ (không lọc kho / không scope).

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
-- Chi phí: tỷ lệ ngày của THÁNG nằm trong khoảng đang xem (khoảng tròn tháng ⇒ frac = 1).
-- ⚠️ Dòng CHUNG (warehouse_id null) CHỈ lấy khi p_warehouse_ids IS NULL — xem ghi chú đầu file.
cost_raw as (
  select wc.warehouse_id                                     as wid,
         date_trunc('month', wc.period)::date                as mon,
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
    and (case when wc.warehouse_id is null
              then p_warehouse_ids is null
              else p_warehouse_ids is null or wc.warehouse_id = any(p_warehouse_ids) end)
),
cost_own as (
  select wid, sum(amount) as amount, sum(amount) filter (where is_labor) as labor
  from cost_raw where wid is not null group by wid
),
cost_shared as (
  select coalesce(sum(amount), 0) as amount, coalesce(sum(amount) filter (where is_labor), 0) as labor
  from cost_raw where wid is null
),
-- Tháng NÀO đã có chi phí (bất kể kho nào) — để đếm tháng có hàng mà chưa khai đồng nào
cost_mon as (
  select mon from cost_raw where amount > 0 group by mon
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
      'cost',            round(coalesce(sum(r.cost_own), 0)::numeric + coalesce((select amount from cost_shared), 0)::numeric, 0),
      'cost_labor',      round(coalesce(sum(r.cost_labor_own), 0)::numeric + coalesce((select labor from cost_shared), 0)::numeric, 0),
      'warehouses_no_labor', coalesce(count(*) filter (where r.work_days = 0 and (r.tons_in + r.tons_out) > 0), 0),
      'warehouses_no_cost',  coalesce(count(*) filter (where r.cost_own = 0 and (r.tons_in + r.tons_out) > 0), 0),
      -- Tháng CÓ HÀNG mà chưa khai chi phí — không có nó thì "chi phí/tấn" của kỳ nhiều tháng
      -- đọc ra rẻ giả tạo (tử số 1 tháng ÷ mẫu số 12 tháng), xem ghi chú đầu file
      'months_total',   (select count(*) from per_mon),
      'months_no_cost', (select count(*) from per_mon p
                         where (p.tons_in + p.tons_out) > 0
                           and not exists (select 1 from cost_mon cm where cm.mon = p.month))
    ) from per_wh r)
);
$function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260827f_cost_vouchers.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260827f — CHI PHÍ KHO NHÌN THEO "PHIẾU" (user chốt 27/08 vòng 2):
--   "tháng 8 sẽ có 1 kỳ, mở nó ra thì có thể add/edit các khoản chi phí … 1 kho sẽ có chi phí của
--    1 Phiếu … nhưng khi cần xem 1 loại chi phí thì có thể xem được hết tất cả các tháng với filter"
--
-- PHIẾU = (Kho × Kỳ tháng) — KHÔNG thêm bảng: phiếu là NHÓM dẫn xuất của các dòng đã có, và trạng
-- thái chốt vốn đã nằm ở `warehouse_cost_locks` đúng cặp (kho, kỳ). Đẻ thêm bảng "phiếu" chỉ tạo
-- đường cho hai nguồn sự thật lệch nhau (phiếu tồn tại mà không dòng nào, hoặc ngược lại).
--
-- Vì sao RPC chứ không gom nhóm ở backend: danh sách phiếu cần COUNT + SUM + phân trang + tổng
-- trên TOÀN bộ tập lọc. Kéo dòng thô về Node để tự cộng là đúng cái CLAUDE.md cấm ("đừng KÉO DÒNG
-- để tính ra một TẬP"): 153 kho × 9 khoản mục × 12 tháng ≈ 16.5k dòng qua PostgREST cho một bảng
-- 50 dòng. Đếm trong SQL = 1 round-trip, số dòng về bị chặn bởi SỐ PHIẾU của trang.
CREATE OR REPLACE FUNCTION public.warehouse_cost_vouchers(
  p_from         date,
  p_to           date,
  p_wh_ids       text[] DEFAULT NULL,   -- scope kho của user; NULL = không giới hạn (thấy cả chi phí CHUNG)
  p_warehouse_id text   DEFAULT NULL,   -- bộ lọc trên màn: id kho | '__shared__' | NULL = tất cả
  p_search       text   DEFAULT NULL,
  p_page         int    DEFAULT 1,
  p_page_size    int    DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_lim int  := least(200, greatest(10, coalesce(p_page_size, 50)));
  v_off int  := greatest(0, (greatest(1, coalesce(p_page, 1)) - 1) * v_lim);
  v_kw  text := nullif(btrim(coalesce(p_search, '')), '');
BEGIN
  RETURN (
    WITH lab AS (
      SELECT value AS code, coalesce((meta->>'is_labor')::boolean, false) AS is_labor
      FROM public."LookupValue" WHERE type = 'cost_item'
    ),
    src AS (
      SELECT c.warehouse_id, c.period, c.cost_item, c.amount, c.updated_at, c.updated_by
      FROM public.warehouse_costs c
      WHERE c.period BETWEEN p_from AND p_to
        -- Scope kho: người bị giới hạn kho KHÔNG thấy dòng chi phí CHUNG (cùng luật với sổ dòng)
        AND (p_wh_ids IS NULL OR c.warehouse_id = ANY(p_wh_ids))
        AND (p_warehouse_id IS NULL
             OR (p_warehouse_id = '__shared__' AND c.warehouse_id IS NULL)
             OR c.warehouse_id = p_warehouse_id)
    ),
    agg AS (
      SELECT s.warehouse_id, s.period,
             count(*)::int                                          AS lines,
             sum(s.amount)                                          AS amount,
             sum(CASE WHEN l.is_labor THEN s.amount ELSE 0 END)     AS labor,
             max(s.updated_at)                                      AS updated_at
      FROM src s LEFT JOIN lab l ON l.code = s.cost_item
      GROUP BY s.warehouse_id, s.period
    ),
    named AS (
      SELECT a.warehouse_id, a.period, a.lines, a.amount, a.labor, a.updated_at,
             coalesce(w.name, CASE WHEN a.warehouse_id IS NULL
                                   THEN 'Chi phí chung (toàn công ty)' ELSE '(kho đã xoá)' END) AS warehouse_name,
             (SELECT s2.updated_by FROM src s2
               WHERE s2.warehouse_id IS NOT DISTINCT FROM a.warehouse_id AND s2.period = a.period
               ORDER BY s2.updated_at DESC NULLS LAST LIMIT 1)                                  AS updated_by,
             EXISTS (SELECT 1 FROM public.warehouse_cost_locks k
                      WHERE k.period = a.period
                        AND coalesce(k.warehouse_id, '*') = coalesce(a.warehouse_id, '*'))      AS locked
      FROM agg a LEFT JOIN public."Warehouse" w ON w.id = a.warehouse_id
    ),
    filt AS (
      SELECT * FROM named WHERE v_kw IS NULL OR warehouse_name ILIKE '%' || v_kw || '%'
    ),
    page AS (
      SELECT * FROM filt ORDER BY period DESC, warehouse_name LIMIT v_lim OFFSET v_off
    )
    SELECT jsonb_build_object(
      'rows',   coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.period DESC, p.warehouse_name) FROM page p), '[]'::jsonb),
      'total',  (SELECT count(*) FROM filt),
      'totals', (SELECT jsonb_build_object(
                   'amount',   coalesce(sum(amount), 0),
                   'labor',    coalesce(sum(labor), 0),
                   'lines',    coalesce(sum(lines), 0),
                   'vouchers', count(*)
                 ) FROM filt)
    )
  );
END;
$$;

-- Danh sách phiếu lọc theo khoảng kỳ + kho ⇒ index đúng shape của WHERE/GROUP BY
CREATE INDEX IF NOT EXISTS idx_warehouse_costs_period_wh
  ON public.warehouse_costs (period, warehouse_id);



-- ─────────────────────────────────────────────────────────────────────────
-- [20260828_outbound_qty_reduced.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- GHI VẾT KHI HẠ SỐ LƯỢNG ĐƠN XUẤT (28/08)
--
-- Vì sao cần: luật hiện hành "xuất thiếu thì hạ SL đơn = thực xuất mới cho Hoàn thành" khiến dữ
-- liệu sau khi hoàn thành LUÔN nói giao đủ 100% (đo staging: 24.459/24.459 dòng COMPLETED khớp
-- tuyệt đối, 0 dòng lệch). Tức là app đang XOÁ DẤU VẾT của chính chỉ số quan trọng nhất chuỗi
-- cung ứng — fill rate / OTIF. Không có vết thì không đo được, không đo được thì không cải thiện.
--
-- Vì sao TRIGGER chứ không phải ghi trong controller: `cartons_ordered` bị hạ qua NHIỀU đường —
-- sửa đơn (2 nhánh multi-DO / single-DO trong updateGDO), SAP dội xuống khi sửa DO ở tab DO SAP,
-- và script vá dữ liệu. Ghi ở tầng ứng dụng thì mỗi đường mới mở ra là một lỗ hổng lặng lẽ; chặn
-- ở DB thì KHÔNG đường nào lách được (luật "bug chết hai lần" — đây là ràng buộc máy móc).
--
-- Phân loại ngay trong trigger để báo cáo chỉ việc gom theo event_type, không phải bóc chuỗi:
--   QTY_REDUCED_TO_ACTUAL — hạ đúng bằng số đã xuất  ⇒ GIAO THIẾU (cái ta cần đo)
--   QTY_REDUCED_PLAN      — hạ khi chưa xuất dòng nào ⇒ cắt kế hoạch, không phải lỗi phục vụ
--   QTY_REDUCED           — còn lại (hạ một phần khi đang xuất dở)
--
-- Hạn chế đã biết: trigger không biết AI thao tác (backend gọi bằng service_role, không mang danh
-- tính người dùng xuống DB) nên `actor` để trống; người gần đúng nhất là `GroupDeliveryOrder.
-- updated_by` tại thời điểm đó. Đổi lại là không bao giờ sót — đánh đổi có chủ đích.

CREATE OR REPLACE FUNCTION public.log_outbound_qty_reduced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_gdo_id text; v_group text; v_do text; v_scanned numeric; v_type text;
BEGIN
  IF NEW.cartons_ordered IS NULL OR OLD.cartons_ordered IS NULL THEN RETURN NEW; END IF;
  IF NEW.cartons_ordered >= OLD.cartons_ordered THEN RETURN NEW; END IF;

  v_scanned := COALESCE(NEW.cartons_scanned, 0);
  v_type := CASE
    WHEN v_scanned > 0 AND NEW.cartons_ordered = v_scanned THEN 'QTY_REDUCED_TO_ACTUAL'
    WHEN v_scanned = 0                                     THEN 'QTY_REDUCED_PLAN'
    ELSE 'QTY_REDUCED' END;

  SELECT d.gdo_id, g.group_code, d.delivery_code
    INTO v_gdo_id, v_group, v_do
  FROM "OutboundDelivery" d
  LEFT JOIN "GroupDeliveryOrder" g ON g.id = d.gdo_id
  WHERE d.id = NEW.do_id;

  INSERT INTO outbound_events
    (id, gdo_id, group_code, event_type, source, actor, do_number, material_code,
     old_value, new_value, detail, created_at, updated_at)
  VALUES
    (gen_random_uuid()::text, v_gdo_id, COALESCE(v_group, '?'), v_type, 'WMS', NULL,
     v_do, NEW.material_code_raw,
     OLD.cartons_ordered::text, NEW.cartons_ordered::text,
     format('Hạ SL đơn %s → %s (đã xuất %s)', OLD.cartons_ordered, NEW.cartons_ordered, v_scanned),
     now(), now());

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_outbound_qty_reduced ON public."OutboundItem";
CREATE TRIGGER trg_outbound_qty_reduced
  AFTER UPDATE OF cartons_ordered ON public."OutboundItem"
  FOR EACH ROW EXECUTE FUNCTION public.log_outbound_qty_reduced();

-- Báo cáo fill rate lọc theo (event_type, thời gian) và gom theo chuyến
CREATE INDEX IF NOT EXISTS idx_outbound_events_type_time
  ON public.outbound_events (event_type, created_at DESC);



-- ─────────────────────────────────────────────────────────────────────────
-- [20260828b_lot_trace.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- TRUY XUẤT LÔ HAI CHIỀU (28/08)
--
-- Câu hỏi phải trả lời được trong vài giây, không cần người biết SQL:
--   xuôi:  "lô/mã hàng/ngày SX này đã đi tới NPP nào, xe nào, ngày nào — còn bao nhiêu trong kho"
--   ngược: "NPP / chuyến / biển số này đã nhận những lô nào"
-- Với ngành thực phẩm, diễn tập thu hồi thường phải trả lời trong 2–4 giờ; trước bản này làm được
-- nhưng phải nhờ người viết SQL, và đo thật mất 1.839ms trên 40k dòng vì QUÉT TOÀN BẢNG.
--
-- Nút thắt đo được: `OutboundScanEntry` KHÔNG có index trên `pallet_code` — mà đó chính là khớp
-- nối giữa "pallet nào" và "đi đâu". Thiếu nó thì mọi truy xuất đều Seq Scan trên bảng giao dịch
-- lớn nhất app.

-- ── 1) Index cho đường truy xuất ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ose_pallet_code
  ON public."OutboundScanEntry" (pallet_code);

-- Tìm theo TIỀN TỐ mã pallet (`LIKE '190726%'` — ngày SX + mã hàng nằm ngay đầu mã V1). Btree
-- collation mặc định KHÔNG phục vụ được LIKE prefix, phải có text_pattern_ops.
CREATE INDEX IF NOT EXISTS idx_inventory_pallet_prefix
  ON public."InventoryEntry" (pallet_code text_pattern_ops);

-- Truy xuất theo mã hàng + ngày sản xuất (ca thu hồi kinh điển: "lô SX ngày 19/07 của mã X")
CREATE INDEX IF NOT EXISTS idx_ie_mat_proddate
  ON public."InventoryEntry" (material_id, production_date);

-- ── 2) RPC truy xuất ───────────────────────────────────────────────────────────────────────────
-- MỘT lời gọi trả đủ: danh sách giao + tồn còn lại + ô tổng. Không trả id để backend nạp lại
-- (trả id biến 1 request thành 1 + n/300 — luật round-trip trong CLAUDE.md).
--
-- Hai khoảng ngày TÁCH BẠCH, cố ý: `prod_*` lọc NGÀY SẢN XUẤT (dùng khi truy từ lô hàng),
-- `ship_*` lọc NGÀY GIAO (dùng khi truy từ khách hàng). Gộp một khoảng ngày cho cả hai nghĩa là
-- cách chắc chắn làm người đọc hiểu sai kết quả thu hồi.
--
-- ⚠️ Vì sao SQL ĐỘNG chứ không phải câu tĩnh với `(tham_số IS NULL OR cột = ANY(tham_số))`:
-- mẫu OR-NULL đó làm planner KHÔNG dùng được index, cộng thêm plpgsql cache một kế hoạch CHUNG
-- cho mọi tham số. Đo thật trên staging: bản tĩnh chiều ngược 999ms → bỏ OR-NULL còn 489ms →
-- SQL động chỉ ghép điều kiện thực sự có. Giá trị đi qua `%L` nên vẫn được trích dẫn an toàn.
CREATE OR REPLACE FUNCTION public.lot_trace(
  p_kind        text,                      -- pallet | material | batch | npp | trip | plate
  p_value       text,
  p_prod_from   date DEFAULT NULL, p_prod_to date DEFAULT NULL,
  p_ship_from   date DEFAULT NULL, p_ship_to date DEFAULT NULL,
  p_wh_ids      text[] DEFAULT NULL,       -- scope kho của người gọi (NULL = toàn bộ)
  p_categories  text[] DEFAULT NULL,       -- scope loại hàng (null-inclusive như toàn app)
  p_limit       int DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_val    text := btrim(coalesce(p_value, ''));
  v_codes  text[];
  v_lim    int  := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_ship   jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_nship  int := 0; v_nstock int := 0; v_ncust int := 0; v_ntrip int := 0;
  v_qship  numeric := 0; v_qhand numeric := 0;
  v_where  text;
  v_scope_ship text := '';   -- điều kiện trên chuyến (kho + ngày giao)
  v_scope_stk  text := '';   -- điều kiện trên tồn (kho + loại hàng)
  v_empty  jsonb := jsonb_build_object('codes', 0, 'shipments', '[]'::jsonb, 'stock', '[]'::jsonb,
                                       'summary', jsonb_build_object('pallets', 0, 'shipments', 0,
                                       'stock_rows', 0, 'customers', 0, 'trips', 0,
                                       'qty_shipped', 0, 'qty_on_hand', 0, 'truncated', false));
BEGIN
  IF v_val = '' OR p_kind IS NULL THEN RETURN v_empty; END IF;

  IF p_wh_ids   IS NOT NULL THEN
    v_scope_ship := v_scope_ship || format(' AND g.warehouse_id = ANY(%L::text[])', p_wh_ids);
    v_scope_stk  := v_scope_stk  || format(' AND ie.warehouse_id = ANY(%L::text[])', p_wh_ids);
  END IF;
  IF p_ship_from IS NOT NULL THEN v_scope_ship := v_scope_ship || format(' AND g.delivery_date >= %L', p_ship_from); END IF;
  IF p_ship_to   IS NOT NULL THEN v_scope_ship := v_scope_ship || format(' AND g.delivery_date <= %L', p_ship_to);   END IF;
  IF p_categories IS NOT NULL THEN
    v_scope_stk := v_scope_stk || format(' AND (m.category IS NULL OR m.category = ANY(%L::text[]))', p_categories);
  END IF;

  -- (a) Quy mọi kiểu tìm về MỘT TẬP MÃ PALLET — sau đó hai chiều dùng chung một đường đi.
  IF p_kind IN ('npp', 'trip', 'plate') THEN
    v_where := CASE p_kind
      WHEN 'npp'   THEN format('d.distributor_name ILIKE %L', '%' || v_val || '%')
      WHEN 'trip'  THEN format('g.group_code = %L', v_val)
      ELSE format('upper(regexp_replace(coalesce(g.license_plate, %L), %L, %L, %L)) = %L',
                  '', '[^A-Za-z0-9]', '', 'g', upper(regexp_replace(v_val, '[^A-Za-z0-9]', '', 'g')))
    END;
    EXECUTE
      'SELECT array_agg(DISTINCT e.pallet_code)
         FROM "OutboundDelivery" d
         JOIN "GroupDeliveryOrder" g ON g.id = d.gdo_id
         JOIN "OutboundItem" oi      ON oi.do_id = d.id
         JOIN "OutboundScanEntry" e  ON e.item_id = oi.id
        WHERE ' || v_where || v_scope_ship
      INTO v_codes;
  ELSE
    v_where := CASE p_kind
      WHEN 'pallet'   THEN format('ie.pallet_code LIKE %L', v_val || '%')
      WHEN 'batch'    THEN format('ie.batch = %L', v_val)
      WHEN 'material' THEN format('m.material_code = %L', v_val)
      ELSE NULL END;
    IF v_where IS NULL THEN RETURN v_empty; END IF;
    IF p_prod_from IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date >= %L', p_prod_from); END IF;
    IF p_prod_to   IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date <= %L', p_prod_to);   END IF;
    EXECUTE
      'SELECT array_agg(DISTINCT ie.pallet_code)
         FROM "InventoryEntry" ie
         LEFT JOIN "Material" m ON m.id = ie.material_id
        WHERE ' || v_where || v_scope_stk
      INTO v_codes;
  END IF;

  IF v_codes IS NULL OR array_length(v_codes, 1) IS NULL THEN RETURN v_empty; END IF;

  -- (b) ĐÃ GIAO ĐI ĐÂU — nối qua chính dòng tồn được quét (inventory_entry_id), không dò lại theo
  --     mã pallet: cùng một mã pallet có thể tồn tại ở kho gửi VÀ kho nhận sau khi chuyển kho.
  --     Join `unnest(mảng)` chứ KHÔNG `= ANY(mảng)`: với mảng vài trăm phần tử, `= ANY` làm planner
  --     bỏ index (đo: 110ms → gần 1 giây).
  -- ⚠️ Ô tổng cộng trên TOÀN BỘ kết quả, không phải trên trang đã cắt.
  EXECUTE
    'WITH s AS (
       SELECT e.pallet_code, e.cartons_scanned, e.scanned_at, e.pct_date,
              ie.production_date, ie.expiry_date, ie.batch,
              coalesce(m.material_code, oi.material_code_raw) AS material_code, m.short_name,
              g.group_code, g.delivery_date, g.license_plate, g.status AS trip_status,
              d.delivery_code, d.distributor_name, w.name AS warehouse_name
         FROM unnest($1::text[]) AS pc(code)
         JOIN "OutboundScanEntry" e  ON e.pallet_code = pc.code
         JOIN "OutboundItem" oi      ON oi.id = e.item_id
         JOIN "OutboundDelivery" d   ON d.id  = oi.do_id
         JOIN "GroupDeliveryOrder" g ON g.id  = d.gdo_id
         LEFT JOIN "InventoryEntry" ie ON ie.id = e.inventory_entry_id
         LEFT JOIN "Material" m        ON m.id  = coalesce(ie.material_id, oi.material_id)
         LEFT JOIN "Warehouse" w       ON w.id  = g.warehouse_id
        WHERE true' || v_scope_ship || '
     ), t AS (SELECT s.*, row_number() OVER (ORDER BY s.scanned_at DESC NULLS LAST) rn FROM s)
     SELECT count(*)::int, coalesce(sum(t.cartons_scanned), 0),
            count(DISTINCT t.distributor_name)::int, count(DISTINCT t.group_code)::int,
            coalesce(jsonb_agg(to_jsonb(t) - ''rn'' ORDER BY t.scanned_at DESC NULLS LAST)
                     FILTER (WHERE t.rn <= $2), ''[]''::jsonb)
       FROM t'
    INTO v_nship, v_qship, v_ncust, v_ntrip, v_ship
    USING v_codes, v_lim;

  -- (c) CÒN TRONG KHO — phần chưa đi, để biết thu hồi được bao nhiêu tại chỗ
  EXECUTE
    'WITH k AS (
       SELECT ie.pallet_code, ie.cartons_remaining, ie.status, ie.production_date, ie.expiry_date,
              ie.batch, ie.import_date, m.material_code, m.short_name,
              w.name AS warehouse_name, l.location_code
         FROM unnest($1::text[]) AS pc(code)
         JOIN "InventoryEntry" ie ON ie.pallet_code = pc.code
         LEFT JOIN "Material" m  ON m.id = ie.material_id
         LEFT JOIN "Warehouse" w ON w.id = ie.warehouse_id
         LEFT JOIN "Location" l  ON l.id = ie.location_id
        WHERE ie.cartons_remaining > 0' || v_scope_stk || '
     ), t AS (SELECT k.*, row_number() OVER (ORDER BY k.pallet_code) rn FROM k)
     SELECT count(*)::int, coalesce(sum(t.cartons_remaining), 0),
            coalesce(jsonb_agg(to_jsonb(t) - ''rn'' ORDER BY t.pallet_code)
                     FILTER (WHERE t.rn <= $2), ''[]''::jsonb)
       FROM t'
    INTO v_nstock, v_qhand, v_stock
    USING v_codes, v_lim;

  RETURN jsonb_build_object(
    'codes', array_length(v_codes, 1), 'shipments', v_ship, 'stock', v_stock,
    'summary', jsonb_build_object(
      'pallets', array_length(v_codes, 1), 'shipments', v_nship, 'stock_rows', v_nstock,
      'customers', v_ncust, 'trips', v_ntrip, 'qty_shipped', v_qship, 'qty_on_hand', v_qhand,
      'truncated', (v_nship > v_lim OR v_nstock > v_lim)));
END $fn$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260828c_receipt_rating.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ĐÁNH GIÁ SAO CHUYẾN GIAO — kho nhận chấm khi xác nhận đơn (28/08, user chốt)
--
-- Vì sao cần: fill rate đo được "giao đủ hay thiếu" nhưng KHÔNG đo được "giao có tử tế không" —
-- hàng móp, chứng từ thiếu, xe tới trễ, xếp hàng lộn xộn. Người duy nhất biết những thứ đó là
-- NGƯỜI NHẬN, và họ chỉ nói ra nếu việc chấm nằm ngay trong luồng họ đang làm (lúc xác nhận đơn).
--
-- Phạm vi: chỉ những chuyến mà kho nhận THỰC SỰ vào xác nhận (chuyển kho, kho nhận chế độ QR/QTY).
-- Chuyến giao khách ngoài hoặc kho nhận NONE (tài xế tự hoàn thành) không có ai để chấm.
--
-- 1 chuyến = 1 đánh giá (unique gdo_id): chấm lại là SỬA, không đẻ dòng mới — nếu không, trung
-- bình sao sẽ bị người bấm nhiều lần kéo lệch.
--
-- LÝ DO theo DANH SÁCH CỐ ĐỊNH, không gõ tự do — cùng bài học với lý do vượt luân chuyển (14/08):
-- gõ tự do thì mỗi người viết một kiểu, cuối quý không gom nhóm được nguyên nhân nào ra nguyên
-- nhân nào. Ghi chú tự do vẫn có, nhưng nằm ở cột riêng.

CREATE TABLE IF NOT EXISTS public.receipt_ratings (
  id                text PRIMARY KEY,
  gdo_id            text NOT NULL,
  tms_order_id      text,
  from_warehouse_id text,                    -- kho gửi (bị chấm)
  to_warehouse_id   text,                    -- kho nhận (người chấm)
  stars             int  NOT NULL CHECK (stars BETWEEN 1 AND 5),
  reason_code       text CHECK (reason_code IS NULL OR reason_code IN
                      ('SHORT', 'WRONG', 'DAMAGED', 'LATE', 'DOC', 'OTHER')),
  note              text,
  rated_by          text,
  rated_by_name     text,
  rated_at          timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Chấm thấp thì PHẢI nêu lý do — chấm 2 sao mà không nói vì sao thì kho gửi không sửa được gì.
  CONSTRAINT receipt_rating_reason_when_low CHECK (stars >= 4 OR reason_code IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_rating_gdo ON public.receipt_ratings (gdo_id);
CREATE INDEX IF NOT EXISTS idx_receipt_rating_from ON public.receipt_ratings (from_warehouse_id, rated_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipt_rating_to   ON public.receipt_ratings (to_warehouse_id, rated_at DESC);

-- Realtime: bảng mới phải vào publication, nếu không màn hình người khác không tự cập nhật
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'receipt_ratings') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.receipt_ratings';
  END IF;
END $$;

-- RLS: đóng anon như mọi bảng nghiệp vụ; backend đi bằng service_role nên không cần policy ghi.
-- Nhưng PHẢI có policy SELECT cho authenticated, nếu không realtime chết câm (bài học 06/08).
ALTER TABLE public.receipt_ratings ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'receipt_ratings' AND policyname = 'receipt_ratings_read') THEN
    EXECUTE 'CREATE POLICY receipt_ratings_read ON public.receipt_ratings FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260828d_service_level.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- CHẤT LƯỢNG PHỤC VỤ: giao ĐỦ và giao ĐÚNG HẠN (28/08)
--
-- App đang đo rất kỹ sản lượng, năng suất, chi phí — toàn chỉ số NỘI BỘ — mà không đo cái KHÁCH
-- HÀNG nhìn thấy. Đây là chỉ số số 1 của một chuỗi cung ứng.
--
-- ⚠️ NHU CẦU GỐC lấy ở đâu: luật "xuất thiếu thì hạ SL đơn = thực xuất" khiến `cartons_ordered`
-- SAU khi hoàn thành luôn bằng thực xuất. Nên nhu cầu gốc = số hiện tại + Σ mức đã bị hạ, lấy từ
-- sổ sự kiện do trigger `trg_outbound_qty_reduced` ghi (migration 20260828). Suy ra:
--   · dữ liệu TRƯỚC ngày bật trigger không có vết ⇒ luôn hiện 100% giao đủ. Màn hình PHẢI nói rõ
--     điều đó, không thì người đọc tưởng kho hoàn hảo.
--   · QTY_REDUCED_PLAN (cắt kế hoạch khi CHƯA lấy hàng) KHÔNG tính là giao thiếu — đó là khách
--     đổi ý/kế hoạch đổi, không phải kho phục vụ kém.
--
-- Đúng hạn: so ngày HOÀN THÀNH (giờ VN) với NGÀY XUẤT theo kế hoạch của chuyến.
CREATE OR REPLACE FUNCTION public.service_level(
  p_from       date,
  p_to         date,
  p_wh_ids     text[] DEFAULT NULL,
  p_limit      int DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE v_out jsonb; v_lim int := least(greatest(coalesce(p_limit, 20), 5), 100);
BEGIN
  WITH trips AS (
    SELECT g.id, g.group_code, g.warehouse_id, g.delivery_date, g.completed_at,
           w.name AS warehouse_name,
           (g.completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= g.delivery_date AS on_time
      FROM "GroupDeliveryOrder" g
      LEFT JOIN "Warehouse" w ON w.id = g.warehouse_id
     WHERE g.status = 'COMPLETED'
       AND g.delivery_date BETWEEN p_from AND p_to
       AND (p_wh_ids IS NULL OR g.warehouse_id = ANY(p_wh_ids))
  ),
  -- Mức đã bị hạ, gom theo (chuyến, mã hàng). Chỉ tính lần hạ có liên quan tới việc ĐÃ LẤY HÀNG.
  red AS (
    SELECT e.group_code, e.material_code,
           sum(e.old_value::numeric - e.new_value::numeric) AS cut
      FROM outbound_events e
     WHERE e.event_type IN ('QTY_REDUCED_TO_ACTUAL', 'QTY_REDUCED')
       AND e.old_value ~ '^[0-9.]+$' AND e.new_value ~ '^[0-9.]+$'
     GROUP BY 1, 2
  ),
  lines AS (
    SELECT t.id AS trip_id, t.group_code, t.warehouse_id, t.warehouse_name, t.on_time,
           d.distributor_name, oi.material_code_raw AS material_code,
           coalesce(oi.cartons_scanned, 0)::numeric AS shipped,
           oi.cartons_ordered::numeric + coalesce(r.cut, 0) AS demand
      FROM trips t
      JOIN "OutboundDelivery" d ON d.gdo_id = t.id
      JOIN "OutboundItem" oi    ON oi.do_id = d.id
      LEFT JOIN red r ON r.group_code = t.group_code AND r.material_code = oi.material_code_raw
  ),
  by_trip AS (
    SELECT trip_id, group_code, warehouse_id, warehouse_name, on_time,
           sum(demand) AS demand, sum(shipped) AS shipped,
           bool_and(shipped >= demand) AS in_full
      FROM lines GROUP BY 1, 2, 3, 4, 5
  )
  SELECT jsonb_build_object(
    'summary', (
      SELECT jsonb_build_object(
        'trips',        count(*),
        'lines',        (SELECT count(*) FROM lines),
        'lines_short',  (SELECT count(*) FROM lines WHERE shipped < demand),
        'demand',       coalesce((SELECT sum(demand)  FROM lines), 0),
        'shipped',      coalesce((SELECT sum(shipped) FROM lines), 0),
        'fill_rate',    CASE WHEN coalesce((SELECT sum(demand) FROM lines), 0) > 0
                             THEN round(100.0 * (SELECT sum(shipped) FROM lines) / (SELECT sum(demand) FROM lines), 1)
                             ELSE NULL END,
        'on_time_pct',  CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE on_time), 1) / count(*) ELSE NULL END,
        'in_full_pct',  CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE in_full), 1) / count(*) ELSE NULL END,
        'otif_pct',     CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE on_time AND in_full), 1) / count(*) ELSE NULL END,
        -- Sao trung bình của các chuyến giao trong kỳ (kho nhận chấm lúc xác nhận đơn)
        'avg_stars',    (SELECT round(avg(rr.stars)::numeric, 2) FROM receipt_ratings rr
                          JOIN trips t2 ON t2.id = rr.gdo_id),
        'rated_trips',  (SELECT count(*) FROM receipt_ratings rr JOIN trips t2 ON t2.id = rr.gdo_id),
        -- Chuyến THUỘC DIỆN CHẤM = chuyển kho mà kho nhận có TÍCH NHẬN. Kho nhận không tích nhận
        -- (`delivery_mode='SELF'`, tài xế tự hoàn thành) và chuyến giao khách ngoài thì KHÔNG ai
        -- mở hàng ra xem trong app ⇒ không có người chấm. Phải tách con số này ra, nếu không mẫu
        -- số là "mọi chuyến" và tỷ lệ phủ trông như kho lười chấm (đo staging: 30/33 chuyến
        -- chuyển kho là SELF).
        'ratable_trips', (SELECT count(*) FROM trips t3
                           WHERE EXISTS (SELECT 1 FROM "TmsOrder" o
                                          WHERE o.transfer_gdo_id = t3.id
                                            AND coalesce(o.delivery_mode, '') <> 'SELF'))
      ) FROM by_trip
    ),
    'by_warehouse', coalesce((
      SELECT jsonb_agg(x ORDER BY (x->>'trips')::int DESC) FROM (
        SELECT jsonb_build_object(
          'warehouse_id', warehouse_id, 'warehouse_name', coalesce(warehouse_name, '(không rõ)'),
          'trips', count(*), 'on_time_pct', round(100.0 * count(*) FILTER (WHERE on_time), 1) / count(*),
          'in_full_pct', round(100.0 * count(*) FILTER (WHERE in_full), 1) / count(*),
          'demand', sum(demand), 'shipped', sum(shipped),
          'fill_rate', CASE WHEN sum(demand) > 0 THEN round(100.0 * sum(shipped) / sum(demand), 1) ELSE NULL END
        ) x
        FROM by_trip GROUP BY warehouse_id, warehouse_name
      ) s), '[]'::jsonb),
    -- Mã hàng giao thiếu nhiều nhất — chỗ để đi tìm nguyên nhân (hết tồn? nhặt sót? kế hoạch ảo?)
    'top_short', coalesce((
      SELECT jsonb_agg(x ORDER BY (x->>'missing')::numeric DESC) FROM (
        SELECT jsonb_build_object(
          'material_code', material_code, 'lines', count(*),
          'missing', sum(demand - shipped), 'demand', sum(demand)
        ) x
        FROM lines WHERE shipped < demand
        GROUP BY material_code ORDER BY sum(demand - shipped) DESC LIMIT v_lim
      ) s), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $fn$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260829_monitor_cache.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260829 — CACHE cho 2 màn GIÁM SÁT nặng nhất: Giám sát vận hành + Slotting.
--
-- VÌ SAO (đo 29/08, diễn tập 100 người dùng ở Kho Ba Vì + Kho Bàu Bàng):
--   Chỉ 3 endpoint gãy dưới tải, lặp lại y nhau qua mọi lượt đo — `/wms/control-tower`,
--   `/wms/slotting`, `/wms/outbound/scan-log` — đều 500 vì `canceling statement due to statement
--   timeout` (đọc thẳng từ bảng error_logs: 67 + 67 + 35 dòng chỉ trong 3 giờ chạy tải).
--   Mọi màn còn lại chịu được 28 người xem đồng thời.
--
-- ĐÃ LOẠI TRỪ mấy hướng SAI — đừng đi lại:
--   · Không phải app phí round-trip: đo bằng pg_stat_statements (lọc role service_role, so từng
--     queryid lấy delta dương) → mỗi màn chỉ 1–3 request PostgREST. Đã gọn.
--   · Không phải máy DB yếu: chạy THẲNG vào Postgres, 8 người đồng thời thì control_tower_stats
--     1,0s · slotting_stats 1,7s — cách xa trần 8s.
--   · Không phải staging nhỏ hơn production: so pg_settings hai bên NGÀY 29/08 thì GIỐNG HỆT
--     (shared_buffers 224MB · work_mem 2MB · max_connections 60 · 2 parallel worker). Ngưỡng đo
--     được ở staging CHÍNH LÀ ngưỡng của production.
--   ⇒ Chúng gãy vì DB bão hoà bởi TOÀN BỘ mix nhiều màn cùng lúc, và 2 câu nặng nhất chạm trần
--     trước. Cách duy nhất có tác dụng (giống hệt bài học Dashboard 21/08): ĐỪNG chạy tổng hợp
--     nặng trong MỌI request.
--
-- Vì sao KHÔNG cache `/wms/outbound/scan-log`: mỗi người một bộ lọc riêng ⇒ cache phân mảnh vô
-- ích. Màn đó xử bằng index (migration riêng), và nay ít nhất đã trả 503 tử tế thay vì 500.

-- Dùng lại bảng cache của Dashboard: một bảng, một đường dọn lười, không đẻ thêm chỗ phải nhớ.
COMMENT ON TABLE public.dashboard_cache IS
  'Cache dùng chung cho các RPC tổng hợp nặng (Dashboard · Giám sát vận hành · Slotting). '
  'Khoá = md5 của ĐÚNG bộ tham số. Chỉ service_role đọc/ghi (RLS bật, không policy).';

-- ── Lõi dùng chung: đọc cache còn tươi, hết hạn thì CHỈ MỘT phiên được tính ────────────────────
-- CHỐNG GIẪM ĐẠP (điều mà bản cache Dashboard 21/08 còn thiếu): TTL thuần vẫn để N người cùng
-- MISS thì cả N cùng tính lại — đúng cảnh đầu ca ai cũng mở app một lượt, tức là cache vô dụng
-- đúng lúc cần nhất. Nay: ai giành được advisory lock thì tính; người còn lại DÙNG SỐ CŨ nếu có
-- (thà số cũ 1 phút còn hơn màn hình trắng), không có số cũ thì XẾP HÀNG chờ người kia tính xong
-- rồi đọc cache — không ai tính trùng.
CREATE OR REPLACE FUNCTION public.cache_fetch(p_key text, p_ttl_seconds int)
RETURNS TABLE(payload jsonb, fresh boolean, mine boolean)
LANGUAGE plpgsql
AS $$
DECLARE v_hit jsonb; v_stale jsonb;
BEGIN
  SELECT c.payload INTO v_hit FROM public.dashboard_cache c
   WHERE c.key = p_key AND c.computed_at > now() - make_interval(secs => p_ttl_seconds);
  IF v_hit IS NOT NULL THEN RETURN QUERY SELECT v_hit, true, false; RETURN; END IF;

  IF pg_try_advisory_xact_lock(hashtext(p_key)) THEN
    RETURN QUERY SELECT NULL::jsonb, false, true; RETURN;      -- mình tính
  END IF;

  SELECT c.payload INTO v_stale FROM public.dashboard_cache c WHERE c.key = p_key;
  IF v_stale IS NOT NULL THEN RETURN QUERY SELECT v_stale, false, false; RETURN; END IF;

  -- Chưa từng có số: chờ người đang tính (khoá nhả khi transaction của họ kết thúc) rồi đọc lại.
  PERFORM pg_advisory_xact_lock(hashtext(p_key));
  SELECT c.payload INTO v_hit FROM public.dashboard_cache c WHERE c.key = p_key;
  RETURN QUERY SELECT v_hit, v_hit IS NOT NULL, v_hit IS NULL;
END $$;

CREATE OR REPLACE FUNCTION public.cache_store(p_key text, p_payload jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.dashboard_cache(key, payload, computed_at) VALUES (p_key, p_payload, now())
  ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;
  -- Dọn lười: khoá gắn NGÀY nên mỗi ngày sinh bộ khoá mới. Chỉ chạy ở nhánh MISS.
  DELETE FROM public.dashboard_cache WHERE computed_at < now() - interval '2 days';
END $$;

-- Khoá cache: SẮP mảng trước khi ghép để 2 người cùng phạm vi nhưng khác thứ tự id vẫn CHUNG một
-- dòng cache (không thì cache phân mảnh vô ích).
CREATE OR REPLACE FUNCTION public.cache_key_part(p_arr text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p_arr) x), '*')
$$;

-- ── Giám sát vận hành ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.control_tower_stats_cached(
  p_warehouse_ids  text[],
  p_categories     text[],
  p_today          date,
  p_material_codes text[],
  p_ttl_seconds    int DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_key text; r record; v_calc jsonb;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RETURN control_tower_stats(p_warehouse_ids, p_categories, p_today, p_material_codes);
  END IF;
  v_key := md5('ct|' || cache_key_part(p_warehouse_ids) || '|' || cache_key_part(p_categories)
            || '|' || coalesce(p_today::text, '*') || '|' || cache_key_part(p_material_codes));
  SELECT * INTO r FROM cache_fetch(v_key, p_ttl_seconds);
  IF NOT r.mine THEN RETURN r.payload; END IF;
  v_calc := control_tower_stats(p_warehouse_ids, p_categories, p_today, p_material_codes);
  PERFORM cache_store(v_key, v_calc);
  RETURN v_calc;
END $$;

CREATE OR REPLACE FUNCTION public.control_tower_resources_cached(
  p_warehouse_ids text[], p_today date, p_ttl_seconds int DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_key text; r record; v_calc jsonb;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RETURN control_tower_resources(p_warehouse_ids, p_today);
  END IF;
  v_key := md5('ctr|' || cache_key_part(p_warehouse_ids) || '|' || coalesce(p_today::text, '*'));
  SELECT * INTO r FROM cache_fetch(v_key, p_ttl_seconds);
  IF NOT r.mine THEN RETURN r.payload; END IF;
  v_calc := control_tower_resources(p_warehouse_ids, p_today);
  PERFORM cache_store(v_key, v_calc);
  RETURN v_calc;
END $$;

-- ── Slotting ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.slotting_stats_cached(
  p_warehouse_id text, p_categories text[], p_days int, p_ttl_seconds int DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_key text; r record; v_calc jsonb;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RETURN slotting_stats(p_warehouse_id, p_categories, p_days);
  END IF;
  v_key := md5('slot|' || coalesce(p_warehouse_id, '*') || '|' || cache_key_part(p_categories)
            || '|' || coalesce(p_days::text, '*'));
  SELECT * INTO r FROM cache_fetch(v_key, p_ttl_seconds);
  IF NOT r.mine THEN RETURN r.payload; END IF;
  v_calc := slotting_stats(p_warehouse_id, p_categories, p_days);
  PERFORM cache_store(v_key, v_calc);
  RETURN v_calc;
END $$;

REVOKE ALL ON FUNCTION public.cache_fetch(text, int)                                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cache_store(text, jsonb)                                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.control_tower_stats_cached(text[], text[], date, text[], int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.control_tower_resources_cached(text[], date, int)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.slotting_stats_cached(text, text[], int, int)            FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.control_tower_stats_cached(text[], text[], date, text[], int) TO service_role;
GRANT EXECUTE ON FUNCTION public.control_tower_resources_cached(text[], date, int)     TO service_role;
GRANT EXECUTE ON FUNCTION public.slotting_stats_cached(text, text[], int, int)         TO service_role;

-- Kiểm sau khi apply:
--   SELECT control_tower_stats_cached(NULL,NULL,current_date,NULL,30);  -- lượt 1: tính + lưu
--   SELECT control_tower_stats_cached(NULL,NULL,current_date,NULL,30);  -- lượt 2: phải NHANH HẲN
--   SELECT control_tower_stats_cached(NULL,NULL,current_date,NULL,0)
--        = control_tower_stats(NULL,NULL,current_date,NULL);            -- ttl=0 phải KHỚP đường cũ
--   SELECT count(*) FROM dashboard_cache;                               -- 1 dòng / (phạm vi, ngày)



-- ─────────────────────────────────────────────────────────────────────────
-- [20260829b_monitor_cache_budget.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260829b — NGÂN SÁCH THỜI GIAN cho lượt TÍNH của cache giám sát.
--
-- VÌ SAO (đo ngay sau khi apply 20260829 — cache có mà KHÔNG ăn):
--   Bọc cache xong, ramp vẫn hỏng y như cũ. Lý do: role PostgREST có `statement_timeout` 8s, mà
--   lượt MISS phải TỰ TÍNH — dưới tải nó vượt 8s nên bị giết TRƯỚC KHI kịp ghi cache. Kết quả là
--   một cái cache **không bao giờ nạp được**: muốn có số trong cache thì phải có một lượt tính
--   chạy xong, mà mọi lượt tính đều chết. Càng đông càng không thoát ra được.
--   Đây là cái bẫy dễ bỏ qua nhất khi thêm cache: người ta chỉ kiểm "lượt 2 có nhanh không" (lúc
--   máy rảnh thì luôn nhanh), chứ không kiểm "lượt 1 có SỐNG SÓT nổi lúc đông người không".
--
-- Sửa: cho riêng 3 hàm _cached một ngân sách 30s. Chỉ áp cho LƯỢT TÍNH (miss) — vốn đã hiếm vì
-- có TTL và advisory lock gộp nhiều người thành một lượt; lượt HIT vẫn trả trong vài chục ms.
-- Không nới trần 8s của cả role: trần đó đang bảo vệ mọi câu khác, nới đại trà là bỏ phanh.
-- 30s chứ không 60s: Vercel cắt hàm ở 60s, để 30 thì còn chỗ cho phần đi/về.

ALTER FUNCTION public.control_tower_stats_cached(text[], text[], date, text[], int)
  SET statement_timeout TO '30s';
ALTER FUNCTION public.control_tower_resources_cached(text[], date, int)
  SET statement_timeout TO '30s';
ALTER FUNCTION public.slotting_stats_cached(text, text[], int, int)
  SET statement_timeout TO '30s';

-- CÙNG HỌ — vá luôn 2 hàm cache có từ 21/08. Chúng dính y hệt cái bẫy trên (lượt tính cũng chịu
-- trần 8s ⇒ đúng lúc đông người thì cache không nạp nổi), chỉ là chưa ai đo tới. Luật của dự án:
-- gặp vấn đề cùng họ scale thì quét hết chỗ cùng dạng ngay trong lượt làm việc, không để lại.
ALTER FUNCTION public.dashboard_all_cached(text[], text[], date, int)
  SET statement_timeout TO '30s';
ALTER FUNCTION public.warehouse_productivity_cached(text[], text[], date, date, numeric, int)
  SET statement_timeout TO '30s';

-- Kiểm sau khi apply:
--   SELECT p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname LIKE '%_cached';   -- phải thấy statement_timeout=30s
--   Rồi bắn tải lại: lượt MISS phải CHẠY XONG và ghi được dòng vào dashboard_cache.



-- ─────────────────────────────────────────────────────────────────────────
-- [20260830_service_level_fix.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- VÁ 2 LỖI CỦA `service_level` (phát hiện 30/08 khi soi lại công thức)
--
-- ── LỖI 1: MỨC ĐÃ HẠ BỊ CỘNG LẶP ⇒ báo OAN kho giao thiếu ──────────────────────────────────────
-- Nhu cầu GỐC = số lượng hiện tại + mức đã bị hạ (vết do trigger `trg_outbound_qty_reduced` ghi).
-- Bản 28/08 gom vết theo `(group_code, material_code)` rồi LEFT JOIN vào TỪNG DÒNG hàng. Nhưng một
-- chuyến có thể mang CÙNG MỘT MÃ trên nhiều dòng — đó là chuyện BÌNH THƯỜNG vì "NPP là khóa tách
-- dòng": cùng mã giao cho 2 nhà phân phối là 2 dòng. Đo staging 30/08: **218 chuyến** có mã trùng
-- trên 2 dòng (248 cặp). Với những chuyến đó, mức hạ được cộng vào CẢ HAI dòng ⇒ nhu cầu gốc bị
-- thổi gấp đôi ⇒ dòng đang giao ĐỦ bị tính thành GIAO THIẾU, fill rate tụt, và mã hàng vô tội leo
-- lên bảng "giao thiếu nhiều nhất". Sai theo hướng VU OAN, tức là hướng người ta sẽ đi sửa nhầm.
--
-- Vì sao chưa ai thấy: `outbound_events` hiện có 0 dòng QTY_REDUCED (trigger mới bật 28/08). Lỗi
-- này ngủ cho tới đúng lúc module bắt đầu có việc để đo — nên phải vá TRƯỚC khi có dữ liệu, không
-- thì số liệu sai sẽ trộn lẫn với số liệu đúng và không còn phân biệt được.
--
-- Cách vá: GỘP DÒNG trước theo đúng khóa mà trigger ghi vết — `(group_code, do_number,
-- material_code)`, trigger có ghi `do_number` nên khớp được tới từng DO — rồi mới cộng mức hạ MỘT
-- lần. Gộp cũng xử luôn 21 cặp lặp còn sót ở mức DO (cùng mã 2 dòng trong cùng một DO).
--
-- ── LỖI 2: BA Ô % KHÔNG HỀ ĐƯỢC LÀM TRÒN (dấu ngoặc đặt lệch) ─────────────────────────────────
--   ĐANG viết: round(100.0 * count(*) FILTER (WHERE on_time), 1) / count(*)
--   Ý ĐỊNH:    round(100.0 * count(*) FILTER (WHERE on_time) / count(*), 1)
-- Làm tròn TỬ SỐ (vốn đã là số nguyên ⇒ vô tác dụng) rồi mới chia, nên kết quả giữ nguyên 16-18
-- chữ số thập phân: 2/3 chuyến đúng hạn trả `66.6666666666666667` thay vì `66.7`. Màn Tổng quan
-- đang che lỗi này bằng `.toFixed(1)` phía giao diện, nhưng hợp đồng của RPC là trả số đã làm tròn
-- — ai đọc thẳng (xuất Excel, tích hợp ngoài, cảnh báo) sẽ nhận số rác. Sửa ở NGUỒN, không dựa vào
-- chỗ hiển thị dọn hộ. Ô `fill_rate` vốn viết đúng, giữ nguyên.
CREATE OR REPLACE FUNCTION public.service_level(
  p_from       date,
  p_to         date,
  p_wh_ids     text[] DEFAULT NULL,
  p_limit      int DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE v_out jsonb; v_lim int := least(greatest(coalesce(p_limit, 20), 5), 100);
BEGIN
  WITH trips AS (
    SELECT g.id, g.group_code, g.warehouse_id, g.delivery_date, g.completed_at,
           w.name AS warehouse_name,
           (g.completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= g.delivery_date AS on_time
      FROM "GroupDeliveryOrder" g
      LEFT JOIN "Warehouse" w ON w.id = g.warehouse_id
     WHERE g.status = 'COMPLETED'
       AND g.delivery_date BETWEEN p_from AND p_to
       AND (p_wh_ids IS NULL OR g.warehouse_id = ANY(p_wh_ids))
  ),
  -- Mức đã bị hạ, gom theo ĐÚNG khóa trigger ghi: chuyến + DO + mã hàng.
  -- Chỉ tính lần hạ có liên quan tới việc ĐÃ LẤY HÀNG (QTY_REDUCED_PLAN = cắt kế hoạch, không phải
  -- lỗi phục vụ). `do_number` có thể NULL ở vết cũ ⇒ dùng '' để join không rơi mất dòng.
  red AS (
    SELECT e.group_code, coalesce(e.do_number, '') AS do_number, e.material_code,
           sum(e.old_value::numeric - e.new_value::numeric) AS cut
      FROM outbound_events e
     WHERE e.event_type IN ('QTY_REDUCED_TO_ACTUAL', 'QTY_REDUCED')
       AND e.old_value ~ '^[0-9.]+$' AND e.new_value ~ '^[0-9.]+$'
     GROUP BY 1, 2, 3
  ),
  -- GỘP TRƯỚC theo khóa của vết, rồi mới cộng mức hạ ⇒ mỗi mức hạ vào đúng một lần.
  raw_lines AS (
    SELECT t.id AS trip_id, t.group_code, t.warehouse_id, t.warehouse_name, t.on_time,
           coalesce(d.delivery_code, '') AS do_number,
           oi.material_code_raw AS material_code,
           sum(coalesce(oi.cartons_scanned, 0))::numeric AS shipped,
           sum(oi.cartons_ordered)::numeric              AS ordered
      FROM trips t
      JOIN "OutboundDelivery" d ON d.gdo_id = t.id
      JOIN "OutboundItem" oi    ON oi.do_id = d.id
     GROUP BY 1, 2, 3, 4, 5, 6, 7
  ),
  lines AS (
    SELECT l.trip_id, l.group_code, l.warehouse_id, l.warehouse_name, l.on_time,
           l.material_code, l.shipped,
           l.ordered + coalesce(r.cut, 0) AS demand
      FROM raw_lines l
      LEFT JOIN red r
             ON r.group_code = l.group_code
            AND r.do_number  = l.do_number
            AND r.material_code = l.material_code
  ),
  by_trip AS (
    SELECT trip_id, group_code, warehouse_id, warehouse_name, on_time,
           sum(demand) AS demand, sum(shipped) AS shipped,
           bool_and(shipped >= demand) AS in_full
      FROM lines GROUP BY 1, 2, 3, 4, 5
  )
  SELECT jsonb_build_object(
    'summary', (
      SELECT jsonb_build_object(
        'trips',        count(*),
        'lines',        (SELECT count(*) FROM lines),
        'lines_short',  (SELECT count(*) FROM lines WHERE shipped < demand),
        'demand',       coalesce((SELECT sum(demand)  FROM lines), 0),
        'shipped',      coalesce((SELECT sum(shipped) FROM lines), 0),
        'fill_rate',    CASE WHEN coalesce((SELECT sum(demand) FROM lines), 0) > 0
                             THEN round(100.0 * (SELECT sum(shipped) FROM lines) / (SELECT sum(demand) FROM lines), 1)
                             ELSE NULL END,
        'on_time_pct',  CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE on_time) / count(*), 1) ELSE NULL END,
        'in_full_pct',  CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE in_full) / count(*), 1) ELSE NULL END,
        'otif_pct',     CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE on_time AND in_full) / count(*), 1) ELSE NULL END,
        -- Sao trung bình của các chuyến giao trong kỳ (kho nhận chấm lúc nhận hàng)
        'avg_stars',    (SELECT round(avg(rr.stars)::numeric, 2) FROM receipt_ratings rr
                          JOIN trips t2 ON t2.id = rr.gdo_id),
        'rated_trips',  (SELECT count(*) FROM receipt_ratings rr JOIN trips t2 ON t2.id = rr.gdo_id),
        -- Chuyến THUỘC DIỆN CHẤM = chuyển kho mà kho nhận có TÍCH NHẬN (xem ghi chú migration gốc)
        'ratable_trips', (SELECT count(*) FROM trips t3
                           WHERE EXISTS (SELECT 1 FROM "TmsOrder" o
                                          WHERE o.transfer_gdo_id = t3.id
                                            AND coalesce(o.delivery_mode, '') <> 'SELF'))
      ) FROM by_trip
    ),
    'by_warehouse', coalesce((
      SELECT jsonb_agg(x ORDER BY (x->>'trips')::int DESC) FROM (
        SELECT jsonb_build_object(
          'warehouse_id', warehouse_id, 'warehouse_name', coalesce(warehouse_name, '(không rõ)'),
          'trips', count(*),
          'on_time_pct', round(100.0 * count(*) FILTER (WHERE on_time) / count(*), 1),
          'in_full_pct', round(100.0 * count(*) FILTER (WHERE in_full) / count(*), 1),
          'demand', sum(demand), 'shipped', sum(shipped),
          'fill_rate', CASE WHEN sum(demand) > 0 THEN round(100.0 * sum(shipped) / sum(demand), 1) ELSE NULL END
        ) x
        FROM by_trip GROUP BY warehouse_id, warehouse_name
      ) s), '[]'::jsonb),
    -- Mã hàng giao thiếu nhiều nhất — chỗ để đi tìm nguyên nhân (hết tồn? nhặt sót? kế hoạch ảo?)
    'top_short', coalesce((
      SELECT jsonb_agg(x ORDER BY (x->>'missing')::numeric DESC) FROM (
        SELECT jsonb_build_object(
          'material_code', material_code, 'lines', count(*),
          'missing', sum(demand - shipped), 'demand', sum(demand)
        ) x
        FROM lines WHERE shipped < demand
        GROUP BY material_code ORDER BY sum(demand - shipped) DESC LIMIT v_lim
      ) s), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $fn$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260830b_lot_trace_like_escape.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- VÁ: ký tự đại diện LIKE trong hàm lot_trace chưa được escape (tìm 30/08 bằng fuzz tham số)
--
-- Truy xuất theo TIỀN TỐ mã pallet dựng câu LIKE bằng format(%L). %L chống TIÊM SQL rất tốt
-- nhưng KHÔNG đụng tới ý nghĩa đặc biệt của '%' và '_' trong chính LIKE. Hai hệ quả:
--
--   (a) RÀO CHẶN BỊ VÔ HIỆU: controller bắt tiền tố >= 4 ký tự để không ai quét cả kho. Gõ '%%%%'
--       vừa đủ 4 ký tự và khớp MỌI mã pallet — đo thật: 415KB, 2,4s, trả về trần 2.000 dòng.
--   (b) TÌM SAI ÂM THẦM (nặng hơn): '_' là ký tự HỢP LỆ và có mặt khắp nơi trong mã pallet V1
--       (070526_510000127_C05_M1_001_B). Đang bị hiểu là 'một ký tự bất kỳ', nên tìm tiền tố
--       '070526_5100' cũng khớp '070526X5100'. Với hồ sơ THU HỒI, khớp thừa nghĩa là gom nhầm lô.
--
-- Vá: escape dấu chéo ngược, '%' và '_' trước khi ghép vào LIKE/ILIKE. Prefix cố định vẫn còn nên index
-- text_pattern_ops (idx_inventory_pallet_prefix) vẫn dùng được.
CREATE OR REPLACE FUNCTION public.lot_trace(
  p_kind        text,                      -- pallet | material | batch | npp | trip | plate
  p_value       text,
  p_prod_from   date DEFAULT NULL, p_prod_to date DEFAULT NULL,
  p_ship_from   date DEFAULT NULL, p_ship_to date DEFAULT NULL,
  p_wh_ids      text[] DEFAULT NULL,       -- scope kho của người gọi (NULL = toàn bộ)
  p_categories  text[] DEFAULT NULL,       -- scope loại hàng (null-inclusive như toàn app)
  p_limit       int DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_val    text := btrim(coalesce(p_value, ''));
  -- Ký tự đại diện của LIKE phải được ESCAPE. %L chống được TIÊM SQL nhưng không đụng tới '%'
  -- và '_': gõ '%%%%' (4 ký tự, qua được rào 'tiền tố >= 4') là quét TRỌN kho — đo 30/08: 415KB,
  -- 2,4s. Nặng hơn: '_' là ký tự HỢP LỆ và RẤT PHỔ BIẾN trong mã pallet V1
  -- (070526_510000127_C05_M1_001_B), nên nó đang bị hiểu là 'một ký tự bất kỳ' ⇒ tìm theo tiền
  -- tố ra CẢ những pallet không khớp thật. Postgres mặc định escape bằng dấu chéo ngược.
  v_like   text := replace(replace(replace(btrim(coalesce(p_value, '')),
                     E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
  v_codes  text[];
  v_lim    int  := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_ship   jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_nship  int := 0; v_nstock int := 0; v_ncust int := 0; v_ntrip int := 0;
  v_qship  numeric := 0; v_qhand numeric := 0;
  v_where  text;
  v_scope_ship text := '';   -- điều kiện trên chuyến (kho + ngày giao)
  v_scope_stk  text := '';   -- điều kiện trên tồn (kho + loại hàng)
  v_empty  jsonb := jsonb_build_object('codes', 0, 'shipments', '[]'::jsonb, 'stock', '[]'::jsonb,
                                       'summary', jsonb_build_object('pallets', 0, 'shipments', 0,
                                       'stock_rows', 0, 'customers', 0, 'trips', 0,
                                       'qty_shipped', 0, 'qty_on_hand', 0, 'truncated', false));
BEGIN
  IF v_val = '' OR p_kind IS NULL THEN RETURN v_empty; END IF;

  IF p_wh_ids   IS NOT NULL THEN
    v_scope_ship := v_scope_ship || format(' AND g.warehouse_id = ANY(%L::text[])', p_wh_ids);
    v_scope_stk  := v_scope_stk  || format(' AND ie.warehouse_id = ANY(%L::text[])', p_wh_ids);
  END IF;
  IF p_ship_from IS NOT NULL THEN v_scope_ship := v_scope_ship || format(' AND g.delivery_date >= %L', p_ship_from); END IF;
  IF p_ship_to   IS NOT NULL THEN v_scope_ship := v_scope_ship || format(' AND g.delivery_date <= %L', p_ship_to);   END IF;
  IF p_categories IS NOT NULL THEN
    v_scope_stk := v_scope_stk || format(' AND (m.category IS NULL OR m.category = ANY(%L::text[]))', p_categories);
  END IF;

  -- (a) Quy mọi kiểu tìm về MỘT TẬP MÃ PALLET — sau đó hai chiều dùng chung một đường đi.
  IF p_kind IN ('npp', 'trip', 'plate') THEN
    v_where := CASE p_kind
      WHEN 'npp'   THEN format('d.distributor_name ILIKE %L', '%' || v_like || '%')
      WHEN 'trip'  THEN format('g.group_code = %L', v_val)
      ELSE format('upper(regexp_replace(coalesce(g.license_plate, %L), %L, %L, %L)) = %L',
                  '', '[^A-Za-z0-9]', '', 'g', upper(regexp_replace(v_val, '[^A-Za-z0-9]', '', 'g')))
    END;
    EXECUTE
      'SELECT array_agg(DISTINCT e.pallet_code)
         FROM "OutboundDelivery" d
         JOIN "GroupDeliveryOrder" g ON g.id = d.gdo_id
         JOIN "OutboundItem" oi      ON oi.do_id = d.id
         JOIN "OutboundScanEntry" e  ON e.item_id = oi.id
        WHERE ' || v_where || v_scope_ship
      INTO v_codes;
  ELSE
    v_where := CASE p_kind
      WHEN 'pallet'   THEN format('ie.pallet_code LIKE %L', v_like || '%')
      WHEN 'batch'    THEN format('ie.batch = %L', v_val)
      WHEN 'material' THEN format('m.material_code = %L', v_val)
      ELSE NULL END;
    IF v_where IS NULL THEN RETURN v_empty; END IF;
    IF p_prod_from IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date >= %L', p_prod_from); END IF;
    IF p_prod_to   IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date <= %L', p_prod_to);   END IF;
    EXECUTE
      'SELECT array_agg(DISTINCT ie.pallet_code)
         FROM "InventoryEntry" ie
         LEFT JOIN "Material" m ON m.id = ie.material_id
        WHERE ' || v_where || v_scope_stk
      INTO v_codes;
  END IF;

  IF v_codes IS NULL OR array_length(v_codes, 1) IS NULL THEN RETURN v_empty; END IF;

  -- (b) ĐÃ GIAO ĐI ĐÂU — nối qua chính dòng tồn được quét (inventory_entry_id), không dò lại theo
  --     mã pallet: cùng một mã pallet có thể tồn tại ở kho gửi VÀ kho nhận sau khi chuyển kho.
  --     Join `unnest(mảng)` chứ KHÔNG `= ANY(mảng)`: với mảng vài trăm phần tử, `= ANY` làm planner
  --     bỏ index (đo: 110ms → gần 1 giây).
  -- ⚠️ Ô tổng cộng trên TOÀN BỘ kết quả, không phải trên trang đã cắt.
  EXECUTE
    'WITH s AS (
       SELECT e.pallet_code, e.cartons_scanned, e.scanned_at, e.pct_date,
              ie.production_date, ie.expiry_date, ie.batch,
              coalesce(m.material_code, oi.material_code_raw) AS material_code, m.short_name,
              g.group_code, g.delivery_date, g.license_plate, g.status AS trip_status,
              d.delivery_code, d.distributor_name, w.name AS warehouse_name
         FROM unnest($1::text[]) AS pc(code)
         JOIN "OutboundScanEntry" e  ON e.pallet_code = pc.code
         JOIN "OutboundItem" oi      ON oi.id = e.item_id
         JOIN "OutboundDelivery" d   ON d.id  = oi.do_id
         JOIN "GroupDeliveryOrder" g ON g.id  = d.gdo_id
         LEFT JOIN "InventoryEntry" ie ON ie.id = e.inventory_entry_id
         LEFT JOIN "Material" m        ON m.id  = coalesce(ie.material_id, oi.material_id)
         LEFT JOIN "Warehouse" w       ON w.id  = g.warehouse_id
        WHERE true' || v_scope_ship || '
     ), t AS (SELECT s.*, row_number() OVER (ORDER BY s.scanned_at DESC NULLS LAST) rn FROM s)
     SELECT count(*)::int, coalesce(sum(t.cartons_scanned), 0),
            count(DISTINCT t.distributor_name)::int, count(DISTINCT t.group_code)::int,
            coalesce(jsonb_agg(to_jsonb(t) - ''rn'' ORDER BY t.scanned_at DESC NULLS LAST)
                     FILTER (WHERE t.rn <= $2), ''[]''::jsonb)
       FROM t'
    INTO v_nship, v_qship, v_ncust, v_ntrip, v_ship
    USING v_codes, v_lim;

  -- (c) CÒN TRONG KHO — phần chưa đi, để biết thu hồi được bao nhiêu tại chỗ
  EXECUTE
    'WITH k AS (
       SELECT ie.pallet_code, ie.cartons_remaining, ie.status, ie.production_date, ie.expiry_date,
              ie.batch, ie.import_date, m.material_code, m.short_name,
              w.name AS warehouse_name, l.location_code
         FROM unnest($1::text[]) AS pc(code)
         JOIN "InventoryEntry" ie ON ie.pallet_code = pc.code
         LEFT JOIN "Material" m  ON m.id = ie.material_id
         LEFT JOIN "Warehouse" w ON w.id = ie.warehouse_id
         LEFT JOIN "Location" l  ON l.id = ie.location_id
        WHERE ie.cartons_remaining > 0' || v_scope_stk || '
     ), t AS (SELECT k.*, row_number() OVER (ORDER BY k.pallet_code) rn FROM k)
     SELECT count(*)::int, coalesce(sum(t.cartons_remaining), 0),
            coalesce(jsonb_agg(to_jsonb(t) - ''rn'' ORDER BY t.pallet_code)
                     FILTER (WHERE t.rn <= $2), ''[]''::jsonb)
       FROM t'
    INTO v_nstock, v_qhand, v_stock
    USING v_codes, v_lim;

  RETURN jsonb_build_object(
    'codes', array_length(v_codes, 1), 'shipments', v_ship, 'stock', v_stock,
    'summary', jsonb_build_object(
      'pallets', array_length(v_codes, 1), 'shipments', v_nship, 'stock_rows', v_nstock,
      'customers', v_ncust, 'trips', v_ntrip, 'qty_shipped', v_qship, 'qty_on_hand', v_qhand,
      'truncated', (v_nship > v_lim OR v_nstock > v_lim)));
END $fn$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260831_realtime_costs_policy.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- REALTIME cho Chấm sao chuyến + Chi phí kho (user chốt 31/08 "2 mục này cần realtime thôi")
--
-- Hiện trạng đo staging: cả 3 bảng ĐÃ nằm trong publication supabase_realtime, nhưng
-- warehouse_costs + warehouse_cost_locks THIẾU policy SELECT → client không bao giờ nhận
-- được sự kiện (RLS bật + 0 policy đọc = realtime chết CÂM — bài học 06/08, memory
-- realtime-rls-silent-death). receipt_ratings đã có policy đọc từ 20260828c.
--
-- Khuôn policy theo đúng các bảng realtime đang chạy (InventoryEntry, GroupDeliveryOrder…):
-- FOR SELECT TO authenticated USING (true) — anon vẫn đóng (audit 12/07).
-- Idempotent: chạy lại không lỗi.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'warehouse_costs' AND cmd = 'SELECT') THEN
    EXECUTE 'CREATE POLICY warehouse_costs_read ON public.warehouse_costs FOR SELECT TO authenticated USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'warehouse_cost_locks' AND cmd = 'SELECT') THEN
    EXECUTE 'CREATE POLICY warehouse_cost_locks_read ON public.warehouse_cost_locks FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260901_trace_investigations.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ĐIỀU TRA TRUY VẾT THEO THÙNG (01/09, user chốt):
-- Khiếu nại thực tế đến từ MỘT THÙNG khách đang cầm — trên thùng chỉ có chữ in phun (giờ phút,
-- ngày SX), không có tem pallet. Người điều tra nhập giờ thùng + mã hàng (+ máy, chu kỳ nếu biết),
-- đính kèm ảnh khách gửi → đối chiếu SỔ ĐÓNG GÓI (packing_logs có khoảng giờ SX thùng đầu→thùng
-- cuối của TỪNG pallet) → ra pallet nghi vấn → truy tiếp "đã giao khách nào" bằng chính máy
-- lot_trace. Kết quả + người thực hiện lưu thành HỒ SƠ tra lại được.
-- User chốt 01/09: chỉ khớp ĐÚNG khoảng giờ (không nới ±), ảnh đính kèm + AI đọc giờ từ ảnh,
-- quyền TẠO hồ sơ riêng = traceability.investigate.

-- ── 1) Bảng hồ sơ điều tra ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trace_investigations (
  id                 uuid PRIMARY KEY,
  carton_at          timestamptz NOT NULL,          -- thời điểm in trên thùng (nhập giờ VN)
  material_code      text NOT NULL,
  machine_code       text,
  cycle              text,
  note               text,                          -- bối cảnh điều tra (khiếu nại gì, ai báo)
  result_note        text,                          -- kết luận của người điều tra
  photos             text[] NOT NULL DEFAULT '{}',  -- path trong bucket trace-photos
  matched            jsonb NOT NULL DEFAULT '[]'::jsonb, -- pallet khớp sổ đóng gói (snapshot)
  trace              jsonb,                         -- kết quả lot_trace tại thời điểm điều tra
  performed_by       uuid,
  performed_by_name  text,
  created_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trace_inv_created ON public.trace_investigations (created_at DESC);

-- RLS bật + policy SELECT authenticated — realtime cần policy đọc, thiếu là sự kiện chết CÂM
-- (bài học memory realtime-rls-silent-death; ghi/xóa vẫn chỉ qua service role của BE).
ALTER TABLE public.trace_investigations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'trace_investigations'
                   AND policyname = 'trace_investigations_read') THEN
    CREATE POLICY trace_investigations_read ON public.trace_investigations
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                   AND tablename = 'trace_investigations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trace_investigations;
  END IF;
END $$;

-- ── 2) Bucket ảnh riêng tư (như forklift-photos / packing-photos — BE phát signed URL 1h) ───────
INSERT INTO storage.buckets (id, name, public)
VALUES ('trace-photos', 'trace-photos', false)
ON CONFLICT (id) DO NOTHING;

-- ── 3) lot_trace nhận thêm kiểu 'codes' — TẬP MÃ PALLET dựng sẵn ───────────────────────────────
-- Điều tra theo thùng khớp sổ đóng gói ra danh sách pallet, rồi truy tiếp bằng CHÍNH lot_trace
-- (không chép lại SQL nối giao hàng/tồn — một nguồn sự thật). Thêm tham số phải DROP bản cũ:
-- CREATE OR REPLACE với chữ ký khác sẽ tạo OVERLOAD → PostgREST gọi RPC bị nhập nhằng.
DROP FUNCTION IF EXISTS public.lot_trace(text, text, date, date, date, date, text[], text[], int);
CREATE OR REPLACE FUNCTION public.lot_trace(
  p_kind        text,                      -- pallet | material | batch | npp | trip | plate | codes
  p_value       text,
  p_prod_from   date DEFAULT NULL, p_prod_to date DEFAULT NULL,
  p_ship_from   date DEFAULT NULL, p_ship_to date DEFAULT NULL,
  p_wh_ids      text[] DEFAULT NULL,       -- scope kho của người gọi (NULL = toàn bộ)
  p_categories  text[] DEFAULT NULL,       -- scope loại hàng (null-inclusive như toàn app)
  p_limit       int DEFAULT 500,
  p_codes       text[] DEFAULT NULL        -- kind='codes': tập mã pallet đã dựng sẵn
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_val    text := btrim(coalesce(p_value, ''));
  v_codes  text[];
  v_lim    int  := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_ship   jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_nship  int := 0; v_nstock int := 0; v_ncust int := 0; v_ntrip int := 0;
  v_qship  numeric := 0; v_qhand numeric := 0;
  v_where  text;
  v_scope_ship text := '';   -- điều kiện trên chuyến (kho + ngày giao)
  v_scope_stk  text := '';   -- điều kiện trên tồn (kho + loại hàng)
  v_empty  jsonb := jsonb_build_object('codes', 0, 'shipments', '[]'::jsonb, 'stock', '[]'::jsonb,
                                       'summary', jsonb_build_object('pallets', 0, 'shipments', 0,
                                       'stock_rows', 0, 'customers', 0, 'trips', 0,
                                       'qty_shipped', 0, 'qty_on_hand', 0, 'truncated', false));
BEGIN
  IF p_kind IS NULL OR (p_kind <> 'codes' AND v_val = '') THEN RETURN v_empty; END IF;

  IF p_wh_ids   IS NOT NULL THEN
    v_scope_ship := v_scope_ship || format(' AND g.warehouse_id = ANY(%L::text[])', p_wh_ids);
    v_scope_stk  := v_scope_stk  || format(' AND ie.warehouse_id = ANY(%L::text[])', p_wh_ids);
  END IF;
  IF p_ship_from IS NOT NULL THEN v_scope_ship := v_scope_ship || format(' AND g.delivery_date >= %L', p_ship_from); END IF;
  IF p_ship_to   IS NOT NULL THEN v_scope_ship := v_scope_ship || format(' AND g.delivery_date <= %L', p_ship_to);   END IF;
  IF p_categories IS NOT NULL THEN
    v_scope_stk := v_scope_stk || format(' AND (m.category IS NULL OR m.category = ANY(%L::text[]))', p_categories);
  END IF;

  -- (a) Quy mọi kiểu tìm về MỘT TẬP MÃ PALLET — sau đó hai chiều dùng chung một đường đi.
  IF p_kind = 'codes' THEN
    v_codes := p_codes[1:200];   -- điều tra theo thùng: tập nhỏ, kẹp cứng 200 mã
  ELSIF p_kind IN ('npp', 'trip', 'plate') THEN
    v_where := CASE p_kind
      WHEN 'npp'   THEN format('d.distributor_name ILIKE %L', '%' || v_val || '%')
      WHEN 'trip'  THEN format('g.group_code = %L', v_val)
      ELSE format('upper(regexp_replace(coalesce(g.license_plate, %L), %L, %L, %L)) = %L',
                  '', '[^A-Za-z0-9]', '', 'g', upper(regexp_replace(v_val, '[^A-Za-z0-9]', '', 'g')))
    END;
    EXECUTE
      'SELECT array_agg(DISTINCT e.pallet_code)
         FROM "OutboundDelivery" d
         JOIN "GroupDeliveryOrder" g ON g.id = d.gdo_id
         JOIN "OutboundItem" oi      ON oi.do_id = d.id
         JOIN "OutboundScanEntry" e  ON e.item_id = oi.id
        WHERE ' || v_where || v_scope_ship
      INTO v_codes;
  ELSE
    v_where := CASE p_kind
      WHEN 'pallet'   THEN format('ie.pallet_code LIKE %L', v_val || '%')
      WHEN 'batch'    THEN format('ie.batch = %L', v_val)
      WHEN 'material' THEN format('m.material_code = %L', v_val)
      ELSE NULL END;
    IF v_where IS NULL THEN RETURN v_empty; END IF;
    IF p_prod_from IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date >= %L', p_prod_from); END IF;
    IF p_prod_to   IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date <= %L', p_prod_to);   END IF;
    EXECUTE
      'SELECT array_agg(DISTINCT ie.pallet_code)
         FROM "InventoryEntry" ie
         LEFT JOIN "Material" m ON m.id = ie.material_id
        WHERE ' || v_where || v_scope_stk
      INTO v_codes;
  END IF;

  IF v_codes IS NULL OR array_length(v_codes, 1) IS NULL THEN RETURN v_empty; END IF;

  -- (b) ĐÃ GIAO ĐI ĐÂU — nối qua chính dòng tồn được quét (inventory_entry_id), không dò lại theo
  --     mã pallet: cùng một mã pallet có thể tồn tại ở kho gửi VÀ kho nhận sau khi chuyển kho.
  --     Join `unnest(mảng)` chứ KHÔNG `= ANY(mảng)`: với mảng vài trăm phần tử, `= ANY` làm planner
  --     bỏ index (đo: 110ms → gần 1 giây).
  -- ⚠️ Ô tổng cộng trên TOÀN BỘ kết quả, không phải trên trang đã cắt.
  EXECUTE
    'WITH s AS (
       SELECT e.pallet_code, e.cartons_scanned, e.scanned_at, e.pct_date,
              ie.production_date, ie.expiry_date, ie.batch,
              coalesce(m.material_code, oi.material_code_raw) AS material_code, m.short_name,
              g.group_code, g.delivery_date, g.license_plate, g.status AS trip_status,
              d.delivery_code, d.distributor_name, w.name AS warehouse_name
         FROM unnest($1::text[]) AS pc(code)
         JOIN "OutboundScanEntry" e  ON e.pallet_code = pc.code
         JOIN "OutboundItem" oi      ON oi.id = e.item_id
         JOIN "OutboundDelivery" d   ON d.id  = oi.do_id
         JOIN "GroupDeliveryOrder" g ON g.id  = d.gdo_id
         LEFT JOIN "InventoryEntry" ie ON ie.id = e.inventory_entry_id
         LEFT JOIN "Material" m        ON m.id  = coalesce(ie.material_id, oi.material_id)
         LEFT JOIN "Warehouse" w       ON w.id  = g.warehouse_id
        WHERE true' || v_scope_ship || '
     ), t AS (SELECT s.*, row_number() OVER (ORDER BY s.scanned_at DESC NULLS LAST) rn FROM s)
     SELECT count(*)::int, coalesce(sum(t.cartons_scanned), 0),
            count(DISTINCT t.distributor_name)::int, count(DISTINCT t.group_code)::int,
            coalesce(jsonb_agg(to_jsonb(t) - ''rn'' ORDER BY t.scanned_at DESC NULLS LAST)
                     FILTER (WHERE t.rn <= $2), ''[]''::jsonb)
       FROM t'
    INTO v_nship, v_qship, v_ncust, v_ntrip, v_ship
    USING v_codes, v_lim;

  -- (c) CÒN TRONG KHO — phần chưa đi, để biết thu hồi được bao nhiêu tại chỗ
  EXECUTE
    'WITH k AS (
       SELECT ie.pallet_code, ie.cartons_remaining, ie.status, ie.production_date, ie.expiry_date,
              ie.batch, ie.import_date, m.material_code, m.short_name,
              w.name AS warehouse_name, l.location_code
         FROM unnest($1::text[]) AS pc(code)
         JOIN "InventoryEntry" ie ON ie.pallet_code = pc.code
         LEFT JOIN "Material" m  ON m.id = ie.material_id
         LEFT JOIN "Warehouse" w ON w.id = ie.warehouse_id
         LEFT JOIN "Location" l  ON l.id = ie.location_id
        WHERE ie.cartons_remaining > 0' || v_scope_stk || '
     ), t AS (SELECT k.*, row_number() OVER (ORDER BY k.pallet_code) rn FROM k)
     SELECT count(*)::int, coalesce(sum(t.cartons_remaining), 0),
            coalesce(jsonb_agg(to_jsonb(t) - ''rn'' ORDER BY t.pallet_code)
                     FILTER (WHERE t.rn <= $2), ''[]''::jsonb)
       FROM t'
    INTO v_nstock, v_qhand, v_stock
    USING v_codes, v_lim;

  RETURN jsonb_build_object(
    'codes', array_length(v_codes, 1), 'shipments', v_ship, 'stock', v_stock,
    'summary', jsonb_build_object(
      'pallets', array_length(v_codes, 1), 'shipments', v_nship, 'stock_rows', v_nstock,
      'customers', v_ncust, 'trips', v_ntrip, 'qty_shipped', v_qship, 'qty_on_hand', v_qhand,
      'truncated', (v_nship > v_lim OR v_nstock > v_lim)));
END $fn$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260901b_trace_run_pick.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- TRUY XUẤT THEO THÙNG v2 (user chỉnh 01/09 chiều):
-- 1. Bắt buộc = Ngày · Giờ SX · MÁY · CHU KỲ; MÃ HÀNG thành TÙY CHỌN ("không bắt buộc, có thì tốt")
--    → material_code trên hồ sơ được phép NULL.
-- 2. Ngày tem pallet có thể lệch ±1–3 ngày so với ngày in phun trên thùng (SX vắt qua đêm) →
--    KHÔNG khớp thẳng pallet theo giờ nữa: tìm SỔ ĐÓNG GÓI (packing_runs) theo Máy + Chu kỳ
--    trong cửa sổ ±3 ngày, user XEM từng sổ và BUỘC CHỌN 1 sổ → hồ sơ ghi lại sổ đã chọn (run_id).
ALTER TABLE public.trace_investigations ALTER COLUMN material_code DROP NOT NULL;
ALTER TABLE public.trace_investigations ADD COLUMN IF NOT EXISTS run_id uuid;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260901c_trace_suggest.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- GỢI Ý GIÁ TRỊ CẦN TÌM cho Truy xuất lô (user chốt 01/09 tối: "phải dạng dropdown search theo
-- chuẩn app, tìm kiểu này k ra đâu"). Ô nhập tự do → SingleSelect tìm-trên-server: mỗi kiểu tìm
-- một câu DISTINCT + LIMIT trong SQL (PostgREST không DISTINCT được — luật "cần TẬP thì hỏi DB").
CREATE OR REPLACE FUNCTION public.trace_suggest(
  p_kind   text,                -- pallet | material | batch | npp | trip | plate
  p_search text DEFAULT NULL,
  p_limit  int  DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  s   text := btrim(coalesce(p_search, ''));
  lim int  := least(greatest(coalesce(p_limit, 50), 1), 100);
  v   jsonb := '[]'::jsonb;
BEGIN
  IF p_kind = 'material' THEN
    -- danh mục nhỏ (~3k) — rỗng vẫn trả 50 mã đầu; nhãn kèm tên hàng
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.c, 'label', x.l)), '[]') INTO v FROM (
      SELECT m.material_code c, m.material_code || ' — ' || coalesce(m.short_name, m.material_description, '') l
        FROM "Material" m
       WHERE m.is_active IS NOT FALSE
         AND (s = '' OR m.material_code ILIKE '%' || s || '%'
              OR m.short_name ILIKE '%' || s || '%' OR m.material_description ILIKE '%' || s || '%')
       ORDER BY m.material_code LIMIT lim) x;
  ELSIF s = '' THEN
    RETURN v;   -- các kiểu còn lại quét bảng GIAO DỊCH lớn — bắt buộc có từ khóa mới tìm
  ELSIF p_kind = 'pallet' THEN
    -- TIỀN TỐ — phải SQL ĐỘNG (%L nhúng literal): plpgsql cache plan generic nên `LIKE s || '%'`
    -- KHÔNG ăn được index text_pattern_ops (đo staging: 3.101ms → 21ms sau khi đổi)
    EXECUTE format(
      'SELECT coalesce(jsonb_agg(jsonb_build_object(''value'', x.pc, ''label'', x.pc)), ''[]'') FROM (
         SELECT DISTINCT ie.pallet_code pc FROM "InventoryEntry" ie
          WHERE ie.pallet_code LIKE %L ORDER BY 1 LIMIT %s) x', s || '%', lim)
      INTO v;
  ELSIF p_kind = 'batch' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.b, 'label', x.b)), '[]') INTO v FROM (
      SELECT DISTINCT ie.batch b FROM "InventoryEntry" ie
       WHERE ie.batch IS NOT NULL AND ie.batch ILIKE '%' || s || '%' ORDER BY 1 LIMIT lim) x;
  ELSIF p_kind = 'npp' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.n, 'label', x.n)), '[]') INTO v FROM (
      SELECT DISTINCT d.distributor_name n FROM "OutboundDelivery" d
       WHERE d.distributor_name IS NOT NULL AND d.distributor_name ILIKE '%' || s || '%'
       ORDER BY 1 LIMIT lim) x;
  ELSIF p_kind = 'trip' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.g, 'label', x.g)), '[]') INTO v FROM (
      SELECT DISTINCT g.group_code g FROM "GroupDeliveryOrder" g
       WHERE g.group_code ILIKE '%' || s || '%' ORDER BY 1 DESC LIMIT lim) x;
  ELSIF p_kind = 'plate' THEN
    -- so trên dạng CHUẨN (chỉ chữ+số, hoa) như chính lot_trace
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.p, 'label', x.p)), '[]') INTO v FROM (
      SELECT DISTINCT g.license_plate p FROM "GroupDeliveryOrder" g
       WHERE g.license_plate IS NOT NULL
         AND upper(regexp_replace(g.license_plate, '[^A-Za-z0-9]', '', 'g'))
             LIKE '%' || upper(regexp_replace(s, '[^A-Za-z0-9]', '', 'g')) || '%'
       ORDER BY 1 LIMIT lim) x;
  END IF;
  RETURN v;
END $fn$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260901d_lot_trace_prod.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260901d — TRUY XUẤT LÔ theo THÔNG SỐ SẢN XUẤT (user chốt 01/09 tối):
-- "Số lô là gì, cái tôi cần là số chu kỳ, số máy, nhà máy sản xuất" — đơn vị này dùng tem V1
-- (delimiter _) nên cột batch luôn NULL; kiểu tìm hữu dụng là CHU KỲ + MÁY + KHO SX (ký hiệu),
-- đọc thẳng từ các đoạn của tem: đoạn 3 = Chu kỳ · đoạn 4 = Máy · đoạn 6 = Kho SX.
--
-- Thêm kind='prod' + 3 tham số p_cycle/p_machine/p_nmsx. BẮT BUỘC khoảng Ngày SX (kẹp 31 ngày):
-- tem V1 mở đầu bằng ddmmyy nên dựng OR tiền tố 'ddmmyy_%' từng ngày → ăn index
-- idx_inventory_pallet_prefix (text_pattern_ops); lọc split_part đơn thuần = Seq Scan bảng triệu dòng.
-- Chu kỳ so DẠNG CHUẨN (bỏ 0 dẫn đầu, "055" ≡ "55") — cùng luật normCycleCode của Sổ đóng gói.
--
-- Thêm tham số PHẢI DROP chữ ký cũ: CREATE OR REPLACE khác chữ ký tạo OVERLOAD → PostgREST gọi
-- RPC nhập nhằng (bài học 20260901).
DROP FUNCTION IF EXISTS public.lot_trace(text, text, date, date, date, date, text[], text[], int, text[]);
CREATE OR REPLACE FUNCTION public.lot_trace(
  p_kind        text,                      -- pallet | material | batch | prod | npp | trip | plate | codes
  p_value       text,
  p_prod_from   date DEFAULT NULL, p_prod_to date DEFAULT NULL,
  p_ship_from   date DEFAULT NULL, p_ship_to date DEFAULT NULL,
  p_wh_ids      text[] DEFAULT NULL,       -- scope kho của người gọi (NULL = toàn bộ)
  p_categories  text[] DEFAULT NULL,       -- scope loại hàng (null-inclusive như toàn app)
  p_limit       int DEFAULT 500,
  p_codes       text[] DEFAULT NULL,       -- kind='codes': tập mã pallet đã dựng sẵn
  p_cycle       text DEFAULT NULL,         -- kind='prod': Chu kỳ (đoạn 3 tem V1)
  p_machine     text DEFAULT NULL,         -- kind='prod': Máy (đoạn 4)
  p_nmsx        text DEFAULT NULL          -- kind='prod': Kho SX ký hiệu (đoạn 6, vd B/D)
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_val    text := btrim(coalesce(p_value, ''));
  v_codes  text[];
  v_lim    int  := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_ship   jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_nship  int := 0; v_nstock int := 0; v_ncust int := 0; v_ntrip int := 0;
  v_qship  numeric := 0; v_qhand numeric := 0;
  v_where  text;
  v_scope_ship text := '';   -- điều kiện trên chuyến (kho + ngày giao)
  v_scope_stk  text := '';   -- điều kiện trên tồn (kho + loại hàng)
  v_empty  jsonb := jsonb_build_object('codes', 0, 'shipments', '[]'::jsonb, 'stock', '[]'::jsonb,
                                       'summary', jsonb_build_object('pallets', 0, 'shipments', 0,
                                       'stock_rows', 0, 'customers', 0, 'trips', 0,
                                       'qty_shipped', 0, 'qty_on_hand', 0, 'truncated', false));
BEGIN
  IF p_kind IS NULL OR (p_kind NOT IN ('codes', 'prod') AND v_val = '') THEN RETURN v_empty; END IF;

  IF p_wh_ids   IS NOT NULL THEN
    v_scope_ship := v_scope_ship || format(' AND g.warehouse_id = ANY(%L::text[])', p_wh_ids);
    v_scope_stk  := v_scope_stk  || format(' AND ie.warehouse_id = ANY(%L::text[])', p_wh_ids);
  END IF;
  IF p_ship_from IS NOT NULL THEN v_scope_ship := v_scope_ship || format(' AND g.delivery_date >= %L', p_ship_from); END IF;
  IF p_ship_to   IS NOT NULL THEN v_scope_ship := v_scope_ship || format(' AND g.delivery_date <= %L', p_ship_to);   END IF;
  IF p_categories IS NOT NULL THEN
    v_scope_stk := v_scope_stk || format(' AND (m.category IS NULL OR m.category = ANY(%L::text[]))', p_categories);
  END IF;

  -- (a) Quy mọi kiểu tìm về MỘT TẬP MÃ PALLET — sau đó hai chiều dùng chung một đường đi.
  IF p_kind = 'codes' THEN
    v_codes := p_codes[1:200];   -- điều tra theo thùng: tập nhỏ, kẹp cứng 200 mã
  ELSIF p_kind = 'prod' THEN
    -- Controller đã 400 các ca thiếu tham số; guard ở đây chỉ để gọi thẳng RPC không nổ.
    IF p_prod_from IS NULL OR p_prod_to IS NULL OR p_prod_to < p_prod_from
       OR (p_prod_to - p_prod_from) > 31 THEN RETURN v_empty; END IF;
    IF btrim(coalesce(p_cycle, '')) = '' AND btrim(coalesce(p_machine, '')) = ''
       AND btrim(coalesce(p_nmsx, '')) = '' THEN RETURN v_empty; END IF;
    SELECT '(' || string_agg(format('ie.pallet_code LIKE %L', to_char(g.d::date, 'DDMMYY') || '_%'), ' OR ') || ')'
      INTO v_where
      FROM generate_series(p_prod_from::timestamp, p_prod_to::timestamp, interval '1 day') AS g(d);
    IF btrim(coalesce(p_cycle, '')) <> '' THEN
      v_where := v_where || format(
        ' AND coalesce(nullif(ltrim(split_part(ie.pallet_code, ''_'', 3), ''0''), ''''), ''0'') = %L',
        coalesce(nullif(ltrim(btrim(p_cycle), '0'), ''), '0'));
    END IF;
    IF btrim(coalesce(p_machine, '')) <> '' THEN
      v_where := v_where || format(' AND upper(split_part(ie.pallet_code, ''_'', 4)) = %L', upper(btrim(p_machine)));
    END IF;
    IF btrim(coalesce(p_nmsx, '')) <> '' THEN
      v_where := v_where || format(' AND upper(split_part(ie.pallet_code, ''_'', 6)) = %L', upper(btrim(p_nmsx)));
    END IF;
    EXECUTE
      'SELECT array_agg(DISTINCT ie.pallet_code)
         FROM "InventoryEntry" ie
         LEFT JOIN "Material" m ON m.id = ie.material_id
        WHERE ' || v_where || v_scope_stk
      INTO v_codes;
  ELSIF p_kind IN ('npp', 'trip', 'plate') THEN
    v_where := CASE p_kind
      WHEN 'npp'   THEN format('d.distributor_name ILIKE %L', '%' || v_val || '%')
      WHEN 'trip'  THEN format('g.group_code = %L', v_val)
      ELSE format('upper(regexp_replace(coalesce(g.license_plate, %L), %L, %L, %L)) = %L',
                  '', '[^A-Za-z0-9]', '', 'g', upper(regexp_replace(v_val, '[^A-Za-z0-9]', '', 'g')))
    END;
    EXECUTE
      'SELECT array_agg(DISTINCT e.pallet_code)
         FROM "OutboundDelivery" d
         JOIN "GroupDeliveryOrder" g ON g.id = d.gdo_id
         JOIN "OutboundItem" oi      ON oi.do_id = d.id
         JOIN "OutboundScanEntry" e  ON e.item_id = oi.id
        WHERE ' || v_where || v_scope_ship
      INTO v_codes;
  ELSE
    v_where := CASE p_kind
      WHEN 'pallet'   THEN format('ie.pallet_code LIKE %L', v_val || '%')
      WHEN 'batch'    THEN format('ie.batch = %L', v_val)
      WHEN 'material' THEN format('m.material_code = %L', v_val)
      ELSE NULL END;
    IF v_where IS NULL THEN RETURN v_empty; END IF;
    IF p_prod_from IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date >= %L', p_prod_from); END IF;
    IF p_prod_to   IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date <= %L', p_prod_to);   END IF;
    EXECUTE
      'SELECT array_agg(DISTINCT ie.pallet_code)
         FROM "InventoryEntry" ie
         LEFT JOIN "Material" m ON m.id = ie.material_id
        WHERE ' || v_where || v_scope_stk
      INTO v_codes;
  END IF;

  IF v_codes IS NULL OR array_length(v_codes, 1) IS NULL THEN RETURN v_empty; END IF;

  -- (b) ĐÃ GIAO ĐI ĐÂU — nối qua chính dòng tồn được quét (inventory_entry_id), không dò lại theo
  --     mã pallet: cùng một mã pallet có thể tồn tại ở kho gửi VÀ kho nhận sau khi chuyển kho.
  --     Join `unnest(mảng)` chứ KHÔNG `= ANY(mảng)`: với mảng vài trăm phần tử, `= ANY` làm planner
  --     bỏ index (đo: 110ms → gần 1 giây).
  -- ⚠️ Ô tổng cộng trên TOÀN BỘ kết quả, không phải trên trang đã cắt.
  EXECUTE
    'WITH s AS (
       SELECT e.pallet_code, e.cartons_scanned, e.scanned_at, e.pct_date,
              ie.production_date, ie.expiry_date, ie.batch,
              coalesce(m.material_code, oi.material_code_raw) AS material_code, m.short_name,
              g.group_code, g.delivery_date, g.license_plate, g.status AS trip_status,
              d.delivery_code, d.distributor_name, w.name AS warehouse_name
         FROM unnest($1::text[]) AS pc(code)
         JOIN "OutboundScanEntry" e  ON e.pallet_code = pc.code
         JOIN "OutboundItem" oi      ON oi.id = e.item_id
         JOIN "OutboundDelivery" d   ON d.id  = oi.do_id
         JOIN "GroupDeliveryOrder" g ON g.id  = d.gdo_id
         LEFT JOIN "InventoryEntry" ie ON ie.id = e.inventory_entry_id
         LEFT JOIN "Material" m        ON m.id  = coalesce(ie.material_id, oi.material_id)
         LEFT JOIN "Warehouse" w       ON w.id  = g.warehouse_id
        WHERE true' || v_scope_ship || '
     ), t AS (SELECT s.*, row_number() OVER (ORDER BY s.scanned_at DESC NULLS LAST) rn FROM s)
     SELECT count(*)::int, coalesce(sum(t.cartons_scanned), 0),
            count(DISTINCT t.distributor_name)::int, count(DISTINCT t.group_code)::int,
            coalesce(jsonb_agg(to_jsonb(t) - ''rn'' ORDER BY t.scanned_at DESC NULLS LAST)
                     FILTER (WHERE t.rn <= $2), ''[]''::jsonb)
       FROM t'
    INTO v_nship, v_qship, v_ncust, v_ntrip, v_ship
    USING v_codes, v_lim;

  -- (c) CÒN TRONG KHO — phần chưa đi, để biết thu hồi được bao nhiêu tại chỗ
  EXECUTE
    'WITH k AS (
       SELECT ie.pallet_code, ie.cartons_remaining, ie.status, ie.production_date, ie.expiry_date,
              ie.batch, ie.import_date, m.material_code, m.short_name,
              w.name AS warehouse_name, l.location_code
         FROM unnest($1::text[]) AS pc(code)
         JOIN "InventoryEntry" ie ON ie.pallet_code = pc.code
         LEFT JOIN "Material" m  ON m.id = ie.material_id
         LEFT JOIN "Warehouse" w ON w.id = ie.warehouse_id
         LEFT JOIN "Location" l  ON l.id = ie.location_id
        WHERE ie.cartons_remaining > 0' || v_scope_stk || '
     ), t AS (SELECT k.*, row_number() OVER (ORDER BY k.pallet_code) rn FROM k)
     SELECT count(*)::int, coalesce(sum(t.cartons_remaining), 0),
            coalesce(jsonb_agg(to_jsonb(t) - ''rn'' ORDER BY t.pallet_code)
                     FILTER (WHERE t.rn <= $2), ''[]''::jsonb)
       FROM t'
    INTO v_nstock, v_qhand, v_stock
    USING v_codes, v_lim;

  RETURN jsonb_build_object(
    'codes', array_length(v_codes, 1), 'shipments', v_ship, 'stock', v_stock,
    'summary', jsonb_build_object(
      'pallets', array_length(v_codes, 1), 'shipments', v_nship, 'stock_rows', v_nstock,
      'customers', v_ncust, 'trips', v_ntrip, 'qty_shipped', v_qship, 'qty_on_hand', v_qhand,
      'truncated', (v_nship > v_lim OR v_nstock > v_lim)));
END $fn$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260901e_trace_prod_flex.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260901e — Truy theo thông số SX: KHÔNG GÌ BẮT BUỘC + dropdown gợi ý (user chốt 01/09 tối
-- lần 2: "k có gì bắt buộc cả nhé, ra filter nào thì lấy cái đó" + "dropdown chuẩn đâu rồi").
--
-- (1) 3 INDEX BIỂU THỨC trên đoạn tem V1 — để tra Chu kỳ/Máy/Kho SX KHÔNG cần khoảng ngày mà
--     vẫn không Seq Scan bảng triệu dòng (biểu thức trong index phải KHỚP NGUYÊN VĂN với query).
CREATE INDEX IF NOT EXISTS idx_ie_tem_cycle
  ON public."InventoryEntry" ((coalesce(nullif(ltrim(split_part(pallet_code, '_', 3), '0'), ''), '0')));
CREATE INDEX IF NOT EXISTS idx_ie_tem_machine
  ON public."InventoryEntry" ((upper(split_part(pallet_code, '_', 4))));
CREATE INDEX IF NOT EXISTS idx_ie_tem_nmsx
  ON public."InventoryEntry" ((upper(split_part(pallet_code, '_', 6))));

-- (2) lot_trace: nhánh prod bỏ mọi ràng buộc — có điều kiện nào dùng điều kiện đó (chữ ký GIỮ
--     NGUYÊN 13 tham số của 20260901d nên CREATE OR REPLACE an toàn, không tạo overload).
--     Ngày đủ 2 đầu ≤92 ngày → OR tiền tố ddmmyy_% (nhanh nhất); còn lại lọc production_date.
--     Tập mã kẹp 5000 (chỉ chọn 1 tiêu chí rất rộng, vd mỗi Kho SX, thì phần sau vẫn sống).
CREATE OR REPLACE FUNCTION public.lot_trace(
  p_kind        text,
  p_value       text,
  p_prod_from   date DEFAULT NULL, p_prod_to date DEFAULT NULL,
  p_ship_from   date DEFAULT NULL, p_ship_to date DEFAULT NULL,
  p_wh_ids      text[] DEFAULT NULL,
  p_categories  text[] DEFAULT NULL,
  p_limit       int DEFAULT 500,
  p_codes       text[] DEFAULT NULL,
  p_cycle       text DEFAULT NULL,
  p_machine     text DEFAULT NULL,
  p_nmsx        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_val    text := btrim(coalesce(p_value, ''));
  v_codes  text[];
  v_lim    int  := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_ship   jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_nship  int := 0; v_nstock int := 0; v_ncust int := 0; v_ntrip int := 0;
  v_qship  numeric := 0; v_qhand numeric := 0;
  v_where  text;
  v_pref   text;
  v_scope_ship text := '';
  v_scope_stk  text := '';
  v_empty  jsonb := jsonb_build_object('codes', 0, 'shipments', '[]'::jsonb, 'stock', '[]'::jsonb,
                                       'summary', jsonb_build_object('pallets', 0, 'shipments', 0,
                                       'stock_rows', 0, 'customers', 0, 'trips', 0,
                                       'qty_shipped', 0, 'qty_on_hand', 0, 'truncated', false));
BEGIN
  IF p_kind IS NULL OR (p_kind NOT IN ('codes', 'prod') AND v_val = '') THEN RETURN v_empty; END IF;

  IF p_wh_ids   IS NOT NULL THEN
    v_scope_ship := v_scope_ship || format(' AND g.warehouse_id = ANY(%L::text[])', p_wh_ids);
    v_scope_stk  := v_scope_stk  || format(' AND ie.warehouse_id = ANY(%L::text[])', p_wh_ids);
  END IF;
  IF p_ship_from IS NOT NULL THEN v_scope_ship := v_scope_ship || format(' AND g.delivery_date >= %L', p_ship_from); END IF;
  IF p_ship_to   IS NOT NULL THEN v_scope_ship := v_scope_ship || format(' AND g.delivery_date <= %L', p_ship_to);   END IF;
  IF p_categories IS NOT NULL THEN
    v_scope_stk := v_scope_stk || format(' AND (m.category IS NULL OR m.category = ANY(%L::text[]))', p_categories);
  END IF;

  IF p_kind = 'codes' THEN
    v_codes := p_codes[1:200];
  ELSIF p_kind = 'prod' THEN
    v_where := 'true';
    IF btrim(coalesce(p_cycle, '')) <> '' THEN
      v_where := v_where || format(
        ' AND coalesce(nullif(ltrim(split_part(ie.pallet_code, ''_'', 3), ''0''), ''''), ''0'') = %L',
        coalesce(nullif(ltrim(btrim(p_cycle), '0'), ''), '0'));
    END IF;
    IF btrim(coalesce(p_machine, '')) <> '' THEN
      v_where := v_where || format(' AND upper(split_part(ie.pallet_code, ''_'', 4)) = %L', upper(btrim(p_machine)));
    END IF;
    IF btrim(coalesce(p_nmsx, '')) <> '' THEN
      v_where := v_where || format(' AND upper(split_part(ie.pallet_code, ''_'', 6)) = %L', upper(btrim(p_nmsx)));
    END IF;
    IF p_prod_from IS NOT NULL AND p_prod_to IS NOT NULL
       AND p_prod_to >= p_prod_from AND (p_prod_to - p_prod_from) <= 92 THEN
      SELECT ' AND (' || string_agg(format('ie.pallet_code LIKE %L', to_char(g.d::date, 'DDMMYY') || '_%'), ' OR ') || ')'
        INTO v_pref
        FROM generate_series(p_prod_from::timestamp, p_prod_to::timestamp, interval '1 day') AS g(d);
      v_where := v_where || v_pref;
    ELSE
      IF p_prod_from IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date >= %L', p_prod_from); END IF;
      IF p_prod_to   IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date <= %L', p_prod_to);   END IF;
    END IF;
    IF v_where = 'true' THEN RETURN v_empty; END IF;   -- không có điều kiện nào = không có gì để tìm
    EXECUTE
      'SELECT array_agg(x.code) FROM (
         SELECT DISTINCT ie.pallet_code AS code
           FROM "InventoryEntry" ie
           LEFT JOIN "Material" m ON m.id = ie.material_id
          WHERE ' || v_where || v_scope_stk || '
          LIMIT 5000) x'
      INTO v_codes;
  ELSIF p_kind IN ('npp', 'trip', 'plate') THEN
    v_where := CASE p_kind
      WHEN 'npp'   THEN format('d.distributor_name ILIKE %L', '%' || v_val || '%')
      WHEN 'trip'  THEN format('g.group_code = %L', v_val)
      ELSE format('upper(regexp_replace(coalesce(g.license_plate, %L), %L, %L, %L)) = %L',
                  '', '[^A-Za-z0-9]', '', 'g', upper(regexp_replace(v_val, '[^A-Za-z0-9]', '', 'g')))
    END;
    EXECUTE
      'SELECT array_agg(DISTINCT e.pallet_code)
         FROM "OutboundDelivery" d
         JOIN "GroupDeliveryOrder" g ON g.id = d.gdo_id
         JOIN "OutboundItem" oi      ON oi.do_id = d.id
         JOIN "OutboundScanEntry" e  ON e.item_id = oi.id
        WHERE ' || v_where || v_scope_ship
      INTO v_codes;
  ELSE
    v_where := CASE p_kind
      WHEN 'pallet'   THEN format('ie.pallet_code LIKE %L', v_val || '%')
      WHEN 'batch'    THEN format('ie.batch = %L', v_val)
      WHEN 'material' THEN format('m.material_code = %L', v_val)
      ELSE NULL END;
    IF v_where IS NULL THEN RETURN v_empty; END IF;
    IF p_prod_from IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date >= %L', p_prod_from); END IF;
    IF p_prod_to   IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date <= %L', p_prod_to);   END IF;
    EXECUTE
      'SELECT array_agg(DISTINCT ie.pallet_code)
         FROM "InventoryEntry" ie
         LEFT JOIN "Material" m ON m.id = ie.material_id
        WHERE ' || v_where || v_scope_stk
      INTO v_codes;
  END IF;

  IF v_codes IS NULL OR array_length(v_codes, 1) IS NULL THEN RETURN v_empty; END IF;

  EXECUTE
    'WITH s AS (
       SELECT e.pallet_code, e.cartons_scanned, e.scanned_at, e.pct_date,
              ie.production_date, ie.expiry_date, ie.batch,
              coalesce(m.material_code, oi.material_code_raw) AS material_code, m.short_name,
              g.group_code, g.delivery_date, g.license_plate, g.status AS trip_status,
              d.delivery_code, d.distributor_name, w.name AS warehouse_name
         FROM unnest($1::text[]) AS pc(code)
         JOIN "OutboundScanEntry" e  ON e.pallet_code = pc.code
         JOIN "OutboundItem" oi      ON oi.id = e.item_id
         JOIN "OutboundDelivery" d   ON d.id  = oi.do_id
         JOIN "GroupDeliveryOrder" g ON g.id  = d.gdo_id
         LEFT JOIN "InventoryEntry" ie ON ie.id = e.inventory_entry_id
         LEFT JOIN "Material" m        ON m.id  = coalesce(ie.material_id, oi.material_id)
         LEFT JOIN "Warehouse" w       ON w.id  = g.warehouse_id
        WHERE true' || v_scope_ship || '
     ), t AS (SELECT s.*, row_number() OVER (ORDER BY s.scanned_at DESC NULLS LAST) rn FROM s)
     SELECT count(*)::int, coalesce(sum(t.cartons_scanned), 0),
            count(DISTINCT t.distributor_name)::int, count(DISTINCT t.group_code)::int,
            coalesce(jsonb_agg(to_jsonb(t) - ''rn'' ORDER BY t.scanned_at DESC NULLS LAST)
                     FILTER (WHERE t.rn <= $2), ''[]''::jsonb)
       FROM t'
    INTO v_nship, v_qship, v_ncust, v_ntrip, v_ship
    USING v_codes, v_lim;

  EXECUTE
    'WITH k AS (
       SELECT ie.pallet_code, ie.cartons_remaining, ie.status, ie.production_date, ie.expiry_date,
              ie.batch, ie.import_date, m.material_code, m.short_name,
              w.name AS warehouse_name, l.location_code
         FROM unnest($1::text[]) AS pc(code)
         JOIN "InventoryEntry" ie ON ie.pallet_code = pc.code
         LEFT JOIN "Material" m  ON m.id = ie.material_id
         LEFT JOIN "Warehouse" w ON w.id = ie.warehouse_id
         LEFT JOIN "Location" l  ON l.id = ie.location_id
        WHERE ie.cartons_remaining > 0' || v_scope_stk || '
     ), t AS (SELECT k.*, row_number() OVER (ORDER BY k.pallet_code) rn FROM k)
     SELECT count(*)::int, coalesce(sum(t.cartons_remaining), 0),
            coalesce(jsonb_agg(to_jsonb(t) - ''rn'' ORDER BY t.pallet_code)
                     FILTER (WHERE t.rn <= $2), ''[]''::jsonb)
       FROM t'
    INTO v_nstock, v_qhand, v_stock
    USING v_codes, v_lim;

  RETURN jsonb_build_object(
    'codes', array_length(v_codes, 1), 'shipments', v_ship, 'stock', v_stock,
    'summary', jsonb_build_object(
      'pallets', array_length(v_codes, 1), 'shipments', v_nship, 'stock_rows', v_nstock,
      'customers', v_ncust, 'trips', v_ntrip, 'qty_shipped', v_qship, 'qty_on_hand', v_qhand,
      'truncated', (v_nship > v_lim OR v_nstock > v_lim)));
END $fn$;

-- (3) trace_suggest: thêm 3 kiểu gợi ý cho dropdown Chu kỳ / Máy / Kho SX (danh mục nhỏ — rỗng
--     vẫn gợi ý). Nguồn: Chu kỳ + Máy từ Sổ đóng gói (packing_runs) ∪ danh mục máy
--     (warehouse_machines); Kho SX từ Warehouse.nmsx_code. Giá trị chưa từng có trong nguồn vẫn
--     dùng được — FE chèn dòng 'Dùng "…"' từ chính từ khóa đang gõ.
CREATE OR REPLACE FUNCTION public.trace_suggest(
  p_kind   text,                -- pallet | material | batch | npp | trip | plate | cycle | machine | nmsx
  p_search text DEFAULT NULL,
  p_limit  int  DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  s   text := btrim(coalesce(p_search, ''));
  lim int  := least(greatest(coalesce(p_limit, 50), 1), 100);
  v   jsonb := '[]'::jsonb;
BEGIN
  IF p_kind = 'material' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.c, 'label', x.l)), '[]') INTO v FROM (
      SELECT m.material_code c, m.material_code || ' — ' || coalesce(m.short_name, m.material_description, '') l
        FROM "Material" m
       WHERE m.is_active IS NOT FALSE
         AND (s = '' OR m.material_code ILIKE '%' || s || '%'
              OR m.short_name ILIKE '%' || s || '%' OR m.material_description ILIKE '%' || s || '%')
       ORDER BY m.material_code LIMIT lim) x;
  ELSIF p_kind = 'cycle' THEN
    -- chu kỳ so DẠNG CHUẨN (bỏ 0 dẫn đầu, "055" ≡ "55"); sắp theo số (độ dài rồi giá trị)
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', y.c, 'label', y.c)), '[]') INTO v FROM (
      SELECT x.c FROM (
        SELECT DISTINCT coalesce(nullif(ltrim(btrim(pr.cycle), '0'), ''), '0') c
          FROM packing_runs pr
         WHERE pr.cycle IS NOT NULL AND btrim(pr.cycle) <> ''
           AND (s = '' OR coalesce(nullif(ltrim(btrim(pr.cycle), '0'), ''), '0') ILIKE s || '%')) x
       ORDER BY length(x.c), x.c LIMIT lim) y;
  ELSIF p_kind = 'machine' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', y.m, 'label', y.m)), '[]') INTO v FROM (
      SELECT DISTINCT upper(btrim(u.code)) m FROM (
        SELECT wm.code FROM warehouse_machines wm
        UNION ALL
        SELECT pr.machine_code AS code FROM packing_runs pr) u
       WHERE u.code IS NOT NULL AND btrim(u.code) <> ''
         AND (s = '' OR upper(btrim(u.code)) LIKE upper(s) || '%')
       ORDER BY 1 LIMIT lim) y;
  ELSIF p_kind = 'nmsx' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', y.c, 'label', y.l)), '[]') INTO v FROM (
      SELECT DISTINCT ON (upper(w.nmsx_code))
             upper(w.nmsx_code) c, upper(w.nmsx_code) || ' — ' || w.name l
        FROM "Warehouse" w
       WHERE w.nmsx_code IS NOT NULL AND btrim(w.nmsx_code) <> ''
         AND (s = '' OR w.nmsx_code ILIKE s || '%' OR w.name ILIKE '%' || s || '%')
       ORDER BY upper(w.nmsx_code), w.name LIMIT lim) y;
  ELSIF s = '' THEN
    RETURN v;   -- các kiểu còn lại quét bảng GIAO DỊCH lớn — bắt buộc có từ khóa mới tìm
  ELSIF p_kind = 'pallet' THEN
    EXECUTE format(
      'SELECT coalesce(jsonb_agg(jsonb_build_object(''value'', x.pc, ''label'', x.pc)), ''[]'') FROM (
         SELECT DISTINCT ie.pallet_code pc FROM "InventoryEntry" ie
          WHERE ie.pallet_code LIKE %L ORDER BY 1 LIMIT %s) x', s || '%', lim)
      INTO v;
  ELSIF p_kind = 'batch' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.b, 'label', x.b)), '[]') INTO v FROM (
      SELECT DISTINCT ie.batch b FROM "InventoryEntry" ie
       WHERE ie.batch IS NOT NULL AND ie.batch ILIKE '%' || s || '%' ORDER BY 1 LIMIT lim) x;
  ELSIF p_kind = 'npp' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.n, 'label', x.n)), '[]') INTO v FROM (
      SELECT DISTINCT d.distributor_name n FROM "OutboundDelivery" d
       WHERE d.distributor_name IS NOT NULL AND d.distributor_name ILIKE '%' || s || '%'
       ORDER BY 1 LIMIT lim) x;
  ELSIF p_kind = 'trip' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.g, 'label', x.g)), '[]') INTO v FROM (
      SELECT DISTINCT g.group_code g FROM "GroupDeliveryOrder" g
       WHERE g.group_code ILIKE '%' || s || '%' ORDER BY 1 DESC LIMIT lim) x;
  ELSIF p_kind = 'plate' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.p, 'label', x.p)), '[]') INTO v FROM (
      SELECT DISTINCT g.license_plate p FROM "GroupDeliveryOrder" g
       WHERE g.license_plate IS NOT NULL
         AND upper(regexp_replace(g.license_plate, '[^A-Za-z0-9]', '', 'g'))
             LIKE '%' || upper(regexp_replace(s, '[^A-Za-z0-9]', '', 'g')) || '%'
       ORDER BY 1 LIMIT lim) x;
  END IF;
  RETURN v;
END $fn$;


COMMIT;
-- === HẾT PART 3/10 ===
