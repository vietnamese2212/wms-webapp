-- QA "OK" KHÔNG PHẢI LÀ GIỮ HÀNG — một nguồn cho luật "pallet có bị QA giữ không".
--
-- VÌ SAO (đo staging 13/09/2026): danh mục QAStatus có 4 mã — X · XCQ (X cảm quan) · X7 (X 7 ngày)
-- là GIỮ, còn **OK là ĐÃ DUYỆT**. Cửa QUÉT XUẤT vốn hiểu đúng (`qa_status.code <> 'OK'`) nhưng
-- mọi cửa THỐNG KÊ / CHỈ ĐƯỜNG lại coi "có giá trị = đang giữ" ⇒ cùng một pallet: quét thì xuất
-- được, mà Giám sát vận hành đếm là "kẹt" và bộ sinh việc bảo "hết hàng".
--
-- Số đo trước khi vá (Kho Ba Vì, tồn > 0):
--   • Giám sát vận hành "kẹt": 8.760 pallet — thực tế bị giữ chỉ 5
--   • Vị trí bị coi là QA giữ: 227/230 — thực tế 4
--   • 83 mã không chốt được BẤT KỲ mức %Date nào dù kho còn hàng xuất được
-- Không phải rác dữ liệu: quét nhập tem V2 (`;`) TỰ đóng dấu OK (`qa_ok ? 'OK' : 'X'`), nên đơn vị
-- dùng tem chấm phẩy sẽ có 100 % tồn vô hình. Migration đầu tiên cũng đã ghi rõ ý định:
-- "bỏ trống = mặc định OK, không cần lưu vào qa_status_id" ⇒ dấu OK phải được coi NHƯ BỎ TRỐNG.
--
-- Bản TypeScript của cùng luật: backend/src/services/qaStatus.ts (`qaHoldIds` / `qaNotHeldFilter`).
-- Thêm chỗ đọc QA mới → gọi `public.qa_is_hold()`, ĐỪNG viết lại `qa_status_id IS NOT NULL`.

