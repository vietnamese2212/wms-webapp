-- 24/08/2026 — Trang NHẶT LẺ: filter "Loại kho" phải theo LOẠI CỦA MÃ ĐANG NHẶT LẺ,
-- không theo hàng xe CHỞ (GroupDeliveryOrder.warehouse_type là chuỗi ghép 'FG01+PM01').
-- Bug user bắt 24/08: chuyến chở lẫn FG01+PM01 nhưng FG lẻ = 0 (vượt trần nhặt lẻ) → filter
-- FG01 vẫn hiện chuyến chỉ còn POSM. Trang Nhặt lẻ là danh sách VIỆC NHẶT, nên filter đi theo
-- Material.category của item có loose_picking > 0.
-- GIỮ NGUYÊN: p_cat_scope (quyền theo loại) vẫn cắt ở cấp CHUYẾN giao ≥1 (luật 30/07 —
-- chuyến là 1 xe vật lý); chỉ p_wh_types (filter user chọn) + facets wh_types đổi sang item-level.

-- ── loose_picking_facets ──
CREATE OR REPLACE FUNCTION public.loose_picking_facets(p_wh_scope text[], p_cat_scope text[], p_warehouse_id text, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
  RETURN (
    WITH j AS (
      SELECT DISTINCT g.id, i.export_type, g.dvvt, d.distributor_name, m.category
      FROM "OutboundItem" i
      JOIN "OutboundDelivery"   d ON d.id = i.do_id
      JOIN "GroupDeliveryOrder" g ON g.id = d.gdo_id AND g.status <> 'CANCELLED'
      LEFT JOIN "Material"      m ON m.id = i.material_id
      WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
        AND (p_from IS NULL OR g.delivery_date >= p_from)
        AND (p_to   IS NULL OR g.delivery_date <= p_to)
        AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
        AND (p_wh_scope  IS NULL OR g.warehouse_id = ANY (p_wh_scope))
        AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR wt_cats(g.warehouse_type) && p_cat_scope)
    )
    SELECT jsonb_build_object(
      'dvvts',        COALESCE((SELECT jsonb_agg(DISTINCT dvvt)             FROM j WHERE dvvt IS NOT NULL), '[]'::jsonb),
      'npps',         COALESCE((SELECT jsonb_agg(DISTINCT distributor_name) FROM j WHERE distributor_name IS NOT NULL), '[]'::jsonb),
      'wh_types',     COALESCE((SELECT jsonb_agg(DISTINCT category)         FROM j WHERE category IS NOT NULL), '[]'::jsonb),
      'export_types', COALESCE((SELECT jsonb_agg(DISTINCT export_type)      FROM j WHERE export_type IS NOT NULL), '[]'::jsonb)
    )
  );
END $function$;

