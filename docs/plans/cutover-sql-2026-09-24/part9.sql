-- ============================================================================
-- CUTOVER production 24/09/2026 — PART 9/10
-- 10 migration · 20260915e_fill_demand_pending_per_day.sql → 20260922c_zsd02_rls_and_sloc_exempt.sql
-- Dán TRỌN file vào Supabase SQL Editor của project PRODUCTION svicyfquresxaigfxsdb rồi Run.
-- Cả part nằm trong MỘT transaction: lỗi bất kỳ đâu = rollback trọn part, schema không dở dang.
-- Chạy lại lần hai sẽ báo "đã tồn tại" rồi tự rollback — không hỏng gì.
-- ============================================================================
BEGIN;


-- ─────────────────────────────────────────────────────────────────────────
-- [20260915e_fill_demand_pending_per_day.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260915e — fill_demand: "ĐANG CÓ LỆNH" đếm THEO NGÀY XUẤT, không đếm mọi ngày của mã
--
-- Vì sao: `pend` gom dòng `FillTask` PENDING của mã trên MỌI `target_date`. Khi lệnh là sổ của MỘT NGÀY
-- (20260915b) và máy đối chiếu cả NGÀY MAI (20260915d), dòng của hôm nay trừ hết nhu cầu ngày mai ⇒
-- "thiếu 0" ⇒ máy không mở dòng nào cho mai. Bắt ở gói 18 [24b2]: đổi ngày chuyến sang mai, hàng đợi
-- ghi đúng, lượt đọc xả đúng, mà 0 dòng — vì dòng của ngày 21/12 (fixture) đang trừ vào ngày mai.
-- Mọi khoá khác của Fill vốn đã theo ngày (`uq_filltask_pending_matdate`, `fill_task_topup`,
-- `fill_order_ensure`) — chỉ phép trừ này còn nhìn xuyên ngày. Cùng đợt, phía TS `withLotCheck` lọc
-- việc LOOSE_FEED theo ngày xuất của chuyến.
--
-- Chỉ đổi mệnh đề WHERE của CTE `pend`; phần còn lại giữ nguyên bản 20260805d.

CREATE OR REPLACE FUNCTION public.fill_demand(
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
  pend AS (   -- dòng treo hạ DẦN → chỉ tính phần CÒN PHẢI HẠ; CHỈ dòng của NGÀY này (lệnh = sổ một ngày)
    SELECT material_id,
           sum(GREATEST(0, qty_base - qty_done_base)) AS pending_base,
           count(*) AS pending_n
    FROM "FillTask"
    WHERE warehouse_id = p_warehouse_id AND status = 'PENDING'
      AND target_date = p_date
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



-- ─────────────────────────────────────────────────────────────────────────
-- [20260916a_fill_demand_excluded_quiet.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260916a — Fill hàng (rà soát 16/09): (1) `fill_demand` NÓI RA mã bị loại vì kho không có ô nhặt lẻ
-- nhận Loại kho của nó; (2) `fill_reconcile_take` có CỬA SỔ IM LẶNG cho hàng đợi.
--
-- (1) Bản cũ lọc HẲN mã đó khỏi `rows` (không đích nào để hạ ⇒ không đề xuất) — đúng logic nhưng IM LẶNG:
--     đo Ba Vì 15/09, mã 510000306 (FG02) cần nhặt lẻ 60 thùng mà trang Fill hiện 8/9 mã, không một
--     dòng chữ nào nói mã thứ 9 đi đâu (lớp C24 nhìn từ phía Fill). Nay trả thêm `excluded[]` để màn
--     Đề xuất hiện băng "n mã cần nhặt lẻ nhưng kho chưa có ô nhặt lẻ nhận loại X — khai ở Vị trí kho".
--     `rows` giữ nguyên hình dạng (không đổi nghĩa cho bộ đối chiếu).
--
-- (2) Trigger trên `InventoryEntry` ghi (kho, ngày) mỗi lần pallet ở ô nhặt lẻ đổi — tức MỖI lượt quét
--     nhặt lẻ; trang PDA tải lại theo realtime sau mỗi lượt quét ⇒ mỗi lượt quét là một lượt đối chiếu
--     (2× `fill_demand`, 142 ms ấm / 2,2 s lạnh) trên pool PostgREST ~10 khe của máy NANO. Nay hàng đợi
--     chỉ được lấy khi dòng đã NẰM YÊN ≥ `p_quiet_s` giây (ON CONFLICT DO UPDATE bơm `queued_at` mỗi lần
--     ghi lại ⇒ một chuỗi quét liên tục gộp thành MỘT lượt đối chiếu sau khi lắng). Lượt quét an toàn
--     không đổi. ⚠️ Đổi chữ ký ⇒ DROP bản 4 tham số trước (PostgREST chọn hàm theo TÊN tham số — hai
--     bản sống song song là lời gọi cũ lặng lẽ rơi về bản cũ, memory `rpc-overload-silent-fallback`).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) fill_demand — thêm `excluded`
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fill_demand(
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
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'excluded', '[]'::jsonb, 'pick_face_locations', 0, 'error', 'NO_WAREHOUSE');
  END IF;
  IF p_wh_scope IS NOT NULL AND NOT (p_warehouse_id = ANY (p_wh_scope)) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'excluded', '[]'::jsonb, 'pick_face_locations', 0, 'error', 'OUT_OF_SCOPE');
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
  pend AS (   -- dòng treo hạ DẦN → chỉ tính phần CÒN PHẢI HẠ; CHỈ dòng của NGÀY này (lệnh = sổ một ngày)
    SELECT material_id,
           sum(GREATEST(0, qty_base - qty_done_base)) AS pending_base,
           count(*) AS pending_n
    FROM "FillTask"
    WHERE warehouse_id = p_warehouse_id AND status = 'PENDING'
      AND target_date = p_date
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
  ),
  -- Mã có nhu cầu nhưng KHÔNG ô nhặt lẻ nào của kho nhận Loại kho của nó — bản cũ chỉ lọc, nay nói ra
  serv AS (
    SELECT n.material_id, m.material_code, m.short_name, m.category, n.demand_base,
           EXISTS (SELECT 1 FROM pfl p
                   WHERE p.categories IS NULL OR m.category IS NULL
                      OR p.categories @> ARRAY[m.category]) AS servable
    FROM need n LEFT JOIN "Material" m ON m.id = n.material_id
  )
  SELECT jsonb_build_object(
    'pick_face_locations', (SELECT count(*) FROM "Location"
                            WHERE warehouse_id = p_warehouse_id AND is_pick_face AND is_active),
    'excluded', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'material_id', s.material_id, 'material_code', s.material_code,
               'material_name', s.short_name, 'category', s.category, 'demand_base', s.demand_base)
             ORDER BY s.category, s.material_code)
      FROM serv s WHERE NOT s.servable), '[]'::jsonb),
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
-- 2) fill_reconcile_take — cửa sổ im lặng cho hàng đợi (DROP bản cũ trước, đổi chữ ký)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fill_reconcile_take(text, date, int, int);

CREATE OR REPLACE FUNCTION public.fill_reconcile_take(
  p_wh      text,
  p_today   date,
  p_sweep_s int DEFAULT 1800,
  p_lease_s int DEFAULT 90,
  p_quiet_s int DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st fill_reconcile_state%ROWTYPE; days date[] := '{}';
BEGIN
  INSERT INTO fill_reconcile_state (warehouse_id) VALUES (p_wh) ON CONFLICT (warehouse_id) DO NOTHING;
  SELECT * INTO st FROM fill_reconcile_state WHERE warehouse_id = p_wh FOR UPDATE;
  IF st.lease_until IS NOT NULL AND st.lease_until > now() THEN
    RETURN jsonb_build_object('leased', false, 'busy', true, 'days', '[]'::jsonb);
  END IF;

  DELETE FROM fill_reconcile_queue WHERE warehouse_id = p_wh AND target_date < p_today;
  -- Chỉ lấy dòng đã NẰM YÊN ≥ p_quiet_s: một chuỗi quét liên tục ở ô lẻ bơm queued_at liên tục nên
  -- gộp thành một lượt sau khi lắng, thay vì mỗi lượt quét một lượt đối chiếu.
  WITH x AS (
    DELETE FROM fill_reconcile_queue
     WHERE warehouse_id = p_wh AND target_date <= p_today + 1
       AND queued_at <= now() - make_interval(secs => GREATEST(p_quiet_s, 0))
     RETURNING target_date
  )
  SELECT COALESCE(array_agg(target_date), '{}') INTO days FROM x;

  IF st.last_sweep IS NULL OR st.last_sweep < now() - make_interval(secs => p_sweep_s) THEN
    days := days || p_today || (p_today + 1);
    UPDATE fill_reconcile_state SET last_sweep = now(), updated_at = now() WHERE warehouse_id = p_wh;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), '{}') INTO days FROM unnest(days) u;
  IF COALESCE(array_length(days, 1), 0) = 0 THEN
    RETURN jsonb_build_object('leased', false, 'busy', false, 'days', '[]'::jsonb);
  END IF;

  UPDATE fill_reconcile_state
     SET lease_until = now() + make_interval(secs => p_lease_s), updated_at = now()
   WHERE warehouse_id = p_wh;
  RETURN jsonb_build_object('leased', true, 'busy', false, 'days', to_jsonb(days));
