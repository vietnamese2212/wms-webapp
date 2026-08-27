-- 20260827 — NĂNG SUẤT KHO theo khoảng ngày (user chốt 27/08: tab riêng trong Dashboard,
-- kiểu tab Nhập/Xuất/Tồn kho).
--
-- CHỐT NGUỒN SỐ (user chọn trong brainstorm 27/08):
--   · TẤN = CHỨNG TỪ, cộng CẢ HAI CHIỀU nhập + xuất (bốc hàng nhập cũng là công) — không lấy
--     phiếu cân vì chỉ kho có trạm cân mới có số (đo T8 staging: cân xuất 12.406t so chứng từ
--     19.105t ⇒ kho không có trạm sẽ trống trơn).
--   · CÔNG = module Chấm công (`Attendance`) — ngày công = CA1/CA2/CA3/HC, LEAVE không tính;
--     tổng giờ = ngày công × giờ chuẩn + OT − về sớm (ĐÚNG công thức `reportAttendance` đang dùng,
--     giờ chuẩn truyền vào từ cờ `standard_work_hours` để KHÔNG có bản sao mặc định thứ hai trong SQL).
--
-- QUY ƯỚC ĐƠN VỊ (base-unit): `cartons_imported`/`cartons_scanned` là BASE; `Material.weight_kg`
-- là KL của MỘT THÙNG (entry) — đúng như `gdo_weight_estimates` đang tính. ⇒ tấn = base ÷ units_per_carton
-- × weight_kg ÷ 1000. Mã chưa khai KL KHÔNG được coi là 0 âm thầm: đếm riêng `lines_no_weight`
-- để màn hình nói ra "có N dòng chưa khai khối lượng".
--
-- HIỆU NĂNG: 4 nguồn đều gom theo (kho, THÁNG) MỘT LƯỢT rồi mới tổng hợp 2 chiều (theo kho /
-- theo tháng) — không quét lại lần hai chỉ để vẽ biểu đồ xu hướng. Lọc ngày trên cột THÔ
-- (`>= p_from`, `< p_to + 1`) chứ không `::date` để còn dùng được index sẵn có
-- (idx_ie_wh_importdate, idx_gdo_wh_deliverydate, idx_attendance_date).
--
-- SCOPE: kho + loại hàng cắt như mọi RPC khác (null-inclusive với loại). ⚠️ CHẤM CÔNG KHÔNG CÓ
-- LOẠI HÀNG — một người bốc cả FG lẫn POSM, không tách được. Nên khi lọc theo loại thì TẤN bị cắt
-- mà CÔNG thì không ⇒ trả cờ `categories_filtered` để màn hình nói rõ, đừng để người đọc tưởng
-- năng suất tụt.

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
-- Kho trong phạm vi — dòng nào cũng phải hiện dù kỳ đó không có việc (0 tấn vẫn là thông tin)
wh as (
  select w.id, w.name
  from "Warehouse" w
  where (p_warehouse_ids is null or w.id = any(p_warehouse_ids))
),
-- NHẬP: dòng tồn tạo trong kỳ. import_date là NGÀY nghiệp vụ VN lưu dạng timestamp lúc 00:00.
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
-- XUẤT: lấy số THỰC XUẤT (cartons_scanned) — năng suất là việc ĐÃ LÀM, không phải kế hoạch.
-- Chuyến đã huỷ không tính. Ngày quy về `delivery_date` (ngày xe chạy — cùng cột cả app đang lọc).
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
-- CÔNG: kho của dòng chấm công; dòng chưa gắn kho thì lấy kho của nhân sự (đừng để công rơi ra
-- ngoài mọi kho rồi tử số có mà mẫu số không).
lab as (
  select coalesce(a.warehouse_id, e.warehouse_id)::text as wid,
         date_trunc('month', a.work_date)::date         as mon,
         count(*) filter (where a.kind in ('CA1','CA2','CA3','HC'))                    as work_days,
         count(distinct a.employee_id) filter (where a.kind in ('CA1','CA2','CA3','HC')) as headcount,
         count(*) filter (where a.kind = 'LEAVE')                                      as leave_days,
         coalesce(sum(a.ot_hours), 0)                                                  as ot_hours,
         coalesce(sum(a.early_leave_hours), 0)                                         as early_hours
  from "Attendance" a
  left join "Employee" e on e.id = a.employee_id
  where a.work_date between p_from and p_to
    and (p_warehouse_ids is null or coalesce(a.warehouse_id, e.warehouse_id)::text = any(p_warehouse_ids))
  group by 1, 2
),
-- Gộp 4 nguồn về lưới (kho × tháng) — mọi tổng hợp phía sau đọc từ đây
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
-- Theo KHO (mọi kho trong phạm vi, kể cả kho không phát sinh)
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
         coalesce(sum(c.lines_no_weight), 0)   as lines_no_weight
  from wh w
  left join cell c on c.wid = w.id
  group by w.id, w.name
),
-- Theo THÁNG (xu hướng) — cùng một lượt quét, không truy vấn lại
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
      'lines_no_weight', r.lines_no_weight
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
      'leave_days',      coalesce(sum(r.leave_days), 0),
      'headcount',       coalesce(sum(r.headcount), 0),
      'lines_no_weight', coalesce(sum(r.lines_no_weight), 0),
      'warehouses_no_labor', coalesce(count(*) filter (where r.work_days = 0 and (r.tons_in + r.tons_out) > 0), 0)
    ) from per_wh r)
);
$function$;

