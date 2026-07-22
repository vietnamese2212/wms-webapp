-- Đánh dấu dòng raw bị SỬA TAY (user 22/07: hiện symbol ✎ sau số DO ở tab DO SAP / Kế hoạch xuất).
-- Set khi PUT/POST tay (updateDoSap/createDoSap/updateKhvc/createKhvc);
-- RESET về NULL khi upload đè lại từ SAP/Excel (uploadVl06o dòng UPDATE, uploadKhvc upsert).
alter table public.erp_outbound_orders add column if not exists manual_edited_at timestamptz;
alter table public.khvc_lines          add column if not exists manual_edited_at timestamptz;
