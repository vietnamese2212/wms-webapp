-- 21/08/2026 — LOẠI KHO = DANH MỤC CHUNG, SETTING RIÊNG TỪNG KHO (user chốt vòng cuối)
--   • Tên loại + Màu + Bắt buộc HSD + Bắt buộc Pallet/EA  = KHAI 1 LẦN, áp mọi kho
--     (2 cờ sau ràng buộc HỒ SƠ MÃ HÀNG, mà mã hàng dùng chung toàn hệ thống)
--   • Thứ tự · chiến thuật xuất/nhập · 3 cờ vận hành       = RIÊNG từng kho
--   • Tạo loại kho mới ⇒ MỌI kho đều có (không còn "kho vận hành loại nào")
--
-- 3 cờ vận hành chuyển xuống bảng gán vì app đọc chúng khi ĐANG ĐỨNG Ở MỘT KHO cụ thể:
--   is_ncc_goods  → quét tem nhập tại kho / sinh tem cho kho
--   requires_ncc  → quét nhập · lưu tay · upload tồn của kho
--   batch_char    → sinh tem V2 cho kho
-- NULL = theo giá trị chung ở danh mục ⇒ sau migration mọi cột NULL, hành vi y hệt trước.

ALTER TABLE warehouse_type_configs
  ADD COLUMN IF NOT EXISTS is_ncc_goods boolean,
  ADD COLUMN IF NOT EXISTS requires_ncc boolean,
  ADD COLUMN IF NOT EXISTS batch_char   text;

ALTER TABLE warehouse_type_configs DROP CONSTRAINT IF EXISTS wtc_batch_char_len;
ALTER TABLE warehouse_type_configs ADD CONSTRAINT wtc_batch_char_len
  CHECK (batch_char IS NULL OR batch_char ~ '^[A-Z0-9]$');

COMMENT ON COLUMN warehouse_type_configs.is_ncc_goods IS 'Riêng kho: QR V1 đoạn 4 = mã NCC. NULL = theo danh mục chung.';
COMMENT ON COLUMN warehouse_type_configs.requires_ncc IS 'Riêng kho: nhập kho bắt buộc có NCC. NULL = theo danh mục chung.';
COMMENT ON COLUMN warehouse_type_configs.batch_char   IS 'Riêng kho: ký tự cố định thế chỗ Máy trong mã lô V2. NULL = theo danh mục chung.';

-- MỌI KHO ĐỀU CÓ MỌI LOẠI — bù các cặp (kho, loại) còn thiếu.
-- Thứ tự cho dòng bù = thứ tự danh mục (kho nào đã sắp riêng thì phần cũ giữ nguyên).
INSERT INTO warehouse_type_configs (id, warehouse_id, type_code, sort_order, updated_at, updated_by)
SELECT gen_random_uuid(), w.id, l.value, l.sort_order, now(), 'migration 20260821c'
  FROM "Warehouse" w
  CROSS JOIN "LookupValue" l
 WHERE l.type = 'warehouse_type'
   AND NOT EXISTS (
     SELECT 1 FROM warehouse_type_configs c
      WHERE c.warehouse_id = w.id AND c.type_code = l.value);

-- Không kho nào được thiếu loại nào sau bước trên
DO $$
DECLARE thieu int;
BEGIN
  SELECT count(*) INTO thieu
    FROM "Warehouse" w CROSS JOIN "LookupValue" l
   WHERE l.type = 'warehouse_type'
     AND NOT EXISTS (SELECT 1 FROM warehouse_type_configs c
                      WHERE c.warehouse_id = w.id AND c.type_code = l.value);
  IF thieu > 0 THEN
    RAISE EXCEPTION 'Còn % cặp (kho, loại) chưa có dòng cấu hình — bù chưa đủ', thieu;
  END IF;
END $$;
