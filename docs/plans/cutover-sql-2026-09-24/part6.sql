-- ============================================================================
-- CUTOVER production 24/09/2026 — PART 6/10
-- 17 migration · 20260910j_directed_board_trip_date.sql → 20260912f_directed_work_claim_combined.sql
-- Dán TRỌN file vào Supabase SQL Editor của project PRODUCTION svicyfquresxaigfxsdb rồi Run.
-- Cả part nằm trong MỘT transaction: lỗi bất kỳ đâu = rollback trọn part, schema không dở dang.
-- Chạy lại lần hai sẽ báo "đã tồn tại" rồi tự rollback — không hỏng gì.
-- ============================================================================
BEGIN;


-- ─────────────────────────────────────────────────────────────────────────
-- [20260910j_directed_board_trip_date.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260910j — Việc cần làm: mang NGÀY CHUYẾN ra bảng và ra băng "chưa chốt %Date"
-- ============================================================================
-- Bảng lấy việc của MỌI chuyến đang IN_PROGRESS/PAUSED, không có mốc thời gian nào.
-- Chuyến bỏ dở từ tháng trước vì thế nằm chung với việc hôm nay, và băng vàng
-- "n dòng chưa chốt %Date" đếm luôn cả chúng ⇒ sáng nào mở lên cũng thấy một cảnh
-- báo to về dữ liệu cũ. Cảnh báo kêu hằng ngày thì người ta thôi đọc.
--
-- KHÔNG lọc bỏ chuyến cũ (việc dở vẫn là việc thật, giấu đi là mất việc). Chỉ TRẢ THÊM
-- ngày chuyến để màn hình tách được "hôm nay" với "chuyến cũ còn dở".
-- ============================================================================
CREATE OR REPLACE FUNCTION public.directed_board(
  p_warehouse_id text,
  p_mode         text,
  p_gdo_id       text DEFAULT NULL,
  p_driver_id    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_rows   jsonb;
  v_tot    jsonb;
  v_alerts jsonb;
BEGIN
  WITH base AS (
    SELECT t.*,
           g.group_code, g.license_plate, g.status AS gdo_status, g.started_at,
           g.delivery_date,
           g.forklift_driver_ids, g.dock_location_id AS gdo_dock_id,
           fl.location_code AS from_code,
           dl.location_code AS drop_code, dl.row AS drop_name,
           tl.location_code AS to_code,   tl.row AS to_name,
           dk.row           AS dock_name,
           m.short_name     AS material_name,
           CASE
             WHEN t.lowered_at IS NULL           THEN fl.location_code
             WHEN t.kind = 'LOOSE_FEED'          THEN tl.location_code
             ELSE COALESCE(dl.location_code, fl.location_code)
           END AS current_code,
           (t.needs_lower AND t.lowered_at IS NULL AND t.status = 'PENDING') AS waiting_lower
      FROM public.wms_tasks t
      JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
      LEFT JOIN public."Location" fl ON fl.id = t.from_location_id
      LEFT JOIN public."Location" dl ON dl.id = t.drop_location_id
      LEFT JOIN public."Location" tl ON tl.id = t.to_location_id
      LEFT JOIN public."Location" dk ON dk.id = g.dock_location_id
      LEFT JOIN public."Material"  m  ON m.id  = t.material_id
     WHERE t.warehouse_id = p_warehouse_id
       AND t.status IN ('PENDING', 'DONE')
       AND g.status IN ('IN_PROGRESS', 'PAUSED')
       AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id)
  ),
  gdo_flag AS (
    SELECT gdo_id,
           bool_and(NOT (status = 'PENDING' AND NOT waiting_lower)) AS truck_idle
      FROM base GROUP BY gdo_id
  ),
  filtered AS (
    SELECT b.*, COALESCE(f.truck_idle, false) AS truck_idle
      FROM base b LEFT JOIN gdo_flag f ON f.gdo_id = b.gdo_id
     WHERE CASE p_mode
             WHEN 'LOWER' THEN b.needs_lower
             WHEN 'MOVE'  THEN NOT (b.kind = 'LOOSE_FEED' AND b.needs_lower)
             ELSE true
           END
       AND (p_driver_id IS NULL OR p_driver_id = ANY (COALESCE(b.forklift_driver_ids, ARRAY[]::text[])))
  ),
  grouped AS (
    SELECT
      CASE WHEN p_mode = 'SCAN' THEN t.id
           ELSE t.gdo_id || '|' || COALESCE(t.current_code, '?') || '|' || COALESCE(t.to_code, '?') || '|' || t.kind
      END                                        AS group_key,
      min(t.seq)                                 AS seq,
      jsonb_agg(t.id ORDER BY t.seq)             AS task_ids,
      count(*)                                   AS n_pallets,
      sum(t.qty_base)                            AS qty_base,
      min(t.gdo_id)                              AS gdo_id,
      min(t.group_code)                          AS group_code,
      min(t.license_plate)                       AS license_plate,
      min(t.started_at)                          AS started_at,
      min(t.delivery_date)                       AS delivery_date,
      min(t.dock_name)                           AS dock_name,
      min(t.kind)                                AS kind,
      min(t.current_code)                        AS current_code,
      min(t.from_code)                           AS from_code,
      max(t.level_no)                            AS level_no,
      min(t.to_code)                             AS to_code,
      min(t.to_name)                             AS to_name,
      min(t.drop_name)                           AS drop_name,
      min(t.dist_cells)                          AS dist_cells,
      bool_or(t.needs_lower)                     AS needs_lower,
      bool_or(t.waiting_lower)                   AS waiting_lower,
      bool_or(t.truck_idle)                      AS truck_idle,
      bool_and(t.status = 'DONE' OR CASE p_mode WHEN 'LOWER' THEN t.lowered_at IS NOT NULL
                                                WHEN 'MOVE'  THEN t.moved_at   IS NOT NULL
                                                ELSE t.done_at IS NOT NULL END) AS stage_done,
      bool_and(t.status = 'DONE')                AS all_scanned,
      max(COALESCE(t.done_at, t.moved_at, t.lowered_at)) AS last_at,
      min(t.lowered_by)                          AS lowered_by,
      min(t.moved_by)                            AS moved_by,
      jsonb_agg(DISTINCT t.material_code)        AS material_codes,
      min(t.material_name)                       AS material_name,
      jsonb_agg(DISTINCT t.pallet_code)          AS pallet_codes
      FROM filtered t
     GROUP BY 1
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'group_key',      g.group_key,
      'task_ids',       g.task_ids,
      'seq',            g.seq,
      'gdo_id',         g.gdo_id,
      'group_code',     g.group_code,
      'license_plate',  g.license_plate,
      'started_at',     g.started_at,
      'delivery_date',  g.delivery_date,
      'dock_name',      g.dock_name,
      'kind',           g.kind,
      'current_code',   g.current_code,
      'from_code',      g.from_code,
      'level_no',       g.level_no,
      'to_code',        g.to_code,
      'to_name',        g.to_name,
      'drop_name',      g.drop_name,
      'dist_cells',     g.dist_cells,
      'n_pallets',      g.n_pallets,
      'qty_base',       g.qty_base,
      'material_codes', g.material_codes,
      'material_name',  g.material_name,
      'pallet_codes',   g.pallet_codes,
      'needs_lower',    g.needs_lower,
      'waiting_lower',  g.waiting_lower,
      'stage_done',     g.stage_done,
      'all_scanned',    g.all_scanned,
      'last_at',        g.last_at,
      'done_by_name',   COALESCE(g.moved_by, g.lowered_by),
      -- CHỈ bảng của XE CHUYỂN mới bị "chờ xe hạ" khoá (vá 20260910f).
      'can_confirm',    (NOT g.stage_done) AND (p_mode <> 'MOVE' OR NOT g.waiting_lower)
    ) ORDER BY
        g.stage_done,
        CASE WHEN p_mode = 'LOWER' THEN (NOT g.truck_idle)::int ELSE 0 END,
        g.started_at,
        CASE WHEN p_mode = 'LOWER' THEN g.dist_cells END NULLS LAST,
        CASE WHEN p_mode = 'LOWER' THEN -g.level_no END,
        g.seq
    ), '[]'::jsonb)
    INTO v_rows
    FROM grouped g;

  SELECT jsonb_build_object(
           'pending',   count(*) FILTER (WHERE t.status = 'PENDING'),
           'done',      count(*) FILTER (WHERE t.status = 'DONE'),
           'to_lower',  count(*) FILTER (WHERE t.status = 'PENDING' AND t.needs_lower AND t.lowered_at IS NULL),
           'to_move',   count(*) FILTER (WHERE t.status = 'PENDING' AND t.moved_at IS NULL
                                           AND (NOT t.needs_lower OR t.lowered_at IS NOT NULL)),
           'trips',     count(DISTINCT t.gdo_id)
         )
    INTO v_tot
    FROM public.wms_tasks t
    JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
   WHERE t.warehouse_id = p_warehouse_id AND t.status IN ('PENDING', 'DONE')
     AND g.status IN ('IN_PROGRESS', 'PAUSED')
     AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'gdo_id', x.gdo_id, 'group_code', x.group_code, 'item_id', x.item_id,
           'material_code', x.material_code_raw, 'remaining', x.remaining, 'note', x.header_text,
           'delivery_date', x.delivery_date
         ) ORDER BY x.group_code, x.material_code_raw), '[]'::jsonb)
    INTO v_alerts
    FROM (
      SELECT g.id AS gdo_id, g.group_code, g.delivery_date, i.id AS item_id, i.material_code_raw, i.header_text,
             (COALESCE(i.cartons_ordered, 0) - COALESCE(i.cartons_scanned, 0)) AS remaining
        FROM public."GroupDeliveryOrder" g
        JOIN public."OutboundDelivery"   d ON d.gdo_id = g.id
        JOIN public."OutboundItem"       i ON i.do_id  = d.id
       WHERE g.warehouse_id = p_warehouse_id
         AND g.status IN ('IN_PROGRESS', 'PAUSED')
         AND (p_gdo_id IS NULL OR g.id = p_gdo_id)
         AND i.date_rule IS NULL
         AND COALESCE(i.date_required, 0) <= 0
         AND COALESCE(i.cartons_ordered, 0) > COALESCE(i.cartons_scanned, 0)
    ) x;

  RETURN jsonb_build_object('rows', v_rows, 'totals', v_tot, 'unset_items', v_alerts);
END;
$$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260911_customer_date_rule.sql]
-- ─────────────────────────────────────────────────────────────────────────
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



