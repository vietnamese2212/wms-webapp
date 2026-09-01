-- 20260901e — Truy theo thông số SX: KHÔNG GÌ BẮT BUỘC + dropdown gợi ý (user chốt 01/09 tối
-- lần 2: "k có gì bắt buộc cả nhé, ra filter nào thì lấy cái đó" + "dropdown chuẩn đâu rồi").
--
-- (1) 3 INDEX BIỂU THỨC trên đoạn tem V1 — để tra Chu kỳ/Máy/Kho SX KHÔNG cần khoảng ngày mà
--     vẫn không Seq Scan bảng triệu dòng (biểu thức trong index phải KHỚP NGUYÊN VĂN với query).
CREATE INDEX IF NOT EXISTS idx_ie_tem_cycle
  ON public."InventoryEntry" ((coalesce(nullif(ltrim(split_part(pallet_code, '_', 3), '0'), ''), '0')));
CREATE INDEX IF NOT EXISTS idx_ie_tem_machine
  ON public."InventoryEntry" ((upper(split_part(pallet_code, '_', 4))));
CREATE INDEX IF NOT EXISTS idx_ie_tem_nmsx
  ON public."InventoryEntry" ((upper(split_part(pallet_code, '_', 6))));

-- (2) lot_trace: nhánh prod bỏ mọi ràng buộc — có điều kiện nào dùng điều kiện đó (chữ ký GIỮ
--     NGUYÊN 13 tham số của 20260901d nên CREATE OR REPLACE an toàn, không tạo overload).
--     Ngày đủ 2 đầu ≤92 ngày → OR tiền tố ddmmyy_% (nhanh nhất); còn lại lọc production_date.
--     Tập mã kẹp 5000 (chỉ chọn 1 tiêu chí rất rộng, vd mỗi Kho SX, thì phần sau vẫn sống).
CREATE OR REPLACE FUNCTION public.lot_trace(
  p_kind        text,
  p_value       text,
  p_prod_from   date DEFAULT NULL, p_prod_to date DEFAULT NULL,
  p_ship_from   date DEFAULT NULL, p_ship_to date DEFAULT NULL,
  p_wh_ids      text[] DEFAULT NULL,
  p_categories  text[] DEFAULT NULL,
  p_limit       int DEFAULT 500,
  p_codes       text[] DEFAULT NULL,
  p_cycle       text DEFAULT NULL,
  p_machine     text DEFAULT NULL,
  p_nmsx        text DEFAULT NULL
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
  IF p_kind IS NULL OR (p_kind NOT IN ('codes', 'prod') AND v_val = '') THEN RETURN v_empty; END IF;

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
  ELSIF p_kind = 'prod' THEN
    v_where := 'true';
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
    IF v_where = 'true' THEN RETURN v_empty; END IF;   -- không có điều kiện nào = không có gì để tìm
    EXECUTE
      'SELECT array_agg(x.code) FROM (
         SELECT DISTINCT ie.pallet_code AS code
           FROM "InventoryEntry" ie
           LEFT JOIN "Material" m ON m.id = ie.material_id
          WHERE ' || v_where || v_scope_stk || '
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

-- (3) trace_suggest: thêm 3 kiểu gợi ý cho dropdown Chu kỳ / Máy / Kho SX (danh mục nhỏ — rỗng
--     vẫn gợi ý). Nguồn: Chu kỳ + Máy từ Sổ đóng gói (packing_runs) ∪ danh mục máy
--     (warehouse_machines); Kho SX từ Warehouse.nmsx_code. Giá trị chưa từng có trong nguồn vẫn
--     dùng được — FE chèn dòng 'Dùng "…"' từ chính từ khóa đang gõ.
CREATE OR REPLACE FUNCTION public.trace_suggest(
  p_kind   text,                -- pallet | material | batch | npp | trip | plate | cycle | machine | nmsx
  p_search text DEFAULT NULL,
  p_limit  int  DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  s   text := btrim(coalesce(p_search, ''));
  lim int  := least(greatest(coalesce(p_limit, 50), 1), 100);
  v   jsonb := '[]'::jsonb;
BEGIN
  IF p_kind = 'material' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.c, 'label', x.l)), '[]') INTO v FROM (
      SELECT m.material_code c, m.material_code || ' — ' || coalesce(m.short_name, m.material_description, '') l
        FROM "Material" m
       WHERE m.is_active IS NOT FALSE
         AND (s = '' OR m.material_code ILIKE '%' || s || '%'
              OR m.short_name ILIKE '%' || s || '%' OR m.material_description ILIKE '%' || s || '%')
       ORDER BY m.material_code LIMIT lim) x;
  ELSIF p_kind = 'cycle' THEN
    -- chu kỳ so DẠNG CHUẨN (bỏ 0 dẫn đầu, "055" ≡ "55"); sắp theo số (độ dài rồi giá trị)
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', y.c, 'label', y.c)), '[]') INTO v FROM (
      SELECT x.c FROM (
        SELECT DISTINCT coalesce(nullif(ltrim(btrim(pr.cycle), '0'), ''), '0') c
          FROM packing_runs pr
         WHERE pr.cycle IS NOT NULL AND btrim(pr.cycle) <> ''
           AND (s = '' OR coalesce(nullif(ltrim(btrim(pr.cycle), '0'), ''), '0') ILIKE s || '%')) x
       ORDER BY length(x.c), x.c LIMIT lim) y;
  ELSIF p_kind = 'machine' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', y.m, 'label', y.m)), '[]') INTO v FROM (
      SELECT DISTINCT upper(btrim(u.code)) m FROM (
        SELECT wm.code FROM warehouse_machines wm
        UNION ALL
        SELECT pr.machine_code AS code FROM packing_runs pr) u
       WHERE u.code IS NOT NULL AND btrim(u.code) <> ''
         AND (s = '' OR upper(btrim(u.code)) LIKE upper(s) || '%')
       ORDER BY 1 LIMIT lim) y;
  ELSIF p_kind = 'nmsx' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', y.c, 'label', y.l)), '[]') INTO v FROM (
      SELECT DISTINCT ON (upper(w.nmsx_code))
             upper(w.nmsx_code) c, upper(w.nmsx_code) || ' — ' || w.name l
        FROM "Warehouse" w
       WHERE w.nmsx_code IS NOT NULL AND btrim(w.nmsx_code) <> ''
         AND (s = '' OR w.nmsx_code ILIKE s || '%' OR w.name ILIKE '%' || s || '%')
       ORDER BY upper(w.nmsx_code), w.name LIMIT lim) y;
  ELSIF s = '' THEN
    RETURN v;   -- các kiểu còn lại quét bảng GIAO DỊCH lớn — bắt buộc có từ khóa mới tìm
  ELSIF p_kind = 'pallet' THEN
    EXECUTE format(
      'SELECT coalesce(jsonb_agg(jsonb_build_object(''value'', x.pc, ''label'', x.pc)), ''[]'') FROM (
         SELECT DISTINCT ie.pallet_code pc FROM "InventoryEntry" ie
          WHERE ie.pallet_code LIKE %L ORDER BY 1 LIMIT %s) x', s || '%', lim)
      INTO v;
  ELSIF p_kind = 'batch' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.b, 'label', x.b)), '[]') INTO v FROM (
      SELECT DISTINCT ie.batch b FROM "InventoryEntry" ie
       WHERE ie.batch IS NOT NULL AND ie.batch ILIKE '%' || s || '%' ORDER BY 1 LIMIT lim) x;
  ELSIF p_kind = 'npp' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.n, 'label', x.n)), '[]') INTO v FROM (
      SELECT DISTINCT d.distributor_name n FROM "OutboundDelivery" d
       WHERE d.distributor_name IS NOT NULL AND d.distributor_name ILIKE '%' || s || '%'
       ORDER BY 1 LIMIT lim) x;
  ELSIF p_kind = 'trip' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.g, 'label', x.g)), '[]') INTO v FROM (
      SELECT DISTINCT g.group_code g FROM "GroupDeliveryOrder" g
       WHERE g.group_code ILIKE '%' || s || '%' ORDER BY 1 DESC LIMIT lim) x;
  ELSIF p_kind = 'plate' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', x.p, 'label', x.p)), '[]') INTO v FROM (
      SELECT DISTINCT g.license_plate p FROM "GroupDeliveryOrder" g
       WHERE g.license_plate IS NOT NULL
         AND upper(regexp_replace(g.license_plate, '[^A-Za-z0-9]', '', 'g'))
             LIKE '%' || upper(regexp_replace(s, '[^A-Za-z0-9]', '', 'g')) || '%'
       ORDER BY 1 LIMIT lim) x;
  END IF;
  RETURN v;
END $fn$;
