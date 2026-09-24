-- ============================================================================
-- CUTOVER production 24/09/2026 — PART 4/10
-- 12 migration · 20260901f_lot_trace_combined.sql → 20260908b_warehouse_map_span.sql
-- Dán TRỌN file vào Supabase SQL Editor của project PRODUCTION svicyfquresxaigfxsdb rồi Run.
-- Cả part nằm trong MỘT transaction: lỗi bất kỳ đâu = rollback trọn part, schema không dở dang.
-- Chạy lại lần hai sẽ báo "đã tồn tại" rồi tự rollback — không hỏng gì.
-- ============================================================================
BEGIN;


-- ─────────────────────────────────────────────────────────────────────────
-- [20260901f_lot_trace_combined.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260901f — Truy xuất lô theo FILTER CHUẨN (user chốt 01/09 tối lần 3: "tại sao k làm theo
-- filter chuẩn? filter kiểu này kỳ cục quá"): bỏ mô hình "Tìm theo 1 kiểu + 1 giá trị" — mỗi
-- tiêu chí là MỘT chip filter riêng, điền ô nào lọc ô đó, KẾT HỢP AND trong một lời gọi.
--
-- Thêm 2 kind tổ hợp:
--   'fwd' (xuôi — lô hàng → khách): Tem pallet (tiền tố) + Mã hàng + Mã lô + Chu kỳ + Máy +
--         Kho SX (ký hiệu) + khoảng Ngày SX — bất kỳ tổ hợp nào, không gì bắt buộc.
--   'rev' (ngược — khách → lô hàng): NPP + Số xe + Biển số (+ Ngày giao qua scope sẵn có).
-- Kind cũ (pallet/material/batch/prod/npp/trip/plate/codes) GIỮ NGUYÊN — bundle PWA cũ còn gọi.
-- Tập mã kẹp 5000 cả 2 chiều (tiêu chí quá rộng thì phần sau vẫn sống).
-- Thêm tham số ⇒ DROP chữ ký 13-param của 20260901d/e (CREATE OR REPLACE khác chữ ký = overload).
DROP FUNCTION IF EXISTS public.lot_trace(text, text, date, date, date, date, text[], text[], int, text[], text, text, text);
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
      v_where := v_where || format(' AND ie.pallet_code LIKE %L', btrim(p_pallet) || '%');
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
      v_where := v_where || format(' AND d.distributor_name ILIKE %L', '%' || btrim(p_npp) || '%');
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
      WHEN 'npp'   THEN format('d.distributor_name ILIKE %L', '%' || v_val || '%')
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
      WHEN 'pallet'   THEN format('ie.pallet_code LIKE %L', v_val || '%')
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



-- ─────────────────────────────────────────────────────────────────────────
-- [20260902_lot_trace_like_escape_v2.sql]
-- ─────────────────────────────────────────────────────────────────────────
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



-- ─────────────────────────────────────────────────────────────────────────
-- [20260902b_realtime_broadcast.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260902b — REALTIME CHUYỂN SANG BROADCAST TỪ TRIGGER DB (PHA 1: chỉ THÊM, không phá)
-- ============================================================================
-- VÌ SAO (kiểm định 02/09): cơ chế cũ `postgres_changes` bắt buộc người nghe phải có quyền SELECT
-- dòng đó, nên app phải mở 64 policy `FOR SELECT TO authenticated USING (true)` — và vé realtime
-- (JWT role=authenticated, nằm trong localStorage của MỌI tài khoản) trở thành chìa khoá gọi thẳng
-- PostgREST đọc trọn 58/73 bảng: chi phí kho, bảng công, nghỉ phép, tồn mọi kho, ma trận quyền…
-- vòng qua toàn bộ requirePerm + cắt scope của backend.
--
-- Frontend KHÔNG đọc bảng nào qua Supabase (0 chỗ `supabase.from(`); nó chỉ cần tín hiệu
-- "bảng X vừa đổi" để refetch qua API (đã cắt scope). Nên: trigger gửi gói tin TỐI THIỂU
-- {table, op} (+ row_id/booked_count cho đúng 2 bảng FE cần) vào kênh Broadcast RIÊNG TƯ,
-- rồi pha 2 (20260902c) thu hồi toàn bộ quyền đọc bảng của authenticated/anon.
--
-- AN TOÀN:
--  • `realtime.send` tự bọc EXCEPTION (chỉ RAISE WARNING) + hàm trigger bọc thêm một lớp
--    ⇒ hạ tầng realtime hỏng KHÔNG BAO GIỜ làm hỏng giao dịch nghiệp vụ.
--  • Trigger mức STATEMENT cho 60 bảng: upload 500 dòng = 1 tín hiệu (trước: 500 sự kiện).
--    Mức ROW chỉ cho 3 bảng cần dữ liệu dòng: DeliverySlot (row_id + booked_count để patch cache
--    khung giờ tức thì) · ProductionImport (row_id để dọn localStorage khi xoá) ·
--    user_notifications (định tuyến sang kênh cá nhân).
--  • Kênh cá nhân `wms-user-<employee_id>`: thông báo đích danh chỉ tới đúng người — không để
--    hàng trăm máy cùng refetch khi một người được giao việc, và không lộ ai-được-báo cho ai.
--  • Pha 1 để nguyên policy cũ + publication ⇒ hai cơ chế chạy song song, deploy FE xong mới
--    chạy pha 2. Publication `supabase_realtime` GIỮ NGUYÊN = đường lui tức thì.
-- ============================================================================

-- 1. Hàm trigger — payload KHÔNG BAO GIỜ chứa cột nghiệp vụ.
CREATE OR REPLACE FUNCTION public.wms_notify_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, realtime
AS $$
DECLARE
  v_payload jsonb;
  v_topic   text := 'wms-db-changes';
  v_row_id  text;
BEGIN
  BEGIN
    IF TG_LEVEL = 'ROW' THEN
      v_row_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
      IF TG_TABLE_NAME = 'user_notifications' THEN
        v_topic   := 'wms-user-' || (CASE WHEN TG_OP = 'DELETE' THEN OLD.employee_id ELSE NEW.employee_id END)::text;
        v_payload := jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP);
      ELSIF TG_TABLE_NAME = 'DeliverySlot' THEN
        v_payload := jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP, 'row_id', v_row_id,
                       'booked_count', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.booked_count END);
      ELSE
        v_payload := jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP, 'row_id', v_row_id);
      END IF;
    ELSE
      v_payload := jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP);
    END IF;
    PERFORM realtime.send(v_payload, 'db_change', v_topic, true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'wms_notify_change bỏ qua (%): giao dịch nghiệp vụ không bị ảnh hưởng', SQLERRM;
  END;
  RETURN NULL;
END $$;

-- Trigger KHÔNG cần người ghi có EXECUTE (chỉ cần lúc CREATE TRIGGER) — đóng cho anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.wms_notify_change() FROM PUBLIC, anon, authenticated;

-- 2. Gắn trigger cho ĐÚNG các bảng frontend khai trong TABLE_QUERY_MAP (realtimeEvents.ts, 63 bảng).
--    Bảng chưa có trên môi trường (production từng lệch schema) → bỏ qua có thông báo, không fail.
DO $$
DECLARE
  t text;
  stmt_tables text[] := ARRAY[
    'InventoryEntry','StocktakeLog','Location','FillTask','FillOrder','Material','Manufacturer',
    'PalletLabelPrint','PalletOperation','InventoryAdjustmentLog','Warehouse','WarehouseZone',
    'LookupValue','ImportShift','QAStatus','SystemSetting','VehicleType','SlotTemplate',
    'TransportCompany','Vehicle','TmsOrder','TmsVehicleSlot','gate_registrations','alert_events',
    'inbound_plan_lines','GroupDeliveryOrder','OutboundDelivery','OutboundItem','OutboundScanEntry',
    'reconcile_tasks','erp_outbound_orders','outbound_events','khvc_lines','WeighTicket',
    'SlottingPlan','SlottingPlanLine','forklift_vehicles','forklift_checklist_items',
    'forklift_daily_logs','packing_logs','packing_runs','warehouse_machines','JobTitle','Department',
    'UserWarehouseAccess','Skill','EmployeeSkill','LeaveRequest','WorkAssignmentSheet',
    'WorkAssignmentDemand','WorkAssignment','WorkLayout','WorkLayoutSkill','WorkLayoutJobTitle',
    'ShiftRestRule','Attendance','receipt_ratings','trace_investigations','warehouse_costs',
    'warehouse_cost_locks'];
  row_tables text[] := ARRAY['DeliverySlot','ProductionImport','user_notifications'];
BEGIN
  FOREACH t IN ARRAY stmt_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'wms_notify: bỏ qua bảng chưa có trên môi trường này: %', t; CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_wms_notify ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_wms_notify AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I '
                   'FOR EACH STATEMENT EXECUTE FUNCTION public.wms_notify_change()', t);
  END LOOP;
  FOREACH t IN ARRAY row_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'wms_notify: bỏ qua bảng chưa có trên môi trường này: %', t; CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_wms_notify ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_wms_notify AFTER INSERT OR UPDATE OR DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.wms_notify_change()', t);
  END LOOP;
