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
