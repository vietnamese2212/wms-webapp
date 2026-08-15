-- FILL HÀNG PHỤC VỤ NHẶT LẺ (user chốt 04/08).
--
-- Bài toán: nhặt lẻ lấy hàng bằng TAY nên hàng phải nằm ở tầng dưới / khu với tới được.
-- Cần bao nhiêu thì đã biết (nhặt lẻ còn lại của các chuyến trong NGÀY XUẤT); đang có bao nhiêu
-- ở tầng dưới thì trước nay KHÔNG ai tính. Migration này thêm 3 thứ:
--   1. Cờ `Location.is_pick_face` — kho tự KHAI vị trí nào là chỗ nhặt lẻ (khai hàng loạt qua
--      route /locations/bulk-flag sẵn có). Mặc định FALSE ⇒ kho chưa khai thì hành vi cũ không đổi.
--   2. Bảng `FillTask` — MỖI DÒNG = 1 PALLET phải hạ từ vị trí nguồn xuống vị trí đích, gán cho
--      1 người, xác nhận bằng QUÉT TEM (không phải bấm tay).
--   3. RPC `fill_demand` (cần/đang có/thiếu + pallet nguồn FEFO + đích gợi ý — MỘT lời gọi) và
--      `fill_report` (tỷ lệ hoàn thành theo người).
--
-- LUẬT SỐ LƯỢNG: mọi cột/tính toán ở đây là BASE UNIT. Quy đổi "thùng" chỉ ở tầng hiển thị,
-- và tổng cross-mã phải qua qty_entry_decimal per-mã TRƯỚC khi cộng (đã dùng trong fill_report).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Cờ vị trí nhặt lẻ
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS is_pick_face boolean NOT NULL DEFAULT false;

-- Lọc "vị trí nhặt lẻ của kho X" chạy trên index thay vì quét cả bảng vị trí.
CREATE INDEX IF NOT EXISTS idx_location_pick_face
  ON "Location" (warehouse_id) WHERE is_pick_face;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Bảng lệnh fill
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "FillTask" (
  id                  text PRIMARY KEY,
  warehouse_id        text        NOT NULL REFERENCES "Warehouse"(id),
  target_date         date        NOT NULL,          -- NGÀY XUẤT mà lệnh này phục vụ (ngày VN)
  material_id         text        NOT NULL REFERENCES "Material"(id),
  material_code       text,                          -- ảnh chụp lúc ra lệnh (mã có thể đổi tên sau)
  material_name       text,
  entry_id            text        NOT NULL REFERENCES "InventoryEntry"(id) ON DELETE CASCADE,
  pallet_code         text        NOT NULL,
  from_location_id    text        REFERENCES "Location"(id),
  from_location_code  text,
  to_location_id      text        NOT NULL REFERENCES "Location"(id),
  to_location_code    text,
  qty_base            numeric     NOT NULL DEFAULT 0,-- lượng BASE khả dụng trên pallet lúc ra lệnh
  status              text        NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'DONE', 'CANCELLED')),
  assignee_id         text        REFERENCES "Employee"(id),
  assignee_name       text,
  assigned_by         text,
  assigned_at         timestamptz,
  done_by             text        REFERENCES "Employee"(id),
  done_by_name        text,
  done_at             timestamptz,
  cancel_reason       text,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- CHỐNG ĐUA Ở TẦNG DB (JS check không đỡ nổi 2 người bấm cùng mili-giây): một pallet chỉ được
-- có ĐÚNG 1 lệnh đang treo. Người thua nhận 23505 → controller đổi thành 409 "pallet đã có lệnh".
CREATE UNIQUE INDEX IF NOT EXISTS uq_filltask_pending_entry
  ON "FillTask" (entry_id) WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_filltask_wh_date   ON "FillTask" (warehouse_id, target_date, status);
CREATE INDEX IF NOT EXISTS idx_filltask_assignee  ON "FillTask" (assignee_id, target_date) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_filltask_pallet    ON "FillTask" (warehouse_id, pallet_code) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_filltask_material  ON "FillTask" (warehouse_id, material_id) WHERE status = 'PENDING';

