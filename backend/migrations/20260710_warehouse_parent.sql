-- Kho phụ (tổ sản xuất nội bộ tại site): kho có parent_warehouse_id = kho phụ của kho parent đó.
-- Kho phụ chỉ giao dịch với parent: nhận chuyển kho từ parent, xuất trả parent, xuất tiêu hao.
-- Cặp parent↔con được nới: biển số tùy chọn khi xuất, nhận hàng không cần booking ĐVVT.
-- Lưu ý: Warehouse.id là TEXT (không phải uuid) → cột FK phải TEXT.
ALTER TABLE "Warehouse"
  ADD COLUMN IF NOT EXISTS parent_warehouse_id text REFERENCES "Warehouse"(id);

COMMENT ON COLUMN "Warehouse".parent_warehouse_id IS
  'Kho phụ nội bộ: trỏ về kho site (parent) mà nó trực thuộc. NULL = kho thường. Không lồng 2 cấp (BE validate).';