END $$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260916b_work_inbox_slotting_live.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260916b — Hộp việc: dòng "Sắp xếp kho" đếm VIỆC CÒN LÀM ĐƯỢC, không đếm n_lines đóng băng
-- ============================================================================
-- Đo staging 16/09 (Kho Ba Vì): Hộp việc giục "54 dòng chuyển pallet đang mở" trong khi trang kế hoạch
-- — vốn đã suy tiến độ SỐNG từ vị trí pallet (deriveLineStatuses) — chỉ còn 2 dòng làm được: 103/106
-- pallet đã xuất hết hoặc không còn bản ghi. Kế hoạch thứ hai: nói 3, thật 1. Hai màn của cùng một app
-- nói hai con số, và con số sai lại nằm ở chỗ GIAO VIỆC ⇒ người đi làm đi tìm 52 dòng hàng không còn.
-- Cùng lớp "kế hoạch tĩnh" đã vá ở Việc cần làm (14/09, hàng đợi sắp lại) và Fill hàng (15/09, bộ đối
-- chiếu); Slotting chưa có đường nào nói lại với Hộp việc.
-- Nay nhánh SLOTTING đếm dòng có ÍT NHẤT MỘT pallet còn sống chưa nằm ở vị trí đích — đúng định nghĩa
-- PENDING/PARTIAL của `deriveLineStatuses`; hết dòng làm được thì kế hoạch KHÔNG hiện trong Hộp việc
-- nữa (đóng kế hoạch vẫn là quyết định của người, máy chỉ thôi giục). Cùng chữ ký, CREATE OR REPLACE.
-- Chép từ 20260914d, sửa đúng một nhánh UNION.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.work_inbox(p_warehouse_ids text[], p_employee_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_rows  jsonb;
BEGIN
  WITH g AS (
    SELECT g.id, g.group_code, g.license_plate, g.warehouse_id, w.name AS wh_name,
           COALESCE(g.forklift_driver_ids, ARRAY[]::text[]) AS drivers, dk.row AS dock_name
      FROM public."GroupDeliveryOrder" g
      JOIN public."Warehouse" w  ON w.id = g.warehouse_id
      LEFT JOIN public."Location" dk ON dk.id = g.dock_location_id
     WHERE g.status IN ('IN_PROGRESS', 'PAUSED')
       AND (p_warehouse_ids IS NULL OR g.warehouse_id = ANY (p_warehouse_ids))
  ),
  t AS (
    SELECT t.*, g.drivers, g.wh_name, g.license_plate, g.group_code, g.dock_name,
           (t.needs_lower AND t.lowered_at IS NULL) AS waiting_lower,
           (t.claimed_by IS NOT NULL AND t.claimed_at > now() - interval '10 minutes') AS claim_active,
           NOT (t.kind = 'LOOSE_FEED' AND t.needs_lower) AS move_visible
      FROM public.wms_tasks t JOIN g ON g.id = t.gdo_id
     WHERE t.status = 'PENDING'
  ),
  my_trips AS (
    SELECT t.gdo_id, t.warehouse_id, t.wh_name, t.license_plate, t.group_code, t.dock_name,
           count(*) FILTER (WHERE t.move_visible AND t.moved_at IS NULL) AS n_move,
           count(*) FILTER (WHERE t.waiting_lower) AS n_wait
      FROM t WHERE p_employee_id = ANY (t.drivers)
     GROUP BY t.gdo_id, t.warehouse_id, t.wh_name, t.license_plate, t.group_code, t.dock_name
  ),
  rows_all AS (
    -- ── MINE ──
    SELECT 'MINE' AS zone, 'TRIP' AS source, m.gdo_id AS key, m.warehouse_id, m.wh_name,
           'Chuyến ' || COALESCE(m.group_code, m.license_plate) || COALESCE(' · ' || NULLIF(m.license_plate, m.group_code), '') || COALESCE(' · ' || m.dock_name, '') AS title,
           m.n_move || ' pallet cần đưa ra' || CASE WHEN m.n_wait > 0 THEN ' · ' || m.n_wait || ' đang chờ xe hạ' ELSE '' END AS sub,
           m.n_move::int AS n, '/wms/directed?tab=MOVE&trip=' || m.gdo_id AS link,
           'directed_work' AS pm, 'view' AS pa, false AS wv, NULL::text AS sub_wait
      FROM my_trips m WHERE m.n_move > 0
    UNION ALL
    SELECT 'MINE', 'CLAIM', 'claim:' || t.warehouse_id, t.warehouse_id, t.wh_name,
           'Đang cầm ' || count(*) || ' việc hạ',
           count(DISTINCT t.from_location_id) || ' vị trí — bấm ✓ Xong khi hạ xong, quá 10 phút việc tự nhả',
           count(*)::int, '/wms/directed?tab=LOWER', 'directed_work', 'confirm', false, NULL
      FROM t WHERE t.claim_active AND t.claimed_by = p_employee_id
     GROUP BY t.warehouse_id, t.wh_name
    UNION ALL
    SELECT 'MINE', 'FILL', 'fill:' || fo.id, ft.warehouse_id, w.name,
           'Lệnh fill ' || fo.order_code,
           count(*) || ' dòng hạ hàng nhặt lẻ giao cho bạn',
           count(*)::int, '/wms/fill/orders/' || fo.id, 'fill', 'execute', false, NULL
      FROM public."FillTask" ft
      JOIN public."FillOrder" fo ON fo.id = ft.fill_order_id
      JOIN public."Warehouse" w  ON w.id = ft.warehouse_id
     WHERE ft.status = 'PENDING' AND ft.assignee_id = p_employee_id
       AND (p_warehouse_ids IS NULL OR ft.warehouse_id = ANY (p_warehouse_ids))
     GROUP BY fo.id, fo.order_code, ft.warehouse_id, w.name
    -- ── SHARED ──
    UNION ALL
    SELECT 'SHARED', 'LOWER', 'lower:' || t.warehouse_id, t.warehouse_id, t.wh_name,
           'Cần hạ ' || count(*) || ' pallet',
           count(DISTINCT t.from_location_id) || ' vị trí · ' || count(DISTINCT t.gdo_id) || ' chuyến — chưa ai nhận',
           count(*)::int, '/wms/directed?tab=LOWER', 'directed_work', 'view', false, NULL
      FROM t WHERE t.waiting_lower AND NOT t.claim_active
     GROUP BY t.warehouse_id, t.wh_name
    UNION ALL
    SELECT 'SHARED', 'FILL_OPEN', 'fillopen:' || ft.warehouse_id, ft.warehouse_id, w.name,
           'Lệnh fill chưa ai nhận', count(*) || ' dòng hạ hàng nhặt lẻ',
           count(*)::int, '/wms/fill', 'fill', 'execute', false, NULL
      FROM public."FillTask" ft JOIN public."Warehouse" w ON w.id = ft.warehouse_id
     WHERE ft.status = 'PENDING' AND ft.assignee_id IS NULL
       AND (p_warehouse_ids IS NULL OR ft.warehouse_id = ANY (p_warehouse_ids))
     GROUP BY ft.warehouse_id, w.name
    UNION ALL
    SELECT 'SHARED', 'SLOTTING', 'slot:' || sp.id, sp.warehouse_id, w.name,
           'Sắp xếp kho: ' || sp.name, c.n_open || ' dòng chuyển pallet còn phải làm',
           c.n_open, '/wms/slotting/plans/' || sp.id, 'slotting', 'view', false, NULL
      FROM public."SlottingPlan" sp
      JOIN public."Warehouse" w ON w.id = sp.warehouse_id
      -- Dòng CÒN LÀM ĐƯỢC = còn ít nhất một pallet sống chưa đứng ở vị trí đích. Pallet đã xuất hết
      -- (cartons_remaining <= 0 / status EXPORTED) hoặc không còn bản ghi thì dòng đó hết việc.
      JOIN LATERAL (
        SELECT count(*)::int AS n_open
          FROM public."SlottingPlanLine" sl
         WHERE sl.plan_id = sp.id
           AND EXISTS (
                 SELECT 1
                   FROM jsonb_array_elements_text(COALESCE(sl.entry_ids, '[]'::jsonb)) x(eid)
                   JOIN public."InventoryEntry" ie ON ie.id = x.eid
                  WHERE COALESCE(ie.cartons_remaining, 0) > 0
                    AND COALESCE(ie.status, '') <> 'EXPORTED'
                    AND ie.location_id IS DISTINCT FROM sl.to_location_id)
      ) c ON c.n_open > 0
     WHERE sp.status = 'ACTIVE'
       AND (p_warehouse_ids IS NULL OR sp.warehouse_id = ANY (p_warehouse_ids))
    UNION ALL
    SELECT 'SHARED', 'TRANSFER', 'transfer:' || o.destination_warehouse_id, o.destination_warehouse_id, w.name,
           'Chuyển kho chờ nhận', count(*) || ' lệnh — kho nhận xác nhận trong app',
           count(*)::int, '/tms/bookings', 'tms_plan', 'confirm_receipt', false, NULL
      FROM public."TmsOrder" o JOIN public."Warehouse" w ON w.id = o.destination_warehouse_id
     WHERE o.status = 'PENDING' AND o.source_type = 'TRANSFER' AND o.delivery_mode = 'SCAN'
       AND COALESCE(o.plan_dropped, false) = false
       AND (p_warehouse_ids IS NULL OR o.destination_warehouse_id = ANY (p_warehouse_ids))
     GROUP BY o.destination_warehouse_id, w.name
    UNION ALL
    SELECT 'SHARED', 'DATE', 'date:' || x.warehouse_id, x.warehouse_id, x.wh_name,
           'Khai quy định date', count(*) || ' dòng hàng · ' || count(DISTINCT x.gdo_id) || ' chuyến tới ngày xuất — chưa khai thì không sinh việc',
           count(*)::int, '/wms/outbound/date-rules', 'outbound', 'set_date', true,
           count(*) || ' dòng hàng đang chờ người khác khai quy định date'
      FROM (
        SELECT gg.id AS gdo_id, gg.warehouse_id, w.name AS wh_name
          FROM public."GroupDeliveryOrder" gg
          JOIN public."Warehouse" w ON w.id = gg.warehouse_id
          JOIN public."OutboundDelivery" d ON d.gdo_id = gg.id
          JOIN public."OutboundItem" i ON i.do_id = d.id
         WHERE gg.status IN ('PENDING', 'IN_PROGRESS', 'PAUSED')
           AND (gg.delivery_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= v_today
           AND (p_warehouse_ids IS NULL OR gg.warehouse_id = ANY (p_warehouse_ids))
           AND i.date_rule IS NULL AND COALESCE(i.date_required, 0) <= 0
           AND COALESCE(i.cartons_ordered, 0) > COALESCE(i.cartons_scanned, 0)
      ) x
     GROUP BY x.warehouse_id, x.wh_name
    UNION ALL
    SELECT 'SHARED', 'RECONCILE', 'recon:' || gg.warehouse_id, gg.warehouse_id, w.name,
           'DO SAP cần xử lý', count(*) || ' thay đổi từ SAP chờ người quyết',
           count(*)::int, '/external?tab=reconcile', 'outbound', 'reconcile', false, NULL
      FROM public.reconcile_tasks rt
      JOIN public."GroupDeliveryOrder" gg ON gg.id = rt.gdo_id
      JOIN public."Warehouse" w ON w.id = gg.warehouse_id
     WHERE rt.status = 'OPEN'
       AND (p_warehouse_ids IS NULL OR gg.warehouse_id = ANY (p_warehouse_ids))
     GROUP BY gg.warehouse_id, w.name
    -- ── WAITING ──
    UNION ALL
    SELECT 'WAITING', 'TRIP_WAIT', 'wait:' || m.gdo_id, m.warehouse_id, m.wh_name,
           'Chuyến ' || COALESCE(m.group_code, m.license_plate) || COALESCE(' · ' || NULLIF(m.license_plate, m.group_code), '') || ': ' || m.n_wait || ' pallet chờ xe hạ',
           'xe hạ hạ xong thì việc tự sang bảng của bạn',
           m.n_wait::int, '/wms/directed?tab=MOVE&trip=' || m.gdo_id, 'directed_work', 'view', false, NULL
      FROM my_trips m WHERE m.n_wait > 0
    UNION ALL
    SELECT 'WAITING', 'OTHER_CLAIM', 'oc:' || t.warehouse_id || ':' || t.claimed_by, t.warehouse_id, t.wh_name,
           COALESCE(e.name, t.claimed_by) || ' đang cầm ' || count(*) || ' việc hạ',
           count(DISTINCT t.from_location_id) || ' vị trí',
           count(*)::int, '/wms/directed?tab=LOWER', 'directed_work', 'view', false, NULL
      FROM t LEFT JOIN public."Employee" e ON e.id = t.claimed_by
     WHERE t.claim_active AND t.claimed_by <> p_employee_id
     GROUP BY t.warehouse_id, t.wh_name, t.claimed_by, e.name
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY
           CASE r.zone WHEN 'MINE' THEN 0 WHEN 'SHARED' THEN 1 ELSE 2 END, r.wh_name, r.source, r.title), '[]'::jsonb)
    INTO v_rows
    FROM rows_all r;

  RETURN jsonb_build_object('rows', v_rows, 'today', v_today);
END;
$function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260917_directed_board_claim_who_when.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- VIỆC CẦN LÀM — "AI NHẬN, NHẬN LÚC NÀO" + "VIỆC CỦA AI" (17/09/2026)
--
-- User 17/09: *"Nhận việc: phải biết được ai là người nhận, nhận lúc nào"* và *"Việc Cần đưa ra:
-- tôi hiểu nó là việc gán tên đúng không? gán tên khi bắt đầu, vậy nếu user muốn xem chung và user
-- muốn xem riêng thì sao"*.
--
-- Hai thứ DB đã có mà bảng chưa nói ra:
--   1. `wms_tasks.claimed_at` — giờ nhận việc. Bảng mới chỉ hiện TÊN người đang giữ ("… đang làm"),
--      không hiện lúc nào, nên khoá mềm 10 phút tự nhả mà không ai biết nó sắp hết.
--   2. `GroupDeliveryOrder.forklift_driver_ids` — người được GÁN làm xe chuyển lúc Bắt đầu chuyến.
--      Trước đây chỉ dùng để LỌC trong SQL (`p_driver_id`), nên FE muốn đổi "xem riêng ↔ xem chung"
--      là phải gọi lại máy chủ và không bao giờ biết phía bên kia có bao nhiêu việc. Trả mảng ra
--      (nối chuỗi) để bảng "Cần đưa ra" có SWITCH Phạm vi kèm SỐ như bảng "Cần hạ" — user đã chốt
--      12/09 và nhắc lại 17/09: *"Tôi muốn switch chứ ko phải là filter"*.
--
-- `p_driver_id` GIỮ NGUYÊN (bundle PWA cũ còn gửi; lọc ở SQL vẫn đúng).
-- Sinh bằng scratchpad/gen_mig_board4.mjs (thay đúng 3 chỗ so với 20260914c).
-- ============================================================================
-- Sau 20260914b, object mỗi dòng việc có 51 khoá ⇒ Postgres từ chối "cannot pass more than 100
-- arguments to a function" ⇒ GET /wms/directed/board 500, bảng trống (gói 57 [10a] bắt ngay khi chạy
-- trên Preview). Vá: tách thành hai jsonb_build_object nối bằng || ngay trong jsonb_agg — kết quả
-- JSON y hệt, không đổi chữ ký. Bài học: RPC trả dòng jsonb "rộng" thì đếm khoá trước khi thêm; trần
-- này không có ở tsc/QA tĩnh, chỉ lộ khi gọi thật.
-- Sinh bằng scratchpad/ops/gen_mig_board3.mjs (thay đúng 1 chỗ).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.directed_board(p_warehouse_id text, p_mode text, p_gdo_id text DEFAULT NULL::text, p_driver_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_rows   jsonb;
  v_tot    jsonb;
  v_alerts jsonb;
  v_trips  jsonb;
  v_sep    boolean;
  v_radius integer;
BEGIN
  SELECT COALESCE(w.separate_lowering_forklift, true), COALESCE(w.cross_trip_pick_radius, 0)
    INTO v_sep, v_radius
    FROM public."Warehouse" w WHERE w.id = p_warehouse_id;
  v_sep := COALESCE(v_sep, true);
  v_radius := COALESCE(v_radius, 0);

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
           -- NGUYÊN LIỆU THÔ cho %Date (FE tính bằng computePctDate — xem đầu file)
           m.shelf_life_days              AS mat_shelf_days,
           m.supplier_shelf_life_overrides AS mat_overrides,
           ie.production_date, ie.expiry_date,
           ie.shelf_life_days AS entry_shelf_days,
           ie.ncc_id,
           -- PALLET TƯƠNG ĐƯƠNG (user 14/09: "43 pallet chung một date thì pallet nào cũng được"): bảng
           -- chỉ ra lệnh "lấy N pallet ở ô X"; cái ghim chỉ là gợi ý. n_equiv = số pallet trong ô cùng
           -- mã + cùng NSX/HSD/mã lô với pallet ghim; cell_ndates = ô có mấy NSX khác nhau của mã đó
           -- (> 1 ⇒ phải nói rõ lấy NSX nào, vì lúc đó "lấy pallet nào" mới là câu hỏi thật).
           (SELECT count(*) FROM public."InventoryEntry" x
             WHERE x.location_id = t.from_location_id AND x.material_id = t.material_id
               AND x.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') AND x.cartons_remaining > 0
               AND COALESCE(x.production_date::text, '') = COALESCE(ie.production_date::text, '')
               AND COALESCE(x.expiry_date::text, '')     = COALESCE(ie.expiry_date::text, '')
               AND COALESCE(x.batch, '')                 = COALESCE(ie.batch, '')) AS n_equiv,
           (SELECT count(DISTINCT x.production_date) FROM public."InventoryEntry" x
             WHERE x.location_id = t.from_location_id AND x.material_id = t.material_id
               AND x.status IN ('IN_STOCK', 'PARTIAL', 'LOOSE_PICKING') AND x.cartons_remaining > 0) AS cell_ndates,
           -- YÊU CẦU của dòng đơn + NƠI NHẬN (câu hỏi 2 và 3 ở đầu file)
           oi.date_rule, oi.date_required, oi.header_text,
           od.distributor_name, od.delivery_code,
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
      -- entry_id là ON DELETE SET NULL ⇒ LEFT JOIN; pallet đã bị xoá thì chỉ mất phần date, dòng việc vẫn hiện
      LEFT JOIN public."InventoryEntry"   ie ON ie.id = t.entry_id
      LEFT JOIN public."OutboundItem"     oi ON oi.id = t.item_id
      LEFT JOIN public."OutboundDelivery" od ON od.id = oi.do_id
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
     -- LOWER = riêng việc phải hạ. MOVE = TOÀN BỘ việc phải mang đi đâu đó (kể cả việc về vị trí
     -- nhặt lẻ còn trên kệ) — bảng của xe chuyển phải nói hết phần việc, không lọc theo việc người
     -- khác đã bấm hay chưa.
     WHERE CASE p_mode WHEN 'LOWER' THEN b.needs_lower ELSE true END
       AND (p_driver_id IS NULL OR p_driver_id = ANY (COALESCE(b.forklift_driver_ids, ARRAY[]::text[])))
  ),
  grouped AS (
    SELECT
      -- MỌI bảng gom theo Ô (14/09): "lấy N pallet ở ô X". Trước đó Sắp quét mỗi tem một dòng, tức
      -- bảng đọc như mệnh lệnh phải quét ĐÚNG tem đó — trong khi ô cùng date thì pallet nào cũng được.
      t.gdo_id || '|' || COALESCE(t.current_code, '?') || '|' || COALESCE(t.to_code, '?') || '|' || t.kind
        || CASE WHEN t.skipped THEN '|S' ELSE '' END AS group_key,
      min(t.seq)                                 AS seq,
      jsonb_agg(t.id ORDER BY t.seq)             AS task_ids,
      count(*)                                   AS n_pallets,
      count(*) FILTER (WHERE t.status = 'DONE')  AS n_done,
      min(t.n_equiv)                             AS n_equiv,
      max(t.cell_ndates)                         AS cell_ndates,
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
      min(t.item_id)                             AS item_id,
      min(t.current_code)                        AS current_code,
      min(t.from_code)                           AS from_code,
      min(t.from_location_id)                    AS from_location_id,
      min(t.drop_location_id)                    AS drop_location_id,
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
      max(t.claimed_at)      FILTER (WHERE t.claim_active) AS claimed_at,
      -- Người được gán làm xe chuyển của chuyến. text[] KHÔNG có aggregate min/max nên nối chuỗi;
      -- mọi việc trong một nhóm đều thuộc CÙNG một chuyến (gdo_id nằm trong khoá gom) ⇒ min = giá trị đó.
      min(array_to_string(t.forklift_driver_ids, ',')) AS driver_ids,
      bool_and(t.status = 'DONE' OR CASE p_mode WHEN 'LOWER' THEN t.lowered_at IS NOT NULL
                                                WHEN 'MOVE'  THEN t.moved_at   IS NOT NULL
                                                ELSE t.done_at IS NOT NULL END) AS stage_done,
      bool_and(t.status = 'DONE')                AS all_scanned,
      max(COALESCE(t.done_at, t.moved_at, t.lowered_at, t.updated_at)) AS last_at,
      min(t.lowered_by)                          AS lowered_by,
      min(t.moved_by)                            AS moved_by,
      jsonb_agg(DISTINCT t.material_code)        AS material_codes,
      jsonb_agg(DISTINCT jsonb_build_object('id', t.material_id, 'code', t.material_code))
        FILTER (WHERE t.material_id IS NOT NULL) AS materials,
      min(t.material_name)                       AS material_name,
      jsonb_agg(DISTINCT t.pallet_code)          AS pallet_codes,
      -- ── MỚI 13/09 ───────────────────────────────────────────────────────────────────────────
      -- TỪNG PALLET của nhóm: tem + nguyên liệu thô để FE tính %Date. Một dòng bảng xe nâng có thể
      -- gom nhiều pallet trong cùng ô, và đó chính là lúc "lấy cái nào" trở thành câu hỏi thật.
      jsonb_agg(jsonb_build_object(
        'task_id',         t.id,
        'code',            t.pallet_code,
        'material_code',   t.material_code,
        'qty_base',        t.qty_base,
        'is_partial',      t.is_partial,
        'level_no',        t.level_no,
        'loc_code',        t.current_code,
        'production_date', t.production_date,
        'expiry_date',     t.expiry_date,
        'shelf_life_days', t.entry_shelf_days,
        'ncc_id',          t.ncc_id,
        'mat_shelf_days',  t.mat_shelf_days,
        'mat_overrides',   t.mat_overrides,
        'done',            (t.status = 'DONE'),
        'skipped',         t.skipped
      ) ORDER BY t.seq)                          AS pallets,
      -- YÊU CẦU date của (các) dòng đơn trong nhóm — thường đúng 1; gom nhiều mã thì có thể nhiều mức
      jsonb_agg(DISTINCT t.date_rule) FILTER (WHERE t.date_rule IS NOT NULL) AS date_rules,
      max(t.date_required)                       AS date_required,
      string_agg(DISTINCT t.distributor_name, ' · ') AS customer_name,
      string_agg(DISTINCT t.delivery_code, ' · ')    AS do_codes,
      string_agg(DISTINCT t.header_text, ' · ')      AS cs_note
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
      'item_id',        g.item_id,
      'current_code',   g.current_code,
      'from_code',      g.from_code,
      -- ID vị trí (13/09): backend cần toạ độ trên lưới để sắp "nhặt dọc đường"; mã chữ không tra được
      'from_location_id', g.from_location_id,
      'drop_location_id', g.drop_location_id,
      'level_no',       g.level_no,
      'to_code',        g.to_code,
      'to_name',        g.to_name,
      'drop_name',      g.drop_name,
      'dist_cells',     g.dist_cells,
      'n_pallets',      g.n_pallets
    ) || jsonb_build_object(   -- tách hai object: một jsonb_build_object chỉ nhận ≤ 100 tham số (50 khoá)
      'n_done',         g.n_done,
      'n_equiv',        g.n_equiv,
      'cell_ndates',    g.cell_ndates,
      'qty_base',       g.qty_base,
      'is_partial',     g.is_partial,
      'units_per_carton', g.units_per_carton,
      'entry_unit',     g.entry_unit,
      'base_unit',      g.base_unit,
      'material_codes', g.material_codes,
      'materials',      COALESCE(g.materials, '[]'::jsonb),
      'material_name',  g.material_name,
      'pallet_codes',   g.pallet_codes,
      'pallets',        COALESCE(g.pallets, '[]'::jsonb),
      'date_rules',     COALESCE(g.date_rules, '[]'::jsonb),
      'date_required',  g.date_required,
      'customer_name',  g.customer_name,
      'do_codes',       g.do_codes,
      'cs_note',        g.cs_note,
      'needs_lower',    g.needs_lower,
      'waiting_lower',  g.waiting_lower,
      'skipped',        g.skipped,
      'skip_reason',    g.skip_reason,
      'claim_active',   g.claim_active,
      'claimed_by',     g.claimed_by,
      'claimed_by_name', g.claimed_by_name,
      'claimed_at',     g.claimed_at,
      'driver_ids',     g.driver_ids,
      'stage_done',     g.stage_done,
      'all_scanned',    g.all_scanned,
      'last_at',        g.last_at,
      'done_by_name',   COALESCE(g.moved_by, g.lowered_by),
      -- Việc còn trên kệ nhìn từ bảng XE CHUYỂN = MỘT nút "Hạ & đưa ra" (stage BOTH). Không còn phụ
      -- thuộc `separate_lowering_forklift`: cờ đó chỉ còn quyết định có HIỆN tab Cần hạ hay không.
      'combined_lower', (p_mode = 'MOVE' AND g.waiting_lower),
      -- Không tự khoá tay ai nữa: việc chưa xong và chưa bị bỏ thì bấm được, ở cả ba bảng.
      'can_confirm',    (NOT g.stage_done) AND (NOT g.skipped)
    ) ORDER BY
        (g.stage_done OR g.skipped),
        g.skipped,
        CASE WHEN p_mode = 'LOWER' THEN (NOT g.truck_idle)::int ELSE 0 END,
        g.started_at,
        -- BỎ hai khoá 'gần cửa trước' + 'tầng cao trước' (13/09 — xem đầu file): thứ tự đi đã nằm
        -- trong `seq` do assignSeq tính bằng vòng láng giềng gần nhất trên Sơ đồ kho; sắp lại theo
        -- khoảng-cách-tới-cửa là VỨT BỎ chính cái vòng đó. "Tầng cao trước" vẫn đúng nhưng chỉ có
        -- nghĩa TRONG một ô (assignSeq đã sắp), áp giữa các ô khác nhau thì không mang nghĩa gì.
        g.seq
    ), '[]'::jsonb)
    INTO v_rows
    FROM grouped g;

  SELECT jsonb_build_object(
           'pending',   count(*) FILTER (WHERE t.status = 'PENDING'),
           'done',      count(*) FILTER (WHERE t.status = 'DONE'),
           'skipped',   count(*) FILTER (WHERE t.status = 'SKIPPED'),
           'to_lower',  count(*) FILTER (WHERE t.status = 'PENDING' AND t.needs_lower AND t.lowered_at IS NULL),
           'to_move',   count(*) FILTER (WHERE t.status = 'PENDING' AND t.moved_at IS NULL),
           'trips',     count(DISTINCT t.gdo_id) FILTER (WHERE t.status <> 'SKIPPED')
         )
    INTO v_tot
    FROM public.wms_tasks t
    JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
   WHERE t.warehouse_id = p_warehouse_id AND t.status IN ('PENDING', 'DONE', 'SKIPPED')
     AND g.status IN ('IN_PROGRESS', 'PAUSED')
     AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id);

  -- ── HỒ SƠ CHUYẾN (mới 13/09) — người đang lấy hàng phải biết mình đang phục vụ chuyến nào, giao
  --    cho ai, còn bao nhiêu. Đếm theo DÒNG HÀNG, KHÔNG cộng thùng cross-mã (luật base-unit).
  WITH tt AS (
    SELECT g.id, g.group_code, g.license_plate, g.started_at, g.delivery_date,
           dk.row AS dock_name,
           string_agg(DISTINCT d.distributor_name, ' · ')                   AS customers,
           count(DISTINCT d.id)                                             AS n_do,
           count(DISTINCT i.id)                                             AS lines_total,
           count(DISTINCT i.id) FILTER (
             WHERE COALESCE(i.cartons_scanned, 0) >= COALESCE(i.cartons_ordered, 0)) AS lines_done,
           count(DISTINCT i.id) FILTER (
             WHERE i.date_rule IS NULL AND COALESCE(i.date_required, 0) <= 0
               AND COALESCE(i.cartons_ordered, 0) > COALESCE(i.cartons_scanned, 0))  AS lines_unset
      FROM public."GroupDeliveryOrder" g
      LEFT JOIN public."Location"          dk ON dk.id  = g.dock_location_id
      LEFT JOIN public."OutboundDelivery"  d  ON d.gdo_id = g.id
      LEFT JOIN public."OutboundItem"      i  ON i.do_id  = d.id
     WHERE g.warehouse_id = p_warehouse_id
       AND g.status IN ('IN_PROGRESS', 'PAUSED')
       AND (p_gdo_id IS NULL OR g.id = p_gdo_id)
     GROUP BY g.id, g.group_code, g.license_plate, g.started_at, g.delivery_date, dk.row
  ), tk AS (
    SELECT t.gdo_id,
           count(*) FILTER (WHERE t.status = 'PENDING') AS tasks_pending,
           count(*) FILTER (WHERE t.status = 'DONE')    AS tasks_done
      FROM public.wms_tasks t
     WHERE t.warehouse_id = p_warehouse_id
     GROUP BY t.gdo_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'gdo_id',        tt.id,
           'group_code',    tt.group_code,
           'license_plate', tt.license_plate,
           'dock_name',     tt.dock_name,
           'started_at',    tt.started_at,
           'delivery_date', tt.delivery_date,
           'customers',     tt.customers,
           'n_do',          tt.n_do,
           'lines_total',   tt.lines_total,
           'lines_done',    tt.lines_done,
           'lines_unset',   tt.lines_unset,
           'tasks_pending', COALESCE(tk.tasks_pending, 0),
           'tasks_done',    COALESCE(tk.tasks_done, 0)
         ) ORDER BY tt.started_at NULLS LAST, tt.group_code), '[]'::jsonb)
    INTO v_trips
    FROM tt LEFT JOIN tk ON tk.gdo_id = tt.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'gdo_id', x.gdo_id, 'group_code', x.group_code, 'item_id', x.item_id,
           'material_code', x.material_code_raw, 'remaining', x.remaining, 'note', x.header_text,
           'delivery_date', x.delivery_date,
           'material_id', x.material_id, 'material_name', x.material_name, 'material_category', x.material_category,
           'units_per_carton', x.units_per_carton, 'entry_unit', x.entry_unit, 'base_unit', x.base_unit,
           'customer_name', x.distributor_name
         ) ORDER BY x.group_code, x.material_code_raw), '[]'::jsonb)
    INTO v_alerts
    FROM (
      SELECT g.id AS gdo_id, g.group_code, g.delivery_date, i.id AS item_id, i.material_code_raw, i.header_text,
             (COALESCE(i.cartons_ordered, 0) - COALESCE(i.cartons_scanned, 0)) AS remaining,
             i.material_id, m.short_name AS material_name, m.category AS material_category,
             m.units_per_carton, m.entry_unit, m.base_unit, d.distributor_name
        FROM public."GroupDeliveryOrder" g
        JOIN public."OutboundDelivery"   d ON d.gdo_id = g.id
        JOIN public."OutboundItem"       i ON i.do_id  = d.id
        LEFT JOIN public."Material"      m ON m.id = i.material_id
       WHERE g.warehouse_id = p_warehouse_id
         AND g.status IN ('IN_PROGRESS', 'PAUSED')
         AND (p_gdo_id IS NULL OR g.id = p_gdo_id)
         AND i.date_rule IS NULL
         AND COALESCE(i.date_required, 0) <= 0
         AND COALESCE(i.cartons_ordered, 0) > COALESCE(i.cartons_scanned, 0)
    ) x;

  RETURN jsonb_build_object(
    'rows', v_rows, 'totals', v_tot, 'unset_items', v_alerts, 'trips', v_trips,
    'settings', jsonb_build_object('separate_lowering_forklift', v_sep,
                                   'cross_trip_pick_radius', COALESCE(v_radius, 0))
  );