END $$;

-- 3. Bảng MỚI tự nhận trigger (event trigger có sẵn từ đợt bật realtime): giữ ADD TABLE vào
--    publication làm đường lui; KHÔNG tạo policy SELECT cho authenticated — đó là lỗ hổng vừa đóng.
CREATE OR REPLACE FUNCTION public._auto_add_table_to_realtime() RETURNS event_trigger
LANGUAGE plpgsql AS $$
DECLARE obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF obj.command_tag = 'CREATE TABLE' AND obj.schema_name = 'public' THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %s', obj.object_identity);
      EXECUTE format('CREATE TRIGGER trg_wms_notify AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %s '
                     'FOR EACH STATEMENT EXECUTE FUNCTION public.wms_notify_change()', obj.object_identity);
    END IF;
  END LOOP;
END $$;

-- 4. Quyền NHẬN tin trên kênh riêng tư (realtime.messages RLS bật, 0 policy trước đó):
--    chỉ vai authenticated (= có vé do backend cấp); kênh cá nhân khớp đúng sub của vé.
DROP POLICY IF EXISTS wms_broadcast_shared ON realtime.messages;
CREATE POLICY wms_broadcast_shared ON realtime.messages
  FOR SELECT TO authenticated
  USING (realtime.topic() = 'wms-db-changes' AND extension = 'broadcast');

DROP POLICY IF EXISTS wms_broadcast_personal ON realtime.messages;
CREATE POLICY wms_broadcast_personal ON realtime.messages
  FOR SELECT TO authenticated
  USING (realtime.topic() = 'wms-user-' || (SELECT auth.uid())::text AND extension = 'broadcast');

-- 5. RPC cho bộ QA (gói 00): trạng thái realtime theo bảng — thêm `has_trigger` (nguồn sự thật mới),
--    giữ in_pub/rls/sel_pol để so sánh trong lúc chuyển đổi.
CREATE OR REPLACE FUNCTION public.realtime_readiness() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_object_agg(t.tablename, jsonb_build_object(
           'in_pub', t.in_pub, 'rls', t.rls, 'sel_pol', t.sel_pol, 'has_trigger', t.has_trigger)), '{}'::jsonb)
  FROM (
    SELECT c.relname AS tablename,
           EXISTS (SELECT 1 FROM pg_publication_tables pt
                   WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public'
                     AND pt.tablename = c.relname) AS in_pub,
           c.relrowsecurity AS rls,
           (SELECT count(*) FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = c.relname
               AND p.cmd IN ('SELECT', 'ALL') AND p.roles::text LIKE '%authenticated%') AS sel_pol,
           EXISTS (SELECT 1 FROM pg_trigger tg
                   WHERE tg.tgrelid = c.oid AND tg.tgname = 'trg_wms_notify' AND NOT tg.tgisinternal) AS has_trigger
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  ) t
$$;

-- 6. RPC cho bộ QA (gói 00): MỌI cửa đọc qua PostgREST còn mở cho anon/authenticated/PUBLIC —
--    quyền bảng (đọc từ relacl, không qua information_schema vì view đó chỉ hiện grant liên quan
--    tới role đang gọi) + policy + default ACL. Sau pha 2 cả 3 mảng PHẢI rỗng, và phải RỖNG MÃI.
CREATE OR REPLACE FUNCTION public.rest_exposure() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'table_privs', COALESCE((
      SELECT jsonb_agg(x ORDER BY x) FROM (
        SELECT c.relname || ':' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
               || ':' || a.privilege_type AS x
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
          AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))
      ) s), '[]'::jsonb),
    'policies', COALESCE((
      SELECT jsonb_agg(p.tablename || ':' || p.policyname ORDER BY p.tablename, p.policyname)
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND (p.roles::text LIKE '%anon%' OR p.roles::text LIKE '%authenticated%' OR p.roles::text LIKE '%public%')
    ), '[]'::jsonb),
    'default_acl', COALESCE((
      SELECT jsonb_agg(pg_get_userbyid(d.defaclrole) || ':' || d.defaclobjtype::text || ':' || a.privilege_type
                       || '→' || pg_get_userbyid(a.grantee))
      FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE n.nspname = 'public' AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
        AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
    ), '[]'::jsonb)
  )
$$;

REVOKE EXECUTE ON FUNCTION public.realtime_readiness() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rest_exposure()      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.realtime_readiness() TO service_role;
GRANT  EXECUTE ON FUNCTION public.rest_exposure()      TO service_role;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260902c_realtime_close_rest.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260902c — ĐÓNG CỬA ĐỌC PostgREST CỦA authenticated/anon (PHA 2 — chạy SAU khi frontend
--             đã nghe Broadcast và đã xác minh sống trên môi trường tương ứng)
-- ============================================================================
-- Điều kiện trước khi chạy: 20260902b đã apply + bundle FE mới (broadcast) đã lên + kiểm 2 phiên
-- thấy số nhảy. Chạy sớm hơn = realtime tắt cho bundle cũ tới khi người dùng tải lại trang
-- (không mất dữ liệu, chỉ số đứng im).
--
-- Sau pha này, cầm vé realtime gọi PostgREST → 0 dòng ở MỌI bảng; RPC nghiệp vụ (SECURITY INVOKER)
-- gọi bằng vé cũng chết ở câu SELECT đầu tiên. Gói QA 00 gác bằng RPC rest_exposure() = 3 mảng rỗng.
-- Đường lui: 20260902c_realtime_close_rest_ROLLBACK.sql (publication giữ nguyên nên quay lại tức thì).
-- ============================================================================

