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