-- Realtime: màn hình "Việc của tôi" phải sáng lên ngay khi có người gán/hoàn thành, không F5.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'FillTask'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE "FillTask"';
  END IF;
END $$;

-- RLS: khoá anon như mọi bảng nghiệp vụ khác (backend đi service_role nên không ảnh hưởng).
ALTER TABLE "FillTask" ENABLE ROW LEVEL SECURITY;

-- ⚠️ BẬT RLS MÀ KHÔNG CÓ POLICY SELECT = REALTIME CHẾT CÂM.
-- Supabase Realtime phát sự kiện postgres_changes dưới quyền `authenticated`, nên RLS bật + 0
-- policy nghĩa là client KHÔNG NHẬN GÌ: bảng vẫn ghi đúng, API vẫn trả đúng, chỉ có màn hình
-- đang mở là đứng im — không lỗi, không cảnh báo (đo thật 04/08: tab thứ hai chờ 8s không nhúc
-- nhích). Mọi bảng realtime khác của app đều đã có đúng policy này.
-- Vá luôn `outbound_events` — cùng lỗi, phát hiện từ đợt kiểm 03/08 và đang làm chết feed "Thông
-- tin / lịch sử chuyến".
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='FillTask' AND policyname='rls_auth_select') THEN
    EXECUTE 'CREATE POLICY rls_auth_select ON "FillTask" FOR SELECT TO authenticated USING (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='outbound_events' AND policyname='rls_auth_select') THEN
    EXECUTE 'CREATE POLICY rls_auth_select ON outbound_events FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;

