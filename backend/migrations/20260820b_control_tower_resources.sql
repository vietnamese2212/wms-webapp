-- 20/08/2026 — Control Tower kiểu Manhattan Facility Console: khối RESOURCES + cycle-time.
-- RPC MỚI cộng thêm (không đụng control_tower_stats đang chạy — additive, lỗi thì FE tự ẩn khối):
--   staff_out  : người quét XUẤT hôm nay (distinct + số lượt) + top 5 theo lượt quét
--   staff_in   : người tạo pallet NHẬP hôm nay + số pallet
--   stocktake  : người kiểm/chuyển hôm nay + lượt kiểm + lượt chuyển vị trí
--   forklift   : xe nâng ACTIVE / IDLE / CHƯA CHECK + tổng lỗi hạng mục hôm nay
--   inventory  : tồn sống tổng vs bị GIỮ (QA giữ / QUARANTINE) — "Good vs Locked Inventory"
--   gate_cycle : chu trình cổng hôm nay — Đăng ký→Vào TB (phút) · Vào→Ra TB (phút) · số xe đã ra
-- Chỉ lọc theo KHO (p_warehouse_ids) — khối resources không cắt theo Loại kho (nhân sự/xe nâng
-- không mang loại hàng; FE ghi chú rõ). Bẫy naive-UTC: OutboundScanEntry.scanned_at là timestamp
-- KHÔNG tz chứa UTC → so với t0/t1 (naive UTC); cột timestamptz (counted_at, entry_at) so z0/z1.
CREATE OR REPLACE FUNCTION public.control_tower_resources(
  p_warehouse_ids text[] DEFAULT NULL::text[],
  p_today date DEFAULT NULL::date
) RETURNS jsonb
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
         count(*) filter (where qa_status_id is not null or status = 'QUARANTINE') as locked
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

-- Bảo mật (bài học 20260815i): Postgres mặc định GRANT EXECUTE cho PUBLIC trên hàm mới —
-- thu hồi rồi cấp lại đúng service_role (mọi lời gọi đi qua backend).
REVOKE ALL ON FUNCTION public.control_tower_resources(text[], date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.control_tower_resources(text[], date) TO service_role;
