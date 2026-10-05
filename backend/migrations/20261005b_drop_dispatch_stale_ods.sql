-- 05/10/2026 — bỏ băng "quá hạn chưa quyết" của bàn điều vận (cửa sổ 14 ngày bỏ cùng, 20261005a): hàm `dispatch_stale_ods` không
-- còn cửa nào gọi (GET /tms/dispatch/plans/:id/stale đã gỡ). ÁP SAU khi Preview / Production chạy bản code đã gỡ route — áp trước thì
-- bản cũ đang chạy gọi hàm đã mất (lớp C52, DROP trước khi code bỏ đọc lên máy).
BEGIN;
DROP FUNCTION IF EXISTS public.dispatch_stale_ods(text, text, date);
COMMIT;
