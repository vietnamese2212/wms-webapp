-- ============================================================================
-- 20260923 — Đợt 1 TMS điều vận: DÒNG XE CHA–CON + BẢNG CƯỚC + PHỤ PHÍ + PHÂN TUYẾN ĐVVT
-- (plan docs/plans/TMS_DISPATCH_PLAN.md mục 5.3 · 6.0–6.4; user chốt 23/09/2026)
-- ----------------------------------------------------------------------------
-- (1) `vehicle_model` = DÒNG CON mang mã SAP 9100000xx. CHA = `VehicleType` GIỮ NGUYÊN (7 mã) — kho chỉ
--     quan tâm cha để booking khung giờ / đăng ký cổng / Kế hoạch xuất; điều vận mới dùng con để ghép
--     chuyến và tính cước. `parent_type_id` NULL = chưa gán cha (UI hiện băng, engine bỏ qua dòng đó).
--     Seed 60 dòng theo bảng "Mã hệ thống mới" user gửi 23/09; sức chứa parse từ TÊN (chỉ là điểm xuất
--     phát — sửa được ở Cài đặt TMS → Loại xe).
-- (2) `freight_tariff`: cước theo (kho xuất × ĐVVT × dòng con × phường) — user chốt: mỗi ĐVVT ở mỗi kho
--     khác nhau. Xe pallet: đơn giá × pallet LÀM TRÒN LÊN (tariff_unit của dòng con).
-- (3) `freight_surcharge`: rớt điểm / bốc xếp / chờ / khác — theo (kho × ĐVVT [× dòng con]); rớt điểm
--     tính theo THỰC TẾ chuyến: < min_stops (2) ⇒ 0; ALL_STOPS ⇒ mỗi điểm một khoản · EXTRA_STOPS ⇒ chỉ từ
--     điểm thứ min_stops. Loại phụ phí là LookupValue `freight_surcharge_kind` (mở, không if chuỗi).
-- (4) `carrier_allocation` (ưu tiên ĐVVT theo khu vực) + `carrier_share_target` (tỷ trọng ĐVVT/kỳ):
--     engine chọn ĐVVT = ưu tiên khu vực → ĐVVT còn thiếu tỷ trọng → rẻ nhất.
-- (5) Cột móc nối: `khvc_lines.vehicle_model_id` (chuyến nhớ dòng con đã chọn), `GroupDeliveryOrder`
--     `vehicle_model_id` + `freight_estimated` + `freight_tariff_id` + `freight_detail` (mục 6.3).
-- Mặc định = hành vi cũ: bảng rỗng ⇒ chuyến không có cước, không chặn gì; kho không thấy khác biệt.
-- Áp STAGING trước → test → production. Idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- ============================================================================

BEGIN;

-- ── (1) DÒNG XE CON ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_model (
  id                 uuid PRIMARY KEY,
  sap_code           text NOT NULL UNIQUE,                       -- "Mã hệ thống mới" 9100000xx
  name               text NOT NULL,                              -- "Tên hệ thống mới"
  parent_type_id     uuid REFERENCES public."VehicleType"(id) ON DELETE SET NULL,   -- CHA (NULL = chưa gán)
  temp_mode          text CHECK (temp_mode IN ('HOT','COLD','MIXED','DRY')),        -- nóng/lạnh/kết hợp/khô
  capacity_mode      text NOT NULL DEFAULT 'TON' CHECK (capacity_mode IN ('PALLET','TON')),
  max_pallets        integer CHECK (max_pallets IS NULL OR max_pallets > 0),
  max_tons           numeric CHECK (max_tons IS NULL OR max_tons > 0),
  max_m3             numeric CHECK (max_m3 IS NULL OR max_m3 > 0),
  max_drops          integer CHECK (max_drops IS NULL OR max_drops > 0),
  allow_mix_channels boolean NOT NULL DEFAULT true,
  tariff_unit        text NOT NULL DEFAULT 'PER_TRIP' CHECK (tariff_unit IN ('PER_PALLET','PER_TRIP')),
  underload_pct      integer NOT NULL DEFAULT 70 CHECK (underload_pct BETWEEN 0 AND 100),
  is_active          boolean NOT NULL DEFAULT true,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text,
  updated_by         text
);
CREATE INDEX IF NOT EXISTS idx_vehicle_model_parent ON public.vehicle_model (parent_type_id) WHERE is_active;
ALTER TABLE public.vehicle_model ENABLE ROW LEVEL SECURITY;

