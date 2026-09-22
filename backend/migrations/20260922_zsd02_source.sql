-- ZSD02 thay VL06O làm nguồn DO (đợt 0 TMS điều vận, plan docs/plans/TMS_DISPATCH_PLAN.md — 22/09/2026)
-- (1) Sổ OD `erp_outbound_orders` nhận thêm cột ZSD02-only (đều NULL-able; VL06O không đụng tới).
-- (2) Sổ SO `erp_so_lines` (MỚI, hạt = dòng SO): dòng CHƯA có OD của ZSD02 KHÔNG được vào sổ OD vì
--     SAP để "OD Qty (Base Unit)" = 0 ở 100 % dòng đó — ghi 0 vào qty_base là engine reconcile hiểu
--     "SAP nói 0" và hạ cartons_ordered. Sổ SO chỉ nuôi tab "Chưa có OD" (nhìn trước tải), không cửa
--     nghiệp vụ nào đọc số lượng từ đây.
-- (3) `sap_route` tham chiếu tuyến SAP (231 mã, 1-1 với tên).
-- (4) `Customer` thêm địa lý từ ZSD02 (ward_code = "Tên Phường" = KHOÁ CƯỚC; ship-to → phường 1-1 trên dữ liệu).
-- (5) LookupValue `sap_flow_map`: mã SAP (so_type / item_category) → flow. Là DỮ LIỆU, không `if` chuỗi trong code.
-- (6) Kho Bàu Bàng khai sap_plant 2101 (Plant Description SAP: "2101-Nhà máy LOF BD").
-- Áp STAGING trước → test → production. Idempotent (IF NOT EXISTS / ON CONFLICT).

