-- Mã ship-to PHỤ cho Kho: 1 kho thật có thể có nhiều mã ship-to (cùng về 1 nơi).
-- Auto-detect chuyển kho (maybeAutoCreateTransferOrder) khớp shipto_party = code HOẶC nằm trong shipto_codes.
-- `code` vẫn là 1 ship-to chính; các mã còn lại bỏ vào mảng này.
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS shipto_codes text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN "Warehouse".shipto_codes IS 'Mã ship-to phụ (ngoài code chính). Auto-detect chuyển kho khớp code HOẶC phần tử trong mảng này.';
