-- Dọn key 'deliveries' (module "Giao hàng" đã XÓA 23/06/2026) khỏi JobTitle.module_permissions.
-- Không module/route nào còn đọc key này nên đây chỉ là dọn JSON rác cho gọn.
-- Idempotent: toán tử `- 'deliveries'` bỏ key nếu có, chạy lại không đổi.

UPDATE "JobTitle"
SET module_permissions = module_permissions - 'deliveries'
WHERE module_permissions ? 'deliveries';