-- ─────────────────────────────────────────────────────────────────────────
-- [20260911b_date_rule_lines_v2.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- MÀN CHỐT %DATE — bản 2: thêm NGUỒN quy tắc + KHÁCH HÀNG/KÊNH của chuyến (user chốt 11/09).
-- Thay 20260910g. Giữ nguyên mọi thứ cũ, THÊM:
--   · mỗi dòng: source · review · customer_name · channel · customer_known · customer_has_channel
--   · tham số p_source text[]: MANUAL | CUSTOMER | CHANNEL | SAP | UNSET | REVIEW
--   · ô band: review (cần xem vì hết tồn) · no_channel (dòng chưa chốt mà khách chưa phân kênh)
--
-- NGUỒN nằm TRONG jsonb date_rule->>'source' chứ không phải cột riêng — để nó TỰ SỐNG SÓT qua
-- `keptItemRules` của processVehicleGroups (chỗ mang %Date đã chốt vượt qua lần dội dữ liệu ngoài):
-- thêm cột thì phải sửa cả chỗ mang theo, quên một chỗ là mất nguồn âm thầm.
-- Dòng CŨ (chốt trước 11/09) không có khoá 'source' ⇒ đọc ra MANUAL — đúng, chúng đều do người chốt.
--
-- DROP trước rồi CREATE: thêm tham số mới sẽ tạo OVERLOAD, và PostgREST gọi bằng tham số có TÊN
-- nên hai bản cùng tên sẽ thành lời gọi nhập nhằng (PGRST203) đúng lúc không ai ngờ.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.outbound_date_rule_lines(date, date, text[], text, text[], text, text, int, int);

CREATE OR REPLACE FUNCTION public.outbound_date_rule_lines(
  p_from          date,
  p_to            date,
  p_scope_wh      text[] DEFAULT NULL,   -- phạm vi kho của NGƯỜI GỌI (NULL = toàn quốc)
  p_warehouse_id  text   DEFAULT NULL,   -- bộ lọc "Kho" trên màn
  p_categories    text[] DEFAULT NULL,   -- phạm vi Loại kho của người gọi (NULL = mọi loại)
  p_state         text   DEFAULT 'ALL',  -- ALL | SET (đã chốt) | UNSET (chưa chốt)
  p_search        text   DEFAULT NULL,
  p_limit         int    DEFAULT 200,
  p_offset        int    DEFAULT 0,
  p_source        text[] DEFAULT NULL    -- lọc theo NGUỒN quy tắc (rỗng/NULL = không lọc)
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  v_like  text := CASE WHEN coalesce(p_search, '') = '' THEN NULL
                       ELSE '%' || public.like_esc(lower(p_search)) || '%' END;
  v_src   text[] := CASE WHEN p_source IS NULL OR cardinality(p_source) = 0 THEN NULL ELSE p_source END;
  v_rows  jsonb;
  v_total bigint;
  v_sum   jsonb;
BEGIN
  WITH base AS (
    SELECT
      i.id                                   AS item_id,
      g.id                                   AS gdo_id,
      g.group_code, g.license_plate, g.delivery_date, g.status AS gdo_status,
      g.warehouse_id, w.name                 AS warehouse_name,
      g.warehouse_type,
      g.shipto_party,
      d.delivery_code, d.distributor_name,
      i.material_id,
      i.material_code_raw                    AS material_code,
      m.short_name                           AS material_name,
      m.units_per_carton, m.base_unit, m.entry_unit,
      i.cartons_ordered, i.cartons_scanned,
      greatest(0, coalesce(i.cartons_ordered, 0) - coalesce(i.cartons_scanned, 0)) AS remaining,
      i.header_text, i.batch_required, i.date_required, i.date_rule,
      -- ĐÃ CHỐT = có date_rule mới, HOẶC %Date yêu cầu cũ của VL06O > 0 (đọc tương thích)
      (i.date_rule IS NOT NULL OR coalesce(i.date_required, 0) > 0) AS is_set,
      -- NGUỒN: thiếu khoá 'source' trên quy tắc đã có = người chốt tay (dữ liệu trước 11/09)
      CASE WHEN i.date_rule IS NOT NULL           THEN coalesce(i.date_rule->>'source', 'MANUAL')
           WHEN coalesce(i.date_required, 0) > 0  THEN 'SAP'
           ELSE NULL END                       AS source,
      i.date_rule->>'review'                   AS review,
      c.name                                   AS customer_name,
      c.channel                                AS channel,
      (c.id IS NOT NULL)                       AS customer_known,
      (c.id IS NOT NULL AND c.channel IS NOT NULL) AS customer_has_channel
      FROM public."OutboundItem" i
      JOIN public."OutboundDelivery" d   ON d.id = i.do_id
      JOIN public."GroupDeliveryOrder" g ON g.id = d.gdo_id
      LEFT JOIN public."Warehouse" w     ON w.id = g.warehouse_id
      LEFT JOIN public."Material" m      ON m.id = i.material_id
      -- Khách hàng của chuyến: khoá là mã ship-to của SAP (99,7 % chuyến có). Không có/không khớp
      -- ⇒ customer_known = false ⇒ dòng KHÔNG BAO GIỜ được cấp %Date tự động (luật thang ưu tiên).
      LEFT JOIN public."Customer" c      ON c.ship_to_code = upper(btrim(g.shipto_party))
     WHERE g.delivery_date BETWEEN p_from AND p_to
       -- Chỉ chuyến CÒN LÀM ĐƯỢC: hoàn thành/huỷ thì chốt date không còn ý nghĩa
       AND g.status IN ('PENDING', 'PAUSED', 'IN_PROGRESS')
       AND coalesce(i.status, '') <> 'CANCELLED'
       AND (p_scope_wh IS NULL OR g.warehouse_id = ANY (p_scope_wh))
       AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
       -- Loại kho: chuyến chở LẪN mang chuỗi ghép ⇒ giao ≥ 1 (null-inclusive như mọi chỗ cắt scope)
       AND (p_categories IS NULL OR g.warehouse_type IS NULL OR public.wt_cats(g.warehouse_type) && p_categories)
  ),
  filtered AS (
    SELECT * FROM base b
     WHERE (p_state <> 'SET'   OR b.is_set)
       AND (p_state <> 'UNSET' OR NOT b.is_set)
       -- Lọc NGUỒN: UNSET và REVIEW là hai lát cắt KHÔNG phải giá trị của cột source
       AND (v_src IS NULL
            OR (b.source = ANY (v_src))
            OR ('UNSET'  = ANY (v_src) AND NOT b.is_set)
            OR ('REVIEW' = ANY (v_src) AND b.review = 'NO_STOCK'))
       AND (v_like IS NULL OR (
              lower(coalesce(b.group_code, ''))       LIKE v_like OR
              lower(coalesce(b.license_plate, ''))    LIKE v_like OR
              lower(coalesce(b.distributor_name, '')) LIKE v_like OR
              lower(coalesce(b.delivery_code, ''))    LIKE v_like OR
              lower(coalesce(b.material_code, ''))    LIKE v_like OR
              lower(coalesce(b.material_name, ''))    LIKE v_like OR
              lower(coalesce(b.customer_name, ''))    LIKE v_like OR
              lower(coalesce(b.header_text, ''))      LIKE v_like))
  )
  SELECT
    coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.delivery_date, t.group_code, t.delivery_code, t.material_code), '[]'::jsonb),
    (SELECT count(*) FROM filtered),
    (SELECT jsonb_build_object(
        'lines',      count(*),
        'set',        count(*) FILTER (WHERE is_set),
        'unset',      count(*) FILTER (WHERE NOT is_set),
        'with_note',  count(*) FILTER (WHERE coalesce(header_text, '') <> ''),
        -- CẦN XEM: máy đã áp quy tắc nhưng lúc áp kho KHÔNG còn pallet nào đạt
        'review',     count(*) FILTER (WHERE review = 'NO_STOCK'),
        -- CHƯA CHỐT vì khách chưa phân kênh (hoặc chưa có trong danh mục) — chỗ để đi khai master
        'no_channel', count(*) FILTER (WHERE NOT is_set AND NOT customer_has_channel),
        'trips',      count(DISTINCT gdo_id))
       FROM filtered)
    INTO v_rows, v_total, v_sum
    FROM (SELECT * FROM filtered
           ORDER BY delivery_date, group_code, delivery_code, material_code
           LIMIT greatest(1, least(coalesce(p_limit, 200), 1000)) OFFSET greatest(0, coalesce(p_offset, 0))) t;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total, 'summary', v_sum);
END $$;

REVOKE ALL ON FUNCTION public.outbound_date_rule_lines(date, date, text[], text, text[], text, text, int, int, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outbound_date_rule_lines(date, date, text[], text, text[], text, text, int, int, text[]) TO service_role;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260911c_date_rule_master.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- QUY ĐỊNH DATE — đợt 2 (user chốt 11/09/2026; plan: docs/plans/DATE_RULE_MASTER_V2_PLAN.md)
--
-- Đợt 1 cho mỗi khách MỘT mức (`Customer.date_rule`). Đo lại với user cho thấy mức thuộc về
-- cặp (KHÁCH × LOẠI HÀNG) và không phải lúc nào cũng diễn đạt được bằng phần trăm:
--   • FG01 hạn dùng 120–720 ngày (TB 248) · FG02 hạn dùng CHỈ 45–60 ngày (TB 50)
--   • "còn ≥ 35 ngày" = 77,8 % trên mã FG02 hạn 45 ngày, = 58,3 % trên mã hạn 60 ngày
--     ⇒ KHÔNG có con số % nào phục vụ được cả nhóm.
--   • FG02 đi kênh NPP ăn mức chung ≥ 60 % thì mã hạn 45 ngày chỉ cần còn 27 ngày là qua —
--     thiếu 8 ngày so với yêu cầu, và KHÔNG ai thấy gì sai.
--   • Mức khác nhau theo TỪNG KHÁCH: FG01 có khách 60 · 70 · 80 · 85 %; FG02 có khách 35 · 40 ngày.
--
-- Ba việc trong file này:
--   1. `date_rule_valid()` nhận thêm kiểu MIN_DAYS (còn tối thiểu N ngày).
--   2. Bảng `date_rule_master` — MỘT chỗ chứa mức cho CẢ khách lẫn kênh (cùng hình dạng sự thật
--      ⇒ hai kho chứa là hai bộ kiểm tra, hai giao diện, và sớm muộn cũng lệch nhau).
--   3. Chuyển `Customer.date_rule` + `LookupValue.meta.date_rule` sang bảng mới rồi BỎ cột cũ —
--      giữ song song là đẻ ra câu hỏi "cột nói 60 %, bảng nói 70 %, cái nào thắng".
--      Danh mục Customer đang có 3 dòng (đều do gói QA tự tạo, date_rule NULL) ⇒ đổi lúc này
--      không tốn một dòng dữ liệu nào.

-- ── 1. MIN_DAYS vào hàm kiểm tra hình dạng ────────────────────────────────────────────────────
-- CREATE OR REPLACE giữ nguyên chữ ký ⇒ mọi CHECK đang tham chiếu (OutboundItem, Customer) tự
-- dùng bản mới, không phải DROP CASCADE.
CREATE OR REPLACE FUNCTION public.date_rule_valid(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p IS NULL
      OR (p->>'kind') IN ('FEFO', 'MIN_PCT', 'MIN_DAYS', 'EXACT')
      OR (
        (p->>'kind') = 'SPLIT'
        AND jsonb_typeof(p->'parts') = 'array'
        AND jsonb_array_length(p->'parts') BETWEEN 1 AND 10
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p->'parts') e
           WHERE (e->>'kind') IS DISTINCT FROM 'FEFO'
             AND (e->>'kind') IS DISTINCT FROM 'MIN_PCT'
             AND (e->>'kind') IS DISTINCT FROM 'MIN_DAYS'
             AND (e->>'kind') IS DISTINCT FROM 'EXACT'
        )
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p->'parts') e
           WHERE CASE WHEN (e->>'qty_base') ~ '^[0-9]+(\.[0-9]+)?$'
                      THEN (e->>'qty_base')::numeric ELSE 0 END <= 0
        )
      )
$function$;

-- Hình dạng GIÁ TRỊ của một mức master — dùng chung cho CHECK của bảng dưới.
-- MIN_PCT: 0 < v ≤ 100 · MIN_DAYS: số NGUYÊN 1..3650 (10 năm — quá mốc đó là gõ nhầm, không phải
-- yêu cầu thật) · FEFO: không có value.
CREATE OR REPLACE FUNCTION public.date_rule_master_value_ok(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE (p->>'kind')
    WHEN 'FEFO'     THEN true
    WHEN 'MIN_PCT'  THEN (p->>'value') ~ '^[0-9]+(\.[0-9]+)?$'
                     AND (p->>'value')::numeric > 0 AND (p->>'value')::numeric <= 100
    WHEN 'MIN_DAYS' THEN (p->>'value') ~ '^[0-9]+$'
                     AND (p->>'value')::numeric >= 1 AND (p->>'value')::numeric <= 3650
    ELSE false
  END
$function$;

-- ── 2. Bảng mức dùng chung khách + kênh ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.date_rule_master (
  id          text PRIMARY KEY,
  scope       text NOT NULL CHECK (scope IN ('CUSTOMER', 'CHANNEL')),
  scope_key   text NOT NULL,   -- Customer.id  |  LookupValue.value của kênh
  category    text,            -- FG01 · FG02 · …  |  NULL = mọi loại hàng CÒN LẠI
  rule        jsonb NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text,
  updated_by  text,
  CONSTRAINT date_rule_master_rule_ck CHECK (
    public.date_rule_valid(rule)
    AND (rule->>'kind') IN ('FEFO', 'MIN_PCT', 'MIN_DAYS')   -- EXACT/SPLIT là quyết định của TỪNG DÒNG ĐƠN
    AND public.date_rule_master_value_ok(rule)
  ),
  CONSTRAINT date_rule_master_category_ck CHECK (
    category IS NULL OR (category ~ '^[A-Z0-9_]+$' AND length(category) <= 30)
  )
);

-- NULLS NOT DISTINCT (PG17): dòng "mọi loại hàng" (category NULL) cũng chỉ được có MỘT cho mỗi
-- khách/kênh. Thiếu mệnh đề này thì NULL luôn khác NULL ⇒ khai 5 dòng chung mà không ai chặn.
CREATE UNIQUE INDEX IF NOT EXISTS uq_date_rule_master
  ON public.date_rule_master (scope, scope_key, category) NULLS NOT DISTINCT;

-- Tra theo scope_key là đường đọc duy nhất của bộ nạp ngữ cảnh (loadPolicyCtx).
CREATE INDEX IF NOT EXISTS idx_date_rule_master_key
  ON public.date_rule_master (scope, scope_key);

-- Backend đi service_role. KHÔNG cấp quyền cho authenticated/anon và KHÔNG tạo policy —
-- luật 02/09: FE không đọc bảng nào qua Supabase, realtime đi Broadcast từ trigger.
ALTER TABLE public.date_rule_master ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.date_rule_master IS
  'Mức Quy định date theo (khách|kênh) × loại hàng. category NULL = mọi loại còn lại. Đợt 2, 11/09/2026.';

-- ── 3. Chuyển dữ liệu cũ sang rồi bỏ hai chỗ chứa cũ ──────────────────────────────────────────
-- 3a. Mức riêng của từng khách → dòng "mọi loại hàng" của khách đó.
INSERT INTO public.date_rule_master (id, scope, scope_key, category, rule, created_by, updated_by)
SELECT gen_random_uuid()::text, 'CUSTOMER', c.id, NULL, c.date_rule,
       coalesce(c.updated_by, c.created_by), coalesce(c.updated_by, c.created_by)
  FROM public."Customer" c
 WHERE c.date_rule IS NOT NULL
   AND (c.date_rule->>'kind') IN ('FEFO', 'MIN_PCT')
ON CONFLICT DO NOTHING;

-- 3b. Mức mặc định của kênh (đang có đúng 1 dòng: NPP ≥ 60 %).
INSERT INTO public.date_rule_master (id, scope, scope_key, category, rule, created_by, updated_by)
SELECT gen_random_uuid()::text, 'CHANNEL', l.value, NULL, l.meta->'date_rule',
       coalesce(l.updated_by, l.created_by), coalesce(l.updated_by, l.created_by)
  FROM public."LookupValue" l
 WHERE l.type = 'customer_channel'
   AND l.meta ? 'date_rule'
   AND (l.meta->'date_rule'->>'kind') IN ('FEFO', 'MIN_PCT')
ON CONFLICT DO NOTHING;

-- 3c. Gỡ khỏi hai chỗ cũ — một sự thật một chỗ chứa.
UPDATE public."LookupValue"
   SET meta = meta - 'date_rule', updated_at = now()
 WHERE type = 'customer_channel' AND meta ? 'date_rule';

ALTER TABLE public."Customer" DROP CONSTRAINT IF EXISTS customer_date_rule_ck;
ALTER TABLE public."Customer" DROP COLUMN IF EXISTS date_rule;

-- ── 4. Loại hàng nào khai được Quy định date ──────────────────────────────────────────────────
-- Màn khai làm MỜ loại hàng không có mã nào khai hạn dùng (đo 11/09: PM01 = 0/888 mã) và nói rõ
-- lý do, thay vì im lặng bỏ. Danh sách đọc từ DỮ LIỆU, không phải hằng số trong code — ngày nào
-- có người khai hạn dùng cho một mã POSM thì loại đó tự sáng lên.
CREATE OR REPLACE FUNCTION public.date_rule_categories()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'category'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
               'category',        m.category,
               'materials',       count(*),
               'with_shelf_life', count(*) FILTER (WHERE coalesce(m.shelf_life_days, 0) > 0)
             ) AS x
        FROM public."Material" m
       WHERE coalesce(m.is_active, true) AND m.category IS NOT NULL
       GROUP BY m.category
    ) s
