-- ============================================================================
-- 20261011b — Chỉ mục PHỦ cho câu đếm đơn mới / pool của điều vận (chạy thử 11/10, kế hoạch 513 đơn Ba Vì)
-- ============================================================================
-- GET /tms/dispatch/plans/:id/sync 503 QUERY_TIMEOUT lặp lại (06/10 ×91, 11/10 ×3 trong một phiên): `dispatch_new_ods` đọc 13.501 dòng
-- ZSD02 chưa đi của plant qua Bitmap Heap Scan = 2,5 s riêng phần đọc heap (NANO, trang rải rác) trước khi gộp theo OD; cộng odFlags
-- là vượt 8 s. Thử trong giao dịch (rollback) với chỉ mục phủ: Index Only Scan 114 ms, cả câu 2,5 s → 141 ms.
-- Thay chỉ mục (plant, in_khvc) của 20261009b bằng bản phủ cùng khoá (cùng vai trò, thêm cột INCLUDE). Idempotent.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_erp_ob_plant_khvc_cover
  ON public.erp_outbound_orders (plant, in_khvc)
  INCLUDE (od_number, flow, material_code, ship_to_code, storage_location, sync_status);
DROP INDEX IF EXISTS public.idx_erp_ob_plant_khvc;
ANALYZE public.erp_outbound_orders;