-- Soi "bảng nào KHAI BÁO cần realtime mà thực tế không nhận được" — dùng cho bất biến gói QA 00
-- (bộ QA đi qua PostgREST nên không đọc được pg_catalog trực tiếp).
CREATE OR REPLACE FUNCTION realtime_readiness() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_object_agg(t.tablename, jsonb_build_object(
           'in_pub', t.in_pub, 'rls', t.rls, 'sel_pol', t.sel_pol)), '{}'::jsonb)
  FROM (
    SELECT c.relname AS tablename,
           EXISTS (SELECT 1 FROM pg_publication_tables pt
                   WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public'
                     AND pt.tablename = c.relname) AS in_pub,
           c.relrowsecurity AS rls,
           (SELECT count(*) FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = c.relname
               AND p.cmd IN ('SELECT', 'ALL') AND p.roles::text LIKE '%authenticated%') AS sel_pol
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  ) t
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) RPC fill_demand — CẦN / ĐANG CÓ Ở TẦNG DƯỚI / THIẾU (một lời gọi duy nhất)
-- ─────────────────────────────────────────────────────────────────────────────
-- Vì sao là RPC: nếu để backend tự ghép thì mỗi mã hàng là vài request PostgREST (nhu cầu, tồn
-- pick face, pallet nguồn, sức chứa đích) — pool PostgREST ~10 khe là nút thắt của cả app.
--
-- CÔNG THỨC "CẦN" LẤY NGUYÊN CỦA loose_picking_page (nguồn sự thật DUY NHẤT của nhặt lẻ):
--   effective = loose_picking − phần xuất-thường đã vượt quota;  còn lại = effective − đã nhặt.
-- Chép công thức thứ hai ở đây thì hai màn hình sẽ lệch nhau ngay lần sửa luật kế tiếp.
--
-- QUY ƯỚC TRẠNG THÁI TỒN:
--   · dùng được để nhặt / để hạ xuống : IN_STOCK, PARTIAL, LOOSE_PICKING  (QUARANTINE đang giữ → KHÔNG)
--   · chiếm CHỖ vật lý của vị trí     : thêm cả QUARANTINE (pallet vẫn nằm đó, vẫn tốn slot)
CREATE OR REPLACE FUNCTION fill_demand(
  p_wh_scope     text[],   -- kho được giao (null = NATIONAL)
  p_cat_scope    text[],   -- loại hàng được phép (null-inclusive)
  p_warehouse_id text,
  p_date         date,
  p_max_sugg     int DEFAULT 40   -- trần pallet gợi ý mỗi mã (chặn payload phình khi thiếu cực lớn)
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  IF p_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'pick_face_locations', 0, 'error', 'NO_WAREHOUSE');
  END IF;
  -- Kho ngoài phạm vi người dùng → rỗng (không rò dữ liệu kho khác)
  IF p_wh_scope IS NOT NULL AND NOT (p_warehouse_id = ANY (p_wh_scope)) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'pick_face_locations', 0, 'error', 'OUT_OF_SCOPE');
  END IF;

  WITH it AS (   -- ① dòng hàng CÓ nhặt lẻ (điều kiện chọn-lọc nhất, áp trước)
    SELECT i.id, i.do_id, i.material_id, i.cartons_ordered, i.cartons_scanned, i.loose_picking
    FROM "OutboundItem" i
    WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
  ),
  j AS (         -- ② join ngược lên chuyến của ĐÚNG ngày + kho, áp scope
    SELECT it.material_id, it.cartons_ordered, it.cartons_scanned, it.loose_picking,
           COALESCE(ls.done, 0) AS loose_scanned
    FROM it
    JOIN "OutboundDelivery"   d ON d.id = it.do_id
    JOIN "GroupDeliveryOrder" g ON g.id = d.gdo_id AND g.status <> 'CANCELLED'
    LEFT JOIN LATERAL (
      SELECT sum(se.cartons_scanned) AS done
      FROM "OutboundScanEntry" se
      WHERE se.item_id = it.id AND se.is_loose_picking
    ) ls ON TRUE
    WHERE g.delivery_date = p_date
      AND g.warehouse_id  = p_warehouse_id
      -- chuyến bất động (chờ SAP / kế hoạch bị bỏ) chưa xuất được ⇒ chưa cần hạ hàng
      AND COALESCE(g.awaiting_sap, false) = false
      AND COALESCE(g.plan_dropped, false) = false
      -- loại hàng: chuyến chở LẪN nhiều loại ⇒ GIAO ≥1 (wt_cats), KHÔNG so nguyên chuỗi
      AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR wt_cats(g.warehouse_type) && p_cat_scope)
  ),
  dem AS (       -- ③ nhu cầu còn lại per MÃ (mirror itemLooseStats)
    SELECT material_id,
           sum(GREATEST(0,
             GREATEST(0, loose_picking - GREATEST(0, (cartons_scanned - loose_scanned)
                                                     - (cartons_ordered - loose_picking)))
             - LEAST(loose_scanned,
                     GREATEST(0, loose_picking - GREATEST(0, (cartons_scanned - loose_scanned)
                                                             - (cartons_ordered - loose_picking))))
           )) AS demand_base
    FROM j
    WHERE material_id IS NOT NULL
    GROUP BY material_id
  ),
  need0 AS (SELECT * FROM dem WHERE demand_base > 0),
  pf AS (        -- ④ ĐANG CÓ ở vị trí nhặt lẻ (trừ phần đã giữ cho chuyến khác)
    SELECT e.material_id,
           sum(GREATEST(0, e.cartons_remaining - COALESCE(e.cartons_reserved, 0))) AS pick_face_base,
           count(*) AS pick_face_pallets
    FROM "InventoryEntry" e
    JOIN "Location" l ON l.id = e.location_id
    WHERE l.warehouse_id = p_warehouse_id AND l.is_pick_face
      AND e.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') AND e.cartons_remaining > 0
      AND e.material_id IN (SELECT material_id FROM need0)
    GROUP BY e.material_id
  ),
  pend AS (      -- ⑤ lệnh fill ĐANG TREO (hàng đang trên đường xuống — đừng ra lệnh chồng)
    SELECT material_id, sum(qty_base) AS pending_base, count(*) AS pending_n
    FROM "FillTask"
    WHERE warehouse_id = p_warehouse_id AND status = 'PENDING'
      AND material_id IN (SELECT material_id FROM need0)
    GROUP BY material_id
  ),
  need AS (
    SELECT n.material_id, n.demand_base,
           COALESCE(pf.pick_face_base, 0)    AS pick_face_base,
           COALESCE(pf.pick_face_pallets, 0) AS pick_face_pallets,
           COALESCE(pd.pending_base, 0)      AS pending_base,
           COALESCE(pd.pending_n, 0)         AS pending_n,
           GREATEST(0, n.demand_base - COALESCE(pf.pick_face_base, 0) - COALESCE(pd.pending_base, 0)) AS short_base
    FROM need0 n
    LEFT JOIN pf ON pf.material_id = n.material_id
    LEFT JOIN pend pd ON pd.material_id = n.material_id
  ),
  occ AS (       -- ⑥ chỗ đã chiếm — ĐỊNH NGHĨA PHẢI KHỚP RPC move_pallets_to_location (nơi THỰC SỰ
                 -- chặn lúc quét): IN_STOCK/PARTIAL/QUARANTINE, cartons_remaining > 0. Đếm khác nơi
                 -- gác là hoặc gợi ý chỗ rồi quét báo đầy, hoặc bỏ sót chỗ còn trống.
    SELECT e.location_id, count(*) AS n
    FROM "InventoryEntry" e
    JOIN "Location" l ON l.id = e.location_id
    WHERE l.warehouse_id = p_warehouse_id
      AND e.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE') AND e.cartons_remaining > 0
    GROUP BY e.location_id
  ),
  pfl AS (       -- vị trí nhặt lẻ còn chỗ
    SELECT l.id, l.location_code, l.sub_code,
           COALESCE(l.max_pallets, 0) - COALESCE(o.n, 0) AS free
    FROM "Location" l
    LEFT JOIN occ o ON o.location_id = l.id
    WHERE l.warehouse_id = p_warehouse_id AND l.is_pick_face AND l.is_active
  ),
  pfm AS (       -- vị trí nhặt lẻ ĐANG chứa mã nào (ưu tiên dồn về cùng chỗ cho dễ nhặt)
    SELECT DISTINCT e.material_id, e.location_id
    FROM "InventoryEntry" e
    JOIN "Location" l ON l.id = e.location_id
    WHERE l.warehouse_id = p_warehouse_id AND l.is_pick_face
      AND e.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') AND e.cartons_remaining > 0
  ),
  cand0 AS (     -- ⑦ pallet nguồn: NGOÀI vị trí nhặt lẻ, còn khả dụng, chưa có lệnh treo
    SELECT e.id, e.material_id, e.pallet_code, e.location_id, l.location_code,
           GREATEST(0, e.cartons_remaining - COALESCE(e.cartons_reserved, 0)) AS avail,
           e.expiry_date, e.production_date,
           -- FEFO: HSD tường minh (tem V2) trước, không có thì suy từ NSX + hạn dùng
           COALESCE(e.expiry_date,
                    (e.production_date
                     + make_interval(days => COALESCE(e.shelf_life_days, m.shelf_life_days, 0)))::date) AS fefo_key
    FROM "InventoryEntry" e
    JOIN "Location" l ON l.id = e.location_id
    LEFT JOIN "Material" m ON m.id = e.material_id
    WHERE l.warehouse_id = p_warehouse_id AND NOT l.is_pick_face
      AND e.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') AND e.cartons_remaining > 0
      AND e.material_id IN (SELECT material_id FROM need WHERE short_base > 0)
      AND GREATEST(0, e.cartons_remaining - COALESCE(e.cartons_reserved, 0)) > 0
      AND NOT EXISTS (SELECT 1 FROM "FillTask" ft WHERE ft.entry_id = e.id AND ft.status = 'PENDING')
  ),
  cand AS (
    SELECT c.*,
           sum(c.avail) OVER (PARTITION BY c.material_id
                              ORDER BY c.fefo_key NULLS LAST, c.production_date NULLS LAST, c.id
                              ROWS UNBOUNDED PRECEDING) AS cum,
           row_number() OVER (PARTITION BY c.material_id
                              ORDER BY c.fefo_key NULLS LAST, c.production_date NULLS LAST, c.id) AS rn
    FROM cand0 c
  ),
  pick AS (      -- lấy đủ bù thiếu rồi DỪNG (tham lam theo FEFO), có trần chống payload phình
    SELECT c.* FROM cand c JOIN need n ON n.material_id = c.material_id
    WHERE c.cum - c.avail < n.short_base AND c.rn <= p_max_sugg
  )
  SELECT jsonb_build_object(
    'pick_face_locations', (SELECT count(*) FROM "Location"
                            WHERE warehouse_id = p_warehouse_id AND is_pick_face AND is_active),
    'rows', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'short_base' = '0', (x->>'short_base')::numeric DESC, x->>'material_code')
      FROM (
        SELECT jsonb_build_object(
                 'material_id',       n.material_id,
                 'material_code',     m.material_code,
                 'material_name',     m.short_name,
                 'base_unit',         m.base_unit,
                 'entry_unit',        m.entry_unit,
                 'units_per_carton',  m.units_per_carton,
                 'demand_base',       n.demand_base,
                 'pick_face_base',    n.pick_face_base,
                 'pick_face_pallets', n.pick_face_pallets,
                 'pending_base',      n.pending_base,
                 'pending_n',         n.pending_n,
                 'short_base',        n.short_base,
                 'to_location',       (SELECT jsonb_build_object('id', p.id, 'code', p.location_code)
                                       FROM pfl p
                                       LEFT JOIN pfm mm ON mm.location_id = p.id AND mm.material_id = n.material_id
                                       WHERE p.free > 0
                                       ORDER BY (mm.location_id IS NULL), p.free DESC, p.location_code
                                       LIMIT 1),
                 'suggestions',       COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                             'entry_id',           k.id,
                             'pallet_code',        k.pallet_code,
                             'from_location_id',   k.location_id,
                             'from_location_code', k.location_code,
                             'avail',              k.avail,
                             'expiry_date',        k.fefo_key)
                           ORDER BY k.rn)
                    FROM pick k WHERE k.material_id = n.material_id), '[]'::jsonb)
               ) AS x
        FROM need n
        LEFT JOIN "Material" m ON m.id = n.material_id
      ) s
    ), '[]'::jsonb)
  ) INTO r;

  RETURN r;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3b) locations_page: thêm bộ lọc "vị trí nhặt lẻ"
