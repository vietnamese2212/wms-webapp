-- ============================================================================
-- 20260927d — Điều vận: THUÊ kế hoạch khi dựng lại / chèn dòng OD (ghép · tối ưu lại · nạp OD mới · thay OD · cập nhật theo SAP)
-- ============================================================================
-- check-app 27/09 tối: hai người cùng bấm "Xác nhận & ghép xe" (bước bắt buộc) ⇒ máy ghép HAI lần (Bàu Bàng 173 OD ⇒ 150 xe,
-- mọi OD nằm hai xe, cả hai lượt 200). Bản vá đầu = CAS trên updated_at lúc vào — chỉ chặn khi hai người đọc CÙNG lúc; người tới
-- sau 100 ms đọc được mốc mới rồi cũng qua (gói 61 [15k] đỏ lại). Nay: `busy_until` + `busy_token` — người đầu thuê tới khi xong
-- (nhả trong finally), người sau 409 PLAN_BUSY; tiến trình chết giữa chừng thì hết hạn tự nhả (90 s). Idempotent.
-- ============================================================================
BEGIN;
ALTER TABLE public.dispatch_plan ADD COLUMN IF NOT EXISTS busy_until timestamptz;
ALTER TABLE public.dispatch_plan ADD COLUMN IF NOT EXISTS busy_token text;
COMMIT;
