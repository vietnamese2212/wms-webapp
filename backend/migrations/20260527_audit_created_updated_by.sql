-- Migration: thêm created_by / updated_by vào các bảng cần audit
-- Apply qua Supabase Dashboard → SQL Editor

-- GroupDeliveryOrder (Xuất kho)
ALTER TABLE "GroupDeliveryOrder"
  ADD COLUMN IF NOT EXISTS created_by  TEXT,
  ADD COLUMN IF NOT EXISTS updated_by  TEXT;

-- Location (Vị trí kho)
ALTER TABLE "Location"
  ADD COLUMN IF NOT EXISTS created_by  TEXT,
  ADD COLUMN IF NOT EXISTS updated_by  TEXT;

-- Warehouse (Kho)
ALTER TABLE "Warehouse"
  ADD COLUMN IF NOT EXISTS created_by  TEXT,
  ADD COLUMN IF NOT EXISTS updated_by  TEXT;

-- WarehouseZone (Khu vực kho)
ALTER TABLE "WarehouseZone"
  ADD COLUMN IF NOT EXISTS created_by  TEXT,
  ADD COLUMN IF NOT EXISTS updated_by  TEXT;

-- VehicleType (Loại xe TMS)
ALTER TABLE "VehicleType"
  ADD COLUMN IF NOT EXISTS created_by  TEXT,
  ADD COLUMN IF NOT EXISTS updated_by  TEXT;

-- TransportCompany (ĐVVT)
ALTER TABLE "TransportCompany"
  ADD COLUMN IF NOT EXISTS created_by  TEXT,
  ADD COLUMN IF NOT EXISTS updated_by  TEXT;

-- SlotTemplate (Khung giờ TMS)
ALTER TABLE "SlotTemplate"
  ADD COLUMN IF NOT EXISTS created_by  TEXT,
  ADD COLUMN IF NOT EXISTS updated_by  TEXT;

-- Employee (Nhân viên)
ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS created_by  TEXT,
  ADD COLUMN IF NOT EXISTS updated_by  TEXT;

-- Department (Phòng ban)
ALTER TABLE "Department"
  ADD COLUMN IF NOT EXISTS created_by  TEXT,
  ADD COLUMN IF NOT EXISTS updated_by  TEXT;

-- JobTitle (Chức danh) — cũng thêm timestamps nếu chưa có
ALTER TABLE "JobTitle"
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by  TEXT,
  ADD COLUMN IF NOT EXISTS updated_by  TEXT;

-- LookupValue (Loại kho và các lookup khác)
ALTER TABLE "LookupValue"
  ADD COLUMN IF NOT EXISTS created_by  TEXT,
  ADD COLUMN IF NOT EXISTS updated_by  TEXT;
