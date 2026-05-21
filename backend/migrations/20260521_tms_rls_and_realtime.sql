-- ============================================================
-- Fix: Thêm các bảng TMS vào supabase_realtime publication
--      + Enable RLS + anon SELECT policy (cần cho Supabase Realtime)
-- ============================================================
-- Bối cảnh:
--   - 20260508_enable_realtime.sql chạy TRƯỚC khi tạo bảng TMS
--     → các bảng TMS KHÔNG có trong publication ban đầu
--   - Auto-trigger dùng %I với obj.object_identity (dạng "public.DeliverySlot")
--     → format sai → fail silently → bảng mới không được thêm
--   - Anon key cần SELECT để nhận realtime events
-- ============================================================

-- 1. Thêm bảng TMS vào supabase_realtime publication
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'VehicleType', 'SlotTemplate', 'DeliverySlot',
    'TransportCompany', 'Vehicle', 'DeliveryBooking'
  ]
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', tbl);
    EXCEPTION WHEN others THEN
      NULL; -- already in publication, skip
    END;
  END LOOP;
END $$;

-- 2. Enable RLS trên các bảng TMS mới
ALTER TABLE "VehicleType"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SlotTemplate"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliverySlot"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TransportCompany" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vehicle"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryBooking"  ENABLE ROW LEVEL SECURITY;

-- 3. Anon SELECT policy (cần cho Supabase Realtime với anon key)
CREATE POLICY "anon_select" ON "VehicleType"      FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "SlotTemplate"     FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "DeliverySlot"     FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "TransportCompany" FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "Vehicle"          FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "DeliveryBooking"  FOR SELECT TO anon USING (true);

-- Backend dùng service_role → bypass RLS → không bị ảnh hưởng
-- Không có INSERT/UPDATE/DELETE policy cho anon → mọi ghi đều qua Express backend
