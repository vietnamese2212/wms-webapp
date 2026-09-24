-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- CHỐT %DATE HÀNG LOẠT TRÊN NHIỀU CHUYẾN — nguồn dữ liệu cho màn "Chốt %Date" (user chốt 10/09):
--   "trước lúc xuất hàng, nv SAP vào kiểm tra TẤT CẢ các đơn hàng sau đó input dữ liệu vào …
--    cần nhìn hết đơn hàng (dạng filter được) và thấy tất cả các dòng sau đó input"
--
-- Vì sao là RPC chứ không phải vài câu PostgREST: màn này đọc DÒNG HÀNG của MỌI chuyến trong một
-- khoảng ngày (một ngày ở Ba Vì ≈ 50 chuyến × 8 dòng; cả tuần vài nghìn dòng) — kéo về Node rồi lọc
-- là dính trần 1.000 dòng và tốn nhiều lượt trên pool 10 khe của PostgREST. Một lời gọi trả CẢ
-- dòng + tổng + số trang.
--
-- Luật đã có, KHÔNG chép lại: loại kho ghép ('FG01+PM01') so bằng wt_cats() && mảng (giao ≥ 1);
-- chuỗi tìm kiếm escape bằng like_esc().
-- ══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.outbound_date_rule_lines(
  p_from          date,
  p_to            date,
  p_scope_wh      text[] DEFAULT NULL,   -- phạm vi kho của NGƯỜI GỌI (NULL = toàn quốc)
  p_warehouse_id  text   DEFAULT NULL,   -- bộ lọc "Kho" trên màn
  p_categories    text[] DEFAULT NULL,   -- phạm vi Loại kho của người gọi (NULL = mọi loại)
  p_state         text   DEFAULT 'ALL',  -- ALL | SET (đã chốt) | UNSET (chưa chốt)
  p_search        text   DEFAULT NULL,
  p_limit         int    DEFAULT 200,
  p_offset        int    DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  v_like  text := CASE WHEN coalesce(p_search, '') = '' THEN NULL
                       ELSE '%' || public.like_esc(lower(p_search)) || '%' END;
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
      d.delivery_code, d.distributor_name,
      i.material_id,
      i.material_code_raw                    AS material_code,
      m.short_name                           AS material_name,
      m.units_per_carton, m.base_unit, m.entry_unit,
      i.cartons_ordered, i.cartons_scanned,
      greatest(0, coalesce(i.cartons_ordered, 0) - coalesce(i.cartons_scanned, 0)) AS remaining,
      i.header_text, i.batch_required, i.date_required, i.date_rule,
      -- ĐÃ CHỐT = có date_rule mới, HOẶC %Date yêu cầu cũ của VL06O > 0 (đọc tương thích)
      (i.date_rule IS NOT NULL OR coalesce(i.date_required, 0) > 0) AS is_set
      FROM public."OutboundItem" i
      JOIN public."OutboundDelivery" d   ON d.id = i.do_id
      JOIN public."GroupDeliveryOrder" g ON g.id = d.gdo_id
      LEFT JOIN public."Warehouse" w     ON w.id = g.warehouse_id
      LEFT JOIN public."Material" m      ON m.id = i.material_id
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
       AND (v_like IS NULL OR (
              lower(coalesce(b.group_code, ''))       LIKE v_like OR
              lower(coalesce(b.license_plate, ''))    LIKE v_like OR
              lower(coalesce(b.distributor_name, '')) LIKE v_like OR
              lower(coalesce(b.delivery_code, ''))    LIKE v_like OR
              lower(coalesce(b.material_code, ''))    LIKE v_like OR
              lower(coalesce(b.material_name, ''))    LIKE v_like OR
              lower(coalesce(b.header_text, ''))      LIKE v_like))
  )
  SELECT
    coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.delivery_date, t.group_code, t.delivery_code, t.material_code), '[]'::jsonb),
    (SELECT count(*) FROM filtered),
    (SELECT jsonb_build_object(
        'lines',     count(*),
        'set',       count(*) FILTER (WHERE is_set),
        'unset',     count(*) FILTER (WHERE NOT is_set),
        'with_note', count(*) FILTER (WHERE coalesce(header_text, '') <> ''),
        'trips',     count(DISTINCT gdo_id))
       FROM filtered)
    INTO v_rows, v_total, v_sum
    FROM (SELECT * FROM filtered
           ORDER BY delivery_date, group_code, delivery_code, material_code
           LIMIT greatest(1, least(coalesce(p_limit, 200), 1000)) OFFSET greatest(0, coalesce(p_offset, 0))) t;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total, 'summary', v_sum);
END $$;

REVOKE ALL ON FUNCTION public.outbound_date_rule_lines(date, date, text[], text, text[], text, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outbound_date_rule_lines(date, date, text[], text, text[], text, text, int, int) TO service_role;
