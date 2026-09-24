-- ĐỢT 2 TMS ĐIỀU VẬN — kế hoạch ghép chuyến NHÁP (plan docs/plans/TMS_DISPATCH_PLAN.md mục 7, user chốt 24/09/2026 "làm tiếp module 2").
-- Máy đề xuất → người sửa → Xác nhận = ghi khvc_lines như upload Kế hoạch xuất tay; bảng ở đây chỉ giữ BẢN NHÁP + vết đề xuất.
--
-- (1) Tham số điều vận CẤP KHO (bảng công tắc mục 9; CHỈ theo kho, không theo Loại kho — ghép chuyến là việc của cả kho,
--     một chuyến chở lẫn loại): số điểm giao tối đa · cho trộn kênh khách · ngưỡng Non tải kho (NULL = theo dòng xe).
-- (2) dispatch_plan (kho × ngày, DRAFT/CONFIRMED/DISCARDED — MỘT bản nháp mỗi kho×ngày) · dispatch_trip (chuyến nháp,
--     vết chọn ĐVVT/dòng xe/cước) · dispatch_trip_od (OD hoặc PHẦN OD trong chuyến).
--     `booking_category` + `categories` nằm trong `detail` jsonb, KHÔNG làm cột text riêng: cột text mang mã Loại kho phải
--     vào cascade rename_warehouse_type (bất biến gói 00 độ phủ) — bản nháp sống vài giờ, không đáng một nhánh cascade.
-- Realtime: event trigger tự gắn trg_wms_notify lúc CREATE TABLE; RLS bật (bất biến "mọi bảng public bật RLS").

ALTER TABLE public."Warehouse"
  ADD COLUMN IF NOT EXISTS dispatch_max_drops          integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS dispatch_allow_mix_channels boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dispatch_underload_pct      numeric(5,1);
ALTER TABLE public."Warehouse" DROP CONSTRAINT IF EXISTS warehouse_dispatch_max_drops_chk;
ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_dispatch_max_drops_chk CHECK (dispatch_max_drops BETWEEN 1 AND 20);
ALTER TABLE public."Warehouse" DROP CONSTRAINT IF EXISTS warehouse_dispatch_underload_chk;
ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_dispatch_underload_chk CHECK (dispatch_underload_pct IS NULL OR (dispatch_underload_pct > 0 AND dispatch_underload_pct <= 100));

CREATE TABLE IF NOT EXISTS public.dispatch_plan (
  id            uuid PRIMARY KEY,
  warehouse_id  text NOT NULL REFERENCES public."Warehouse"(id),   -- Warehouse.id là TEXT (48/82 bảng khoá text)
  plan_date     date NOT NULL,
  status        text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'DISCARDED')),
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,     -- tham số lúc chạy (max_drops · mix · underload · start_seq · nguồn pool)
  summary       jsonb NOT NULL DEFAULT '{}'::jsonb,     -- số chuyến · OD · pallet · tấn · Σ cước · Non tải · tỷ trọng ĐVVT
  unplanned     jsonb NOT NULL DEFAULT '[]'::jsonb,     -- OD không xếp được + lý do
  engine_version text,
  created_by    text,
  confirmed_by  text,
  confirmed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispatch_plan_draft ON public.dispatch_plan (warehouse_id, plan_date) WHERE status = 'DRAFT';
CREATE INDEX IF NOT EXISTS idx_dispatch_plan_wh_date ON public.dispatch_plan (warehouse_id, plan_date DESC);
ALTER TABLE public.dispatch_plan ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.dispatch_trip (
  id                   uuid PRIMARY KEY,
  plan_id              uuid NOT NULL REFERENCES public.dispatch_plan(id) ON DELETE CASCADE,
  seq                  integer NOT NULL,
  group_code           text NOT NULL,                    -- Số xe dự kiến <MãKho>_X_<ddmmyy>_<stt>
  vehicle_model_id     uuid REFERENCES public.vehicle_model(id),
  transport_company_id uuid REFERENCES public."TransportCompany"(id),
  stops                integer NOT NULL DEFAULT 1,
  wards                text[] NOT NULL DEFAULT '{}',
  pallets              numeric,
  tons                 numeric,
  load_pct             numeric,
  underload            boolean NOT NULL DEFAULT false,
  oversize             boolean NOT NULL DEFAULT false,
  freight_estimated    numeric,
  detail               jsonb NOT NULL DEFAULT '{}'::jsonb,   -- freight · load · categories · booking_category · cluster · carrier_reasons · warnings · merge_hint
  manual_edited        boolean NOT NULL DEFAULT false,       -- người đã đổi dòng xe / ĐVVT / chuyển OD — chạy lại engine KHÔNG đè
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dispatch_trip_plan ON public.dispatch_trip (plan_id, seq);
ALTER TABLE public.dispatch_trip ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.dispatch_trip_od (
  id             uuid PRIMARY KEY,
  trip_id        uuid NOT NULL REFERENCES public.dispatch_trip(id) ON DELETE CASCADE,
  od_number      text NOT NULL,
  ship_to_code   text,
  ship_to_name   text,
  ward_code      text,
  pallets        numeric,
  tons           numeric,
  lines          integer NOT NULL DEFAULT 0,
  part_index     integer,                                -- OD tách theo dòng hàng nguyên: phần i / of
  part_of        integer,
  material_codes text[] NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dispatch_trip_od_trip ON public.dispatch_trip_od (trip_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_trip_od_od   ON public.dispatch_trip_od (od_number);
ALTER TABLE public.dispatch_trip_od ENABLE ROW LEVEL SECURITY;

-- Bảng nháp nội bộ: KHÔNG bắn tín hiệu realtime từng dòng (một lượt ghép ghi hàng trăm dòng con); FE tải lại theo plan.
DROP TRIGGER IF EXISTS trg_wms_notify ON public.dispatch_trip_od;

DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN ('dispatch_plan', 'dispatch_trip', 'dispatch_trip_od') AND NOT c.relrowsecurity;
  IF bad > 0 THEN RAISE EXCEPTION 'RLS chưa bật trên % bảng dispatch', bad; END IF;
END $$;