-- ── loose_picking_page ──
CREATE OR REPLACE FUNCTION public.loose_picking_page(p_wh_scope text[], p_cat_scope text[], p_warehouse_id text, p_from date, p_to date, p_wh_types text[], p_export_types text[], p_dvvts text[], p_npps text[], p_search text, p_offset integer, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE r jsonb; s text;
BEGIN
  s := CASE WHEN p_search IS NULL OR btrim(p_search) = '' THEN NULL
            ELSE lower(immutable_unaccent(btrim(p_search))) END;

  WITH it AS (
    SELECT i.id, i.do_id, i.material_id, i.material_code_raw,
           i.cartons_ordered, i.cartons_scanned, i.loose_picking, i.export_type
    FROM "OutboundItem" i
    WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
  ),
  j AS (
    SELECT it.*, d.gdo_id, d.distributor_name,
           g.group_code, g.dvvt, g.warehouse_type, g.delivery_date,
           m.entry_unit, m.units_per_carton, m.short_name, m.material_code, m.category,
           COALESCE(ls.done, 0) AS loose_scanned
    FROM it
    JOIN "OutboundDelivery"    d ON d.id = it.do_id
    JOIN "GroupDeliveryOrder"  g ON g.id = d.gdo_id AND g.status <> 'CANCELLED'
    LEFT JOIN "Material"       m ON m.id = it.material_id
    LEFT JOIN LATERAL (
      SELECT sum(se.cartons_scanned) AS done
      FROM "OutboundScanEntry" se
      WHERE se.item_id = it.id AND se.is_loose_picking
    ) ls ON TRUE
    WHERE (p_from IS NULL OR g.delivery_date >= p_from)
      AND (p_to   IS NULL OR g.delivery_date <= p_to)
      AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
      AND (p_wh_scope  IS NULL OR g.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR wt_cats(g.warehouse_type) && p_cat_scope)
  ),
  st AS (
    SELECT j.*,
           GREATEST(0, loose_picking
                       - GREATEST(0, (cartons_scanned - loose_scanned)
                                     - (cartons_ordered - loose_picking))) AS effective
    FROM j
  ),
  st2 AS (
    SELECT st.*, LEAST(loose_scanned, effective) AS done FROM st
  ),
  gg AS (
    SELECT gdo_id,
           max(group_code)     AS group_code,
           max(delivery_date)  AS delivery_date,
           count(*)            AS items_n,
           count(*) FILTER (WHERE effective - done > 0) AS pending_n,
           sum(qty_entry_decimal(effective, entry_unit, units_per_carton)) AS loose_total,
           sum(qty_entry_decimal(done,      entry_unit, units_per_carton)) AS loose_done,
           max(export_type)    AS export_type,
           max(dvvt)           AS dvvt,
           array_agg(DISTINCT category) FILTER (WHERE category IS NOT NULL) AS cats,
           array_agg(DISTINCT distributor_name) FILTER (WHERE distributor_name IS NOT NULL) AS npps,
           lower(immutable_unaccent(
             concat_ws(' ', max(group_code), max(export_type), max(dvvt),
                            string_agg(DISTINCT distributor_name, ' '),
                            string_agg(DISTINCT COALESCE(material_code, material_code_raw), ' '),
                            string_agg(DISTINCT short_name, ' ')))) AS hay
    FROM st2 GROUP BY gdo_id
  ),
  f AS (
    SELECT * FROM gg
    WHERE (p_wh_types     IS NULL OR cats && p_wh_types)
      AND (p_export_types IS NULL OR export_type    = ANY (p_export_types))
      AND (p_dvvts        IS NULL OR dvvt           = ANY (p_dvvts))
      AND (p_npps         IS NULL OR npps && p_npps)
      AND (s IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(string_to_array(s, ' ')) t
            WHERE t <> '' AND position(t IN hay) = 0))
  ),
  pg AS (
    SELECT gdo_id FROM f ORDER BY delivery_date, group_code, gdo_id OFFSET p_offset LIMIT p_limit
  ),
  -- gdo object dựng MỘT LẦN per chuyến (mirror payload controller cũ: gdo + warehouse embed +
  -- distributor_names từ MỌI delivery của chuyến + export_type = item nhặt lẻ ĐẦU TIÊN có khai)
  gdoj AS (
    SELECT pg.gdo_id,
           jsonb_build_object(
             'id', g.id, 'group_code', g.group_code, 'delivery_date', g.delivery_date,
             'planned_date', g.planned_date, 'status', g.status, 'started_at', g.started_at,
             'dvvt', g.dvvt, 'warehouse_type', g.warehouse_type,
             'warehouse', CASE WHEN w.id IS NULL THEN NULL ELSE
               jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name) END,
             'distributor_names', COALESCE((
               SELECT jsonb_agg(DISTINCT d2.distributor_name)
               FROM "OutboundDelivery" d2
               WHERE d2.gdo_id = g.id AND d2.distributor_name IS NOT NULL), '[]'::jsonb),
             'export_type', (
               SELECT i2.export_type
               FROM "OutboundDelivery" d3 JOIN "OutboundItem" i2 ON i2.do_id = d3.id
               WHERE d3.gdo_id = g.id AND i2.loose_picking > 0 AND i2.status <> 'CANCELLED'
                 AND i2.export_type IS NOT NULL
               ORDER BY i2.id LIMIT 1)
           ) AS gdo
    FROM pg
    JOIN "GroupDeliveryOrder" g ON g.id = pg.gdo_id
    LEFT JOIN "Warehouse" w ON w.id = g.warehouse_id
  )
  SELECT jsonb_build_object(
    'gdo_ids',     COALESCE((SELECT jsonb_agg(gdo_id) FROM pg), '[]'::jsonb),
    -- MỚI: item đầy đủ (to_jsonb toàn bộ cột như select '*' cũ) + material + gdo + loose_scanned
    'items',       COALESCE((
      SELECT jsonb_agg(to_jsonb(i)
               || jsonb_build_object(
                    'material', CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object(
                      'id', m.id, 'material_code', m.material_code, 'short_name', m.short_name,
                      'base_unit', m.base_unit, 'entry_unit', m.entry_unit,
                      'units_per_carton', m.units_per_carton) END,
                    'gdo', gdoj.gdo,
                    'loose_scanned', COALESCE(ls.done, 0))
               ORDER BY i.id)
      FROM gdoj
      JOIN "OutboundDelivery" d ON d.gdo_id = gdoj.gdo_id
      JOIN "OutboundItem" i ON i.do_id = d.id AND i.loose_picking > 0 AND i.status <> 'CANCELLED'
      LEFT JOIN "Material" m ON m.id = i.material_id
      LEFT JOIN LATERAL (
        SELECT sum(se.cartons_scanned) AS done
        FROM "OutboundScanEntry" se
        WHERE se.item_id = i.id AND se.is_loose_picking
      ) ls ON TRUE), '[]'::jsonb),
    'total',       (SELECT count(*)                FROM f),
    'items_n',     (SELECT COALESCE(sum(items_n), 0)     FROM f),
    'pending_n',   (SELECT COALESCE(sum(pending_n), 0)   FROM f),
    'loose_total', (SELECT COALESCE(sum(loose_total), 0)  FROM f),
    'loose_done',  (SELECT COALESCE(sum(loose_done), 0)   FROM f)
  ) INTO r;
  RETURN r;
END $function$;