$function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260911d_customer_page.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- Trang Khách hàng: MỘT lời gọi trả dòng + tổng + mức đã khai (11/09/2026, đợt 2).
--
-- Vì sao đổi khỏi cách cũ (2 truy vấn PostgREST):
--   1. Ô band đang `select(...)` KHÔNG phân trang ⇒ dính trần 1000 dòng, và cắt ÂM THẦM: danh mục
--      vượt 1.000 khách là mọi con số trên dải xanh đều sai mà không có lỗi nào nổi lên.
--      (Chính lớp lỗi đã quét cả chiến dịch 03/07 + 03/08 — xem CLAUDE.md.)
--   2. Mỗi dòng nay mang NHIỀU mức (khách × loại hàng). Đính kèm bằng một truy vấn nữa cho mỗi
--      trang là thêm round-trip trên đúng cái pool 10 khe của PostgREST.
--   3. Lọc "đã khai mức / chưa khai" không viết được bằng filter PostgREST trên bảng Customer.
--
-- Khuôn giống các hàm *_page khác: force_custom_plan (tham số NULL rất lệch nhau, generic plan sẽ
-- chọn sai kế hoạch) và CÙNG MỘT mệnh đề WHERE cho dòng lẫn tổng — viết một lần trong CTE `pick`.
-- KHÔNG dùng bảng tạm: hàm STABLE không được phép CREATE TABLE (và bảng tạm cũng phá mất khả năng
-- chạy song song).

CREATE OR REPLACE FUNCTION public.customer_page(
  p_search       text    DEFAULT NULL,
  p_channels     text[]  DEFAULT NULL,
  p_has_channel  boolean DEFAULT NULL,
  p_warehouse_id text    DEFAULT NULL,
  p_active       boolean DEFAULT NULL,
  p_has_rule     boolean DEFAULT NULL,
  p_limit        int     DEFAULT 200,
  p_offset       int     DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET plan_cache_mode = 'force_custom_plan'
AS $function$
DECLARE
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_lim    int  := greatest(1, least(500, coalesce(p_limit, 200)));
  v_off    int  := greatest(0, coalesce(p_offset, 0));
  v_res    jsonb;
BEGIN
  WITH pick AS (
    SELECT c.*
      FROM public."Customer" c
     WHERE (v_search IS NULL
            OR c.ship_to_code ILIKE '%' || public.like_esc(v_search) || '%'
            OR c.name         ILIKE '%' || public.like_esc(v_search) || '%')
       AND (p_channels IS NULL OR array_length(p_channels, 1) IS NULL OR c.channel = ANY (p_channels))
       AND (p_has_channel IS NULL OR (c.channel IS NOT NULL) = p_has_channel)
       AND (p_warehouse_id IS NULL OR c.warehouse_id = p_warehouse_id)
       AND (p_active IS NULL OR c.is_active = p_active)
       AND (p_has_rule IS NULL OR EXISTS (
              SELECT 1 FROM public.date_rule_master m
               WHERE m.scope = 'CUSTOMER' AND m.scope_key = c.id) = p_has_rule)
  ),
  -- Ô band: đếm TRÊN TOÀN BỘ LỌC (không phải trang đang xem), đếm trong SQL.
  -- "chưa khai mức" = khách không có dòng mức nào VÀ kênh của khách cũng chưa khai
  -- ⇒ đúng nghĩa "dòng hàng của khách này KHÔNG được cấp quy định date tự động".
  agg AS (
    SELECT count(*) AS total,
           jsonb_build_object(
             'total',          count(*),
             'no_channel',     count(*) FILTER (WHERE c.channel IS NULL),
             'with_warehouse', count(*) FILTER (WHERE c.warehouse_id IS NOT NULL),
             'auto_created',   count(*) FILTER (WHERE c.auto_created),
             'inactive',       count(*) FILTER (WHERE NOT c.is_active),
             'no_rule',        count(*) FILTER (
               WHERE NOT EXISTS (SELECT 1 FROM public.date_rule_master m
                                  WHERE m.scope = 'CUSTOMER' AND m.scope_key = c.id)
                 AND NOT EXISTS (SELECT 1 FROM public.date_rule_master m
                                  WHERE m.scope = 'CHANNEL' AND m.scope_key = c.channel))
           ) AS summary
      FROM pick c
  ),
  page AS (
    SELECT c.name AS o1, c.ship_to_code AS o2,
           to_jsonb(c) || jsonb_build_object(
             'rules', coalesce((
               SELECT jsonb_agg(jsonb_build_object('id', m.id, 'category', m.category, 'rule', m.rule)
                                ORDER BY m.category NULLS FIRST)
                 FROM public.date_rule_master m
                WHERE m.scope = 'CUSTOMER' AND m.scope_key = c.id), '[]'::jsonb),
             'channel_rules', coalesce((
               SELECT jsonb_agg(jsonb_build_object('category', m.category, 'rule', m.rule)
                                ORDER BY m.category NULLS FIRST)
                 FROM public.date_rule_master m
                WHERE m.scope = 'CHANNEL' AND m.scope_key = c.channel), '[]'::jsonb)
           ) AS r
      FROM pick c
     ORDER BY c.name, c.ship_to_code
     LIMIT v_lim OFFSET v_off
  )
  SELECT jsonb_build_object(
           'rows',    coalesce((SELECT jsonb_agg(p.r ORDER BY p.o1, p.o2) FROM page p), '[]'::jsonb),
           'total',   (SELECT total FROM agg),
           'summary', (SELECT summary FROM agg)
         )
    INTO v_res;

  RETURN v_res;
END;
$function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260911e_date_rule_lines_v3.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- Trang QUY ĐỊNH DATE (đổi tên từ "Chốt %Date") — bản 3, 11/09/2026 đợt 2.
--
-- Ba thay đổi:
--   1. ẨN dòng có mã KHÔNG ĐO ĐƯỢC DATE (user chốt: "màn này chỉ để xử lý cái nào yêu cầu date").
--      Hệ thống đã tự đặt "không đòi mốc" cho chúng nên không còn gì để người khai quyết. Lọc TRONG
--      SQL, không lọc ở FE — lọc ở FE thì phân trang và ô band đếm sai.
--      Vẫn giữ MỘT ô đếm `no_shelf_life` để con số không biến mất khỏi sổ sách.
--      ⚠️ "Đo được" phụ thuộc CẢ cờ định dạng tem: tem V2 (`;`) mang HSD tường minh nên mã chưa
--      khai hạn dùng vẫn đo được ngày — cắt theo mỗi shelf_life_days là cắt oan cả một đơn vị.
--   2. Trả thêm `material_category` + `shelf_life_days` — "Áp lại theo master" cần loại hàng của mã
--      để tra đúng mức (khách A: FG01 ≥ 70 %, FG02 ≥ 35 ngày).
--   3. Hai bộ lọc mới: theo LOẠI HÀNG của mã và theo KIỂU quy định (% · ngày · không đòi mốc).
--      Cờ `review` nay còn nhận BELOW_MASTER (VL06O thấp hơn mức khách khai) nên lát cắt "cần xem"
--      bắt mọi giá trị khác NULL, đừng so cứng 'NO_STOCK' (thêm cờ mới là lát cắt tự mù).

CREATE OR REPLACE FUNCTION public.outbound_date_rule_lines(
  p_from date,
  p_to date,
  p_scope_wh text[] DEFAULT NULL,
  p_warehouse_id text DEFAULT NULL,
  p_categories text[] DEFAULT NULL,
  p_state text DEFAULT 'ALL',
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0,
  p_source text[] DEFAULT NULL,
  p_mat_categories text[] DEFAULT NULL,
  p_kinds text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_like text := CASE WHEN coalesce(p_search, '') = '' THEN NULL
                      ELSE '%' || public.like_esc(lower(p_search)) || '%' END;
  v_src  text[] := CASE WHEN p_source IS NULL OR cardinality(p_source) = 0 THEN NULL ELSE p_source END;
  v_mcat text[] := CASE WHEN p_mat_categories IS NULL OR cardinality(p_mat_categories) = 0 THEN NULL ELSE p_mat_categories END;
  v_kind text[] := CASE WHEN p_kinds IS NULL OR cardinality(p_kinds) = 0 THEN NULL ELSE p_kinds END;
  -- Tem mang HSD tường minh ⇒ đo được date kể cả khi mã chưa khai hạn dùng
  v_expl boolean := coalesce(
    (SELECT s.value #>> '{}' FROM public."SystemSetting" s WHERE s.key = 'label_format') = 'semicolon',
    false);
  v_rows  jsonb;
  v_total bigint;
  v_sum   jsonb;
BEGIN
  WITH base AS (
    SELECT
      i.id                                   AS item_id,
      g.id                                   AS gdo_id,
      g.group_code, g.license_plate, g.delivery_date, g.status AS gdo_status,
      g.warehouse_id, w.name                 AS warehouse_name,
      g.warehouse_type,
      g.shipto_party,
      d.delivery_code, d.distributor_name,
      i.material_id,
      i.material_code_raw                    AS material_code,
      m.short_name                           AS material_name,
      m.units_per_carton, m.base_unit, m.entry_unit,
      m.category                             AS material_category,
      m.shelf_life_days,
      i.cartons_ordered, i.cartons_scanned,
      greatest(0, coalesce(i.cartons_ordered, 0) - coalesce(i.cartons_scanned, 0)) AS remaining,
      i.header_text, i.batch_required, i.date_required, i.date_rule,
      -- ĐÃ KHAI = có date_rule mới, HOẶC %Date yêu cầu cũ của VL06O > 0 (đọc tương thích)
      (i.date_rule IS NOT NULL OR coalesce(i.date_required, 0) > 0) AS is_set,
      -- NGUỒN: thiếu khoá 'source' trên quy tắc đã có = người khai tay (dữ liệu trước 11/09)
      CASE WHEN i.date_rule IS NOT NULL           THEN coalesce(i.date_rule->>'source', 'MANUAL')
           WHEN coalesce(i.date_required, 0) > 0  THEN 'SAP'
           ELSE NULL END                       AS source,
      -- KIỂU quy định: date_rule mới, hoặc suy từ %Date cũ của VL06O
      CASE WHEN i.date_rule IS NOT NULL          THEN i.date_rule->>'kind'
           WHEN coalesce(i.date_required, 0) > 0 THEN 'MIN_PCT'
           ELSE NULL END                       AS rule_kind,
      i.date_rule->>'review'                   AS review,
      i.date_rule->>'reason'                   AS reason,
      -- Mã này có ĐO ĐƯỢC date không (xem khối chú thích đầu file)
      (coalesce(m.shelf_life_days, 0) > 0 OR v_expl) AS measurable,
      c.name                                   AS customer_name,
      c.channel                                AS channel,
      (c.id IS NOT NULL)                       AS customer_known,
      -- "Đã có đường cấp mức tự động chưa" — khách khai riêng HOẶC kênh của khách đã khai.
      -- Bản cũ chỉ hỏi "có kênh chưa", nay mức nằm ở date_rule_master nên phải hỏi đúng chỗ đó.
      (EXISTS (SELECT 1 FROM public.date_rule_master r
                WHERE r.scope = 'CUSTOMER' AND r.scope_key = c.id)
       OR EXISTS (SELECT 1 FROM public.date_rule_master r
                   WHERE r.scope = 'CHANNEL' AND r.scope_key = c.channel)) AS customer_has_rule
      FROM public."OutboundItem" i
      JOIN public."OutboundDelivery" d   ON d.id = i.do_id
      JOIN public."GroupDeliveryOrder" g ON g.id = d.gdo_id
      LEFT JOIN public."Warehouse" w     ON w.id = g.warehouse_id
      LEFT JOIN public."Material" m      ON m.id = i.material_id
      -- Khách hàng của chuyến: khoá là mã ship-to của SAP (99,7 % chuyến có). Không có/không khớp
      -- ⇒ customer_known = false ⇒ dòng KHÔNG BAO GIỜ được cấp mức tự động (luật thang ưu tiên).
      LEFT JOIN public."Customer" c      ON c.ship_to_code = upper(btrim(g.shipto_party))
     WHERE g.delivery_date BETWEEN p_from AND p_to
       -- Chỉ chuyến CÒN LÀM ĐƯỢC: hoàn thành/huỷ thì khai date không còn ý nghĩa
       AND g.status IN ('PENDING', 'PAUSED', 'IN_PROGRESS')
       AND coalesce(i.status, '') <> 'CANCELLED'
       AND (p_scope_wh IS NULL OR g.warehouse_id = ANY (p_scope_wh))
       AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
       -- Loại kho: chuyến chở LẪN mang chuỗi ghép ⇒ giao ≥ 1 (null-inclusive như mọi chỗ cắt scope)
       AND (p_categories IS NULL OR g.warehouse_type IS NULL OR public.wt_cats(g.warehouse_type) && p_categories)
  ),
  -- Mã không đo được date: ĐẾM rồi loại khỏi bảng (đã tự có "không đòi mốc", không phải việc của
  -- người khai). Đếm TRƯỚC khi lọc, nếu không thì con số này luôn bằng 0.
  no_sl AS (SELECT count(*) AS n FROM base WHERE NOT measurable),
  shown AS (SELECT * FROM base WHERE measurable),
  filtered AS (
    SELECT * FROM shown b
     WHERE (p_state <> 'SET'   OR b.is_set)
       AND (p_state <> 'UNSET' OR NOT b.is_set)
       -- Lọc NGUỒN: UNSET và REVIEW là hai lát cắt KHÔNG phải giá trị của cột source
       AND (v_src IS NULL
            OR (b.source = ANY (v_src))
            OR ('UNSET'  = ANY (v_src) AND NOT b.is_set)
            OR ('REVIEW' = ANY (v_src) AND b.review IS NOT NULL))
       AND (v_mcat IS NULL OR b.material_category = ANY (v_mcat))
       AND (v_kind IS NULL OR b.rule_kind = ANY (v_kind))
       AND (v_like IS NULL OR (
              lower(coalesce(b.group_code, ''))       LIKE v_like OR
              lower(coalesce(b.license_plate, ''))    LIKE v_like OR
              lower(coalesce(b.distributor_name, '')) LIKE v_like OR
              lower(coalesce(b.delivery_code, ''))    LIKE v_like OR
              lower(coalesce(b.material_code, ''))    LIKE v_like OR
              lower(coalesce(b.material_name, ''))    LIKE v_like OR
              lower(coalesce(b.customer_name, ''))    LIKE v_like OR
              lower(coalesce(b.header_text, ''))      LIKE v_like))
  )
  SELECT
    coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.delivery_date, t.group_code, t.delivery_code, t.material_code), '[]'::jsonb),
    (SELECT count(*) FROM filtered),
    (SELECT jsonb_build_object(
        'lines',      count(*),
        'set',        count(*) FILTER (WHERE is_set),
        'unset',      count(*) FILTER (WHERE NOT is_set),
        'with_note',  count(*) FILTER (WHERE coalesce(header_text, '') <> ''),
        -- CẦN XEM: máy đã áp mức nhưng kho không còn pallet nào đạt, HOẶC %Date của VL06O quy ra
        -- ngày còn thấp hơn mức khách đã khai
        'review',     count(*) FILTER (WHERE review IS NOT NULL),
        -- CHƯA KHAI vì khách (và kênh của khách) chưa có mức nào — chỗ để đi khai master
        'no_channel', count(*) FILTER (WHERE NOT is_set AND NOT customer_has_rule),
        'no_shelf_life', (SELECT n FROM no_sl),
        'trips',      count(DISTINCT gdo_id))
       FROM filtered)
    INTO v_rows, v_total, v_sum
    FROM (SELECT * FROM filtered
           ORDER BY delivery_date, group_code, delivery_code, material_code
           LIMIT greatest(1, least(coalesce(p_limit, 200), 1000)) OFFSET greatest(0, coalesce(p_offset, 0))) t;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total, 'summary', v_sum);
