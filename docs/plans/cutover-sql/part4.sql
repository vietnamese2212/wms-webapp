-- ══════════════════════════════════════════════════════════════════════════
-- CUTOVER production 15/08/2026 — PART4 (16 migration)
-- Dán TRỌN file này vào Supabase SQL Editor (project production svicyfquresxaigfxsdb) → Run.
-- Bọc trong 1 transaction: lỗi bất kỳ đâu là ROLLBACK toàn bộ part → sửa rồi chạy lại,
-- KHÔNG để schema dở dang. Chạy các part theo ĐÚNG THỨ TỰ part1 → part5.
-- ══════════════════════════════════════════════════════════════════════════
BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 20260804_fill_tasks.sql
-- ───────────────────────────────────────────────────────────────────────
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

-- ───────────────────────────────────────────────────────────────────────
-- 20260804b_location_flag_tristate.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260804b — Bộ lọc cờ vị trí: "Cần check hàng ngày" thành BA TRẠNG THÁI
--
-- Trước: p_flag boolean DEFAULT false, điều kiện `(NOT p_flag OR l.requires_stocktake)`
--   ⇒ chỉ có 2 nghĩa: false = không lọc · true = chỉ vị trí gắn cờ. KHÔNG lọc được
--   "vị trí CHƯA gắn cờ" — đúng cái người dùng cần khi đi khai cờ cho cả kho.
-- Sau: NULL = không lọc · true = chỉ gắn cờ · false = chỉ CHƯA gắn cờ (giống hệt p_pick_face).
--
-- CHỮ KÝ KHÔNG ĐỔI (chỉ đổi DEFAULT + thân hàm) nên CREATE OR REPLACE là đủ — không DROP,
-- không sinh overload "function is not unique" như lần thêm p_pick_face.
-- locations_page và locations_summary phải sửa CÙNG NHAU: controller dùng chung `locRpcParams`,
-- và ô SummaryBand phải đếm trên đúng tập đang lọc.

