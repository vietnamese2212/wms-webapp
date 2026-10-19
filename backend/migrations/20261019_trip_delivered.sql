-- ============================================================================
-- 20261019 — "ĐÃ GIAO" do TÀI XẾ xác nhận trên DÒNG XE + quyền tms_plan.confirm_delivery
-- ============================================================================
-- User chốt 18/10: tình trạng một XE phải xem được ở mọi màn liên quan (bàn ghép xe · tab Kế hoạch · Xem đơn · Kế hoạch xuất ·
-- Đặt lịch · Xuất kho · Đăng ký cổng · Phiếu cân) như "document flow" của SAP; bước cuối "Đã giao" = khi TÀI XẾ xác nhận.
-- Đơn bán hàng trước đây KHÔNG có bước đã giao (chỉ chuyển kho có transfer_status). Mốc ghi trên TmsVehicleSlot — mỗi xe một dòng,
-- cùng chỗ tài xế / ĐVVT đã đặt khung giờ; hoàn tác được (xoá mốc) khi bấm nhầm.
--
-- QUYỀN (cấp theo NĂNG LỰC SẴN CÓ, không so tên — ratchet role_by_vietnamese_name; lớp C37):
--   • tms_plan.confirm_delivery ← chức danh TÀI XẾ (JobTitle.is_driver) ∨ đã có tms_plan.book (ĐVVT / điều vận đặt khung giờ hộ)
--     ∨ dispatch.confirm (người chốt kế hoạch — ghi hộ khi tài xế báo qua điện thoại)
--   • chức danh tài xế thêm tms_plan.view (mở được trang Kế hoạch VC để thấy xe của mình và bấm "Đã giao")
-- CHỈ điền cho chức danh CHƯA có action đó — admin đã tự cấp/gỡ thì không đè. Idempotent.
-- ============================================================================
BEGIN;

ALTER TABLE public."TmsVehicleSlot"
  ADD COLUMN IF NOT EXISTS delivered_at   timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_by   text,
  ADD COLUMN IF NOT EXISTS delivery_note  text;
COMMENT ON COLUMN public."TmsVehicleSlot".delivered_at IS 'Tài xế / ĐVVT xác nhận ĐÃ GIAO hàng cho khách (18/10/2026) — bước cuối của chuỗi tình trạng xe; null = chưa';

-- tài xế: view + confirm_delivery
UPDATE public."JobTitle" jt
SET module_permissions = jsonb_set(
      COALESCE(jt.module_permissions, '{}'::jsonb), '{tms_plan}',
      (SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements_text(
         COALESCE(jt.module_permissions->'tms_plan', '[]'::jsonb) || '["view","confirm_delivery"]'::jsonb) AS v))
WHERE jt.is_driver = true
  AND NOT (COALESCE(jt.module_permissions->'tms_plan', '[]'::jsonb) ? 'confirm_delivery');

-- người đặt khung giờ hộ / người chốt kế hoạch: confirm_delivery
UPDATE public."JobTitle" jt
SET module_permissions = jsonb_set(
      COALESCE(jt.module_permissions, '{}'::jsonb), '{tms_plan}',
      COALESCE(jt.module_permissions->'tms_plan', '[]'::jsonb) || '["confirm_delivery"]'::jsonb)
WHERE ((jt.module_permissions->'tms_plan') ? 'book' OR (jt.module_permissions->'dispatch') ? 'confirm')
  AND NOT (COALESCE(jt.module_permissions->'tms_plan', '[]'::jsonb) ? 'confirm_delivery');

COMMIT;