-- ─────────────────────────────────────────────────────────────────────────────
-- p_pick_face: NULL = không lọc · true = chỉ vị trí nhặt lẻ · false = chỉ vị trí KHÔNG nhặt lẻ.
-- Phải DROP chữ ký cũ trước: thêm tham số có DEFAULT sẽ tạo OVERLOAD, và PostgREST gọi bằng
-- tham số CÓ TÊN sẽ báo "function is not unique" khi hai bản cùng khớp.
DROP FUNCTION IF EXISTS locations_page(integer, integer, text[], text, text[], text[], boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION locations_page(
  p_offset int, p_limit int,
  p_wh_ids text[] DEFAULT NULL, p_category text DEFAULT NULL, p_scope_cats text[] DEFAULT NULL,
  p_tokens text[] DEFAULT NULL, p_flag boolean DEFAULT false, p_incl_inactive boolean DEFAULT false,
  p_with_rows boolean DEFAULT false, p_pick_face boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  result jsonb;
BEGIN
  WITH f AS (
    SELECT l.id, l.sub_code, l.row, l.shelf
    FROM "Location" l
    LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
    WHERE (p_wh_ids IS NULL OR l.warehouse_id = ANY (p_wh_ids))
      AND (p_incl_inactive OR l.is_active)
      AND (p_category IS NULL OR l.categories IS NULL OR l.categories @> ARRAY[p_category])
      AND (p_scope_cats IS NULL OR l.categories IS NULL OR l.categories && p_scope_cats)
      AND (NOT p_flag OR l.requires_stocktake)
      AND (p_pick_face IS NULL OR l.is_pick_face = p_pick_face)
      AND (p_tokens IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p_tokens) t
            WHERE position(t IN (COALESCE(l.search_norm, '') || ' ' ||
                   lower(COALESCE(array_to_string(l.categories, ' '), '') || ' ' ||
                         COALESCE(l.sub_type, '') || ' ' || COALESCE(l.row, '') || ' ' ||
                         COALESCE(l.shelf, '') || ' ' || COALESCE(w.code, '') || ' ' || COALESCE(w.name, '')))) = 0))
  ),
  pg AS (
    SELECT id, row_number() OVER (ORDER BY sub_code, row, shelf, id) rn
    FROM f ORDER BY sub_code, row, shelf, id
    LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    'ids',   COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb),
    'total', (SELECT count(*) FROM f),
    'rows',  CASE WHEN NOT p_with_rows THEN NULL ELSE COALESCE((
      SELECT jsonb_agg(to_jsonb(l)
               || jsonb_build_object(
                    'warehouse', CASE WHEN w.id IS NULL THEN NULL ELSE
                      jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name) END,
                    '_count', jsonb_build_object('inventory_entries', COALESCE(cnt.n, 0)),
                    'used_slots', COALESCE(us.n, 0),
                    'has_same_material', false)
               ORDER BY p.rn)
      FROM pg p
      JOIN "Location" l ON l.id = p.id
      LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
      LEFT JOIN LATERAL (
        SELECT count(*) n FROM "InventoryEntry" e WHERE e.location_id = l.id) cnt ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*) n FROM "InventoryEntry" e
        WHERE e.location_id = l.id AND e.stack_layer = 1
          AND e.status IN ('IN_STOCK', 'PARTIAL') AND e.cartons_remaining > 0) us ON TRUE), '[]'::jsonb) END
  ) INTO result;
  RETURN result;