COMMENT ON FUNCTION public.warehouse_productivity(text[], text[], date, date, numeric) IS
  'Năng suất kho theo khoảng ngày: tấn nhập/xuất (chứng từ, base ÷ upc × weight_kg), số chuyến, ngày công/giờ công/OT từ Attendance. Gom theo (kho × tháng) 1 lượt rồi tổng hợp 2 chiều.';

-- CACHE — dùng LẠI bảng `dashboard_cache` + cờ `dashboard_cache_seconds` của trang chủ (20260821f),
-- không đẻ cơ chế cache thứ hai. Đo trên dữ liệu lớn staging (145k dòng): 1 tháng ~320-400ms,
-- 12 tháng ~1,65s — không nặng như dashboard_all nhưng vẫn là tổng hợp toàn công ty, mà tab này
-- ai mở cũng chạy lại y hệt nhau. p_ttl_seconds <= 0 ⇒ bỏ qua cache (giữ đường cũ nguyên vẹn).
CREATE OR REPLACE FUNCTION public.warehouse_productivity_cached(
  p_warehouse_ids text[]  DEFAULT NULL::text[],
  p_categories    text[]  DEFAULT NULL::text[],
  p_from          date    DEFAULT NULL::date,
  p_to            date    DEFAULT NULL::date,
  p_std_hours     numeric DEFAULT 8,
  p_ttl_seconds   int     DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_key  text;
  v_hit  jsonb;
  v_calc jsonb;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RETURN warehouse_productivity(p_warehouse_ids, p_categories, p_from, p_to, p_std_hours);
  END IF;

  -- Khoá = ĐÚNG bộ tham số; sắp mảng để 2 user cùng phạm vi (khác thứ tự id) dùng chung 1 dòng.
  v_key := 'prod|' || md5(
       coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p_warehouse_ids) x), '*')
    || '|' || coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p_categories) x), '*')
    || '|' || coalesce(p_from::text, '*') || '|' || coalesce(p_to::text, '*')
    || '|' || coalesce(p_std_hours::text, '*'));

  SELECT payload INTO v_hit FROM public.dashboard_cache
   WHERE key = v_key AND computed_at > now() - make_interval(secs => p_ttl_seconds);
  IF v_hit IS NOT NULL THEN
    RETURN v_hit || jsonb_build_object('cached', true);
  END IF;

  v_calc := warehouse_productivity(p_warehouse_ids, p_categories, p_from, p_to, p_std_hours);
  INSERT INTO public.dashboard_cache(key, payload, computed_at) VALUES (v_key, v_calc, now())
  ON CONFLICT (key) DO UPDATE SET payload = excluded.payload, computed_at = excluded.computed_at;
  RETURN v_calc;
END;
$$;
