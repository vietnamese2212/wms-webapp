-- Thêm cột ưu tiên và tình trạng xuất hàng cho TmsOrder
ALTER TABLE "TmsOrder"
  ADD COLUMN IF NOT EXISTS priority BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS export_status TEXT
    CHECK (export_status IN ('Đăng ký', 'Đang xuất', 'Đã xuất'));
