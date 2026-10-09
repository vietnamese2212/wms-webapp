-- 09/10/2026 — Pool đơn của điều vận đọc ĐÚNG đơn chưa đi, không quét cả lịch sử (user "ok làm" sau error_logs 503 QUERY_TIMEOUT
-- POST /tms/dispatch/plan 08/10 09:22 · 09/10 07:50 VN và GET plans/:id/backlog).
--
-- Đo staging 09/10: Ba Vì có 16.657 dòng ZSD02 ACTIVE, chỉ 1.920 dòng là đơn CHƯA có trong Kế hoạch xuất. `dispatch_pool_rows` và
-- `dispatch_new_ods` lọc "chưa có trong Kế hoạch xuất" bằng NOT EXISTS trên khvc_lines ⇒ phải đọc HEAP cả 16.657 dòng rộng 1,7 KB
-- (cột raw jsonb) mỗi lần Lập kế hoạch / Tối ưu lại / mở bàn: 35 MB đọc đĩa, cache nguội 3,5 s, dưới tải tới 7,7 s — trần
-- statement_timeout của PostgREST là 8 s ⇒ 503. pg_stat_statements: pool_rows 1.580 lần × 1,1 s · new_ods 841 × 0,7 s.
--
-- Cách chữa: cờ `erp_outbound_orders.in_khvc` (đơn đang có dòng Kế hoạch xuất không OBSOLETE) do TRIGGER hai phía giữ đúng
-- (khvc_lines thêm/sửa/xoá ⇒ đồng bộ cờ của OD cũ và mới; ZSD02 chèn dòng mới ⇒ lấy cờ theo khvc hiện có), chỉ mục một phần trên
-- đơn ACTIVE chưa đi, và hai RPC đọc theo cờ. Nghĩa KHÔNG đổi: "đã điều ngày khác" vẫn không về; "đã điều đúng ngày lập" vẫn về.
-- Bất biến `erp_in_khvc_mismatch()` = 0 (gói 00) gác cờ lệch.
BEGIN;

ALTER TABLE public.erp_outbound_orders ADD COLUMN IF NOT EXISTS in_khvc boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.erp_in_khvc_of(p_od text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.do_no = p_od AND k.sync_status IS DISTINCT FROM 'OBSOLETE')
$$;

-- phía ZSD02: dòng mới / đổi số OD ⇒ cờ theo Kế hoạch xuất hiện có (nạp lại ZSD02 cho đơn đã điều không được làm cờ rơi)
CREATE OR REPLACE FUNCTION public.erp_in_khvc_set() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.in_khvc := NEW.od_number IS NOT NULL AND public.erp_in_khvc_of(NEW.od_number);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_erp_in_khvc_set ON public.erp_outbound_orders;
CREATE TRIGGER trg_erp_in_khvc_set BEFORE INSERT OR UPDATE OF od_number ON public.erp_outbound_orders
  FOR EACH ROW EXECUTE FUNCTION public.erp_in_khvc_set();

-- phía Kế hoạch xuất: thêm / đổi DO / đổi sync_status / xoá ⇒ tính lại cờ của OD cũ lẫn OD mới (chỉ ghi khi đổi)
CREATE OR REPLACE FUNCTION public.khvc_sync_erp_in_khvc() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  od text;
  v boolean;
BEGIN
  FOREACH od IN ARRAY array_remove(ARRAY[CASE WHEN TG_OP <> 'INSERT' THEN OLD.do_no END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.do_no END], NULL) LOOP
    v := public.erp_in_khvc_of(od);
    UPDATE public.erp_outbound_orders e SET in_khvc = v WHERE e.od_number = od AND e.in_khvc IS DISTINCT FROM v;
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_khvc_sync_erp_in_khvc ON public.khvc_lines;
CREATE TRIGGER trg_khvc_sync_erp_in_khvc AFTER INSERT OR UPDATE OF do_no, sync_status OR DELETE ON public.khvc_lines
  FOR EACH ROW EXECUTE FUNCTION public.khvc_sync_erp_in_khvc();

-- dựng cờ một lần cho dữ liệu đang có
UPDATE public.erp_outbound_orders e SET in_khvc = true
 WHERE e.od_number IS NOT NULL AND NOT e.in_khvc
   AND EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.do_no = e.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE');

-- chỉ mục (plant, in_khvc): điều kiện vào Index Cond ⇒ chỉ 1.920 TID của đơn chưa đi, không đọc heap 16.657 dòng.
-- Đo 09/10: bản MỘT PHẦN `(plant, od_number) WHERE … AND NOT in_khvc` planner KHÔNG BAO GIỜ chọn (kể cả có thống kê mở rộng,
-- kể cả tắt bitmap scan) — cùng số phận với idx_erp_ob_plant_dd_active; cột cờ nằm trong khoá chỉ mục thì chọn ngay.
DROP INDEX IF EXISTS public.idx_erp_ob_plant_open;
CREATE INDEX IF NOT EXISTS idx_erp_ob_plant_khvc ON public.erp_outbound_orders (plant, in_khvc);

