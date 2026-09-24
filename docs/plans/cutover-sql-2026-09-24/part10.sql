-- ============================================================================
-- CUTOVER production 24/09/2026 — PART 10/10
-- 7 migration · 20260923_vehicle_model_freight.sql → 20260924d_dispatch_freight_perms.sql
-- Dán TRỌN file vào Supabase SQL Editor của project PRODUCTION svicyfquresxaigfxsdb rồi Run.
-- Cả part nằm trong MỘT transaction: lỗi bất kỳ đâu = rollback trọn part, schema không dở dang.
-- Chạy lại lần hai sẽ báo "đã tồn tại" rồi tự rollback — không hỏng gì.
-- ============================================================================
BEGIN;


-- ─────────────────────────────────────────────────────────────────────────
-- [20260923_vehicle_model_freight.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
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

-- [cutover] gỡ: BEGIN;

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

-- [cutover] gỡ: COMMIT;

-- KIỂM SAU KHI CHẠY
--   SELECT sap_code, name, temp_mode, capacity_mode, max_pallets, max_tons, tariff_unit FROM vehicle_model ORDER BY sort_order;
--   SELECT * FROM rls_gap_tables();   -- rỗng



-- ─────────────────────────────────────────────────────────────────────────
-- [20260923b_vehicle_model_parent_suggest.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260923b — GÁN CHA TỰ ĐỘNG cho 60 dòng xe con (user 23/09: "Rồi tự gán đi, sai tôi vào sửa")
-- ----------------------------------------------------------------------------
-- Luật suy từ TÊN + sức chứa đã parse (chỉ dòng CHƯA gán cha — không đè lựa chọn người đã sửa):
--   • tên có "cont" + "Lạnh"            → CONTSCA (container lạnh)
--   • tên có "cont"                     → CONT     (CONTXK = cont xuất khẩu — không suy được từ tên, user gán tay nếu cần)
--   • đo tải bằng PALLET, ≤ 6 pallet     → XE4PALLET
--   • đo tải bằng PALLET, > 6 pallet     → XEPALLET (kể cả 22–68 pallet: kho hiện chỉ có một dòng cha xe pallet lớn)
--   • đo tải bằng TẤN, lạnh / kết hợp    → XESCA    (xe có khoang lạnh — khung giờ / cửa SCA)
--   • đo tải bằng TẤN, nóng / khác       → XEXA
-- Khớp cha theo MÃ (code) chứ không theo id — id VehicleType khác nhau giữa staging và production.
-- Sửa lại từng dòng ở Cài đặt TMS → tab "Mã dòng xe" (tick nhiều → Gán cha).
-- ============================================================================

-- [cutover] gỡ: BEGIN;

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c, ',') INTO missing FROM unnest(ARRAY['XE4PALLET','XEPALLET','XEXA','XESCA','CONT','CONTSCA']) c
   WHERE NOT EXISTS (SELECT 1 FROM public."VehicleType" v WHERE v.code = c);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Thiếu dòng xe cha: % — gán tay ở Cài đặt TMS', missing; END IF;
END $$;

UPDATE public.vehicle_model m
   SET parent_type_id = (
         SELECT v.id FROM public."VehicleType" v WHERE v.code = CASE
           WHEN m.name ~* 'cont' AND m.name ~ '[lL]ạnh' THEN 'CONTSCA'
           WHEN m.name ~* 'cont'                        THEN 'CONT'
           WHEN m.capacity_mode = 'PALLET' AND coalesce(m.max_pallets, 99) <= 6 THEN 'XE4PALLET'
           WHEN m.capacity_mode = 'PALLET'              THEN 'XEPALLET'
           WHEN m.temp_mode IN ('COLD', 'MIXED')        THEN 'XESCA'
           ELSE 'XEXA' END),
       updated_at = now(), updated_by = 'migration 20260923b (gợi ý theo tên — sửa ở Mã dòng xe)'
 WHERE m.parent_type_id IS NULL;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.vehicle_model WHERE parent_type_id IS NULL AND is_active;
  IF n > 0 THEN RAISE EXCEPTION 'Còn % dòng xe con chưa gán cha sau khi suy', n; END IF;
END $$;

-- [cutover] gỡ: COMMIT;

-- KIỂM SAU KHI CHẠY
--   SELECT v.code, count(*) FROM vehicle_model m JOIN "VehicleType" v ON v.id = m.parent_type_id GROUP BY 1 ORDER BY 1;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260923c_so_lines_summary_follow_filter.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- Ô tổng tab "Chưa có OD": Pallet SAP + Tấn phải cộng ĐÚNG TẬP ĐANG XEM, không cứng ở status='OPEN'.
--
-- VÌ SAO (đo sống 23/09 trên Preview, kho Ba Vì, Ngày giao 07-09-2026): bản đầu cộng hai ô này với
-- FILTER (WHERE status = 'OPEN') trong khi 5 ô còn lại (rows · so_numbers · ship_tos · unresolved ·
-- not_loadable) đi theo mệnh đề WHERE, tức theo bộ lọc Trạng thái người dùng chọn. Lọc sang "Đã có OD"
-- ⇒ bảng 1.489 dòng, ô "SỐ SO 219 · SHIP-TO 142" đúng, mà "PALLET SAP 0 · TẤN 0" — ĐÈ LÊN chính cột
-- "Pallet SAP" của từng dòng đang in 0,68 · 0,82 · 0,81. Một băng tổng mâu thuẫn với bảng ngay dưới nó
-- thì người đọc kết luận "mất dữ liệu", và chính trạng thái rỗng của tab mời họ đổi bộ lọc sang đó.
-- Tooltip có giải thích, nhưng tooltip là thứ phải rê/chạm mới thấy — không cứu được con số sai ở lớp đầu.
--
-- Ô tổng là BẢN TÓM TẮT CỦA DANH SÁCH BÊN DƯỚI: cùng WHERE thì cùng tập. Màn hình mặc định KHÔNG ĐỔI
-- (bộ lọc mặc định vốn đã là OPEN ⇒ hai ô ra đúng con số cũ); chỉ các bộ lọc khác hết nói dối.
CREATE OR REPLACE FUNCTION public.erp_so_lines_summary(
  p_from date, p_to date, p_plants text[] DEFAULT NULL, p_status text[] DEFAULT NULL, p_flows text[] DEFAULT NULL, p_q text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
  WITH w AS (
    SELECT *
    FROM public.erp_so_lines s
    WHERE s.sync_status = 'ACTIVE'
      AND (p_from IS NULL OR s.delivery_date >= p_from)
      AND (p_to   IS NULL OR s.delivery_date <= p_to)
      AND (p_plants IS NULL OR s.plant IS NULL OR s.plant = ANY(p_plants))
      AND (p_status IS NULL OR s.status = ANY(p_status))
      AND (p_flows  IS NULL OR s.flow = ANY(p_flows))
      AND (p_q IS NULL OR p_q = '' OR s.so_number ILIKE '%' || p_q || '%' OR s.material_code ILIKE '%' || p_q || '%'
           OR s.material_name ILIKE '%' || p_q || '%' OR s.ship_to_name ILIKE '%' || p_q || '%' OR s.ship_to_code ILIKE '%' || p_q || '%')
  )
  SELECT jsonb_build_object(
    'rows',        count(*),
    'open',        count(*) FILTER (WHERE status = 'OPEN'),
    'has_od',      count(*) FILTER (WHERE status = 'HAS_OD'),
    'cancelled',   count(*) FILTER (WHERE status = 'CANCELLED'),
    'unresolved',  count(*) FILTER (WHERE qty_unresolved),
    'not_loadable',count(*) FILTER (WHERE flow NOT IN ('SALE','STO','INTERNAL','PALLET')),
    'so_numbers',  count(DISTINCT so_number),
    'ship_tos',    count(DISTINCT ship_to_code),
    -- theo ĐÚNG tập đang lọc, như mọi ô khác trong băng
    'sap_pallets', round(coalesce(sum(sap_pallets), 0), 1),
    'kg',          round(coalesce(sum(gross_weight_kg), 0), 1)
  ) FROM w;
$$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260924_dispatch_plan.sql]
-- ─────────────────────────────────────────────────────────────────────────
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



-- ─────────────────────────────────────────────────────────────────────────
-- [20260924b_dispatch_tender.sql]
-- ─────────────────────────────────────────────────────────────────────────
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



-- ─────────────────────────────────────────────────────────────────────────
-- [20260924c_storage_condition.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ĐIỀU KIỆN BẢO QUẢN — danh mục dùng chung cho HÀNG và XE (user chốt 24/09/2026 chiều:
-- "các điều kiện của tôi là lạnh âm, 2-8 độ, 15-25 độ và thường. Hãy tạo 1 điều kiện bảo quản ở wms setting"
-- + "tốt nhất nên config kho đi và config khớp với xe").
--
-- MÔ HÌNH (một nguồn, không đẻ bảng mới):
--   (1) DANH MỤC = `LookupValue` type='storage_condition' — khai ở Cài đặt WMS → Loại kho, quyền `wms_settings.manage_type`.
--       `meta` = {label, temp_min, temp_max, badge_color} cùng khuôn `freight_surcharge_kind`/`warehouse_type` đang dùng.
--   (2) HÀNG thừa kế theo LOẠI KHO: `LookupValue warehouse_type.meta.storage_condition` (một giá trị).
--       CỐ Ý KHÔNG seed — để trống = CHƯA KHAI = không ràng buộc gì, hành vi y hệt trước migration này. Đoán hộ "FG02 là
--       hàng lạnh" rồi ghi vào master là đúng lớp lỗi app này đã cấm; người khai một lần trên màn, có vết.
--   (3) XE khai PHỤC VỤ ĐƯỢC NHỮNG MỨC NÀO: `vehicle_model.storage_conditions text[]` (rỗng = mọi mức, cùng quy ước
--       `Location.categories` / `serve_categories` đang dùng khắp app).
--   (4) Engine ghép chuyến: mọi điều kiện của hàng trên xe phải NẰM TRONG danh sách xe phục vụ.
--       Giản lược đã biết: xe một khoang khai nhiều mức (xe lạnh đặt được cả âm lẫn mát) vẫn được phép chở lẫn hai mức
--       trong một chuyến. Muốn chặt hơn thì phải mô hình hoá KHOANG — chưa có ca thật, chưa làm.
--
-- Backfill xe theo TÊN dòng xe do chính user gửi (đo 24/09: 60 dòng, tên nói rõ nóng/lạnh/khô/kết hợp):
--   (nóng) · (khô) · "Xe N Pallet" không ghi nhiệt → chỉ THƯỜNG       [xe thùng kín không giữ được nhiệt ở VN]
--   (lạnh)                                        → LẠNH ÂM + 2–8 + 15–25   [máy lạnh đặt được nhiều mức]
--   kết hợp nóng/lạnh                             → cả 4 mức                [nhiều khoang]
-- Sai thì sửa ở Cài đặt TMS → Mã dòng xe (chọn nhiều → "Điều kiện bảo quản").

INSERT INTO public."LookupValue" (type, value, sort_order, meta) VALUES
  ('storage_condition', 'FROZEN',  1, '{"label": "Lạnh âm",   "temp_min": -25, "temp_max": -18, "badge_color": "blue"}'::jsonb),
  ('storage_condition', 'CHILL',   2, '{"label": "2 – 8 °C",  "temp_min": 2,   "temp_max": 8,   "badge_color": "sky"}'::jsonb),
  ('storage_condition', 'COOL',    3, '{"label": "15 – 25 °C","temp_min": 15,  "temp_max": 25,  "badge_color": "amber"}'::jsonb),
  ('storage_condition', 'AMBIENT', 4, '{"label": "Thường",    "temp_min": null,"temp_max": null,"badge_color": "slate"}'::jsonb)
ON CONFLICT (type, value) DO NOTHING;

ALTER TABLE public.vehicle_model ADD COLUMN IF NOT EXISTS storage_conditions text[] NOT NULL DEFAULT '{}';

UPDATE public.vehicle_model SET storage_conditions = CASE
    WHEN temp_mode = 'MIXED' THEN ARRAY['FROZEN','CHILL','COOL','AMBIENT']
    WHEN temp_mode = 'COLD'  THEN ARRAY['FROZEN','CHILL','COOL']
    ELSE ARRAY['AMBIENT']                     -- HOT · DRY · xe pallet không ghi nhiệt
  END
 WHERE storage_conditions = '{}';

DO $$
DECLARE n_cat int; n_col int; n_veh int; n_empty int;
BEGIN
  SELECT count(*) INTO n_cat FROM public."LookupValue" WHERE type = 'storage_condition';
  IF n_cat <> 4 THEN RAISE EXCEPTION 'danh mục điều kiện bảo quản phải có 4 mức, đang có %', n_cat; END IF;
  SELECT count(*) INTO n_col FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'vehicle_model' AND column_name = 'storage_conditions';
  IF n_col <> 1 THEN RAISE EXCEPTION 'thiếu vehicle_model.storage_conditions'; END IF;
  SELECT count(*), count(*) FILTER (WHERE storage_conditions = '{}') INTO n_veh, n_empty FROM public.vehicle_model;
  RAISE NOTICE 'điều kiện bảo quản: 4 mức · % dòng xe đã khai, % dòng còn trống', n_veh - n_empty, n_empty;
  -- Loại kho CỐ Ý còn trống: không gán hộ điều kiện cho hàng.
END $$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260924d_dispatch_freight_perms.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260924d — Điều vận + Cước: CẤP QUYỀN theo chức danh
-- ============================================================================
-- Đo 24/09 (staging): 0/19 chức danh có key `dispatch` hoặc `freight`. Trang Cước lên máy 23/09,
-- trang Điều vận 24/09 — CHỈ superadmin mở được, 41 nhân sự đang làm việc không ai thấy mục menu.
-- Cùng lớp lỗi với 20260912d (Việc cần làm ra máy 10/09 mà 0/9 chức danh kho có quyền): tính năng
-- xong ở tầng code KHÔNG có nghĩa là tới được tay người dùng.
--
-- Cấp theo NĂNG LỰC ĐÃ CÓ, KHÔNG so TÊN tiếng Việt (ratchet `role_by_vietnamese_name`).
--
-- ĐIỀU VẬN — "ai đang lập kế hoạch xe BẰNG TAY thì được dùng máy lập hộ":
--   • view    ← external_khvc.view  ∨ tms_plan.create ∨ tms_plan.edit
--   • plan    ← external_khvc.create ∨ external_khvc.edit ∨ tms_plan.create ∨ tms_plan.edit
--   • confirm ← external_khvc.create ∨ external_khvc.edit   ← CỐ Ý HẸP HƠN plan
--       Xác nhận kế hoạch GHI THẲNG vào `khvc_lines` (Kế hoạch xuất). Ai không được sửa Kế hoạch
--       xuất bằng tay thì cũng không được ghi vào đó qua cửa mới — đúng luật "nút ở trang A nhưng
--       chạm module B thì phải có quyền B". Hệ quả đã biết: chức danh Nhân viên/Quản lý điều vận
--       (external_khvc rỗng) LẬP được nháp nhưng chưa XÁC NHẬN được; muốn cho thì tick thêm
--       external_khvc.edit hoặc dispatch.confirm trong trình phân quyền — một nhát, có chủ đích.
--   • export  ← có view VÀ đã có tms_plan.export (mang dữ liệu ra khỏi app là quyền RIÊNG,
--       không đi ké view — luật export của CLAUDE.md). external_khvc không có action export.
--
-- CƯỚC — dữ liệu TIỀN theo hợp đồng ĐVVT, hẹp hơn Điều vận:
--   • view   ← tms_companies.edit ∨ tms_vehicle_types.edit ∨ warehouse_cost.view
--              (ai quản danh mục vận tải, hoặc đã được tin cho xem tiền)
--   • manage ← warehouse_cost.edit ∨ tms_vehicle_types.edit   (ai đang khai tiền / làm chủ danh
--              mục dòng xe — nạp bảng cước là ghi lại giá hợp đồng, không phải việc hằng ngày)
--   • export ← có view VÀ đã có tms_plan.export
--
-- CHỈ điền cho chức danh CHƯA có key tương ứng — admin đã tự cấp/gỡ thì KHÔNG đè.
-- ============================================================================
-- [cutover] gỡ: BEGIN;

-- ── ĐIỀU VẬN ──
WITH src AS (
  SELECT id, COALESCE(module_permissions, '{}'::jsonb) AS mp FROM public."JobTitle"
), capab AS (
  SELECT id,
         (mp->'external_khvc' ? 'create') OR (mp->'external_khvc' ? 'edit')            AS khvc_write,
         (mp->'tms_plan' ? 'create')      OR (mp->'tms_plan' ? 'edit')                 AS plan_write,
         (mp->'external_khvc' ? 'view')                                                AS khvc_read,
         (mp->'tms_plan' ? 'export')                                                   AS can_export
    FROM src
   WHERE mp->'dispatch' IS NULL
), grant_rows AS (
  -- ai nhận BẤT KỲ quyền con nào cũng phải có `view`, kẻo cấp quyền cho một trang họ không mở được
  SELECT id, khvc_write, plan_write, can_export FROM capab
   WHERE khvc_read OR plan_write OR khvc_write
)
UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(
         COALESCE(j.module_permissions, '{}'::jsonb), '{dispatch}',
         to_jsonb(
           ARRAY['view']
           || CASE WHEN g.khvc_write OR g.plan_write THEN ARRAY['plan']    ELSE ARRAY[]::text[] END
           || CASE WHEN g.khvc_write                 THEN ARRAY['confirm'] ELSE ARRAY[]::text[] END
           || CASE WHEN g.can_export                 THEN ARRAY['export']  ELSE ARRAY[]::text[] END
         ), true),
       updated_at = now()
  FROM grant_rows g
 WHERE g.id = j.id;

-- ── CƯỚC ──
WITH src AS (
  SELECT id, COALESCE(module_permissions, '{}'::jsonb) AS mp FROM public."JobTitle"
), capab AS (
  SELECT id,
         (mp->'tms_companies' ? 'edit') OR (mp->'tms_vehicle_types' ? 'edit')
           OR (mp->'warehouse_cost' ? 'view')                                          AS can_view,
         (mp->'warehouse_cost' ? 'edit') OR (mp->'tms_vehicle_types' ? 'edit')         AS can_manage,
         (mp->'tms_plan' ? 'export')                                                   AS can_export
    FROM src
   WHERE mp->'freight' IS NULL
), grant_rows AS (
  SELECT * FROM capab WHERE can_view
)
UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(
         COALESCE(j.module_permissions, '{}'::jsonb), '{freight}',
         to_jsonb(
           ARRAY['view']
           || CASE WHEN g.can_manage THEN ARRAY['manage'] ELSE ARRAY[]::text[] END
           || CASE WHEN g.can_export THEN ARRAY['export'] ELSE ARRAY[]::text[] END
         ), true),
       updated_at = now()
  FROM grant_rows g
 WHERE g.id = j.id;

-- ── Gác: không để lại trạng thái vô nghĩa ──
DO $$
DECLARE n int;
BEGIN
  -- ai ghi được Kế hoạch xuất thì phải mở được Điều vận (nếu không, máy lập hộ mà người không thấy)
  SELECT count(*) INTO n FROM public."JobTitle"
   WHERE ((COALESCE(module_permissions,'{}')->'external_khvc' ? 'create')
       OR (COALESCE(module_permissions,'{}')->'external_khvc' ? 'edit'))
     AND NOT (COALESCE(module_permissions,'{}')->'dispatch' ? 'view');
  IF n > 0 THEN RAISE EXCEPTION 'còn % chức danh ghi được Kế hoạch xuất mà không mở được Điều vận', n; END IF;

  -- không ai được quyền con mà thiếu quyền xem trang chứa nó
  SELECT count(*) INTO n FROM public."JobTitle"
   WHERE ((COALESCE(module_permissions,'{}')->'dispatch' ? 'plan')
       OR (COALESCE(module_permissions,'{}')->'dispatch' ? 'confirm')
       OR (COALESCE(module_permissions,'{}')->'dispatch' ? 'export'))
     AND NOT (COALESCE(module_permissions,'{}')->'dispatch' ? 'view');
  IF n > 0 THEN RAISE EXCEPTION 'còn % chức danh có quyền con dispatch mà không có dispatch.view', n; END IF;

  SELECT count(*) INTO n FROM public."JobTitle"
   WHERE ((COALESCE(module_permissions,'{}')->'freight' ? 'manage')
       OR (COALESCE(module_permissions,'{}')->'freight' ? 'export'))
     AND NOT (COALESCE(module_permissions,'{}')->'freight' ? 'view');
  IF n > 0 THEN RAISE EXCEPTION 'còn % chức danh có quyền con freight mà không có freight.view', n; END IF;
END $$;

-- [cutover] gỡ: COMMIT;


COMMIT;
-- === HẾT PART 10/10 ===
