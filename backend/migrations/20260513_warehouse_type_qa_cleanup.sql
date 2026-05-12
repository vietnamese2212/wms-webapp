-- Thêm cột warehouse_type vào bảng Warehouse
ALTER TABLE "Warehouse"
  ADD COLUMN IF NOT EXISTS "warehouse_type" TEXT;

COMMENT ON COLUMN "Warehouse"."warehouse_type" IS
  'Loại kho: TP (Thành phẩm), NVL (Nguyên vật liệu), POSM, Bao bì, v.v.';

-- Xóa QA status "OK" khỏi InventoryEntry
-- (bỏ trống = mặc định OK, không cần lưu vào qa_status_id)
UPDATE "InventoryEntry"
SET qa_status_id = NULL,
    updated_at   = NOW()
WHERE qa_status_id IN (
  SELECT id FROM "QAStatus" WHERE UPPER(code) = 'OK'
);

-- Sau khi apply migration, thực hiện các bước thủ công sau:
-- 1. Set warehouse_type cho từng kho:
--    UPDATE "Warehouse" SET warehouse_type = 'TP' WHERE code = '...'
-- 2. Confirm và set nmsx_code nếu chưa làm:
--    UPDATE "Warehouse" SET nmsx_code = 'B' WHERE code = 'BV'  -- Kho Ba Vì
--    UPDATE "Warehouse" SET nmsx_code = 'D' WHERE code = 'BB'  -- Kho Bàu Bàng
--    UPDATE "Warehouse" SET nmsx_code = 'O' WHERE code = 'GC'  -- NM gia công
