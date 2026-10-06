-- DẤU PHIÊN BẢN của một kế hoạch điều vận (06/10, user: "đúng là chỉ thao tác ở phần trả").
--
-- Vì sao: realtime của dispatch_trip / dispatch_trip_od chỉ mang {table, op} ⇒ mọi lần ghi (kể cả của chính người vừa kéo thả)
-- làm MỌI bàn điều vận đang mở tải lại CẢ kế hoạch (Bàu Bàng 709 xe = 3,9 MB, ~5 request PostgREST). Nay thao tác trả phần thay đổi
-- kèm dấu này; bàn nhận tín hiệu realtime thì hỏi dấu (1 request nhỏ) — trùng dấu đang giữ thì KHÔNG tải lại (tiếng vọng của chính
-- mình, hoặc tín hiệu của kế hoạch khác), khác dấu mới tải.
--
-- Dấu = kế hoạch (updated_at · status) + số xe & mốc sửa cuối của xe + số dòng OD & mốc sửa cuối của dòng OD. Mọi cửa ghi đặt
-- updated_at khi sửa; xoá dòng thì SỐ dòng đổi. Cột thuê kế hoạch (busy_until) không nằm trong dấu — đổi chúng không phải đổi nội dung.
-- Trả jsonb kèm warehouse_id để cửa API gác phạm vi kho trong MỘT lần gọi.
CREATE OR REPLACE FUNCTION public.dispatch_plan_stamp(p_plan_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'warehouse_id', p.warehouse_id,
    'stamp', concat_ws('|',
      extract(epoch FROM p.updated_at)::text || ':' || p.status,
      (SELECT count(*)::text || ':' || coalesce(extract(epoch FROM max(t.updated_at))::text, '-') FROM public.dispatch_trip t WHERE t.plan_id = p.id),
      (SELECT count(*)::text || ':' || coalesce(extract(epoch FROM max(o.updated_at))::text, '-') FROM public.dispatch_trip_od o WHERE o.plan_id = p.id)))
  FROM public.dispatch_plan p
  WHERE p.id = p_plan_id
$$;
