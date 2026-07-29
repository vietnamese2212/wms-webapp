-- ============================================================================
-- TAI MẮT PRODUCTION (29/07/2026) — bảng gom lỗi runtime để app TỰ BÁO lỗi,
-- thay vì chỉ phát hiện khi có người ngồi kiểm ("mỗi lần kiểm lại lòi một đống").
-- Ghi vào từ 2 nguồn:
--   - BE: mọi response 5xx đi qua maskServerMessage (utils/response.ts) — fire-and-forget.
--   - FE: window.onerror / unhandledrejection → POST /api/telemetry/client-error (public,
--         rate-limit + dedupe phía client, tối đa 5 lỗi/phiên).
-- Đọc ra qua GET /api/telemetry/digest (chỉ ĐẾM 24h, không lộ nội dung) — workflow keepalive
-- gọi hằng ngày: đếm BE > 0 → job đỏ → GitHub email user.
-- Bảng MỚI nên có DEFAULT (luật "INSERT phải tự cấp id/updated_at" là cho bảng CŨ thiếu default).
-- RLS bật + KHÔNG policy → anon/authenticated không đọc/ghi được; chỉ service role (BE) đụng vào.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.error_logs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL    DEFAULT now(),
  source     text        NOT NULL    CHECK (source IN ('be', 'fe')),
  status     integer,            -- HTTP status (BE) / null (FE)
  code       text,               -- mã lỗi app (SERVER_ERROR…) nếu có
  message    text NOT NULL,      -- đã cắt 500 ký tự phía ghi
  url        text,               -- FE: trang đang mở; BE: để trống (message thường đã có ngữ cảnh)
  ua         text                -- FE: user-agent rút gọn
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created ON public.error_logs (created_at DESC);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- Tự dọn: giữ 30 ngày là quá đủ cho digest — dọn lười mỗi lần BE ghi (xác suất 1%, xem response.ts).
-- (Không dùng pg_cron — free tier không bật sẵn; dọn lười đủ tốt cho bảng chỉ-ghi-ít này.)
