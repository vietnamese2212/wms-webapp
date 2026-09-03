-- ============================================================================
-- 20260903 — CHỐNG DÒ MẬT KHẨU xuyên instance + KHOÁ THEO TÀI KHOẢN + NHẬT KÝ ĐĂNG NHẬP
-- ============================================================================
-- Kiểm định 02/09: /login chỉ có express-rate-limit MemoryStore — trên serverless mỗi instance đếm riêng, cold start
-- reset, không khoá theo TÀI KHOẢN, không ghi log đăng nhập thất bại ⇒ dò mật khẩu 1 tài khoản rải qua nhiều instance
-- thì không ai thấy. Nay bộ đếm nằm ở DB (1 RPC/lượt), khoá theo 2 khoá song song `acct:<email>` (10 lần sai/15') và
-- `ip:<ip>` (30 lần sai/15'), khoá 15'; mọi lượt (sai/đúng/tài khoản vô hiệu) ghi `auth_login_events`.
-- MemoryStore giữ lại làm lớp phụ. 2 bảng nội bộ: bật RLS (gói 00 gác), KHÔNG realtime (gỡ trigger event-trigger vừa gắn).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.auth_attempts (
  key          text PRIMARY KEY,                       -- 'acct:<email thường>' | 'ip:<ip>'
  fails        int NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.auth_attempts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.auth_login_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text,
  ip          text,
  ok          boolean NOT NULL,
  reason      text,                                     -- BAD_PASSWORD | NO_ACCOUNT | NO_PASSWORD | INACTIVE | LOCKED | null khi ok
  employee_id text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.auth_login_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_auth_login_events_created ON public.auth_login_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_login_events_email   ON public.auth_login_events (email, created_at DESC);

-- Bảng nội bộ, không ai xem realtime: gỡ trigger broadcast mà event trigger `auto_realtime_new_tables` tự gắn
-- (không thì MỖI LẦN đăng nhập là 1 tín hiệu vô nghĩa tới mọi máy đang mở app).
DROP TRIGGER IF EXISTS trg_wms_notify ON public.auth_attempts;
DROP TRIGGER IF EXISTS trg_wms_notify ON public.auth_login_events;

-- p_event: 'check' (trước khi so mật khẩu) · 'fail' (sai → +1 mỗi khoá, khoá khi chạm trần) · 'ok' (đúng → xoá khoá
-- acct) · 'log' (chỉ ghi nhật ký, không đếm — tài khoản vô hiệu nhưng đúng mật khẩu). Trả {blocked, retry_after}.
CREATE OR REPLACE FUNCTION public.auth_throttle(
  p_keys text[], p_limits int[], p_event text, p_window_seconds int, p_lock_seconds int,
  p_email text, p_ip text, p_reason text, p_employee_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE i int; v_now timestamptz := now(); v_retry int := 0;
BEGIN
  IF p_event = 'ok' THEN
    DELETE FROM public.auth_attempts WHERE key = ANY(p_keys);
  ELSIF p_event = 'fail' THEN
    FOR i IN 1 .. COALESCE(array_length(p_keys, 1), 0) LOOP
      INSERT INTO public.auth_attempts(key, fails, window_start, updated_at) VALUES (p_keys[i], 1, v_now, v_now)
      ON CONFLICT (key) DO UPDATE SET
        fails        = CASE WHEN auth_attempts.window_start < v_now - make_interval(secs => p_window_seconds) THEN 1 ELSE auth_attempts.fails + 1 END,
        window_start = CASE WHEN auth_attempts.window_start < v_now - make_interval(secs => p_window_seconds) THEN v_now ELSE auth_attempts.window_start END,
        updated_at   = v_now;
      UPDATE public.auth_attempts SET locked_until = v_now + make_interval(secs => p_lock_seconds)
      WHERE key = p_keys[i] AND fails >= COALESCE(p_limits[i], 10) AND (locked_until IS NULL OR locked_until < v_now);
    END LOOP;
  END IF;
  IF p_event IN ('fail', 'ok', 'log') THEN
    INSERT INTO public.auth_login_events(email, ip, ok, reason, employee_id)
    VALUES (p_email, p_ip, p_event = 'ok', p_reason, p_employee_id);
  END IF;
  SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (locked_until - v_now)))::int, 0) INTO v_retry
  FROM public.auth_attempts WHERE key = ANY(p_keys) AND locked_until > v_now;
  -- Dọn lười (2% lượt): khoá đã hết hạn quá 1 ngày · nhật ký quá 90 ngày
  IF random() < 0.02 THEN
    DELETE FROM public.auth_attempts WHERE updated_at < v_now - interval '1 day' AND (locked_until IS NULL OR locked_until < v_now);
    DELETE FROM public.auth_login_events WHERE created_at < v_now - interval '90 days';
  END IF;
  RETURN jsonb_build_object('blocked', v_retry > 0, 'retry_after', v_retry);
END $$;
-- EXECUTE: default privileges sau 20260902d = postgres + service_role → không cần GRANT gì thêm.