CREATE OR REPLACE FUNCTION public.qa_is_hold(p_qa_status_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT p_qa_status_id IS NOT NULL
     AND coalesce((SELECT q.code FROM public."QAStatus" q WHERE q.id = p_qa_status_id), 'X') <> 'OK';
$function$;

COMMENT ON FUNCTION public.qa_is_hold(text) IS
  'Pallet có đang bị QA GIỮ không. Dấu OK = đã duyệt (xuất được); không tra được mã coi như giữ.';

-- ── control_tower_resources ──
CREATE OR REPLACE FUNCTION public.control_tower_resources(p_warehouse_ids text[] DEFAULT NULL::text[], p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
with day_range as (
  select ((p_today::timestamp at time zone 'Asia/Ho_Chi_Minh') at time zone 'UTC')       as t0,  -- naive UTC
         (((p_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') at time zone 'UTC') as t1,
         (p_today::timestamp at time zone 'Asia/Ho_Chi_Minh')       as z0,                        -- timestamptz
         ((p_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') as z1
),
scan_today as (
  select se.scanned_by
  from "OutboundScanEntry" se, day_range r
  where se.scanned_at >= r.t0 and se.scanned_at < r.t1
    and (p_warehouse_ids is null or exists (
      select 1 from "OutboundItem" oi
      join "OutboundDelivery" d on d.id = oi.do_id
      join "GroupDeliveryOrder" g on g.id = d.gdo_id
      where oi.id = se.item_id and g.warehouse_id = any(p_warehouse_ids)))
),
staff_out as (
  select count(distinct scanned_by) as n, count(*) as scans from scan_today where scanned_by is not null
),
top_out as (
  select coalesce(e.name, '—') as name, count(*) as scans
  from scan_today s
  left join "Employee" e on e.id::text = s.scanned_by
  where s.scanned_by is not null
  group by 1 order by 2 desc limit 5
),
staff_in as (
  select count(distinct ie.created_by) filter (where ie.created_by is not null) as n,
         count(*) as pallets
  from "InventoryEntry" ie
  where ie.import_date::date = p_today
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
),
stk as (
  select count(distinct st.counted_by) filter (where st.counted_by is not null) as n,
         count(*) as checks,
         count(*) filter (where st.location_changed_to is not null) as moves
  from "StocktakeLog" st, day_range r
  where st.counted_at >= r.z0 and st.counted_at < r.z1
    and (p_warehouse_ids is null or st.warehouse_id = any(p_warehouse_ids))
),
fk as (
  select l.status, coalesce(l.issue_count, 0) as issue_count, (l.id is not null) as checked
  from forklift_vehicles v
  left join forklift_daily_logs l on l.forklift_id = v.id and l.log_date = p_today
  where coalesce(v.is_active, true)
    and (p_warehouse_ids is null or v.warehouse_id = any(p_warehouse_ids))
),
fk_agg as (
  select count(*) as total,
         count(*) filter (where status = 'ACTIVE') as active,
         count(*) filter (where status = 'IDLE')   as idle,
         count(*) filter (where not checked)       as unchecked,
         coalesce(sum(issue_count), 0)             as issues
  from fk
),
inv as (
  select count(*) as total,
         count(*) filter (where public.qa_is_hold(ie.qa_status_id) or ie.status = 'QUARANTINE') as locked
  from "InventoryEntry" ie
  where ie.cartons_remaining > 0
    and ie.status in ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
),
gate_cycle as (
  select count(*) filter (where exit_at is not null)                                    as done_n,
         round(avg(extract(epoch from (exit_at - entry_at)) / 60)
               filter (where exit_at is not null and exit_at > entry_at))               as inout_mins,
         round(avg(extract(epoch from (entry_at - registered_at)) / 60)
               filter (where registered_at is not null and entry_at > registered_at))   as wait_mins
  from gate_registrations g
  where g.date = p_today and g.entry_at is not null
    and (p_warehouse_ids is null or g.warehouse_id = any(p_warehouse_ids))
)
select jsonb_build_object(
  'staff_out', (select jsonb_build_object('n', n, 'scans', scans) from staff_out),
  'top_out',   (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'scans', scans) order by scans desc), '[]'::jsonb) from top_out),
  'staff_in',  (select jsonb_build_object('n', coalesce(n, 0), 'pallets', pallets) from staff_in),
  'stocktake', (select jsonb_build_object('n', coalesce(n, 0), 'checks', checks, 'moves', moves) from stk),
  'forklift',  (select jsonb_build_object('total', total, 'active', active, 'idle', idle, 'unchecked', unchecked, 'issues', issues) from fk_agg),
  'inventory', (select jsonb_build_object('total', total, 'locked', locked) from inv),
  'gate_cycle',(select jsonb_build_object('done_n', done_n, 'inout_mins', inout_mins, 'wait_mins', wait_mins) from gate_cycle)
)
$function$;

-- ── outbound_shortage_stats ──
CREATE OR REPLACE FUNCTION public.outbound_shortage_stats(p_warehouse_id text, p_date date)
 RETURNS TABLE(material_id text, demand numeric, available numeric, planned_remaining numeric)
 LANGUAGE sql
 STABLE
AS $function$
WITH demand AS (
  SELECT oi.material_id,
         SUM(GREATEST(COALESCE(oi.cartons_ordered, 0) - COALESCE(oi.cartons_scanned, 0), 0)) AS demand
  FROM "OutboundItem" oi
  JOIN "OutboundDelivery" od ON od.id = oi.do_id
  JOIN "GroupDeliveryOrder" g ON g.id = od.gdo_id
  WHERE g.warehouse_id = p_warehouse_id
    AND g.delivery_date = p_date
    AND g.status <> 'CANCELLED'
    AND oi.material_id IS NOT NULL
  GROUP BY oi.material_id
),
avail AS (
  SELECT ie.material_id, SUM(ie.cartons_remaining) AS available
  FROM "InventoryEntry" ie
  LEFT JOIN "Location" l ON l.id = ie.location_id
  WHERE COALESCE(l.warehouse_id, ie.warehouse_id::text) = p_warehouse_id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING')
    AND ie.cartons_remaining > 0
    AND NOT public.qa_is_hold(ie.qa_status_id)
    AND ie.material_id IN (SELECT d.material_id FROM demand d)
  GROUP BY ie.material_id
),
plan AS (
  SELECT ipl.material_id, ipl.tms_order_id, SUM(COALESCE(ipl.planned_boxes, 0)) AS planned
  FROM inbound_plan_lines ipl
  WHERE ipl.warehouse_id = p_warehouse_id
    AND ipl.status = 'ACTIVE'
    AND ipl.date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    AND ipl.date <= p_date
    AND ipl.material_id IN (SELECT d.material_id FROM demand d)
  GROUP BY ipl.material_id, ipl.tms_order_id
),
received AS (
  SELECT COALESCE(pi.tms_order_id, gr.tms_order_id) AS tms_order_id, pi.material_id,
         SUM(COALESCE(ie.cartons_imported, 0)) AS received
  FROM "ProductionImport" pi
  LEFT JOIN gate_registrations gr ON gr.id = pi.gate_registration_id
  JOIN "InventoryEntry" ie ON ie.import_order_id = pi.id
  WHERE COALESCE(pi.tms_order_id, gr.tms_order_id) IN (SELECT p.tms_order_id FROM plan p WHERE p.tms_order_id IS NOT NULL)
  GROUP BY 1, 2
),
plan_net AS (
  SELECT p.material_id, SUM(GREATEST(p.planned - COALESCE(r.received, 0), 0)) AS planned_remaining
  FROM plan p
  LEFT JOIN received r ON r.tms_order_id = p.tms_order_id AND r.material_id = p.material_id
  GROUP BY p.material_id
)
SELECT d.material_id, d.demand,
       COALESCE(a.available, 0)          AS available,
       COALESCE(pn.planned_remaining, 0) AS planned_remaining
FROM demand d
LEFT JOIN avail a     ON a.material_id = d.material_id
LEFT JOIN plan_net pn ON pn.material_id = d.material_id
WHERE d.demand > 0
$function$;

-- ── putaway_slot_facts ──
CREATE OR REPLACE FUNCTION public.putaway_slot_facts(p_loc_ids text[], p_material_id text DEFAULT NULL::text, p_with_lots boolean DEFAULT false, p_with_mats boolean DEFAULT false)
 RETURNS TABLE(location_id text, pallets integer, materials integer, same_material boolean, qa_hold boolean, nccs uuid[], mats text[], lots jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  WITH live AS (
    SELECT ie.location_id, ie.material_id, ie.ncc_id, ie.qa_status_id,
           ie.production_date, ie.expiry_date, ie.shelf_life_days
    FROM public."InventoryEntry" ie
    WHERE ie.location_id = ANY(p_loc_ids)
      AND ie.stack_layer = 1
      AND ie.status IN ('IN_STOCK', 'PARTIAL')
      AND COALESCE(ie.cartons_remaining, 0) > 0
  ),
  grp AS (
    SELECT l.location_id, l.material_id, l.ncc_id, l.shelf_life_days,
           (l.expiry_date IS NULL)  AS no_exp,
           min(l.production_date)   AS pmin,
           max(l.production_date)   AS pmax,
           min(l.expiry_date)       AS emin,
           max(l.expiry_date)       AS emax
    FROM live l
    GROUP BY l.location_id, l.material_id, l.ncc_id, l.shelf_life_days, (l.expiry_date IS NULL)
  )
  SELECT l.location_id,
         count(*)::int                                                        AS pallets,
         count(DISTINCT l.material_id)::int                                   AS materials,
         bool_or(p_material_id IS NOT NULL AND l.material_id = p_material_id) AS same_material,
         bool_or(public.qa_is_hold(l.qa_status_id))                                  AS qa_hold,
         -- NULL = pallet chưa khai NCC → không kết luận (quy ước null-inclusive toàn app)
         COALESCE(array_remove(array_agg(DISTINCT l.ncc_id), NULL), '{}'::uuid[]) AS nccs,
         CASE WHEN NOT p_with_mats THEN '{}'::text[]
              ELSE COALESCE(array_remove(array_agg(DISTINCT l.material_id), NULL), '{}'::text[])
         END                                                                  AS mats,
         CASE WHEN NOT p_with_lots THEN '[]'::jsonb ELSE COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'm', g.material_id, 'n', g.ncc_id, 's', g.shelf_life_days,
                    'no_exp', g.no_exp, 'pmin', g.pmin, 'pmax', g.pmax,
                    'emin', g.emin, 'emax', g.emax))
           FROM grp g WHERE g.location_id = l.location_id
         ), '[]'::jsonb) END                                                  AS lots
  FROM live l
  GROUP BY l.location_id
$function$;