END $function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260911f_date_rule_categories_span.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- Khoảng HẠN DÙNG của từng loại hàng — để màn khai quy đổi SỐNG lúc người ta đang gõ.
--
-- Vì sao cần: gõ "≥ 60 %" cho FG02 thì phải hiện ngay "≈ còn 27–36 ngày", vì FG02 hạn dùng chỉ
-- 45–60 ngày nên mức chung 60 % NUỐT MẤT yêu cầu 35 ngày mà không ai thấy gì sai. Không có con số
-- này thì câu cảnh báo không dựng được, và người khai chỉ phát hiện sau khi xe đã đi.

CREATE OR REPLACE FUNCTION public.date_rule_categories()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'category'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
               'category',        m.category,
               'materials',       count(*),
               'with_shelf_life', count(*) FILTER (WHERE coalesce(m.shelf_life_days, 0) > 0),
               -- Chỉ tính trên mã CÓ khai hạn dùng: mã bỏ trống kéo min về 0 thì câu quy đổi
               -- thành "≈ còn 0–36 ngày", vô nghĩa.
               'min_shelf_life',  min(m.shelf_life_days) FILTER (WHERE coalesce(m.shelf_life_days, 0) > 0),
               'max_shelf_life',  max(m.shelf_life_days) FILTER (WHERE coalesce(m.shelf_life_days, 0) > 0)
             ) AS x
        FROM public."Material" m
       WHERE coalesce(m.is_active, true) AND m.category IS NOT NULL
       GROUP BY m.category
    ) s
$function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260911g_date_rule_lines_has_channel.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- Trả LẠI cờ `customer_has_channel` cho RPC trang Quy định date (11/09, vá ngay trong ngày).
--
-- Bản v3 đổi cờ này thành `customer_has_rule` ("khách hay kênh đã khai mức chưa") vì ô band
-- "chưa được cấp tự động" nay phải hỏi đúng chỗ chứa mức. Nhưng CỘT "Khách · Kênh" trên màn vẫn
-- đọc `customer_has_channel` để biết in tên kênh hay in chữ "chưa phân kênh" — mất cờ đó thì MỌI
-- dòng đều hiện "chưa phân kênh", kể cả khách đã phân kênh đàng hoàng.
-- Phép kiểm [5d] của gói 58 bắt được ngay (has_channel=undefined). Giữ CẢ HAI cờ: chúng trả lời
-- hai câu khác nhau, và gộp làm một chính là chỗ vừa trượt.

CREATE OR REPLACE FUNCTION public.outbound_date_rule_lines(
  p_from date,
  p_to date,
  p_scope_wh text[] DEFAULT NULL,
  p_warehouse_id text DEFAULT NULL,
  p_categories text[] DEFAULT NULL,
  p_state text DEFAULT 'ALL',
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0,
  p_source text[] DEFAULT NULL,
  p_mat_categories text[] DEFAULT NULL,
  p_kinds text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_like text := CASE WHEN coalesce(p_search, '') = '' THEN NULL
                      ELSE '%' || public.like_esc(lower(p_search)) || '%' END;
  v_src  text[] := CASE WHEN p_source IS NULL OR cardinality(p_source) = 0 THEN NULL ELSE p_source END;
  v_mcat text[] := CASE WHEN p_mat_categories IS NULL OR cardinality(p_mat_categories) = 0 THEN NULL ELSE p_mat_categories END;
  v_kind text[] := CASE WHEN p_kinds IS NULL OR cardinality(p_kinds) = 0 THEN NULL ELSE p_kinds END;
  v_expl boolean := coalesce(
    (SELECT s.value #>> '{}' FROM public."SystemSetting" s WHERE s.key = 'label_format') = 'semicolon',
    false);
  v_rows  jsonb;
  v_total bigint;
  v_sum   jsonb;
BEGIN
  WITH base AS (
    SELECT
      i.id                                   AS item_id,
      g.id                                   AS gdo_id,
      g.group_code, g.license_plate, g.delivery_date, g.status AS gdo_status,
      g.warehouse_id, w.name                 AS warehouse_name,
      g.warehouse_type,
      g.shipto_party,
      d.delivery_code, d.distributor_name,
      i.material_id,
      i.material_code_raw                    AS material_code,
      m.short_name                           AS material_name,
      m.units_per_carton, m.base_unit, m.entry_unit,
      m.category                             AS material_category,
      m.shelf_life_days,
      i.cartons_ordered, i.cartons_scanned,
      greatest(0, coalesce(i.cartons_ordered, 0) - coalesce(i.cartons_scanned, 0)) AS remaining,
      i.header_text, i.batch_required, i.date_required, i.date_rule,
      (i.date_rule IS NOT NULL OR coalesce(i.date_required, 0) > 0) AS is_set,
      CASE WHEN i.date_rule IS NOT NULL           THEN coalesce(i.date_rule->>'source', 'MANUAL')
           WHEN coalesce(i.date_required, 0) > 0  THEN 'SAP'
           ELSE NULL END                       AS source,
      CASE WHEN i.date_rule IS NOT NULL          THEN i.date_rule->>'kind'
           WHEN coalesce(i.date_required, 0) > 0 THEN 'MIN_PCT'
           ELSE NULL END                       AS rule_kind,
      i.date_rule->>'review'                   AS review,
      i.date_rule->>'reason'                   AS reason,
      (coalesce(m.shelf_life_days, 0) > 0 OR v_expl) AS measurable,
      c.name                                   AS customer_name,
      c.channel                                AS channel,
      (c.id IS NOT NULL)                       AS customer_known,
      -- ĐÃ PHÂN KÊNH CHƯA — nuôi cột "Khách · Kênh" trên màn
      (c.id IS NOT NULL AND c.channel IS NOT NULL) AS customer_has_channel,
      -- ĐÃ CÓ ĐƯỜNG CẤP MỨC TỰ ĐỘNG CHƯA — khách khai riêng HOẶC kênh của khách đã khai
      (EXISTS (SELECT 1 FROM public.date_rule_master r
                WHERE r.scope = 'CUSTOMER' AND r.scope_key = c.id)
       OR EXISTS (SELECT 1 FROM public.date_rule_master r
                   WHERE r.scope = 'CHANNEL' AND r.scope_key = c.channel)) AS customer_has_rule
      FROM public."OutboundItem" i
      JOIN public."OutboundDelivery" d   ON d.id = i.do_id
      JOIN public."GroupDeliveryOrder" g ON g.id = d.gdo_id
      LEFT JOIN public."Warehouse" w     ON w.id = g.warehouse_id
      LEFT JOIN public."Material" m      ON m.id = i.material_id
      LEFT JOIN public."Customer" c      ON c.ship_to_code = upper(btrim(g.shipto_party))
     WHERE g.delivery_date BETWEEN p_from AND p_to
       AND g.status IN ('PENDING', 'PAUSED', 'IN_PROGRESS')
       AND coalesce(i.status, '') <> 'CANCELLED'
       AND (p_scope_wh IS NULL OR g.warehouse_id = ANY (p_scope_wh))
       AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
       AND (p_categories IS NULL OR g.warehouse_type IS NULL OR public.wt_cats(g.warehouse_type) && p_categories)
  ),
  no_sl AS (SELECT count(*) AS n FROM base WHERE NOT measurable),
  shown AS (SELECT * FROM base WHERE measurable),
  filtered AS (
    SELECT * FROM shown b
     WHERE (p_state <> 'SET'   OR b.is_set)
       AND (p_state <> 'UNSET' OR NOT b.is_set)
       AND (v_src IS NULL
            OR (b.source = ANY (v_src))
            OR ('UNSET'  = ANY (v_src) AND NOT b.is_set)
            OR ('REVIEW' = ANY (v_src) AND b.review IS NOT NULL))
       AND (v_mcat IS NULL OR b.material_category = ANY (v_mcat))
       AND (v_kind IS NULL OR b.rule_kind = ANY (v_kind))
       AND (v_like IS NULL OR (
              lower(coalesce(b.group_code, ''))       LIKE v_like OR
              lower(coalesce(b.license_plate, ''))    LIKE v_like OR
              lower(coalesce(b.distributor_name, '')) LIKE v_like OR
              lower(coalesce(b.delivery_code, ''))    LIKE v_like OR
              lower(coalesce(b.material_code, ''))    LIKE v_like OR
              lower(coalesce(b.material_name, ''))    LIKE v_like OR
              lower(coalesce(b.customer_name, ''))    LIKE v_like OR
              lower(coalesce(b.header_text, ''))      LIKE v_like))
  )
  SELECT
    coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.delivery_date, t.group_code, t.delivery_code, t.material_code), '[]'::jsonb),
    (SELECT count(*) FROM filtered),
    (SELECT jsonb_build_object(
        'lines',      count(*),
        'set',        count(*) FILTER (WHERE is_set),
        'unset',      count(*) FILTER (WHERE NOT is_set),
        'with_note',  count(*) FILTER (WHERE coalesce(header_text, '') <> ''),
        'review',     count(*) FILTER (WHERE review IS NOT NULL),
        'no_channel', count(*) FILTER (WHERE NOT is_set AND NOT customer_has_rule),
        'no_shelf_life', (SELECT n FROM no_sl),
        'trips',      count(DISTINCT gdo_id))
       FROM filtered)
    INTO v_rows, v_total, v_sum
    FROM (SELECT * FROM filtered
           ORDER BY delivery_date, group_code, delivery_code, material_code
           LIMIT greatest(1, least(coalesce(p_limit, 200), 1000)) OFFSET greatest(0, coalesce(p_offset, 0))) t;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total, 'summary', v_sum);
