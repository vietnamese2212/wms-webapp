-- CHẤT LƯỢNG PHỤC VỤ: giao ĐỦ và giao ĐÚNG HẠN (28/08)
--
-- App đang đo rất kỹ sản lượng, năng suất, chi phí — toàn chỉ số NỘI BỘ — mà không đo cái KHÁCH
-- HÀNG nhìn thấy. Đây là chỉ số số 1 của một chuỗi cung ứng.
--
-- ⚠️ NHU CẦU GỐC lấy ở đâu: luật "xuất thiếu thì hạ SL đơn = thực xuất" khiến `cartons_ordered`
-- SAU khi hoàn thành luôn bằng thực xuất. Nên nhu cầu gốc = số hiện tại + Σ mức đã bị hạ, lấy từ
-- sổ sự kiện do trigger `trg_outbound_qty_reduced` ghi (migration 20260828). Suy ra:
--   · dữ liệu TRƯỚC ngày bật trigger không có vết ⇒ luôn hiện 100% giao đủ. Màn hình PHẢI nói rõ
--     điều đó, không thì người đọc tưởng kho hoàn hảo.
--   · QTY_REDUCED_PLAN (cắt kế hoạch khi CHƯA lấy hàng) KHÔNG tính là giao thiếu — đó là khách
--     đổi ý/kế hoạch đổi, không phải kho phục vụ kém.
--
-- Đúng hạn: so ngày HOÀN THÀNH (giờ VN) với NGÀY XUẤT theo kế hoạch của chuyến.
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
  -- Mức đã bị hạ, gom theo (chuyến, mã hàng). Chỉ tính lần hạ có liên quan tới việc ĐÃ LẤY HÀNG.
  red AS (
    SELECT e.group_code, e.material_code,
           sum(e.old_value::numeric - e.new_value::numeric) AS cut
      FROM outbound_events e
     WHERE e.event_type IN ('QTY_REDUCED_TO_ACTUAL', 'QTY_REDUCED')
       AND e.old_value ~ '^[0-9.]+$' AND e.new_value ~ '^[0-9.]+$'
     GROUP BY 1, 2
  ),
  lines AS (
    SELECT t.id AS trip_id, t.group_code, t.warehouse_id, t.warehouse_name, t.on_time,
           d.distributor_name, oi.material_code_raw AS material_code,
           coalesce(oi.cartons_scanned, 0)::numeric AS shipped,
           oi.cartons_ordered::numeric + coalesce(r.cut, 0) AS demand
      FROM trips t
      JOIN "OutboundDelivery" d ON d.gdo_id = t.id
      JOIN "OutboundItem" oi    ON oi.do_id = d.id
      LEFT JOIN red r ON r.group_code = t.group_code AND r.material_code = oi.material_code_raw
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
        'on_time_pct',  CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE on_time), 1) / count(*) ELSE NULL END,
        'in_full_pct',  CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE in_full), 1) / count(*) ELSE NULL END,
        'otif_pct',     CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE on_time AND in_full), 1) / count(*) ELSE NULL END,
        -- Sao trung bình của các chuyến giao trong kỳ (kho nhận chấm lúc xác nhận đơn)
        'avg_stars',    (SELECT round(avg(rr.stars)::numeric, 2) FROM receipt_ratings rr
                          JOIN trips t2 ON t2.id = rr.gdo_id),
        'rated_trips',  (SELECT count(*) FROM receipt_ratings rr JOIN trips t2 ON t2.id = rr.gdo_id)
      ) FROM by_trip
    ),
    'by_warehouse', coalesce((
      SELECT jsonb_agg(x ORDER BY (x->>'trips')::int DESC) FROM (
        SELECT jsonb_build_object(
          'warehouse_id', warehouse_id, 'warehouse_name', coalesce(warehouse_name, '(không rõ)'),
          'trips', count(*), 'on_time_pct', round(100.0 * count(*) FILTER (WHERE on_time), 1) / count(*),
          'in_full_pct', round(100.0 * count(*) FILTER (WHERE in_full), 1) / count(*),
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