CREATE OR REPLACE FUNCTION locations_page(
  p_offset int, p_limit int,
  p_wh_ids text[] DEFAULT NULL, p_category text DEFAULT NULL, p_scope_cats text[] DEFAULT NULL,
  p_tokens text[] DEFAULT NULL, p_flag boolean DEFAULT NULL, p_incl_inactive boolean DEFAULT false,
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
      AND (p_flag IS NULL OR l.requires_stocktake = p_flag)
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

CREATE OR REPLACE FUNCTION locations_summary(
  p_wh_ids text[] DEFAULT NULL, p_category text DEFAULT NULL, p_scope_cats text[] DEFAULT NULL,
  p_tokens text[] DEFAULT NULL, p_flag boolean DEFAULT NULL, p_pick_face boolean DEFAULT NULL
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
      AND (p_flag IS NULL OR l.requires_stocktake = p_flag)
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

-- ───────────────────────────────────────────────────────────────────────
-- 20260804c_locations_zone_filter.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260804c — Bộ lọc "Khu vực kho" cho trang Vị trí kho
--
-- p_subs text[]: NULL = không lọc · ['TP1','LNVL'] = chỉ vị trí thuộc các khu đó (so `sub_code`).
-- Danh sách RỖNG trả RỖNG (ngữ nghĩa parseListParam — `?zones=` có mặt nhưng trống nghĩa là
-- "lọc ra không còn gì", không phải "bỏ lọc"): `= ANY('{}')` tự nhiên false với mọi dòng.
--
-- THÊM THAM SỐ = ĐỔI CHỮ KÝ ⇒ phải DROP bản cũ trước (bài học 20260804: để 2 bản cùng khớp,
-- PostgREST gọi theo tên báo "function is not unique"). Hai RPC sửa CÙNG NHAU vì controller
-- dùng chung `locRpcParams` và ô SummaryBand phải đếm trên đúng tập đang lọc.

DROP FUNCTION IF EXISTS locations_page(integer, integer, text[], text, text[], text[], boolean, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS locations_summary(text[], text, text[], text[], boolean, boolean);

CREATE OR REPLACE FUNCTION locations_page(
  p_offset int, p_limit int,
  p_wh_ids text[] DEFAULT NULL, p_category text DEFAULT NULL, p_scope_cats text[] DEFAULT NULL,
  p_tokens text[] DEFAULT NULL, p_flag boolean DEFAULT NULL, p_incl_inactive boolean DEFAULT false,
  p_with_rows boolean DEFAULT false, p_pick_face boolean DEFAULT NULL, p_subs text[] DEFAULT NULL
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
      AND (p_flag IS NULL OR l.requires_stocktake = p_flag)
      AND (p_pick_face IS NULL OR l.is_pick_face = p_pick_face)
      AND (p_subs IS NULL OR l.sub_code = ANY (p_subs))
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

CREATE OR REPLACE FUNCTION locations_summary(
  p_wh_ids text[] DEFAULT NULL, p_category text DEFAULT NULL, p_scope_cats text[] DEFAULT NULL,
  p_tokens text[] DEFAULT NULL, p_flag boolean DEFAULT NULL, p_pick_face boolean DEFAULT NULL,
  p_subs text[] DEFAULT NULL
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
      AND (p_flag IS NULL OR l.requires_stocktake = p_flag)
      AND (p_pick_face IS NULL OR l.is_pick_face = p_pick_face)
      AND (p_subs IS NULL OR l.sub_code = ANY (p_subs))
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

-- ───────────────────────────────────────────────────────────────────────
-- 20260805_fill_dest_category.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260805 — Fill hàng: vị trí ĐÍCH phải khớp LOẠI KHO của mã hàng (user bắt 05/08)
--
-- Lỗi: gợi ý `to_location` trong fill_demand chọn vị trí nhặt lẻ CHỈ theo "còn chỗ",
-- không so Loại kho ⇒ hàng FG02 bị đề xuất hạ về vị trí khu FG01 — sai nguyên tắc phân khu
-- (mã hàng đã phân định loại, vị trí cũng vậy).
--
-- Luật khớp = ĐÚNG khuôn app đang dùng ở picker vị trí (Tồn kho / Vị trí kho):
--   vị trí nhận mã ⇔ categories chứa loại của mã, HOẶC vị trí chưa khai loại (NULL = nhận mọi
--   hàng), HOẶC mã chưa khai loại. (null-inclusive hai chiều — không chặn oan dữ liệu chưa khai.)
--
-- CHỮ KÝ KHÔNG ĐỔI → CREATE OR REPLACE là đủ. Cùng đợt, fillController siết 4 cửa còn lại:
-- tự chọn đích khi ra lệnh, đích user chỉ định, đổi đích (PATCH), danh sách ô chọn đích.

CREATE OR REPLACE FUNCTION fill_demand(
  p_wh_scope     text[],
  p_cat_scope    text[],
  p_warehouse_id text,
  p_date         date,
  p_max_sugg     int DEFAULT 40
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  IF p_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'pick_face_locations', 0, 'error', 'NO_WAREHOUSE');
  END IF;
  IF p_wh_scope IS NOT NULL AND NOT (p_warehouse_id = ANY (p_wh_scope)) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'pick_face_locations', 0, 'error', 'OUT_OF_SCOPE');
  END IF;

  WITH it AS (
    SELECT i.id, i.do_id, i.material_id, i.cartons_ordered, i.cartons_scanned, i.loose_picking
    FROM "OutboundItem" i
    WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
  ),
  j AS (
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
      AND COALESCE(g.awaiting_sap, false) = false
      AND COALESCE(g.plan_dropped, false) = false
      AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR wt_cats(g.warehouse_type) && p_cat_scope)
  ),
  dem AS (
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
  pf AS (        -- "đang có" đếm THỰC TẾ vật lý — pallet nằm ở vị trí nhặt lẻ là nhặt được,
                 -- kể cả vị trí đó lệch loại (di sản); luật loại chỉ áp khi chọn ĐÍCH MỚI
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
  pend AS (
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
  occ AS (
    SELECT e.location_id, count(*) AS n
    FROM "InventoryEntry" e
    JOIN "Location" l ON l.id = e.location_id
    WHERE l.warehouse_id = p_warehouse_id
      AND e.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE') AND e.cartons_remaining > 0
    GROUP BY e.location_id
  ),
  pfl AS (       -- vị trí nhặt lẻ còn chỗ (mang theo categories để so LOẠI khi chọn đích)
    SELECT l.id, l.location_code, l.sub_code, l.categories,
           COALESCE(l.max_pallets, 0) - COALESCE(o.n, 0) AS free
    FROM "Location" l
    LEFT JOIN occ o ON o.location_id = l.id
    WHERE l.warehouse_id = p_warehouse_id AND l.is_pick_face AND l.is_active
  ),
  pfm AS (
    SELECT DISTINCT e.material_id, e.location_id
    FROM "InventoryEntry" e
    JOIN "Location" l ON l.id = e.location_id
    WHERE l.warehouse_id = p_warehouse_id AND l.is_pick_face
      AND e.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') AND e.cartons_remaining > 0
  ),
  cand0 AS (
    SELECT e.id, e.material_id, e.pallet_code, e.location_id, l.location_code,
           GREATEST(0, e.cartons_remaining - COALESCE(e.cartons_reserved, 0)) AS avail,
           e.expiry_date, e.production_date,
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
  pick AS (
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
                                         -- LOẠI KHO: đích phải nhận loại của mã (NULL = chưa khai → nhận mọi hàng)
                                         AND (p.categories IS NULL OR m.category IS NULL
                                              OR p.categories @> ARRAY[m.category])
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

-- ───────────────────────────────────────────────────────────────────────
-- 20260805b_fill_demand_v2.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260805b — Fill hàng v2 (user chốt 05/08, 3 việc):
--
-- (1) Mã mà kho KHÔNG có vị trí nhặt lẻ nào NHẬN LOẠI của nó ⇒ kho đó không nhặt lẻ loại này
--     → LOẠI HẲN khỏi bảng Đề xuất (vd FG02 ở kho chỉ khai vị trí nhặt lẻ FG01), không hiện
--     dòng "hết chỗ nhận loại này" gây nhiễu. Xét trên MỌI vị trí nhặt lẻ đang hoạt động
--     (kể cả đang đầy — đầy là tạm thời, không phải "không phục vụ loại này").
-- (2) fill_demand trả thêm `category` (cột + filter Loại kho trên FE) và `production_date`
--     trong từng pallet gợi ý (cột "Vị trí lấy hàng" + NSX).
-- (3) RPC MỚI `fill_candidates`: toàn bộ pallet ứng viên của MỘT mã (nguồn ngoài vị trí nhặt
--     lẻ, không QUARANTINE, trừ phần đang giữ, chưa có lệnh treo) xếp FEFO — cho dialog
--     "Chọn date": người nhặt lẻ chọn NSX họ cần từ tồn thật; không chọn = FEFO (date xa nhất).
--
-- Chữ ký fill_demand KHÔNG đổi → CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION fill_demand(
  p_wh_scope     text[],
  p_cat_scope    text[],
  p_warehouse_id text,
  p_date         date,
  p_max_sugg     int DEFAULT 40
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  IF p_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'pick_face_locations', 0, 'error', 'NO_WAREHOUSE');
  END IF;
  IF p_wh_scope IS NOT NULL AND NOT (p_warehouse_id = ANY (p_wh_scope)) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'pick_face_locations', 0, 'error', 'OUT_OF_SCOPE');
  END IF;

  WITH it AS (
    SELECT i.id, i.do_id, i.material_id, i.cartons_ordered, i.cartons_scanned, i.loose_picking
    FROM "OutboundItem" i
    WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
  ),
  j AS (
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
      AND COALESCE(g.awaiting_sap, false) = false
      AND COALESCE(g.plan_dropped, false) = false
      AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR wt_cats(g.warehouse_type) && p_cat_scope)
  ),
  dem AS (
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
  pf AS (        -- "đang có" đếm THỰC TẾ vật lý — luật loại chỉ áp khi chọn ĐÍCH MỚI
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
  pend AS (
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
  occ AS (
    SELECT e.location_id, count(*) AS n
    FROM "InventoryEntry" e
    JOIN "Location" l ON l.id = e.location_id
    WHERE l.warehouse_id = p_warehouse_id
      AND e.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE') AND e.cartons_remaining > 0
    GROUP BY e.location_id
  ),
  pfl AS (       -- vị trí nhặt lẻ đang hoạt động (mang categories để so LOẠI)
    SELECT l.id, l.location_code, l.sub_code, l.categories,
           COALESCE(l.max_pallets, 0) - COALESCE(o.n, 0) AS free
    FROM "Location" l
    LEFT JOIN occ o ON o.location_id = l.id
    WHERE l.warehouse_id = p_warehouse_id AND l.is_pick_face AND l.is_active
  ),
  pfm AS (
    SELECT DISTINCT e.material_id, e.location_id
    FROM "InventoryEntry" e
    JOIN "Location" l ON l.id = e.location_id
    WHERE l.warehouse_id = p_warehouse_id AND l.is_pick_face
      AND e.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') AND e.cartons_remaining > 0
  ),
  cand0 AS (
    SELECT e.id, e.material_id, e.pallet_code, e.location_id, l.location_code,
           GREATEST(0, e.cartons_remaining - COALESCE(e.cartons_reserved, 0)) AS avail,
           e.expiry_date, e.production_date,
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
  pick AS (
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
                 'category',          m.category,
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
                                         AND (p.categories IS NULL OR m.category IS NULL
                                              OR p.categories @> ARRAY[m.category])
                                       ORDER BY (mm.location_id IS NULL), p.free DESC, p.location_code
                                       LIMIT 1),
                 'suggestions',       COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                             'entry_id',           k.id,
                             'pallet_code',        k.pallet_code,
                             'from_location_id',   k.location_id,
                             'from_location_code', k.location_code,
                             'avail',              k.avail,
                             'production_date',    k.production_date,
                             'expiry_date',        k.fefo_key)
                           ORDER BY k.rn)
                    FROM pick k WHERE k.material_id = n.material_id), '[]'::jsonb)
               ) AS x
        FROM need n
        LEFT JOIN "Material" m ON m.id = n.material_id
        -- (1) Kho không có vị trí nhặt lẻ nào NHẬN LOẠI của mã ⇒ kho không nhặt lẻ loại này —
        -- loại khỏi tính toán. Xét trên MỌI vị trí đang hoạt động, KHÔNG lọc "còn chỗ"
        -- (đầy là tạm thời — mã vẫn phục vụ được, chỉ là chưa có chỗ NGAY BÂY GIỜ).
        WHERE EXISTS (SELECT 1 FROM pfl p
                      WHERE p.categories IS NULL OR m.category IS NULL
                         OR p.categories @> ARRAY[m.category])
      ) s
    ), '[]'::jsonb)
  ) INTO r;

  RETURN r;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- fill_candidates — TOÀN BỘ pallet ứng viên của MỘT mã, xếp FEFO (dialog "Chọn date")
-- ─────────────────────────────────────────────────────────────────────────────
-- Cùng điều kiện nguồn với fill_demand.cand0 (một nguồn luật): NGOÀI vị trí nhặt lẻ ·
-- IN_STOCK/PARTIAL/LOOSE_PICKING (không QUARANTINE — hàng block không được đụng) ·
-- khả dụng = remaining − reserved > 0 · chưa có lệnh fill treo.
CREATE OR REPLACE FUNCTION fill_candidates(
  p_wh_scope     text[],
  p_warehouse_id text,
  p_material_id  text,
  p_limit        int DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  IF p_warehouse_id IS NULL OR p_material_id IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'error', 'INVALID_INPUT');
  END IF;
  IF p_wh_scope IS NOT NULL AND NOT (p_warehouse_id = ANY (p_wh_scope)) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'error', 'OUT_OF_SCOPE');
  END IF;

  SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(x ORDER BY x->>'fefo_key' NULLS LAST, x->>'production_date' NULLS LAST), '[]'::jsonb))
  INTO r
  FROM (
    SELECT jsonb_build_object(
             'entry_id',           e.id,
             'pallet_code',        e.pallet_code,
             'from_location_id',   e.location_id,
             'from_location_code', l.location_code,
             'avail',              GREATEST(0, e.cartons_remaining - COALESCE(e.cartons_reserved, 0)),
             'production_date',    e.production_date,
             'fefo_key',           COALESCE(e.expiry_date,
                                     (e.production_date
                                      + make_interval(days => COALESCE(e.shelf_life_days, m.shelf_life_days, 0)))::date)
           ) AS x
    FROM "InventoryEntry" e
    JOIN "Location" l ON l.id = e.location_id
    LEFT JOIN "Material" m ON m.id = e.material_id
    WHERE l.warehouse_id = p_warehouse_id AND NOT l.is_pick_face
      AND e.material_id = p_material_id
      AND e.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') AND e.cartons_remaining > 0
      AND GREATEST(0, e.cartons_remaining - COALESCE(e.cartons_reserved, 0)) > 0
      AND NOT EXISTS (SELECT 1 FROM "FillTask" ft WHERE ft.entry_id = e.id AND ft.status = 'PENDING')
    ORDER BY COALESCE(e.expiry_date,
               (e.production_date + make_interval(days => COALESCE(e.shelf_life_days, m.shelf_life_days, 0)))::date)
             NULLS LAST, e.production_date NULLS LAST, e.id
    LIMIT GREATEST(p_limit, 1)
  ) s;

  RETURN r;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260805d_fill_orders.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260805d — LỆNH FILL v3 (user chốt 05/08 chiều):
