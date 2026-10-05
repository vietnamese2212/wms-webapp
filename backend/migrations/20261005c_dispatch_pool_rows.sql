-- 05/10/2026 — bỏ cửa sổ 14 ngày (20261005a) làm cửa nạp đơn của bàn điều vận (`loadCandidates`) kéo MỌI dòng ZSD02 của plant có ngày
-- giao ≤ ngày lập — kể cả đơn ĐÃ ĐIỀU (lịch sử) — về Node rồi mới loại. ZSD02 chỉ tăng (Ba Vì 16.582 dòng sau 3 tháng), nên số dòng kéo
-- tăng mãi theo lịch sử. Luật dự án: đừng kéo dòng để tính ra một tập — để DB loại phần đã điều TRƯỚC khi trả.
--   • dispatch_pool_rows(plant, ngày): dòng ACTIVE của plant, ngày giao ≤ ngày lập, TRỪ đơn đã có trong Kế hoạch xuất (khvc_lines chưa
--     OBSOLETE) — đơn có dòng đúng ngày lập vẫn giữ để bàn báo "Đã có trong KH xuất" như cũ. Theo ĐƠN, không theo dòng: bỏ một phần dòng
--     của đơn làm bản chụp lệch với phép so "SAP đã sửa" (lớp C38). Trả SETOF bảng ⇒ backend chọn cột + phân trang như truy vấn thường.
--   • dispatch_planned_ods(plant, ngày, n): n đơn ĐÃ ĐIỀU gần nhất có ngày giao trước ngày lập — cho tab Đã điều "Xem cả đơn tồn đọng
--     đã điều" (trước dùng chung cửa nạp ở trên với cờ reportAll).
--   • chỉ mục (plant, delivery_date) trên dòng ACTIVE — cả hai hàm + dispatch_new_ods lọc theo đúng hai cột này.
BEGIN;
CREATE INDEX IF NOT EXISTS idx_erp_ob_plant_dd_active ON public.erp_outbound_orders (plant, delivery_date)
  WHERE sync_status = 'ACTIVE' AND od_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.dispatch_pool_rows(p_plant text, p_day date) RETURNS SETOF public.erp_outbound_orders
LANGUAGE sql STABLE AS $$
  SELECT e.*
    FROM public.erp_outbound_orders e
   WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL AND e.delivery_date <= p_day
     AND (NOT EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.do_no = e.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE')
          OR EXISTS (SELECT 1 FROM public.erp_outbound_orders t WHERE t.od_number = e.od_number AND t.plant = p_plant
                        AND t.sync_status = 'ACTIVE' AND t.delivery_date = p_day))
$$;

CREATE OR REPLACE FUNCTION public.dispatch_planned_ods(p_plant text, p_day date, p_limit integer) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(x.od_number ORDER BY x.dd DESC, x.od_number), '{}'::text[])
    FROM (SELECT e.od_number, max(e.delivery_date) AS dd
            FROM public.erp_outbound_orders e
           WHERE e.plant = p_plant AND e.sync_status = 'ACTIVE' AND e.od_number IS NOT NULL AND e.delivery_date < p_day
             AND EXISTS (SELECT 1 FROM public.khvc_lines k WHERE k.do_no = e.od_number AND k.sync_status IS DISTINCT FROM 'OBSOLETE')
           GROUP BY e.od_number
           ORDER BY max(e.delivery_date) DESC, e.od_number
           LIMIT greatest(p_limit, 0)) x
$$;
COMMIT;