-- 1. Xoá MỌI policy SELECT cho authenticated trong public (56 `rls_auth_select` + 7 `*_read` +
--    `rls_own_select`): chúng tồn tại CHỈ để postgres_changes chịu gửi sự kiện — nay không còn lý do.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND (roles::text LIKE '%authenticated%' OR roles::text LIKE '%anon%' OR roles::text LIKE '%public%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    RAISE NOTICE 'đã xoá policy %.% (%)', p.tablename, p.policyname, p.schemaname;
  END LOOP;
END $$;

-- 2. Thu hồi MỌI quyền bảng/sequence của anon + authenticated (gồm cả TRUNCATE/REFERENCES/TRIGGER
--    mà default ACL cũ cấp nhầm — TRUNCATE không chịu RLS, là mìn chờ).
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- 3. CHỐT GỐC RỄ: bảng/sequence tạo SAU không tự nhận quyền cho 2 vai này nữa. Trước đây migration
--    20260712 chỉ REVOKE INSERT/UPDATE/DELETE ở tầng default nên mỗi bảng mới vẫn nhận SELECT+TRUNCATE
--    — quên bật RLS ở một bảng mới là rò ra Internet ngay lập tức.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- (Không đụng EXECUTE của hàm public: 113 RPC vẫn PUBLIC-executable nhưng đều SECURITY INVOKER ⇒
--  chạy dưới vai gọi = chết ở SELECT đầu tiên. Thu hồi EXECUTE phải GRANT lại service_role đúng
--  từng hàm — việc riêng, làm sau khi đã đo, kẻo gãy backend.)



-- ─────────────────────────────────────────────────────────────────────────
-- [20260902d_realtime_close_publication_functions.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260902d — ĐÓNG NỐT 2 CỬA CÒN LẠI của anon/authenticated (kiểm định độc lập sau pha 2, 02/09 tối)
-- ============================================================================
-- Đo bằng anon key + vé realtime sau 20260902c: REST bảng 0/86 · REST ghi 403 · GraphQL tắt · OpenAPI 401 ·
-- Storage rỗng · Auth signup tắt · token giả 401 · kênh riêng tư đúng. Còn đúng 2 chỗ:
--
-- (1) postgres_changes (cơ chế CŨ): 73 bảng vẫn nằm trong publication `supabase_realtime` ⇒ CẢ ANON (khoá
--     công khai trong bundle) subscribe `schema=public` vẫn SUBSCRIBED và nhận sự kiện
--     {table:"Warehouse", eventType:"UPDATE", new:{}, old:{}, errors:["Error 401: Unauthorized"]}.
--     Không lộ cột nào (không còn quyền SELECT) nhưng người ngoài vẫn biết BẢNG NÀO ĐỔI LÚC NÀO, và Realtime
--     vẫn decode WAL + kiểm RLS cho 73 bảng vô ích. ⇒ Bỏ hết bảng khỏi publication; bảng mới không add nữa
--     (broadcast từ trigger không dùng publication này — realtime.messages đi publication riêng của Supabase).
--
-- (2) RPC: 113 hàm public còn EXECUTE cho PUBLIC ⇒ vé/anon gọi được. Hôm nay đều SECURITY INVOKER nên chết ở
--     SELECT (đo: 88 hàm 42501), nhưng 7 hàm chạy tới cùng (validate sớm / thuần tính toán) và hàm
--     SECURITY DEFINER tạo SAU sẽ hở NGAY vì Postgres mặc định cấp EXECUTE cho PUBLIC. ⇒ Thu EXECUTE của hàm
--     app (chủ postgres) về postgres + service_role; sửa DEFAULT PRIVILEGES để hàm MỚI không tự mở — phải làm
--     TOÀN CỤC vì docs Postgres: "you cannot revoke privileges per-schema if they are granted globally".
--     Hàm extension (pg_trgm/unaccent, chủ supabase_admin) không thu được và cũng chỉ là hàm văn bản thuần.
--
-- Gate: rest_exposure() thêm pub_tables · func_execs · func_default_public_exec — gói QA 00 mục 10c bắt rỗng/false.
-- Đường lui: 20260902d_realtime_close_publication_functions_ROLLBACK.sql (chỉ cần khi quay về postgres_changes,
-- đi cùng 20260902c_…_ROLLBACK.sql).
-- ============================================================================

-- 1. Publication supabase_realtime → rỗng.
DO $$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' LOOP
    EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE %I.%I', t.schemaname, t.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'đã bỏ % bảng khỏi publication supabase_realtime', n;
END $$;

-- 2. Bảng MỚI: chỉ gắn trigger broadcast, KHÔNG add publication nữa.
CREATE OR REPLACE FUNCTION public._auto_add_table_to_realtime() RETURNS event_trigger
LANGUAGE plpgsql AS $$
DECLARE obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF obj.command_tag = 'CREATE TABLE' AND obj.schema_name = 'public' THEN
      EXECUTE format('CREATE TRIGGER trg_wms_notify AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %s '
                     'FOR EACH STATEMENT EXECUTE FUNCTION public.wms_notify_change()', obj.object_identity);
    END IF;
  END LOOP;
END $$;

-- 3. Hàm app trong public: EXECUTE chỉ còn postgres (chủ) + service_role (backend qua PostgREST).
--    Trigger function không cần EXECUTE lúc fire (đã chứng minh với wms_notify_change từ 20260902b).
DO $$
DECLARE f record; n int := 0;
BEGIN
  FOR f IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p', 'a')
      AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON ROUTINE %I.%I(%s) FROM PUBLIC, anon, authenticated', f.nspname, f.proname, f.args);
    EXECUTE format('GRANT  EXECUTE ON ROUTINE %I.%I(%s) TO service_role', f.nspname, f.proname, f.args);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'đã thu EXECUTE khỏi PUBLIC/anon/authenticated + cấp service_role cho % hàm public', n;
END $$;

-- 4. GỐC RỄ: hàm MỚI do postgres tạo không tự mở cho PUBLIC. Dòng toàn cục bỏ PUBLIC; dòng per-schema public
--    (đã có sẵn: postgres + service_role) cộng thêm → hàm mới trong public = postgres + service_role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT  EXECUTE ON FUNCTIONS TO service_role;

-- 5. Gate mở rộng: 3 mảng cũ + publication + hàm gọi được + default EXECUTE toàn cục.
CREATE OR REPLACE FUNCTION public.rest_exposure() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'table_privs', COALESCE((
      SELECT jsonb_agg(x ORDER BY x) FROM (
        SELECT c.relname || ':' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
               || ':' || a.privilege_type AS x
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
          AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))
      ) s), '[]'::jsonb),
    'policies', COALESCE((
      SELECT jsonb_agg(p.tablename || ':' || p.policyname ORDER BY p.tablename, p.policyname)
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND (p.roles::text LIKE '%anon%' OR p.roles::text LIKE '%authenticated%' OR p.roles::text LIKE '%public%')
    ), '[]'::jsonb),
    'default_acl', COALESCE((
      SELECT jsonb_agg(pg_get_userbyid(d.defaclrole) || ':' || d.defaclobjtype::text || ':' || a.privilege_type
                       || '→' || pg_get_userbyid(a.grantee))
      FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE n.nspname = 'public' AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
        AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
    ), '[]'::jsonb),
    -- (20260902d) bảng còn trong publication supabase_realtime — phải RỖNG (postgres_changes hết đường)
    'pub_tables', COALESCE((
      SELECT jsonb_agg(pt.schemaname || '.' || pt.tablename ORDER BY pt.tablename)
      FROM pg_publication_tables pt WHERE pt.pubname = 'supabase_realtime'
    ), '[]'::jsonb),
    -- (20260902d) hàm public (không tính hàm của extension) mà anon/authenticated gọi được — phải RỖNG
    'func_execs', COALESCE((
      SELECT jsonb_agg(x ORDER BY x) FROM (
        SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
               || CASE WHEN p.prosecdef THEN ' SECURITY DEFINER' ELSE '' END AS x
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p', 'a')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
          AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      ) s), '[]'::jsonb),
    -- (20260902d) hàm MỚI do postgres tạo có tự mở EXECUTE cho PUBLIC không — phải FALSE
    'func_default_public_exec', COALESCE((
      SELECT bool_or(a.grantee = 0)
      FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
        AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f'
    ), true)
  )
