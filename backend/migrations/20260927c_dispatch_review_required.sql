-- ============================================================================
-- 20260927c — Điều vận: XEM ĐƠN là BƯỚC BẮT BUỘC trước khi ghép xe · phát hiện OD bị SAP sửa sau khi đã xem
-- ============================================================================
-- User chốt 27/09 tối: "đưa mục xem đơn là bắt buộc khi ghép xe — bước đầu tiên trên bàn làm việc là xem tất cả các đơn
-- open chưa có trong ghép xe. Xác nhận xong mới tới điều xe. Chú ý tính toán việc sửa đơn, điều chỉnh thì xử lý thế nào."
--  * `reviewed_at` / `reviewed_by` trên DÒNG OD của kế hoạch: NULL = chưa xem ⇒ máy KHÔNG ghép, người KHÔNG kéo lên xe được
--    (409 OD_NOT_REVIEWED). Xác nhận đơn = đặt mốc này (một cú bấm cho cả khung chờ, hoặc các OD đã tick).
--  * `sap_sig` = chữ ký dòng hàng SAP của OD lúc chụp (item|mã|SL base). ZSD02 nạp lại mà cùng OD đổi SL / dòng hàng ⇒ cờ
--    CHANGED trên bàn + chặn Xác nhận kế hoạch tới khi người bấm "Cập nhật theo SAP" (ghi chú giao hàng đổi: so với cột `note`).
--  * Dòng CÓ TRƯỚC luật này coi như ĐÃ XEM — nháp đang dở (Ba Vì 25/09 của người dùng) không bị khoá giữa chừng.
--    `sap_sig` để NULL = không so (không báo đổi oan cho dòng chụp trước khi có chữ ký).
-- Idempotent.
-- ============================================================================
BEGIN;

ALTER TABLE public.dispatch_trip_od ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.dispatch_trip_od ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE public.dispatch_trip_od ADD COLUMN IF NOT EXISTS sap_sig text;

UPDATE public.dispatch_trip_od SET reviewed_at = updated_at WHERE reviewed_at IS NULL;

COMMIT;
