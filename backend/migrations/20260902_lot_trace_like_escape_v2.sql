-- 20260902 — VÁ LẠI: ký tự đại diện LIKE trong lot_trace (hồi quy của 20260901f)
--
-- 30/08 (20260830b) đã escape '%' '_' '\' trước khi ghép vào LIKE/ILIKE vì format(%L) chỉ chống
-- TIÊM SQL, không đụng tới ý nghĩa của '%' và '_' trong LIKE — gõ '%%%%' là quét TRỌN kho, '_' là
-- ký tự hợp lệ khắp mã pallet V1 nên tiền tố '070526_5100' khớp cả '070526X5100' (gom nhầm lô).
-- 01/09 (20260901f) viết lại lot_trace theo filter tổ hợp và ĐÁNH RƠI đoạn escape ⇒ gói QA 07
-- params-fuzz đỏ lại (CI dev 01/09 đêm: 55.768 pallet cho '%%%%'). Migration này chỉ THÊM escape
-- vào 4 chỗ LIKE/ILIKE, chữ ký hàm và mọi hành vi khác GIỮ NGUYÊN 20260901f.
--
-- Chống hồi quy lần 3: ratchet `sql_like_unescaped` trong scripts/qa/09-static-gate.mjs — mọi
-- `format('... LIKE %L', …)` / `ILIKE %L` trong backend/migrations phải đi qua like_esc(); gói QA 07
-- vẫn gác ở tầng chạy thật.
CREATE OR REPLACE FUNCTION public.like_esc(p text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT replace(replace(replace(btrim(p), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_')
$$;

CREATE OR REPLACE FUNCTION public.lot_trace(
  p_kind        text,
  p_value       text DEFAULT NULL,         -- kind cũ 1-giá-trị; fwd/rev không dùng
  p_prod_from   date DEFAULT NULL, p_prod_to date DEFAULT NULL,
  p_ship_from   date DEFAULT NULL, p_ship_to date DEFAULT NULL,
  p_wh_ids      text[] DEFAULT NULL,
  p_categories  text[] DEFAULT NULL,
  p_limit       int DEFAULT 500,
  p_codes       text[] DEFAULT NULL,
  p_cycle       text DEFAULT NULL,         -- fwd: đoạn 3 tem V1 (so dạng chuẩn bỏ 0 dẫn đầu)
  p_machine     text DEFAULT NULL,         -- fwd: đoạn 4
  p_nmsx        text DEFAULT NULL,         -- fwd: đoạn 6 (ký hiệu Kho SX)
  p_pallet      text DEFAULT NULL,         -- fwd: tiền tố tem
  p_material    text DEFAULT NULL,         -- fwd: mã hàng
  p_batch       text DEFAULT NULL,         -- fwd: mã lô (tem V2)
  p_npp         text DEFAULT NULL,         -- rev: NPP/khách (ilike)
  p_trip        text DEFAULT NULL,         -- rev: Số xe (eq)
  p_plate       text DEFAULT NULL          -- rev: biển số (so dạng chuẩn)
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_val    text := btrim(coalesce(p_value, ''));
  v_like   text := like_esc(coalesce(p_value, ''));   -- bản ĐÃ ESCAPE cho LIKE/ILIKE (kind cũ)
  v_codes  text[];
  v_lim    int  := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_ship   jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_nship  int := 0; v_nstock int := 0; v_ncust int := 0; v_ntrip int := 0;
  v_qship  numeric := 0; v_qhand numeric := 0;
  v_where  text;
  v_pref   text;
  v_scope_ship text := '';
  v_scope_stk  text := '';
  v_empty  jsonb := jsonb_build_object('codes', 0, 'shipments', '[]'::jsonb, 'stock', '[]'::jsonb,
                                       'summary', jsonb_build_object('pallets', 0, 'shipments', 0,
                                       'stock_rows', 0, 'customers', 0, 'trips', 0,
                                       'qty_shipped', 0, 'qty_on_hand', 0, 'truncated', false));
BEGIN
  IF p_kind IS NULL OR (p_kind NOT IN ('codes', 'prod', 'fwd', 'rev') AND v_val = '') THEN RETURN v_empty; END IF;

  IF p_wh_ids   IS NOT NULL THEN
    v_scope_ship := v_scope_ship || format(' AND g.warehouse_id = ANY(%L::text[])', p_wh_ids);
    v_scope_stk  := v_scope_stk  || format(' AND ie.warehouse_id = ANY(%L::text[])', p_wh_ids);
  END IF;
  IF p_ship_from IS NOT NULL THEN v_scope_ship := v_scope_ship || format(' AND g.delivery_date >= %L', p_ship_from); END IF;
  IF p_ship_to   IS NOT NULL THEN v_scope_ship := v_scope_ship || format(' AND g.delivery_date <= %L', p_ship_to);   END IF;
  IF p_categories IS NOT NULL THEN
    v_scope_stk := v_scope_stk || format(' AND (m.category IS NULL OR m.category = ANY(%L::text[]))', p_categories);
  END IF;

  IF p_kind = 'codes' THEN
    v_codes := p_codes[1:200];

  ELSIF p_kind IN ('fwd', 'prod') THEN
    -- XUÔI — tổ hợp tiêu chí trên TỒN ('prod' cũ = tập con: chỉ cycle/machine/nmsx/ngày)
    v_where := 'true';
    IF btrim(coalesce(p_pallet, '')) <> '' THEN
      v_where := v_where || format(' AND ie.pallet_code LIKE %L', like_esc(p_pallet) || '%');
    END IF;
    IF btrim(coalesce(p_material, '')) <> '' THEN
      v_where := v_where || format(' AND m.material_code = %L', btrim(p_material));
    END IF;
    IF btrim(coalesce(p_batch, '')) <> '' THEN
      v_where := v_where || format(' AND ie.batch = %L', btrim(p_batch));
    END IF;
    IF btrim(coalesce(p_cycle, '')) <> '' THEN
      v_where := v_where || format(
        ' AND coalesce(nullif(ltrim(split_part(ie.pallet_code, ''_'', 3), ''0''), ''''), ''0'') = %L',
        coalesce(nullif(ltrim(btrim(p_cycle), '0'), ''), '0'));
    END IF;
    IF btrim(coalesce(p_machine, '')) <> '' THEN
      v_where := v_where || format(' AND upper(split_part(ie.pallet_code, ''_'', 4)) = %L', upper(btrim(p_machine)));
    END IF;
    IF btrim(coalesce(p_nmsx, '')) <> '' THEN
      v_where := v_where || format(' AND upper(split_part(ie.pallet_code, ''_'', 6)) = %L', upper(btrim(p_nmsx)));
    END IF;
    -- Ngày SX: đủ 2 đầu ≤92 ngày → OR tiền tố ddmmyy_% (ăn index tiền tố); còn lại lọc production_date
    -- ('_' sau ddmmyy ở đây là ký tự đại diện CÓ CHỦ ĐÍCH — 1 ký tự bất kỳ, dùng cho cả tem '_')
    IF p_prod_from IS NOT NULL AND p_prod_to IS NOT NULL
       AND p_prod_to >= p_prod_from AND (p_prod_to - p_prod_from) <= 92 THEN
      SELECT ' AND (' || string_agg(format('ie.pallet_code LIKE %L', to_char(g.d::date, 'DDMMYY') || '_%'), ' OR ') || ')'
        INTO v_pref
        FROM generate_series(p_prod_from::timestamp, p_prod_to::timestamp, interval '1 day') AS g(d);
      v_where := v_where || v_pref;
    ELSE
      IF p_prod_from IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date >= %L', p_prod_from); END IF;
      IF p_prod_to   IS NOT NULL THEN v_where := v_where || format(' AND ie.production_date::date <= %L', p_prod_to);   END IF;
    END IF;
    IF v_where = 'true' THEN RETURN v_empty; END IF;
    EXECUTE
      'SELECT array_agg(x.code) FROM (
         SELECT DISTINCT ie.pallet_code AS code
           FROM "InventoryEntry" ie
           LEFT JOIN "Material" m ON m.id = ie.material_id
          WHERE ' || v_where || v_scope_stk || '
          LIMIT 5000) x'
      INTO v_codes;

  ELSIF p_kind = 'rev' THEN
    -- NGƯỢC — tổ hợp tiêu chí trên đường GIAO (khách/chuyến/xe), Ngày giao đã nằm trong scope
    v_where := 'true';
    IF btrim(coalesce(p_npp, '')) <> '' THEN
      v_where := v_where || format(' AND d.distributor_name ILIKE %L', '%' || like_esc(p_npp) || '%');
    END IF;
    IF btrim(coalesce(p_trip, '')) <> '' THEN
      v_where := v_where || format(' AND g.group_code = %L', btrim(p_trip));
    END IF;
    IF btrim(coalesce(p_plate, '')) <> '' THEN
      v_where := v_where || format(
        ' AND upper(regexp_replace(coalesce(g.license_plate, ''''), ''[^A-Za-z0-9]'', '''', ''g'')) = %L',
        upper(regexp_replace(btrim(p_plate), '[^A-Za-z0-9]', '', 'g')));
    END IF;
    IF v_where = 'true' AND p_ship_from IS NULL AND p_ship_to IS NULL THEN RETURN v_empty; END IF;
    EXECUTE
      'SELECT array_agg(x.code) FROM (
         SELECT DISTINCT e.pallet_code AS code
           FROM "OutboundDelivery" d
           JOIN "GroupDeliveryOrder" g ON g.id = d.gdo_id
           JOIN "OutboundItem" oi      ON oi.do_id = d.id
           JOIN "OutboundScanEntry" e  ON e.item_id = oi.id
          WHERE ' || v_where || v_scope_ship || '
          LIMIT 5000) x'
      INTO v_codes;

  ELSIF p_kind IN ('npp', 'trip', 'plate') THEN
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
