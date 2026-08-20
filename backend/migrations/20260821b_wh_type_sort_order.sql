-- 21/08/2026 — THỨ TỰ LOẠI KHO THEO TỪNG KHO
-- Trước đây thứ tự loại kho chỉ nằm ở "LookupValue.sort_order" (DANH MỤC DÙNG CHUNG) nên kéo FG02
-- lên đầu ở kho A thì MỌI kho đều thấy FG02 đứng đầu. Nay mỗi (kho, loại) có thứ tự riêng.
--   sort_order NULL  = chưa sắp riêng → rơi về thứ tự danh mục dùng chung (hành vi cũ)
-- Danh mục dùng chung vẫn giữ nguyên vai trò: thứ tự mặc định + cây Đăng ký cổng.

ALTER TABLE warehouse_type_configs ADD COLUMN IF NOT EXISTS sort_order integer;

COMMENT ON COLUMN warehouse_type_configs.sort_order IS
  'Thứ tự loại kho RIÊNG của kho này (kéo-thả ở tab Loại kho khi đã chọn kho). NULL = theo danh mục dùng chung.';

-- Backfill = đúng thứ tự đang hiển thị hôm nay ⇒ mở màn không thấy gì xáo trộn
UPDATE warehouse_type_configs c
   SET sort_order = l.sort_order
  FROM "LookupValue" l
 WHERE l.type = 'warehouse_type'
   AND l.value = c.type_code
   AND c.sort_order IS NULL;