--
-- (1) LỆNH KHÔNG GHIM PALLET NỮA — chỉ định theo DATE. "Yêu cầu đúng tem pallet nào đưa về là
--     không cần thiết": xe nâng chỉ cần lấy ĐÚNG MÃ + ĐÚNG NSX (date) từ tầng trên; tem cụ thể
--     nào cũng được. Dòng lệnh (FillTask) giờ = mã hàng + DATE yêu cầu (+%Date qua required_expiry)
--     + số pallet + SL cần hạ + vị trí đích. Cột entry_id/pallet_code chỉ còn cho dòng DI SẢN.
-- (2) GOM THÀNH 1 LỆNH: bảng "FillOrder" — một lần "Ra lệnh fill" = MỘT lệnh, mở ra mới thấy
--     chi tiết từng dòng mã. Trạng thái lệnh suy từ dòng (còn dòng treo = PENDING).
-- (3) VẾT QUÉT: bảng "FillTaskScan" — mỗi pallet quét thực hiện là 1 dòng vết (ai, pallet nào,
--     từ đâu về đâu, bao nhiêu). Chống quét trùng bằng unique (task_id, entry_id).
-- (4) RPC fill_scan_apply — toàn bộ bước "quét thực hiện" trong MỘT transaction: khoá dòng lệnh
--     → kiểm mã/date/nguồn → move_pallets_to_location (khoá sức chứa) → ghi vết → cộng tiến độ
--     → chốt DONE dòng/lệnh. Tách 2 câu qua PostgREST là 2 transaction — đúng lớp lỗi
--     "adjust ghi tồn + log KHÔNG nguyên tử" đã dính 23/07.
--
-- Migration này idempotent (chạy lại không hỏng), tự xử dòng di sản trước khi siết ràng buộc.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Bảng FillOrder (lệnh gom)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "FillOrder" (
  id           text PRIMARY KEY,
  order_code   text NOT NULL,
  warehouse_id text NOT NULL REFERENCES "Warehouse"(id),
  target_date  date NOT NULL,                 -- NGÀY XUẤT lệnh phục vụ
  status       text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DONE', 'CANCELLED')),
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fillorder_code ON "FillOrder"(order_code);
CREATE INDEX IF NOT EXISTS idx_fillorder_wh_date ON "FillOrder"(warehouse_id, target_date, status);

-- Realtime (màn danh sách lệnh phải sáng khi người khác quét xong) + RLS.
-- ⚠️ RLS bật mà KHÔNG có policy SELECT cho `authenticated` = realtime CHẾT CÂM (bài học 04/08).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'FillOrder') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE "FillOrder"';
  END IF;