END;
$function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260917b_pallet_ledger.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- SỔ PALLET — "pallet này ai đã tác động vào, lúc nào" (17/09/2026)
--
-- User 17/09: *"trông nó có giống như 1 sổ cái trong SAP đối với pallet ID ko, sổ cái mb51?"* →
-- *"tôi chỉ cần na ná thôi cũng đc, kiểu ghi nhận pallet đó có lịch sử như thế nào — đc ai tác động vào?"*
--
-- MB51 của SAP = danh sách CHỨNG TỪ VẬT TƯ (MKPF/MSEG): mỗi dòng là một lần tồn đổi thật, có
-- movement type + số lượng + người nhập + chứng từ đối ứng kế toán. App này KHÔNG có sổ hợp nhất
-- như thế — mỗi nghiệp vụ ghi một bảng riêng (đo 17/09):
--     packing_logs 1.055 · OutboundScanEntry 288 · InventoryAdjustmentLog 181
--     PalletOperation 27 · StocktakeLog 7 · FillTaskScan 1 · wms_task_events 1.248
-- Muốn biết một pallet đã đi qua những gì thì phải ghép tay 7 nguồn ⇒ trên thực tế không ai tra.
--
-- Hàm này KHÔNG tạo bảng mới và KHÔNG đổi đường ghi nào — chỉ HỢP NHẤT các sổ sẵn có về một hình
-- dạng chung (thời điểm · loại tác động · ai · từ ô → tới ô · số lượng · chứng từ). Vì sao không
-- dựng bảng sổ cái riêng: thêm một nơi ghi là thêm một nguồn sự thật phải giữ đồng bộ, và lớp lỗi
-- tốn kém nhất của dự án đúng là "hai cửa cùng một sổ mà khác luật".
--
-- KHÁC MB51 ở hai chỗ phải nói rõ, đừng kỳ vọng nhầm:
--   · Đây là sổ HIỆN VẬT, không có giá trị tiền và không sinh chứng từ kế toán.
--   · MB51 khoá theo mã hàng × plant × kho; sổ này khoá theo TEM PALLET (mịn hơn một bậc — SAP chỉ
--     xuống tới pallet khi dùng Handling Unit).
--
-- ĐƠN VỊ SỐ LƯỢNG: MỌI nguồn đều đã là BASE — trả đúng một trường `qty_base`, FE in qua `qtyLabel`
-- (luật một nguồn, BE⇄FE mirror). KHÔNG quy đổi trong SQL.
-- ⚠️ BẪY ĐÃ DẪM PHẢI ngay bản đầu 17/09: cột `packing_logs.qty_cartons` TÊN là "thùng" nhưng GIÁ TRỊ
-- là BASE (xem `packingController`: "qty_cartons lưu SỐ BASE như mọi số lượng trong app"). Bản đầu
-- tin cái tên nên in "6.720 thùng" cho pallet 140 thùng — sai gấp 48 lần, và người đọc sổ không có
-- cách nào biết. Đây là lớp lỗi đã có trong sổ (`packing-qty-unit-mixup`, 06/09) — đọc TÊN cột để
-- suy ra đơn vị là cách sai; phải đọc chỗ GHI vào cột đó.
-- ============================================================================