-- Seed 60 dòng theo bảng mã SAP user gửi 23/09. Parse từ TÊN: "N Pallet" → PALLET/max_pallets · "N tấn" → max_tons
-- (phẩy = thập phân) · kết hợp → MIXED (xét TRƯỚC lạnh/nóng vì tên có cả hai) · lạnh → COLD · nóng → HOT · khô → DRY.
INSERT INTO public.vehicle_model (id, sap_code, name, temp_mode, capacity_mode, max_pallets, max_tons, tariff_unit, sort_order, created_by, updated_by)
SELECT gen_random_uuid(), v.code, v.name,
  CASE WHEN v.name ~ '[kK]ết hợp' THEN 'MIXED'
       WHEN v.name ~ '[lL]ạnh'    THEN 'COLD'
       WHEN v.name ~ '[nN]óng'    THEN 'HOT'
       WHEN v.name ~ '[kK]hô'     THEN 'DRY' END,
  CASE WHEN v.name ~ '[pP]allet' THEN 'PALLET' ELSE 'TON' END,
  NULLIF(substring(v.name from '(\d+)\s*[pP]allet'), '')::integer,
  NULLIF(replace(substring(v.name from '([0-9]+[.,]?[0-9]*)\s*tấn'), ',', '.'), '')::numeric,
  CASE WHEN v.name ~ '[pP]allet' THEN 'PER_PALLET' ELSE 'PER_TRIP' END,
  v.ord, 'migration 20260923', 'migration 20260923'
