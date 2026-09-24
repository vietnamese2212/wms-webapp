-- 20260821h — DỌN LỆCH KIỂU: InventoryEntry.warehouse_id / PalletOperation.warehouse_id
--             uuid → text, cho khớp Warehouse.id (text) rồi đặt FK.
--
-- VÌ SAO (phát hiện 21/08 khi soi hiệu năng Dashboard):
--   `Warehouse.id` là **text** và 21 bảng khác đã trỏ FK vào nó (Location, ProductionImport,
--   GroupDeliveryOrder, FillTask, TmsOrder, Attendance…). ĐÚNG 2 bảng lạc kiểu: InventoryEntry và
--   PalletOperation khai **uuid**. Hậu quả đo được:
--     · KHÔNG đặt được FK ⇒ không có gì chặn warehouse_id trỏ vào kho không tồn tại.
--     · Mọi câu SQL nối 2 bảng buộc phải cast: `dashboard_stats` có 3 chỗ
--       `join "Warehouse" w on w.id = ie.warehouse_id::text` — cast trên CỘT làm index trên
--       warehouse_id không phục vụ được phép nối.
--     · Viết RPC mới theo phản xạ tự nhiên (`w.id = ie.warehouse_id`) là **42883 lúc chạy**, không
--       phải lúc biên dịch — đúng lớp lỗi "chỉ nổ khi có người dùng tới".
--
-- AN TOÀN — đã kiểm trước khi viết migration này:
--   · 0 dòng orphan ở CẢ HAI bảng (warehouse_id không khớp Warehouse nào) ⇒ FK gắn được ngay.
--   · KHÔNG view nào phụ thuộc cột; KHÔNG hàm nào dùng `::uuid` trên cột (nên đổi kiểu không vỡ RPC).
--   · Các chỗ đang cast `::text` vẫn chạy nguyên (text::text là no-op).
--   · 5 index chứa cột (idx_ie_facet_wh_status, idx_ie_wh_importdate, idx_ie_wh_mat_rem,
--     idx_inventory_putaway_violation, uq_inventory_active_wh_pallet) + idx_pallet_op_wh_created
--     được Postgres TỰ dựng lại trong ALTER — kiểm lại ở cuối file.
--
-- ⚠️ CHÚ Ý KHI APPLY PRODUCTION: `ALTER COLUMN … TYPE` GHI LẠI TOÀN BẢNG và giữ ACCESS EXCLUSIVE
--    (khoá đọc lẫn ghi) tới khi xong. InventoryEntry ở staging 55.779 dòng / 65MB chạy vài giây;
--    production lớn hơn thì phải APPLY TRONG CỬA SỔ NGHỈ, đừng chạy giữa giờ kho đang quét.
--    Không có bước đổi Ý NGHĨA dữ liệu nên không cần backup bảng (giá trị y nguyên, chỉ đổi kiểu).

BEGIN;

ALTER TABLE public."InventoryEntry"
  ALTER COLUMN warehouse_id TYPE text USING warehouse_id::text;

ALTER TABLE public."PalletOperation"
  ALTER COLUMN warehouse_id TYPE text USING warehouse_id::text;

-- FK theo ĐÚNG khuôn của bảng cùng họ (Location_warehouse_id_fkey): xoá kho vẫn còn tồn/lượt
-- dồn-tách là RESTRICT — chứng từ tồn kho không được thành mồ côi.
ALTER TABLE public."InventoryEntry"
  ADD CONSTRAINT "InventoryEntry_warehouse_id_fkey"
  FOREIGN KEY (warehouse_id) REFERENCES public."Warehouse"(id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public."PalletOperation"
  ADD CONSTRAINT "PalletOperation_warehouse_id_fkey"
  FOREIGN KEY (warehouse_id) REFERENCES public."Warehouse"(id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

COMMIT;

-- PostgREST giữ schema trong cache → phải nạp lại, không thì filter theo cột vừa đổi kiểu
-- có thể còn dùng bản cũ.
NOTIFY pgrst, 'reload schema';

-- Kiểm sau khi apply:
--   SELECT table_name, data_type FROM information_schema.columns
--    WHERE table_schema='public' AND column_name='warehouse_id'
--      AND table_name IN ('InventoryEntry','PalletOperation','Warehouse');   -- phải text
--   SELECT conname FROM pg_constraint WHERE conname LIKE '%warehouse_id_fkey'
--     AND conrelid IN ('public."InventoryEntry"'::regclass,'public."PalletOperation"'::regclass);
--   SELECT indexname FROM pg_indexes WHERE tablename='InventoryEntry'
--     AND indexdef ILIKE '%warehouse_id%';                                   -- phải còn ĐỦ 5
--   SELECT count(*) FROM "InventoryEntry" WHERE warehouse_id IS NOT NULL;    -- không đổi
