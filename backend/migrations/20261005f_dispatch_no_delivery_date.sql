-- 05/10/2026 khuya — NGÀY GIAO ZSD02 KHÔNG QUYẾT ĐƠN VÀO / RA bàn điều vận (user chốt: "gỡ luật, dữ liệu trong zsd02 mặc kệ nó, trong đó
-- không có ngày giao đáng tin cậy. USER sẽ là người chọn"). Trước đây bàn chỉ lấy đơn ngày giao ≤ ngày lập: đơn ghi ngày giao sau
-- (Ba Vì lúc chốt: 25 đơn, có 9 đơn ghi năm 2040) không ở tab nào — người không thấy để quyết. Nay:
--   • dispatch_pool_rows: bỏ `ngày giao ≤ ngày lập`; thêm p_flows (lọc phân loại lên xe được trong DB — không có ngày giao thì đơn trả
--     về / chiết khấu không còn "đúng ngày" nào để hiện, giữ lại là nằm ở tab Điều mãi mãi, không chọn được, không đánh dấu được).
--     Đơn đã có trong Kế hoạch xuất vẫn về khi NGÀY XUẤT của Kế hoạch xuất = ngày lập (tab Đã điều của ngày đó — lịch sử của app,
--     không phải ngày giao SAP). Chữ ký đổi ⇒ DROP bản 3 tham số; code cũ gọi 3 tham số vẫn khớp (p_flows NULL = mọi phân loại).
--   • dispatch_new_ods (cửa /sync "OD mới"): bỏ điều kiện ngày giao; chỉ đơn có dòng lên xe được. p_from / p_to giữ trong chữ ký cho
--     code cũ, không còn dùng.
--   • dispatch_marked_ods: bỏ điều kiện ngày giao ở tập dòng của đơn mang dấu (cùng tập với cửa nạp). p_day còn dùng cho dấu hẹn ngày.
--   • dispatch_planned_ods (tab Đã điều "Xem cả đơn đã điều ngày khác"): n đơn ĐÃ có trong Kế hoạch xuất với NGÀY XUẤT khác ngày lập,
--     gần nhất theo ngày xuất — bản cũ chọn theo ngày giao SAP trước ngày lập.
BEGIN;
DROP FUNCTION IF EXISTS public.dispatch_pool_rows(text, date, text);
CREATE FUNCTION public.dispatch_pool_rows(p_plant text, p_day date, p_warehouse_id text DEFAULT NULL, p_flows text[] DEFAULT NULL)
RETURNS SETOF public.erp_outbound_orders
LANGUAGE sql STABLE AS $$
  SELECT e.*
    FROM public.erp_outbound_orders e
   WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL
     AND (p_flows IS NULL OR e.flow = ANY (p_flows))
     AND (NOT EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.do_no = e.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE')
          OR EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.do_no = e.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE'
                        AND k.export_date = p_day))
     AND (p_warehouse_id IS NULL
          OR NOT (EXISTS (SELECT 1 FROM public.dispatch_od_outside x WHERE x.warehouse_id = p_warehouse_id AND x.od_number = e.od_number)
                  OR EXISTS (SELECT 1 FROM public.dispatch_od_hold h WHERE h.warehouse_id = p_warehouse_id AND h.od_number = e.od_number
                                AND (h.hold_until IS NULL OR h.hold_until > p_day)))
          OR EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.do_no = e.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE')
          OR EXISTS (SELECT 1 FROM public.erp_outbound_orders o JOIN public.khvc_lines k ON k.do_no = o.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE'
                      WHERE o.replaced_by_od = e.od_number))
$$;

CREATE OR REPLACE FUNCTION public.dispatch_new_ods(
  p_plant text, p_from date, p_to date, p_day date, p_slocs text[], p_warehouse_id text, p_plan_id uuid, p_segment text
) RETURNS text[]
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT e.od_number, e.flow, e.material_code, e.ship_to_code
      FROM public.erp_outbound_orders e
     WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.dispatch_marked_ods(p_warehouse_id text, p_plant text, p_day date, p_slocs text[], p_flows text[],
                                                      p_segment text DEFAULT NULL, p_kind text DEFAULT NULL, p_search text DEFAULT NULL)
RETURNS TABLE (od_number text, kind text, hold_until date, reason text, marked_by text, marked_at timestamptz,
               ship_to_code text, ship_to_name text, ward_code text, region_code text, region_name text,
               pallets numeric, tons numeric, delivery_date date, note text, total bigint)
