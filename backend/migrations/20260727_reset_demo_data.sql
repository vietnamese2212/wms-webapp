-- ============================================================================
-- DỌN DỮ LIỆU ĐỂ DEMO CHỦ ĐẦU TƯ  (27/07/2026) — CHẠY TRÊN STAGING
-- ----------------------------------------------------------------------------
-- User chốt: xoá Mã hàng + Tồn + Nhập + Xuất + Kế hoạch (VC/nhập/xuất) rồi
-- upload tay lại. GIỮ NGUYÊN: Kho, Vị trí, Khu vực, NCC/ĐVVT, Xe, Loại xe,
-- Khung giờ (SlotTemplate + DeliverySlot), Nhân sự, Chức danh, Phân quyền,
-- QA/Ca/LookupValue, Cờ hệ thống, ApiKey, Phiếu cân, HR (chấm công/nghỉ/phân công).
--
-- AN TOÀN: mọi bảng bị xoá được sao lưu NGUYÊN VẸN sang schema bak_20260727
--          TRƯỚC khi truncate. Toàn bộ nằm trong 1 transaction.
-- CÁCH CHẠY: Supabase Dashboard (staging) → SQL Editor → dán → Run.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) SAO LƯU (schema riêng, khôi phục được; xong việc thì DROP SCHEMA)
-- ---------------------------------------------------------------------------
DROP SCHEMA IF EXISTS bak_20260727 CASCADE;
CREATE SCHEMA bak_20260727;

CREATE TABLE bak_20260727."Material"               AS SELECT * FROM public."Material";
CREATE TABLE bak_20260727."InventoryEntry"         AS SELECT * FROM public."InventoryEntry";
CREATE TABLE bak_20260727."InventoryAdjustmentLog" AS SELECT * FROM public."InventoryAdjustmentLog";
CREATE TABLE bak_20260727."StocktakeLog"           AS SELECT * FROM public."StocktakeLog";
CREATE TABLE bak_20260727."ProductionImport"       AS SELECT * FROM public."ProductionImport";
CREATE TABLE bak_20260727."gate_registrations"     AS SELECT * FROM public.gate_registrations;
CREATE TABLE bak_20260727."GroupDeliveryOrder"     AS SELECT * FROM public."GroupDeliveryOrder";
CREATE TABLE bak_20260727."OutboundDelivery"       AS SELECT * FROM public."OutboundDelivery";
CREATE TABLE bak_20260727."OutboundItem"           AS SELECT * FROM public."OutboundItem";
CREATE TABLE bak_20260727."OutboundScanEntry"      AS SELECT * FROM public."OutboundScanEntry";
CREATE TABLE bak_20260727."TmsOrder"               AS SELECT * FROM public."TmsOrder";
CREATE TABLE bak_20260727."TmsVehicleSlot"         AS SELECT * FROM public."TmsVehicleSlot";
CREATE TABLE bak_20260727."inbound_plan_lines"     AS SELECT * FROM public.inbound_plan_lines;
CREATE TABLE bak_20260727."erp_outbound_orders"    AS SELECT * FROM public.erp_outbound_orders;
CREATE TABLE bak_20260727."khvc_lines"             AS SELECT * FROM public.khvc_lines;
CREATE TABLE bak_20260727."reconcile_tasks"        AS SELECT * FROM public.reconcile_tasks;
CREATE TABLE bak_20260727."PalletLabelPrint"       AS SELECT * FROM public."PalletLabelPrint";
CREATE TABLE bak_20260727."PalletOperation"        AS SELECT * FROM public."PalletOperation";
CREATE TABLE bak_20260727."SlottingPlan"           AS SELECT * FROM public."SlottingPlan";
CREATE TABLE bak_20260727."SlottingPlanLine"       AS SELECT * FROM public."SlottingPlanLine";
CREATE TABLE bak_20260727."DeliverySlot"           AS SELECT * FROM public."DeliverySlot";  -- để trả lại booked_count nếu cần

