-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- %DATE THEO KHÁCH HÀNG / KÊNH — master data thay cho chốt tay 1.000 dòng/ngày (user chốt 11/09).
-- Plan: docs/plans/CUSTOMER_DATE_RULE_PLAN.md
--
-- VÌ SAO danh mục Khách hàng là bảng RIÊNG chứ không nhét vào "Warehouse" (ý đầu tiên của user):
-- bảng Kho mang ~40 cột VẬN HÀNH (chế độ tồn, cất hàng, luân chuyển, cửa xuất, cân, cổng, work_mode…)
-- và được liệt kê ở khắp nơi — bộ chọn Kho toàn cục trên Header, phạm vi kho khi phân quyền nhân sự,
-- KPI/cảnh báo/chi phí theo kho, Sơ đồ kho. Đưa ~100 khách hàng vào đó là mỗi khách mang 40 ô vô
-- nghĩa và lọt vào mọi màn đang nói về "kho". Khách hàng NÀO LÀ KHO CỦA MÌNH thì khai tường minh
-- bằng Customer.warehouse_id — đó cũng là chỗ luật Chuyển kho đọc để biết ai xác nhận hàng.
--
-- Đo staging 11/09 (vì sao cần việc này): VL06O cột %Date trống 100 % (0/26.675 dòng 60 ngày) ⇒
-- không có nguồn %Date nào ngoài tay người; 99,7 % chuyến CÓ mã ship-to ⇒ khoá tự động hoá sẵn có.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ─── 1. Danh mục Khách hàng / Nơi nhận ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."Customer" (
  id            text PRIMARY KEY,
  -- Khoá SAP. Đo staging: 87 mã trên chuyến + 94 mã trong VL06O, TẤT CẢ đều chữ-số, dài ≤ 8.
  ship_to_code  text NOT NULL UNIQUE CHECK (ship_to_code ~ '^[A-Z0-9]+$' AND length(ship_to_code) <= 50),
  name          text NOT NULL,
  -- LookupValue(type='customer_channel').value — NULL = CHƯA PHÂN KÊNH ⇒ không cấp %Date tự động
  channel       text,
  -- %Date riêng của khách (ghi đè kênh). Master chỉ FEFO | MIN_PCT: EXACT (đúng NSX/lô) và SPLIT
  -- (chia phần theo SL) là quyết định của TỪNG DÒNG ĐƠN, không phải luật chung của một khách.
  date_rule     jsonb,
  -- "Nơi nhận này là KHO CỦA MÌNH" → luật Chuyển kho: có kho + kho không phải NONE ⇒ kho nhận
  -- xác nhận trong app (delivery_mode SCAN); để trống ⇒ tài xế tự xác nhận (SELF).
  warehouse_id  text REFERENCES public."Warehouse"(id) ON DELETE SET NULL,
  is_active     boolean NOT NULL DEFAULT true,
  -- true = sinh tự động khi upload kế hoạch gặp ship-to lạ (kênh trống ⇒ KHÔNG cấp %Date tự động)
  auto_created  boolean NOT NULL DEFAULT false,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  updated_by    text,
  CONSTRAINT customer_date_rule_ck CHECK (
    public.date_rule_valid(date_rule)
    AND (date_rule IS NULL OR (date_rule->>'kind') IN ('FEFO', 'MIN_PCT'))
    AND (date_rule IS NULL OR (date_rule->>'kind') <> 'MIN_PCT' OR (
           (date_rule->>'value') ~ '^[0-9]+(\.[0-9]+)?$'
           AND (date_rule->>'value')::numeric > 0
           AND (date_rule->>'value')::numeric <= 100))
  )
);

CREATE INDEX IF NOT EXISTS ix_customer_warehouse ON public."Customer"(warehouse_id) WHERE warehouse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_customer_channel   ON public."Customer"(channel);
-- Tìm theo tên không phân biệt hoa/thường (ô search trang Khách hàng)
CREATE INDEX IF NOT EXISTS ix_customer_name_lower ON public."Customer"(lower(name));

-- Bảng NỘI BỘ backend (service_role). KHÔNG policy cho authenticated/anon — vé realtime của mọi
-- tài khoản đăng nhập không được đọc bảng này (luật 02/09, gói QA 40 gác).
ALTER TABLE public."Customer" ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  public."Customer"              IS 'Khách hàng / Nơi nhận — khoá ship_to_code của SAP. warehouse_id = nơi nhận này là kho của mình.';
COMMENT ON COLUMN public."Customer".channel      IS 'Kênh: LookupValue(type=customer_channel).value. NULL = chưa phân kênh ⇒ KHÔNG cấp %Date tự động.';
COMMENT ON COLUMN public."Customer".date_rule    IS '%Date riêng của khách, ghi đè kênh. Chỉ FEFO | MIN_PCT.';
COMMENT ON COLUMN public."Customer".auto_created IS 'Sinh tự động từ upload kế hoạch khi gặp ship-to lạ (luôn chưa phân kênh).';