END $function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260911h_customer_seed_warehouse.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260911h — "Nạp từ dữ liệu SAP" GỢI Ý SẴN kho cho từng mã ship-to (đợt 2, §8 của plan)
--
-- Vì sao: đo staging 11/09 — 44/102 mã ship-to chờ nạp CHÍNH LÀ kho đã có trong danh mục Kho
-- (20 khớp mã kho · 24 khớp tên duy nhất · 0 khớp ship-to phụ vì 0/153 kho khai cột đó). Người nạp
-- phải tự nhận ra rồi đi trỏ kho bằng tay 44 lần, mà không trỏ thì `warehouseByShipto` trả null ⇒
-- chuyến tới kho NHÀ bị coi là khách ngoài. Nay RPC trả luôn kho khớp + KHỚP BẰNG GÌ để màn Nạp
-- hiện ra cho người xác nhận — GỢI Ý, không tự áp: cột `match_by` để người đọc còn cân được độ tin.
--
-- Khớp TÊN chỉ nhận khi tên đó là DUY NHẤT trong danh mục Kho (trùng tên nhiều kho ⇒ bỏ, không đoán)
-- — cùng luật với fallback dò tên của `maybeAutoCreateTransferOrder` (chỉ nhận khi đúng 1 kho).
-- Thứ tự ưu tiên: mã kho → ship-to phụ → tên.
--
-- Chữ ký giữ nguyên (p_days int) nên CREATE OR REPLACE chạy được, không phải DROP.

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
  ),
  -- Kho đang hoạt động + khoá so tên đã chuẩn hoá (gộp khoảng trắng, bỏ phân biệt hoa/thường)
  wh AS (
    SELECT w.id, upper(btrim(w.code)) AS code, w.name, w.inventory_mode,
           lower(btrim(regexp_replace(w.name, '\s+', ' ', 'g'))) AS name_key,
           ARRAY(SELECT upper(btrim(s)) FROM unnest(coalesce(w.shipto_codes, '{}'::text[])) s
                  WHERE btrim(s) <> '') AS sc
      FROM public."Warehouse" w
     WHERE coalesce(w.is_active, true)
  ),
  wh_name_uniq AS (SELECT name_key FROM wh GROUP BY name_key HAVING count(*) = 1)
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.trips DESC, x.erp_lines DESC, x.ship_to_code), '[]'::jsonb)
    FROM (
      SELECT m.ship_to_code, m.name, m.erp_lines, m.trips, m.last_date,
             (c.id IS NOT NULL)  AS exists_already,
             c.name              AS current_name,
             c.channel           AS current_channel,
             c.warehouse_id      AS current_warehouse_id,
             s.wh_id, s.wh_code, s.wh_name, s.wh_mode, s.match_by
        FROM merged m
        LEFT JOIN public."Customer" c ON c.ship_to_code = m.ship_to_code
        LEFT JOIN LATERAL (
          SELECT w.id AS wh_id, w.code AS wh_code, w.name AS wh_name,
                 w.inventory_mode AS wh_mode,
                 CASE WHEN w.code = m.ship_to_code     THEN 'CODE'
                      WHEN m.ship_to_code = ANY(w.sc)  THEN 'SHIPTO'
                      ELSE 'NAME' END AS match_by
            FROM wh w
           WHERE w.code = m.ship_to_code
              OR m.ship_to_code = ANY(w.sc)
              OR (w.name_key = lower(btrim(regexp_replace(m.name, '\s+', ' ', 'g')))
                  AND w.name_key IN (SELECT name_key FROM wh_name_uniq))
           ORDER BY CASE WHEN w.code = m.ship_to_code    THEN 1
                         WHEN m.ship_to_code = ANY(w.sc) THEN 2
                         ELSE 3 END
           LIMIT 1
        ) s ON true
       WHERE m.ship_to_code ~ '^[A-Z0-9]+$'
    ) x;
$$;