-- [cutover] gỡ: BEGIN;

-- Index cho các nguồn tra theo tem mà chưa có (tra một pallet = mỗi nguồn một index scan)
CREATE INDEX IF NOT EXISTS idx_stocktakelog_pallet   ON "StocktakeLog" (pallet_code, counted_at DESC);
CREATE INDEX IF NOT EXISTS idx_filltaskscan_pallet   ON "FillTaskScan" (pallet_code);
CREATE INDEX IF NOT EXISTS idx_wms_tasks_pallet      ON wms_tasks (pallet_code);
CREATE INDEX IF NOT EXISTS idx_invadjlog_entry       ON "InventoryAdjustmentLog" (entry_id);

DROP FUNCTION IF EXISTS public.pallet_ledger(text, text[], integer);
CREATE OR REPLACE FUNCTION public.pallet_ledger(
  p_pallet_code  text,
  p_warehouse_ids text[] DEFAULT NULL,   -- NULL = không giới hạn (user phạm vi toàn quốc)
  p_limit        integer DEFAULT 400
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_events jsonb;
  v_pallet jsonb;
BEGIN
  WITH ev AS (
    -- 1. SX GHI SỔ ĐÓNG GÓI — pallet ra đời
    SELECT COALESCE(pl.close_scan_at, pl.open_scan_at, pl.created_at) AS at,
           'PACKED'::text            AS kind,
           pl.packed_by_name         AS actor,
           NULL::text                AS from_code,
           NULL::text                AS to_code,
           pl.qty_cartons            AS qty_base,   -- cột tên "cartons" nhưng GIÁ TRỊ là base (xem đầu file)
           NULL::numeric             AS qty_cartons, -- giữ ô này rỗng: không nguồn nào ghi theo thùng
           pl.warehouse_id           AS warehouse_id,
           NULLIF(pl.machine_code,'') AS ref,
           pl.note                   AS note
      FROM public.packing_logs pl
     WHERE pl.pallet_code = p_pallet_code AND pl.status <> 'CANCELLED'

    UNION ALL
    -- 2. VÀO SỔ TỒN (nhập kho / tách ra pallet con) — dòng InventoryEntry được tạo
    SELECT ie.created_at, 'RECEIVED', emp.name,
           NULL, loc.location_code, ie.cartons_imported, NULL,
           ie.warehouse_id,
           CASE WHEN ie.parent_pallet_code IS NOT NULL THEN 'tách từ ' || ie.parent_pallet_code END,
           NULL
      FROM public."InventoryEntry" ie
      LEFT JOIN public."Location" loc ON loc.id = ie.location_id
      LEFT JOIN public."Employee" emp ON emp.id = ie.created_by
     WHERE ie.pallet_code = p_pallet_code

    UNION ALL
    -- 3. CHUYỂN VỊ TRÍ / KIỂM KÊ — một sổ, phân biệt bằng location_changed_to
    SELECT sl.counted_at,
           CASE WHEN sl.location_changed_to IS NOT NULL THEN 'MOVED' ELSE 'COUNTED' END,
           sl.counted_by_name, sl.location_from_code, sl.location_code,
           sl.physical_qty, NULL, sl.warehouse_id, NULL, sl.note
      FROM public."StocktakeLog" sl
     WHERE sl.pallet_code = p_pallet_code

    UNION ALL
    -- 4. ĐIỀU CHỈNH TỒN (+/-)
    SELECT al.adjusted_at, 'ADJUSTED', al.actor_name, NULL, NULL,
           al.delta, NULL, ie.warehouse_id,
           ie.cartons_remaining::text, al.note
      FROM public."InventoryAdjustmentLog" al
      JOIN public."InventoryEntry" ie ON ie.id = al.entry_id
     WHERE ie.pallet_code = p_pallet_code

    UNION ALL
    -- 5. DỒN / TÁCH PALLET — tem có thể là NGUỒN hoặc ĐÍCH của thao tác
    SELECT po.created_at,
           CASE WHEN po.type = 'MERGE' THEN 'MERGED'
                WHEN po.type = 'SPLIT' THEN 'SPLIT'
                ELSE 'UNGROUPED' END,
           po.operated_by_name, NULL, NULL, NULL, NULL, po.warehouse_id,
           NULL,
           CASE WHEN p_pallet_code = ANY(po.source_codes) THEN 'tem này là NGUỒN'
                ELSE 'tem này là KẾT QUẢ' END
      FROM public."PalletOperation" po
     WHERE (po.source_codes @> ARRAY[p_pallet_code] OR po.target_codes @> ARRAY[p_pallet_code])
       AND po.undone_at IS NULL

    UNION ALL
    -- 5b. …và lần HOÀN TÁC thao tác đó (nếu có) là một tác động riêng
    SELECT po.undone_at, 'UNDONE', po.undone_by_name, NULL, NULL, NULL, NULL, po.warehouse_id,
           NULL, 'hoàn tác ' || po.type
      FROM public."PalletOperation" po
     WHERE (po.source_codes @> ARRAY[p_pallet_code] OR po.target_codes @> ARRAY[p_pallet_code])
       AND po.undone_at IS NOT NULL

    UNION ALL
    -- 6. HẠ XUỐNG KHO LẺ (quét lệnh fill)
    SELECT fs.created_at, 'FILLED', fs.scanned_by_name,
           fs.from_location_code, fs.to_location_code, fs.qty_base, NULL,
           loc.warehouse_id, fo.order_code, NULL
      FROM public."FillTaskScan" fs
      LEFT JOIN public."Location"  loc ON loc.id = fs.to_location_id
      LEFT JOIN public."FillOrder" fo  ON fo.id  = fs.fill_order_id
     WHERE fs.pallet_code = p_pallet_code

    UNION ALL
    -- 7. XUẤT HÀNG (quét tem ở cửa) — chứng từ = Số xe của chuyến
    SELECT ose.scanned_at AT TIME ZONE 'UTC', 'PICKED', emp.name, NULL, NULL,
           ose.cartons_scanned, NULL, g.warehouse_id,
           COALESCE(g.group_code, g.license_plate),
           CASE WHEN ose.is_loose_picking THEN 'nhặt lẻ' END
      FROM public."OutboundScanEntry" ose
      LEFT JOIN public."Employee"          emp ON emp.id = ose.scanned_by
      LEFT JOIN public."OutboundItem"      oi  ON oi.id  = ose.item_id
      LEFT JOIN public."OutboundDelivery"  od  ON od.id  = oi.do_id
      LEFT JOIN public."GroupDeliveryOrder" g  ON g.id   = od.gdo_id
     WHERE ose.pallet_code = p_pallet_code

    UNION ALL
    -- 8. NHẬT KÝ VIỆC (Việc cần làm) — giao việc, nhận, hạ, đưa ra, hệ thống huỷ.
    -- CHỈ việc có ghim tem mới vào đây: lệnh fill chỉ định theo mã + date nên không gắn pallet nào
    -- cho tới lúc quét (lúc đó đã nằm ở nguồn 6).
    SELECT e.at, 'TASK_' || e.event, e.actor,
           t.from_location_code, COALESCE(dl.location_code, tl.location_code),
           NULL, NULL, t.warehouse_id,
           COALESCE(g.group_code, g.license_plate), e.note
      FROM public.wms_task_events e
      JOIN public.wms_tasks t ON t.id = e.task_id
      LEFT JOIN public."Location" dl ON dl.id = t.drop_location_id
      LEFT JOIN public."Location" tl ON tl.id = t.to_location_id
      LEFT JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
     WHERE t.pallet_code = p_pallet_code
  )
  -- HAI NHÓM, KHÔNG TRỘN (đo ngay lượt chạy đầu 17/09): một pallet ở Ba Vì có **105 dòng nhật ký
  -- việc** (máy lập kế hoạch rồi huỷ qua nhiều chuyến) trong khi tác động THẬT lên hàng chỉ có 2
  -- (nhập kho · xuất). Đổ chung một danh sách thì thứ cần đọc chìm nghỉm. `grp='STOCK'` = hàng thật
  -- sự bị động vào; `grp='TASK'` = việc được giao/nhận/huỷ. Cũng đúng cách SAP chia: MB51 là chứng
  -- từ vật tư, còn lệnh kho nằm ở LT23/LT24 riêng.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'grp', CASE WHEN x.kind LIKE 'TASK\_%' THEN 'TASK' ELSE 'STOCK' END,
           'at', x.at, 'kind', x.kind, 'actor', x.actor,
           'from_code', x.from_code, 'to_code', x.to_code,
           'qty_base', x.qty_base, 'qty_cartons', x.qty_cartons,
           'warehouse_id', x.warehouse_id, 'ref', x.ref, 'note', x.note
         ) ORDER BY x.at), '[]'::jsonb)
    INTO v_events
    FROM (
      -- Trần áp cho TỪNG NHÓM, không áp cho cả danh sách: pallet bị lập kế hoạch đi lập kế hoạch lại
      -- có hàng trăm dòng việc, cắt phẳng theo thời gian sẽ hất văng chính mấy dòng "hàng đã bị động
      -- vào" — thứ duy nhất người tra cần. Mỗi nhóm giữ bản GẦN ĐÂY NHẤT rồi sắp lại theo thời gian.
      SELECT * FROM (
        SELECT ev.*,
               row_number() OVER (
                 PARTITION BY (CASE WHEN ev.kind LIKE 'TASK\_%' THEN 'TASK' ELSE 'STOCK' END)
                 ORDER BY ev.at DESC
               ) AS rn
          FROM ev
         WHERE ev.at IS NOT NULL
           -- Cắt phạm vi kho, null-inclusive như mọi chỗ khác trong app (bản ghi không khai kho vẫn hiện)
           AND (p_warehouse_ids IS NULL OR ev.warehouse_id IS NULL OR ev.warehouse_id = ANY(p_warehouse_ids))
      ) z
      WHERE z.rn <= GREATEST(1, LEAST(p_limit, 2000))
    ) x;

  -- Ảnh hiện tại của tem (có thể nhiều dòng nếu tem từng được dùng lại sau khi xuất hết)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'entry_id', ie.id, 'status', ie.status, 'warehouse_id', ie.warehouse_id,
           'warehouse_name', w.name, 'location_code', loc.location_code,
           'material_code', m.material_code, 'material_name', m.short_name, 'category', m.category,
           'entry_unit', m.entry_unit, 'base_unit', m.base_unit, 'units_per_carton', m.units_per_carton,
           'cartons_imported', ie.cartons_imported, 'cartons_remaining', ie.cartons_remaining,
           'production_date', ie.production_date, 'expiry_date', ie.expiry_date, 'batch', ie.batch,
           'import_date', ie.import_date
         ) ORDER BY ie.created_at), '[]'::jsonb)
    INTO v_pallet
    FROM public."InventoryEntry" ie
    LEFT JOIN public."Location"  loc ON loc.id = ie.location_id
    LEFT JOIN public."Warehouse" w   ON w.id   = ie.warehouse_id
    LEFT JOIN public."Material"  m   ON m.id   = ie.material_id
   WHERE ie.pallet_code = p_pallet_code
     AND (p_warehouse_ids IS NULL OR ie.warehouse_id IS NULL OR ie.warehouse_id = ANY(p_warehouse_ids));

  RETURN jsonb_build_object('pallet_code', p_pallet_code, 'entries', v_pallet, 'events', v_events);
