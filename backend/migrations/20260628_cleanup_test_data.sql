-- ============================================================================
-- DỌN DỮ LIỆU TEST TRƯỚC GO-LIVE  (28/06/2026)
-- ----------------------------------------------------------------------------
-- GIỮ LẠI:
--   • Material (mã hàng) — toàn bộ catalog
--   • Employee — 35 nhân viên Kho Ba Vì + Admin (xóa 3 tài khoản test)
--   • Cấu hình nhân sự: Department, JobTitle, Skill, WorkLayout*, QAStatus,
--     ImportShift, LookupValue, UserWarehouseAccess (của nhân viên giữ)
--   • Warehouse + Location + WarehouseZone — KHÔNG đụng (anh tự sửa lại mã/tên kho)
-- XÓA SẠCH:
--   • Toàn bộ giao dịch: nhập / xuất / tồn / TMS / cổng / in tem / phân công /
--     chấm công / nghỉ phép
--   • Cấu hình TMS làm lại: VehicleType, SlotTemplate, DeliverySlot, Vehicle
--   • NCC + ĐVVT (TransportCompany) — làm lại
--   • Manufacturer (3 nhà máy placeholder, 0 mã hàng gắn)
--   • 3 nhân viên test: 20C12345, NPP TEST (88888888), Điều hành ALCA (DIEUHANHALCA)
-- ----------------------------------------------------------------------------
-- CÁCH CHẠY: Supabase Dashboard → SQL Editor → dán toàn bộ → Run.
-- An toàn: chạy trong 1 transaction (BEGIN…COMMIT) — lỗi giữa chừng tự rollback.
-- ============================================================================

BEGIN;

-- 1) Gỡ tham chiếu từ bảng GIỮ sang bảng SẮP XÓA (để xóa được master)
UPDATE "Employee" SET ncc_id = NULL          WHERE ncc_id IS NOT NULL;          -- nhân viên → ĐVVT
UPDATE "Material" SET manufacturer_id = NULL  WHERE manufacturer_id IS NOT NULL; -- mã hàng → nhà máy

-- 2) XÓA SẠCH giao dịch + cấu hình TMS + Xe (1 TRUNCATE: tự xử khóa ngoại vòng,
--    danh sách đã đóng kín — mọi bảng con tham chiếu đều nằm trong danh sách)
TRUNCATE TABLE
  "OutboundScanEntry", "OutboundItem", "OutboundDelivery", "GroupDeliveryOrder",
  "InventoryAdjustmentLog", "InventoryEntry", "ProductionImport",
  "inbound_plan_lines", "gate_registrations", "TmsVehicleSlot", "TmsOrder",
  "PalletLabelPrint", "PalletOperation",
  "Attendance", "LeaveRequest",
  "WorkAssignment", "WorkAssignmentDemand", "WorkAssignmentSheet",
  "DeliverySlot", "SlotTemplate", "VehicleType", "Vehicle";

-- 3) XÓA 3 nhân viên test (gỡ con trước: kỹ năng, quyền kho, quan hệ quản lý)
DELETE FROM "EmployeeSkill"
 WHERE employee_id IN (SELECT id FROM "Employee" WHERE employee_code IN ('20C12345','88888888','DIEUHANHALCA'));
DELETE FROM "UserWarehouseAccess"
 WHERE employee_id IN (SELECT id FROM "Employee" WHERE employee_code IN ('20C12345','88888888','DIEUHANHALCA'));
UPDATE "Employee" SET manager_id = NULL
 WHERE manager_id IN (SELECT id FROM "Employee" WHERE employee_code IN ('20C12345','88888888','DIEUHANHALCA'));
DELETE FROM "Employee" WHERE employee_code IN ('20C12345','88888888','DIEUHANHALCA');

-- 4) XÓA NCC + ĐVVT và Nhà máy placeholder (giờ đã hết tham chiếu)
DELETE FROM "TransportCompany";
DELETE FROM "Manufacturer";

-- 5) (TÙY CHỌN) Dọn nhánh chức danh/phòng ban chỉ phục vụ test — BỎ COMMENT nếu muốn:
-- DELETE FROM "Skill"               WHERE job_title_id IN (SELECT id FROM "JobTitle" WHERE name = 'Quản lý kho NPP');
-- DELETE FROM "WorkLayoutJobTitle"  WHERE job_title_id IN (SELECT id FROM "JobTitle" WHERE name = 'Quản lý kho NPP');
-- UPDATE "Employee" SET job_title_id = NULL WHERE job_title_id IN (SELECT id FROM "JobTitle" WHERE name = 'Quản lý kho NPP');
-- DELETE FROM "JobTitle"            WHERE name = 'Quản lý kho NPP';
-- DELETE FROM "Department"          WHERE name = 'Npp';

COMMIT;

-- ============================================================================
-- KIỂM TRA SAU KHI CHẠY (phải ra: 1004 mã hàng, 36 nhân viên, 0 ở mọi giao dịch)
-- ============================================================================
-- SELECT
--   (SELECT count(*) FROM "Material")            AS ma_hang,        -- 1004
--   (SELECT count(*) FROM "Employee")            AS nhan_vien,      -- 36 (35 kho + Admin)
--   (SELECT count(*) FROM "InventoryEntry")      AS ton,            -- 0
--   (SELECT count(*) FROM "ProductionImport")    AS nhap,           -- 0
--   (SELECT count(*) FROM "GroupDeliveryOrder")  AS xuat,           -- 0
--   (SELECT count(*) FROM "TmsOrder")            AS tms,            -- 0
--   (SELECT count(*) FROM gate_registrations)    AS cong,           -- 0
--   (SELECT count(*) FROM "TransportCompany")    AS ncc_dvvt,       -- 0
--   (SELECT count(*) FROM "Vehicle")             AS xe,             -- 0
--   (SELECT count(*) FROM "VehicleType")         AS loai_xe;        -- 0