FROM (VALUES
  ('910000000', 'Xe tải 1 tấn (nóng)', 0),
  ('910000001', 'Xe tải 1,25 tấn (nóng)', 1),
  ('910000002', 'Xe tải 1,7 tấn (nóng)', 2),
  ('910000003', 'Xe tải 1,9 tấn (nóng)', 3),
  ('910000004', 'Xe tải 2,5 tấn (nóng)', 4),
  ('910000005', 'Xe tải 3,5 tấn (nóng)', 5),
  ('910000006', 'Xe tải 5 tấn (nóng)', 6),
  ('910000007', 'Xe tải 8 tấn (nóng)', 7),
  ('910000008', 'Xe tải 15 tấn (nóng)', 8),
  ('910000009', 'Xe tải 1 tấn (lạnh)', 9),
  ('910000010', 'Xe tải 1,25 tấn (lạnh)', 10),
  ('910000011', 'Xe tải 1,7 tấn (lạnh)', 11),
  ('910000012', 'Xe tải 1,9 tấn (lạnh)', 12),
  ('910000013', 'Xe tải 2,5 tấn (lạnh)', 13),
  ('910000014', 'Xe tải 3,5 tấn (lạnh)', 14),
  ('910000015', 'Xe tải 5 tấn (lạnh)', 15),
  ('910000016', 'Xe tải 8 tấn (lạnh)', 16),
  ('910000017', 'Xe tải 15 tấn (lạnh)', 17),
  ('910000018', 'Bộ cont 40 cao (Khô)', 18),
  ('910000019', 'Bộ cont 40 cao (Lạnh)', 19),
  ('910000020', 'Biển cont 40 cao (Khô)', 20),
  ('910000021', 'Xe tải 17 tấn (nóng)', 21),
  ('910000022', 'Xe kết hợp nóng / lạnh 1,25 tấn', 22),
  ('910000023', 'Xe kết hợp nóng / lạnh 2,5 tấn', 23),
  ('910000024', 'Xe kết hợp nóng / lạnh 3,5 tấn', 24),
  ('910000025', 'Xe kết hợp nóng / lạnh 5 tấn', 25),
  ('910000026', 'Xe kết hợp nóng / lạnh 8 tấn', 26),
  ('910000027', 'Xe kết hợp nóng / lạnh 15 tấn', 27),
  ('910000028', 'Xe tải 10 tấn (lạnh)', 28),
  ('910000029', 'Xe tải 0.5 tấn (lạnh)', 29),
  ('910000030', 'Xe 16 Pallet', 30),
  ('910000031', 'Xe 17 Pallet', 31),
  ('910000032', 'Xe 15 Pallet', 32),
  ('910000033', 'Xe 34 Pallet', 33),
  ('910000034', 'Xe 51 Pallet', 34),
  ('910000035', 'Xe 68 Pallet', 35),
  ('910000036', 'Biển cont 40 cao (Khô)_KĐ', 36),
  ('910000037', 'Xe 4 Pallet', 37),
  ('910000038', 'Xe 6 Pallet', 38),
  ('910000039', 'Xe 25 tấn nóng', 39),
  ('910000040', 'Xe 3 Pallet', 40),
  ('910000041', 'Xe 8 Pallet', 41),
  ('910000042', 'Xe 10 Pallet', 42),
  ('910000043', 'Xe 12 Pallet', 43),
  ('910000044', 'Xe 30 tấn nóng', 44),
  ('910000045', 'Xe 11 Pallet', 45),
  ('910000046', 'Xe 13 Pallet', 46),
  ('910000047', 'Xe 14 Pallet', 47),
  ('910000048', 'Xe 15 Pallet', 48),
  ('910000049', 'Sắt cont 40 cao (Khô)', 49),
  ('910000050', 'Xe tải 1.5 tấn (lạnh)', 50),
  ('910000051', 'Xe tải 1.5 tấn (nóng)', 51),
  ('910000052', 'Xe kết hợp 16 Pallet', 52),
  ('910000053', 'Xe kết hợp 17 Pallet', 53),
  ('910000054', 'Xe 30 Pallet', 54),
  ('910000055', 'Xe 24 Pallet', 55),
  ('910000056', 'Xe 22 Pallet (22 tấn)', 56),
  ('910000057', 'Xe 30 Pallet – Kết hợp', 57),
  ('910000058', 'Xe 24 Pallet – Kết hợp', 58),
  ('910000059', 'Xe 22 Pallet – Kết hợp', 59)
) AS v(code, name, ord)
ON CONFLICT (sap_code) DO NOTHING;