END $$;

REVOKE ALL ON FUNCTION public.pallet_ledger(text, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pallet_ledger(text, text[], integer) TO service_role;

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260918_forklift_driver_flag.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- Cờ VAI TRÒ "lái xe nâng" — tiếp nối 20260814_role_flags (is_driver / is_carrier)
--
-- VÌ SAO (user hỏi 18/09 "gác người lái xe nâng là gì?"):
-- Lúc Bắt đầu chuyến ở kho Hướng dẫn, danh sách người lái xe nâng ghi vào
-- `GroupDeliveryOrder.forklift_driver_ids` — chính nó quyết định bảng "Cần đưa ra" hiện việc cho AI.
-- Máy chủ (`validForkliftIds`) đang gác 2 điều: người còn làm việc + thuộc kho của chuyến. KHÔNG gác
-- VAI TRÒ. Ô chọn trên màn hình có lọc, nhưng lọc bằng cách **so tên chức danh chứa "lái xe nâng"**
-- (OutboundDetail.tsx) — vừa là luật chép ở FE, vừa vi phạm luật "vai trò đọc theo CỜ, không so tên
-- tiếng Việt": đổi tên chức danh trong danh mục là ô chọn rỗng mà không lỗi nào nổ.
--
-- Hậu quả ĐO ĐƯỢC trên staging 18/09: 3 chuyến ĐANG XUẤT của Ba Vì (…_120926_84/85/86) có **Admin**
-- và **SIMDAY Bot** đứng tên lái xe nâng — cả hai đều lọt vì "có thật" + "đúng kho", và cả hai đều
-- KHÔNG có chức danh. Hệ quả: bảng việc của Admin hiện việc không phải của mình, và khối Giám sát
-- → "theo người" đếm sai công của cả kho.
--
-- BACKFILL theo đúng tên đang dùng ⇒ sau migration hành vi GIỮ NGUYÊN 100%:
--   "Lái xe nâng" (17 người) · "Trường nhóm Lái xe nâng" (1) — đúng tập mà bộ lọc chuỗi đang bắt.

ALTER TABLE "JobTitle" ADD COLUMN IF NOT EXISTS is_forklift_driver boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "JobTitle".is_forklift_driver IS
  'Chức danh LÁI XE NÂNG — ô chọn "Lái xe nâng" lúc Bắt đầu chuyến và cửa gác của máy chủ đọc cờ này, KHÔNG so tên';

UPDATE "JobTitle" SET is_forklift_driver = true
 WHERE lower(name) LIKE '%lái xe nâng%' AND is_forklift_driver = false;

-- Gác: backfill trượt (tên đã bị đổi trước đó) ⇒ deploy xong là KHÔNG ai chọn được lái xe nâng, và
-- kho Hướng dẫn không Bắt đầu nổi chuyến nào (422 FORKLIFT_REQUIRED). Thà dừng ở đây còn hơn.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "JobTitle" WHERE is_forklift_driver;
  IF n = 0 THEN
    RAISE EXCEPTION 'Backfill cờ lái xe nâng trượt: 0 chức danh được tick — kiểm tên chức danh trong danh mục rồi tick tay TRƯỚC khi deploy code mới';
  END IF;
END $$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260918b_pallet_ledger_dedupe_fill.sql]  (đã gỡ 1 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- SỔ PALLET — bỏ dòng TRÙNG khi hạ hàng xuống kho lẻ (18/09/2026)
--
-- 18/09 vá lớp lỗi 'hai cửa cùng một sổ mà khác luật': 5 cửa chuyển ô pallet nhưng chỉ 3 cửa ghi
-- sổ Chuyển vị trí. Nối nốt 2 cửa còn lại (quét lệnh fill · đặt phần dư khi quét xuất) thì sinh
-- hệ quả: nguồn 3 (StocktakeLog → MOVED) và nguồn 6 (FillTaskScan → FILLED) cùng kể MỘT lần hạ,
-- cùng rơi vào nhóm STOCK.
--
-- Cửa 'đặt phần dư khi xuất' KHÔNG trùng: PICKED (hàng đi ra) và MOVED (phần dư đổi chỗ) là hai
-- việc khác nhau, kể cả hai là đúng. Chỉ fill mới trùng.
--
-- Giữ FILLED, bỏ MOVED tương ứng — vì FILLED giàu hơn (có số lượng + mã lệnh). Dòng MOVED vẫn
-- nằm trong DB và vẫn hiện ở tab Lịch sử của màn Chuyển vị trí (nơi câu hỏi là 'pallet đổi ô mấy
-- lần'), chỉ không hiện lần thứ hai trong Sổ pallet.
-- ============================================================================

DROP FUNCTION IF EXISTS public.pallet_ledger(text, text[], integer);
CREATE OR REPLACE FUNCTION public.pallet_ledger(
  p_pallet_code  text,
  p_warehouse_ids text[] DEFAULT NULL,   -- NULL = không giới hạn (user phạm vi toàn quốc)
  p_limit        integer DEFAULT 400
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_events jsonb;
  v_pallet jsonb;
BEGIN
  WITH ev AS (
    -- 1. SX GHI SỔ ĐÓNG GÓI — pallet ra đời
    SELECT COALESCE(pl.close_scan_at, pl.open_scan_at, pl.created_at) AS at,
           'PACKED'::text            AS kind,
           pl.packed_by_name         AS actor,
           NULL::text                AS from_code,
           NULL::text                AS to_code,
           pl.qty_cartons            AS qty_base,   -- cột tên "cartons" nhưng GIÁ TRỊ là base (xem đầu file)
           NULL::numeric             AS qty_cartons, -- giữ ô này rỗng: không nguồn nào ghi theo thùng
           pl.warehouse_id           AS warehouse_id,
           NULLIF(pl.machine_code,'') AS ref,
           pl.note                   AS note
      FROM public.packing_logs pl
     WHERE pl.pallet_code = p_pallet_code AND pl.status <> 'CANCELLED'

    UNION ALL
    -- 2. VÀO SỔ TỒN (nhập kho / tách ra pallet con) — dòng InventoryEntry được tạo
    SELECT ie.created_at, 'RECEIVED', emp.name,
           NULL, loc.location_code, ie.cartons_imported, NULL,
           ie.warehouse_id,
           CASE WHEN ie.parent_pallet_code IS NOT NULL THEN 'tách từ ' || ie.parent_pallet_code END,
           NULL
      FROM public."InventoryEntry" ie
      LEFT JOIN public."Location" loc ON loc.id = ie.location_id
      LEFT JOIN public."Employee" emp ON emp.id = ie.created_by
     WHERE ie.pallet_code = p_pallet_code

    UNION ALL
    -- 3. CHUYỂN VỊ TRÍ / KIỂM KÊ — một sổ, phân biệt bằng location_changed_to
    SELECT sl.counted_at,
           CASE WHEN sl.location_changed_to IS NOT NULL THEN 'MOVED' ELSE 'COUNTED' END,
           sl.counted_by_name, sl.location_from_code, sl.location_code,
           sl.physical_qty, NULL, sl.warehouse_id, NULL, sl.note
      FROM public."StocktakeLog" sl
     WHERE sl.pallet_code = p_pallet_code
       -- KHÔNG KỂ HAI LẦN MỘT VIỆC (18/09): từ hôm nay cửa quét lệnh fill cũng ghi vào sổ chuyển
       -- vị trí (trước đó nó chuyển chỗ pallet mà KHÔNG để lại vết nào — tab Lịch sử của màn
       -- Chuyển vị trí im lặng về đúng việc mà lệnh fill sinh ra). Nhưng nguồn 6 dưới đây ĐÃ kể
       -- lần hạ đó rồi, lại kể giàu hơn (có số lượng + mã lệnh), nên nếu để nguyên thì một lần hạ
       -- hiện THÀNH HAI DÒNG trong cùng nhóm STOCK — đúng thứ mà cả hàm này cố tránh ('thứ cần
       -- đọc chìm nghỉm'). Bỏ dòng MOVED nào đã có vết quét fill khớp (cùng pallet, cùng ô đến,
       -- lệch giờ dưới 2 phút). So theo DỮ LIỆU, KHÔNG so theo câu chữ của ghi chú.
       -- Vết fill bị xoá sau này (xoá lệnh ⇒ CASCADE) thì dòng MOVED tự hiện lại: nó là bản ghi
       -- BỀN (FK entry_id chỉ SET NULL), nên sổ không bao giờ mất trắng lần hạ đó.
       AND NOT (
         sl.location_changed_to IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public."FillTaskScan" fs
            WHERE fs.pallet_code     = sl.pallet_code
              AND fs.to_location_id  = sl.location_changed_to
              AND fs.created_at BETWEEN sl.counted_at - interval '2 minutes'
                                    AND sl.counted_at + interval '2 minutes'
         )
       )

    UNION ALL
    -- 4. ĐIỀU CHỈNH TỒN (+/-)
    SELECT al.adjusted_at, 'ADJUSTED', al.actor_name, NULL, NULL,
           al.delta, NULL, ie.warehouse_id,
           ie.cartons_remaining::text, al.note
      FROM public."InventoryAdjustmentLog" al
      JOIN public."InventoryEntry" ie ON ie.id = al.entry_id
     WHERE ie.pallet_code = p_pallet_code

    UNION ALL
    -- 5. DỒN / TÁCH PALLET — tem có thể là NGUỒN hoặc ĐÍCH của thao tác
    SELECT po.created_at,
           CASE WHEN po.type = 'MERGE' THEN 'MERGED'
                WHEN po.type = 'SPLIT' THEN 'SPLIT'
                ELSE 'UNGROUPED' END,
           po.operated_by_name, NULL, NULL, NULL, NULL, po.warehouse_id,
           NULL,
           CASE WHEN p_pallet_code = ANY(po.source_codes) THEN 'tem này là NGUỒN'
                ELSE 'tem này là KẾT QUẢ' END
      FROM public."PalletOperation" po
     WHERE (po.source_codes @> ARRAY[p_pallet_code] OR po.target_codes @> ARRAY[p_pallet_code])
       AND po.undone_at IS NULL

    UNION ALL
    -- 5b. …và lần HOÀN TÁC thao tác đó (nếu có) là một tác động riêng
    SELECT po.undone_at, 'UNDONE', po.undone_by_name, NULL, NULL, NULL, NULL, po.warehouse_id,
           NULL, 'hoàn tác ' || po.type
      FROM public."PalletOperation" po
     WHERE (po.source_codes @> ARRAY[p_pallet_code] OR po.target_codes @> ARRAY[p_pallet_code])
       AND po.undone_at IS NOT NULL

    UNION ALL
    -- 6. HẠ XUỐNG KHO LẺ (quét lệnh fill)
    SELECT fs.created_at, 'FILLED', fs.scanned_by_name,
           fs.from_location_code, fs.to_location_code, fs.qty_base, NULL,
           loc.warehouse_id, fo.order_code, NULL
      FROM public."FillTaskScan" fs
      LEFT JOIN public."Location"  loc ON loc.id = fs.to_location_id
      LEFT JOIN public."FillOrder" fo  ON fo.id  = fs.fill_order_id
     WHERE fs.pallet_code = p_pallet_code

    UNION ALL
    -- 7. XUẤT HÀNG (quét tem ở cửa) — chứng từ = Số xe của chuyến
    SELECT ose.scanned_at AT TIME ZONE 'UTC', 'PICKED', emp.name, NULL, NULL,
           ose.cartons_scanned, NULL, g.warehouse_id,
           COALESCE(g.group_code, g.license_plate),
           CASE WHEN ose.is_loose_picking THEN 'nhặt lẻ' END
      FROM public."OutboundScanEntry" ose
      LEFT JOIN public."Employee"          emp ON emp.id = ose.scanned_by
      LEFT JOIN public."OutboundItem"      oi  ON oi.id  = ose.item_id
      LEFT JOIN public."OutboundDelivery"  od  ON od.id  = oi.do_id
      LEFT JOIN public."GroupDeliveryOrder" g  ON g.id   = od.gdo_id
     WHERE ose.pallet_code = p_pallet_code

    UNION ALL
    -- 8. NHẬT KÝ VIỆC (Việc cần làm) — giao việc, nhận, hạ, đưa ra, hệ thống huỷ.
    -- CHỈ việc có ghim tem mới vào đây: lệnh fill chỉ định theo mã + date nên không gắn pallet nào
    -- cho tới lúc quét (lúc đó đã nằm ở nguồn 6).
    SELECT e.at, 'TASK_' || e.event, e.actor,
           t.from_location_code, COALESCE(dl.location_code, tl.location_code),
           NULL, NULL, t.warehouse_id,
           COALESCE(g.group_code, g.license_plate), e.note
      FROM public.wms_task_events e
      JOIN public.wms_tasks t ON t.id = e.task_id
      LEFT JOIN public."Location" dl ON dl.id = t.drop_location_id
      LEFT JOIN public."Location" tl ON tl.id = t.to_location_id
      LEFT JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
     WHERE t.pallet_code = p_pallet_code
  )
  -- HAI NHÓM, KHÔNG TRỘN (đo ngay lượt chạy đầu 17/09): một pallet ở Ba Vì có **105 dòng nhật ký
  -- việc** (máy lập kế hoạch rồi huỷ qua nhiều chuyến) trong khi tác động THẬT lên hàng chỉ có 2
  -- (nhập kho · xuất). Đổ chung một danh sách thì thứ cần đọc chìm nghỉm. `grp='STOCK'` = hàng thật
  -- sự bị động vào; `grp='TASK'` = việc được giao/nhận/huỷ. Cũng đúng cách SAP chia: MB51 là chứng
  -- từ vật tư, còn lệnh kho nằm ở LT23/LT24 riêng.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'grp', CASE WHEN x.kind LIKE 'TASK\_%' THEN 'TASK' ELSE 'STOCK' END,
           'at', x.at, 'kind', x.kind, 'actor', x.actor,
           'from_code', x.from_code, 'to_code', x.to_code,
           'qty_base', x.qty_base, 'qty_cartons', x.qty_cartons,
           'warehouse_id', x.warehouse_id, 'ref', x.ref, 'note', x.note
         ) ORDER BY x.at), '[]'::jsonb)
    INTO v_events
    FROM (
      -- Trần áp cho TỪNG NHÓM, không áp cho cả danh sách: pallet bị lập kế hoạch đi lập kế hoạch lại
      -- có hàng trăm dòng việc, cắt phẳng theo thời gian sẽ hất văng chính mấy dòng "hàng đã bị động
      -- vào" — thứ duy nhất người tra cần. Mỗi nhóm giữ bản GẦN ĐÂY NHẤT rồi sắp lại theo thời gian.
      SELECT * FROM (
        SELECT ev.*,
               row_number() OVER (
                 PARTITION BY (CASE WHEN ev.kind LIKE 'TASK\_%' THEN 'TASK' ELSE 'STOCK' END)
                 ORDER BY ev.at DESC
               ) AS rn
          FROM ev
         WHERE ev.at IS NOT NULL
           -- Cắt phạm vi kho, null-inclusive như mọi chỗ khác trong app (bản ghi không khai kho vẫn hiện)
           AND (p_warehouse_ids IS NULL OR ev.warehouse_id IS NULL OR ev.warehouse_id = ANY(p_warehouse_ids))
      ) z
      WHERE z.rn <= GREATEST(1, LEAST(p_limit, 2000))
    ) x;

  -- Ảnh hiện tại của tem (có thể nhiều dòng nếu tem từng được dùng lại sau khi xuất hết)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'entry_id', ie.id, 'status', ie.status, 'warehouse_id', ie.warehouse_id,
           'warehouse_name', w.name, 'location_code', loc.location_code,
           'material_code', m.material_code, 'material_name', m.short_name, 'category', m.category,
           'entry_unit', m.entry_unit, 'base_unit', m.base_unit, 'units_per_carton', m.units_per_carton,
           'cartons_imported', ie.cartons_imported, 'cartons_remaining', ie.cartons_remaining,
           'production_date', ie.production_date, 'expiry_date', ie.expiry_date, 'batch', ie.batch,
           'import_date', ie.import_date
         ) ORDER BY ie.created_at), '[]'::jsonb)
    INTO v_pallet
    FROM public."InventoryEntry" ie
    LEFT JOIN public."Location"  loc ON loc.id = ie.location_id
    LEFT JOIN public."Warehouse" w   ON w.id   = ie.warehouse_id
    LEFT JOIN public."Material"  m   ON m.id   = ie.material_id
   WHERE ie.pallet_code = p_pallet_code
     AND (p_warehouse_ids IS NULL OR ie.warehouse_id IS NULL OR ie.warehouse_id = ANY(p_warehouse_ids));

  RETURN jsonb_build_object('pallet_code', p_pallet_code, 'entries', v_pallet, 'events', v_events);
