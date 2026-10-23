-- 20261023b — CHỮ KÝ BẢN ĐÃ LƯU (user 23/10: "bàn ở trạng thái Xem có nút Sửa; switch qua Sửa rồi — có một sự thay đổi thì nút switch
-- không dùng được, phải Lưu hoặc Khôi phục bản lưu mới switch được"). Bàn cần biết đã khác bản đã lưu chưa (xe đổi trạng thái / đơn đổi xe)
-- mà không kéo bản chụp vài trăm KB (`detail` của từng xe) về mỗi lần tải kế hoạch ⇒ RPC trả đúng id · trạng thái xe + cặp đơn–xe.
-- NULL = kế hoạch không có bản đã lưu đang chờ.
BEGIN;

CREATE OR REPLACE FUNCTION public.dispatch_edit_sig(p_plan_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
           'started_at', e.started_at,
           'started_by', e.started_by,
           'trips', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t->>'id', 'status', t->>'status')) FROM jsonb_array_elements(e.base->'trips') t), '[]'::jsonb),
           'ods',   coalesce((SELECT jsonb_agg(jsonb_build_object('od_number', o->>'od_number', 'trip_id', o->>'trip_id')) FROM jsonb_array_elements(e.base->'ods') o
                               WHERE o->>'trip_id' IS NOT NULL), '[]'::jsonb))
  FROM public.dispatch_plan_edit e
  WHERE e.plan_id = p_plan_id
$$;

COMMIT;
