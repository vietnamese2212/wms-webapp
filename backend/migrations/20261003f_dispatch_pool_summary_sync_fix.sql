-- 03/10: sửa 20261003e — biến `touched` khai text[] trong khi dispatch_plan.id là uuid ⇒ "operator does not exist: uuid = text"
-- làm MỌI lần đưa OD lên xe (reoptimize / move) 500 khi có nháp khác đang giữ OD đó ở khung chờ (gói 61 [17e] bắt ngay lượt đầu).
BEGIN;
CREATE OR REPLACE FUNCTION public.dispatch_od_leave_other_pools() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  touched uuid[];
BEGIN
  IF NEW.trip_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.trip_id IS NOT NULL THEN RETURN NEW; END IF;
  WITH gone AS (
    DELETE FROM public.dispatch_trip_od o
     USING public.dispatch_plan p
     WHERE o.plan_id = p.id AND o.plan_id <> NEW.plan_id AND o.trip_id IS NULL
       AND o.od_number = ANY (public.od_family(NEW.od_number))
       AND p.status IN ('DRAFT', 'TENDERED')
    RETURNING o.plan_id)
  SELECT array_agg(DISTINCT plan_id) INTO touched FROM gone;
  IF touched IS NOT NULL THEN
    UPDATE public.dispatch_plan p
       SET summary = jsonb_set(coalesce(p.summary, '{}'::jsonb), '{pool_ods}',
                               to_jsonb((SELECT count(DISTINCT o.od_number) FROM public.dispatch_trip_od o WHERE o.plan_id = p.id AND o.trip_id IS NULL)))
     WHERE p.id = ANY (touched);
  END IF;
  RETURN NEW;
END $$;
COMMIT;
