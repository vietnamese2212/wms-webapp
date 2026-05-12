-- Xóa QA status "OK" khỏi InventoryEntry
-- (bỏ trống = mặc định OK, không cần lưu vào qa_status_id)
UPDATE "InventoryEntry"
SET qa_status_id = NULL,
    updated_at   = NOW()
WHERE qa_status_id IN (
  SELECT id FROM "QAStatus" WHERE UPPER(code) = 'OK'
);

-- NOTE: Không thêm warehouse_type vào bảng Warehouse.
-- "Loại kho" (TP, NVL, POSM...) đã được lưu trong bảng Location:
--   Location.sub_type  = "THANH_PHAM" | "NGUYEN_LIEU" | "BAN_THANH_PHAM" (enum)
--   Location.sub_name  = "Thành phẩm 1", "Nguyên liệu 1"... (hiển thị)
--   Location.sub_code  = "TP1", "NL1"... (mã ngắn)
-- Mỗi Warehouse có nhiều Location thuộc các loại khác nhau.
-- InventoryEntry → location_id → Location(sub_type, sub_name) → Warehouse(name)