-- ---------------------------------------------------------------------------
-- 2) XOÁ SẠCH — 1 TRUNCATE (danh sách đóng kín: đã kiểm không bảng NGOÀI danh
--    sách nào trỏ vào các bảng này, nên không cần CASCADE)
-- ---------------------------------------------------------------------------
TRUNCATE TABLE
  -- tồn
  "InventoryEntry", "InventoryAdjustmentLog", "StocktakeLog",
  -- nhập
  "ProductionImport", gate_registrations,
  -- xuất
  "GroupDeliveryOrder", "OutboundDelivery", "OutboundItem", "OutboundScanEntry",
  -- kế hoạch vận chuyển / nhập / xuất (gồm tầng raw SAP)
  "TmsOrder", "TmsVehicleSlot", inbound_plan_lines,
  erp_outbound_orders, khvc_lines, reconcile_tasks,
  -- phụ trợ bám pallet (mồ côi sau khi xoá tồn)
  "PalletLabelPrint", "PalletOperation", "SlottingPlan", "SlottingPlanLine",
  -- mã hàng (upload lại)
  "Material";

-- ---------------------------------------------------------------------------
-- 3) RESET BỘ ĐẾM CACHE — BẮT BUỘC
--    booked_count là cache số lượt đặt của khung giờ. Giữ khung giờ mà không
--    reset → slot hiện "đã đầy" → KHÔNG đặt lịch mới được (hỏng ngay lúc demo).
-- ---------------------------------------------------------------------------
UPDATE "DeliverySlot" SET booked_count = 0 WHERE booked_count <> 0;

COMMIT;

-- ============================================================================
-- KIỂM TRA SAU KHI CHẠY — mọi số ở cột "sau" phải bằng 0, các bảng GIỮ không đổi
-- ============================================================================
-- SELECT
--   (SELECT count(*) FROM "Material")           AS ma_hang,      -- 0
--   (SELECT count(*) FROM "InventoryEntry")     AS ton,          -- 0
--   (SELECT count(*) FROM "ProductionImport")   AS nhap,         -- 0
--   (SELECT count(*) FROM "GroupDeliveryOrder") AS xuat,         -- 0
--   (SELECT count(*) FROM "TmsOrder")           AS ke_hoach,     -- 0
--   (SELECT count(*) FROM "DeliverySlot" WHERE booked_count <> 0) AS slot_ket, -- 0
--   (SELECT count(*) FROM "Warehouse")          AS kho,          -- 153 (giữ)
--   (SELECT count(*) FROM "Location")           AS vi_tri,       -- 194 (giữ)
--   (SELECT count(*) FROM "TransportCompany")   AS ncc_dvvt,     -- 111 (giữ)
--   (SELECT count(*) FROM "Vehicle")            AS xe,           -- 953 (giữ)
--   (SELECT count(*) FROM "SlotTemplate")       AS khung_gio,    -- 1296 (giữ)
--   (SELECT count(*) FROM "Employee")           AS nhan_su;      -- 39 (giữ)

-- ============================================================================
-- TRẢ LẠI 3 CỜ MÃ HÀNG sau khi user upload file Mã hàng mới
-- (khớp theo material_code; chỉ bật cho mã user để TRỐNG trong file)
-- ============================================================================
-- UPDATE "Material" m SET
--   no_qr_tracking    = m.no_qr_tracking    OR b.no_qr_tracking,
--   is_non_stock      = m.is_non_stock      OR b.is_non_stock,
--   is_pallet_carrier = m.is_pallet_carrier OR b.is_pallet_carrier,
--   updated_at        = now()
-- FROM bak_20260727."Material" b
-- WHERE b.material_code = m.material_code
--   AND (b.no_qr_tracking OR b.is_non_stock OR b.is_pallet_carrier)
--   AND (m.no_qr_tracking, m.is_non_stock, m.is_pallet_carrier)
--       IS DISTINCT FROM (b.no_qr_tracking, b.is_non_stock, b.is_pallet_carrier);

-- ============================================================================
-- DỌN SAO LƯU khi đã chắc chắn (KHÔNG khôi phục được sau lệnh này)
-- ============================================================================
-- DROP SCHEMA bak_20260727 CASCADE;
