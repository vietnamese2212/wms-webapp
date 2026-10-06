-- RÚT ĐƠN KHỎI KHUNG CHỜ NHÁP KHÁC — chạy MỘT LẦN cho cả câu lệnh thay vì từng dòng (06/10).
--
-- Vì sao: Ba Vì 06/10 15:28, "Ghép xe" 3.529 đơn cho nháp Bán hàng 05/10 trong khi nháp 08/10 cũng giữ đúng 3.529 đơn đó ở khung chờ ⇒
-- trigger mức DÒNG `dispatch_od_leave_other_pools` chạy cho MỖI dòng vừa lên xe: xoá dòng khung chờ của nháp kia rồi ĐẾM LẠI CẢ khung chờ
-- nháp kia (count DISTINCT trên ~3.500 dòng) ⇒ ~3.500 × 3.500 lượt quét ⇒ 503 QUERY_TIMEOUT giữa lúc ghép (bản ghép cũ đã xoá khung chờ
-- trước khi ghi dòng mới ⇒ 896 xe rỗng, 3.517 đơn rời kế hoạch — cửa ghép đã sửa thứ tự ghi cùng lượt).
--
-- Nay: hai trigger MỨC CÂU LỆNH với bảng chuyển tiếp (INSERT · UPDATE — Postgres không cho một trigger có bảng chuyển tiếp bắt nhiều sự
-- kiện, và trigger UPDATE có bảng chuyển tiếp không được giới hạn cột) ⇒ MỘT câu DELETE cho mọi dòng vừa lên xe (cả họ hàng qua od_family),
-- MỘT lần đếm lại khung chờ cho mỗi nháp bị đụng. Luật giữ nguyên: chỉ dòng vừa từ khung chờ (hoặc dòng mới) LÊN XE; chỉ nháp KHÁC đang mở
-- (DRAFT / TENDERED); chỉ dòng khung chờ bên đó.
DROP TRIGGER IF EXISTS trg_dispatch_od_leave_other_pools ON public.dispatch_trip_od;

CREATE OR REPLACE FUNCTION public.dispatch_od_leave_other_pools() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  m_plan uuid[];
  m_od text[];
  touched uuid[];
BEGIN
  -- dòng vừa LÊN XE trong câu lệnh này: thêm mới có trip_id · sửa từ trip_id NULL sang có
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(n.plan_id), array_agg(n.od_number) INTO m_plan, m_od FROM new_rows n WHERE n.trip_id IS NOT NULL;
  ELSE
    SELECT array_agg(n.plan_id), array_agg(n.od_number) INTO m_plan, m_od
      FROM new_rows n JOIN old_rows o ON o.id = n.id
     WHERE n.trip_id IS NOT NULL AND o.trip_id IS NULL;
  END IF;
  IF m_od IS NULL THEN RETURN NULL; END IF;

  WITH fam AS (
    SELECT DISTINCT m.plan_id, f.od
      FROM unnest(m_plan, m_od) AS m(plan_id, od_number)
      CROSS JOIN LATERAL unnest(public.od_family(m.od_number)) AS f(od)
  ), gone AS (
    DELETE FROM public.dispatch_trip_od o
     USING public.dispatch_plan p, fam
     WHERE o.plan_id = p.id AND o.plan_id <> fam.plan_id AND o.trip_id IS NULL
       AND o.od_number = fam.od
       AND p.status IN ('DRAFT', 'TENDERED')
    RETURNING o.plan_id)
  SELECT array_agg(DISTINCT plan_id) INTO touched FROM gone;

  IF touched IS NOT NULL THEN
    UPDATE public.dispatch_plan p
       SET summary = jsonb_set(coalesce(p.summary, '{}'::jsonb), '{pool_ods}',
                               to_jsonb((SELECT count(DISTINCT o.od_number) FROM public.dispatch_trip_od o WHERE o.plan_id = p.id AND o.trip_id IS NULL)))
     WHERE p.id = ANY (touched);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_dispatch_od_leave_other_pools_ins AFTER INSERT ON public.dispatch_trip_od
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.dispatch_od_leave_other_pools();
CREATE TRIGGER trg_dispatch_od_leave_other_pools_upd AFTER UPDATE ON public.dispatch_trip_od
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.dispatch_od_leave_other_pools();
