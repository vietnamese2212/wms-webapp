-- 26/11/2026 — ProductionImport.planned_cartons: integer → numeric (C140)
-- Cột lưu SỐ KẾ HOẠCH theo ĐƠN VỊ GỐC (luật base unit). Mã tính KG / L (không có thùng) được phép số lẻ — mọi cửa đã cho
-- (qtyIntegerError chỉ ép số nguyên khi mã CÓ thùng; upload "Nhập nhiều mã" làm tròn 3 chữ số), nhưng cột là integer ⇒ 12,5 KG
-- bị Postgres từ chối (22P02) ⇒ cửa trả 500 "Lỗi server". Nghiệm thu dán Excel 26/11 bắt được (tạo nhóm 20,5 KG ⇒ 500).
-- Không view nào phụ thuộc cột; 3 hàm đọc cột (warehouse_kpi, inbound_return_create, inbound_return_report) trả jsonb / text.
BEGIN;

ALTER TABLE "ProductionImport" ALTER COLUMN planned_cartons TYPE numeric USING planned_cartons::numeric;

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ProductionImport' AND column_name = 'planned_cartons') <> 'numeric' THEN
    RAISE EXCEPTION 'planned_cartons chưa thành numeric';
  END IF;
END $$;

COMMIT;
