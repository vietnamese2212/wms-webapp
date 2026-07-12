-- ════════════════════════════════════════════════════════════════════════════
-- 20260712_api_keys_reveal.sql — Cho phép XEM LẠI (reveal) API key sau khi tạo
-- Thêm cột key_enc: key thô ĐƯỢC MÃ HÓA (AES-256-GCM, khóa suy từ JWT_SECRET server).
-- KHÔNG lưu key thô. Chỉ superadmin (listKeys) giải mã để reveal/copy. Auth vẫn dùng
-- key_hash như cũ (không đổi). Key tạo TRƯỚC migration này → key_enc null → không reveal
-- được (phải tạo key mới) — chấp nhận.
--
-- Apply: Supabase Dashboard → SQL Editor. STAGING trước, test xong mới production.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public."ApiKey" ADD COLUMN IF NOT EXISTS key_enc text;

-- ROLLBACK: ALTER TABLE public."ApiKey" DROP COLUMN IF EXISTS key_enc;