END $$;

REVOKE ALL ON FUNCTION public.pallet_ledger(text, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pallet_ledger(text, text[], integer) TO service_role;

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260922_zsd02_source.sql]
-- ─────────────────────────────────────────────────────────────────────────
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



-- ─────────────────────────────────────────────────────────────────────────
-- [20260922b_erp_so_lines_summary.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- Ô tổng của tab "Chưa có OD" (sổ SO) — đếm/cộng TRONG SQL trên toàn bộ bộ lọc (không kéo dòng về Node cộng tay).
-- Cùng mệnh đề WHERE với list ở zsd02Controller.listSoLines. Tải = SAP tham chiếu (sap_pallets, gross_weight_kg)
-- vì sổ SO chỉ để nhìn trước; tải theo master tính ở tầng chuyến.
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
    'sap_pallets', round(coalesce(sum(sap_pallets) FILTER (WHERE status = 'OPEN'), 0), 1),
    'kg',          round(coalesce(sum(gross_weight_kg) FILTER (WHERE status = 'OPEN'), 0), 1)
  ) FROM w;
$$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260922c_zsd02_rls_and_sloc_exempt.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260922c — Hai vi phạm bất biến gói 00 do đợt 0 ZSD02 (20260922) để lại  (22/09/2026)
-- ----------------------------------------------------------------------------
-- Bậc fast chạy SAU khi áp 20260922 lên staging bắt ra hai điều mà bậc offline không thấy:
--
-- (1) HAI BẢNG MỚI QUÊN BẬT RLS: `erp_so_lines` + `sap_route`. Hôm nay anon/authenticated đã
--     0 quyền bảng trong public (20260902c) nên chưa đọc được gì, nhưng RLS là lớp thứ hai —
--     bảng nào cũng phải bật (bất biến "Mọi bảng public đều bật RLS", RPC rls_gap_tables).
--
-- (2) `erp_outbound_orders.storage_location` + `erp_so_lines.storage_location` MANG GIÁ TRỊ TRÙNG
--     mã Loại kho (FG01/FG02/PM01) mà không nằm trong cascade `rename_warehouse_type`.
--     KHÔNG đưa vào cascade — đây là mã STORAGE LOCATION THÔ của SAP chép nguyên từ file
--     (cùng bản chất với `Warehouse.sap_storage_locations`, cột KHAI mã SAP để khớp phạm vi kho):
--       • đổi tên Loại kho trong app KHÔNG đổi được mã SAP; lần nạp ZSD02/VL06O kế tiếp lại ghi
--         FG01 vào chính dòng đó ⇒ cascade chỉ tạo dữ liệu lẫn lộn (dòng cũ FGX, dòng mới FG01);
--       • `sapScopeCheck` so `storage_location` với `Warehouse.sap_storage_locations` — hai bên
--         cùng là mã SAP, cùng đứng ngoài cascade thì mới tiếp tục khớp nhau;
--       • cùng lớp với `Material.product_type` đã miễn trừ 15/08 ("trùng chữ nhưng KHÁC NGHĨA").
--     ⇒ Thêm 3 cột mã-SAP-thô vào danh sách miễn trừ của RPC gác `warehouse_type_column_coverage`
--     (`Warehouse.sap_storage_locations` đưa vào luôn dù staging đang rỗng — cùng bản chất, để lúc
--     kho khai Sloc thì phép kiểm không đỏ oan). Thân RPC còn lại giữ nguyên bản 20260815b.
--
-- Vì sao lọt: đợt 0 chỉ chạy cổng OFFLINE trước khi push; bất biến toàn DB (RLS, độ phủ cascade)
-- phải áp migration rồi mới đo được ⇒ sau migration mới PHẢI chạy `--tier fast` đầy đủ.
-- CÁCH CHẠY: Supabase Dashboard → SQL Editor → dán → Run. Apply CẢ staging LẪN production.
-- ============================================================================

