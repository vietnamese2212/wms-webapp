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
