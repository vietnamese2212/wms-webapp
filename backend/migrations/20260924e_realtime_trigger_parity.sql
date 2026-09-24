-- ============================================================================
-- 20260924e — REALTIME: gắn lại trigger còn thiếu + dựng EVENT TRIGGER trên production
--
-- VÌ SAO (phát hiện trong cutover 24/09, so schema production ↔ staging):
--   Production có 63/75 bảng mang `trg_wms_notify`, thiếu đúng 12 bảng nghiệp vụ MỚI
--   (Customer · carrier_allocation · carrier_share_target · date_rule_master ·
--    dispatch_plan · dispatch_trip · erp_so_lines · freight_surcharge · freight_tariff ·
--    vehicle_model · warehouse_maps · wms_tasks) — cả 12 đều khai trong `TABLE_QUERY_MAP`
--   nên thiếu trigger = REALTIME CÂM: Điều vận, Cước, Khách hàng, Quy định date,
--   Sơ đồ kho, Việc cần làm không tự cập nhật, người dùng phải tải lại trang.
--
--   GỐC RỄ không phải 12 trigger lẻ mà là: production CHƯA BAO GIỜ có event trigger
--   `auto_realtime_new_tables` (migration `20260508_enable_realtime.sql` chưa từng lên
--   production). Trên staging, event trigger đó tự gắn `trg_wms_notify` cho MỌI bảng mới
--   lúc CREATE TABLE — nên staging đủ mà production thiếu, và sẽ còn thiếu tiếp với
--   mọi bảng tạo về sau. Vá 12 trigger mà không dựng event trigger là vá triệu chứng.
--
-- BÀI HỌC (lặp lần thứ HAI — cutover 15/08 đã dính đúng lớp này, sổ tay thiếu 27 file):
--   Đừng tin danh sách migration. Nguồn sự thật là SO SCHEMA HAI BÊN.
--   Nay có `scripts/qa/62-prod-parity.mjs` để không phải nhớ nữa.
--
-- An toàn: idempotent (bỏ qua bảng đã có trigger) — chạy được trên CẢ staging lẫn production.
-- ============================================================================

-- 1. EVENT TRIGGER — bảng MỚI tự nhận trigger (gốc rễ). Hàm `_auto_add_table_to_realtime`
--    đã có sẵn từ 20260902b ở cả hai môi trường.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'auto_realtime_new_tables') THEN
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = '_auto_add_table_to_realtime') THEN
      CREATE EVENT TRIGGER auto_realtime_new_tables
        ON ddl_command_end WHEN TAG IN ('CREATE TABLE')
        EXECUTE FUNCTION public._auto_add_table_to_realtime();
      RAISE NOTICE 'đã dựng event trigger auto_realtime_new_tables';
    ELSE
      RAISE EXCEPTION 'thiếu hàm public._auto_add_table_to_realtime — apply 20260902b trước';
    END IF;
  END IF;
END $$;

-- 2. Gắn `trg_wms_notify` cho bảng nghiệp vụ còn thiếu (mức STATEMENT, đúng như staging:
--    upload 500 dòng = 1 tín hiệu, không phải 500).
DO $$
DECLARE
  t text;
  want text[] := ARRAY[
    'Customer', 'carrier_allocation', 'carrier_share_target', 'date_rule_master',
    'dispatch_plan', 'dispatch_trip', 'dispatch_trip_od', 'erp_so_lines',
    'freight_surcharge', 'freight_tariff', 'vehicle_model', 'warehouse_maps', 'wms_tasks'
  ];
  n int := 0;
BEGIN
  FOREACH t IN ARRAY want LOOP
    -- bảng chưa tồn tại ở môi trường này thì bỏ qua, không làm hỏng migration
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t AND c.relkind = 'r');
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t AND tg.tgname = 'trg_wms_notify');
    EXECUTE format(
      'CREATE TRIGGER trg_wms_notify AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION public.wms_notify_change()', t);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'gắn thêm % trigger realtime', n;
END $$;

-- 3. GÁC — mọi bảng trong danh sách mà ĐANG TỒN TẠI đều phải có trigger.
DO $$
DECLARE cam text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO cam
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind = 'r'
    AND c.relname = ANY (ARRAY['Customer','carrier_allocation','carrier_share_target','date_rule_master',
        'dispatch_plan','dispatch_trip','dispatch_trip_od','erp_so_lines','freight_surcharge',
        'freight_tariff','vehicle_model','warehouse_maps','wms_tasks'])
    AND NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = c.oid AND tg.tgname = 'trg_wms_notify');
  IF cam IS NOT NULL THEN
    RAISE EXCEPTION 'còn bảng realtime CÂM (thiếu trg_wms_notify): %', cam;
  END IF;
END $$;

-- 4. GÁC BẢO MẬT — publication phải RỖNG (luật 20260902d). Event trigger vừa dựng có
--    `ALTER PUBLICATION ... ADD TABLE`, nên bảng tạo VỀ SAU sẽ tự vào publication;
--    còn bảng trong publication thì CẢ ANON subscribe `postgres_changes` vẫn biết
--    "bảng X vừa đổi". Gói QA 00 mục 10c gác tiếp; ở đây chặn ngay lúc apply.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_publication_rel r
    JOIN pg_publication p ON p.oid = r.prpubid WHERE p.pubname = 'supabase_realtime';
  IF n > 0 THEN
    RAISE EXCEPTION 'publication supabase_realtime còn % bảng — phải RỖNG (xem 20260902d)', n;
  END IF;
END $$;
