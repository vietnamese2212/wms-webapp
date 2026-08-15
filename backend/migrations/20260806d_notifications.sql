-- TRUNG TÂM THÔNG BÁO trên nút CHUÔNG (user chốt 06/08: "sao không kết hợp vào nút chuông" +
-- tab Cá nhân / Thông báo chung + cài đặt trường-hợp-nào-mới-đổ-chuông).
--
-- · user_notifications = FEED CÁ NHÂN (mỗi dòng = 1 việc đích danh gửi tới 1 người: được giao
--   lệnh fill…) — feed là LỊCH SỬ nên LUÔN ghi; cài đặt chỉ tắt CHUÔNG (push), không tắt feed.
-- · notification_prefs = cài đặt per user (jsonb key→bool, thiếu key = bật): assign, reconcile,
--   EXPIRY, GATE_DWELL, TRIP_LATE, WEIGH_DIFF, BE_ERRORS.
-- · alert_events.warehouse_name: thông báo chung phải nói rõ KHO NÀO (user góp ý) — scanner
--   resolve tên 1 lần lúc quét, list/push đọc thẳng không phải join.

ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS warehouse_name text;

CREATE TABLE IF NOT EXISTS user_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  kind        text NOT NULL,          -- ASSIGN | ... (phân loại icon/lọc phía FE)
  title       text NOT NULL,
  body        text,
  url         text,                   -- đường dẫn trong app khi bấm vào
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_notifications_emp ON user_notifications (employee_id, created_at DESC);

ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
-- Policy SELECT authenticated cho realtime (bài học RLS-chết-câm 04/08). Nội dung feed = thông tin
-- giao việc vốn hiển thị công khai trong app (assignee trên lệnh fill ai có quyền view đều thấy);
-- API đọc/ghi vẫn khoá theo CHÍNH CHỦ ở BE.
DROP POLICY IF EXISTS rls_auth_select ON user_notifications;
CREATE POLICY rls_auth_select ON user_notifications FOR SELECT TO authenticated USING (true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'user_notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE user_notifications;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS notification_prefs (
  employee_id uuid PRIMARY KEY,
  prefs       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;   -- đóng kín — chỉ service role qua API
