-- FIX realtime trang Phiếu cân (user 16/07: "dữ liệu chưa realtime, phải refresh").
-- Nguyên nhân: FE nhận Realtime qua JWT role=authenticated (setRealtimeAuth); đợt khóa RLS
-- 20260712_security_rls_lockdown tạo policy rls_auth_select cho các bảng CÓ LÚC ĐÓ —
-- WeighTicket sinh sau, bật RLS nhưng THIẾU policy → Realtime không phát event cho client.
-- Bài học: bảng mới sau lockdown phải kèm policy này (đã ghi vào skill mutation-realtime).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'WeighTicket' AND policyname = 'rls_auth_select'
  ) THEN
    CREATE POLICY rls_auth_select ON public."WeighTicket" FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
