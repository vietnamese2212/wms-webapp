-- Sửa audit log điều chỉnh tồn KHÔNG BAO GIỜ ghi (InventoryAdjustmentLog 0 dòng toàn hệ thống).
-- Nguyên nhân: delta/cartons_before/cartons_after là INTEGER, nhưng cartons_remaining là NUMERIC (thập phân,
-- vd 7004.875) → INSERT giá trị thập phân vào cột integer thất bại; adjustInventory nuốt lỗi (console.error) → mất vết.
-- Fix: đổi 3 cột sang numeric cho khớp cartons_* của InventoryEntry. Không đổi code (giá trị insert vốn đúng).
ALTER TABLE "InventoryAdjustmentLog"
  ALTER COLUMN delta          TYPE numeric,
  ALTER COLUMN cartons_before TYPE numeric,
  ALTER COLUMN cartons_after  TYPE numeric;
