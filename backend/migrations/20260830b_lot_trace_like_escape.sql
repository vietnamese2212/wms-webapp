-- VÁ: ký tự đại diện LIKE trong hàm lot_trace chưa được escape (tìm 30/08 bằng fuzz tham số)
--
-- Truy xuất theo TIỀN TỐ mã pallet dựng câu LIKE bằng format(%L). %L chống TIÊM SQL rất tốt
-- nhưng KHÔNG đụng tới ý nghĩa đặc biệt của '%' và '_' trong chính LIKE. Hai hệ quả:
--
--   (a) RÀO CHẶN BỊ VÔ HIỆU: controller bắt tiền tố >= 4 ký tự để không ai quét cả kho. Gõ '%%%%'
--       vừa đủ 4 ký tự và khớp MỌI mã pallet — đo thật: 415KB, 2,4s, trả về trần 2.000 dòng.
--   (b) TÌM SAI ÂM THẦM (nặng hơn): '_' là ký tự HỢP LỆ và có mặt khắp nơi trong mã pallet V1
--       (070526_510000127_C05_M1_001_B). Đang bị hiểu là 'một ký tự bất kỳ', nên tìm tiền tố
--       '070526_5100' cũng khớp '070526X5100'. Với hồ sơ THU HỒI, khớp thừa nghĩa là gom nhầm lô.
--
-- Vá: escape dấu chéo ngược, '%' và '_' trước khi ghép vào LIKE/ILIKE. Prefix cố định vẫn còn nên index
-- text_pattern_ops (idx_inventory_pallet_prefix) vẫn dùng được.
CREATE OR REPLACE FUNCTION public.lot_trace(
  p_kind        text,                      -- pallet | material | batch | npp | trip | plate
  p_value       text,
  p_prod_from   date DEFAULT NULL, p_prod_to date DEFAULT NULL,
  p_ship_from   date DEFAULT NULL, p_ship_to date DEFAULT NULL,
  p_wh_ids      text[] DEFAULT NULL,       -- scope kho của người gọi (NULL = toàn bộ)
  p_categories  text[] DEFAULT NULL,       -- scope loại hàng (null-inclusive như toàn app)
  p_limit       int DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_val    text := btrim(coalesce(p_value, ''));
  -- Ký tự đại diện của LIKE phải được ESCAPE. %L chống được TIÊM SQL nhưng không đụng tới '%'
  -- và '_': gõ '%%%%' (4 ký tự, qua được rào 'tiền tố >= 4') là quét TRỌN kho — đo 30/08: 415KB,
  -- 2,4s. Nặng hơn: '_' là ký tự HỢP LỆ và RẤT PHỔ BIẾN trong mã pallet V1
  -- (070526_510000127_C05_M1_001_B), nên nó đang bị hiểu là 'một ký tự bất kỳ' ⇒ tìm theo tiền
  -- tố ra CẢ những pallet không khớp thật. Postgres mặc định escape bằng dấu chéo ngược.
  v_like   text := replace(replace(replace(btrim(coalesce(p_value, '')),
                     E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
  v_codes  text[];
  v_lim    int  := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_ship   jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_nship  int := 0; v_nstock int := 0; v_ncust int := 0; v_ntrip int := 0;
  v_qship  numeric := 0; v_qhand numeric := 0;
  v_where  text;
  v_scope_ship text := '';   -- điều kiện trên chuyến (kho + ngày giao)
  v_scope_stk  text := '';   -- điều kiện trên tồn (kho + loại hàng)
  v_empty  jsonb := jsonb_build_object('codes', 0, 'shipments', '[]'::jsonb, 'stock', '[]'::jsonb,
                                       'summary', jsonb_build_object('pallets', 0, 'shipments', 0,
                                       'stock_rows', 0, 'customers', 0, 'trips', 0,
                                       'qty_shipped', 0, 'qty_on_hand', 0, 'truncated', false));
BEGIN
  IF v_val = '' OR p_kind IS NULL THEN RETURN v_empty; END IF;

  IF p_wh_ids   IS NOT NULL THEN
    v_scope_ship := v_scope_ship || format(' AND g.warehouse_id = ANY(%L::text[])', p_wh_ids);
    v_scope_stk  := v_scope_stk  || format(' AND ie.warehouse_id = ANY(%L::text[])', p_wh_ids);
  END IF;
  IF p_ship_from IS NOT NULL THEN v_scope_ship := v_scope_ship || format(' AND g.delivery_date >= %L', p_ship_from); END IF;
  IF p_ship_to   IS NOT NULL THEN v_scope_ship := v_scope_ship || format(' AND g.delivery_date <= %L', p_ship_to);   END IF;
  IF p_categories IS NOT NULL THEN
    v_scope_stk := v_scope_stk || format(' AND (m.category IS NULL OR m.category = ANY(%L::text[]))', p_categories);
  END IF;

  -- (a) Quy mọi kiểu tìm về MỘT TẬP MÃ PALLET — sau đó hai chiều dùng chung một đường đi.
  IF p_kind IN ('npp', 'trip', 'plate') THEN
    v_where := CASE p_kind
      WHEN 'npp'   THEN format('d.distributor_name ILIKE %L', '%' || v_like || '%')
      WHEN 'trip'  THEN format('g.group_code = %L', v_val)
      ELSE format('upper(regexp_replace(coalesce(g.license_plate, %L), %L, %L, %L)) = %L',
                  '', '[^A-Za-z0-9]', '', 'g', upper(regexp_replace(v_val, '[^A-Za-z0-9]', '', 'g')))
    END;
    EXECUTE
      'SELECT array_agg(DISTINCT e.pallet_code)
         FROM "OutboundDelivery" d
         JOIN "GroupDeliveryOrder" g ON g.id = d.gdo_id
         JOIN "OutboundItem" oi      ON oi.do_id = d.id
         JOIN "OutboundScanEntry" e  ON e.item_id = oi.id
        WHERE ' || v_where || v_scope_ship
      INTO v_codes;
  ELSE
    v_where := CASE p_kind
      WHEN 'pallet'   THEN format('ie.pallet_code LIKE %L', v_like || '%')
      WHEN 'batch'    THEN format('ie.batch = %L', v_val)
      WHEN 'material' THEN format('m.material_code = %L', v_val)
      ELSE NULL END;
    IF v_where IS NULL THEN RETURN v_empty; END IF;
    IF p_prod_from IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date >= %L', p_prod_from); END IF;
    IF p_prod_to   IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date <= %L', p_prod_to);   END IF;
    EXECUTE
      'SELECT array_agg(DISTINCT ie.pallet_code)
         FROM "InventoryEntry" ie
         LEFT JOIN "Material" m ON m.id = ie.material_id
        WHERE ' || v_where || v_scope_stk
      INTO v_codes;
  END IF;

  IF v_codes IS NULL OR array_length(v_codes, 1) IS NULL THEN RETURN v_empty; END IF;

  -- (b) ĐÃ GIAO ĐI ĐÂU — nối qua chính dòng tồn được quét (inventory_entry_id), không dò lại theo
  --     mã pallet: cùng một mã pallet có thể tồn tại ở kho gửi VÀ kho nhận sau khi chuyển kho.
  --     Join `unnest(mảng)` chứ KHÔNG `= ANY(mảng)`: với mảng vài trăm phần tử, `= ANY` làm planner
  --     bỏ index (đo: 110ms → gần 1 giây).
  -- ⚠️ Ô tổng cộng trên TOÀN BỘ kết quả, không phải trên trang đã cắt.
  EXECUTE
    'WITH s AS (
       SELECT e.pallet_code, e.cartons_scanned, e.scanned_at, e.pct_date,
              ie.production_date, ie.expiry_date, ie.batch,
              coalesce(m.material_code, oi.material_code_raw) AS material_code, m.short_name,
              g.group_code, g.delivery_date, g.license_plate, g.status AS trip_status,
              d.delivery_code, d.distributor_name, w.name AS warehouse_name
         FROM unnest($1::text[]) AS pc(code)
         JOIN "OutboundScanEntry" e  ON e.pallet_code = pc.code
         JOIN "OutboundItem" oi      ON oi.id = e.item_id
         JOIN "OutboundDelivery" d   ON d.id  = oi.do_id
         JOIN "GroupDeliveryOrder" g ON g.id  = d.gdo_id
         LEFT JOIN "InventoryEntry" ie ON ie.id = e.inventory_entry_id
         LEFT JOIN "Material" m        ON m.id  = coalesce(ie.material_id, oi.material_id)
         LEFT JOIN "Warehouse" w       ON w.id  = g.warehouse_id
        WHERE true' || v_scope_ship || '
     ), t AS (SELECT s.*, row_number() OVER (ORDER BY s.scanned_at DESC NULLS LAST) rn FROM s)
     SELECT count(*)::int, coalesce(sum(t.cartons_scanned), 0),
            count(DISTINCT t.distributor_name)::int, count(DISTINCT t.group_code)::int,
            coalesce(jsonb_agg(to_jsonb(t) - ''rn'' ORDER BY t.scanned_at DESC NULLS LAST)
                     FILTER (WHERE t.rn <= $2), ''[]''::jsonb)
       FROM t'
    INTO v_nship, v_qship, v_ncust, v_ntrip, v_ship
    USING v_codes, v_lim;

  -- (c) CÒN TRONG KHO — phần chưa đi, để biết thu hồi được bao nhiêu tại chỗ
  EXECUTE
    'WITH k AS (
       SELECT ie.pallet_code, ie.cartons_remaining, ie.status, ie.production_date, ie.expiry_date,
              ie.batch, ie.import_date, m.material_code, m.short_name,
              w.name AS warehouse_name, l.location_code
         FROM unnest($1::text[]) AS pc(code)
         JOIN "InventoryEntry" ie ON ie.pallet_code = pc.code
         LEFT JOIN "Material" m  ON m.id = ie.material_id
         LEFT JOIN "Warehouse" w ON w.id = ie.warehouse_id
         LEFT JOIN "Location" l  ON l.id = ie.location_id
        WHERE ie.cartons_remaining > 0' || v_scope_stk || '
     ), t AS (SELECT k.*, row_number() OVER (ORDER BY k.pallet_code) rn FROM k)
     SELECT count(*)::int, coalesce(sum(t.cartons_remaining), 0),
            coalesce(jsonb_agg(to_jsonb(t) - ''rn'' ORDER BY t.pallet_code)
                     FILTER (WHERE t.rn <= $2), ''[]''::jsonb)
       FROM t'
    INTO v_nstock, v_qhand, v_stock
    USING v_codes, v_lim;

  RETURN jsonb_build_object(
    'codes', array_length(v_codes, 1), 'shipments', v_ship, 'stock', v_stock,
    'summary', jsonb_build_object(
      'pallets', array_length(v_codes, 1), 'shipments', v_nship, 'stock_rows', v_nstock,
      'customers', v_ncust, 'trips', v_ntrip, 'qty_shipped', v_qship, 'qty_on_hand', v_qhand,
      'truncated', (v_nship > v_lim OR v_nstock > v_lim)));
END $fn$;