END $$;
ALTER TABLE "FillOrder" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='FillOrder' AND policyname='rls_auth_select') THEN
    EXECUTE 'CREATE POLICY rls_auth_select ON "FillOrder" FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) FillTask = DÒNG của lệnh, chỉ định theo DATE (không ghim pallet)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "FillTask"
  ADD COLUMN IF NOT EXISTS fill_order_id    text REFERENCES "FillOrder"(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS required_date    date,               -- NSX yêu cầu (null = không ràng date)
  ADD COLUMN IF NOT EXISTS required_expiry  date,               -- HSD của lô chỉ định → FE tính %Date
  ADD COLUMN IF NOT EXISTS required_pallets int     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scanned_pallets  int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_done_base    numeric NOT NULL DEFAULT 0;
ALTER TABLE "FillTask" ALTER COLUMN entry_id    DROP NOT NULL;
ALTER TABLE "FillTask" ALTER COLUMN pallet_code DROP NOT NULL;

-- Dòng DI SẢN (mô hình 1 lệnh = 1 pallet, trước 05/08):
--  · DONE cũ = đã hạ đúng 1 pallet → điền tiến độ để báo cáo không tụt số.
--  · PENDING cũ = HỦY (mô hình cũ ghim pallet, không diễn dịch được sang lệnh theo date;
--    staging chỉ có lệnh test 04/08 của Admin, production chưa có bảng này).
UPDATE "FillTask" SET scanned_pallets = 1, qty_done_base = qty_base
WHERE status = 'DONE' AND scanned_pallets = 0;
UPDATE "FillTask"
SET status = 'CANCELLED', updated_at = now(),
    cancel_reason = 'Chuyển mô hình lệnh theo DATE (05/08) — ra lệnh lại từ tab Đề xuất'
WHERE status = 'PENDING' AND fill_order_id IS NULL;

-- Gom dòng di sản vào lệnh di sản (mỗi cụm kho+ngày xuất+người tạo+ngày tạo = 1 lệnh)
WITH g AS (
  SELECT warehouse_id, target_date, COALESCE(created_by, '?') AS cb,
         created_at::date AS cd, min(created_at) AS mn
  FROM "FillTask" WHERE fill_order_id IS NULL
  GROUP BY 1, 2, 3, 4
),
o AS (
  INSERT INTO "FillOrder"(id, order_code, warehouse_id, target_date, status, created_by, created_at, updated_at)
  SELECT gen_random_uuid()::text,
         'F' || to_char(mn, 'YYMMDD') || '-L' || row_number() OVER (ORDER BY mn),
         warehouse_id, target_date, 'PENDING', NULLIF(cb, '?'), mn, now()
  FROM g
  RETURNING id, warehouse_id, target_date, created_by, created_at
)
UPDATE "FillTask" t
SET fill_order_id = o.id
FROM o
WHERE t.fill_order_id IS NULL
  AND t.warehouse_id = o.warehouse_id AND t.target_date = o.target_date
  AND COALESCE(t.created_by, '?') = COALESCE(o.created_by, '?')
  AND t.created_at::date = o.created_at::date;

DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM "FillTask" WHERE fill_order_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'Còn % dòng FillTask mồ côi (không gom được vào lệnh) — dừng migration', n; END IF;
END $$;
ALTER TABLE "FillTask" ALTER COLUMN fill_order_id SET NOT NULL;

-- Chống đua ở tầng DB: một (kho, ngày xuất, mã, date yêu cầu) chỉ có ĐÚNG 1 dòng đang treo —
-- hai người cùng ra lệnh thì người thua nhận 23505 → controller báo "vừa có người khác ra lệnh".
DROP INDEX IF EXISTS uq_filltask_pending_entry;
CREATE UNIQUE INDEX IF NOT EXISTS uq_filltask_pending_matdate
  ON "FillTask" (warehouse_id, target_date, material_id, COALESCE(required_date, '0001-01-01'::date))
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_filltask_order ON "FillTask"(fill_order_id);

-- Chốt trạng thái lệnh di sản theo dòng
UPDATE "FillOrder" fo SET status = sub.st, updated_at = now()
FROM (
  SELECT fill_order_id, CASE WHEN count(*) FILTER (WHERE status = 'PENDING') > 0 THEN 'PENDING'
                             WHEN count(*) FILTER (WHERE status = 'DONE')    > 0 THEN 'DONE'
                             ELSE 'CANCELLED' END AS st
  FROM "FillTask" GROUP BY fill_order_id
) sub
WHERE fo.id = sub.fill_order_id AND fo.status <> sub.st;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Bảng vết quét
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "FillTaskScan" (
  id                 text PRIMARY KEY,
  task_id            text NOT NULL REFERENCES "FillTask"(id) ON DELETE CASCADE,
  fill_order_id      text,
  entry_id           text NOT NULL REFERENCES "InventoryEntry"(id) ON DELETE CASCADE,
  pallet_code        text NOT NULL,
  qty_base           numeric NOT NULL DEFAULT 0,
  production_date    date,
  from_location_code text,
  to_location_id     text,
  to_location_code   text,
  scanned_by         text,
  scanned_by_name    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fillscan_task_entry ON "FillTaskScan"(task_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_fillscan_order ON "FillTaskScan"(fill_order_id);
ALTER TABLE "FillTaskScan" ENABLE ROW LEVEL SECURITY;   -- khoá anon (bất biến QA 00: mọi bảng public bật RLS)

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Rollup trạng thái lệnh (dùng chung cho quét + hủy dòng + hủy lệnh)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fill_order_rollup(p_order_id text, p_now timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE st text;
BEGIN
  SELECT CASE WHEN count(*) FILTER (WHERE status = 'PENDING') > 0 THEN 'PENDING'
              WHEN count(*) FILTER (WHERE status = 'DONE')    > 0 THEN 'DONE'
              ELSE 'CANCELLED' END
  INTO st FROM "FillTask" WHERE fill_order_id = p_order_id;
  IF st IS NULL THEN RETURN NULL; END IF;
  UPDATE "FillOrder" SET status = st, updated_at = p_now WHERE id = p_order_id AND status <> st;
  RETURN st;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) RPC fill_scan_apply — QUÉT THỰC HIỆN nguyên tử (khoá dòng lệnh + khoá sức chứa)
-- ─────────────────────────────────────────────────────────────────────────────
-- Trả jsonb {code, ...}: OK | NOT_FOUND | NOT_PENDING | PALLET_NOT_FOUND | GONE | WRONG_WAREHOUSE
--   | ALREADY_PICK_FACE | WRONG_MATERIAL | DATE_MISMATCH | DUP | FULL/INACTIVE/NOT_FOUND của move.
-- Controller đã kiểm quyền + gán-người TRƯỚC khi gọi; RPC kiểm lại phần DỮ LIỆU dưới lock (TOCTOU).
CREATE OR REPLACE FUNCTION fill_scan_apply(
  p_task_id        text,
  p_entry_id       text,
  p_to_location_id text,
  p_actor_id       text,     -- Employee.id (uuid) hoặc NULL
  p_actor_name     text,
  p_take_over      boolean,
  p_update_date    text,     -- ngày VN YYYY-MM-DD (cho move RPC)
  p_now            text      -- ISO UTC
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  t        "FillTask"%ROWTYPE;
  e        record;
  v_avail  numeric;
  v_mv     text;
  v_code   text;
  v_done   boolean;
  v_claim  boolean;
  v_ts     timestamptz := p_now::timestamptz;
  v_ord    text;
BEGIN
  SELECT * INTO t FROM "FillTask" WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF t.status <> 'PENDING' THEN RETURN jsonb_build_object('code', 'NOT_PENDING'); END IF;

  SELECT e2.id, e2.material_id, e2.pallet_code, e2.status, e2.production_date,
         e2.cartons_remaining, e2.cartons_reserved,
         l.is_pick_face, l.warehouse_id AS loc_wh, l.location_code AS loc_code
  INTO e
  FROM "InventoryEntry" e2 LEFT JOIN "Location" l ON l.id = e2.location_id
  WHERE e2.id = p_entry_id
  FOR UPDATE OF e2;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'PALLET_NOT_FOUND'); END IF;

  v_avail := GREATEST(0, e.cartons_remaining - COALESCE(e.cartons_reserved, 0));
  IF e.status NOT IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') OR v_avail <= 0 THEN
    RETURN jsonb_build_object('code', 'GONE');
  END IF;
  IF e.loc_wh IS DISTINCT FROM t.warehouse_id THEN RETURN jsonb_build_object('code', 'WRONG_WAREHOUSE'); END IF;
  IF COALESCE(e.is_pick_face, false) THEN RETURN jsonb_build_object('code', 'ALREADY_PICK_FACE'); END IF;
  IF e.material_id IS DISTINCT FROM t.material_id THEN RETURN jsonb_build_object('code', 'WRONG_MATERIAL'); END IF;
  IF t.required_date IS NOT NULL
     AND (e.production_date IS NULL OR e.production_date::date <> t.required_date) THEN
    RETURN jsonb_build_object('code', 'DATE_MISMATCH',
                              'required_date', t.required_date, 'pallet_date', e.production_date::date);
  END IF;
  IF EXISTS (SELECT 1 FROM "FillTaskScan" s WHERE s.task_id = t.id AND s.entry_id = p_entry_id) THEN
    RETURN jsonb_build_object('code', 'DUP');
  END IF;

  -- Chuyển vị trí NGUYÊN TỬ trong CÙNG transaction (row-lock Location, đếm sức chứa sống)
  v_mv   := move_pallets_to_location(ARRAY[p_entry_id], p_to_location_id, p_actor_id, p_update_date, p_now);
  v_code := split_part(v_mv, '|', 1);
  IF v_code <> 'OK' THEN
    RETURN jsonb_build_object('code', v_code, 'move', v_mv);   -- FULL/INACTIVE/NOT_FOUND — chưa ghi gì
  END IF;

  INSERT INTO "FillTaskScan"(id, task_id, fill_order_id, entry_id, pallet_code, qty_base, production_date,
                             from_location_code, to_location_id, to_location_code,
                             scanned_by, scanned_by_name, created_at, updated_at)
  VALUES (gen_random_uuid()::text, t.id, t.fill_order_id, p_entry_id, e.pallet_code, v_avail,
          e.production_date::date, e.loc_code, p_to_location_id,
          (SELECT location_code FROM "Location" WHERE id = p_to_location_id),
          p_actor_id, p_actor_name, v_ts, v_ts);

  v_done  := (t.scanned_pallets + 1 >= t.required_pallets) OR (t.qty_done_base + v_avail >= t.qty_base);
  v_claim := (t.assignee_id IS NULL AND p_actor_id IS NOT NULL)
             OR (p_take_over AND p_actor_id IS NOT NULL AND t.assignee_id IS DISTINCT FROM p_actor_id);

  UPDATE "FillTask" SET
    scanned_pallets  = scanned_pallets + 1,
    qty_done_base    = qty_done_base + v_avail,
    to_location_id   = p_to_location_id,
    to_location_code = (SELECT location_code FROM "Location" WHERE id = p_to_location_id),
    status           = CASE WHEN v_done THEN 'DONE' ELSE 'PENDING' END,
    done_at          = CASE WHEN v_done THEN v_ts ELSE done_at END,
    done_by          = CASE WHEN v_done THEN p_actor_id ELSE done_by END,
    done_by_name     = CASE WHEN v_done THEN p_actor_name ELSE done_by_name END,
    assignee_id      = CASE WHEN v_claim THEN p_actor_id   ELSE assignee_id END,
    assignee_name    = CASE WHEN v_claim THEN p_actor_name ELSE assignee_name END,
    assigned_by      = CASE WHEN v_claim THEN p_actor_name ELSE assigned_by END,
    assigned_at      = CASE WHEN v_claim THEN v_ts          ELSE assigned_at END,
    updated_at       = v_ts
  WHERE id = t.id
  RETURNING * INTO t;

  v_ord := fill_order_rollup(t.fill_order_id, v_ts);

  RETURN jsonb_build_object('code', 'OK', 'moved', true, 'scanned_qty', v_avail,
                            'task', to_jsonb(t), 'order_status', v_ord);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) fill_orders_page — danh sách LỆNH GOM: dòng + tổng + 4 ô SummaryBand, MỘT lời gọi
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS fill_tasks_page(text[], text, date, date, text[], text, text, int, int);

CREATE OR REPLACE FUNCTION fill_orders_page(
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
    -- base = MỌI bộ lọc TRỪ trạng thái (4 ô SummaryBand đếm toàn cảnh — bài học 04/08)
    WITH base AS (
      SELECT o.*,
             a.lines_n, a.pending_lines, a.done_lines, a.cancelled_lines,
             a.pallets_req, a.pallets_done, a.qty_req_entry, a.qty_done_entry,
             a.assignees, a.mat_codes, a.mat_names
      FROM "FillOrder" o
      LEFT JOIN LATERAL (
        SELECT count(*)                                        AS lines_n,
               count(*) FILTER (WHERE t.status = 'PENDING')    AS pending_lines,
               count(*) FILTER (WHERE t.status = 'DONE')       AS done_lines,
               count(*) FILTER (WHERE t.status = 'CANCELLED')  AS cancelled_lines,
               COALESCE(sum(t.required_pallets) FILTER (WHERE t.status <> 'CANCELLED'), 0) AS pallets_req,
               COALESCE(sum(t.scanned_pallets), 0)             AS pallets_done,
               -- tổng CROSS-MÃ ⇒ quy đổi per-mã TRƯỚC khi cộng (nhãn "SL (quy đổi)")
               COALESCE(sum(qty_entry_decimal(t.qty_base, m.entry_unit, m.units_per_carton))
                          FILTER (WHERE t.status <> 'CANCELLED'), 0) AS qty_req_entry,
               COALESCE(sum(qty_entry_decimal(t.qty_done_base, m.entry_unit, m.units_per_carton)), 0) AS qty_done_entry,
               string_agg(DISTINCT t.assignee_name, ', ')      AS assignees,
               string_agg(DISTINCT t.material_code, ' ')       AS mat_codes,
               string_agg(DISTINCT t.material_name, ' ')       AS mat_names
        FROM "FillTask" t
        LEFT JOIN "Material" m ON m.id = t.material_id
        WHERE t.fill_order_id = o.id
      ) a ON TRUE
      WHERE (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id)
        AND (p_wh_scope     IS NULL OR o.warehouse_id = ANY (p_wh_scope))
        AND (p_from IS NULL OR o.target_date >= p_from)
        AND (p_to   IS NULL OR o.target_date <= p_to)
        AND (p_assignee IS NULL OR EXISTS (
              SELECT 1 FROM "FillTask" t WHERE t.fill_order_id = o.id AND t.assignee_id = p_assignee))
        AND (s IS NULL OR NOT EXISTS (
              SELECT 1 FROM unnest(string_to_array(s, ' ')) tok
              WHERE tok <> '' AND position(tok IN lower(immutable_unaccent(
                concat_ws(' ', o.order_code, a.mat_codes, a.mat_names, a.assignees)))) = 0))
    ),
    f AS (SELECT * FROM base WHERE (p_status IS NULL OR status = ANY (p_status)))
    SELECT jsonb_build_object(
      'rows', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY
                 CASE x.status WHEN 'PENDING' THEN 0 WHEN 'DONE' THEN 1 ELSE 2 END,
                 x.target_date DESC, x.created_at DESC)
        FROM (SELECT * FROM f
              ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'DONE' THEN 1 ELSE 2 END,
                       target_date DESC, created_at DESC
              OFFSET GREATEST(p_offset, 0) LIMIT GREATEST(p_limit, 0)) x), '[]'::jsonb),
      'total',          (SELECT count(*) FROM f),
      'pending_n',      (SELECT count(*) FROM base WHERE status = 'PENDING'),
      'done_n',         (SELECT count(*) FROM base WHERE status = 'DONE'),
      'cancelled_n',    (SELECT count(*) FROM base WHERE status = 'CANCELLED'),
      'done_qty_entry', (SELECT COALESCE(sum(qty_done_entry), 0) FROM base)
    )
  );
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) fill_demand — "Đang có lệnh" = phần CÒN LẠI của dòng treo (qty_base − qty_done_base)
-- ─────────────────────────────────────────────────────────────────────────────
-- Chỉ đổi CTE `pend` so với 20260805b (dòng treo giờ hạ DẦN từng pallet — trừ nguyên qty_base
-- sẽ đếm trùng phần đã hạ, vốn đã nằm trong "đang có ở vị trí nhặt lẻ").
CREATE OR REPLACE FUNCTION fill_demand(
  p_wh_scope     text[],
  p_cat_scope    text[],
  p_warehouse_id text,
  p_date         date,
  p_max_sugg     int DEFAULT 40
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  IF p_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'pick_face_locations', 0, 'error', 'NO_WAREHOUSE');
  END IF;
  IF p_wh_scope IS NOT NULL AND NOT (p_warehouse_id = ANY (p_wh_scope)) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'pick_face_locations', 0, 'error', 'OUT_OF_SCOPE');
  END IF;

  WITH it AS (
    SELECT i.id, i.do_id, i.material_id, i.cartons_ordered, i.cartons_scanned, i.loose_picking
    FROM "OutboundItem" i
    WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
  ),
  j AS (
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
      AND COALESCE(g.awaiting_sap, false) = false
      AND COALESCE(g.plan_dropped, false) = false
      AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR wt_cats(g.warehouse_type) && p_cat_scope)
  ),
  dem AS (
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
  pf AS (
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
  pend AS (   -- dòng treo hạ DẦN → chỉ tính phần CÒN PHẢI HẠ
    SELECT material_id,
           sum(GREATEST(0, qty_base - qty_done_base)) AS pending_base,
           count(*) AS pending_n
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
  occ AS (
    SELECT e.location_id, count(*) AS n
    FROM "InventoryEntry" e
    JOIN "Location" l ON l.id = e.location_id
    WHERE l.warehouse_id = p_warehouse_id
      AND e.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE') AND e.cartons_remaining > 0
    GROUP BY e.location_id
  ),
  pfl AS (
    SELECT l.id, l.location_code, l.sub_code, l.categories,
           COALESCE(l.max_pallets, 0) - COALESCE(o.n, 0) AS free
    FROM "Location" l
    LEFT JOIN occ o ON o.location_id = l.id
    WHERE l.warehouse_id = p_warehouse_id AND l.is_pick_face AND l.is_active
  ),
  pfm AS (
    SELECT DISTINCT e.material_id, e.location_id
    FROM "InventoryEntry" e
    JOIN "Location" l ON l.id = e.location_id
    WHERE l.warehouse_id = p_warehouse_id AND l.is_pick_face
      AND e.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') AND e.cartons_remaining > 0
  ),
  cand0 AS (
    SELECT e.id, e.material_id, e.pallet_code, e.location_id, l.location_code,
           GREATEST(0, e.cartons_remaining - COALESCE(e.cartons_reserved, 0)) AS avail,
           e.expiry_date, e.production_date,
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
  pick AS (
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
                 'category',          m.category,
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
                                         AND (p.categories IS NULL OR m.category IS NULL
                                              OR p.categories @> ARRAY[m.category])
                                       ORDER BY (mm.location_id IS NULL), p.free DESC, p.location_code
                                       LIMIT 1),
                 'suggestions',       COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                             'entry_id',           k.id,
                             'pallet_code',        k.pallet_code,
                             'from_location_id',   k.location_id,
                             'from_location_code', k.location_code,
                             'avail',              k.avail,
                             'production_date',    k.production_date,
                             'expiry_date',        k.fefo_key)
                           ORDER BY k.rn)
                    FROM pick k WHERE k.material_id = n.material_id), '[]'::jsonb)
               ) AS x
        FROM need n
        LEFT JOIN "Material" m ON m.id = n.material_id
        WHERE EXISTS (SELECT 1 FROM pfl p
                      WHERE p.categories IS NULL OR m.category IS NULL
                         OR p.categories @> ARRAY[m.category])
      ) s
    ), '[]'::jsonb)
  ) INTO r;

  RETURN r;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) fill_report — tiến độ theo NGƯỜI trên mô hình dòng-theo-date
