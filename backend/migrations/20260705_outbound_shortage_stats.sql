-- Cảnh báo thiếu tồn Xuất/Nhặt lẻ theo (kho, ngày giao):
--   demand    = tổng còn phải xuất (đặt - đã quét) của MỌI đơn chưa hủy trong ngày, theo mã hàng
--   available = tồn thực (cartons_remaining) LOẠI pallet QA giữ (qa_status_id) + LOẠI status QUARANTINE
--               (không trừ cartons_reserved — lượng reserve là dành cho chính các đơn của ngày đang so)
--   planned_remaining = KH nhập về kho (inbound_plan_lines ACTIVE, ngày KH từ HÔM NAY VN → ngày giao)
--               TRỪ lượng THỰC đã nhập của từng chuyến (phiếu nhập link TmsOrder qua tms_order_id
--               hoặc gate_registration) — hàng đã nhập chạy vào tồn rồi, không đếm trùng.
-- Tính toàn bộ trong DB (GROUP BY) — không dính cap-1000/aggregate-off của PostgREST.
CREATE OR REPLACE FUNCTION outbound_shortage_stats(p_warehouse_id text, p_date date)
RETURNS TABLE (material_id text, demand numeric, available numeric, planned_remaining numeric)
LANGUAGE sql STABLE AS $$
WITH demand AS (
  SELECT oi.material_id,
         SUM(GREATEST(COALESCE(oi.cartons_ordered, 0) - COALESCE(oi.cartons_scanned, 0), 0)) AS demand
  FROM "OutboundItem" oi
  JOIN "OutboundDelivery" od ON od.id = oi.do_id
  JOIN "GroupDeliveryOrder" g ON g.id = od.gdo_id
  WHERE g.warehouse_id = p_warehouse_id
    AND g.delivery_date = p_date
    AND g.status <> 'CANCELLED'
    AND oi.material_id IS NOT NULL
  GROUP BY oi.material_id
),
avail AS (
  SELECT ie.material_id, SUM(ie.cartons_remaining) AS available
  FROM "InventoryEntry" ie
  LEFT JOIN "Location" l ON l.id = ie.location_id
  WHERE COALESCE(l.warehouse_id, ie.warehouse_id::text) = p_warehouse_id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING')
    AND ie.cartons_remaining > 0
    AND ie.qa_status_id IS NULL
    AND ie.material_id IN (SELECT d.material_id FROM demand d)
  GROUP BY ie.material_id
),
plan AS (
  SELECT ipl.material_id, ipl.tms_order_id, SUM(COALESCE(ipl.planned_boxes, 0)) AS planned
  FROM inbound_plan_lines ipl
  WHERE ipl.warehouse_id = p_warehouse_id
    AND ipl.status = 'ACTIVE'
    AND ipl.date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    AND ipl.date <= p_date
    AND ipl.material_id IN (SELECT d.material_id FROM demand d)
  GROUP BY ipl.material_id, ipl.tms_order_id
),
received AS (
  SELECT COALESCE(pi.tms_order_id, gr.tms_order_id) AS tms_order_id, pi.material_id,
         SUM(COALESCE(ie.cartons_imported, 0)) AS received
  FROM "ProductionImport" pi
  LEFT JOIN gate_registrations gr ON gr.id = pi.gate_registration_id
  JOIN "InventoryEntry" ie ON ie.import_order_id = pi.id
  WHERE COALESCE(pi.tms_order_id, gr.tms_order_id) IN (SELECT p.tms_order_id FROM plan p WHERE p.tms_order_id IS NOT NULL)
  GROUP BY 1, 2
),
plan_net AS (
  SELECT p.material_id, SUM(GREATEST(p.planned - COALESCE(r.received, 0), 0)) AS planned_remaining
  FROM plan p
  LEFT JOIN received r ON r.tms_order_id = p.tms_order_id AND r.material_id = p.material_id
  GROUP BY p.material_id
)
SELECT d.material_id, d.demand,
       COALESCE(a.available, 0)          AS available,
       COALESCE(pn.planned_remaining, 0) AS planned_remaining
FROM demand d
LEFT JOIN avail a     ON a.material_id = d.material_id
LEFT JOIN plan_net pn ON pn.material_id = d.material_id
WHERE d.demand > 0
$$;
