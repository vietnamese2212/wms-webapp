-- 20261024 — RÀ CHUỖI ĐIỀU VẬN (user 24/10: "bàn làm việc có mối quan hệ zic zac tới rất nhiều module — kiểm tra kỹ để dữ liệu không bị mắc
-- ở chỗ này chỗ kia"). Hai hàm:
--
-- 1. dispatch_move_trips_date — ĐỔI NGÀY CẢ XE trong MỘT giao dịch. Bản cũ ghi từng bước rời (xe sang kế hoạch đích → dòng đơn → Kế hoạch
--    xuất đổi ngày): rào "một đơn một ngày" (trg_khvc_one_export_day, BEFORE … FOR EACH ROW) xét TỪNG dòng nên UPDATE nhiều dòng của MỘT
--    đơn mà máy tách lên hai xe tự vấp chính nó (dòng thứ nhất đã sang ngày mới, dòng thứ hai còn ngày cũ) ⇒ 23505 GIỮA CHỪNG — xe đã sang
--    kế hoạch ngày mới mà Kế hoạch xuất vẫn ngày cũ. Nay: xoá các dòng KH xuất của các Số xe rồi ghi lại (cùng id) với ngày mới trong cùng
--    giao dịch — dòng ghi lại chỉ còn so với ngày KHÁC thật (đơn có phần ở xe KHÔNG dời ⇒ vẫn bị rào chặn, và cả lượt quay lui).
-- 2. dispatch_chain_audit — SOI CHUỖI bàn → Kế hoạch xuất → chuyến Xuất kho → lệnh VC / khung giờ (gói QA 00 chạy hằng đêm): mỗi phép một
--    số + 5 mẫu Số xe. Kho / Số xe mang tiền tố QA (dữ liệu bộ kiểm) không tính.
BEGIN;

CREATE OR REPLACE FUNCTION public.dispatch_move_trips_date(p_trip_ids uuid[], p_seqs integer[], p_target uuid, p_gcs text[], p_date date, p_actor text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  n integer := 0;
  kept jsonb;
BEGIN
  UPDATE public.dispatch_trip t SET plan_id = p_target, seq = s.seq, updated_at = now()
    FROM unnest(p_trip_ids, p_seqs) AS s(id, seq) WHERE t.id = s.id;
  UPDATE public.dispatch_trip_od SET plan_id = p_target WHERE trip_id = ANY (p_trip_ids);
  IF coalesce(array_length(p_gcs, 1), 0) > 0 THEN
    SELECT coalesce(jsonb_agg(to_jsonb(k) || jsonb_build_object('export_date', p_date, 'uploaded_by', p_actor, 'updated_at', now())), '[]'::jsonb) INTO kept
      FROM public.khvc_lines k WHERE k.group_code = ANY (p_gcs) AND k.sync_status IS DISTINCT FROM 'OBSOLETE';
    DELETE FROM public.khvc_lines k WHERE k.group_code = ANY (p_gcs) AND k.sync_status IS DISTINCT FROM 'OBSOLETE';
    INSERT INTO public.khvc_lines SELECT * FROM jsonb_populate_recordset(NULL::public.khvc_lines, kept);
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.dispatch_chain_audit()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH lp AS (SELECT p.*, w.code wh FROM public.dispatch_plan p JOIN public."Warehouse" w ON w.id = p.warehouse_id WHERE w.code NOT ILIKE 'QA%'),
  lt AS (SELECT t.*, lp.plan_date FROM public.dispatch_trip t JOIN lp ON lp.id = t.plan_id WHERE t.status <> 'DISCARDED' AND lp.status <> 'DISCARDED' AND t.group_code NOT ILIKE 'QA%'),
  kh AS (SELECT k.* FROM public.khvc_lines k WHERE k.sync_status IS DISTINCT FROM 'OBSOLETE' AND k.group_code NOT ILIKE 'QA%'),
  dgc AS (SELECT DISTINCT t.group_code FROM public.dispatch_trip t WHERE t.group_code NOT ILIKE 'QA%'),
  gd AS (SELECT g.* FROM public."GroupDeliveryOrder" g WHERE g.group_code IN (SELECT group_code FROM dgc)),
  gdo_ods AS (SELECT g.id, g.group_code, trim(x) od FROM gd g JOIN public."OutboundDelivery" d ON d.gdo_id = g.id, regexp_split_to_table(d.delivery_code, ',') x WHERE coalesce(g.plan_dropped, false) = false),
  c AS (
    SELECT 'confirmed_trip_without_khvc' k, lt.group_code s FROM lt WHERE lt.status = 'CONFIRMED' AND NOT EXISTS (SELECT 1 FROM kh WHERE kh.group_code = lt.group_code)
    UNION ALL SELECT 'dispatch_khvc_without_trip', kh.group_code FROM kh WHERE kh.source = 'DISPATCH' AND NOT EXISTS (SELECT 1 FROM lt WHERE lt.group_code = kh.group_code AND (lt.status = 'CONFIRMED' OR lt.confirmed_at IS NOT NULL)) GROUP BY kh.group_code
    UNION ALL SELECT 'trip_ods_differ_from_khvc', lt.group_code FROM lt WHERE lt.status = 'CONFIRMED' AND EXISTS (SELECT 1 FROM kh WHERE kh.group_code = lt.group_code)
      AND (EXISTS (SELECT od_number FROM public.dispatch_trip_od o WHERE o.trip_id = lt.id EXCEPT SELECT do_no FROM kh WHERE kh.group_code = lt.group_code)
        OR EXISTS (SELECT do_no FROM kh WHERE kh.group_code = lt.group_code EXCEPT SELECT od_number FROM public.dispatch_trip_od o WHERE o.trip_id = lt.id))
    UNION ALL SELECT 'do_on_two_group_codes', kh.do_no FROM kh GROUP BY kh.do_no HAVING count(DISTINCT kh.group_code) > 1 AND count(DISTINCT kh.export_date) > 1
    UNION ALL SELECT 'khvc_date_differs_from_plan', lt.group_code FROM lt JOIN kh ON kh.group_code = lt.group_code WHERE lt.status = 'CONFIRMED' GROUP BY lt.group_code, lt.plan_date HAVING bool_or(kh.export_date <> lt.plan_date)
    UNION ALL SELECT 'dispatch_khvc_without_gdo', kh.group_code FROM kh WHERE kh.source = 'DISPATCH' AND NOT EXISTS (SELECT 1 FROM public."GroupDeliveryOrder" g WHERE g.group_code = kh.group_code) GROUP BY kh.group_code
    UNION ALL SELECT 'live_gdo_without_khvc', gd.group_code FROM gd WHERE coalesce(gd.plan_dropped, false) = false AND gd.status <> 'COMPLETED' AND NOT EXISTS (SELECT 1 FROM kh WHERE kh.group_code = gd.group_code)
    UNION ALL SELECT 'gdo_dos_differ_from_khvc', gd.group_code FROM gd WHERE coalesce(gd.plan_dropped, false) = false AND EXISTS (SELECT 1 FROM kh WHERE kh.group_code = gd.group_code)
      AND (EXISTS (SELECT od FROM gdo_ods WHERE gdo_ods.id = gd.id EXCEPT SELECT do_no FROM kh WHERE kh.group_code = gd.group_code)
        OR EXISTS (SELECT do_no FROM kh WHERE kh.group_code = gd.group_code EXCEPT SELECT od FROM gdo_ods WHERE gdo_ods.id = gd.id))
    UNION ALL SELECT 'two_gdos_same_group_code', gd.group_code FROM gd GROUP BY gd.group_code HAVING count(*) > 1
    UNION ALL SELECT 'live_gdo_without_tms_order', gd.group_code FROM gd WHERE coalesce(gd.plan_dropped, false) = false AND gd.status <> 'COMPLETED' AND NOT EXISTS (SELECT 1 FROM public."TmsOrder" o WHERE o.order_code = gd.group_code)
    UNION ALL SELECT 'live_tms_order_dead_gdo', o.order_code FROM public."TmsOrder" o WHERE o.order_code IN (SELECT group_code FROM dgc) AND coalesce(o.plan_dropped, false) = false AND NOT EXISTS (SELECT 1 FROM public."GroupDeliveryOrder" g WHERE g.group_code = o.order_code AND coalesce(g.plan_dropped, false) = false)
    UNION ALL SELECT 'dropped_order_holds_slot', o.order_code FROM public."TmsOrder" o JOIN public."TmsVehicleSlot" s ON s.order_id = o.id WHERE o.plan_dropped AND s.slot_id IS NOT NULL AND o.order_code IN (SELECT group_code FROM dgc)
    UNION ALL SELECT 'slot_date_differs_from_order', o.order_code FROM public."TmsOrder" o JOIN public."TmsVehicleSlot" s ON s.order_id = o.id JOIN public."DeliverySlot" ds ON ds.id = s.slot_id WHERE coalesce(o.plan_dropped, false) = false AND o.date IS NOT NULL AND ds.date <> o.date AND o.order_code IN (SELECT group_code FROM dgc)
    UNION ALL SELECT 'order_date_differs_from_khvc', o.order_code FROM public."TmsOrder" o JOIN kh ON kh.group_code = o.order_code WHERE coalesce(o.plan_dropped, false) = false GROUP BY o.order_code, o.date HAVING bool_or(kh.export_date <> o.date)
    UNION ALL SELECT 'od_on_two_live_trips', o.od_number FROM public.dispatch_trip_od o JOIN lt ON lt.id = o.trip_id GROUP BY o.od_number HAVING count(DISTINCT lt.plan_id) > 1
    UNION ALL SELECT 'unlocked_trip_without_snapshot', lt.group_code FROM lt WHERE lt.status = 'DRAFT' AND lt.confirmed_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.dispatch_plan_edit e WHERE e.plan_id = lt.plan_id)
    UNION ALL SELECT 'two_live_plans_same_day_segment', lp.wh || ' ' || lp.plan_date || ' ' || coalesce(lp.segment, 'SALES') FROM lp WHERE lp.status <> 'DISCARDED' GROUP BY lp.wh, lp.plan_date, coalesce(lp.segment, 'SALES') HAVING count(*) > 1
  )
  SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('n', n, 'sample', sample)), '{}'::jsonb)
    FROM (SELECT k, count(*) n, (array_agg(s ORDER BY s))[1:5] sample FROM c GROUP BY k) x
$$;

COMMIT;
