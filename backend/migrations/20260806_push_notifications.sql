-- Web Push notification (Đợt 1 roadmap 06/08): hạ tầng đăng ký thiết bị + khóa VAPID per-silo.
-- 2 bảng đều RLS ĐÓNG (service role only) — KHÔNG realtime, KHÔNG policy đọc:
--   · push_subscriptions: mỗi dòng = 1 thiết bị (trình duyệt/PDA) của 1 nhân viên đã bật thông báo.
--   · push_config: 1 dòng duy nhất chứa cặp khóa VAPID — TỰ SINH lần gửi đầu (backend), mỗi silo
--     (mỗi DB) một cặp riêng, không cần khai Vercel env. KHÔNG để trong SystemSetting vì
--     GET /wms/settings hở đọc cho mọi user đăng nhập → lộ private key.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  endpoint    text NOT NULL UNIQUE,          -- URL push service (FCM/APNs/Mozilla) — khóa thiết bị
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  failed_n    integer NOT NULL DEFAULT 0,    -- đếm lỗi gửi liên tiếp (404/410 = xóa ngay, lỗi khác = tăng)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_employee ON push_subscriptions (employee_id);

CREATE TABLE IF NOT EXISTS push_config (
  id            integer PRIMARY KEY CHECK (id = 1),  -- ép 1 dòng duy nhất
  vapid_public  text NOT NULL,
  vapid_private text NOT NULL,
  subject       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_config        ENABLE ROW LEVEL SECURITY;
