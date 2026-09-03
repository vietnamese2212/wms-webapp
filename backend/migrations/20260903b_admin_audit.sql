-- ============================================================================
-- 20260903b — NHẬT KÝ QUẢN TRỊ (admin audit): ai đổi quyền / phạm vi kho / mật khẩu / API key / cờ hệ thống, lúc nào, từ giá trị gì sang gì
-- ============================================================================
-- Sau kiểm định 02–03/09: app có sổ sự kiện NGHIỆP VỤ (outbound_events) và nhật ký ĐĂNG NHẬP (auth_login_events)
-- nhưng KHÔNG có vết cho thao tác QUẢN TRỊ — câu IT chủ đầu tư chắc chắn hỏi ("ai cấp quyền này, khi nào?").
-- Bảng nội bộ: bật RLS (gói 00 gác), KHÔNG realtime (gỡ trigger event-trigger vừa gắn), đọc qua BE
-- GET /masterdata/admin-audit (quyền user_admin.audit_log). Ghi từ services/adminAudit.ts (augment: hỏng sổ không hỏng nghiệp vụ).
-- before/after chỉ chứa các TRƯỜNG ĐỔI (diff), không lưu mật khẩu/API key (chỉ ghi "đã đặt").
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_audit_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     text,
  actor_name   text,
  ip           text,
  action       text NOT NULL,          -- EMPLOYEE_CREATE | EMPLOYEE_UPDATE | PASSWORD_SET | ACCOUNT_UNLOCK | EMPLOYEE_DELETE | EMPLOYEE_RESTORE |
                                       -- WAREHOUSE_ACCESS | MANAGER_SET | JOBTITLE_CREATE | JOBTITLE_UPDATE | JOBTITLE_PARENT | DEPARTMENT_CREATE |
                                       -- DEPARTMENT_UPDATE | SETTING_UPDATE | VISION_CONFIG | APIKEY_CREATE | APIKEY_REVOKE | APIKEY_DELETE
  target_type  text NOT NULL,          -- Employee | JobTitle | Department | SystemSetting | ApiKey
  target_id    text,
  target_label text,                   -- tên/mã người đọc hiểu được (nhân viên đã xoá vẫn còn tên)
  before       jsonb,
  after        jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_audit_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON public.admin_audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target  ON public.admin_audit_events (target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action  ON public.admin_audit_events (action, created_at DESC);
DROP TRIGGER IF EXISTS trg_wms_notify ON public.admin_audit_events;