LANGUAGE sql STABLE AS $$
  WITH m AS (
    SELECT h.od_number, CASE WHEN h.hold_until IS NULL THEN 'NEVER' ELSE 'DAY' END AS kind, h.hold_until, h.reason, h.created_by, h.updated_at
      FROM public.dispatch_od_hold h
     WHERE h.warehouse_id = p_warehouse_id AND (h.hold_until IS NULL OR h.hold_until > p_day)
    UNION ALL
    -- dấu hoãn còn hiệu lực thắng dấu Ngoài app (thứ tự splitPool); hai cửa ghi vốn xoá dấu kia nên hiếm khi cùng có
    SELECT x.od_number, 'OUTSIDE', NULL::date, x.reason, x.created_by, x.updated_at
      FROM public.dispatch_od_outside x
     WHERE x.warehouse_id = p_warehouse_id
       AND NOT EXISTS (SELECT 1 FROM public.dispatch_od_hold h WHERE h.warehouse_id = p_warehouse_id AND h.od_number = x.od_number
                          AND (h.hold_until IS NULL OR h.hold_until > p_day))
  ), mk AS (
    SELECT * FROM m WHERE p_kind IS NULL OR m.kind = p_kind
  ), l AS (
    SELECT e.od_number, e.od_item, e.ship_to_code, e.ship_to_name, e.ward_code, e.region_code, e.sap_pallets, e.gross_weight_kg, e.delivery_date, e.note_delivery
      FROM public.erp_outbound_orders e JOIN mk ON mk.od_number = e.od_number
     WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE'
       AND (coalesce(cardinality(p_slocs), 0) = 0 OR e.storage_location IS NULL OR e.storage_location = ''
            OR upper(btrim(e.storage_location)) = ANY (p_slocs))
       AND e.flow = ANY (p_flows)
  ), g AS (
    SELECT l.od_number,
           (array_agg(l.ship_to_code ORDER BY l.od_item))[1] AS ship_to_code,
           (array_agg(l.ship_to_name ORDER BY l.od_item))[1] AS ship_to_name,
           (array_agg(l.ward_code ORDER BY l.od_item))[1] AS ward_code,
           (array_agg(l.region_code ORDER BY l.od_item))[1] AS region_code,
           nullif(sum(coalesce(l.sap_pallets, 0)), 0) AS pallets,
           nullif(sum(coalesce(l.gross_weight_kg, 0)), 0) / 1000 AS tons,
           max(l.delivery_date) AS delivery_date,
           string_agg(DISTINCT nullif(nullif(btrim(l.note_delivery, E' \t\r\n'), ''), '0'), ' · ') AS note
      FROM l GROUP BY l.od_number
  ), r AS (
    SELECT mk.od_number, mk.kind, mk.hold_until, mk.reason, mk.created_by AS marked_by, mk.updated_at AS marked_at,
           g.ship_to_code, g.ship_to_name, coalesce(g.ward_code, c.ward_code) AS ward_code, coalesce(g.region_code, c.region_code) AS region_code,
           c.region_name, g.pallets, g.tons, g.delivery_date, g.note,
           coalesce(s.segment, CASE WHEN c.dispatch_transfer IS TRUE OR lv.meta -> 'dispatch_transfer' = 'true'::jsonb THEN 'TRANSFER' ELSE 'SALES' END) AS segment
      FROM mk JOIN g ON g.od_number = mk.od_number
      LEFT JOIN public."Customer" c ON c.ship_to_code = g.ship_to_code
      LEFT JOIN public."LookupValue" lv ON lv.type = 'customer_channel' AND lv.value = c.channel
      LEFT JOIN public.dispatch_od_segment s ON s.warehouse_id = p_warehouse_id AND s.od_number = mk.od_number
     -- đơn đã vào Kế hoạch xuất / DO tạo lại thay đơn đã lên xe đứng ở tab Đã điều, không ở tab dấu tay (thứ tự splitPool)
     WHERE NOT EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.do_no = mk.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE')
       AND NOT EXISTS (SELECT 1 FROM public.erp_outbound_orders o JOIN public.khvc_lines k ON k.do_no = o.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE'
                        WHERE o.replaced_by_od = mk.od_number)
  )
  SELECT r.od_number, r.kind, r.hold_until, r.reason, r.marked_by, r.marked_at, r.ship_to_code, r.ship_to_name, r.ward_code, r.region_code,
         r.region_name, r.pallets, r.tons, r.delivery_date, r.note, count(*) OVER () AS total
    FROM r
   WHERE (p_segment IS NULL OR r.segment = p_segment)
     AND (coalesce(p_search, '') = '' OR strpos(lower(concat_ws(' ', r.od_number, coalesce(r.ship_to_name, r.ship_to_code), r.ward_code,
            coalesce(r.region_name, r.region_code), r.note, r.reason, r.marked_by)), lower(p_search)) > 0)
   ORDER BY r.marked_at DESC NULLS LAST, r.od_number
$$;

CREATE OR REPLACE FUNCTION public.dispatch_planned_ods(p_plant text, p_day date, p_limit integer) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(x.do_no ORDER BY x.d DESC NULLS LAST, x.do_no), '{}'::text[])
    FROM (SELECT k.do_no, max(k.export_date) AS d
            FROM public.khvc_lines k
           WHERE k.sync_status IS DISTINCT FROM 'OBSOLETE' AND k.export_date IS DISTINCT FROM p_day
             AND EXISTS (SELECT 1 FROM public.erp_outbound_orders e WHERE e.od_number = k.do_no AND e.plant = p_plant AND e.sync_status = 'ACTIVE')
           GROUP BY k.do_no
           ORDER BY max(k.export_date) DESC NULLS LAST, k.do_no
           LIMIT greatest(p_limit, 0)) x
$$;
COMMIT;
NOTIFY pgrst, 'reload schema';
