-- VÁ 2 LỖI CỦA `service_level` (phát hiện 30/08 khi soi lại công thức)
--
-- ── LỖI 1: MỨC ĐÃ HẠ BỊ CỘNG LẶP ⇒ báo OAN kho giao thiếu ──────────────────────────────────────
-- Nhu cầu GỐC = số lượng hiện tại + mức đã bị hạ (vết do trigger `trg_outbound_qty_reduced` ghi).
-- Bản 28/08 gom vết theo `(group_code, material_code)` rồi LEFT JOIN vào TỪNG DÒNG hàng. Nhưng một
-- chuyến có thể mang CÙNG MỘT MÃ trên nhiều dòng — đó là chuyện BÌNH THƯỜNG vì "NPP là khóa tách
-- dòng": cùng mã giao cho 2 nhà phân phối là 2 dòng. Đo staging 30/08: **218 chuyến** có mã trùng
-- trên 2 dòng (248 cặp). Với những chuyến đó, mức hạ được cộng vào CẢ HAI dòng ⇒ nhu cầu gốc bị
-- thổi gấp đôi ⇒ dòng đang giao ĐỦ bị tính thành GIAO THIẾU, fill rate tụt, và mã hàng vô tội leo
-- lên bảng "giao thiếu nhiều nhất". Sai theo hướng VU OAN, tức là hướng người ta sẽ đi sửa nhầm.
--
-- Vì sao chưa ai thấy: `outbound_events` hiện có 0 dòng QTY_REDUCED (trigger mới bật 28/08). Lỗi
-- này ngủ cho tới đúng lúc module bắt đầu có việc để đo — nên phải vá TRƯỚC khi có dữ liệu, không
-- thì số liệu sai sẽ trộn lẫn với số liệu đúng và không còn phân biệt được.
--
-- Cách vá: GỘP DÒNG trước theo đúng khóa mà trigger ghi vết — `(group_code, do_number,
-- material_code)`, trigger có ghi `do_number` nên khớp được tới từng DO — rồi mới cộng mức hạ MỘT
-- lần. Gộp cũng xử luôn 21 cặp lặp còn sót ở mức DO (cùng mã 2 dòng trong cùng một DO).
--
-- ── LỖI 2: BA Ô % KHÔNG HỀ ĐƯỢC LÀM TRÒN (dấu ngoặc đặt lệch) ─────────────────────────────────
--   ĐANG viết: round(100.0 * count(*) FILTER (WHERE on_time), 1) / count(*)
--   Ý ĐỊNH:    round(100.0 * count(*) FILTER (WHERE on_time) / count(*), 1)
-- Làm tròn TỬ SỐ (vốn đã là số nguyên ⇒ vô tác dụng) rồi mới chia, nên kết quả giữ nguyên 16-18
-- chữ số thập phân: 2/3 chuyến đúng hạn trả `66.6666666666666667` thay vì `66.7`. Màn Tổng quan
-- đang che lỗi này bằng `.toFixed(1)` phía giao diện, nhưng hợp đồng của RPC là trả số đã làm tròn
-- — ai đọc thẳng (xuất Excel, tích hợp ngoài, cảnh báo) sẽ nhận số rác. Sửa ở NGUỒN, không dựa vào
-- chỗ hiển thị dọn hộ. Ô `fill_rate` vốn viết đúng, giữ nguyên.
CREATE OR REPLACE FUNCTION public.service_level(
  p_from       date,
  p_to         date,
  p_wh_ids     text[] DEFAULT NULL,
  p_limit      int DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE v_out jsonb; v_lim int := least(greatest(coalesce(p_limit, 20), 5), 100);
BEGIN
  WITH trips AS (
    SELECT g.id, g.group_code, g.warehouse_id, g.delivery_date, g.completed_at,
           w.name AS warehouse_name,
           (g.completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= g.delivery_date AS on_time
      FROM "GroupDeliveryOrder" g
      LEFT JOIN "Warehouse" w ON w.id = g.warehouse_id
     WHERE g.status = 'COMPLETED'
       AND g.delivery_date BETWEEN p_from AND p_to
       AND (p_wh_ids IS NULL OR g.warehouse_id = ANY(p_wh_ids))
  ),
  -- Mức đã bị hạ, gom theo ĐÚNG khóa trigger ghi: chuyến + DO + mã hàng.
  -- Chỉ tính lần hạ có liên quan tới việc ĐÃ LẤY HÀNG (QTY_REDUCED_PLAN = cắt kế hoạch, không phải
  -- lỗi phục vụ). `do_number` có thể NULL ở vết cũ ⇒ dùng '' để join không rơi mất dòng.
  red AS (
    SELECT e.group_code, coalesce(e.do_number, '') AS do_number, e.material_code,
           sum(e.old_value::numeric - e.new_value::numeric) AS cut
      FROM outbound_events e
     WHERE e.event_type IN ('QTY_REDUCED_TO_ACTUAL', 'QTY_REDUCED')
       AND e.old_value ~ '^[0-9.]+$' AND e.new_value ~ '^[0-9.]+$'
     GROUP BY 1, 2, 3
  ),
  -- GỘP TRƯỚC theo khóa của vết, rồi mới cộng mức hạ ⇒ mỗi mức hạ vào đúng một lần.
  raw_lines AS (
    SELECT t.id AS trip_id, t.group_code, t.warehouse_id, t.warehouse_name, t.on_time,
           coalesce(d.delivery_code, '') AS do_number,
           oi.material_code_raw AS material_code,
           sum(coalesce(oi.cartons_scanned, 0))::numeric AS shipped,
           sum(oi.cartons_ordered)::numeric              AS ordered
      FROM trips t
      JOIN "OutboundDelivery" d ON d.gdo_id = t.id
      JOIN "OutboundItem" oi    ON oi.do_id = d.id
     GROUP BY 1, 2, 3, 4, 5, 6, 7
  ),
  lines AS (
    SELECT l.trip_id, l.group_code, l.warehouse_id, l.warehouse_name, l.on_time,
           l.material_code, l.shipped,
           l.ordered + coalesce(r.cut, 0) AS demand
      FROM raw_lines l
      LEFT JOIN red r
             ON r.group_code = l.group_code
            AND r.do_number  = l.do_number
            AND r.material_code = l.material_code
  ),
  by_trip AS (
    SELECT trip_id, group_code, warehouse_id, warehouse_name, on_time,
           sum(demand) AS demand, sum(shipped) AS shipped,
           bool_and(shipped >= demand) AS in_full
      FROM lines GROUP BY 1, 2, 3, 4, 5
  )
  SELECT jsonb_build_object(
    'summary', (
      SELECT jsonb_build_object(
        'trips',        count(*),
        'lines',        (SELECT count(*) FROM lines),
        'lines_short',  (SELECT count(*) FROM lines WHERE shipped < demand),
        'demand',       coalesce((SELECT sum(demand)  FROM lines), 0),
        'shipped',      coalesce((SELECT sum(shipped) FROM lines), 0),
        'fill_rate',    CASE WHEN coalesce((SELECT sum(demand) FROM lines), 0) > 0
                             THEN round(100.0 * (SELECT sum(shipped) FROM lines) / (SELECT sum(demand) FROM lines), 1)
                             ELSE NULL END,
        'on_time_pct',  CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE on_time) / count(*), 1) ELSE NULL END,
        'in_full_pct',  CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE in_full) / count(*), 1) ELSE NULL END,
        'otif_pct',     CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE on_time AND in_full) / count(*), 1) ELSE NULL END,
        -- Sao trung bình của các chuyến giao trong kỳ (kho nhận chấm lúc nhận hàng)
        'avg_stars',    (SELECT round(avg(rr.stars)::numeric, 2) FROM receipt_ratings rr
                          JOIN trips t2 ON t2.id = rr.gdo_id),
        'rated_trips',  (SELECT count(*) FROM receipt_ratings rr JOIN trips t2 ON t2.id = rr.gdo_id),
        -- Chuyến THUỘC DIỆN CHẤM = chuyển kho mà kho nhận có TÍCH NHẬN (xem ghi chú migration gốc)
        'ratable_trips', (SELECT count(*) FROM trips t3
                           WHERE EXISTS (SELECT 1 FROM "TmsOrder" o
                                          WHERE o.transfer_gdo_id = t3.id
                                            AND coalesce(o.delivery_mode, '') <> 'SELF'))
      ) FROM by_trip
    ),
    'by_warehouse', coalesce((
      SELECT jsonb_agg(x ORDER BY (x->>'trips')::int DESC) FROM (
        SELECT jsonb_build_object(
          'warehouse_id', warehouse_id, 'warehouse_name', coalesce(warehouse_name, '(không rõ)'),
          'trips', count(*),
          'on_time_pct', round(100.0 * count(*) FILTER (WHERE on_time) / count(*), 1),
          'in_full_pct', round(100.0 * count(*) FILTER (WHERE in_full) / count(*), 1),
          'demand', sum(demand), 'shipped', sum(shipped),
          'fill_rate', CASE WHEN sum(demand) > 0 THEN round(100.0 * sum(shipped) / sum(demand), 1) ELSE NULL END
        ) x
        FROM by_trip GROUP BY warehouse_id, warehouse_name
      ) s), '[]'::jsonb),
    -- Mã hàng giao thiếu nhiều nhất — chỗ để đi tìm nguyên nhân (hết tồn? nhặt sót? kế hoạch ảo?)
    'top_short', coalesce((
      SELECT jsonb_agg(x ORDER BY (x->>'missing')::numeric DESC) FROM (
        SELECT jsonb_build_object(
          'material_code', material_code, 'lines', count(*),
          'missing', sum(demand - shipped), 'demand', sum(demand)
        ) x
        FROM lines WHERE shipped < demand
        GROUP BY material_code ORDER BY sum(demand - shipped) DESC LIMIT v_lim
      ) s), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $fn$;