-- ─────────────────────────────────────────────────────────────────────────────
-- "Đã hạ" giờ là qty_done_base (phần THẬT SỰ đã chuyển, kể cả dòng còn treo một nửa) —
-- dùng qty_base của dòng DONE như cũ sẽ vênh với thực tế khi dòng xong bằng ít pallet hơn.
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
      SELECT f.*,
             qty_entry_decimal(f.qty_base, m.entry_unit, m.units_per_carton)      AS qty_entry,
             qty_entry_decimal(f.qty_done_base, m.entry_unit, m.units_per_carton) AS qty_done_entry
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
             sum(qty_done_entry)                                     AS done_qty_entry,
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
      'qty_entry',  (SELECT COALESCE(sum(qty_done_entry), 0) FROM t)
    )
  );
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) fill_candidates — bỏ điều kiện "chưa có lệnh treo" (lệnh không còn ghim pallet)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fill_candidates(
  p_wh_scope     text[],
  p_warehouse_id text,
  p_material_id  text,
  p_limit        int DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  IF p_warehouse_id IS NULL OR p_material_id IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'error', 'INVALID_INPUT');
  END IF;
  IF p_wh_scope IS NOT NULL AND NOT (p_warehouse_id = ANY (p_wh_scope)) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'error', 'OUT_OF_SCOPE');
  END IF;

  SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(x ORDER BY x->>'fefo_key' NULLS LAST, x->>'production_date' NULLS LAST), '[]'::jsonb))
  INTO r
  FROM (
    SELECT jsonb_build_object(
             'entry_id',           e.id,
             'pallet_code',        e.pallet_code,
             'from_location_id',   e.location_id,
             'from_location_code', l.location_code,
             'avail',              GREATEST(0, e.cartons_remaining - COALESCE(e.cartons_reserved, 0)),
             'production_date',    e.production_date,
             'fefo_key',           COALESCE(e.expiry_date,
                                     (e.production_date
                                      + make_interval(days => COALESCE(e.shelf_life_days, m.shelf_life_days, 0)))::date)
           ) AS x
    FROM "InventoryEntry" e
    JOIN "Location" l ON l.id = e.location_id
    LEFT JOIN "Material" m ON m.id = e.material_id
    WHERE l.warehouse_id = p_warehouse_id AND NOT l.is_pick_face
      AND e.material_id = p_material_id
      AND e.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') AND e.cartons_remaining > 0
      AND GREATEST(0, e.cartons_remaining - COALESCE(e.cartons_reserved, 0)) > 0
    ORDER BY COALESCE(e.expiry_date,
               (e.production_date + make_interval(days => COALESCE(e.shelf_life_days, m.shelf_life_days, 0)))::date)
             NULLS LAST, e.production_date NULLS LAST, e.id
    LIMIT GREATEST(p_limit, 1)
  ) s;

  RETURN r;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260805e_fill_orders_hints.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260805e — fill_orders_page trả thêm VỊ TRÍ LẤY / VỊ TRÍ VỀ gộp per lệnh (user chốt 05/08:
-- "user dùng điện thoại cần thông tin và thao tác Ở VỊ TRÍ NÀO ngay ở view đầu tiên").
-- Card mobile của tab Lệnh fill phải nói được "lấy tại đâu → hạ về đâu" mà không bắt mở chi tiết.
-- Chỉ gộp từ dòng CÒN TREO (việc còn phải làm); jsonb output nên chữ ký KHÔNG đổi → OR REPLACE.

CREATE OR REPLACE FUNCTION fill_orders_page(
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
    WITH base AS (
      SELECT o.*,
             a.lines_n, a.pending_lines, a.done_lines, a.cancelled_lines,
             a.pallets_req, a.pallets_done, a.qty_req_entry, a.qty_done_entry,
             a.assignees, a.mat_codes, a.mat_names, a.src_hints, a.dest_codes
      FROM "FillOrder" o
      LEFT JOIN LATERAL (
        SELECT count(*)                                        AS lines_n,
               count(*) FILTER (WHERE t.status = 'PENDING')    AS pending_lines,
               count(*) FILTER (WHERE t.status = 'DONE')       AS done_lines,
               count(*) FILTER (WHERE t.status = 'CANCELLED')  AS cancelled_lines,
               COALESCE(sum(t.required_pallets) FILTER (WHERE t.status <> 'CANCELLED'), 0) AS pallets_req,
               COALESCE(sum(t.scanned_pallets), 0)             AS pallets_done,
               COALESCE(sum(qty_entry_decimal(t.qty_base, m.entry_unit, m.units_per_carton))
                          FILTER (WHERE t.status <> 'CANCELLED'), 0) AS qty_req_entry,
               COALESCE(sum(qty_entry_decimal(t.qty_done_base, m.entry_unit, m.units_per_carton)), 0) AS qty_done_entry,
               string_agg(DISTINCT t.assignee_name, ', ')      AS assignees,
               string_agg(DISTINCT t.material_code, ' ')       AS mat_codes,
               string_agg(DISTINCT t.material_name, ' ')       AS mat_names,
               -- việc CÒN PHẢI LÀM đang nằm ở đâu / hạ về đâu (card mobile hiện ngay view đầu)
               string_agg(DISTINCT t.from_location_code, ', ') FILTER (WHERE t.status = 'PENDING') AS src_hints,
               string_agg(DISTINCT t.to_location_code, ', ')   FILTER (WHERE t.status = 'PENDING') AS dest_codes
        FROM "FillTask" t
        LEFT JOIN "Material" m ON m.id = t.material_id
        WHERE t.fill_order_id = o.id
      ) a ON TRUE
      WHERE (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id)
        AND (p_wh_scope     IS NULL OR o.warehouse_id = ANY (p_wh_scope))
        AND (p_from IS NULL OR o.target_date >= p_from)
        AND (p_to   IS NULL OR o.target_date <= p_to)
        AND (p_assignee IS NULL OR EXISTS (
              SELECT 1 FROM "FillTask" t WHERE t.fill_order_id = o.id AND t.assignee_id = p_assignee))
        AND (s IS NULL OR NOT EXISTS (
              SELECT 1 FROM unnest(string_to_array(s, ' ')) tok
              WHERE tok <> '' AND position(tok IN lower(immutable_unaccent(
                concat_ws(' ', o.order_code, a.mat_codes, a.mat_names, a.assignees)))) = 0))
    ),
    f AS (SELECT * FROM base WHERE (p_status IS NULL OR status = ANY (p_status)))
    SELECT jsonb_build_object(
      'rows', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY
                 CASE x.status WHEN 'PENDING' THEN 0 WHEN 'DONE' THEN 1 ELSE 2 END,
                 x.target_date DESC, x.created_at DESC)
        FROM (SELECT * FROM f
              ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'DONE' THEN 1 ELSE 2 END,
                       target_date DESC, created_at DESC
              OFFSET GREATEST(p_offset, 0) LIMIT GREATEST(p_limit, 0)) x), '[]'::jsonb),
      'total',          (SELECT count(*) FROM f),
      'pending_n',      (SELECT count(*) FROM base WHERE status = 'PENDING'),
      'done_n',         (SELECT count(*) FROM base WHERE status = 'DONE'),
      'cancelled_n',    (SELECT count(*) FROM base WHERE status = 'CANCELLED'),
      'done_qty_entry', (SELECT COALESCE(sum(qty_done_entry), 0) FROM base)
    )
  );
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260805f_fill_scan_wh_direct.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260805f — fill_scan_apply: xác định KHO của pallet bằng cột InventoryEntry.warehouse_id TRỰC TIẾP
-- (user báo 05/08: quét pallet có tồn nhưng bị chối). Bản cũ suy kho qua JOIN Location nên pallet
-- CHƯA GÁN VỊ TRÍ (location_id NULL — phổ biến ngay sau quét nhập) có loc_wh = NULL
-- → `IS DISTINCT FROM t.warehouse_id` = WRONG_WAREHOUSE oan. Luật CLAUDE.md: lọc theo KHO phải dùng
-- cột warehouse_id trực tiếp. Đổi duy nhất 2 chỗ: SELECT thêm e2.warehouse_id AS ent_wh + check
-- COALESCE(loc_wh, ent_wh). Pallet chưa gán vị trí vẫn phải KHÔNG ở pick-face (loc NULL ⇒ false) — giữ nguyên.

