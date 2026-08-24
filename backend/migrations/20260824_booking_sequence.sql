-- 20260824 — STT chuẩn bị hàng theo booking khung giờ (user chốt 24/08).
-- Kho nhìn số 1,2,3… biết xe nào chuẩn bị trước. Số là DẪN XUẤT (không lưu cột):
-- sort theo (khung giờ time_from, giờ đặt lịch) rồi ROW_NUMBER — đổi/hủy booking là số
-- tự cập nhật, không cần đánh lại. Dãy số riêng theo (kho, ngày, chiều XUẤT/NHẬP).
-- Tie-break cùng khung giờ = vs.created_at (giờ tạo dòng xe ~ giờ đặt; KHÔNG dùng
-- updated_at vì sự kiện cổng/gate ghi lên cùng dòng sẽ xáo thứ tự giữa ngày).
-- Trả DÒNG jsonb trong 1 lời gọi (luật pool PostgREST — không trả id rồi nạp lại).

CREATE OR REPLACE FUNCTION booking_sequence(
  p_warehouse_ids text[],   -- NULL = mọi kho (user scope NATIONAL); ASSIGNED truyền danh sách kho
  p_from date,
  p_to   date
) RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'warehouse_id',  t.warehouse_id,
    'date',          t.date::text,
    'direction',     t.direction,
    'stt',           t.stt,
    'order_code',    t.order_code,
    'license_plate', t.license_plate,
    'time_from',     t.time_from,
    'time_to',       t.time_to
  ) ORDER BY t.warehouse_id, t.date, t.direction, t.stt), '[]'::jsonb)
  FROM (
    SELECT ds.warehouse_id, ds.date, o.direction, o.order_code, vs.license_plate,
           to_char(ds.time_from, 'HH24:MI') AS time_from,
           to_char(ds.time_to,   'HH24:MI') AS time_to,
           row_number() OVER (
             PARTITION BY ds.warehouse_id, ds.date, o.direction
             ORDER BY ds.time_from, vs.created_at, vs.id
           ) AS stt
    FROM "TmsVehicleSlot" vs
    JOIN "DeliverySlot" ds ON ds.id = vs.slot_id
    JOIN "TmsOrder"     o  ON o.id  = vs.order_id
    WHERE ds.date BETWEEN p_from AND p_to
      AND (p_warehouse_ids IS NULL OR ds.warehouse_id = ANY (p_warehouse_ids))
      AND COALESCE(o.plan_dropped, false) = false   -- lệnh bị bỏ khỏi kế hoạch: slot đã tự nhả, gác thêm cho chắc
  ) t
$$;
