-- ============================================================
-- Fix: Thêm các bảng TMS vào supabase_realtime publication
--      + Enable RLS + anon SELECT policy (cần cho Supabase Realtime)
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  -- 1. Thêm bảng TMS vào supabase_realtime publication (skip nếu đã có)
  FOREACH tbl IN ARRAY ARRAY[
    'VehicleType', 'SlotTemplate', 'DeliverySlot',
    'TransportCompany', 'Vehicle', 'DeliveryBooking'
  ]
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', tbl);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END LOOP;

  -- 2. Enable RLS (idempotent — bật lại cũng không lỗi)
  FOREACH tbl IN ARRAY ARRAY[
    'VehicleType', 'SlotTemplate', 'DeliverySlot',
    'TransportCompany', 'Vehicle', 'DeliveryBooking'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;

  -- 3. Tạo anon SELECT policy (skip nếu đã có)
  FOREACH tbl IN ARRAY ARRAY[
    'VehicleType', 'SlotTemplate', 'DeliverySlot',
    'TransportCompany', 'Vehicle', 'DeliveryBooking'
  ]
  LOOP
    BEGIN
      EXECUTE format(
        'CREATE POLICY anon_select ON %I FOR SELECT TO anon USING (true)',
        tbl
      );
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END LOOP;
END $$;

-- Backend dùng service_role → bypass RLS → không bị ảnh hưởng
-- Không có INSERT/UPDATE/DELETE policy cho anon → mọi ghi đều qua Express backend
