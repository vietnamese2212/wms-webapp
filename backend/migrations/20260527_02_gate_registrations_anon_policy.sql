-- Thêm anon SELECT policy để Supabase Realtime hoạt động cho gate_registrations
-- Frontend dùng anon client — cần policy SELECT để nhận postgres_changes events
DO $$ BEGIN
  CREATE POLICY anon_select ON gate_registrations FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
