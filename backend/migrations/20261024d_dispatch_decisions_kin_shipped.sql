-- ============================================================================
-- 20261024d — Hàng chờ "Cần xử lý": việc KIN (DO mới cùng dòng SO với DO ĐÃ XUẤT) mang SỐ ĐÃ XUẤT THẬT của DO cũ trên chuyến
-- ============================================================================
-- 24/10 (user chốt): SAP xoá A đã đi (100 thùng, xe chở 80), tạo B 80 (phần đã đi) + C 20 (phần còn lại) ⇒ B không được đi lần hai.
-- Bàn hiện cho TỪNG DO mới hai nút "Phần đã đi" / "Giao thêm" và GỢI Ý DO nào là phần đã đi theo số lượng: `shipped_base` = số base đã
-- quét cho DO cũ trên chuyến Xuất kho (dòng hàng gộp nhiều OD thì chia theo tỷ lệ `od_refs.qty_base`). Chỉ tính cho DO cũ của cạnh
-- AFTER_POST (tập nhỏ) — không quét hàng của mọi chuyến 120 ngày. Thân hàm chép NGUYÊN bản 20261008i, chỉ thêm CTE `kin_old`/`sh` và
-- cột `shipped_base` (NULL ở r1/r3).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.dispatch_decisions(p_warehouse_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  WITH w AS (SELECT id, code, sap_plant FROM public."Warehouse" WHERE id = p_warehouse_id),
  kl AS (
    SELECT k.do_no, k.group_code, min(k.export_date) AS export_date
      FROM public.khvc_lines k, w
     WHERE k.sync_status IS DISTINCT FROM 'OBSOLETE' AND k.do_no IS NOT NULL AND k.export_date IS NOT NULL
       AND k.export_date >= current_date - 120
       AND (k.warehouse_code = w.code OR EXISTS (SELECT 1 FROM public."GroupDeliveryOrder" g WHERE g.group_code = k.group_code AND g.warehouse_id = w.id))
     GROUP BY k.do_no, k.group_code
  ),
  -- chuyến bên Xuất của mỗi Số xe: còn hiệu lực mới nhất (một Số xe có thể có nhiều bản do replan)
  g AS (
    SELECT DISTINCT ON (x.group_code) x.group_code, x.id, x.status, x.plan_dropped
      FROM public."GroupDeliveryOrder" x
     WHERE x.group_code IN (SELECT group_code FROM kl)
     ORDER BY x.group_code, (x.status = 'CANCELLED'), x.created_at DESC
  ),
  od AS (
    SELECT e.od_number, bool_and(e.sync_status = 'OBSOLETE') AS all_obsolete, max(e.replaced_by_od) AS replaced_by, max(e.updated_at) AS e_at,
           min(e.ship_to_code) AS ship_to_code, min(e.ship_to_name) AS ship_to_name, sum(coalesce(e.qty_base, 0)) AS qty_base,
           sum(coalesce(e.sap_pallets, 0)) AS sap_pallets, min(e.delivery_date) AS delivery_date
      FROM public.erp_outbound_orders e WHERE e.od_number IN (SELECT do_no FROM kl) GROUP BY e.od_number
  ),
  edges AS (
    SELECT l.old_od, l.new_od, l.kind, l.detected_at FROM public.od_lineage l
     WHERE l.resolved_at IS NULL AND l.old_od IN (SELECT do_no FROM kl)
  ),
  kin_old AS (SELECT DISTINCT old_od FROM edges WHERE kind = 'AFTER_POST'),
  sh AS (
    SELECT ref->>'od_number' AS od_number, kl.group_code,
           sum(coalesce(i.cartons_scanned, 0) * coalesce((ref->>'qty_base')::numeric, 0)
               / nullif((SELECT sum(coalesce((r2->>'qty_base')::numeric, 0)) FROM jsonb_array_elements(i.od_refs) r2), 0)) AS shipped_base
      FROM kl JOIN g ON g.group_code = kl.group_code
      JOIN public."OutboundDelivery" d ON d.gdo_id = g.id
      JOIN public."OutboundItem" i ON i.do_id = d.id
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(i.od_refs) = 'array' THEN i.od_refs ELSE '[]'::jsonb END) ref
     WHERE kl.do_no IN (SELECT old_od FROM kin_old) AND ref->>'od_number' = kl.do_no
     GROUP BY 1, 2
  ),
  newset AS (
    SELECT DISTINCT old_od, new_od FROM (
      SELECT old_od, new_od FROM edges
      UNION SELECT od.od_number, od.replaced_by FROM od WHERE od.replaced_by IS NOT NULL
    ) x
  ),
  nod AS (
    SELECT e.od_number, min(e.ship_to_code) AS ship_to_code, sum(coalesce(e.qty_base, 0)) FILTER (WHERE e.sync_status = 'ACTIVE') AS qty_base,
           min(e.delivery_date) AS delivery_date, bool_or(e.sync_status = 'ACTIVE') AS active,
           EXISTS (SELECT 1 FROM public.khvc_lines k2 WHERE k2.do_no = e.od_number AND k2.sync_status IS DISTINCT FROM 'OBSOLETE') AS in_khvc,
           EXISTS (SELECT 1 FROM public.dispatch_od_outside x, w WHERE x.od_number = e.od_number AND x.warehouse_id = w.id) AS outside,
           EXISTS (SELECT 1 FROM public.dispatch_trip_od o JOIN public.dispatch_plan p ON p.id = o.plan_id JOIN public.dispatch_trip t ON t.id = o.trip_id
                    WHERE o.od_number = e.od_number AND o.trip_id IS NOT NULL AND p.status IN ('DRAFT', 'TENDERED') AND t.status <> 'DISCARDED') AS on_vehicle
      FROM public.erp_outbound_orders e WHERE e.od_number IN (SELECT new_od FROM newset) GROUP BY e.od_number
  ),
  new_json AS (
    SELECT n.old_od,
           jsonb_agg(jsonb_build_object('od', n.new_od, 'kind', (SELECT min(e2.kind) FROM edges e2 WHERE e2.old_od = n.old_od AND e2.new_od = n.new_od),
             'active', coalesce(nod.active, false), 'in_khvc', coalesce(nod.in_khvc, false), 'outside', coalesce(nod.outside, false), 'on_vehicle', coalesce(nod.on_vehicle, false),
             'delivery_date', nod.delivery_date, 'qty_base', nod.qty_base, 'same_customer', nod.ship_to_code IS NOT DISTINCT FROM od.ship_to_code) ORDER BY n.new_od) AS new_ods,
           bool_and(coalesce(nod.active, false) AND NOT coalesce(nod.in_khvc, false) AND NOT coalesce(nod.on_vehicle, false) AND NOT coalesce(nod.outside, false)) AS all_free,
           bool_and(nod.ship_to_code IS NOT DISTINCT FROM od.ship_to_code) AND sum(coalesce(nod.qty_base, 0)) = max(od.qty_base) AS same_content,
           bool_or((SELECT min(e2.kind) FROM edges e2 WHERE e2.old_od = n.old_od AND e2.new_od = n.new_od) = 'MERGE') AS any_merge
      FROM newset n JOIN od ON od.od_number = n.old_od LEFT JOIN nod ON nod.od_number = n.new_od
     GROUP BY n.old_od
  ),
  r1 AS (
    SELECT kl.do_no AS od_number, CASE WHEN nj.old_od IS NOT NULL THEN 'REPLACED' ELSE 'GONE' END AS kind,
           kl.group_code, kl.export_date, g.id AS gdo_id, g.status AS gdo_status, od.e_at AS detected_at,
           od.ship_to_code, od.ship_to_name, od.qty_base, od.sap_pallets, od.delivery_date,
           coalesce(nj.new_ods, '[]'::jsonb) AS new_ods, coalesce(nj.all_free, false) AS all_free, coalesce(nj.same_content, false) AS same_content, coalesce(nj.any_merge, false) AS any_merge,
           NULL::text AS detail, NULL::text AS task_id, NULL::text AS action, NULL::numeric AS shipped_base
      FROM kl JOIN od ON od.od_number = kl.do_no LEFT JOIN g ON g.group_code = kl.group_code LEFT JOIN new_json nj ON nj.old_od = kl.do_no
     WHERE od.all_obsolete AND coalesce(g.status, '') <> 'CANCELLED' AND NOT coalesce(g.plan_dropped, false)
       AND NOT EXISTS (SELECT 1 FROM public.dispatch_od_outside x, w WHERE x.od_number = kl.do_no AND x.warehouse_id = w.id)
  ),
  r2 AS (
    SELECT kl.do_no AS od_number, 'KIN' AS kind, kl.group_code, kl.export_date, g.id AS gdo_id, g.status AS gdo_status, max(e.detected_at) AS detected_at,
           od.ship_to_code, od.ship_to_name, od.qty_base, od.sap_pallets, od.delivery_date,
           jsonb_agg(jsonb_build_object('od', e.new_od, 'kind', e.kind, 'active', coalesce(nod.active, false), 'in_khvc', false, 'outside', false, 'on_vehicle', coalesce(nod.on_vehicle, false),
             'delivery_date', nod.delivery_date, 'qty_base', nod.qty_base, 'same_customer', nod.ship_to_code IS NOT DISTINCT FROM od.ship_to_code) ORDER BY e.new_od) AS new_ods,
           false AS all_free, false AS same_content, false AS any_merge, NULL::text AS detail, NULL::text AS task_id, NULL::text AS action,
           (SELECT round(sh.shipped_base, 3) FROM sh WHERE sh.od_number = kl.do_no AND sh.group_code = kl.group_code) AS shipped_base
      FROM edges e JOIN kl ON kl.do_no = e.old_od JOIN od ON od.od_number = kl.do_no LEFT JOIN g ON g.group_code = kl.group_code LEFT JOIN nod ON nod.od_number = e.new_od
     WHERE e.kind = 'AFTER_POST' AND NOT od.all_obsolete AND NOT coalesce(nod.in_khvc, false) AND NOT coalesce(nod.outside, false)
       AND coalesce(g.status, '') <> 'CANCELLED'
     GROUP BY kl.do_no, kl.group_code, kl.export_date, g.id, g.status, od.ship_to_code, od.ship_to_name, od.qty_base, od.sap_pallets, od.delivery_date
  ),
  r3 AS (
    -- 08/10: SAP đổi khách giao có loại riêng (bàn điều vận ghi "SAP đổi khách", không phải "đổi SL")
    SELECT t.od_number, CASE WHEN t.change_type = 'SHIPTO_CHANGED' THEN 'SHIPTO' ELSE 'QTY' END AS kind, t.group_code, g2.delivery_date::date AS export_date, t.gdo_id, g2.status AS gdo_status, t.created_at AS detected_at,
           NULL::text AS ship_to_code, NULL::text AS ship_to_name, t.old_ordered AS qty_base, NULL::numeric AS sap_pallets, NULL::date AS delivery_date,
           '[]'::jsonb AS new_ods, false AS all_free, false AS same_content, false AS any_merge, t.detail, t.id AS task_id, t.action, NULL::numeric AS shipped_base
      FROM public.reconcile_tasks t JOIN public."GroupDeliveryOrder" g2 ON g2.id = t.gdo_id, w
     WHERE t.status = 'OPEN' AND t.change_type <> 'KHVC_CHANGED' AND g2.warehouse_id = w.id
  ),
  rows AS (SELECT * FROM r1 UNION ALL SELECT * FROM r2 UNION ALL SELECT * FROM r3)
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM rows),
    'rows', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.export_date NULLS LAST, r.group_code, r.od_number), '[]'::jsonb)
               FROM (SELECT * FROM rows ORDER BY export_date NULLS LAST, group_code, od_number LIMIT 500) r)
  )
$function$;
