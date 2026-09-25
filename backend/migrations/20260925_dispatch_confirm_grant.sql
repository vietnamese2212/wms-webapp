-- ============================================================================
-- 20260925 — Điều vận: ai LẬP được kế hoạch thì XÁC NHẬN được (trừ phía nhà xe)
-- ============================================================================
-- User chốt 25/09 ("có cấp"), đảo phần "confirm CỐ Ý hẹp hơn plan" của 20260924d.
-- Đo 25/09 trước khi áp:
--   • PRODUCTION: 0/19 chức danh có dispatch.confirm — và 0/19 có external_khvc (điều kiện cấp
--     confirm của 20260924d), tức cửa Xác nhận chỉ superadmin bấm được.
--   • STAGING: 5 chức danh có plan mà thiếu confirm (Nhân viên/Quản lý điều vận, Quản lý kho NPP,
--     Điều hành ĐVVT…).
--
-- Luật: có dispatch.plan  ∧  phòng ban KHÔNG phải đơn vị vận tải (`Department.is_carrier`)
--   ⇒ thêm 'confirm'. Đọc theo CỜ, không so tên (ratchet `role_by_vietnamese_name`).
-- Vì sao loại nhà xe: Xác nhận ghi Kế hoạch xuất CỦA KHO; phía ĐVVT trả lời nhận/từ chối chuyến
-- (tầng B, link chào chuyến) chứ không chốt kế hoạch thay kho.
--
-- Route Xác nhận chỉ gác `dispatch.confirm` (tms.ts) — KHÔNG đòi thêm external_khvc; nên cấp thêm
-- external_khvc là quyết định riêng, migration này không đụng.
-- Idempotent: chạy lại không đổi gì; không gỡ quyền của ai.
-- ============================================================================
BEGIN;

UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(
         j.module_permissions, '{dispatch}',
         (j.module_permissions->'dispatch') || '["confirm"]'::jsonb, true),
       updated_at = now()
 WHERE (j.module_permissions->'dispatch') ? 'plan'
   AND NOT ((j.module_permissions->'dispatch') ? 'confirm')
   AND NOT EXISTS (SELECT 1 FROM public."Department" d WHERE d.id = j.department_id AND d.is_carrier);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public."JobTitle" j
   WHERE (j.module_permissions->'dispatch') ? 'plan'
     AND NOT ((j.module_permissions->'dispatch') ? 'confirm')
     AND NOT EXISTS (SELECT 1 FROM public."Department" d WHERE d.id = j.department_id AND d.is_carrier);
  IF n > 0 THEN RAISE EXCEPTION 'còn % chức danh lập được điều vận mà chưa xác nhận được', n; END IF;
END $$;

COMMIT;
