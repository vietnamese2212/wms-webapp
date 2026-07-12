-- ════════════════════════════════════════════════════════════════════════════
-- 20260712_api_keys.sql — Bảng ApiKey cho cổng tích hợp ERP (read-only pull)
-- ERP gọi /api/integration/v1/* kèm header X-API-Key. Key lưu DƯỚI DẠNG BĂM (sha256),
-- KHÔNG lưu key thô. Bảng này giữ bí mật → KHÓA như Employee: anon + authenticated
-- KHÔNG đọc được, KHÔNG vào realtime. Chỉ backend (service_role, bỏ qua RLS) đọc.
--
-- Apply: Supabase Dashboard → SQL Editor. STAGING trước, test xong mới production.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public."ApiKey" (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,                       -- nhãn dễ nhớ (vd "SAP-prod", "FAST-test")
  key_hash    text NOT NULL UNIQUE,                -- sha256(hex) của key thô — KHÔNG lưu key thô
  key_prefix  text,                                -- ~12 ký tự đầu để nhận diện trên UI (không đủ để dùng)
  scopes      text[] NOT NULL DEFAULT '{}',        -- vd {materials:read,inventory:read} hoặc {*}
  is_active   boolean NOT NULL DEFAULT true,       -- thu hồi = false → gọi API bị 401 ngay
  last_used_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text
);

-- KHÓA KÍN: bật RLS + KHÔNG policy nào + thu hồi mọi quyền của anon/authenticated.
-- (RLS bật mà không có policy → mọi dòng bị chặn kể cả role có GRANT; service_role bỏ qua RLS.)
ALTER TABLE public."ApiKey" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."ApiKey" FROM anon;
REVOKE ALL ON public."ApiKey" FROM authenticated;
-- KHÔNG thêm vào publication supabase_realtime (không broadcast hash key qua WAL).

-- ─── VERIFY sau khi apply (chạy bằng anon key — PHẢI rỗng/permission denied) ───
--   curl "$URL/rest/v1/ApiKey?select=*" -H "apikey:$ANON" -H "Authorization:Bearer $ANON"  → KHÔNG ra dữ liệu
-- ─── ROLLBACK ───
--   DROP TABLE IF EXISTS public."ApiKey";
