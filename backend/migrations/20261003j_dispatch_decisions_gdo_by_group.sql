-- 03/10/2026 — sửa RPC dispatch_decisions (20261003i): chuyến bên Xuất tra theo SỐ XE (GroupDeliveryOrder.group_code), KHÔNG theo
-- khvc_lines.gdo_id — cột đó không cửa nào ghi (đo staging: 0/63 dòng 30 ngày có gdo_id) ⇒ bản đầu cho mọi dòng gdo_status NULL, tức mọi
-- việc đều bị xếp vào cột "chưa bắt đầu" kể cả chuyến đang xuất (gói 61 [18a–18e] bắt ngay lượt đầu). Một Số xe có thể có nhiều chuyến
-- (replan dựng lại) ⇒ lấy chuyến còn hiệu lực mới nhất (không CANCELLED trước, rồi created_at mới nhất).
BEGIN;

CREATE OR REPLACE FUNCTION public.dispatch_decisions(p_warehouse_id text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
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
           NULL::text AS detail, NULL::text AS task_id, NULL::text AS action
      FROM kl JOIN od ON od.od_number = kl.do_no LEFT JOIN g ON g.group_code = kl.group_code LEFT JOIN new_json nj ON nj.old_od = kl.do_no
     WHERE od.all_obsolete AND coalesce(g.status, '') <> 'CANCELLED' AND NOT coalesce(g.plan_dropped, false)
       AND NOT EXISTS (SELECT 1 FROM public.dispatch_od_outside x, w WHERE x.od_number = kl.do_no AND x.warehouse_id = w.id)
  ),
  r2 AS (
    SELECT kl.do_no AS od_number, 'KIN' AS kind, kl.group_code, kl.export_date, g.id AS gdo_id, g.status AS gdo_status, max(e.detected_at) AS detected_at,
           od.ship_to_code, od.ship_to_name, od.qty_base, od.sap_pallets, od.delivery_date,
           jsonb_agg(jsonb_build_object('od', e.new_od, 'kind', e.kind, 'active', coalesce(nod.active, false), 'in_khvc', false, 'outside', false, 'on_vehicle', coalesce(nod.on_vehicle, false),
             'delivery_date', nod.delivery_date, 'qty_base', nod.qty_base, 'same_customer', nod.ship_to_code IS NOT DISTINCT FROM od.ship_to_code) ORDER BY e.new_od) AS new_ods,
           false AS all_free, false AS same_content, false AS any_merge, NULL::text AS detail, NULL::text AS task_id, NULL::text AS action
      FROM edges e JOIN kl ON kl.do_no = e.old_od JOIN od ON od.od_number = kl.do_no LEFT JOIN g ON g.group_code = kl.group_code LEFT JOIN nod ON nod.od_number = e.new_od
     WHERE e.kind = 'AFTER_POST' AND NOT od.all_obsolete AND NOT coalesce(nod.in_khvc, false) AND NOT coalesce(nod.outside, false)
       AND coalesce(g.status, '') <> 'CANCELLED'
     GROUP BY kl.do_no, kl.group_code, kl.export_date, g.id, g.status, od.ship_to_code, od.ship_to_name, od.qty_base, od.sap_pallets, od.delivery_date
  ),
  r3 AS (
    SELECT t.od_number, 'QTY' AS kind, t.group_code, g2.delivery_date::date AS export_date, t.gdo_id, g2.status AS gdo_status, t.created_at AS detected_at,
           NULL::text AS ship_to_code, NULL::text AS ship_to_name, t.old_ordered AS qty_base, NULL::numeric AS sap_pallets, NULL::date AS delivery_date,
           '[]'::jsonb AS new_ods, false AS all_free, false AS same_content, false AS any_merge, t.detail, t.id AS task_id, t.action
      FROM public.reconcile_tasks t JOIN public."GroupDeliveryOrder" g2 ON g2.id = t.gdo_id, w
     WHERE t.status = 'OPEN' AND t.change_type <> 'KHVC_CHANGED' AND g2.warehouse_id = w.id
  ),
  rows AS (SELECT * FROM r1 UNION ALL SELECT * FROM r2 UNION ALL SELECT * FROM r3)
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM rows),
    'rows', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.export_date NULLS LAST, r.group_code, r.od_number), '[]'::jsonb)
               FROM (SELECT * FROM rows ORDER BY export_date NULLS LAST, group_code, od_number LIMIT 500) r)
  )
$$;

COMMIT;
