-- ============================================================================
-- 20261011a — Rào + chữa cho XE của bàn điều vận ↔ Kế hoạch xuất (chạy thử 11/10, memory dispatch-probe-2026-10-11)
-- ============================================================================
-- Đo thật 11/10 trên kho QA61WH: "Xác nhận" và "kéo OD" bắn cùng lúc ⇒ cả hai 200; bàn nói OD ở xe 2, khvc_lines + chuyến Xuất kho
-- nói xe 1 (3/3 lần); trễ 250 ms thì xe về NHÁP dù Kế hoạch xuất đã có dòng (hàm tính lại xe ghi đè trạng thái cũ). Backend nay bọc
-- MỌI cửa ghi của kế hoạch bằng thuê kế hoạch; file này là rào ở DB (không phụ thuộc đường code nào) + hai cửa tự chữa / đếm lệch.
-- Idempotent — chạy lại được.
-- ============================================================================

-- 1. RÀO: dòng OD không rời / không vào xe đã CONFIRMED (xe TENDERED vẫn cho — "Thay bằng OD mới" / "Cập nhật theo SAP" làm trên xe chờ).
--    RAISE mặc định P0001 ⇒ backend dịch tiền tố thành error.code TRIP_NOT_EDITABLE (409), cùng mã cửa kéo đang trả.
CREATE OR REPLACE FUNCTION public.dispatch_od_trip_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  hit record;
BEGIN
  IF NEW.trip_id IS NOT DISTINCT FROM OLD.trip_id THEN RETURN NEW; END IF;
  SELECT t.group_code INTO hit
    FROM public.dispatch_trip t
   WHERE t.id IN (OLD.trip_id, NEW.trip_id) AND t.status = 'CONFIRMED'
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'TRIP_NOT_EDITABLE: Xe % đã vào Kế hoạch xuất — không kéo OD vào / ra xe này (tải lại bàn; muốn sửa thì "Mở lại" xe)', hit.group_code;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_dispatch_od_trip_frozen ON public.dispatch_trip_od;
CREATE TRIGGER trg_dispatch_od_trip_frozen BEFORE UPDATE OF trip_id ON public.dispatch_trip_od
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_od_trip_frozen();

-- 2. MỞ LẠI trong MỘT giao dịch: xoá dòng Kế hoạch xuất của các xe + xe về NHÁP. Bản cũ hai request rời nhau — hỏng giữa chừng để lại
--    xe CONFIRMED không còn dòng (chuyến đã ngừng) mà bàn vẫn ghi "Đã vào KH". Trả các dòng đã xoá để backend ghi nhật ký + dội chuyến.
CREATE OR REPLACE FUNCTION public.dispatch_reopen_trips(p_trip_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  del jsonb;
  n integer;
BEGIN
  WITH t AS (SELECT id, group_code FROM public.dispatch_trip WHERE id = ANY (p_trip_ids) AND status = 'CONFIRMED'),
       d AS (DELETE FROM public.khvc_lines k USING t
              WHERE k.group_code = t.group_code AND k.sync_status IS DISTINCT FROM 'OBSOLETE'
              RETURNING k.group_code, k.do_no)
  SELECT coalesce(jsonb_agg(jsonb_build_object('group_code', d.group_code, 'do_no', d.do_no)), '[]'::jsonb) INTO del FROM d;
  UPDATE public.dispatch_trip SET status = 'DRAFT', confirmed_at = NULL, updated_at = now()
   WHERE id = ANY (p_trip_ids) AND status = 'CONFIRMED';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('trips', n, 'lines', del);
END $$;

-- 3. LỆCH xe ↔ Kế hoạch xuất: xe CONFIRMED ⇔ Số xe có dòng khvc_lines còn hiệu lực. `nextSeq` không cấp lại Số xe khi còn dòng khvc
--    hoặc xe chưa DISCARDED nên một Số xe không thể vừa là xe nháp mới vừa là dòng của kế hoạch cũ.
--    (a) đếm — bất biến gói 00 (toàn DB) · (b) chữa — cửa GET /sync của bàn (theo kế hoạch): xe nháp có dòng ⇒ CONFIRMED (đua đã ghi
--    Kế hoạch xuất rồi); xe CONFIRMED hết dòng (Số xe bị xoá ở tab Kế hoạch xuất · Mở lại cũ hỏng giữa chừng) ⇒ về NHÁP.
CREATE OR REPLACE FUNCTION public.dispatch_trip_khvc_mismatch(p_plan_id uuid DEFAULT NULL) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT count(*)
    FROM public.dispatch_trip t
    JOIN public.dispatch_plan p ON p.id = t.plan_id
   WHERE (p_plan_id IS NULL OR t.plan_id = p_plan_id)
     AND p.status <> 'DISCARDED' AND t.status IN ('DRAFT', 'CONFIRMED')
     AND (t.status = 'CONFIRMED') <> EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.group_code = t.group_code AND k.sync_status IS DISTINCT FROM 'OBSOLETE')
$$;

CREATE OR REPLACE FUNCTION public.dispatch_trip_khvc_heal(p_plan_id uuid) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  a integer;
  b integer;
BEGIN
  UPDATE public.dispatch_trip t SET status = 'CONFIRMED', confirmed_at = coalesce(t.confirmed_at, now()), updated_at = now()
   WHERE t.plan_id = p_plan_id AND t.status = 'DRAFT'
     AND EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.group_code = t.group_code AND k.sync_status IS DISTINCT FROM 'OBSOLETE');
  GET DIAGNOSTICS a = ROW_COUNT;
  UPDATE public.dispatch_trip t SET status = 'DRAFT', confirmed_at = NULL, updated_at = now()
   WHERE t.plan_id = p_plan_id AND t.status = 'CONFIRMED'
     AND NOT EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.group_code = t.group_code AND k.sync_status IS DISTINCT FROM 'OBSOLETE');
  GET DIAGNOSTICS b = ROW_COUNT;
  RETURN jsonb_build_object('to_confirmed', a, 'to_draft', b);
END $$;
