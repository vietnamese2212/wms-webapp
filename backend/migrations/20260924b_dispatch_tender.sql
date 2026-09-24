-- ĐỢT 2b TMS ĐIỀU VẬN — công tắc "ĐVVT cần phản hồi khi chào chuyến" + VÒNG ĐỜI chuyến nháp (user chốt 24/09/2026:
-- "config: vận tải cần phản hồi hoặc không cần phản hồi — không phản hồi nghĩa là muốn đổi thì điều vận tự manual đổi";
-- đề xuất benchmark docs/plans/TMS_BENCHMARK_PROPOSAL_2026-09-24.md mục A3 — SAP TM/Manhattan: kế hoạch có trạng thái,
-- tender rồi carrier accept, không phải bấm một lần rồi ghi thẳng).
--
-- (1) TransportCompany.tender_required (mặc định FALSE = hành vi cũ): Xác nhận kế hoạch ⇒ xe của ĐVVT này ghi THẲNG vào
--     Kế hoạch xuất; muốn đổi ĐVVT sau đó thì điều vận sửa tay ở tab Kế hoạch xuất. TRUE ⇒ xe đứng ở TENDERED chờ ĐVVT
--     nhận/từ chối (đợt A: điều vận ghi lại câu trả lời qua điện thoại/Zalo; đợt B: ĐVVT tự trả lời trên link chào chuyến).
-- (2) dispatch_trip.status: DRAFT → TENDERED → CONFIRMED (đã vào Kế hoạch xuất) | DECLINED (ĐVVT từ chối — sửa ĐVVT rồi
--     chốt lại) | DISCARDED (bỏ). Vết phản hồi: tendered_at · responded_at · response_by · response_note.
-- (3) dispatch_plan.status thêm TENDERED = đã bấm Xác nhận, còn xe chờ ĐVVT. MỘT kế hoạch ĐANG MỞ (DRAFT/TENDERED) mỗi kho×ngày.

ALTER TABLE public."TransportCompany" ADD COLUMN IF NOT EXISTS tender_required boolean NOT NULL DEFAULT false;

ALTER TABLE public.dispatch_trip
  ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS tendered_at   timestamptz,
  ADD COLUMN IF NOT EXISTS responded_at  timestamptz,
  ADD COLUMN IF NOT EXISTS response_by   text,
  ADD COLUMN IF NOT EXISTS response_note text,
  ADD COLUMN IF NOT EXISTS confirmed_at  timestamptz;
ALTER TABLE public.dispatch_trip DROP CONSTRAINT IF EXISTS dispatch_trip_status_chk;
ALTER TABLE public.dispatch_trip ADD CONSTRAINT dispatch_trip_status_chk CHECK (status IN ('DRAFT', 'TENDERED', 'DECLINED', 'CONFIRMED', 'DISCARDED'));
CREATE INDEX IF NOT EXISTS idx_dispatch_trip_tendered ON public.dispatch_trip (plan_id) WHERE status = 'TENDERED';

ALTER TABLE public.dispatch_plan DROP CONSTRAINT IF EXISTS dispatch_plan_status_check;
ALTER TABLE public.dispatch_plan ADD CONSTRAINT dispatch_plan_status_check CHECK (status IN ('DRAFT', 'TENDERED', 'CONFIRMED', 'DISCARDED'));
DROP INDEX IF EXISTS public.uq_dispatch_plan_draft;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispatch_plan_open ON public.dispatch_plan (warehouse_id, plan_date) WHERE status IN ('DRAFT', 'TENDERED');

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'TransportCompany' AND column_name = 'tender_required';
  IF n <> 1 THEN RAISE EXCEPTION 'thiếu TransportCompany.tender_required'; END IF;
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dispatch_trip' AND column_name IN ('status', 'tendered_at', 'responded_at', 'response_by', 'response_note', 'confirmed_at');
  IF n <> 6 THEN RAISE EXCEPTION 'dispatch_trip thiếu cột vòng đời (% / 6)', n; END IF;
END $$;
