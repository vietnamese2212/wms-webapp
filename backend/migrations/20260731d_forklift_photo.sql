-- ============================================================================
-- XE NÂNG đợt 3 (31/07/2026) — user chốt: xe HOẠT ĐỘNG phải CHỤP ẢNH xe mới
-- được lưu check list (xe nghỉ thì không cần check an toàn / không cần ảnh).
-- 1. Cột photo_path trên forklift_daily_logs — đường dẫn object trong bucket.
-- 2. Bucket Storage RIÊNG TƯ 'forklift-photos' (bucket ĐẦU TIÊN của app):
--    - public=false + KHÔNG policy trên storage.objects → anon/authenticated
--      không đọc/ghi thẳng; chỉ BE (service role) upload + phát signed URL 1h.
--    - Ảnh đã nén client-side (~200-400KB JPEG) trước khi gửi — không đụng
--      trần 4,5MB Vercel; BE vẫn chặn cứng 4MB.
-- ============================================================================

ALTER TABLE public.forklift_daily_logs ADD COLUMN IF NOT EXISTS photo_path text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('forklift-photos', 'forklift-photos', false)
ON CONFLICT (id) DO NOTHING;
