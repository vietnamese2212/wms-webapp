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
