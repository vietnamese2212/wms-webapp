-- 20261023 — SỬA KẾ HOẠCH = BẢN NHÁP, có LƯU và KHÔI PHỤC (user 23/10: "khi bấm Sửa ⇒ thay đổi gì sẽ có nút Lưu, lưu xong thì mới tính kế
-- hoạch mới. Có thêm nút Khôi phục — chưa lưu bấm vào thì trở lại bản đã lưu").
-- Trước: mở khoá một xe đã chốt là TÁC ĐỘNG NGAY (gỡ dòng Kế hoạch xuất, chuyến bên Xuất ngừng, nhả khung giờ). Nay mở khoá chỉ đưa xe về
-- nháp trên bàn; Kế hoạch xuất · chuyến · khung giờ không đổi tới khi Lưu. Bản đã lưu của bàn (xe + đơn trên xe) chụp vào `dispatch_plan_edit`
-- lúc bấm Sửa / mở khoá xe đầu tiên; Khôi phục dựng lại đúng bản chụp; Lưu ghi phần đổi rồi xoá bản chụp.
-- Bảng riêng (không phải cột của dispatch_plan) vì GET kế hoạch đọc `select *` — bản chụp vài trăm KB không được đi theo mỗi lần tải bàn.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dispatch_plan_edit (
  plan_id    uuid PRIMARY KEY REFERENCES public.dispatch_plan(id) ON DELETE CASCADE,
  base       jsonb NOT NULL,
  started_by text,
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
-- như mọi bảng: chỉ backend (service role) đọc / ghi — anon / authenticated 0 quyền (gói 00 mục 10b/10c)
ALTER TABLE public.dispatch_plan_edit ENABLE ROW LEVEL SECURITY;

-- Chụp bản đã lưu nếu chưa có (bấm Sửa hai lần / mở khoá xe thứ hai KHÔNG chụp lại — bản chụp là trạng thái TRƯỚC thay đổi đầu tiên)
CREATE OR REPLACE FUNCTION public.dispatch_edit_begin(p_plan_id uuid, p_actor text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO public.dispatch_plan_edit (plan_id, base, started_by, started_at, updated_at)
  SELECT p_plan_id,
         jsonb_build_object(
           'trips', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.dispatch_trip t WHERE t.plan_id = p_plan_id AND t.status <> 'DISCARDED'), '[]'::jsonb),
           'ods',   coalesce((SELECT jsonb_agg(to_jsonb(o)) FROM public.dispatch_trip_od o JOIN public.dispatch_trip t ON t.id = o.trip_id
                                WHERE o.plan_id = p_plan_id AND t.status <> 'DISCARDED'), '[]'::jsonb)),
         p_actor, now(), now()
  ON CONFLICT (plan_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  -- chạm mốc kế hoạch ⇒ dấu phiên bản đổi ⇒ bàn khác đang mở kế hoạch này hiện Lưu / Khôi phục (realtime hỏi dấu)
  IF n > 0 THEN UPDATE public.dispatch_plan SET updated_at = now() WHERE id = p_plan_id; END IF;
  RETURN n > 0;
END $$;

-- KHÔI PHỤC: xe + đơn trên xe về đúng bản chụp, trong MỘT giao dịch. Đơn kéo từ khung chờ lên xe trong lúc sửa về lại khung chờ; xe tạo
-- trong lúc sửa bị xoá; xe đã xoá / đã bỏ trong lúc sửa dựng lại. Không đụng Kế hoạch xuất / chuyến (chúng chưa từng đổi). Xoá bản chụp.
CREATE OR REPLACE FUNCTION public.dispatch_edit_restore(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  b jsonb;
  snap_ods text[];
  snap_trips uuid[];
  nt integer;
  no integer;
BEGIN
  SELECT base INTO b FROM public.dispatch_plan_edit WHERE plan_id = p_plan_id FOR UPDATE;
  IF b IS NULL THEN RAISE EXCEPTION 'NO_EDIT: kế hoạch không có bản đã lưu để khôi phục' USING ERRCODE = 'P0002'; END IF;
  SELECT coalesce(array_agg(DISTINCT x->>'od_number'), '{}') INTO snap_ods FROM jsonb_array_elements(b->'ods') x;
  SELECT coalesce(array_agg((x->>'id')::uuid), '{}') INTO snap_trips FROM jsonb_array_elements(b->'trips') x;
  -- đơn KHÔNG có trong bản chụp mà đang nằm trên xe sống ⇒ về khung chờ (giữ mốc "trong kế hoạch"). Xe đã bỏ TỪ TRƯỚC (lịch sử) không đụng.
  UPDATE public.dispatch_trip_od SET trip_id = NULL, updated_at = now()
   WHERE plan_id = p_plan_id AND NOT (od_number = ANY (snap_ods))
     AND trip_id IN (SELECT id FROM public.dispatch_trip WHERE plan_id = p_plan_id AND status <> 'DISCARDED');
  -- bản hiện tại của các đơn trong bản chụp (ở xe sống / khung chờ / xe bỏ trong lúc sửa) nhường chỗ cho bản chụp
  DELETE FROM public.dispatch_trip_od WHERE plan_id = p_plan_id AND od_number = ANY (snap_ods)
     AND (trip_id IS NULL OR trip_id = ANY (snap_trips) OR trip_id IN (SELECT id FROM public.dispatch_trip WHERE plan_id = p_plan_id AND status <> 'DISCARDED'));
  -- xe hiện có (sống) + xe trong bản chụp (kể cả đã bỏ trong lúc sửa) ⇒ xoá rồi dựng lại từ bản chụp
  DELETE FROM public.dispatch_trip WHERE plan_id = p_plan_id AND (status <> 'DISCARDED' OR id = ANY (snap_trips));
  INSERT INTO public.dispatch_trip SELECT * FROM jsonb_populate_recordset(NULL::public.dispatch_trip, b->'trips');
  GET DIAGNOSTICS nt = ROW_COUNT;
  INSERT INTO public.dispatch_trip_od SELECT * FROM jsonb_populate_recordset(NULL::public.dispatch_trip_od, b->'ods');
  GET DIAGNOSTICS no = ROW_COUNT;
  DELETE FROM public.dispatch_plan_edit WHERE plan_id = p_plan_id;
  UPDATE public.dispatch_plan SET updated_at = now() WHERE id = p_plan_id;
  RETURN jsonb_build_object('trips', nt, 'ods', no);
END $$;

-- GHI DÒNG KẾ HOẠCH XUẤT của các Số xe trong MỘT giao dịch: xoá dòng đang có của các Số xe đó rồi chèn bản mới. Lưu xe đã chốt có sửa
-- (ghi đè cùng Số xe) · xoá xe đã chốt (không chèn gì) · xe mới — cùng một cửa. Trước: xe đã chốt phải "Mở lại" (xoá) rồi "Xác nhận" (chèn)
-- hai lần gọi rời; hỏng giữa chừng để lại Số xe không còn dòng.
CREATE OR REPLACE FUNCTION public.dispatch_commit_lines(p_gcs text[], p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  nd integer;
  ni integer;
BEGIN
  DELETE FROM public.khvc_lines WHERE group_code = ANY (p_gcs) AND sync_status IS DISTINCT FROM 'OBSOLETE';
  GET DIAGNOSTICS nd = ROW_COUNT;
  INSERT INTO public.khvc_lines (id, group_code, do_no, warehouse_code, npp, veh_type, dvvt, priority, cs, note, export_date, source, sync_status,
                                 gdo_id, raw, uploaded_by, created_at, updated_at, manual_edited_at, booking_category, vehicle_model_id,
                                 extra_vehicle_model_ids, stop_seq)
  SELECT r.id, r.group_code, r.do_no, r.warehouse_code, r.npp, r.veh_type, r.dvvt, r.priority, r.cs, r.note, r.export_date,
         coalesce(r.source, 'DISPATCH'), coalesce(r.sync_status, 'ACTIVE'), r.gdo_id, r.raw, r.uploaded_by, coalesce(r.created_at, now()),
         coalesce(r.updated_at, now()), r.manual_edited_at, r.booking_category, r.vehicle_model_id, coalesce(r.extra_vehicle_model_ids, '{}'), r.stop_seq
    FROM jsonb_populate_recordset(NULL::public.khvc_lines, coalesce(p_rows, '[]'::jsonb)) r;
  GET DIAGNOSTICS ni = ROW_COUNT;
  RETURN jsonb_build_object('deleted', nd, 'inserted', ni);
END $$;

-- TỰ CHỮA xe ↔ Kế hoạch xuất (11/10, 20261011a) KHÔNG được đụng kế hoạch đang có bản chụp: xe đã chốt vừa mở khoá để sửa là xe NHÁP mà
-- Số xe còn dòng Kế hoạch xuất — CÓ CHỦ ĐÍCH (Kế hoạch xuất giữ nguyên tới khi Lưu). Bản cũ coi đó là lệch và đưa xe về CONFIRMED ở lần
-- /sync kế tiếp (≤ 120 s) ⇒ xe tự khoá lại giữa lúc người đang sửa.
CREATE OR REPLACE FUNCTION public.dispatch_trip_khvc_heal(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  a integer := 0;
  b integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.dispatch_plan_edit e WHERE e.plan_id = p_plan_id) THEN
    UPDATE public.dispatch_trip t SET status = 'CONFIRMED', confirmed_at = coalesce(t.confirmed_at, now()), updated_at = now()
     WHERE t.plan_id = p_plan_id AND t.status = 'DRAFT'
       AND EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.group_code = t.group_code AND k.sync_status IS DISTINCT FROM 'OBSOLETE');
    GET DIAGNOSTICS a = ROW_COUNT;
  END IF;
  UPDATE public.dispatch_trip t SET status = 'DRAFT', confirmed_at = NULL, updated_at = now()
   WHERE t.plan_id = p_plan_id AND t.status = 'CONFIRMED'
     AND NOT EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.group_code = t.group_code AND k.sync_status IS DISTINCT FROM 'OBSOLETE');
  GET DIAGNOSTICS b = ROW_COUNT;
  RETURN jsonb_build_object('to_confirmed', a, 'to_draft', b);
END $$;

COMMIT;
