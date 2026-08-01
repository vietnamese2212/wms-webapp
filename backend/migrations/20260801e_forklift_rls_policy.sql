-- FIX realtime module Xe nâng (check-app 01/08): 3 bảng forklift_* bật RLS (20260731b) nhưng
-- KHÔNG có policy rls_auth_select → role authenticated không SELECT được → Supabase Realtime
-- không phát event → TABLE_QUERY_MAP vô tác dụng, board 2 người cùng check không thấy nhau.
-- Đúng bài học 20260716_weigh_ticket_rls_policy: bảng mới sau lockdown PHẢI kèm policy này.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['forklift_vehicles','forklift_checklist_items','forklift_daily_logs'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'rls_auth_select'
    ) THEN
      EXECUTE format('CREATE POLICY rls_auth_select ON public.%I FOR SELECT TO authenticated USING (true)', t);
    END IF;
  END LOOP;
END $$;