REVOKE ALL ON FUNCTION public.customer_seed_candidates(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_seed_candidates(int) TO service_role;

COMMENT ON FUNCTION public.customer_seed_candidates(int) IS
  'Ứng viên nạp danh mục Khách hàng (DISTINCT ship-to trong SQL) + GỢI Ý kho khớp (match_by CODE|SHIPTO|NAME, tên phải duy nhất). Gợi ý — màn Nạp cho người xác nhận từng dòng.';



-- ─────────────────────────────────────────────────────────────────────────
-- [20260911i_date_rule_lines_npp_name.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260911i — Cột "Khách hàng" màn Quy định date phải HIỆN TÊN NPP CÓ SẴN TRÊN ĐƠN (user bắt 11/09)
--
-- Triệu chứng user gửi ảnh: cả 8 dòng của 4 chuyến đều ghi "chưa có trong danh mục" trong khi đơn
-- rõ ràng có tên NPP. Nguyên nhân: `customer_name` lấy THUẦN từ danh mục (`Customer.name`), mà danh
-- mục mới có 3 dòng ⇒ gần như mọi dòng rơi về null và màn in chữ "chưa có trong danh mục" ĐÈ LÊN
-- chỗ đáng lẽ là tên. Tên NPP nằm ngay trong CTE base (`d.distributor_name`, dùng để tìm kiếm) —
-- tức màn đang có dữ liệu trong tay mà không hiện.
--
-- Người chốt date cần biết CHỐT CHO AI trước đã; "khách chưa có trong danh mục" là chú thích phụ
-- (lý do dòng này không được cấp mức tự động), không phải danh tính. Nay:
--   customer_name = tên trong danh mục NẾU CÓ, không thì tên NPP trên đơn
--   customer_known giữ nguyên ⇒ màn in thêm dòng nhỏ hổ phách bên dưới tên.
-- Chỉ đổi một biểu thức; phần còn lại của RPC giữ nguyên bản 20260911g.

CREATE OR REPLACE FUNCTION public.outbound_date_rule_lines(
  p_from date,
  p_to date,
  p_scope_wh text[] DEFAULT NULL,
  p_warehouse_id text DEFAULT NULL,
  p_categories text[] DEFAULT NULL,
  p_state text DEFAULT 'ALL',
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0,
  p_source text[] DEFAULT NULL,
  p_mat_categories text[] DEFAULT NULL,
  p_kinds text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_like text := CASE WHEN coalesce(p_search, '') = '' THEN NULL
                      ELSE '%' || public.like_esc(lower(p_search)) || '%' END;
  v_src  text[] := CASE WHEN p_source IS NULL OR cardinality(p_source) = 0 THEN NULL ELSE p_source END;
  v_mcat text[] := CASE WHEN p_mat_categories IS NULL OR cardinality(p_mat_categories) = 0 THEN NULL ELSE p_mat_categories END;
  v_kind text[] := CASE WHEN p_kinds IS NULL OR cardinality(p_kinds) = 0 THEN NULL ELSE p_kinds END;
  v_expl boolean := coalesce(
    (SELECT s.value #>> '{}' FROM public."SystemSetting" s WHERE s.key = 'label_format') = 'semicolon',
    false);
  v_rows  jsonb;
  v_total bigint;
  v_sum   jsonb;
BEGIN
  WITH base AS (
    SELECT
      i.id                                   AS item_id,
      g.id                                   AS gdo_id,
      g.group_code, g.license_plate, g.delivery_date, g.status AS gdo_status,
      g.warehouse_id, w.name                 AS warehouse_name,
      g.warehouse_type,
      g.shipto_party,
      d.delivery_code, d.distributor_name,
      i.material_id,
      i.material_code_raw                    AS material_code,
      m.short_name                           AS material_name,
      m.units_per_carton, m.base_unit, m.entry_unit,
      m.category                             AS material_category,
      m.shelf_life_days,
      i.cartons_ordered, i.cartons_scanned,
      greatest(0, coalesce(i.cartons_ordered, 0) - coalesce(i.cartons_scanned, 0)) AS remaining,
      i.header_text, i.batch_required, i.date_required, i.date_rule,
      (i.date_rule IS NOT NULL OR coalesce(i.date_required, 0) > 0) AS is_set,
      CASE WHEN i.date_rule IS NOT NULL           THEN coalesce(i.date_rule->>'source', 'MANUAL')
           WHEN coalesce(i.date_required, 0) > 0  THEN 'SAP'
           ELSE NULL END                       AS source,
      CASE WHEN i.date_rule IS NOT NULL          THEN i.date_rule->>'kind'
           WHEN coalesce(i.date_required, 0) > 0 THEN 'MIN_PCT'
           ELSE NULL END                       AS rule_kind,
      i.date_rule->>'review'                   AS review,
      i.date_rule->>'reason'                   AS reason,
      (coalesce(m.shelf_life_days, 0) > 0 OR v_expl) AS measurable,
      -- TÊN ĐỂ HIỆN: danh mục trước (đã khai thì tên khai là chuẩn), không có thì tên NPP trên đơn.
      -- Đơn LUÔN có tên NPP ⇒ cột này gần như không bao giờ còn rỗng.
      coalesce(c.name, nullif(btrim(d.distributor_name), '')) AS customer_name,
      c.channel                                AS channel,
      (c.id IS NOT NULL)                       AS customer_known,
      -- ĐÃ PHÂN KÊNH CHƯA — nuôi cột "Khách · Kênh" trên màn
      (c.id IS NOT NULL AND c.channel IS NOT NULL) AS customer_has_channel,
      -- ĐÃ CÓ ĐƯỜNG CẤP MỨC TỰ ĐỘNG CHƯA — khách khai riêng HOẶC kênh của khách đã khai
      (EXISTS (SELECT 1 FROM public.date_rule_master r
                WHERE r.scope = 'CUSTOMER' AND r.scope_key = c.id)
       OR EXISTS (SELECT 1 FROM public.date_rule_master r
                   WHERE r.scope = 'CHANNEL' AND r.scope_key = c.channel)) AS customer_has_rule
      FROM public."OutboundItem" i
      JOIN public."OutboundDelivery" d   ON d.id = i.do_id
      JOIN public."GroupDeliveryOrder" g ON g.id = d.gdo_id
      LEFT JOIN public."Warehouse" w     ON w.id = g.warehouse_id
      LEFT JOIN public."Material" m      ON m.id = i.material_id
      LEFT JOIN public."Customer" c      ON c.ship_to_code = upper(btrim(g.shipto_party))
     WHERE g.delivery_date BETWEEN p_from AND p_to
       AND g.status IN ('PENDING', 'PAUSED', 'IN_PROGRESS')
       AND coalesce(i.status, '') <> 'CANCELLED'
       AND (p_scope_wh IS NULL OR g.warehouse_id = ANY (p_scope_wh))
       AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
       AND (p_categories IS NULL OR g.warehouse_type IS NULL OR public.wt_cats(g.warehouse_type) && p_categories)
  ),
  no_sl AS (SELECT count(*) AS n FROM base WHERE NOT measurable),
  shown AS (SELECT * FROM base WHERE measurable),
  filtered AS (
    SELECT * FROM shown b
     WHERE (p_state <> 'SET'   OR b.is_set)
       AND (p_state <> 'UNSET' OR NOT b.is_set)
       AND (v_src IS NULL
            OR (b.source = ANY (v_src))
            OR ('UNSET'  = ANY (v_src) AND NOT b.is_set)
            OR ('REVIEW' = ANY (v_src) AND b.review IS NOT NULL))
       AND (v_mcat IS NULL OR b.material_category = ANY (v_mcat))
       AND (v_kind IS NULL OR b.rule_kind = ANY (v_kind))
       AND (v_like IS NULL OR (
              lower(coalesce(b.group_code, ''))       LIKE v_like OR
              lower(coalesce(b.license_plate, ''))    LIKE v_like OR
              lower(coalesce(b.distributor_name, '')) LIKE v_like OR
              lower(coalesce(b.delivery_code, ''))    LIKE v_like OR
              lower(coalesce(b.material_code, ''))    LIKE v_like OR
              lower(coalesce(b.material_name, ''))    LIKE v_like OR
              lower(coalesce(b.customer_name, ''))    LIKE v_like OR
              lower(coalesce(b.header_text, ''))      LIKE v_like))
  )
  SELECT
    coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.delivery_date, t.group_code, t.delivery_code, t.material_code), '[]'::jsonb),
    (SELECT count(*) FROM filtered),
    (SELECT jsonb_build_object(
        'lines',      count(*),
        'set',        count(*) FILTER (WHERE is_set),
        'unset',      count(*) FILTER (WHERE NOT is_set),
        'with_note',  count(*) FILTER (WHERE coalesce(header_text, '') <> ''),
        'review',     count(*) FILTER (WHERE review IS NOT NULL),
        'no_channel', count(*) FILTER (WHERE NOT is_set AND NOT customer_has_rule),
        'no_shelf_life', (SELECT n FROM no_sl),
        'trips',      count(DISTINCT gdo_id))
       FROM filtered)
    INTO v_rows, v_total, v_sum
    FROM (SELECT * FROM filtered
           ORDER BY delivery_date, group_code, delivery_code, material_code
           LIMIT greatest(1, least(coalesce(p_limit, 200), 1000)) OFFSET greatest(0, coalesce(p_offset, 0))) t;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total, 'summary', v_sum);
END $function$;

-- ─── Dọn OVERLOAD CŨ 10 tham số (bản v2 của 20260911b) ────────────────────────────────────────
-- Phát hiện khi đang kiểm bản vá trên: staging có HAI hàm cùng tên sống song song. Migration v3
-- (20260911e) DROP bản 9 tham số rồi CREATE bản 12, nên bản 10 sót lại không ai để ý.
-- Vì sao phải dọn: PostgREST chọn hàm THEO TÊN THAM SỐ trong body. Ba chỗ gọi hiện tại đều gửi đủ
-- 12 nên đang trúng bản mới — nhưng chỉ cần một lời gọi sau này quên `p_mat_categories`/`p_kinds`
-- là rơi trúng bản CŨ, và màn Quy định date lặng lẽ quay về v2: không ẩn mã không đo được date,
-- không có tên NPP, không có bộ lọc Loại hàng/Kiểu. Không lỗi, không cảnh báo — đúng lớp "hai cửa
-- cùng một sổ mà khác luật".
DROP FUNCTION IF EXISTS public.outbound_date_rule_lines(
  date, date, text[], text, text[], text, text, integer, integer, text[]);



-- ─────────────────────────────────────────────────────────────────────────
-- [20260911j_rename_wh_type_date_rule_master.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260911j — Đổi tên Loại kho phải quét CẢ `date_rule_master.category` (cột sinh ở đợt 2, 11/09)
--
-- Bất biến gói 00 bắt ra ngay lần đầu bảng này có dòng khai theo loại hàng (QA 58 chạy xong để lại
-- 2 dòng FG02 của kênh): `rename_warehouse_type` cascade theo bản đồ GHI TAY, nên cột MỚI luôn bị
-- bỏ lại — đúng lớp lỗi đã đo 15/08 với `OutboundItem.material_type` và `alert_events.category`.
--
-- Hậu quả nếu để nguyên: đổi tên một Loại kho xong, mọi mức khai riêng cho loại đó trỏ vào mã KHÔNG
-- CÒN TỒN TẠI ⇒ `resolveDateRule` không khớp dòng nào và lặng lẽ rơi về mức "mọi loại còn lại" —
-- khách đòi FG02 ≥ 35 ngày bỗng đi theo mức chung, không lỗi, không cảnh báo, không ai thấy.
--
-- Chỉ THÊM một câu UPDATE vào cascade; phần còn lại giữ nguyên bản 20260821.

CREATE OR REPLACE FUNCTION public.rename_warehouse_type(p_old text, p_new text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  counts jsonb := '{}'::jsonb;
  n bigint;
BEGIN
  p_new := btrim(p_new);
  IF p_old IS NULL OR p_new IS NULL OR p_new = '' OR p_old = p_new THEN
    RAISE EXCEPTION 'Tên mới không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = p_old) THEN
    RAISE EXCEPTION 'Loại kho "%" không tồn tại', p_old USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = p_new) THEN
    RAISE EXCEPTION 'Loại kho "%" đã tồn tại', p_new USING ERRCODE = '23505';
  END IF;

  UPDATE "LookupValue" SET value = p_new, updated_at = now()
    WHERE type = 'warehouse_type' AND value = p_old;

  UPDATE "Material" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Material', n);

  -- MẢNG (multi-loại 27/07): Location / WarehouseZone / StocktakeLog
  UPDATE "Location" SET categories = array_replace(categories, p_old, p_new)
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Location', n);

  UPDATE "WarehouseZone" SET categories = array_replace(categories, p_old, p_new)
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('WarehouseZone', n);

  UPDATE "StocktakeLog" SET categories = array_replace(categories, p_old, p_new), updated_at = now()
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('StocktakeLog', n);

  UPDATE "Employee" SET allowed_categories = array_replace(allowed_categories, p_old, p_new)
    WHERE p_old = ANY(allowed_categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Employee', n);

  UPDATE "Warehouse" SET carton_scan_categories = array_replace(carton_scan_categories, p_old, p_new)
    WHERE p_old = ANY(carton_scan_categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Warehouse', n);

  UPDATE warehouse_type_configs SET type_code = p_new, updated_at = now() WHERE type_code = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('warehouse_type_configs', n);

  UPDATE "SlotTemplate" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('SlotTemplate', n);

  UPDATE "DeliverySlot" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('DeliverySlot', n);

  UPDATE "TmsOrder" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('TmsOrder', n);

  -- Cửa đặt lịch (03/08) — giá trị ĐƠN, tách khỏi luật giao ≥1 nhưng vẫn là Loại kho
  UPDATE "TmsOrder" SET booking_category = p_new WHERE booking_category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('TmsOrder.booking_category', n);

  UPDATE khvc_lines SET booking_category = p_new WHERE booking_category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('khvc_lines', n);

  -- Chuyến chở lẫn: thay ĐÚNG phần tử trong chuỗi ghép (DISTINCT phòng khi ghép ra trùng)
  UPDATE "GroupDeliveryOrder"
     SET warehouse_type = (SELECT string_agg(DISTINCT c, '+')
                             FROM unnest(array_replace(wt_cats(warehouse_type), p_old, p_new)) c)
   WHERE wt_cats(warehouse_type) @> ARRAY[p_old];
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('GroupDeliveryOrder', n);

  -- snapshot Loại kho trên DÒNG ĐƠN XUẤT (= Material.category lúc tạo)
  UPDATE "OutboundItem" SET material_type = p_new WHERE material_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('OutboundItem', n);

  -- snapshot Loại kho trong cảnh báo vận hành
  UPDATE alert_events SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('alert_events', n);

  UPDATE gate_registrations SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('gate_registrations', n);

  UPDATE inbound_plan_lines SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('inbound_plan_lines', n);

  UPDATE "ProductionImport" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('ProductionImport', n);

  UPDATE "PalletLabelPrint" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('PalletLabelPrint', n);

  -- ⭐ MỚI 11/09 — MỨC QUY ĐỊNH DATE khai riêng theo LOẠI HÀNG (đợt 2). Sót cột này = đổi tên loại
  -- xong thì mức riêng của loại đó không khớp dòng nào và lặng lẽ rơi về mức "mọi loại còn lại".
  UPDATE date_rule_master SET category = p_new, updated_at = now() WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('date_rule_master', n);

  RETURN counts;
END;
$function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260912_drop_hr_employees_page_overload.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- DỌN OVERLOAD CHẾT: `hr_employees_page` bản CŨ 9 tham số (`p_jt_name`).
--
-- VÌ SAO: staging đang có HAI hàm cùng tên sống song song —
--   cũ:  p_scope_ids, p_dept, p_jt_name, p_wh, p_search, p_active, p_incl_deleted, p_offset, p_limit
--   mới: p_scope_ids, p_dept, p_jt_id,   p_wh, p_search, p_active, p_incl_deleted, p_status, p_offset, p_limit
-- Bản mới lọc theo ID chức danh (không so TÊN) và có thêm `p_status`. Bản cũ sót lại vì migration
-- trước dùng CREATE OR REPLACE — lệnh đó chỉ thay bản TRÙNG chữ ký, thêm/bớt tham số là ĐẺ overload.
--
-- NGUY HIỂM Ở ĐÂU: PostgREST phân giải hàm theo **TẬP TÊN THAM SỐ** trong body, không theo thứ tự.
-- Hôm nay `employeeController` gửi đủ `p_jt_id`+`p_status` nên trúng bản mới. Nhưng chỉ cần một lời
-- gọi sau này quên `p_status` là rơi trúng bản CŨ: không lỗi, không cảnh báo, màn Nhân sự lặng lẽ
-- quay về hành vi phiên bản trước (mất bộ lọc trạng thái, lọc chức danh so theo TÊN nên đổi tên chức
-- danh là hỏng âm thầm). ĐÃ DÍNH ĐÚNG LỚP LỖI NÀY 11/09 với `outbound_date_rule_lines` — màn Quy
-- định date rơi về bản cũ, mất bộ lọc, không ai thấy gì sai.
-- Overload còn rò vào `backend/src/types/database.ts`: RPC này sinh ra kiểu Args dạng UNION hai chữ ký.
--
-- AN TOÀN: đã kiểm cả backend (`grep hr_employees_page`) — chỉ MỘT nơi gọi, và gọi bằng `p_jt_id`.
-- FE không gọi RPC trực tiếp (anon/authenticated có 0 quyền EXECUTE từ 02/09).
--
-- CÁCH CHẠY: Supabase Dashboard → SQL Editor (STAGING trước, production khi cutover).
-- ============================================================================

DROP FUNCTION IF EXISTS public.hr_employees_page(
  text[],     -- p_scope_ids
  text,       -- p_dept
  text,       -- p_jt_name   ← đây là thứ phân biệt bản CŨ
  text,       -- p_wh
  text,       -- p_search
  text,       -- p_active
  boolean,    -- p_incl_deleted
  integer,    -- p_offset
  integer     -- p_limit
);

-- KIỂM SAU KHI CHẠY — phải trả về ĐÚNG 1 dòng (bản 10 tham số có p_jt_id + p_status):
--   SELECT pg_get_function_identity_arguments(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'hr_employees_page';
--
-- QUÉT ĐỊNH KỲ overload cùng loại (chỉ `unaccent` được phép có 2 bản — của extension):
--   SELECT p.proname, count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.prokind='f' GROUP BY 1 HAVING count(*) > 1;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260912b_function_overload_guard.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- LƯỚI GÁC: không hàm public nào được có NHIỀU HƠN MỘT bản (overload).
--
-- VÌ SAO (luật "bug chết hai lần" cho lớp lỗi đã cắn 2 lần):
--   • 11/09 `outbound_date_rule_lines` có 2 bản (10 và 12 tham số) — màn Quy định date lặng lẽ
--     rơi về bản cũ, mất bộ lọc, không lỗi không cảnh báo.
--   • 12/09 `hr_employees_page` có 2 bản (`p_jt_name` cũ ⟂ `p_jt_id`+`p_status` mới).
-- Gốc chung: `CREATE OR REPLACE FUNCTION` chỉ thay bản TRÙNG chữ ký; thêm/bớt một tham số là ĐẺ
-- thêm hàm chứ không thay. Và PostgREST phân giải theo **TẬP TÊN THAM SỐ** trong body, không theo
-- thứ tự — nên một lời gọi quên tham số mới là trúng bản cũ, im lặng tuyệt đối.
-- Thêm tham số có DEFAULT KHÔNG cứu được: bản cũ vẫn khớp khi lời gọi không nhắc tên tham số mới.
--
-- Trả 0 dòng = sạch. Gói QA 00-invariant gọi hàm này mỗi lượt chạy, nên lần sau ai quên DROP bản cũ
-- là ĐỎ ngay tại chỗ, không phải chờ một màn hình nào đó hỏng rồi mới đi tìm.
--
-- MIỄN TRỪ: `unaccent` — extension `unaccent` cố ý có 2 bản (text) và (regdictionary, text).
-- Thêm miễn trừ mới phải kèm lý do ở đây, đừng nới lưới trong gói QA.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.function_overloads()
 RETURNS TABLE(fn text, n bigint, chu_ky text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.proname::text,
         count(*),
         string_agg(pg_get_function_identity_arguments(p.oid), '  ||  ' ORDER BY p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prokind = 'f'
     AND p.proname <> 'unaccent'          -- của extension, hợp lệ
   GROUP BY p.proname
  HAVING count(*) > 1
   ORDER BY 1;
$function$;

REVOKE ALL ON FUNCTION public.function_overloads() FROM PUBLIC, anon, authenticated;

-- KIỂM SAU KHI CHẠY:  SELECT * FROM public.function_overloads();   -- phải 0 dòng



-- ─────────────────────────────────────────────────────────────────────────
-- [20260912c_slot_template_sunday.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- Khung giờ mẫu: MỞ CHỦ NHẬT (thứ 0).
--
-- Vì sao: giao diện tab Khung giờ (Cài đặt TMS) VỐN ĐÃ có nút "CN" kèm chú thích
-- "mặc định T2–T7; chọn CN nếu cần", nhưng cả hai cửa ghi đều từ chối thứ 0 — trước là
-- 23514 từ CHECK này, sau 07/09 là câu 400 "chỉ nhận T2..T7". Tức app MỜI người dùng
-- chọn Chủ Nhật rồi từ chối chính lựa chọn đó.
--
-- Hệ quả đo thật 12/09/2026: kho Bàu Bàng có chuyến ngày 06/09 (Chủ Nhật) — lịch đặt xe
-- ngày đó RỖNG, không phải "hết chỗ" mà là không có ô nào để chọn, và màn hình không nói
-- một lời nào. Đây là kho chạy Chủ Nhật thật (hệ số tải 0,20 nhưng vẫn có xe).
--
-- Hai chỗ sinh DeliverySlot (`generateSlotsForDates`, `reapplyFutureSlots`) vốn đã so
-- `day_of_week` với `getUTCDay()` (0 = CN) và còn ghi sẵn chú thích "CN chỉ sinh nếu có
-- template CN" — tức đường SINH đã tính tới Chủ Nhật từ đầu, chỉ có cửa VÀO là khoá.
-- Nên chỉ cần nới CHECK + nới validator, không đụng logic sinh lịch.
--
-- Quy ước giữ nguyên `getUTCDay()`: 0 = CN, 1..6 = T2..T7. KHÔNG dùng 7 cho Chủ Nhật.

ALTER TABLE public."SlotTemplate" DROP CONSTRAINT IF EXISTS "SlotTemplate_day_of_week_check";

ALTER TABLE public."SlotTemplate"
  ADD CONSTRAINT "SlotTemplate_day_of_week_check"
  CHECK (day_of_week >= 0 AND day_of_week <= 6);



-- ─────────────────────────────────────────────────────────────────────────
-- [20260912d_directed_work_roles.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260912d — Việc cần làm: CẤP QUYỀN theo chức danh + TRANG MỞ ĐẦU theo chức danh
-- ============================================================================
-- Đo 12/09 (staging): 0/9 chức danh kho có quyền `directed_work` — Lái xe nâng (17 người) và
-- Thủ kho TP (9 người) KHÔNG THẤY mục "Việc cần làm" trên menu; nút "✓ Xong" không ai bấm được.
-- Tính năng ra máy 10/09 mà chưa người dùng thật nào tới được.
--
-- Cấp theo NĂNG LỰC ĐÃ CÓ của chức danh, KHÔNG so TÊN tiếng Việt (ratchet `role_by_vietnamese_name`):
--   • có outbound.prepare / outbound.scan / loosepicking.scan → directed_work.view
--     (ai đang được soạn hàng hay quét xuất thì phải thấy kế hoạch lấy hàng)
--   • có outbound.prepare (vai soạn hàng = xe nâng, thủ kho)  → + confirm (bấm ✓ Xong)
--   • có outbound.assign  (giám sát / quản lý kho)          → + replan (sắp lại kế hoạch)
-- CHỈ điền cho chức danh CHƯA có key `directed_work` — admin đã tự cấp/gỡ thì không đè.
--
-- Trang mở đầu: `JobTitle.landing_page` (NULL = Tổng quan như cũ). Chức danh được ✓ Xong mà KHÔNG
-- quét xuất, KHÔNG giao việc (= lái xe nâng thuần) → mở app rơi thẳng vào Việc cần làm: đăng nhập
-- → Dashboard KPI toàn công ty → menu → Việc cần làm là 3 chạm cho một màn không liên quan tới họ.
-- FE chỉ chuyển hướng khi người đó THỰC SỰ có quyền vào trang đích (không tạo vòng lặp điều hướng).
-- ============================================================================
-- [cutover] gỡ: BEGIN;

ALTER TABLE public."JobTitle" ADD COLUMN IF NOT EXISTS landing_page text;
ALTER TABLE public."JobTitle" DROP CONSTRAINT IF EXISTS "JobTitle_landing_page_check";
ALTER TABLE public."JobTitle"
  ADD CONSTRAINT "JobTitle_landing_page_check"
  CHECK (landing_page IS NULL OR landing_page ~ '^/[a-z0-9/_-]{1,80}$');
COMMENT ON COLUMN public."JobTitle".landing_page IS
  'Trang mở đầu sau đăng nhập cho chức danh này (NULL = Tổng quan). FE chỉ chuyển hướng khi user có quyền vào trang đó.';

-- Cấp quyền directed_work theo năng lực sẵn có
WITH src AS (
  SELECT id, COALESCE(module_permissions, '{}'::jsonb) AS mp FROM public."JobTitle"
), grant_rows AS (
  SELECT id,
         to_jsonb(
           ARRAY['view']
           || CASE WHEN mp->'outbound' ? 'prepare' THEN ARRAY['confirm'] ELSE ARRAY[]::text[] END
           || CASE WHEN mp->'outbound' ? 'assign'  THEN ARRAY['replan']  ELSE ARRAY[]::text[] END
         ) AS dw
    FROM src
   WHERE mp->'directed_work' IS NULL
     AND ((mp->'outbound' ? 'prepare') OR (mp->'outbound' ? 'scan') OR (mp->'loosepicking' ? 'scan'))
)
UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(COALESCE(j.module_permissions, '{}'::jsonb), '{directed_work}', g.dw, true),
       updated_at = now()
  FROM grant_rows g
 WHERE g.id = j.id;

-- Trang mở đầu cho lái xe nâng thuần (được ✓ Xong, không quét xuất, không giao việc)
UPDATE public."JobTitle"
   SET landing_page = '/wms/directed', updated_at = now()
 WHERE landing_page IS NULL
   AND COALESCE(module_permissions, '{}'::jsonb)->'directed_work' ? 'confirm'
   AND NOT (COALESCE(module_permissions, '{}'::jsonb)->'outbound' ? 'scan')
   AND NOT (COALESCE(module_permissions, '{}'::jsonb)->'outbound' ? 'assign');

-- Gác: sau backfill, mọi chức danh có quyền quét xuất / soạn hàng đều thấy được Việc cần làm
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public."JobTitle"
   WHERE ((COALESCE(module_permissions,'{}')->'outbound' ? 'prepare')
       OR (COALESCE(module_permissions,'{}')->'outbound' ? 'scan'))
     AND NOT (COALESCE(module_permissions,'{}')->'directed_work' ? 'view');
  IF n > 0 THEN RAISE EXCEPTION 'còn % chức danh soạn/quét xuất mà không thấy Việc cần làm', n; END IF;
END $$;

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260912e_directed_board_skipped_partial.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260912e — Việc cần làm: bảng trả cả việc BỊ BỎ (kèm lý do) + số lượng pallet lấy MỘT PHẦN
-- ============================================================================
-- Hai lỗ đo được khi đóng vai người dùng (12/09):
--   1. Việc SKIPPED biến mất khỏi bảng không một lời. Thủ kho quét pallet KHÁC kế hoạch ⇒ việc bị bỏ
--      (OTHER_PALLET) và rơi khỏi bảng — xe hạ ĐÃ hạ pallet đó xuống thì không biết vì sao hàng mình
--      vừa hạ không còn ai nhắc (dữ liệu nạp: 115/212 việc thuộc lớp này). Nay trả thêm SKIPPED của
--      chuyến ĐANG CHẠY kèm `skip_reason`; FE gạch xám + nói lý do; chuyến kết thúc thì tự hết.
--   2. Pallet lấy MỘT PHẦN: RPC có `qty_base` nhưng bảng "Sắp quét" chỉ in "1 pallet · mã" — thủ kho
--      không biết lấy 20 thùng hay cả pallet. Nay trả `is_partial` + đơn vị của mã để FE in `qtyLabel`.
-- Cùng chữ ký (4 tham số) ⇒ CREATE OR REPLACE thay đúng bản cũ, không đẻ overload (gói 00 gác).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.directed_board(
  p_warehouse_id text,
  p_mode         text,
  p_gdo_id       text DEFAULT NULL,
  p_driver_id    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_rows   jsonb;
  v_tot    jsonb;
  v_alerts jsonb;
BEGIN
  WITH base AS (
    SELECT t.*,
           g.group_code, g.license_plate, g.status AS gdo_status, g.started_at,
           g.delivery_date,
           g.forklift_driver_ids, g.dock_location_id AS gdo_dock_id,
           fl.location_code AS from_code,
           dl.location_code AS drop_code, dl.row AS drop_name,
           tl.location_code AS to_code,   tl.row AS to_name,
           dk.row           AS dock_name,
           m.short_name     AS material_name,
           m.units_per_carton, m.entry_unit, m.base_unit,
           CASE
             WHEN t.lowered_at IS NULL           THEN fl.location_code
             WHEN t.kind = 'LOOSE_FEED'          THEN tl.location_code
             ELSE COALESCE(dl.location_code, fl.location_code)
           END AS current_code,
           (t.needs_lower AND t.lowered_at IS NULL AND t.status = 'PENDING') AS waiting_lower,
           (t.status = 'SKIPPED') AS skipped
      FROM public.wms_tasks t
      JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
      LEFT JOIN public."Location" fl ON fl.id = t.from_location_id
      LEFT JOIN public."Location" dl ON dl.id = t.drop_location_id
      LEFT JOIN public."Location" tl ON tl.id = t.to_location_id
      LEFT JOIN public."Location" dk ON dk.id = g.dock_location_id
      LEFT JOIN public."Material"  m  ON m.id  = t.material_id
     WHERE t.warehouse_id = p_warehouse_id
       AND t.status IN ('PENDING', 'DONE', 'SKIPPED')
       AND g.status IN ('IN_PROGRESS', 'PAUSED')
       AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id)
  ),
  gdo_flag AS (
    SELECT gdo_id,
           bool_and(NOT (status = 'PENDING' AND NOT waiting_lower)) AS truck_idle
      FROM base WHERE NOT skipped GROUP BY gdo_id
  ),
  filtered AS (
    SELECT b.*, COALESCE(f.truck_idle, false) AS truck_idle
      FROM base b LEFT JOIN gdo_flag f ON f.gdo_id = b.gdo_id
     WHERE CASE p_mode
             WHEN 'LOWER' THEN b.needs_lower
             WHEN 'MOVE'  THEN NOT (b.kind = 'LOOSE_FEED' AND b.needs_lower)
             ELSE true
           END
       AND (p_driver_id IS NULL OR p_driver_id = ANY (COALESCE(b.forklift_driver_ids, ARRAY[]::text[])))
  ),
  grouped AS (
    SELECT
      -- Việc bị bỏ đứng nhóm RIÊNG (đuôi |S): gom chung với việc còn treo cùng ô thì bool_and(stage_done)
      -- của nhóm đó sai và nút ✓ của nhóm biến mất.
      CASE WHEN p_mode = 'SCAN' THEN t.id
           ELSE t.gdo_id || '|' || COALESCE(t.current_code, '?') || '|' || COALESCE(t.to_code, '?') || '|' || t.kind
                || CASE WHEN t.skipped THEN '|S' ELSE '' END
      END                                        AS group_key,
      min(t.seq)                                 AS seq,
      jsonb_agg(t.id ORDER BY t.seq)             AS task_ids,
      count(*)                                   AS n_pallets,
      sum(t.qty_base)                            AS qty_base,
      bool_or(t.is_partial)                      AS is_partial,
      min(t.units_per_carton)                    AS units_per_carton,
      min(t.entry_unit)                          AS entry_unit,
      min(t.base_unit)                           AS base_unit,
      min(t.gdo_id)                              AS gdo_id,
      min(t.group_code)                          AS group_code,
      min(t.license_plate)                       AS license_plate,
      min(t.started_at)                          AS started_at,
      min(t.delivery_date)                       AS delivery_date,
      min(t.dock_name)                           AS dock_name,
      min(t.kind)                                AS kind,
      min(t.current_code)                        AS current_code,
      min(t.from_code)                           AS from_code,
      max(t.level_no)                            AS level_no,
      min(t.to_code)                             AS to_code,
      min(t.to_name)                             AS to_name,
      min(t.drop_name)                           AS drop_name,
      min(t.dist_cells)                          AS dist_cells,
      bool_or(t.needs_lower)                     AS needs_lower,
      bool_or(t.waiting_lower)                   AS waiting_lower,
      bool_or(t.truck_idle)                      AS truck_idle,
      bool_or(t.skipped)                         AS skipped,
      min(t.skip_reason)                         AS skip_reason,
      bool_and(t.status = 'DONE' OR CASE p_mode WHEN 'LOWER' THEN t.lowered_at IS NOT NULL
                                                WHEN 'MOVE'  THEN t.moved_at   IS NOT NULL
                                                ELSE t.done_at IS NOT NULL END) AS stage_done,
      bool_and(t.status = 'DONE')                AS all_scanned,
      max(COALESCE(t.done_at, t.moved_at, t.lowered_at, t.updated_at)) AS last_at,
      min(t.lowered_by)                          AS lowered_by,
      min(t.moved_by)                            AS moved_by,
      jsonb_agg(DISTINCT t.material_code)        AS material_codes,
      min(t.material_name)                       AS material_name,
      jsonb_agg(DISTINCT t.pallet_code)          AS pallet_codes
      FROM filtered t
     GROUP BY 1
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'group_key',      g.group_key,
      'task_ids',       g.task_ids,
      'seq',            g.seq,
      'gdo_id',         g.gdo_id,
      'group_code',     g.group_code,
      'license_plate',  g.license_plate,
      'started_at',     g.started_at,
      'delivery_date',  g.delivery_date,
      'dock_name',      g.dock_name,
      'kind',           g.kind,
      'current_code',   g.current_code,
      'from_code',      g.from_code,
      'level_no',       g.level_no,
      'to_code',        g.to_code,
      'to_name',        g.to_name,
      'drop_name',      g.drop_name,
      'dist_cells',     g.dist_cells,
      'n_pallets',      g.n_pallets,
      'qty_base',       g.qty_base,
      'is_partial',     g.is_partial,
      'units_per_carton', g.units_per_carton,
      'entry_unit',     g.entry_unit,
      'base_unit',      g.base_unit,
      'material_codes', g.material_codes,
      'material_name',  g.material_name,
      'pallet_codes',   g.pallet_codes,
      'needs_lower',    g.needs_lower,
      'waiting_lower',  g.waiting_lower,
      'skipped',        g.skipped,
      'skip_reason',    g.skip_reason,
      'stage_done',     g.stage_done,
      'all_scanned',    g.all_scanned,
      'last_at',        g.last_at,
      'done_by_name',   COALESCE(g.moved_by, g.lowered_by),
      -- CHỈ bảng của XE CHUYỂN mới bị "chờ xe hạ" khoá (vá 20260910f); việc đã bỏ không bấm được.
      'can_confirm',    (NOT g.stage_done) AND (NOT g.skipped) AND (p_mode <> 'MOVE' OR NOT g.waiting_lower)
    ) ORDER BY
        (g.stage_done OR g.skipped),
        g.skipped,
        CASE WHEN p_mode = 'LOWER' THEN (NOT g.truck_idle)::int ELSE 0 END,
        g.started_at,
        CASE WHEN p_mode = 'LOWER' THEN g.dist_cells END NULLS LAST,
        CASE WHEN p_mode = 'LOWER' THEN -g.level_no END,
        g.seq
    ), '[]'::jsonb)
    INTO v_rows
    FROM grouped g;

  SELECT jsonb_build_object(
           'pending',   count(*) FILTER (WHERE t.status = 'PENDING'),
           'done',      count(*) FILTER (WHERE t.status = 'DONE'),
           'skipped',   count(*) FILTER (WHERE t.status = 'SKIPPED'),
           'to_lower',  count(*) FILTER (WHERE t.status = 'PENDING' AND t.needs_lower AND t.lowered_at IS NULL),
           'to_move',   count(*) FILTER (WHERE t.status = 'PENDING' AND t.moved_at IS NULL
                                           AND (NOT t.needs_lower OR t.lowered_at IS NOT NULL)),
           'trips',     count(DISTINCT t.gdo_id) FILTER (WHERE t.status <> 'SKIPPED')
         )
    INTO v_tot
    FROM public.wms_tasks t
    JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
   WHERE t.warehouse_id = p_warehouse_id AND t.status IN ('PENDING', 'DONE', 'SKIPPED')
     AND g.status IN ('IN_PROGRESS', 'PAUSED')
     AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'gdo_id', x.gdo_id, 'group_code', x.group_code, 'item_id', x.item_id,
           'material_code', x.material_code_raw, 'remaining', x.remaining, 'note', x.header_text,
           'delivery_date', x.delivery_date
         ) ORDER BY x.group_code, x.material_code_raw), '[]'::jsonb)
    INTO v_alerts
    FROM (
      SELECT g.id AS gdo_id, g.group_code, g.delivery_date, i.id AS item_id, i.material_code_raw, i.header_text,
             (COALESCE(i.cartons_ordered, 0) - COALESCE(i.cartons_scanned, 0)) AS remaining
        FROM public."GroupDeliveryOrder" g
        JOIN public."OutboundDelivery"   d ON d.gdo_id = g.id
        JOIN public."OutboundItem"       i ON i.do_id  = d.id
       WHERE g.warehouse_id = p_warehouse_id
         AND g.status IN ('IN_PROGRESS', 'PAUSED')
         AND (p_gdo_id IS NULL OR g.id = p_gdo_id)
         AND i.date_rule IS NULL
         AND COALESCE(i.date_required, 0) <= 0
         AND COALESCE(i.cartons_ordered, 0) > COALESCE(i.cartons_scanned, 0)
    ) x;

  RETURN jsonb_build_object('rows', v_rows, 'totals', v_tot, 'unset_items', v_alerts);
END;
$$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260912f_directed_work_claim_combined.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260912f — Việc cần làm đợt B: NHẬN VIỆC (việc chung) + kho KHÔNG có xe hạ riêng
-- ============================================================================
-- Đóng vai người dùng 12/09 (plan docs/plans/DIRECTED_WORK_2_ROLE_UX_PLAN.md):
--   1. Bảng "Cần hạ" là việc CHUNG toàn kho: hai xe hạ cùng ca nhìn cùng dòng số 1 và cùng chạy tới
--      cùng ô — không có cách nói "tôi đang làm dòng này". Nay `wms_tasks.claimed_by/claimed_at` =
--      KHOÁ MỀM 10 phút: người nhận không bấm ✓ Xong trong 10' thì việc tự nhả (xe hỏng, đổi ca…),
--      không ai bị kẹt. Nhận KHÔNG chặn người khác bấm ✓ Xong (Hướng dẫn là chỉ đường, không phải rào).
--   2. Kho nhỏ / ca đêm chỉ có MỘT xe nâng vừa hạ vừa chuyển: bảng xe chuyển khoá "⏳ chờ xe hạ" trong
--      khi chính người đó là xe hạ ⇒ phải đổi tab hai lần + bấm hai lần cho MỘT pallet.
--      `Warehouse.separate_lowering_forklift` (mặc định TRUE = hành vi hiện tại). FALSE ⇒ dòng chờ hạ ở
--      bảng xe chuyển bấm được, một nút "Hạ & đưa ra" ghi cả hai mốc; tab Cần hạ ẩn.
-- RPC `directed_board` trả thêm: claimed_by · claimed_by_name · claim_active · combined_lower · settings.
-- ============================================================================
-- [cutover] gỡ: BEGIN;

ALTER TABLE public.wms_tasks
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
COMMENT ON COLUMN public.wms_tasks.claimed_by IS
  'Nhân sự (Employee.id) đã bấm "Nhận" việc chung — KHOÁ MỀM: quá 10 phút không ✓ Xong thì coi như nhả. Không chặn người khác bấm ✓ Xong. Chỉ ghi qua services/directedTasks.ts.';
CREATE INDEX IF NOT EXISTS idx_wms_tasks_claimed ON public.wms_tasks (claimed_by) WHERE claimed_by IS NOT NULL;

ALTER TABLE public."Warehouse"
  ADD COLUMN IF NOT EXISTS separate_lowering_forklift boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public."Warehouse".separate_lowering_forklift IS
  'TRUE (mặc định) = kho có xe nâng HẠ riêng: xe chuyển phải chờ xe hạ. FALSE = một xe vừa hạ vừa chuyển: bảng "Cần đưa ra" gộp hai chặng thành một nút "Hạ & đưa ra", tab Cần hạ ẩn.';

-- [cutover] gỡ: COMMIT;

CREATE OR REPLACE FUNCTION public.directed_board(
  p_warehouse_id text,
  p_mode         text,
  p_gdo_id       text DEFAULT NULL,
  p_driver_id    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_rows   jsonb;
  v_tot    jsonb;
  v_alerts jsonb;
  v_sep    boolean;
BEGIN
  SELECT COALESCE(w.separate_lowering_forklift, true) INTO v_sep
    FROM public."Warehouse" w WHERE w.id = p_warehouse_id;
  v_sep := COALESCE(v_sep, true);

  WITH base AS (
    SELECT t.*,
           g.group_code, g.license_plate, g.status AS gdo_status, g.started_at,
           g.delivery_date,
           g.forklift_driver_ids, g.dock_location_id AS gdo_dock_id,
           fl.location_code AS from_code,
           dl.location_code AS drop_code, dl.row AS drop_name,
           tl.location_code AS to_code,   tl.row AS to_name,
           dk.row           AS dock_name,
           m.short_name     AS material_name,
           m.units_per_carton, m.entry_unit, m.base_unit,
           ce.name          AS claimed_by_name,
           CASE
             WHEN t.lowered_at IS NULL           THEN fl.location_code
             WHEN t.kind = 'LOOSE_FEED'          THEN tl.location_code
             ELSE COALESCE(dl.location_code, fl.location_code)
           END AS current_code,
           (t.needs_lower AND t.lowered_at IS NULL AND t.status = 'PENDING') AS waiting_lower,
           (t.status = 'SKIPPED') AS skipped,
           -- Khoá mềm 10 phút: quá hạn coi như không ai giữ
           (t.status = 'PENDING' AND t.claimed_by IS NOT NULL
              AND t.claimed_at > now() - interval '10 minutes') AS claim_active
      FROM public.wms_tasks t
      JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
      LEFT JOIN public."Location" fl ON fl.id = t.from_location_id
      LEFT JOIN public."Location" dl ON dl.id = t.drop_location_id
      LEFT JOIN public."Location" tl ON tl.id = t.to_location_id
      LEFT JOIN public."Location" dk ON dk.id = g.dock_location_id
      LEFT JOIN public."Material"  m  ON m.id  = t.material_id
      LEFT JOIN public."Employee"  ce ON ce.id = t.claimed_by
     WHERE t.warehouse_id = p_warehouse_id
       AND t.status IN ('PENDING', 'DONE', 'SKIPPED')
       AND g.status IN ('IN_PROGRESS', 'PAUSED')
       AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id)
  ),
  gdo_flag AS (
    SELECT gdo_id,
           bool_and(NOT (status = 'PENDING' AND NOT waiting_lower)) AS truck_idle
      FROM base WHERE NOT skipped GROUP BY gdo_id
  ),
  filtered AS (
    SELECT b.*, COALESCE(f.truck_idle, false) AS truck_idle
      FROM base b LEFT JOIN gdo_flag f ON f.gdo_id = b.gdo_id
     WHERE CASE p_mode
             WHEN 'LOWER' THEN b.needs_lower
             WHEN 'MOVE'  THEN NOT (b.kind = 'LOOSE_FEED' AND b.needs_lower)
             ELSE true
           END
       AND (p_driver_id IS NULL OR p_driver_id = ANY (COALESCE(b.forklift_driver_ids, ARRAY[]::text[])))
  ),
  grouped AS (
    SELECT
      CASE WHEN p_mode = 'SCAN' THEN t.id
           ELSE t.gdo_id || '|' || COALESCE(t.current_code, '?') || '|' || COALESCE(t.to_code, '?') || '|' || t.kind
                || CASE WHEN t.skipped THEN '|S' ELSE '' END
      END                                        AS group_key,
      min(t.seq)                                 AS seq,
      jsonb_agg(t.id ORDER BY t.seq)             AS task_ids,
      count(*)                                   AS n_pallets,
      sum(t.qty_base)                            AS qty_base,
      bool_or(t.is_partial)                      AS is_partial,
      min(t.units_per_carton)                    AS units_per_carton,
      min(t.entry_unit)                          AS entry_unit,
      min(t.base_unit)                           AS base_unit,
      min(t.gdo_id)                              AS gdo_id,
      min(t.group_code)                          AS group_code,
      min(t.license_plate)                       AS license_plate,
      min(t.started_at)                          AS started_at,
      min(t.delivery_date)                       AS delivery_date,
      min(t.dock_name)                           AS dock_name,
      min(t.kind)                                AS kind,
      min(t.current_code)                        AS current_code,
      min(t.from_code)                           AS from_code,
      max(t.level_no)                            AS level_no,
      min(t.to_code)                             AS to_code,
      min(t.to_name)                             AS to_name,
      min(t.drop_name)                           AS drop_name,
      min(t.dist_cells)                          AS dist_cells,
      bool_or(t.needs_lower)                     AS needs_lower,
      bool_or(t.waiting_lower)                   AS waiting_lower,
      bool_or(t.truck_idle)                      AS truck_idle,
      bool_or(t.skipped)                         AS skipped,
      min(t.skip_reason)                         AS skip_reason,
      bool_or(t.claim_active)                    AS claim_active,
      min(t.claimed_by)      FILTER (WHERE t.claim_active) AS claimed_by,
      min(t.claimed_by_name) FILTER (WHERE t.claim_active) AS claimed_by_name,
      bool_and(t.status = 'DONE' OR CASE p_mode WHEN 'LOWER' THEN t.lowered_at IS NOT NULL
                                                WHEN 'MOVE'  THEN t.moved_at   IS NOT NULL
                                                ELSE t.done_at IS NOT NULL END) AS stage_done,
      bool_and(t.status = 'DONE')                AS all_scanned,
      max(COALESCE(t.done_at, t.moved_at, t.lowered_at, t.updated_at)) AS last_at,
      min(t.lowered_by)                          AS lowered_by,
      min(t.moved_by)                            AS moved_by,
      jsonb_agg(DISTINCT t.material_code)        AS material_codes,
      min(t.material_name)                       AS material_name,
      jsonb_agg(DISTINCT t.pallet_code)          AS pallet_codes
      FROM filtered t
     GROUP BY 1
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'group_key',      g.group_key,
      'task_ids',       g.task_ids,
      'seq',            g.seq,
      'gdo_id',         g.gdo_id,
      'group_code',     g.group_code,
      'license_plate',  g.license_plate,
      'started_at',     g.started_at,
      'delivery_date',  g.delivery_date,
      'dock_name',      g.dock_name,
      'kind',           g.kind,
      'current_code',   g.current_code,
      'from_code',      g.from_code,
      'level_no',       g.level_no,
      'to_code',        g.to_code,
      'to_name',        g.to_name,
      'drop_name',      g.drop_name,
      'dist_cells',     g.dist_cells,
      'n_pallets',      g.n_pallets,
      'qty_base',       g.qty_base,
      'is_partial',     g.is_partial,
      'units_per_carton', g.units_per_carton,
      'entry_unit',     g.entry_unit,
      'base_unit',      g.base_unit,
      'material_codes', g.material_codes,
      'material_name',  g.material_name,
      'pallet_codes',   g.pallet_codes,
      'needs_lower',    g.needs_lower,
      'waiting_lower',  g.waiting_lower,
      'skipped',        g.skipped,
      'skip_reason',    g.skip_reason,
      'claim_active',   g.claim_active,
      'claimed_by',     g.claimed_by,
      'claimed_by_name', g.claimed_by_name,
      'stage_done',     g.stage_done,
      'all_scanned',    g.all_scanned,
      'last_at',        g.last_at,
      'done_by_name',   COALESCE(g.moved_by, g.lowered_by),
      -- Kho KHÔNG có xe hạ riêng: dòng chờ hạ ở bảng xe chuyển thành MỘT việc "Hạ & đưa ra"
      'combined_lower', (p_mode = 'MOVE' AND g.waiting_lower AND NOT v_sep),
      -- CHỈ bảng của XE CHUYỂN mới bị "chờ xe hạ" khoá (vá 20260910f) — và chỉ khi kho có xe hạ riêng
      'can_confirm',    (NOT g.stage_done) AND (NOT g.skipped)
                          AND (p_mode <> 'MOVE' OR NOT g.waiting_lower OR NOT v_sep)
    ) ORDER BY
        (g.stage_done OR g.skipped),
        g.skipped,
        CASE WHEN p_mode = 'LOWER' THEN (NOT g.truck_idle)::int ELSE 0 END,
        g.started_at,
        CASE WHEN p_mode = 'LOWER' THEN g.dist_cells END NULLS LAST,
        CASE WHEN p_mode = 'LOWER' THEN -g.level_no END,
        g.seq
    ), '[]'::jsonb)
    INTO v_rows
    FROM grouped g;

  SELECT jsonb_build_object(
           'pending',   count(*) FILTER (WHERE t.status = 'PENDING'),
           'done',      count(*) FILTER (WHERE t.status = 'DONE'),
           'skipped',   count(*) FILTER (WHERE t.status = 'SKIPPED'),
           'to_lower',  count(*) FILTER (WHERE t.status = 'PENDING' AND t.needs_lower AND t.lowered_at IS NULL),
           'to_move',   count(*) FILTER (WHERE t.status = 'PENDING' AND t.moved_at IS NULL
                                           AND (NOT t.needs_lower OR t.lowered_at IS NOT NULL)),
           'trips',     count(DISTINCT t.gdo_id) FILTER (WHERE t.status <> 'SKIPPED')
         )
    INTO v_tot
    FROM public.wms_tasks t
    JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
   WHERE t.warehouse_id = p_warehouse_id AND t.status IN ('PENDING', 'DONE', 'SKIPPED')
     AND g.status IN ('IN_PROGRESS', 'PAUSED')
     AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'gdo_id', x.gdo_id, 'group_code', x.group_code, 'item_id', x.item_id,
           'material_code', x.material_code_raw, 'remaining', x.remaining, 'note', x.header_text,
           'delivery_date', x.delivery_date
         ) ORDER BY x.group_code, x.material_code_raw), '[]'::jsonb)
    INTO v_alerts
    FROM (
      SELECT g.id AS gdo_id, g.group_code, g.delivery_date, i.id AS item_id, i.material_code_raw, i.header_text,
             (COALESCE(i.cartons_ordered, 0) - COALESCE(i.cartons_scanned, 0)) AS remaining
        FROM public."GroupDeliveryOrder" g
        JOIN public."OutboundDelivery"   d ON d.gdo_id = g.id
        JOIN public."OutboundItem"       i ON i.do_id  = d.id
       WHERE g.warehouse_id = p_warehouse_id
         AND g.status IN ('IN_PROGRESS', 'PAUSED')
         AND (p_gdo_id IS NULL OR g.id = p_gdo_id)
         AND i.date_rule IS NULL
         AND COALESCE(i.date_required, 0) <= 0
         AND COALESCE(i.cartons_ordered, 0) > COALESCE(i.cartons_scanned, 0)
    ) x;

  RETURN jsonb_build_object(
    'rows', v_rows, 'totals', v_tot, 'unset_items', v_alerts,
    'settings', jsonb_build_object('separate_lowering_forklift', v_sep)
  );
END;
$$;


COMMIT;
-- === HẾT PART 6/10 ===