-- Thống kê MỞ RỘNG (đo 09/10): không có nó planner ước "plant = 1102 AND NOT in_khvc" ≈ 8.277 dòng (một nửa) nên vẫn chọn chỉ mục
-- (plant, updated_at) rồi lọc — đọc đủ 4.461 block heap như cũ. MCV theo bộ (plant, in_khvc, sync_status) cho planner thấy tổ hợp
-- thật (1.920 dòng) ⇒ dùng chỉ mục một phần ở trên. ANALYZE ngay trong migration để có hiệu lực tức thì.
CREATE STATISTICS IF NOT EXISTS public.st_erp_ob_plant_khvc (mcv, dependencies) ON plant, in_khvc, sync_status FROM public.erp_outbound_orders;
ANALYZE public.erp_outbound_orders;

-- bất biến cho gói 00: số dòng ZSD02 có cờ lệch với khvc_lines
CREATE OR REPLACE FUNCTION public.erp_in_khvc_mismatch() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.erp_outbound_orders e
   WHERE e.od_number IS NOT NULL AND e.in_khvc IS DISTINCT FROM public.erp_in_khvc_of(e.od_number)
$$;

-- cửa nạp: chưa đi (cờ) ∪ đã điều ĐÚNG ngày lập (tab Đã điều) — cùng nghĩa bản 20261005f, không quét lịch sử
CREATE OR REPLACE FUNCTION public.dispatch_pool_rows(p_plant text, p_day date, p_warehouse_id text DEFAULT NULL, p_flows text[] DEFAULT NULL)
RETURNS SETOF public.erp_outbound_orders
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT e.* FROM public.erp_outbound_orders e
     WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL AND NOT e.in_khvc
    UNION ALL
    SELECT e.* FROM public.erp_outbound_orders e
     WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL AND e.in_khvc
       AND e.od_number IN (SELECT k.do_no FROM public.khvc_lines k WHERE k.export_date = p_day AND k.sync_status IS DISTINCT FROM 'OBSOLETE')
  )
  SELECT e.* FROM base e
   WHERE (p_flows IS NULL OR e.flow = ANY (p_flows))
     AND (p_warehouse_id IS NULL
          OR e.in_khvc
          OR NOT (EXISTS (SELECT 1 FROM public.dispatch_od_outside x WHERE x.warehouse_id = p_warehouse_id AND x.od_number = e.od_number)
                  OR EXISTS (SELECT 1 FROM public.dispatch_od_hold h WHERE h.warehouse_id = p_warehouse_id AND h.od_number = e.od_number
                                AND (h.hold_until IS NULL OR h.hold_until > p_day)))
          OR EXISTS (SELECT 1 FROM public.erp_outbound_orders o JOIN public.khvc_lines k ON k.do_no = o.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE'
                      WHERE o.replaced_by_od = e.od_number))
$$;

-- cửa /sync "OD mới": chỉ đơn chưa đi ngay từ bước đọc ZSD02 (điều kiện NOT EXISTS khvc ở cuối giữ nguyên — nay rẻ vì tập đã nhỏ)
CREATE OR REPLACE FUNCTION public.dispatch_new_ods(
  p_plant text, p_from date, p_to date, p_day date, p_slocs text[], p_warehouse_id text, p_plan_id uuid, p_segment text
) RETURNS text[]
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT e.od_number, e.flow, e.material_code, e.ship_to_code
      FROM public.erp_outbound_orders e
     WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL AND NOT e.in_khvc
       AND (coalesce(cardinality(p_slocs), 0) = 0 OR e.storage_location IS NULL OR upper(trim(e.storage_location)) = ANY (p_slocs))
       AND e.flow IN ('SALE', 'STO', 'INTERNAL', 'PALLET')
  ), od AS (
    SELECT r.od_number, min(r.ship_to_code) AS ship_to_code,
           bool_or(r.material_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public."Material" m WHERE m.material_code = r.material_code)) AS missing_mat
      FROM r GROUP BY r.od_number
  ), seg AS (
    SELECT od.od_number,
           coalesce(s.segment, CASE WHEN c.dispatch_transfer OR coalesce((lv.meta->>'dispatch_transfer')::boolean, false) THEN 'TRANSFER' ELSE 'SALES' END, 'SALES') AS segment
      FROM od
      LEFT JOIN public.dispatch_od_segment s ON s.warehouse_id = p_warehouse_id AND s.od_number = od.od_number
      LEFT JOIN public."Customer" c ON c.ship_to_code = od.ship_to_code
      LEFT JOIN public."LookupValue" lv ON lv.type = 'customer_channel' AND lv.value = c.channel
  )
  SELECT coalesce(array_agg(od.od_number ORDER BY od.od_number), '{}'::text[])
    FROM od JOIN seg ON seg.od_number = od.od_number
   WHERE NOT od.missing_mat
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