END $function$;

-- locations_summary phải nhận CÙNG bộ lọc với locations_page — 4 ô SummaryBand đếm trên tập
-- ĐANG LỌC; thiếu tham số này thì lọc "Vị trí nhặt lẻ" ra 25 dòng mà ô tổng vẫn ghi 1.517.
-- (Và vì controller dùng CHUNG `locRpcParams` cho cả hai RPC, thiếu ở đây là PGRST202 → 500.)
DROP FUNCTION IF EXISTS locations_summary(text[], text, text[], text[], boolean);

CREATE OR REPLACE FUNCTION locations_summary(
  p_wh_ids text[] DEFAULT NULL, p_category text DEFAULT NULL, p_scope_cats text[] DEFAULT NULL,
  p_tokens text[] DEFAULT NULL, p_flag boolean DEFAULT false, p_pick_face boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  result jsonb;
BEGIN
  WITH f AS (   -- SummaryBand luôn tính trên vị trí ĐANG DÙNG (mirror activeFiltered của FE cũ)
    SELECT l.id, l.max_pallets
    FROM "Location" l
    LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
    WHERE (p_wh_ids IS NULL OR l.warehouse_id = ANY (p_wh_ids))
      AND l.is_active
      AND (p_category IS NULL OR l.categories IS NULL OR l.categories @> ARRAY[p_category])
      AND (p_scope_cats IS NULL OR l.categories IS NULL OR l.categories && p_scope_cats)
      AND (NOT p_flag OR l.requires_stocktake)
      AND (p_pick_face IS NULL OR l.is_pick_face = p_pick_face)
      AND (p_tokens IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p_tokens) t
            WHERE position(t IN (COALESCE(l.search_norm, '') || ' ' ||
                   lower(COALESCE(array_to_string(l.categories, ' '), '') || ' ' ||
                         COALESCE(l.sub_type, '') || ' ' || COALESCE(l.row, '') || ' ' ||
                         COALESCE(l.shelf, '') || ' ' || COALESCE(w.code, '') || ' ' || COALESCE(w.name, '')))) = 0))
  ),
  used AS (
    SELECT f.id, f.max_pallets, count(e.id) AS used_slots
    FROM f LEFT JOIN "InventoryEntry" e
      ON e.location_id = f.id AND e.stack_layer = 1
     AND e.status IN ('IN_STOCK', 'PARTIAL') AND e.cartons_remaining > 0
    GROUP BY f.id, f.max_pallets
  )
  SELECT jsonb_build_object(
    'count',    (SELECT count(*) FROM used),
    'capacity', (SELECT COALESCE(sum(max_pallets), 0) FROM used),
    'used',     (SELECT COALESCE(sum(used_slots), 0) FROM used),
    'full',     (SELECT count(*) FROM used WHERE max_pallets > 0 AND used_slots >= max_pallets)
  ) INTO result;
  RETURN result;
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3c) RPC fill_tasks_page — danh sách lệnh: DÒNG + TỔNG + 4 ô SummaryBand trong MỘT lời gọi
-- ─────────────────────────────────────────────────────────────────────────────
-- Đếm từng ô bằng một câu riêng là 4 request PostgREST cho một màn hình (pool ~10 khe).
-- `cur_*` = vị trí/khả dụng HIỆN TẠI của pallet: lệnh ra từ sáng, tới trưa pallet có thể đã bị
-- xuất hoặc bị người khác chuyển — màn hình phải nói thật thay vì hiện dữ liệu lúc ra lệnh.
CREATE OR REPLACE FUNCTION fill_tasks_page(
  p_wh_scope     text[],
  p_warehouse_id text,
  p_from         date,
  p_to           date,
  p_status       text[],
  p_assignee     text,
  p_search       text,
  p_offset       int,
  p_limit        int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE s text;
BEGIN
  IF p_wh_scope IS NOT NULL AND p_warehouse_id IS NOT NULL
     AND NOT (p_warehouse_id = ANY (p_wh_scope)) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'total', 0,
                              'pending_n', 0, 'done_n', 0, 'cancelled_n', 0, 'done_qty_entry', 0);
  END IF;
  s := CASE WHEN p_search IS NULL OR btrim(p_search) = '' THEN NULL
            ELSE lower(immutable_unaccent(btrim(p_search))) END;

  RETURN (
    -- `base` = MỌI bộ lọc TRỪ trạng thái. Bốn ô SummaryBand đếm trên base (toàn cảnh), bảng và
    -- `total` đếm trên `f` (đã lọc). Nếu đếm ô trên `f` thì lọc mặc định "Chờ làm" sẽ khiến ô
    -- "Đã hạ"/"Đã hủy" LUÔN bằng 0 — người dùng vừa hủy xong vẫn thấy "Đã hủy 0" (đo thật 04/08).
    WITH base AS (
      SELECT t.*,
             m.entry_unit, m.units_per_carton, m.base_unit,
             l.location_code AS cur_location_code,
             GREATEST(0, e.cartons_remaining - COALESCE(e.cartons_reserved, 0)) AS cur_avail,
             e.status AS entry_status
      FROM "FillTask" t
      LEFT JOIN "Material"       m ON m.id = t.material_id
      LEFT JOIN "InventoryEntry" e ON e.id = t.entry_id
      LEFT JOIN "Location"       l ON l.id = e.location_id
      WHERE (p_warehouse_id IS NULL OR t.warehouse_id = p_warehouse_id)
        AND (p_wh_scope     IS NULL OR t.warehouse_id = ANY (p_wh_scope))
        AND (p_from   IS NULL OR t.target_date >= p_from)
        AND (p_to     IS NULL OR t.target_date <= p_to)
        AND (p_assignee IS NULL OR t.assignee_id = p_assignee)
        AND (s IS NULL OR NOT EXISTS (
              SELECT 1 FROM unnest(string_to_array(s, ' ')) tok
              WHERE tok <> '' AND position(tok IN lower(immutable_unaccent(
                concat_ws(' ', t.pallet_code, t.material_code, t.material_name,
                               t.from_location_code, t.to_location_code, t.assignee_name)))) = 0))
    ),
    f AS (
      SELECT * FROM base WHERE (p_status IS NULL OR status = ANY (p_status))
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY
                 CASE x.status WHEN 'PENDING' THEN 0 WHEN 'DONE' THEN 1 ELSE 2 END,
                 x.target_date DESC, x.material_code, x.pallet_code)
        FROM (SELECT * FROM f
              ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'DONE' THEN 1 ELSE 2 END,
                       target_date DESC, material_code, pallet_code
              OFFSET GREATEST(p_offset, 0) LIMIT GREATEST(p_limit, 0)) x), '[]'::jsonb),
      'total',          (SELECT count(*) FROM f),
      'pending_n',      (SELECT count(*) FROM base WHERE status = 'PENDING'),
      'done_n',         (SELECT count(*) FROM base WHERE status = 'DONE'),
      'cancelled_n',    (SELECT count(*) FROM base WHERE status = 'CANCELLED'),
      -- tổng cross-mã ⇒ quy đổi per-mã TRƯỚC khi cộng (nhãn hiển thị: "SL (quy đổi)")
      'done_qty_entry', (SELECT COALESCE(sum(qty_entry_decimal(qty_base, entry_unit, units_per_carton)), 0)
                         FROM base WHERE status = 'DONE')
    )
  );
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) RPC fill_report — kết quả + tỷ lệ hoàn thành THEO NGƯỜI
-- ─────────────────────────────────────────────────────────────────────────────
-- Tổng SL cross-mã phải quy đổi per-mã TRƯỚC khi cộng (qty_entry_decimal) — cộng base thô rồi
-- gắn nhãn "thùng" là thổi tổng (luật BASE UNIT).
CREATE OR REPLACE FUNCTION fill_report(
  p_wh_scope     text[],
  p_warehouse_id text,
  p_from         date,
  p_to           date
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
BEGIN
  IF p_wh_scope IS NOT NULL AND p_warehouse_id IS NOT NULL
     AND NOT (p_warehouse_id = ANY (p_wh_scope)) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'total', 0, 'done', 0, 'qty_entry', 0, 'unassigned', 0);
  END IF;

  RETURN (
    WITH t AS (
      SELECT f.*, qty_entry_decimal(f.qty_base, m.entry_unit, m.units_per_carton) AS qty_entry
      FROM "FillTask" f
      LEFT JOIN "Material" m ON m.id = f.material_id
      WHERE f.status <> 'CANCELLED'
        AND (p_warehouse_id IS NULL OR f.warehouse_id = p_warehouse_id)
        AND (p_wh_scope     IS NULL OR f.warehouse_id = ANY (p_wh_scope))
        AND (p_from IS NULL OR f.target_date >= p_from)
        AND (p_to   IS NULL OR f.target_date <= p_to)
    ),
    g AS (
      SELECT COALESCE(assignee_id, '__none__')                       AS assignee_id,
             COALESCE(max(assignee_name), 'Chưa gán')                AS assignee_name,
             count(*)                                                AS total_n,
             count(*) FILTER (WHERE status = 'DONE')                 AS done_n,
             sum(qty_entry) FILTER (WHERE status = 'DONE')           AS done_qty_entry,
             sum(qty_entry)                                          AS total_qty_entry,
             avg(EXTRACT(EPOCH FROM (done_at - COALESCE(assigned_at, created_at))) / 60.0)
               FILTER (WHERE status = 'DONE' AND done_at IS NOT NULL) AS avg_minutes
      FROM t GROUP BY COALESCE(assignee_id, '__none__')
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'assignee_id',     CASE WHEN assignee_id = '__none__' THEN NULL ELSE assignee_id END,
                 'assignee_name',   assignee_name,
                 'total_n',         total_n,
                 'done_n',          done_n,
                 'pending_n',       total_n - done_n,
                 'done_qty_entry',  COALESCE(done_qty_entry, 0),
                 'total_qty_entry', COALESCE(total_qty_entry, 0),
                 'avg_minutes',     CASE WHEN avg_minutes IS NULL THEN NULL ELSE round(avg_minutes::numeric, 1) END,
                 'rate',            CASE WHEN total_n = 0 THEN 0 ELSE round(done_n::numeric * 100 / total_n, 1) END)
               ORDER BY done_n::numeric / NULLIF(total_n, 0) NULLS FIRST, total_n DESC)
               FROM g), '[]'::jsonb),
      'total',      (SELECT count(*) FROM t),
      'done',       (SELECT count(*) FROM t WHERE status = 'DONE'),
      'unassigned', (SELECT count(*) FROM t WHERE assignee_id IS NULL),
      'qty_entry',  (SELECT COALESCE(sum(qty_entry), 0) FROM t WHERE status = 'DONE')
    )
  );
END $$;
