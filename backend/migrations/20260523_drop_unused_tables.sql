-- ============================================================
-- Drop các bảng không còn dùng
-- Apply: Supabase Dashboard → SQL Editor
-- Review trước khi chạy — mỗi nhóm có thể apply độc lập
-- ============================================================

-- ── Nhóm 1: Infrastructure stubs — an toàn 100% ─────────────
-- Tạo từ Prisma init nhưng không có controller, không có FK từ bảng đang dùng
DROP TABLE IF EXISTS "Menu"             CASCADE;
DROP TABLE IF EXISTS "Setting"          CASCADE;
DROP TABLE IF EXISTS "LocationTransfer" CASCADE;

-- ── Nhóm 2: Cũ TMS (thay bằng TMS mới: VehicleType/TransportCompany/Vehicle) ──
-- DeliveryOrder: TMS cũ, không có controller, superseded bởi GroupDeliveryOrder+OutboundDelivery
-- Driver: TMS cũ, Employee.is_driver thay thế. KIỂM TRA trước: nếu Vehicle cũ vẫn có FK → bỏ dòng này
DROP TABLE IF EXISTS "DeliveryOrder" CASCADE;
DROP TABLE IF EXISTS "Driver"        CASCADE;

-- ── Nhóm 3: HR module — chưa implement ──────────────────────
-- Các bảng này được tạo sẵn cho module HR (chưa có API/UI).
-- Nếu kế hoạch implement HR trong 3 tháng tới → bỏ qua nhóm này.
DROP TABLE IF EXISTS "OvertimeRequest" CASCADE;
DROP TABLE IF EXISTS "Schedule"        CASCADE;
DROP TABLE IF EXISTS "Shift"           CASCADE;
DROP TABLE IF EXISTS "Attendance"      CASCADE;
