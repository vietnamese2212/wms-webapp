-- 05/10/2026 tối — ba tab dấu tay chịu được LỊCH SỬ dài. Giả lập 6 ngày × ~600 đơn ở Ba Vì: tab Ngoài app tích luỹ 2.794 đơn ⇒
-- GET /marks?kind=OUTSIDE 3,2 MB (71 % trần 4,5 MB của Vercel), màn vẽ 20,6 s; số đếm ba tab 3–15 s vì backend kéo MỌI dòng dấu về
-- (fetchAllRowsParallel chạy lại hàm 3–4 lần) rồi tra mảng từng khách chỉ để đếm. User duyệt 05/10: làm như tab Đã điều — hiện
-- 1.000 đơn đánh dấu GẦN NHẤT, ô tìm tra TOÀN BỘ sổ; số đếm tính trong DB. Nay:
--   • dispatch_marked_ods thêm p_segment (lọc MẢNG trong DB — cùng luật segmentOfOds / dispatch_new_ods: dấu "lấy sang" của kho thắng,
--     rồi ô tick Trung chuyển của khách HOẶC của kênh khách), p_kind, p_search (khớp OD · khách · phường · vùng · ghi chú · lý do ·
--     người đánh dấu — đúng các ô bảng Xem đơn tìm tại chỗ) và cột total = số dòng khớp TRƯỚC khi backend cắt 1.000.
--   • dispatch_marked_counts: số đếm ba tab trong một câu (≤ 3 dòng).
-- Chữ ký đổi ⇒ DROP bản 5 tham số (PostgREST chọn hàm theo tên tham số — để lại bản cũ là chạy bản cũ). Code đang chạy gọi 5 tham số
-- vẫn khớp bản mới (3 tham số thêm có mặc định).
BEGIN;
DROP FUNCTION IF EXISTS public.dispatch_marked_ods(text, text, date, text[], text[]);
CREATE FUNCTION public.dispatch_marked_ods(p_warehouse_id text, p_plant text, p_day date, p_slocs text[], p_flows text[],
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
     WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.delivery_date <= p_day
       AND (coalesce(cardinality(p_slocs), 0) = 0 OR e.storage_location IS NULL OR e.storage_location = ''
            OR upper(btrim(e.storage_location)) = ANY (p_slocs))
       AND (e.delivery_date = p_day OR e.flow = ANY (p_flows))
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

CREATE OR REPLACE FUNCTION public.dispatch_marked_counts(p_warehouse_id text, p_plant text, p_day date, p_slocs text[], p_flows text[],
                                                         p_segment text DEFAULT NULL)
RETURNS TABLE (kind text, n bigint)
LANGUAGE sql STABLE AS $$
  SELECT d.kind, count(*) FROM public.dispatch_marked_ods(p_warehouse_id, p_plant, p_day, p_slocs, p_flows, p_segment) d GROUP BY d.kind
$$;
COMMIT;
NOTIFY pgrst, 'reload schema';