$$;
REVOKE EXECUTE ON FUNCTION public.rest_exposure() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rest_exposure() TO service_role;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260903_auth_throttle.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260903 — CHỐNG DÒ MẬT KHẨU xuyên instance + KHOÁ THEO TÀI KHOẢN + NHẬT KÝ ĐĂNG NHẬP
-- ============================================================================
-- Kiểm định 02/09: /login chỉ có express-rate-limit MemoryStore — trên serverless mỗi instance đếm riêng, cold start
-- reset, không khoá theo TÀI KHOẢN, không ghi log đăng nhập thất bại ⇒ dò mật khẩu 1 tài khoản rải qua nhiều instance
-- thì không ai thấy. Nay bộ đếm nằm ở DB (1 RPC/lượt), khoá theo 2 khoá song song `acct:<email>` (10 lần sai/15') và
-- `ip:<ip>` (30 lần sai/15'), khoá 15'; mọi lượt (sai/đúng/tài khoản vô hiệu) ghi `auth_login_events`.
-- MemoryStore giữ lại làm lớp phụ. 2 bảng nội bộ: bật RLS (gói 00 gác), KHÔNG realtime (gỡ trigger event-trigger vừa gắn).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.auth_attempts (
  key          text PRIMARY KEY,                       -- 'acct:<email thường>' | 'ip:<ip>'
  fails        int NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.auth_attempts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.auth_login_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text,
  ip          text,
  ok          boolean NOT NULL,
  reason      text,                                     -- BAD_PASSWORD | NO_ACCOUNT | NO_PASSWORD | INACTIVE | LOCKED | null khi ok
  employee_id text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.auth_login_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_auth_login_events_created ON public.auth_login_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_login_events_email   ON public.auth_login_events (email, created_at DESC);

-- Bảng nội bộ, không ai xem realtime: gỡ trigger broadcast mà event trigger `auto_realtime_new_tables` tự gắn
-- (không thì MỖI LẦN đăng nhập là 1 tín hiệu vô nghĩa tới mọi máy đang mở app).
DROP TRIGGER IF EXISTS trg_wms_notify ON public.auth_attempts;
DROP TRIGGER IF EXISTS trg_wms_notify ON public.auth_login_events;

-- p_event: 'check' (trước khi so mật khẩu) · 'fail' (sai → +1 mỗi khoá, khoá khi chạm trần) · 'ok' (đúng → xoá khoá
-- acct) · 'log' (chỉ ghi nhật ký, không đếm — tài khoản vô hiệu nhưng đúng mật khẩu). Trả {blocked, retry_after}.
CREATE OR REPLACE FUNCTION public.auth_throttle(
  p_keys text[], p_limits int[], p_event text, p_window_seconds int, p_lock_seconds int,
  p_email text, p_ip text, p_reason text, p_employee_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE i int; v_now timestamptz := now(); v_retry int := 0;
BEGIN
  IF p_event = 'ok' THEN
    DELETE FROM public.auth_attempts WHERE key = ANY(p_keys);
  ELSIF p_event = 'fail' THEN
    FOR i IN 1 .. COALESCE(array_length(p_keys, 1), 0) LOOP
      INSERT INTO public.auth_attempts(key, fails, window_start, updated_at) VALUES (p_keys[i], 1, v_now, v_now)
      ON CONFLICT (key) DO UPDATE SET
        fails        = CASE WHEN auth_attempts.window_start < v_now - make_interval(secs => p_window_seconds) THEN 1 ELSE auth_attempts.fails + 1 END,
        window_start = CASE WHEN auth_attempts.window_start < v_now - make_interval(secs => p_window_seconds) THEN v_now ELSE auth_attempts.window_start END,
        updated_at   = v_now;
      UPDATE public.auth_attempts SET locked_until = v_now + make_interval(secs => p_lock_seconds)
      WHERE key = p_keys[i] AND fails >= COALESCE(p_limits[i], 10) AND (locked_until IS NULL OR locked_until < v_now);
    END LOOP;
  END IF;
  IF p_event IN ('fail', 'ok', 'log') THEN
    INSERT INTO public.auth_login_events(email, ip, ok, reason, employee_id)
    VALUES (p_email, p_ip, p_event = 'ok', p_reason, p_employee_id);
  END IF;
  SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (locked_until - v_now)))::int, 0) INTO v_retry
  FROM public.auth_attempts WHERE key = ANY(p_keys) AND locked_until > v_now;
  -- Dọn lười (2% lượt): khoá đã hết hạn quá 1 ngày · nhật ký quá 90 ngày
  IF random() < 0.02 THEN
    DELETE FROM public.auth_attempts WHERE updated_at < v_now - interval '1 day' AND (locked_until IS NULL OR locked_until < v_now);
    DELETE FROM public.auth_login_events WHERE created_at < v_now - interval '90 days';
  END IF;
  RETURN jsonb_build_object('blocked', v_retry > 0, 'retry_after', v_retry);
END $$;
-- EXECUTE: default privileges sau 20260902d = postgres + service_role → không cần GRANT gì thêm.



-- ─────────────────────────────────────────────────────────────────────────
-- [20260903b_admin_audit.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260903b — NHẬT KÝ QUẢN TRỊ (admin audit): ai đổi quyền / phạm vi kho / mật khẩu / API key / cờ hệ thống, lúc nào, từ giá trị gì sang gì
-- ============================================================================
-- Sau kiểm định 02–03/09: app có sổ sự kiện NGHIỆP VỤ (outbound_events) và nhật ký ĐĂNG NHẬP (auth_login_events)
-- nhưng KHÔNG có vết cho thao tác QUẢN TRỊ — câu IT chủ đầu tư chắc chắn hỏi ("ai cấp quyền này, khi nào?").
-- Bảng nội bộ: bật RLS (gói 00 gác), KHÔNG realtime (gỡ trigger event-trigger vừa gắn), đọc qua BE
-- GET /masterdata/admin-audit (quyền user_admin.audit_log). Ghi từ services/adminAudit.ts (augment: hỏng sổ không hỏng nghiệp vụ).
-- before/after chỉ chứa các TRƯỜNG ĐỔI (diff), không lưu mật khẩu/API key (chỉ ghi "đã đặt").
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_audit_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     text,
  actor_name   text,
  ip           text,
  action       text NOT NULL,          -- EMPLOYEE_CREATE | EMPLOYEE_UPDATE | PASSWORD_SET | ACCOUNT_UNLOCK | EMPLOYEE_DELETE | EMPLOYEE_RESTORE |
                                       -- WAREHOUSE_ACCESS | MANAGER_SET | JOBTITLE_CREATE | JOBTITLE_UPDATE | JOBTITLE_PARENT | DEPARTMENT_CREATE |
                                       -- DEPARTMENT_UPDATE | SETTING_UPDATE | VISION_CONFIG | APIKEY_CREATE | APIKEY_REVOKE | APIKEY_DELETE
  target_type  text NOT NULL,          -- Employee | JobTitle | Department | SystemSetting | ApiKey
  target_id    text,
  target_label text,                   -- tên/mã người đọc hiểu được (nhân viên đã xoá vẫn còn tên)
  before       jsonb,
  after        jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_audit_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON public.admin_audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target  ON public.admin_audit_events (target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action  ON public.admin_audit_events (action, created_at DESC);
DROP TRIGGER IF EXISTS trg_wms_notify ON public.admin_audit_events;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260906_outbound_scan_rowlock.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ══════════════════════════════════════════════════════════════════════════════════════════
-- 06/09/2026 — ĐƯỜNG QUÉT XUẤT: đổi 3 vòng CAS lạc quan (JS) sang KHOÁ DÒNG trong DB.
--
-- VÌ SAO (đo thật 06/09, mô phỏng 1 ngày vận hành 2 kho Ba Vì + Bàu Bàng):
--   Mỗi vòng `claimItemQuota` / `consumeInventoryExact` / `adjustInventoryAtomic` = ĐỌC rồi
--   UPDATE-có-điều-kiện = **2 lượt gọi PostgREST**, và khi CAS trượt thì NGỦ (jitter tới ~310ms)
--   rồi lặp lại — tối đa 15 vòng = **tới 30 lượt gọi cho MỘT lần bấm quét**.
--   Nút thắt của hệ thống KHÔNG phải máy Postgres mà là **số khe pool PostgREST**; vòng thử-lại
--   tự nhân số lượt lên ĐÚNG LÚC đông người — càng tranh chấp càng tốn khe, càng tốn khe càng
--   tranh chấp. Đo được: 1 lượt quét xuất = 19 lượt gọi; ca chiều 2 kho + người xem báo cáo →
--   quét xuất p95 25,4 giây (đỉnh 44,2s), màn Tồn kho/Giám sát/Tổng quan trả 500/503/504.
--
-- CÁCH LÀM: mỗi thao tác thành 1 hàm chạy trong MỘT câu, `SELECT … FOR UPDATE` khoá đúng 1 dòng.
--   - 2 lượt gọi → 1 (giảm nửa số khe cho 3 thao tác nóng nhất).
--   - Không còn thử lại, không còn ngủ jitter: người đến sau CHỜ TRÊN KHOÁ vài mili giây rồi đọc
--     giá trị MỚI NHẤT — mạnh hơn CAS (không thể trượt) và rẻ hơn (không nhân lượt gọi).
--   - NGỮ NGHĨA GIỮ NGUYÊN 100% so với bản JS: cùng công thức trần, cùng bậc thang trạng thái.
--
-- AN TOÀN TRIỂN KHAI: controller vẫn GIỮ đường CAS cũ làm dự phòng — RPC chưa apply (hoặc lỗi)
-- thì tự rơi về đường cũ, không vỡ gì. Apply migration này rồi mới có tác dụng.
-- ══════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. ĐẶT GẠCH hạn mức dòng hàng ─────────────────────────────────────────────────────────
-- Trả jsonb { grant, total, status }. grant = 0 nghĩa là dòng hàng ĐÃ ĐỦ (tương đương 'FULL'
-- của bản JS). Không bao giờ trả null-vì-tranh-chấp: khoá dòng thì lượt sau luôn đi tiếp được.
CREATE OR REPLACE FUNCTION public.outbound_claim_quota(
  p_item_id             text,
  p_want                numeric,
  p_ceiling             numeric,
  p_complete_when_full  boolean,
  p_now                 text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cur    numeric;
  v_grant  numeric;
  v_next   numeric;
  v_status text;
BEGIN
  SELECT COALESCE(cartons_scanned, 0) INTO v_cur
  FROM "OutboundItem" WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('missing', true);
  END IF;

  v_grant := LEAST(p_want, p_ceiling - v_cur);
  IF v_grant <= 0 THEN
    RETURN jsonb_build_object('grant', 0, 'total', v_cur);
  END IF;

  v_next   := v_cur + v_grant;
  -- Bậc thang trạng thái y hệt bản JS: nhặt lẻ / còn dòng nhặt lẻ chưa xác nhận ⇒ KHÔNG tự
  -- COMPLETE dù đủ số (caller truyền p_complete_when_full = false).
  v_status := CASE WHEN p_complete_when_full AND v_next >= p_ceiling THEN 'COMPLETED'
                   ELSE 'IN_PROGRESS' END;

  UPDATE "OutboundItem"
     SET cartons_scanned = v_next, status = v_status, updated_at = p_now::timestamp
   WHERE id = p_item_id;

  RETURN jsonb_build_object('grant', v_grant, 'total', v_next, 'status', v_status);
END $$;

-- ── 2. TRỪ TỒN CHÍNH XÁC khi xuất ─────────────────────────────────────────────────────────
-- Trả { ok:true, remaining, status } · { ok:false } khi KHÔNG ĐỦ TỒN · { missing:true }.
-- Giữ đúng luật cũ: chỉ đụng cartons_remaining, KHÔNG đụng cartons_reserved.
CREATE OR REPLACE FUNCTION public.outbound_consume_exact(
  p_entry_id text,
  p_amount   numeric,
  p_now      text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_remaining numeric;
  v_imported  numeric;
  v_new       numeric;
  v_status    text;
BEGIN
  SELECT COALESCE(cartons_remaining, cartons_imported, 0), COALESCE(cartons_imported, 0)
    INTO v_remaining, v_imported
  FROM "InventoryEntry" WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('missing', true);
  END IF;

  IF v_remaining < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'remaining', v_remaining);
  END IF;

  v_new    := v_remaining - p_amount;
  v_status := CASE WHEN v_new = 0 THEN 'EXPORTED'
                   WHEN v_new < v_imported THEN 'PARTIAL'
                   ELSE 'IN_STOCK' END;

  UPDATE "InventoryEntry"
     SET cartons_remaining = v_new, status = v_status, updated_at = p_now::timestamp
   WHERE id = p_entry_id;

  RETURN jsonb_build_object('ok', true, 'remaining', v_new, 'status', v_status);
END $$;

-- ── 3. CỘNG/TRỪ tồn + giữ chỗ (nhặt lẻ và mọi đường hoàn nguyên) ──────────────────────────
-- Trả { ok:true, remaining, reserved, status } · { missing:true }.
-- Kẹp sàn 0 hai chiều y bản JS; bậc thang trạng thái có thêm nhánh LOOSE_PICKING khi còn giữ chỗ.
CREATE OR REPLACE FUNCTION public.outbound_adjust_entry(
  p_entry_id         text,
  p_delta_remaining  numeric,
  p_delta_reserved   numeric,
  p_now              text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_remaining numeric;
  v_reserved  numeric;
  v_imported  numeric;
  v_new_rem   numeric;
  v_new_res   numeric;
  v_status    text;
BEGIN
  SELECT COALESCE(cartons_remaining, 0), COALESCE(cartons_reserved, 0), COALESCE(cartons_imported, 0)
    INTO v_remaining, v_reserved, v_imported
  FROM "InventoryEntry" WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('missing', true);
  END IF;

  v_new_rem := GREATEST(0, v_remaining + p_delta_remaining);
  v_new_res := GREATEST(0, v_reserved  + p_delta_reserved);
  v_status  := CASE WHEN v_new_res > 0 THEN 'LOOSE_PICKING'
                    WHEN v_new_rem = 0 THEN 'EXPORTED'
                    WHEN v_new_rem < v_imported THEN 'PARTIAL'
                    ELSE 'IN_STOCK' END;

  UPDATE "InventoryEntry"
     SET cartons_remaining = v_new_rem, cartons_reserved = v_new_res,
         status = v_status, updated_at = p_now::timestamp
   WHERE id = p_entry_id;

  RETURN jsonb_build_object('ok', true, 'remaining', v_new_rem, 'reserved', v_new_res, 'status', v_status);
END $$;

-- Quyền: backend đi service_role (đã có sẵn). Mặc định toàn cục đã tắt PUBLIC từ 20260902d nên
-- RPC mới TỰ ĐÓNG với anon/authenticated — không GRANT gì thêm (xem CLAUDE.md, mục realtime).



-- ─────────────────────────────────────────────────────────────────────────
-- [20260906b_control_tower_stale.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ══════════════════════════════════════════════════════════════════════════════════════════
-- 06/09/2026 — GIÁM SÁT VẬN HÀNH: quá tải thì ĐƯA SỐ CŨ (nói rõ giờ chốt), đừng báo lỗi.
--
-- VÌ SAO (đo thật 06/09, ca chiều 2 kho + 4 người xem báo cáo):
--   `control_tower_stats_cached` có sẵn cache 30s + chống giẫm đạp (nhiều người cùng miss thì
--   CHỈ MỘT người tính, số còn lại nhận số cũ). Nhưng NGƯỜI ĐI TÍNH thì không có đường lui:
--   hàm để `statement_timeout = 30s`, dưới tải ghi nặng câu tính vượt 30s ⇒ người đó ôm khe
--   pool trọn 30 giây rồi nhận 503, mà cache VẪN không được làm mới ⇒ người kế tiếp lại thành
--   "người đi tính" và lại 30 giây nữa. Đo được: màn Giám sát vận hành p50 32,7s, 503 liên tục,
--   trong khi lúc máy rảnh nó chỉ 0,19s.
--
-- CÁCH LÀM (2 việc nhỏ, không đụng công thức tính):
--   1. Hạ trần thời gian tính 30s → 12s. Quá 12 giây nghĩa là hệ thống đang nghẽn — lúc đó câu
--      trả lời đúng là "số liệu lúc HH:MM", không phải bắt người dùng chờ thêm 18 giây rồi báo lỗi.
--      Máy rảnh chỉ mất 0,19s nên trần này không bao giờ chạm trong vận hành bình thường.
--   2. Thêm hàm đọc SỐ CŨ theo đúng khoá cache, KHÔNG tính lại — controller gọi khi hết giờ tính,
--      trả 200 kèm cờ `stale` + `computed_at` để màn hình NÓI THẲNG là số cũ.
-- ══════════════════════════════════════════════════════════════════════════════════════════

-- 1. Trần thời gian tính: 30s → 12s (nghẽn thì bỏ sớm, nhả khe pool cho sàn kho)
ALTER FUNCTION public.control_tower_stats_cached(text[], text[], date, text[], integer)
  SET statement_timeout TO '12s';

-- 2. Đọc số ĐÃ TÍNH LẦN TRƯỚC theo đúng khoá cache của màn Giám sát vận hành.
--    Không tính, không ghi — chỉ tra bảng cache nên luôn trả về trong vài mili giây.
--    NULL = chưa từng có số nào (lần đầu trong ngày) ⇒ controller giữ nguyên 503 có hướng dẫn.
CREATE OR REPLACE FUNCTION public.control_tower_stats_stale(
  p_warehouse_ids  text[],
  p_categories     text[],
  p_today          date,
  p_material_codes text[]
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET statement_timeout TO '5s'
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_row record;
BEGIN
  v_key := md5('ct|' || cache_key_part(p_warehouse_ids) || '|' || cache_key_part(p_categories)
            || '|' || coalesce(p_today::text, '*') || '|' || cache_key_part(p_material_codes));
  SELECT c.payload, c.computed_at INTO v_row
    FROM public.dashboard_cache c WHERE c.key = v_key;
  IF v_row.payload IS NULL THEN RETURN NULL; END IF;
  RETURN v_row.payload || jsonb_build_object('stale', true, 'computed_at', v_row.computed_at);
END $$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260907_tmsorder_status_enum.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- TmsOrder.status — CHUẨN HOÁ TÊN + KHOÁ DANH SÁCH ĐÓNG (user chốt 07/09: "Chờ · Xong · Huỷ")
--
-- VÌ SAO:
--   (1) BẪY DI SẢN — 3.173 lệnh của 17/07–17/08 mang 'COMPLETED' trong khi code hiện tại ghi 'DONE'.
--       Hai cái tên cho CÙNG MỘT VIỆC. Chưa gây lỗi vì chưa chỗ nào lọc theo chúng, nhưng báo cáo
--       "lệnh đã hoàn thành" đầu tiên sẽ mất một nửa số liệu — và mất IM LẶNG, không lỗi, không cảnh báo.
--   (2) Ô này chưa có danh sách đóng: `PATCH /tms/orders/:id` nhận `status` thô từ body nên gọi thẳng
--       API là ghi được giá trị bất kỳ. Cùng lớp lỗi với trạng thái DÒNG XE đã vá cùng ngày, ở đó một
--       giá trị lạ làm xe rơi khỏi phép đếm sức chứa và hỏng cả trang cài khung giờ của kho.
--   Backend đã chặn ở `orderController` (ORDER_STATUSES); CHECK dưới đây là lớp cuối, chặn CẢ đường
--   ghi không qua app (script, sửa tay, tích hợp sau này).
--
-- ÁP: Supabase Dashboard → SQL Editor, chạy nguyên file. STAGING trước, kiểm, rồi mới tới DB thật.
-- Chạy lại nhiều lần vô hại (idempotent).

-- [cutover] gỡ: BEGIN;

-- 1) Backup trước khi đổi nghĩa dữ liệu — giữ đúng những dòng sắp bị đụng.
CREATE TABLE IF NOT EXISTS x_bak_tmsorder_status_20260907 AS
SELECT id, status, completed_at, updated_at
FROM "TmsOrder"
WHERE status NOT IN ('PENDING', 'DONE', 'CANCELLED');
-- Bảng public nào cũng bật RLS (gói QA 00 bất biến gác; anon/authenticated vốn không có GRANT nên đây là lớp
-- thứ hai) — bản staging 07/09 quên dòng này, gói 00 đỏ ngay lượt chạy kế.
ALTER TABLE x_bak_tmsorder_status_20260907 ENABLE ROW LEVEL SECURITY;

-- 2) 'COMPLETED' (tên cũ) → 'DONE' (tên code đang dùng).
UPDATE "TmsOrder" SET status = 'DONE'
WHERE status = 'COMPLETED';

-- 3) Giá trị lạ khác (nếu có) → PENDING, tức "chưa xong": an toàn hơn tự nhận là đã xong.
--    Bản backup ở bước 1 giữ nguyên giá trị gốc để còn lần lại.
UPDATE "TmsOrder" SET status = 'PENDING'
WHERE status NOT IN ('PENDING', 'DONE', 'CANCELLED');

-- 4) Còn giá trị ngoài danh sách thì DỪNG — không thêm ràng buộc lên dữ liệu chưa sạch.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "TmsOrder" WHERE status NOT IN ('PENDING', 'DONE', 'CANCELLED');
  IF n > 0 THEN
    RAISE EXCEPTION 'Còn % lệnh mang trạng thái ngoài danh sách — dọn trước khi thêm CHECK', n;
  END IF;
END $$;

-- 5) Khoá danh sách đóng ở tầng DB.
ALTER TABLE "TmsOrder" DROP CONSTRAINT IF EXISTS tmsorder_status_check;
ALTER TABLE "TmsOrder" ADD CONSTRAINT tmsorder_status_check
  CHECK (status IN ('PENDING', 'DONE', 'CANCELLED'));

-- [cutover] gỡ: COMMIT;

-- Kiểm sau khi chạy (phải ra đúng 2–3 dòng, không dòng nào ngoài danh sách):
--   SELECT status, count(*) FROM "TmsOrder" GROUP BY 1 ORDER BY 2 DESC;
-- Đường lui:
--   ALTER TABLE "TmsOrder" DROP CONSTRAINT tmsorder_status_check;
--   UPDATE "TmsOrder" o SET status = b.status
--     FROM x_bak_tmsorder_status_20260907 b WHERE b.id = o.id;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260908_warehouse_map.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- 20260908 — SƠ ĐỒ KHO bản một (nền cho Directed Work — user chốt 08/09/2026)
-- ============================================================================
-- VÌ SAO: hệ thống muốn chỉ "tới ô nào, lấy hàng nào trước" thì phải biết ô nằm ĐÂU trong kho.
-- Hôm nay Location chỉ có `row`/`shelf` dạng CHỮ (sort chuỗi: "10" đứng trước "2"), không toạ độ,
-- không thứ tự đường đi; thước đo gần cửa duy nhất là `WarehouseZone.pick_rank` (thủ công, cấp KHU).
--
-- MÔ HÌNH (user chốt qua 8 vòng): bản vẽ 2D nhìn từ trên xuống, 1 ô lưới ≈ 1 chân pallet (~1,2 m).
--   • Mỗi vị trí có toạ độ ô (grid_x, grid_y). Các TẦNG của cùng chân kệ (A12_T1..T4) DÙNG CHUNG
--     một ô lưới, chỉ khác `level_no` — tầng KHÔNG đổi quãng đường, chỉ đổi AI làm (xe hạ) và
--     THỜI GIAN thao tác. Đây là điều user nhấn mạnh: "tôi có các tầng trên 1 vị trí".
--   • Cửa xuất / cửa nhập / bãi / điểm đầu dãy CŨNG LÀ VỊ TRÍ (cột `kind`) — kho đã có sẵn các ô đặt
--     tên như "SX CHỜ XỬ LÝ", "CONT LẠNH", nên không đẻ bảng mới.
--   • Ô có vị trí (kind STORAGE) hoặc tường = CHẮN; ô trống = LỐI ĐI ⇒ khoảng cách = tìm đường
--     trên lưới (BFS, utils/warehouseGrid.ts — BE + FE cùng một bản). KHÔNG lưu khoảng cách: một
--     nguồn sự thật là bản vẽ.
--   • `is_rack` + `level_no`: tự suy từ mã ô (đuôi T1..T4 = kệ có tầng; không đuôi = ô sàn tầng 1),
--     thủ kho sửa tay chỗ sai. Ngưỡng "từ tầng mấy cần xe hạ" nằm ở cấp kho (đợt 1).
--
-- KHÔNG đụng hành vi hiện có: mọi cột mới nullable/default, không route nào đang chạy đọc chúng.
-- ============================================================================

-- ── 1. Cột mới trên Location ─────────────────────────────────────────────────────────────────────
ALTER TABLE public."Location"
  ADD COLUMN IF NOT EXISTS is_rack  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS level_no integer,
  ADD COLUMN IF NOT EXISTS grid_x   integer,
  ADD COLUMN IF NOT EXISTS grid_y   integer,
  ADD COLUMN IF NOT EXISTS kind     text NOT NULL DEFAULT 'STORAGE';

ALTER TABLE public."Location" DROP CONSTRAINT IF EXISTS location_kind_check;
ALTER TABLE public."Location" ADD CONSTRAINT location_kind_check
  CHECK (kind IN ('STORAGE', 'DOCK_IN', 'DOCK_OUT', 'DROP'));
-- Tầng 0..50 (cột integer — số rác 1e12 tràn kiểu thành 500, cùng bài học max_materials 26/08)
ALTER TABLE public."Location" DROP CONSTRAINT IF EXISTS location_level_no_range;
ALTER TABLE public."Location" ADD CONSTRAINT location_level_no_range
  CHECK (level_no IS NULL OR (level_no >= 0 AND level_no <= 50));
-- Toạ độ lưới: cả hai cùng NULL (chưa đặt) hoặc cả hai ≥ 0 — không có trạng thái "nửa toạ độ"
ALTER TABLE public."Location" DROP CONSTRAINT IF EXISTS location_grid_pair;
ALTER TABLE public."Location" ADD CONSTRAINT location_grid_pair
  CHECK ((grid_x IS NULL AND grid_y IS NULL)
      OR (grid_x IS NOT NULL AND grid_y IS NOT NULL AND grid_x >= 0 AND grid_y >= 0 AND grid_x < 1000 AND grid_y < 1000));

COMMENT ON COLUMN public."Location".is_rack  IS 'Ô kệ (true) hay ô sàn (false). Tự suy từ đuôi tầng của mã ô lúc backfill 08/09; sửa tay được.';
COMMENT ON COLUMN public."Location".level_no IS 'Tầng của ô kệ (1 = sát sàn). Các tầng cùng chân kệ dùng CHUNG một ô lưới. NULL = không suy được từ mã.';
COMMENT ON COLUMN public."Location".grid_x   IS 'Cột ô lưới trên Sơ đồ kho (1 ô ≈ 1 chân pallet). NULL = chưa đặt lên bản vẽ.';
COMMENT ON COLUMN public."Location".grid_y   IS 'Hàng ô lưới trên Sơ đồ kho. Đi cặp với grid_x.';
COMMENT ON COLUMN public."Location".kind     IS 'STORAGE = ô chứa hàng · DOCK_OUT = cửa/bãi xuất · DOCK_IN = cửa/bãi nhập · DROP = điểm đầu dãy (xe hạ đặt pallet xuống).';

-- Backfill tầng + kệ từ mã ô. Không đụng vị trí kind ≠ STORAGE (chưa có dòng nào lúc này).
--   shelf 'T3' / '3' / 'T03' → level 3, is_rack true    (kệ có tầng)
--   shelf ''                 → level 1, is_rack false   (ô sàn / ô đặt tên)
--   shelf chữ khác ('MẶT ĐẤT'…) → level NULL, is_rack false
UPDATE public."Location"
   SET level_no = CASE
                    WHEN coalesce(shelf, '') = '' THEN 1
                    WHEN shelf ~ '^[Tt]?0*[0-9]{1,2}$' THEN least(50, (regexp_replace(shelf, '^[Tt]?0*', ''))::int)
                    ELSE NULL
                  END,
       is_rack  = (shelf ~ '^[Tt]?0*[0-9]{1,2}$')
 WHERE kind = 'STORAGE' AND level_no IS NULL;

-- Tra "ô nào ở toạ độ này" khi gán/kiểm trùng + vẽ lưới theo kho
CREATE INDEX IF NOT EXISTS idx_location_grid ON public."Location" (warehouse_id, grid_x, grid_y) WHERE grid_x IS NOT NULL;

-- ── 2. Khung bản vẽ theo kho ─────────────────────────────────────────────────────────────────────
-- 1 dòng / kho. `blocked` = danh sách ô tường/cột [[x,y],…] (ô có vị trí đã tự là ô chắn, không lặp ở đây).
-- Trần 400×400 = 160.000 ô — BFS vẫn mili-giây; kho thật ~100×60.
CREATE TABLE IF NOT EXISTS public.warehouse_maps (
  warehouse_id text PRIMARY KEY REFERENCES public."Warehouse"(id) ON DELETE CASCADE,
  width        integer NOT NULL CHECK (width  BETWEEN 5 AND 400),
  height       integer NOT NULL CHECK (height BETWEEN 5 AND 400),
  cell_m       numeric(4,2) NOT NULL DEFAULT 1.2 CHECK (cell_m > 0 AND cell_m <= 10),
  blocked      jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);
ALTER TABLE public.warehouse_maps ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.warehouse_maps IS 'Sơ đồ kho 2D: khung lưới + ô chắn. Vị trí/cửa/bãi đặt lên lưới qua Location.grid_x/grid_y/kind.';
-- Giữ trigger realtime (event-trigger tự gắn trg_wms_notify): người khác sửa bản vẽ → màn sơ đồ tự nạp lại.

-- ── 3. RPC gán ô theo LÔ — 1 câu UPDATE, all-or-nothing ─────────────────────────────────────────
-- p_items: [{"location_id":"…","grid_x":3,"grid_y":7}, {"location_id":"…","grid_x":null,"grid_y":null}]
--   grid null = gỡ khỏi bản vẽ. Kiểm trong transaction:
--   (a) mọi id thuộc đúng kho (id kho khác → NOT_IN_WAREHOUSE, chống IDOR theo cặp id);
--   (b) trong biên khung (nếu kho đã có khung);
--   (c) hai CHÂN KỆ khác nhau không được chung ô — chân kệ = (sub_code, row); các tầng cùng chân
--       kệ thì chung ô là ĐÚNG THIẾT KẾ. Ô DOCK/DROP là chân riêng của chính nó.
-- Trả jsonb {ok, updated, conflicts:[{location_code, other_code, x, y}], error}.
-- Không GRANT (default đã đóng PUBLIC từ 20260815i/j — backend đi service_role).
CREATE OR REPLACE FUNCTION public.warehouse_map_assign_cells(p_warehouse_id text, p_items jsonb, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_n       integer;
  v_bad     integer;
  v_w       integer;
  v_h       integer;
  v_conf    jsonb;
  v_updated integer;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_ITEMS');
  END IF;
  SELECT count(*) INTO v_n FROM jsonb_array_elements(p_items);
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', true, 'updated', 0); END IF;
  IF v_n > 2000 THEN RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY'); END IF;

  -- Pooler transaction-mode dùng chung phiên server: bảng tạm của lượt trước có thể còn tới COMMIT
  DROP TABLE IF EXISTS tmp_assign;
  CREATE TEMP TABLE tmp_assign ON COMMIT DROP AS
    SELECT (e->>'location_id')::text AS location_id,
           NULLIF(e->>'grid_x', '')::int AS gx,
           NULLIF(e->>'grid_y', '')::int AS gy
      FROM jsonb_array_elements(p_items) e;

  -- (a) id lạ hoặc kho khác
  SELECT count(*) INTO v_bad
    FROM tmp_assign t LEFT JOIN public."Location" l ON l.id = t.location_id
   WHERE l.id IS NULL OR l.warehouse_id IS DISTINCT FROM p_warehouse_id;
  IF v_bad > 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_IN_WAREHOUSE', 'count', v_bad); END IF;

  -- nửa toạ độ
  IF EXISTS (SELECT 1 FROM tmp_assign WHERE (gx IS NULL) <> (gy IS NULL)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'HALF_COORD');
  END IF;

  -- (b) trong biên khung
  SELECT width, height INTO v_w, v_h FROM public.warehouse_maps WHERE warehouse_id = p_warehouse_id;
  IF v_w IS NOT NULL AND EXISTS (SELECT 1 FROM tmp_assign WHERE gx IS NOT NULL AND (gx < 0 OR gy < 0 OR gx >= v_w OR gy >= v_h)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_BOUNDS');
  END IF;

  -- (c) hai chân kệ khác nhau chung một ô: so với dòng ĐÃ CÓ trong kho (không nằm trong lô) và
  --     so lẫn nhau trong lô. Chân kệ = (sub_code, row); kind ≠ STORAGE = chân riêng theo id.
  WITH mine AS (
    SELECT t.location_id, t.gx, t.gy, l.location_code,
           CASE WHEN l.kind = 'STORAGE' THEN coalesce(l.sub_code, '') || '|' || coalesce(l.row, '') ELSE 'K|' || l.id END AS foot
      FROM tmp_assign t JOIN public."Location" l ON l.id = t.location_id
     WHERE t.gx IS NOT NULL
  ), others AS (
    SELECT l.id, l.grid_x, l.grid_y, l.location_code,
           CASE WHEN l.kind = 'STORAGE' THEN coalesce(l.sub_code, '') || '|' || coalesce(l.row, '') ELSE 'K|' || l.id END AS foot
      FROM public."Location" l
     WHERE l.warehouse_id = p_warehouse_id AND l.grid_x IS NOT NULL AND l.is_active
       AND l.id NOT IN (SELECT location_id FROM tmp_assign)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('location_code', c.a, 'other_code', c.b, 'x', c.x, 'y', c.y)), '[]'::jsonb)
    INTO v_conf
    FROM (
      SELECT m.location_code a, o.location_code b, m.gx x, m.gy y
        FROM mine m JOIN others o ON o.grid_x = m.gx AND o.grid_y = m.gy AND o.foot <> m.foot
      UNION ALL
      SELECT m1.location_code, m2.location_code, m1.gx, m1.gy
        FROM mine m1 JOIN mine m2 ON m1.gx = m2.gx AND m1.gy = m2.gy AND m1.foot <> m2.foot AND m1.location_id < m2.location_id
      LIMIT 20
    ) c;
  IF jsonb_array_length(v_conf) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CELL_CONFLICT', 'conflicts', v_conf);
  END IF;

  UPDATE public."Location" l
     SET grid_x = t.gx, grid_y = t.gy, updated_at = now(), updated_by = p_actor
    FROM tmp_assign t
   WHERE l.id = t.location_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

-- ── 4. RPC tồn theo ô — 1 round-trip, trả jsonb (không dính trần 1000 dòng của PostgREST) ────────
-- Mỗi ô: số pallet còn tồn, số mã khác nhau, tổng base (chỉ để so giữa cùng mã — FE KHÔNG gắn nhãn
-- "thùng" cho tổng cross-mã), số pallet QA giữ. Chỉ đếm dòng còn hàng — cùng luật với used_slots.
CREATE OR REPLACE FUNCTION public.warehouse_map_occupancy(p_warehouse_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'location_id', s.location_id,
           'pallets', s.pallets, 'materials', s.materials, 'qty_base', s.qty_base, 'quarantine', s.quarantine)), '[]'::jsonb)
    FROM (
      SELECT e.location_id,
             count(*)::int AS pallets,
             count(DISTINCT e.material_id)::int AS materials,
             sum(e.cartons_remaining)::numeric AS qty_base,
             count(*) FILTER (WHERE e.status = 'QUARANTINE')::int AS quarantine
        FROM public."InventoryEntry" e
        JOIN public."Location" l ON l.id = e.location_id
       WHERE l.warehouse_id = p_warehouse_id
         AND e.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
         AND e.cartons_remaining > 0
       GROUP BY e.location_id
    ) s;
$$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260908b_warehouse_map_span.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260908b — Ô có KÍCH THƯỚC trên bản vẽ (user bổ sung ngay khi đang dựng đợt 0).
--
-- Hai tầng kích thước:
--   • `warehouse_maps.cell_m` (đã có) = một ô lưới bằng mấy mét → khoảng cách ra MÉT = số ô × cell_m.
--   • `Location.grid_w/grid_h` (thêm ở đây) = vị trí chiếm mấy ô lưới. Ô kệ = 1×1; ô sàn xếp khối
--     32 pallet phải vẽ thành khối 4×8 thì bản vẽ mới giống kho thật và ô chắn mới đúng chỗ.
--   Neo (grid_x, grid_y) = góc trên-trái của khối; các tầng cùng chân kệ dùng chung neo + kích thước.
ALTER TABLE public."Location"
  ADD COLUMN IF NOT EXISTS grid_w integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS grid_h integer NOT NULL DEFAULT 1;
ALTER TABLE public."Location" DROP CONSTRAINT IF EXISTS location_grid_span;
ALTER TABLE public."Location" ADD CONSTRAINT location_grid_span
  CHECK (grid_w BETWEEN 1 AND 100 AND grid_h BETWEEN 1 AND 100);
COMMENT ON COLUMN public."Location".grid_w IS 'Số ô lưới vị trí chiếm theo chiều ngang trên Sơ đồ kho (ô sàn lớn > 1).';
COMMENT ON COLUMN public."Location".grid_h IS 'Số ô lưới vị trí chiếm theo chiều dọc trên Sơ đồ kho.';

-- RPC gán ô: nhận thêm grid_w/grid_h; kiểm trùng theo HÌNH CHỮ NHẬT (hai chân kệ khác nhau không
-- được giao nhau), vẫn all-or-nothing trong một transaction.
-- p_items: [{"location_id","grid_x","grid_y","grid_w"?,"grid_h"?}] — grid null = gỡ khỏi bản vẽ.
DROP FUNCTION IF EXISTS public.warehouse_map_assign_cells(text, jsonb, text);
CREATE OR REPLACE FUNCTION public.warehouse_map_assign_cells(p_warehouse_id text, p_items jsonb, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_n       integer;
  v_bad     integer;
  v_w       integer;
  v_h       integer;
  v_conf    jsonb;
  v_updated integer;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_ITEMS');
  END IF;
  SELECT count(*) INTO v_n FROM jsonb_array_elements(p_items);
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', true, 'updated', 0); END IF;
  IF v_n > 2000 THEN RETURN jsonb_build_object('ok', false, 'error', 'TOO_MANY'); END IF;

  DROP TABLE IF EXISTS tmp_assign;
  CREATE TEMP TABLE tmp_assign ON COMMIT DROP AS
    SELECT (e->>'location_id')::text AS location_id,
           NULLIF(e->>'grid_x', '')::int AS gx,
           NULLIF(e->>'grid_y', '')::int AS gy,
           greatest(1, least(100, coalesce(NULLIF(e->>'grid_w', '')::int, 1))) AS gw,
           greatest(1, least(100, coalesce(NULLIF(e->>'grid_h', '')::int, 1))) AS gh
      FROM jsonb_array_elements(p_items) e;

  SELECT count(*) INTO v_bad
    FROM tmp_assign t LEFT JOIN public."Location" l ON l.id = t.location_id
   WHERE l.id IS NULL OR l.warehouse_id IS DISTINCT FROM p_warehouse_id;
  IF v_bad > 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_IN_WAREHOUSE', 'count', v_bad); END IF;

  IF EXISTS (SELECT 1 FROM tmp_assign WHERE (gx IS NULL) <> (gy IS NULL)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'HALF_COORD');
  END IF;

  SELECT width, height INTO v_w, v_h FROM public.warehouse_maps WHERE warehouse_id = p_warehouse_id;
  IF v_w IS NOT NULL AND EXISTS (
       SELECT 1 FROM tmp_assign WHERE gx IS NOT NULL AND (gx < 0 OR gy < 0 OR gx + gw > v_w OR gy + gh > v_h)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_BOUNDS');
  END IF;

  WITH mine AS (
    SELECT t.location_id, t.gx, t.gy, t.gw, t.gh, l.location_code,
           CASE WHEN l.kind = 'STORAGE' THEN coalesce(l.sub_code, '') || '|' || coalesce(l.row, '') ELSE 'K|' || l.id END AS foot
      FROM tmp_assign t JOIN public."Location" l ON l.id = t.location_id
     WHERE t.gx IS NOT NULL
  ), others AS (
    SELECT l.id, l.grid_x gx, l.grid_y gy, l.grid_w gw, l.grid_h gh, l.location_code,
           CASE WHEN l.kind = 'STORAGE' THEN coalesce(l.sub_code, '') || '|' || coalesce(l.row, '') ELSE 'K|' || l.id END AS foot
      FROM public."Location" l
     WHERE l.warehouse_id = p_warehouse_id AND l.grid_x IS NOT NULL AND l.is_active
       AND l.id NOT IN (SELECT location_id FROM tmp_assign)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('location_code', c.a, 'other_code', c.b, 'x', c.x, 'y', c.y)), '[]'::jsonb)
    INTO v_conf
    FROM (
      SELECT m.location_code a, o.location_code b, m.gx x, m.gy y
        FROM mine m JOIN others o
          ON o.foot <> m.foot
         AND m.gx < o.gx + o.gw AND o.gx < m.gx + m.gw
         AND m.gy < o.gy + o.gh AND o.gy < m.gy + m.gh
      UNION ALL
      SELECT m1.location_code, m2.location_code, m1.gx, m1.gy
        FROM mine m1 JOIN mine m2
          ON m1.foot <> m2.foot AND m1.location_id < m2.location_id
         AND m1.gx < m2.gx + m2.gw AND m2.gx < m1.gx + m1.gw
         AND m1.gy < m2.gy + m2.gh AND m2.gy < m1.gy + m1.gh
      LIMIT 20
    ) c;
  IF jsonb_array_length(v_conf) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CELL_CONFLICT', 'conflicts', v_conf);
  END IF;

  UPDATE public."Location" l
     SET grid_x = t.gx, grid_y = t.gy, grid_w = t.gw, grid_h = t.gh, updated_at = now(), updated_by = p_actor
    FROM tmp_assign t
   WHERE l.id = t.location_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;


COMMIT;
-- === HẾT PART 4/10 ===
