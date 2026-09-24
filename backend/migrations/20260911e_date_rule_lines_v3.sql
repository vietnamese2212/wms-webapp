-- Trang QUY ĐỊNH DATE (đổi tên từ "Chốt %Date") — bản 3, 11/09/2026 đợt 2.
--
-- Ba thay đổi:
--   1. ẨN dòng có mã KHÔNG ĐO ĐƯỢC DATE (user chốt: "màn này chỉ để xử lý cái nào yêu cầu date").
--      Hệ thống đã tự đặt "không đòi mốc" cho chúng nên không còn gì để người khai quyết. Lọc TRONG
--      SQL, không lọc ở FE — lọc ở FE thì phân trang và ô band đếm sai.
--      Vẫn giữ MỘT ô đếm `no_shelf_life` để con số không biến mất khỏi sổ sách.
--      ⚠️ "Đo được" phụ thuộc CẢ cờ định dạng tem: tem V2 (`;`) mang HSD tường minh nên mã chưa
--      khai hạn dùng vẫn đo được ngày — cắt theo mỗi shelf_life_days là cắt oan cả một đơn vị.
--   2. Trả thêm `material_category` + `shelf_life_days` — "Áp lại theo master" cần loại hàng của mã
--      để tra đúng mức (khách A: FG01 ≥ 70 %, FG02 ≥ 35 ngày).
--   3. Hai bộ lọc mới: theo LOẠI HÀNG của mã và theo KIỂU quy định (% · ngày · không đòi mốc).
--      Cờ `review` nay còn nhận BELOW_MASTER (VL06O thấp hơn mức khách khai) nên lát cắt "cần xem"
--      bắt mọi giá trị khác NULL, đừng so cứng 'NO_STOCK' (thêm cờ mới là lát cắt tự mù).

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
  -- Tem mang HSD tường minh ⇒ đo được date kể cả khi mã chưa khai hạn dùng
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
      -- ĐÃ KHAI = có date_rule mới, HOẶC %Date yêu cầu cũ của VL06O > 0 (đọc tương thích)
      (i.date_rule IS NOT NULL OR coalesce(i.date_required, 0) > 0) AS is_set,
      -- NGUỒN: thiếu khoá 'source' trên quy tắc đã có = người khai tay (dữ liệu trước 11/09)
      CASE WHEN i.date_rule IS NOT NULL           THEN coalesce(i.date_rule->>'source', 'MANUAL')
           WHEN coalesce(i.date_required, 0) > 0  THEN 'SAP'
           ELSE NULL END                       AS source,
      -- KIỂU quy định: date_rule mới, hoặc suy từ %Date cũ của VL06O
      CASE WHEN i.date_rule IS NOT NULL          THEN i.date_rule->>'kind'
           WHEN coalesce(i.date_required, 0) > 0 THEN 'MIN_PCT'
           ELSE NULL END                       AS rule_kind,
      i.date_rule->>'review'                   AS review,
      i.date_rule->>'reason'                   AS reason,
      -- Mã này có ĐO ĐƯỢC date không (xem khối chú thích đầu file)
      (coalesce(m.shelf_life_days, 0) > 0 OR v_expl) AS measurable,
      c.name                                   AS customer_name,
      c.channel                                AS channel,
      (c.id IS NOT NULL)                       AS customer_known,
      -- "Đã có đường cấp mức tự động chưa" — khách khai riêng HOẶC kênh của khách đã khai.
      -- Bản cũ chỉ hỏi "có kênh chưa", nay mức nằm ở date_rule_master nên phải hỏi đúng chỗ đó.
      (EXISTS (SELECT 1 FROM public.date_rule_master r
                WHERE r.scope = 'CUSTOMER' AND r.scope_key = c.id)
       OR EXISTS (SELECT 1 FROM public.date_rule_master r
                   WHERE r.scope = 'CHANNEL' AND r.scope_key = c.channel)) AS customer_has_rule
      FROM public."OutboundItem" i
      JOIN public."OutboundDelivery" d   ON d.id = i.do_id
      JOIN public."GroupDeliveryOrder" g ON g.id = d.gdo_id
      LEFT JOIN public."Warehouse" w     ON w.id = g.warehouse_id
      LEFT JOIN public."Material" m      ON m.id = i.material_id
      -- Khách hàng của chuyến: khoá là mã ship-to của SAP (99,7 % chuyến có). Không có/không khớp
      -- ⇒ customer_known = false ⇒ dòng KHÔNG BAO GIỜ được cấp mức tự động (luật thang ưu tiên).
      LEFT JOIN public."Customer" c      ON c.ship_to_code = upper(btrim(g.shipto_party))
     WHERE g.delivery_date BETWEEN p_from AND p_to
       -- Chỉ chuyến CÒN LÀM ĐƯỢC: hoàn thành/huỷ thì khai date không còn ý nghĩa
       AND g.status IN ('PENDING', 'PAUSED', 'IN_PROGRESS')
       AND coalesce(i.status, '') <> 'CANCELLED'
       AND (p_scope_wh IS NULL OR g.warehouse_id = ANY (p_scope_wh))
       AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
       -- Loại kho: chuyến chở LẪN mang chuỗi ghép ⇒ giao ≥ 1 (null-inclusive như mọi chỗ cắt scope)
       AND (p_categories IS NULL OR g.warehouse_type IS NULL OR public.wt_cats(g.warehouse_type) && p_categories)
  ),
  -- Mã không đo được date: ĐẾM rồi loại khỏi bảng (đã tự có "không đòi mốc", không phải việc của
  -- người khai). Đếm TRƯỚC khi lọc, nếu không thì con số này luôn bằng 0.
  no_sl AS (SELECT count(*) AS n FROM base WHERE NOT measurable),
  shown AS (SELECT * FROM base WHERE measurable),
  filtered AS (
    SELECT * FROM shown b
     WHERE (p_state <> 'SET'   OR b.is_set)
       AND (p_state <> 'UNSET' OR NOT b.is_set)
       -- Lọc NGUỒN: UNSET và REVIEW là hai lát cắt KHÔNG phải giá trị của cột source
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
        -- CẦN XEM: máy đã áp mức nhưng kho không còn pallet nào đạt, HOẶC %Date của VL06O quy ra
        -- ngày còn thấp hơn mức khách đã khai
        'review',     count(*) FILTER (WHERE review IS NOT NULL),
        -- CHƯA KHAI vì khách (và kênh của khách) chưa có mức nào — chỗ để đi khai master
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