-- ── (1) erp_outbound_orders ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.erp_outbound_orders
  ADD COLUMN IF NOT EXISTS so_number           text,
  ADD COLUMN IF NOT EXISTS so_item             text,
  ADD COLUMN IF NOT EXISTS so_type             text,
  ADD COLUMN IF NOT EXISTS item_category       text,
  ADD COLUMN IF NOT EXISTS flow                text,
  ADD COLUMN IF NOT EXISTS delivery_date       date,
  ADD COLUMN IF NOT EXISTS sales_org           text,
  ADD COLUMN IF NOT EXISTS dist_channel        text,
  ADD COLUMN IF NOT EXISTS sold_to_code        text,
  ADD COLUMN IF NOT EXISTS ward_code           text,
  ADD COLUMN IF NOT EXISTS region_code         text,
  ADD COLUMN IF NOT EXISTS sales_district      text,
  ADD COLUMN IF NOT EXISTS route_code          text,
  ADD COLUMN IF NOT EXISTS route_name          text,
  ADD COLUMN IF NOT EXISTS dvvt_code           text,
  ADD COLUMN IF NOT EXISTS dvvt_raw            text,
  ADD COLUMN IF NOT EXISTS driver_name         text,
  ADD COLUMN IF NOT EXISTS sap_dispatch_status text,
  ADD COLUMN IF NOT EXISTS qty_so_sales        numeric,
  ADD COLUMN IF NOT EXISTS qty_issued_base     numeric,
  ADD COLUMN IF NOT EXISTS gross_weight_kg     numeric,
  ADD COLUMN IF NOT EXISTS sap_pallets         numeric,
  ADD COLUMN IF NOT EXISTS sap_m3              numeric,
  ADD COLUMN IF NOT EXISTS mat_doc             text,
  ADD COLUMN IF NOT EXISTS billing_no          text,
  ADD COLUMN IF NOT EXISTS so_created_at       date,
  ADD COLUMN IF NOT EXISTS od_created_at       date,
  ADD COLUMN IF NOT EXISTS approval_status     text,
  ADD COLUMN IF NOT EXISTS customer_ref        text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_ob_flow_chk') THEN
    ALTER TABLE public.erp_outbound_orders ADD CONSTRAINT erp_ob_flow_chk
      CHECK (flow IS NULL OR flow IN ('SALE','STO','INTERNAL','RETURN','DISCOUNT','PALLET','UNKNOWN'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_ob_dispatch_chk') THEN
    ALTER TABLE public.erp_outbound_orders ADD CONSTRAINT erp_ob_dispatch_chk
      CHECK (sap_dispatch_status IS NULL OR sap_dispatch_status IN ('ASSIGNED','UNASSIGNED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_erp_ob_delivery_date ON public.erp_outbound_orders (delivery_date);
CREATE INDEX IF NOT EXISTS idx_erp_ob_flow_date     ON public.erp_outbound_orders (flow, delivery_date);
CREATE INDEX IF NOT EXISTS idx_erp_ob_ward          ON public.erp_outbound_orders (ward_code);

-- ── (2) erp_so_lines — sổ SO (hạt dòng SO) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_so_lines (
  id                 text PRIMARY KEY,
  so_number          text NOT NULL,
  so_item            text NOT NULL,
  od_number          text,                       -- NULL = chưa có OD; điền khi ZSD02 báo OD
  material_code      text,
  material_name      text,
  qty_so_sales       numeric,                    -- "SO Qty" theo đơn vị bán (đúng số SAP)
  sales_unit         text,                       -- đã quy nhãn CAR/HOP/EA/KG (utils/sapUnits)
  qty_so_cartons     numeric,                    -- "SO Qty CAR" — SAP tự quy ra thùng, kể cả dòng bán theo Hộp
  qty_so_base        numeric,                    -- DẪN XUẤT (SAP không cho) — xem cờ dưới
  qty_base_derived   boolean NOT NULL DEFAULT true,
  derive_source      text,                       -- 'SAP' (nếu SAP thêm cột SO Qty Base) | 'FILE' (hệ số quan sát từ dòng OD cùng mã) | 'MASTER' (units_per_carton)
  qty_unresolved     boolean NOT NULL DEFAULT false,
  base_unit          text,
  ship_to_code       text,
  ship_to_name       text,
  sold_to_code       text,
  plant              text,
  storage_location   text,
  delivery_date      date,
  flow               text,
  so_type            text,
  item_category      text,
  status             text NOT NULL DEFAULT 'OPEN',   -- OPEN | HAS_OD | CANCELLED
  cancel_reason      text,
  approval_status    text,
  ward_code          text,
  region_code        text,
  route_code         text,
  route_name         text,
  sap_pallets        numeric,
  sap_m3             numeric,
  gross_weight_kg    numeric,
  note_delivery      text,
  sync_status        text NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | OBSOLETE
  source             text NOT NULL DEFAULT 'ZSD02',
  raw                jsonb,
  uploaded_by        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_so_lines_key UNIQUE (so_number, so_item),
  CONSTRAINT erp_so_status_chk CHECK (status IN ('OPEN','HAS_OD','CANCELLED')),
  CONSTRAINT erp_so_flow_chk CHECK (flow IS NULL OR flow IN ('SALE','STO','INTERNAL','RETURN','DISCOUNT','PALLET','UNKNOWN')),
  CONSTRAINT erp_so_sync_chk CHECK (sync_status IN ('ACTIVE','OBSOLETE'))
);
CREATE INDEX IF NOT EXISTS idx_erp_so_delivery_date ON public.erp_so_lines (delivery_date);
CREATE INDEX IF NOT EXISTS idx_erp_so_status_date   ON public.erp_so_lines (status, delivery_date);
CREATE INDEX IF NOT EXISTS idx_erp_so_od            ON public.erp_so_lines (od_number);
CREATE INDEX IF NOT EXISTS idx_erp_so_plant_date    ON public.erp_so_lines (plant, delivery_date);
CREATE INDEX IF NOT EXISTS idx_erp_so_created       ON public.erp_so_lines (created_at);
-- Realtime: event trigger tự gắn trg_wms_notify lúc CREATE TABLE (20260902b); FE thêm TABLE_QUERY_MAP.

-- ── (3) sap_route — tuyến SAP tham chiếu ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sap_route (
  route_code  text PRIMARY KEY,
  route_name  text NOT NULL,
  plant       text,
  ward_code   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- bảng tham chiếu nội bộ, không cần tín hiệu realtime
DROP TRIGGER IF EXISTS trg_wms_notify ON public.sap_route;

-- ── (4) Customer — địa lý từ ZSD02 ─────────────────────────────────────────────────────────────────
ALTER TABLE public."Customer"
  ADD COLUMN IF NOT EXISTS ward_code      text,   -- "Tên Phường" (vd HN-Phú Lương) — KHOÁ CƯỚC
  ADD COLUMN IF NOT EXISTS region_code    text,   -- "Region/ Tỉnh.TP" mã (100)
  ADD COLUMN IF NOT EXISTS region_name    text,   -- (Thành phố Hà Nội)
  ADD COLUMN IF NOT EXISTS sales_district text,   -- "Sales District/ Khu vực bán hàng"
  ADD COLUMN IF NOT EXISTS sales_office   text,
  ADD COLUMN IF NOT EXISTS address        text,   -- "Địa chỉ giao hàng"
  ADD COLUMN IF NOT EXISTS sold_to_code   text,
  ADD COLUMN IF NOT EXISTS search_term    text;   -- "Search Term 1" (tên tắt SAP)
CREATE INDEX IF NOT EXISTS ix_customer_ward ON public."Customer" (ward_code) WHERE ward_code IS NOT NULL;

-- ── (5) LookupValue sap_flow_map — mã SAP → flow ────────────────────────────────────────────────────
-- value = MÃ SAP (đoạn trước dấu '-' của "ZOR1-SO Standard" / "ZTA2-IC Pallet") — LookupValue unique (type, value)
-- nên MỘT dòng cho mỗi mã dù mã đó xuất hiện ở cả item_category lẫn so_type (ZRE1/ZRE3: cùng flow RETURN).
-- meta.kind = 'item_category' | 'so_type' | 'both' (chỉ để đọc); meta.flow = SALE | STO | INTERNAL | RETURN | DISCOUNT | PALLET.
-- Khớp: item_category trước, so_type sau — cùng một bảng, tra theo value. Mã lạ → flow UNKNOWN + cảnh báo lúc nạp.
-- Seed theo đo file mẫu 01–25/09/2026 (16 item category · 12 SO type).
INSERT INTO public."LookupValue" (id, type, value, sort_order, meta, created_at, updated_at)
SELECT gen_random_uuid(), 'sap_flow_map', v.value, v.ord, v.meta::jsonb, now(), now()
FROM (VALUES
  -- item_category
  ('ZTA2', 10, '{"kind":"item_category","flow":"PALLET","label":"IC Pallet (Pallet Loscam đi cùng hàng)"}'),
  ('ZCKT', 11, '{"kind":"item_category","flow":"DISCOUNT","label":"Monthly Discount"}'),
  ('F',    12, '{"kind":"item_category","flow":"STO","label":"Purchase Order (STO)"}'),
  ('ZNB1', 13, '{"kind":"item_category","flow":"INTERNAL","label":"IntCost-Off"}'),
  -- cả hai
  ('ZRE1', 14, '{"kind":"both","flow":"RETURN","label":"Sales Return - Block / SO Sale Return"}'),
  ('ZRE3', 15, '{"kind":"both","flow":"RETURN","label":"Pallet Return / SO Return Pallet"}'),
  -- so_type
  ('ZOR1', 20, '{"kind":"so_type","flow":"SALE","label":"SO Standard"}'),
  ('ZOR2', 21, '{"kind":"so_type","flow":"SALE","label":"SO Export"}'),
  ('ZKG1', 22, '{"kind":"so_type","flow":"SALE","label":"SO Cons.Fill-Up"}'),
  ('ZXKM', 23, '{"kind":"so_type","flow":"SALE","label":"SO Accrual Promotion"}'),
  ('ZXBT', 24, '{"kind":"so_type","flow":"SALE","label":"SO Free No Condition"}'),
  ('ZXSD', 25, '{"kind":"so_type","flow":"SALE","label":"SO Issue No Einvoice"}'),
  ('ZTD1', 26, '{"kind":"so_type","flow":"INTERNAL","label":"SO Internal Cost"}'),
  ('UB',   27, '{"kind":"so_type","flow":"STO","label":"Stock Transp. Order"}'),
  ('ZUB',  28, '{"kind":"so_type","flow":"STO","label":"STO-CVS"}'),
  ('NB',   29, '{"kind":"so_type","flow":"STO","label":"PO with Contract"}')
) AS v(value, ord, meta)
ON CONFLICT (type, value) DO NOTHING;

-- ── (6) Kho Bàu Bàng ↔ plant 2101 ───────────────────────────────────────────────────────────────────
UPDATE public."Warehouse" SET sap_plant = '2101', updated_at = now()
WHERE code = '20000017' AND sap_plant IS NULL;

-- ── Kiểm sau áp ─────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public."LookupValue" WHERE type = 'sap_flow_map';
  IF n < 16 THEN RAISE EXCEPTION 'sap_flow_map seed thiếu: % dòng', n; END IF;
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_name = 'erp_outbound_orders' AND column_name IN ('flow','delivery_date','ward_code','dvvt_code','gross_weight_kg');
  IF n <> 5 THEN RAISE EXCEPTION 'erp_outbound_orders thiếu cột ZSD02'; END IF;
END $$;
