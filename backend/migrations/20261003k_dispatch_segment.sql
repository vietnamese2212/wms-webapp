-- 03/10/2026 tối — MẢNG ĐIỀU VẬN (user: "một kế hoạch tổng, mỗi người lo một mảng: Trung chuyển và Bán hàng; khách setting Trung chuyển tự
-- vào Trung chuyển, còn lại Bán hàng; user lấy được DO của bên kia về mình; lên kế hoạch riêng cho hai mảng") + tab "Không liên quan"
-- theo TỪNG NGƯỜI (user: "user 1 loại DO khỏi kế hoạch cho lần điều đó, chỉ mình user 1 thấy là đã loại, user khác vẫn làm bình thường").
BEGIN;

-- 1. Khách hàng: ô tick "Trung chuyển" — nguồn DUY NHẤT quyết mảng mặc định của đơn (STO của NPP vẫn là Bán hàng, user chốt).
ALTER TABLE public."Customer" ADD COLUMN IF NOT EXISTS dispatch_transfer boolean NOT NULL DEFAULT false;
-- seed một lần: khách là KHO của mình (trỏ kho) + ba kho LOF Bàu Bàng · Đà Nẵng · Ba Vì theo tên; phần còn lại user tự tick
UPDATE public."Customer" SET dispatch_transfer = true
 WHERE dispatch_transfer = false
   AND (warehouse_id IS NOT NULL OR name ILIKE '%kho ba vì%' OR name ILIKE '%kho bàu bàng%' OR name ILIKE '%bau bang%' OR name ILIKE '%đà nẵng%' OR name ILIKE '%da nang%');

-- 2. Kế hoạch điều vận theo MẢNG: một nháp mở mỗi kho × ngày × mảng. Kế hoạch cũ = Bán hàng.
ALTER TABLE public.dispatch_plan ADD COLUMN IF NOT EXISTS segment text NOT NULL DEFAULT 'SALES';
ALTER TABLE public.dispatch_plan DROP CONSTRAINT IF EXISTS dispatch_plan_segment_check;
ALTER TABLE public.dispatch_plan ADD CONSTRAINT dispatch_plan_segment_check CHECK (segment IN ('TRANSFER', 'SALES'));

-- 3. Dấu "lấy sang mảng khác" theo (kho, OD) — thắng ô tick của khách; giữ qua mọi lần nạp ZSD02 / lập lại.
CREATE TABLE IF NOT EXISTS public.dispatch_od_segment (
  id           uuid PRIMARY KEY,
  warehouse_id text NOT NULL REFERENCES public."Warehouse"(id) ON DELETE CASCADE,
  od_number    text NOT NULL,
  segment      text NOT NULL CHECK (segment IN ('TRANSFER', 'SALES')),
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispatch_od_segment ON public.dispatch_od_segment (warehouse_id, od_number);
ALTER TABLE public.dispatch_od_segment ENABLE ROW LEVEL SECURITY;

-- 4. "Không liên quan" theo TỪNG NGƯỜI trên MỘT kế hoạch: đơn vẫn nằm trong kế hoạch (người khác thấy, máy của người khác ghép),
--    chỉ người đánh dấu không thấy ở Điều và máy ghép của người đó bỏ qua. Xoá theo kế hoạch.
CREATE TABLE IF NOT EXISTS public.dispatch_od_hidden (
  id           uuid PRIMARY KEY,
  plan_id      uuid NOT NULL REFERENCES public.dispatch_plan(id) ON DELETE CASCADE,
  od_number    text NOT NULL,
  user_id      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispatch_od_hidden ON public.dispatch_od_hidden (plan_id, od_number, user_id);
ALTER TABLE public.dispatch_od_hidden ENABLE ROW LEVEL SECURITY;

-- 5. RPC đếm OD mới (cửa /sync) biết MẢNG: bản 7 tham số DROP (PostgREST chọn hàm theo tên tham số — để hai bản là chạy bản cũ),
--    bản mới thêm p_segment (NULL = không lọc). Mảng của OD = dấu lấy sang (kho, OD) → ô tick Trung chuyển của khách → Bán hàng.
DROP FUNCTION IF EXISTS public.dispatch_new_ods(text, date, date, date, text[], text, uuid);
CREATE OR REPLACE FUNCTION public.dispatch_new_ods(
  p_plant text, p_from date, p_to date, p_day date, p_slocs text[], p_warehouse_id text, p_plan_id uuid, p_segment text
) RETURNS text[]
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT e.od_number, e.delivery_date, e.flow, e.material_code, e.ship_to_code
      FROM public.erp_outbound_orders e
     WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL
       AND e.delivery_date >= p_from AND e.delivery_date <= p_to
       AND (coalesce(cardinality(p_slocs), 0) = 0 OR e.storage_location IS NULL OR upper(trim(e.storage_location)) = ANY (p_slocs))
       AND (e.delivery_date = p_day OR e.flow IN ('SALE', 'STO', 'INTERNAL', 'PALLET'))
  ), od AS (
    SELECT r.od_number, min(r.ship_to_code) AS ship_to_code,
           bool_or(r.flow IN ('SALE', 'STO', 'INTERNAL', 'PALLET')) AS loadable,
           bool_or(r.material_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public."Material" m WHERE m.material_code = r.material_code)) AS missing_mat
      FROM r GROUP BY r.od_number
  ), seg AS (
    SELECT od.od_number, coalesce(s.segment, CASE WHEN c.dispatch_transfer THEN 'TRANSFER' ELSE 'SALES' END, 'SALES') AS segment
      FROM od
      LEFT JOIN public.dispatch_od_segment s ON s.warehouse_id = p_warehouse_id AND s.od_number = od.od_number
      LEFT JOIN public."Customer" c ON c.ship_to_code = od.ship_to_code
  )
  SELECT coalesce(array_agg(od.od_number ORDER BY od.od_number), '{}'::text[])
    FROM od JOIN seg ON seg.od_number = od.od_number
   WHERE od.loadable AND NOT od.missing_mat
     AND (p_segment IS NULL OR seg.segment = p_segment)
     AND NOT EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.do_no = od.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE')
     AND NOT EXISTS (SELECT 1 FROM public.dispatch_od_hold h WHERE h.warehouse_id = p_warehouse_id AND h.od_number = od.od_number
                        AND (h.hold_until IS NULL OR h.hold_until > p_day))
     AND NOT EXISTS (SELECT 1 FROM public.dispatch_od_outside x WHERE x.warehouse_id = p_warehouse_id AND x.od_number = od.od_number)
     AND NOT EXISTS (SELECT 1 FROM public.dispatch_trip_od o JOIN public.dispatch_plan p ON p.id = o.plan_id JOIN public.dispatch_trip t ON t.id = o.trip_id
                      WHERE o.od_number = od.od_number AND o.plan_id <> p_plan_id AND o.trip_id IS NOT NULL
                        AND p.status IN ('DRAFT', 'TENDERED') AND t.status <> 'DISCARDED')
     AND NOT EXISTS (SELECT 1 FROM public.dispatch_trip_od o WHERE o.plan_id = p_plan_id AND o.od_number = od.od_number)
     AND NOT EXISTS (SELECT 1 FROM public.erp_outbound_orders old JOIN public.khvc_lines k ON k.do_no = old.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE'
                      WHERE old.replaced_by_od = od.od_number)
$$;

COMMIT;
