-- REALTIME cho Chấm sao chuyến + Chi phí kho (user chốt 31/08 "2 mục này cần realtime thôi")
--
-- Hiện trạng đo staging: cả 3 bảng ĐÃ nằm trong publication supabase_realtime, nhưng
-- warehouse_costs + warehouse_cost_locks THIẾU policy SELECT → client không bao giờ nhận
-- được sự kiện (RLS bật + 0 policy đọc = realtime chết CÂM — bài học 06/08, memory
-- realtime-rls-silent-death). receipt_ratings đã có policy đọc từ 20260828c.
--
-- Khuôn policy theo đúng các bảng realtime đang chạy (InventoryEntry, GroupDeliveryOrder…):
-- FOR SELECT TO authenticated USING (true) — anon vẫn đóng (audit 12/07).
-- Idempotent: chạy lại không lỗi.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'warehouse_costs' AND cmd = 'SELECT') THEN
    EXECUTE 'CREATE POLICY warehouse_costs_read ON public.warehouse_costs FOR SELECT TO authenticated USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'warehouse_cost_locks' AND cmd = 'SELECT') THEN
    EXECUTE 'CREATE POLICY warehouse_cost_locks_read ON public.warehouse_cost_locks FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;
