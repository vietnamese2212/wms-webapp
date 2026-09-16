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