-- [cutover] gỡ: BEGIN;

-- ── 1) RLS cho hai bảng mới ─────────────────────────────────────────────────
ALTER TABLE public.erp_so_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sap_route    ENABLE ROW LEVEL SECURITY;

-- ── 2) RPC gác độ phủ cascade: miễn trừ cột mã SAP thô ──────────────────────
CREATE OR REPLACE FUNCTION public.warehouse_type_column_coverage()
 RETURNS TABLE(tbl text, col text, n bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  vals text[];
  def  text;
  r    record;
  hit  boolean;
BEGIN
  SELECT array_agg(value) INTO vals FROM "LookupValue" WHERE type = 'warehouse_type';
  IF vals IS NULL OR array_length(vals, 1) = 0 THEN RETURN; END IF;

  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'rename_warehouse_type';
  IF def IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy rename_warehouse_type — không kiểm được độ phủ';
  END IF;

  FOR r IN
    SELECT c.table_name t, c.column_name cl, c.data_type dt
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
     WHERE c.table_schema = 'public' AND tb.table_type = 'BASE TABLE'
       AND (c.data_type IN ('text', 'character varying')
            OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text', '_varchar')))
       -- MIỄN TRỪ: như bản cũ (backup đóng băng · sổ migration · danh mục gốc · trùng chữ khác nghĩa)
       AND c.table_name NOT LIKE 'x\_bak\_%' AND c.table_name NOT LIKE 'bak\_%'
       AND c.table_name <> '_prisma_migrations'
       AND c.table_name <> 'x_seed_manifest'
       AND NOT (c.table_name = 'LookupValue'   AND c.column_name = 'value')
       AND NOT (c.table_name = 'Material'      AND c.column_name = 'product_type')
       AND NOT (c.table_name = 'WarehouseZone' AND c.column_name = 'code')
       AND NOT (c.table_name = 'Location'      AND c.column_name = 'sub_code')
       -- MIỄN TRỪ 22/09: mã STORAGE LOCATION THÔ của SAP (chép nguyên từ VL06O/ZSD02, và cột khai
       -- mã SAP theo kho để khớp phạm vi). Trùng chữ với Loại kho vì taxonomy 15/08 lấy theo mã SAP,
       -- nhưng đổi tên Loại kho trong app không đổi được mã SAP — cascade vào đây chỉ làm dữ liệu lẫn.
       AND NOT (c.table_name = 'erp_outbound_orders' AND c.column_name = 'storage_location')
       AND NOT (c.table_name = 'erp_so_lines'        AND c.column_name = 'storage_location')
       AND NOT (c.table_name = 'Warehouse'           AND c.column_name = 'sap_storage_locations')
  LOOP
    CONTINUE WHEN def ~ format('UPDATE\s+"?%s"?\s+SET[^;]*%s', r.t, r.cl);

    -- EXISTS thay count(*): cột CÓ giá trị dừng ở dòng đầu; cột KHÔNG có vẫn phải quét hết nhưng
    -- không còn chi phí gom đếm. n trả 1 (mục đích của phép kiểm là danh sách cột, không phải số dòng).
    EXECUTE CASE WHEN r.dt = 'ARRAY'
      THEN format('SELECT EXISTS(SELECT 1 FROM %I WHERE %I && $1)', r.t, r.cl)
      ELSE format('SELECT EXISTS(SELECT 1 FROM %I WHERE %I IS NOT NULL AND string_to_array(%I, ''+'') && $1)', r.t, r.cl, r.cl)
    END INTO hit USING vals;

    IF hit THEN
      tbl := r.t; col := r.cl; n := 1; RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

-- ── 3) KIỂM ngay trong transaction ──────────────────────────────────────────
DO $$
DECLARE bad int; gaps text;
BEGIN
  SELECT count(*) INTO bad FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN ('erp_so_lines', 'sap_route')
     AND NOT c.relrowsecurity;
  IF bad > 0 THEN RAISE EXCEPTION 'RLS chưa bật trên % bảng', bad; END IF;

  SELECT string_agg(tbl || '.' || col, ', ') INTO gaps FROM warehouse_type_column_coverage();
  IF gaps IS NOT NULL THEN RAISE EXCEPTION 'Cascade đổi tên Loại kho còn sót: %', gaps; END IF;
END $$;

-- [cutover] gỡ: COMMIT;

-- KIỂM SAU KHI CHẠY
--   SELECT * FROM rls_gap_tables();                           -- phải rỗng
--   SELECT * FROM warehouse_type_column_coverage();          -- phải 0 dòng


COMMIT;
-- === HẾT PART 9/10 ===
