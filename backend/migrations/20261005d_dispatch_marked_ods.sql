-- 05/10/2026 — đơn mang DẤU TAY "Không điều ngày này" · "Không điều" · "Ngoài app" KHÔNG còn chép vào kế hoạch (user 05/10: "bản chất nó
-- bị loại bỏ khỏi kế hoạch"). Trước đây mỗi lần lập kế hoạch / nạp OD mới, cửa nạp đọc lại dòng ZSD02 của MỌI đơn mang dấu và chép tóm
-- tắt vào `dispatch_plan.params.excluded` để bảng Xem đơn in ba tab đó. Đơn Ngoài app / Không điều không bao giờ vào Kế hoạch xuất nên
-- tập đó chỉ tăng — mỗi kế hoạch về sau mang theo mọi đơn từng đánh dấu (~300 B/đơn, cộng dòng ZSD02 phải đọc lại), và bản chụp trong
-- params lệch sổ dấu thật khi "Điều lại" hỏng giữa chừng. Nay:
--   • dispatch_pool_rows thêm p_warehouse_id: bỏ luôn trong DB đơn mang dấu còn hiệu lực của kho (Ngoài app; Không điều; Không điều
--     ngày này với ngày điều lại SAU ngày lập) — TRỪ đơn đã có trong Kế hoạch xuất / DO tạo lại thay đơn đã lên xe (hai loại đó
--     đứng trước dấu tay trong splitPool, giữ nguyên thứ tự). Mặc định NULL = như bản cũ (code cũ trên Preview gọi 2 tham số vẫn chạy
--     trong lúc chờ deploy — không có hai bản cùng tên).
--   • dispatch_marked_ods: danh sách đơn mang dấu của kho cho ba tab, đọc THẲNG sổ dấu tay + ZSD02, một dòng mỗi đơn kèm tóm tắt
--     (khách · phường · vùng · pallet · tấn · ngày giao · ghi chú). Cùng tập dòng với cửa nạp: plant, ACTIVE, ngày giao ≤ ngày lập,
--     Sloc của kho (dòng không ghi Sloc vẫn tính), dòng đúng ngày lập hoặc phân loại lên xe được (p_flows = LOADABLE_FLOW của backend
--     — một nguồn). Mảng (Trung chuyển / Bán hàng) backend lọc bằng segmentOfOds như cửa nạp.
BEGIN;
DROP FUNCTION IF EXISTS public.dispatch_pool_rows(text, date);
CREATE OR REPLACE FUNCTION public.dispatch_pool_rows(p_plant text, p_day date, p_warehouse_id text DEFAULT NULL) RETURNS SETOF public.erp_outbound_orders
LANGUAGE sql STABLE AS $$
  SELECT e.*
    FROM public.erp_outbound_orders e
   WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL AND e.delivery_date <= p_day
     AND (NOT EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.do_no = e.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE')
          OR EXISTS (SELECT 1 FROM public.erp_outbound_orders t WHERE t.od_number = e.od_number AND t.plant = p_plant
                        AND t.sync_status = 'ACTIVE' AND t.delivery_date = p_day))
     AND (p_warehouse_id IS NULL
          OR NOT (EXISTS (SELECT 1 FROM public.dispatch_od_outside x WHERE x.warehouse_id = p_warehouse_id AND x.od_number = e.od_number)
                  OR EXISTS (SELECT 1 FROM public.dispatch_od_hold h WHERE h.warehouse_id = p_warehouse_id AND h.od_number = e.od_number
                                AND (h.hold_until IS NULL OR h.hold_until > p_day)))
          OR EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.do_no = e.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE')
          OR EXISTS (SELECT 1 FROM public.erp_outbound_orders o JOIN public.khvc_lines k ON k.do_no = o.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE'
                      WHERE o.replaced_by_od = e.od_number))
$$;

CREATE OR REPLACE FUNCTION public.dispatch_marked_ods(p_warehouse_id text, p_plant text, p_day date, p_slocs text[], p_flows text[])
RETURNS TABLE (od_number text, kind text, hold_until date, reason text, marked_by text, marked_at timestamptz,
               ship_to_code text, ship_to_name text, ward_code text, region_code text, region_name text,
               pallets numeric, tons numeric, delivery_date date, note text)
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
  ), l AS (
    SELECT e.od_number, e.od_item, e.ship_to_code, e.ship_to_name, e.ward_code, e.region_code, e.sap_pallets, e.gross_weight_kg, e.delivery_date, e.note_delivery
      FROM public.erp_outbound_orders e JOIN m ON m.od_number = e.od_number
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
  )
  SELECT m.od_number, m.kind, m.hold_until, m.reason, m.created_by, m.updated_at,
         g.ship_to_code, g.ship_to_name, coalesce(g.ward_code, c.ward_code), coalesce(g.region_code, c.region_code), c.region_name,
         g.pallets, g.tons, g.delivery_date, g.note
    FROM m JOIN g ON g.od_number = m.od_number
    LEFT JOIN public."Customer" c ON c.ship_to_code = g.ship_to_code
   -- đơn đã vào Kế hoạch xuất / DO tạo lại thay đơn đã lên xe đứng ở tab Đã điều, không ở tab dấu tay (thứ tự splitPool)
   WHERE NOT EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.do_no = m.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE')
     AND NOT EXISTS (SELECT 1 FROM public.erp_outbound_orders o JOIN public.khvc_lines k ON k.do_no = o.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE'
                      WHERE o.replaced_by_od = m.od_number)
   ORDER BY m.od_number
$$;
COMMIT;
NOTIFY pgrst, 'reload schema';