CREATE OR REPLACE FUNCTION fill_scan_apply(
  p_task_id        text,
  p_entry_id       text,
  p_to_location_id text,
  p_actor_id       text,
  p_actor_name     text,
  p_take_over      boolean,
  p_update_date    text,
  p_now            text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  t        "FillTask"%ROWTYPE;
  e        record;
  v_avail  numeric;
  v_mv     text;
  v_code   text;
  v_done   boolean;
  v_claim  boolean;
  v_ts     timestamptz := p_now::timestamptz;
  v_ord    text;
BEGIN
  SELECT * INTO t FROM "FillTask" WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF t.status <> 'PENDING' THEN RETURN jsonb_build_object('code', 'NOT_PENDING'); END IF;

  SELECT e2.id, e2.material_id, e2.pallet_code, e2.status, e2.production_date,
         e2.cartons_remaining, e2.cartons_reserved, e2.warehouse_id AS ent_wh,
         l.is_pick_face, l.warehouse_id AS loc_wh, l.location_code AS loc_code
  INTO e
  FROM "InventoryEntry" e2 LEFT JOIN "Location" l ON l.id = e2.location_id
  WHERE e2.id = p_entry_id
  FOR UPDATE OF e2;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'PALLET_NOT_FOUND'); END IF;

  v_avail := GREATEST(0, e.cartons_remaining - COALESCE(e.cartons_reserved, 0));
  IF e.status NOT IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') OR v_avail <= 0 THEN
    RETURN jsonb_build_object('code', 'GONE');
  END IF;
  -- Kho của pallet = vị trí đang đứng, pallet CHƯA GÁN VỊ TRÍ thì lấy kho của chính entry
  IF COALESCE(e.loc_wh::text, e.ent_wh::text) IS DISTINCT FROM t.warehouse_id::text THEN
    RETURN jsonb_build_object('code', 'WRONG_WAREHOUSE');
  END IF;
  IF COALESCE(e.is_pick_face, false) THEN RETURN jsonb_build_object('code', 'ALREADY_PICK_FACE'); END IF;
  IF e.material_id IS DISTINCT FROM t.material_id THEN RETURN jsonb_build_object('code', 'WRONG_MATERIAL'); END IF;
  IF t.required_date IS NOT NULL
     AND (e.production_date IS NULL OR e.production_date::date <> t.required_date) THEN
    RETURN jsonb_build_object('code', 'DATE_MISMATCH',
                              'required_date', t.required_date, 'pallet_date', e.production_date::date);
  END IF;
  IF EXISTS (SELECT 1 FROM "FillTaskScan" s WHERE s.task_id = t.id AND s.entry_id = p_entry_id) THEN
    RETURN jsonb_build_object('code', 'DUP');
  END IF;

  v_mv   := move_pallets_to_location(ARRAY[p_entry_id], p_to_location_id, p_actor_id, p_update_date, p_now);
  v_code := split_part(v_mv, '|', 1);
  IF v_code <> 'OK' THEN
    RETURN jsonb_build_object('code', v_code, 'move', v_mv);
  END IF;

  INSERT INTO "FillTaskScan"(id, task_id, fill_order_id, entry_id, pallet_code, qty_base, production_date,
                             from_location_code, to_location_id, to_location_code,
                             scanned_by, scanned_by_name, created_at, updated_at)
  VALUES (gen_random_uuid()::text, t.id, t.fill_order_id, p_entry_id, e.pallet_code, v_avail,
          e.production_date::date, e.loc_code, p_to_location_id,
          (SELECT location_code FROM "Location" WHERE id = p_to_location_id),
          p_actor_id, p_actor_name, v_ts, v_ts);

  v_done  := (t.scanned_pallets + 1 >= t.required_pallets) OR (t.qty_done_base + v_avail >= t.qty_base);
  v_claim := (t.assignee_id IS NULL AND p_actor_id IS NOT NULL)
             OR (p_take_over AND p_actor_id IS NOT NULL AND t.assignee_id IS DISTINCT FROM p_actor_id);

  UPDATE "FillTask" SET
    scanned_pallets  = scanned_pallets + 1,
    qty_done_base    = qty_done_base + v_avail,
    to_location_id   = p_to_location_id,
    to_location_code = (SELECT location_code FROM "Location" WHERE id = p_to_location_id),
    status           = CASE WHEN v_done THEN 'DONE' ELSE 'PENDING' END,
    done_at          = CASE WHEN v_done THEN v_ts ELSE done_at END,
    done_by          = CASE WHEN v_done THEN p_actor_id ELSE done_by END,
    done_by_name     = CASE WHEN v_done THEN p_actor_name ELSE done_by_name END,
    assignee_id      = CASE WHEN v_claim THEN p_actor_id   ELSE assignee_id END,
    assignee_name    = CASE WHEN v_claim THEN p_actor_name ELSE assignee_name END,
    assigned_by      = CASE WHEN v_claim THEN p_actor_name ELSE assigned_by END,
    assigned_at      = CASE WHEN v_claim THEN v_ts          ELSE assigned_at END,
    updated_at       = v_ts
  WHERE id = t.id
  RETURNING * INTO t;

  v_ord := fill_order_rollup(t.fill_order_id, v_ts);

  RETURN jsonb_build_object('code', 'OK', 'moved', true, 'scanned_qty', v_avail,
                            'task', to_jsonb(t), 'order_status', v_ord);
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260805g_fill_topup.sql
-- ───────────────────────────────────────────────────────────────────────
-- 20260805g — fill_task_topup: ĐƠN PHÁT SINH → ra lệnh trùng (kho, ngày xuất, mã, date) đang treo
-- thì CỘNG DỒN vào dòng cũ thay vì bắt hủy-tạo-lại (user chốt 05/08). Một câu UPDATE nguyên tử
-- (qty = qty + delta dưới row-lock của chính UPDATE — không đọc-rồi-ghi, 2 người cộng cùng lúc
-- đều ăn); điều kiện status='PENDING' để không hồi sinh dòng vừa DONE/hủy — trả NULL thì caller
-- thử INSERT lại (unique đã nhả).
CREATE OR REPLACE FUNCTION fill_task_topup(
  p_warehouse_id  text,
  p_target_date   date,
  p_material_id   text,
  p_required_date date,      -- NULL = dòng không ràng date
  p_add_qty       numeric,
  p_add_pallets   int,
  p_now           text       -- ISO UTC
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE t "FillTask"%ROWTYPE;
BEGIN
  IF COALESCE(p_add_qty, 0) <= 0 OR COALESCE(p_add_pallets, 0) <= 0 THEN RETURN NULL; END IF;
  UPDATE "FillTask" SET
    qty_base         = qty_base + p_add_qty,
    required_pallets = required_pallets + p_add_pallets,
    updated_at       = p_now::timestamptz
  WHERE warehouse_id = p_warehouse_id
    AND target_date  = p_target_date
    AND material_id  = p_material_id
    AND required_date IS NOT DISTINCT FROM p_required_date
    AND status = 'PENDING'
  RETURNING * INTO t;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(t);
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- 20260806_push_notifications.sql
-- ───────────────────────────────────────────────────────────────────────
-- Web Push notification (Đợt 1 roadmap 06/08): hạ tầng đăng ký thiết bị + khóa VAPID per-silo.
-- 2 bảng đều RLS ĐÓNG (service role only) — KHÔNG realtime, KHÔNG policy đọc:
--   · push_subscriptions: mỗi dòng = 1 thiết bị (trình duyệt/PDA) của 1 nhân viên đã bật thông báo.
--   · push_config: 1 dòng duy nhất chứa cặp khóa VAPID — TỰ SINH lần gửi đầu (backend), mỗi silo
--     (mỗi DB) một cặp riêng, không cần khai Vercel env. KHÔNG để trong SystemSetting vì
--     GET /wms/settings hở đọc cho mọi user đăng nhập → lộ private key.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  endpoint    text NOT NULL UNIQUE,          -- URL push service (FCM/APNs/Mozilla) — khóa thiết bị
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  failed_n    integer NOT NULL DEFAULT 0,    -- đếm lỗi gửi liên tiếp (404/410 = xóa ngay, lỗi khác = tăng)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_employee ON push_subscriptions (employee_id);

CREATE TABLE IF NOT EXISTS push_config (
  id            integer PRIMARY KEY CHECK (id = 1),  -- ép 1 dòng duy nhất
  vapid_public  text NOT NULL,
  vapid_private text NOT NULL,
  subject       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_config        ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────────────────────────────────────────────────
-- 20260806b_alerts.sql
-- ───────────────────────────────────────────────────────────────────────
-- TRUNG TÂM CẢNH BÁO (Đợt 2 roadmap 06/08) — bảng trạng thái cảnh báo + RPC prefilter cận date.
--
-- Kiến trúc HYBRID: điều kiện cảnh báo TÍNH SỐNG mỗi lượt quét (backend alertScanner — không có
-- bảng rule), bảng `alert_events` CHỈ giữ vòng đời để (a) biết cảnh báo nào MỚI mà bắn Web Push,
-- (b) user Ack (đã biết) — cảnh báo TỰ ĐÓNG (resolved_at) khi điều kiện hết, không bắt ai bấm.
-- dedup_key = khóa nghiệp vụ của cảnh báo (vd EXPIRY|kho|mã) — unique để lượt quét sau UPDATE
-- last_seen thay vì đẻ dòng mới.
CREATE TABLE IF NOT EXISTS alert_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule         text NOT NULL,               -- EXPIRY | GATE_DWELL | TRIP_LATE | WEIGH_DIFF | BE_ERRORS
  dedup_key    text NOT NULL UNIQUE,
  severity     text NOT NULL,               -- CRITICAL | WARNING
  warehouse_id text,                        -- null = cảnh báo toàn hệ thống (vd BE_ERRORS)
  category     text,                        -- Loại kho của đối tượng (null-inclusive khi cắt scope)
  title        text NOT NULL,
  detail       text,
  object_url   text,                        -- đường dẫn trong app khi bấm vào (vd /wms/outbound/<id>)
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  pushed_at    timestamptz,                 -- đã bắn Web Push chưa (null = mới, chưa báo ai)
  ack_by       text,
  ack_at       timestamptz,
  resolved_at  timestamptz,                 -- điều kiện đã hết (tự đóng) — list mặc định ẩn
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alert_events_open ON alert_events (rule, warehouse_id) WHERE resolved_at IS NULL;

ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
-- Realtime cần policy SELECT cho authenticated (bài học RLS-chết-câm 04/08 — bật RLS không policy
-- là client KHÔNG nhận sự kiện). Nội dung cảnh báo không nhạy cảm hơn dữ liệu các bảng nghiệp vụ
-- đã phát realtime; API list vẫn cắt scope kho+loại ở BE.
DROP POLICY IF EXISTS rls_auth_select ON alert_events;
CREATE POLICY rls_auth_select ON alert_events FOR SELECT TO authenticated USING (true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'alert_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE alert_events;
  END IF;
END $$;

-- ── RPC prefilter ứng viên CẬN DATE ──────────────────────────────────────────
-- %Date KHÔNG TÍNH Ở SQL (luật CLAUDE.md: công thức duy nhất = utils/shelfLife.computePctDate,
-- có ngoại lệ shelf-life theo NCC). RPC này chỉ THU HẸP tập ứng viên bằng điều kiện SIÊU TẬP
-- (chặn sót, cho phép thừa): HSD tường minh/suy từ NSX+shelflife trong cửa sổ p_days, HOẶC mã có
-- override NCC (không dựng lại được luật override trong SQL — đưa hết cho Node quyết).
-- Node nhận nhóm thô rồi tính computePctDate CHÍNH XÁC và áp ngưỡng thật.
CREATE OR REPLACE FUNCTION alerts_expiry_candidates(p_days int DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql STABLE SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_j), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object(
      'warehouse_id',   g.warehouse_id,
      'warehouse_name', w.name,
      'material_id',    g.material_id,
      'material_code',  m.material_code,
      'short_name',     m.short_name,
      'category',       m.category,
      'production_date', g.production_date,
      'expiry_date',     g.expiry_date,
      'shelf_life_days', g.shelf_life_days,
      'ncc_id',          g.ncc_id,
      'mat_shelf_life_days', m.shelf_life_days,
      'supplier_shelf_life_overrides', m.supplier_shelf_life_overrides,
      'qty_base',        g.qty_base,
      'pallets',         g.pallets
    ) AS row_j
    FROM (
      SELECT e.warehouse_id, e.material_id, e.production_date, e.expiry_date,
             e.shelf_life_days, e.ncc_id,
             SUM(e.cartons_remaining) AS qty_base, COUNT(*) AS pallets
      FROM "InventoryEntry" e
      JOIN "Material" mm ON mm.id = e.material_id
      WHERE e.cartons_remaining > 0
        AND e.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
        AND (
          (e.expiry_date IS NOT NULL AND e.expiry_date <= current_date + p_days)
          OR (e.expiry_date IS NULL AND e.production_date IS NOT NULL
              AND COALESCE(e.shelf_life_days, mm.shelf_life_days, 0) > 0
              AND e.production_date + COALESCE(e.shelf_life_days, mm.shelf_life_days, 0) <= current_date + p_days)
          OR (e.production_date IS NOT NULL
              AND jsonb_typeof(mm.supplier_shelf_life_overrides) = 'array'
              AND jsonb_array_length(mm.supplier_shelf_life_overrides) > 0)
        )
      GROUP BY e.warehouse_id, e.material_id, e.production_date, e.expiry_date, e.shelf_life_days, e.ncc_id
    ) g
    JOIN "Material" m ON m.id = g.material_id
    LEFT JOIN "Warehouse" w ON w.id::text = g.warehouse_id::text
    ORDER BY COALESCE(g.expiry_date, g.production_date) NULLS LAST
    LIMIT 2000   -- cầu chì: quá 2000 nhóm cận date là chuyện bất thường, cắt có chủ đích
  ) t;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION alerts_expiry_candidates(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION alerts_expiry_candidates(int) TO service_role;

-- ───────────────────────────────────────────────────────────────────────
-- 20260806c_cycle_count.sql
-- ───────────────────────────────────────────────────────────────────────
-- CYCLE COUNTING THEO ABC (Đợt 3 roadmap 06/08) — kiểm kê LUÂN PHIÊN thay kiểm full:
-- hạng A (nhặt nhiều) kiểm 7 ngày/lần, B 30 ngày, C 90 ngày (ngưỡng ở BE inventoryController).
--
-- Hạng ABC KHÔNG tính lại ở đây — nguồn DUY NHẤT là RPC slotting_stats (công thức 80/95% lượt
-- nhặt lũy kế). RPC này chỉ trả 2 thứ còn thiếu để BE ghép: (1) lần kiểm GẦN NHẤT per mã từ
-- StocktakeLog (append-only, không mất dấu khi pallet xuất đi), (2) danh sách vị trí đang chứa
-- từng mã (để nút "Kiểm các mã đã chọn" prefill bộ lọc Tổng hợp KK).

-- Index cho MAX(counted_at) GROUP BY material — StocktakeLog sẽ hàng trăm nghìn dòng/năm
CREATE INDEX IF NOT EXISTS idx_stocktakelog_wh_mat_counted
  ON "StocktakeLog" (warehouse_id, material_id, counted_at DESC);

CREATE OR REPLACE FUNCTION cycle_count_info(p_warehouse_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'last_counted', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('material_id', material_id, 'last_at', last_at))
      FROM (
        SELECT material_id, MAX(counted_at) AS last_at
        FROM "StocktakeLog"
        WHERE warehouse_id::text = p_warehouse_id AND material_id IS NOT NULL
        GROUP BY material_id
        LIMIT 10000   -- cầu chì: nhiều hơn 10k mã từng kiểm trong 1 kho là bất thường
      ) t
    ), '[]'::jsonb),
    'material_locs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('material_id', material_id, 'loc_ids', loc_ids, 'loc_codes', loc_codes))
      FROM (
        SELECT e.material_id,
               (array_agg(DISTINCT l.id::text))[1:200]           AS loc_ids,   -- cap 200 vị trí/mã
               (array_agg(DISTINCT l.location_code))[1:5]        AS loc_codes  -- mẫu hiển thị
        FROM "InventoryEntry" e
        JOIN "Location" l ON l.id = e.location_id
        WHERE e.warehouse_id::text = p_warehouse_id
          AND e.cartons_remaining > 0
          AND e.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
        GROUP BY e.material_id
        LIMIT 10000
      ) t
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION cycle_count_info(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cycle_count_info(text) TO service_role;

-- ───────────────────────────────────────────────────────────────────────
-- 20260806d_notifications.sql
-- ───────────────────────────────────────────────────────────────────────
-- TRUNG TÂM THÔNG BÁO trên nút CHUÔNG (user chốt 06/08: "sao không kết hợp vào nút chuông" +
-- tab Cá nhân / Thông báo chung + cài đặt trường-hợp-nào-mới-đổ-chuông).
--
-- · user_notifications = FEED CÁ NHÂN (mỗi dòng = 1 việc đích danh gửi tới 1 người: được giao
--   lệnh fill…) — feed là LỊCH SỬ nên LUÔN ghi; cài đặt chỉ tắt CHUÔNG (push), không tắt feed.
-- · notification_prefs = cài đặt per user (jsonb key→bool, thiếu key = bật): assign, reconcile,
--   EXPIRY, GATE_DWELL, TRIP_LATE, WEIGH_DIFF, BE_ERRORS.
-- · alert_events.warehouse_name: thông báo chung phải nói rõ KHO NÀO (user góp ý) — scanner
--   resolve tên 1 lần lúc quét, list/push đọc thẳng không phải join.

ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS warehouse_name text;

CREATE TABLE IF NOT EXISTS user_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  kind        text NOT NULL,          -- ASSIGN | ... (phân loại icon/lọc phía FE)
  title       text NOT NULL,
  body        text,
  url         text,                   -- đường dẫn trong app khi bấm vào
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_notifications_emp ON user_notifications (employee_id, created_at DESC);

ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
-- Policy SELECT authenticated cho realtime (bài học RLS-chết-câm 04/08). Nội dung feed = thông tin
-- giao việc vốn hiển thị công khai trong app (assignee trên lệnh fill ai có quyền view đều thấy);
-- API đọc/ghi vẫn khoá theo CHÍNH CHỦ ở BE.
DROP POLICY IF EXISTS rls_auth_select ON user_notifications;
CREATE POLICY rls_auth_select ON user_notifications FOR SELECT TO authenticated USING (true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'user_notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE user_notifications;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS notification_prefs (
  employee_id uuid PRIMARY KEY,
  prefs       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;   -- đóng kín — chỉ service role qua API

-- ───────────────────────────────────────────────────────────────────────
-- 20260806e_alerts_expiry_fix.sql
-- ───────────────────────────────────────────────────────────────────────
-- FIX RULE "TỒN CẬN DATE" CHẾT CÂM (check-app 06/08 bắt ngay lượt khảo sát đầu).
--
-- Triệu chứng: `alerts_expiry_candidates` nổ 42883 `operator does not exist: timestamp without
-- time zone + integer` ⇒ scanner bọc try/catch per-rule nên NUỐT lỗi ⇒ rule EXPIRY KHÔNG BAO GIỜ
-- chạy: staging có 120 nhóm (kho,mã) = 6,43 triệu base đang trong cửa sổ 120 ngày mà 0 cảnh báo.
-- Nguyên nhân: `InventoryEntry.production_date` là **timestamp without time zone** (không phải
-- `date` như `expiry_date`) — Postgres KHÔNG có toán tử `timestamp + integer`.
-- Fix: ép `::date` trước khi cộng số ngày (giữ nguyên mọi điều kiện khác).
-- Bài học đi kèm (bug chết hai lần): scanner từ nay GHI error_logs khi 1 rule lỗi (không chỉ
-- console.error — serverless không ai đọc), + QA gói 20 kiểm TỪNG rule chạy được.
CREATE OR REPLACE FUNCTION alerts_expiry_candidates(p_days int DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql STABLE SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_j), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object(
      'warehouse_id',   g.warehouse_id,
      'warehouse_name', w.name,
      'material_id',    g.material_id,
      'material_code',  m.material_code,
      'short_name',     m.short_name,
      'category',       m.category,
      'production_date', g.production_date,
      'expiry_date',     g.expiry_date,
      'shelf_life_days', g.shelf_life_days,
      'ncc_id',          g.ncc_id,
      'mat_shelf_life_days', m.shelf_life_days,
      'supplier_shelf_life_overrides', m.supplier_shelf_life_overrides,
      'qty_base',        g.qty_base,
      'pallets',         g.pallets
    ) AS row_j
    FROM (
      SELECT e.warehouse_id, e.material_id, e.production_date, e.expiry_date,
             e.shelf_life_days, e.ncc_id,
             SUM(e.cartons_remaining) AS qty_base, COUNT(*) AS pallets
      FROM "InventoryEntry" e
      JOIN "Material" mm ON mm.id = e.material_id
      WHERE e.cartons_remaining > 0
        AND e.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
        AND (
          (e.expiry_date IS NOT NULL AND e.expiry_date <= current_date + p_days)
          OR (e.expiry_date IS NULL AND e.production_date IS NOT NULL
              AND COALESCE(e.shelf_life_days, mm.shelf_life_days, 0) > 0
              AND e.production_date::date + COALESCE(e.shelf_life_days, mm.shelf_life_days, 0) <= current_date + p_days)
          OR (e.production_date IS NOT NULL
              AND jsonb_typeof(mm.supplier_shelf_life_overrides) = 'array'
              AND jsonb_array_length(mm.supplier_shelf_life_overrides) > 0)
        )
      GROUP BY e.warehouse_id, e.material_id, e.production_date, e.expiry_date, e.shelf_life_days, e.ncc_id
    ) g
    JOIN "Material" m ON m.id = g.material_id
    LEFT JOIN "Warehouse" w ON w.id::text = g.warehouse_id::text
    ORDER BY COALESCE(g.expiry_date, g.production_date::date) NULLS LAST
    LIMIT 2000   -- cầu chì: quá 2000 nhóm cận date là chuyện bất thường, cắt có chủ đích
  ) t;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION alerts_expiry_candidates(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION alerts_expiry_candidates(int) TO service_role;

-- ───────────────────────────────────────────────────────────────────────
-- 20260806f_user_notifications_rls_own.sql
-- ───────────────────────────────────────────────────────────────────────
-- SIẾT RLS FEED CÁ NHÂN — chỉ CHÍNH CHỦ đọc được (check-app 06/08 bắt tại chỗ).
--
-- Lỗ hổng đo thật: policy `rls_auth_select USING (true)` + vé realtime (`role=authenticated`,
-- `sub=<employee_id>`, ký bằng SUPABASE_JWT_SECRET) ⇒ BẤT KỲ user đăng nhập nào cầm anon key
-- (nằm sẵn trong bundle FE) gọi thẳng PostgREST đọc được TOÀN BỘ `user_notifications` của người
-- khác. API backend khoá đúng (B không thấy feed của A qua /notify/feed) nhưng đường Supabase
-- trực tiếp thì hở — app vài nghìn người dùng thì đây là rò thông tin giao việc toàn công ty.
--
-- Vá: policy so `employee_id = auth.uid()` — vé realtime mang sub = employee id nên khớp CHÍNH CHỦ.
-- Realtime KHÔNG chết: Supabase Realtime áp cùng policy SELECT, client vẫn nhận sự kiện dòng CỦA
-- MÌNH (đúng nhu cầu badge chuông) — chỉ mất khả năng nhìn trộm dòng người khác.
-- Backend dùng service role nên bypass RLS, mọi API giữ nguyên hành vi.
DROP POLICY IF EXISTS rls_auth_select ON user_notifications;
CREATE POLICY rls_own_select ON user_notifications
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid());

-- ───────────────────────────────────────────────────────────────────────
-- 20260806g_user_notif_dedupe.sql
-- ───────────────────────────────────────────────────────────────────────
-- GỘP THÔNG BÁO CÁ NHÂN Ở TẦNG DB (check-app 06/08 đo thật: giao 6 dòng lệnh fill SONG SONG
-- sinh 4 dòng feed thay vì 1).
--
-- Nguyên nhân: dedupe cũ làm bằng ĐỌC-RỒI-GHI trong JS (SELECT xem đã có chưa → INSERT) — 6
-- request đồng thời cùng đọc thấy "chưa có" nên cùng ghi. Đúng lớp lỗi mà CLAUDE.md cấm: mọi
-- chống-trùng phải là RÀNG BUỘC DB, không phải kiểm trong ứng dụng.
--
-- Luật mới (đơn giản hơn cửa sổ-2-phút cũ): MỘT người + MỘT loại việc + MỘT đối tượng (url)
-- = ĐÚNG MỘT dòng feed. Báo lại lần sau thì LÀM MỚI dòng đó (created_at mới, read_at=null →
-- nổi lên đầu, đếm lại là chưa đọc) thay vì đẻ dòng trùng. NULLS NOT DISTINCT để thông báo
-- không kèm link cũng gộp được.
--
-- Dọn trùng di sản TRƯỚC khi tạo index (giữ dòng MỚI NHẤT của mỗi bộ) — production apply nguyên trạng.
DELETE FROM user_notifications a
USING user_notifications b
WHERE a.employee_id = b.employee_id
  AND a.kind = b.kind
  AND a.url IS NOT DISTINCT FROM b.url
  AND (a.created_at, a.id) < (b.created_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_notif_target
  ON user_notifications (employee_id, kind, url) NULLS NOT DISTINCT;

COMMIT;