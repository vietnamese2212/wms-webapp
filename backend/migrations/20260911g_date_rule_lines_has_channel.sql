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