-- ── (2) BẢNG CƯỚC ───────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.freight_tariff (
  id                   uuid PRIMARY KEY,
  from_warehouse_id    text NOT NULL REFERENCES public."Warehouse"(id) ON DELETE RESTRICT,
  transport_company_id uuid NOT NULL REFERENCES public."TransportCompany"(id) ON DELETE RESTRICT,
  vehicle_model_id     uuid NOT NULL REFERENCES public.vehicle_model(id) ON DELETE RESTRICT,
  ward_code            text NOT NULL,                              -- "Phường/Xã (Mới)" = Customer.ward_code = KHOÁ CƯỚC
  price                numeric NOT NULL CHECK (price >= 0),        -- VND; PER_PALLET = đơn giá/pallet, PER_TRIP = trọn chuyến
  distance_km          numeric CHECK (distance_km IS NULL OR distance_km >= 0),
  province_old         text, district_old text, province_new text, ward_raw text,   -- địa danh nguyên văn file
  effective_from       date NOT NULL DEFAULT CURRENT_DATE,
  effective_to         date CHECK (effective_to IS NULL OR effective_to >= effective_from),
  is_active            boolean NOT NULL DEFAULT true,
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text,
  updated_by           text,
  UNIQUE (from_warehouse_id, transport_company_id, vehicle_model_id, ward_code, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_freight_tariff_lookup ON public.freight_tariff (from_warehouse_id, ward_code, transport_company_id) WHERE is_active;
ALTER TABLE public.freight_tariff ENABLE ROW LEVEL SECURITY;

-- ── (3) PHỤ PHÍ ─────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public."LookupValue" (id, type, value, sort_order, meta, created_at, updated_at)
SELECT gen_random_uuid(), 'freight_surcharge_kind', v.value, v.ord, v.meta::jsonb, now(), now()
FROM (VALUES
  ('DROP_POINT', 1, '{"label":"Rớt điểm","default_per":"PER_STOP"}'),
  ('LOADING',    2, '{"label":"Bốc xếp","default_per":"PER_TRIP"}'),
  ('WAITING',    3, '{"label":"Chờ / lưu xe","default_per":"PER_TRIP"}'),
  ('OTHER',      9, '{"label":"Khác","default_per":"PER_TRIP"}')
) AS v(value, ord, meta)
ON CONFLICT (type, value) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.freight_surcharge (
  id                   uuid PRIMARY KEY,
  from_warehouse_id    text NOT NULL REFERENCES public."Warehouse"(id) ON DELETE RESTRICT,
  transport_company_id uuid NOT NULL REFERENCES public."TransportCompany"(id) ON DELETE RESTRICT,
  vehicle_model_id     uuid REFERENCES public.vehicle_model(id) ON DELETE RESTRICT,   -- NULL = mọi dòng con
  kind                 text NOT NULL,                                                 -- LookupValue freight_surcharge_kind
  amount               numeric NOT NULL CHECK (amount >= 0),
  per                  text NOT NULL DEFAULT 'PER_TRIP' CHECK (per IN ('PER_STOP','PER_TRIP','PER_PALLET','PER_TON')),
  count_mode           text NOT NULL DEFAULT 'ALL_STOPS' CHECK (count_mode IN ('ALL_STOPS','EXTRA_STOPS')),  -- chỉ nghĩa với PER_STOP
  min_stops            integer NOT NULL DEFAULT 2 CHECK (min_stops >= 1),           -- dưới ngưỡng này = 0 (giao 1 điểm không rớt)
  effective_from       date NOT NULL DEFAULT CURRENT_DATE,
  effective_to         date CHECK (effective_to IS NULL OR effective_to >= effective_from),
  is_active            boolean NOT NULL DEFAULT true,
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text,
  updated_by           text
);
-- unique với vehicle_model_id NULL: dùng index biểu thức (coalesce) — UNIQUE thường coi NULL khác nhau
CREATE UNIQUE INDEX IF NOT EXISTS uq_freight_surcharge_key
  ON public.freight_surcharge (from_warehouse_id, transport_company_id, coalesce(vehicle_model_id::text, ''), kind, effective_from);
ALTER TABLE public.freight_surcharge ENABLE ROW LEVEL SECURITY;

-- ── (4) PHÂN TUYẾN ĐVVT ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.carrier_allocation (
  id                   uuid PRIMARY KEY,
  from_warehouse_id    text NOT NULL REFERENCES public."Warehouse"(id) ON DELETE RESTRICT,
  area_kind            text NOT NULL CHECK (area_kind IN ('WARD','REGION')),   -- WARD = Customer.ward_code · REGION = Customer.region_code
  area_code            text NOT NULL,
  transport_company_id uuid NOT NULL REFERENCES public."TransportCompany"(id) ON DELETE RESTRICT,
  priority             integer NOT NULL DEFAULT 1 CHECK (priority >= 1),      -- 1 = ưu tiên nhất; nhiều ĐVVT = thứ tự dự phòng
  effective_from       date NOT NULL DEFAULT CURRENT_DATE,
  effective_to         date CHECK (effective_to IS NULL OR effective_to >= effective_from),
  is_active            boolean NOT NULL DEFAULT true,
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text,
  updated_by           text,
  UNIQUE (from_warehouse_id, area_kind, area_code, transport_company_id, effective_from)
);
ALTER TABLE public.carrier_allocation ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.carrier_share_target (
  id                   uuid PRIMARY KEY,
  from_warehouse_id    text NOT NULL REFERENCES public."Warehouse"(id) ON DELETE RESTRICT,
  transport_company_id uuid NOT NULL REFERENCES public."TransportCompany"(id) ON DELETE RESTRICT,
  share_pct            numeric NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
  basis                text NOT NULL DEFAULT 'TRIPS' CHECK (basis IN ('TRIPS','PALLETS','TONS')),
  period               text NOT NULL DEFAULT 'MONTH' CHECK (period IN ('MONTH')),
  effective_from       date NOT NULL DEFAULT CURRENT_DATE,
  effective_to         date CHECK (effective_to IS NULL OR effective_to >= effective_from),
  is_active            boolean NOT NULL DEFAULT true,
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text,
  updated_by           text,
  UNIQUE (from_warehouse_id, transport_company_id, effective_from)
);
ALTER TABLE public.carrier_share_target ENABLE ROW LEVEL SECURITY;

-- ── (5) Cột móc nối lên kế hoạch / chuyến ───────────────────────────────────────────────────────────
ALTER TABLE public.khvc_lines ADD COLUMN IF NOT EXISTS vehicle_model_id uuid REFERENCES public.vehicle_model(id) ON DELETE SET NULL;
ALTER TABLE public."GroupDeliveryOrder"
  ADD COLUMN IF NOT EXISTS vehicle_model_id  uuid REFERENCES public.vehicle_model(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS freight_estimated numeric,          -- VND, null = chưa tính được (lý do trong freight_detail)
  ADD COLUMN IF NOT EXISTS freight_tariff_id uuid REFERENCES public.freight_tariff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS freight_detail    jsonb;            -- {unit, billed_pallets, base, surcharges:[…], reason}

-- ── Kiểm sau áp ─────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n int; bad text;
BEGIN
  SELECT count(*) INTO n FROM public.vehicle_model;
  IF n < 60 THEN RAISE EXCEPTION 'vehicle_model seed thiếu: % dòng', n; END IF;
  SELECT count(*) INTO n FROM public.vehicle_model WHERE capacity_mode = 'PALLET' AND max_pallets IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% dòng PALLET không parse được số pallet', n; END IF;
  SELECT string_agg(sap_code, ',') INTO bad FROM public.vehicle_model WHERE sap_code IN ('910000005','910000030','910000022')
    AND NOT ((sap_code = '910000005' AND max_tons = 3.5 AND temp_mode = 'HOT')
          OR (sap_code = '910000030' AND max_pallets = 16 AND tariff_unit = 'PER_PALLET')
          OR (sap_code = '910000022' AND max_tons = 1.25 AND temp_mode = 'MIXED'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'parse tên dòng xe sai ở: %', bad; END IF;
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN ('vehicle_model','freight_tariff','freight_surcharge','carrier_allocation','carrier_share_target')
     AND NOT c.relrowsecurity;
  IF n > 0 THEN RAISE EXCEPTION 'RLS chưa bật trên % bảng mới', n; END IF;
  SELECT count(*) INTO n FROM public."LookupValue" WHERE type = 'freight_surcharge_kind';
  IF n < 4 THEN RAISE EXCEPTION 'freight_surcharge_kind seed thiếu'; END IF;
END $$;

COMMIT;

-- KIỂM SAU KHI CHẠY
--   SELECT sap_code, name, temp_mode, capacity_mode, max_pallets, max_tons, tariff_unit FROM vehicle_model ORDER BY sort_order;
--   SELECT * FROM rls_gap_tables();   -- rỗng
