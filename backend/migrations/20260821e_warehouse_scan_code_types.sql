-- 21/08/2026 — LOẠI MÃ CAMERA ĐỌC, đặt THEO TỪNG KHO (user chốt: "kho nào chỉ bắt QR, kho nào chỉ
-- bắt barcode, kho nào bắt cả 2").
--
-- Vì sao cần: mã vạch 1D KHÔNG có mã sửa lỗi ⇒ vạch mờ/moiré đọc ra số không có thật mà vẫn thoả
-- checksum (user báo "quét 14 ra 17"). Cách chặn TẬN GỐC ở kho chỉ dùng tem QR là ĐỪNG GIẢI mã vạch
-- ở đó — không giải thì không thể đọc sai. Kho có hàng NCC dán EAN trên thùng thì bật mã vạch.
--
-- MẶC ĐỊNH 'BOTH' = đúng hành vi đang chạy (từ 21/08 app đọc cả QR + 1D) ⇒ apply migration này
-- KHÔNG đổi hành vi kho nào; muốn siết thì đặt lại ở form Kho.
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS scan_code_types TEXT NOT NULL DEFAULT 'BOTH';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_scan_code_types_chk'
  ) THEN
    ALTER TABLE "Warehouse" ADD CONSTRAINT warehouse_scan_code_types_chk
      CHECK (scan_code_types IN ('QR', 'BARCODE', 'BOTH'));
  END IF;
END $$;

COMMENT ON COLUMN "Warehouse".scan_code_types IS
  'Loại mã camera được phép giải ở kho này: QR (chỉ tem QR) | BARCODE (chỉ mã vạch 1D) | BOTH.';
