-- Thêm cột nmsx_code vào bảng Warehouse
-- Dùng để validate QR code khi nhập hàng:
--   vị trí thứ 6 (0-indexed: parts[5]) trong QR = mã NMSX phải khớp với nmsx_code của kho
-- Ví dụ: B = Kho Ba Vì, D = Kho Bàu Bàng, O = NM gia công

ALTER TABLE "Warehouse"
  ADD COLUMN IF NOT EXISTS "nmsx_code" TEXT;

COMMENT ON COLUMN "Warehouse"."nmsx_code" IS
  'Mã kho trong QR code (vị trí _ thứ 6). B=Kho Ba Vì, D=Kho Bàu Bàng, O=NM gia công. NULL = không bắt buộc validate.';