-- ─── 2. KÊNH KHÁCH HÀNG — danh mục MỚI (trước 11/09 app KHÔNG có chỗ khai "Kho tổng / NPP / BHX…")
-- Dùng LookupValue.meta như Loại kho đang làm, không đẻ bảng mới. CHỈ kênh NPP có sẵn mức ≥ 60 %
-- (user 10/09: "NPP đi ≥ 60 % nếu CS không ghi chú"); kênh khác để TRỐNG = chưa khai ⇒ không áp gì.
INSERT INTO public."LookupValue"(id, type, value, sort_order, meta, created_at, updated_at) VALUES
  (gen_random_uuid(), 'customer_channel', 'KHO_TONG', 1, '{"label":"Kho tổng"}'::jsonb,      now(), now()),
  (gen_random_uuid(), 'customer_channel', 'NPP',      2, '{"label":"Nhà phân phối","date_rule":{"kind":"MIN_PCT","value":60}}'::jsonb, now(), now()),
  (gen_random_uuid(), 'customer_channel', 'BHX',      3, '{"label":"Bách hoá xanh"}'::jsonb, now(), now()),
  (gen_random_uuid(), 'customer_channel', 'KA',       4, '{"label":"Key Account"}'::jsonb,   now(), now()),
  (gen_random_uuid(), 'customer_channel', 'MT',       5, '{"label":"Modern Trade"}'::jsonb,  now(), now()),
  (gen_random_uuid(), 'customer_channel', 'NOI_BO',   6, '{"label":"Nội bộ"}'::jsonb,        now(), now()),
  (gen_random_uuid(), 'customer_channel', 'KHAC',     7, '{"label":"Khác"}'::jsonb,          now(), now())
ON CONFLICT (type, value) DO NOTHING;

-- ─── 3. Chính sách áp %Date tự động — theo KHO XUẤT ───────────────────────────────────────────
--   OFF     = tắt (mặc định cho MỌI kho đang chạy — áp tự động là đổi hành vi, không tự bật)
--   ALL     = áp cho mọi dòng chưa chốt tay
--   NO_NOTE = CHỈ áp cho dòng KHÔNG có ghi chú CS (user chốt 11/09; khuyên dùng — ghi chú là chỗ
--             NGƯỜI phải đọc, máy không đọc ghi chú, luật 10/09)
ALTER TABLE public."Warehouse"
  ADD COLUMN IF NOT EXISTS date_rule_policy text NOT NULL DEFAULT 'OFF';
DO $$ BEGIN
  ALTER TABLE public."Warehouse"
    ADD CONSTRAINT warehouse_date_rule_policy_ck CHECK (date_rule_policy IN ('OFF', 'ALL', 'NO_NOTE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public."Warehouse".date_rule_policy IS 'Áp %Date tự động theo Khách hàng/Kênh: OFF | ALL | NO_NOTE (chỉ dòng không có ghi chú CS).';

-- ─── 4. Ứng viên nạp danh mục — DISTINCT TRONG SQL, không kéo dòng thô về Node ─────────────────
-- Nguồn: VL06O (erp_outbound_orders) ∪ chuyến đã có (GroupDeliveryOrder.shipto_party + tên NPP).
-- Trả cả cờ "đã có trong danh mục" để màn Nạp hiện Mới / Đã có mà không phải hỏi thêm câu nào.
CREATE OR REPLACE FUNCTION public.customer_seed_candidates(p_days int DEFAULT 730)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  WITH erp AS (
    SELECT upper(btrim(e.ship_to_code)) AS ship_to_code,
           (array_agg(e.ship_to_name ORDER BY e.created_at DESC)
              FILTER (WHERE coalesce(btrim(e.ship_to_name), '') <> ''))[1] AS name,
           count(*)                     AS erp_lines,
           max(e.created_at)            AS last_at
      FROM public.erp_outbound_orders e
     WHERE coalesce(btrim(e.ship_to_code), '') <> ''
       AND e.created_at >= now() - make_interval(days => greatest(1, coalesce(p_days, 730)))
     GROUP BY 1
  ),
  trips AS (
    SELECT upper(btrim(g.shipto_party)) AS ship_to_code,
           (array_agg(d.distributor_name ORDER BY g.delivery_date DESC NULLS LAST)
              FILTER (WHERE coalesce(btrim(d.distributor_name), '') <> ''))[1] AS name,
           count(DISTINCT g.id)         AS trips,
           max(g.delivery_date)         AS last_date
      FROM public."GroupDeliveryOrder" g
      LEFT JOIN LATERAL (
        SELECT dd.distributor_name FROM public."OutboundDelivery" dd
         WHERE dd.gdo_id = g.id ORDER BY dd.id LIMIT 1
      ) d ON true
     WHERE coalesce(btrim(g.shipto_party), '') <> ''
       AND g.delivery_date >= (now() - make_interval(days => greatest(1, coalesce(p_days, 730))))::date
     GROUP BY 1
  ),
  merged AS (
    SELECT coalesce(e.ship_to_code, t.ship_to_code) AS ship_to_code,
           coalesce(e.name, t.name, coalesce(e.ship_to_code, t.ship_to_code)) AS name,
           coalesce(e.erp_lines, 0) AS erp_lines,
           coalesce(t.trips, 0)     AS trips,
           greatest(e.last_at::date, t.last_date)   AS last_date
      FROM erp e FULL OUTER JOIN trips t ON t.ship_to_code = e.ship_to_code
  )
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.trips DESC, x.erp_lines DESC, x.ship_to_code), '[]'::jsonb)
    FROM (
      SELECT m.ship_to_code, m.name, m.erp_lines, m.trips, m.last_date,
             (c.id IS NOT NULL)  AS exists_already,
             c.name              AS current_name,
             c.channel           AS current_channel
        FROM merged m
        LEFT JOIN public."Customer" c ON c.ship_to_code = m.ship_to_code
       WHERE m.ship_to_code ~ '^[A-Z0-9]+$'
    ) x;
$$;

REVOKE ALL ON FUNCTION public.customer_seed_candidates(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_seed_candidates(int) TO service_role;
