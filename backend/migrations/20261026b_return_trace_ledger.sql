-- ============================================================================
-- 20261026b — Nhập hàng trả về: SỔ PALLET + TRUY XUẤT LÔ thấy phần trả về (sau 20261026_inbound_return)
-- ============================================================================
-- pallet_ledger: (2) dòng tồn của phiếu nhập RETURN hiện là 'RETURNED' (ref = chuyến gốc / số phiếu trả, note = lý do) thay vì
--   'RECEIVED' trơn; (9) MỚI — tem GỐC thấy lần hàng lẻ của nó quay về thành tem con ".N" (sổ nhận trả, không cộng dồn).
--   Cộng dồn vào tem còn tồn đã có dòng ĐIỀU CHỈNH ghi chú "Nhập trả về …" (nguồn 4) ⇒ không kể lần hai.
-- lot_trace: mỗi dòng xuất mang `returned` = phần đã nhận trả về của (tem, chuyến) — gán vào DÒNG ĐẦU của cặp đó để không
--   cộng hai lần khi một tem quét cho nhiều DO cùng chuyến; tổng `qty_returned`. "Đã giao khách" = qty_shipped − qty_returned.
-- Thân hàm chép NGUYÊN bản đang chạy (pg_get_functiondef 26/10), chỉ thêm các phần trên.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.pallet_ledger(p_pallet_code text, p_warehouse_ids text[] DEFAULT NULL::text[], p_limit integer DEFAULT 400)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_events jsonb;
  v_pallet jsonb;
BEGIN
  WITH ev AS (
    -- 1. SX GHI SỔ ĐÓNG GÓI — pallet ra đời
    SELECT COALESCE(pl.close_scan_at, pl.open_scan_at, pl.created_at) AS at,
           'PACKED'::text            AS kind,
           pl.packed_by_name         AS actor,
           NULL::text                AS from_code,
           NULL::text                AS to_code,
           pl.qty_cartons            AS qty_base,   -- cột tên "cartons" nhưng GIÁ TRỊ là base (xem đầu file)
           NULL::numeric             AS qty_cartons, -- giữ ô này rỗng: không nguồn nào ghi theo thùng
           pl.warehouse_id           AS warehouse_id,
           NULLIF(pl.machine_code,'') AS ref,
           pl.note                   AS note
      FROM public.packing_logs pl
     WHERE pl.pallet_code = p_pallet_code AND pl.status <> 'CANCELLED'

    UNION ALL
    -- 2. VÀO SỔ TỒN (nhập kho / tách ra pallet con / NHẬN HÀNG TRẢ VỀ — 26/10) — dòng InventoryEntry được tạo
    SELECT ie.created_at,
           CASE WHEN pi.source_type = 'RETURN' THEN 'RETURNED' ELSE 'RECEIVED' END,
           emp.name,
           NULL, loc.location_code, ie.cartons_imported, NULL,
           ie.warehouse_id,
           CASE WHEN ie.parent_pallet_code IS NOT NULL THEN 'tách từ ' || ie.parent_pallet_code
                WHEN pi.source_type = 'RETURN' THEN COALESCE('chuyến ' || r.group_code, r.return_code) END,
           CASE WHEN pi.source_type = 'RETURN' THEN r.reason END
      FROM public."InventoryEntry" ie
      LEFT JOIN public."Location" loc ON loc.id = ie.location_id
      LEFT JOIN public."Employee" emp ON emp.id = ie.created_by
      LEFT JOIN public."ProductionImport" pi ON pi.id = ie.import_order_id
      LEFT JOIN public.inbound_return r ON r.id = pi.return_id
     WHERE ie.pallet_code = p_pallet_code

    UNION ALL
    -- 3. CHUYỂN VỊ TRÍ / KIỂM KÊ — một sổ, phân biệt bằng location_changed_to
    SELECT sl.counted_at,
           CASE WHEN sl.location_changed_to IS NOT NULL THEN 'MOVED' ELSE 'COUNTED' END,
           sl.counted_by_name, sl.location_from_code, sl.location_code,
           sl.physical_qty, NULL, sl.warehouse_id, NULL, sl.note
      FROM public."StocktakeLog" sl
     WHERE sl.pallet_code = p_pallet_code
       -- KHÔNG KỂ HAI LẦN MỘT VIỆC (18/09): bỏ dòng MOVED nào đã có vết quét fill khớp (nguồn 6 kể giàu hơn)
       AND NOT (
         sl.location_changed_to IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public."FillTaskScan" fs
            WHERE fs.pallet_code     = sl.pallet_code
              AND fs.to_location_id  = sl.location_changed_to
              AND fs.created_at BETWEEN sl.counted_at - interval '2 minutes'
                                    AND sl.counted_at + interval '2 minutes'
         )
       )

    UNION ALL
    -- 4. ĐIỀU CHỈNH TỒN (+/-)
    SELECT al.adjusted_at, 'ADJUSTED', al.actor_name, NULL, NULL,
           al.delta, NULL, ie.warehouse_id,
           ie.cartons_remaining::text, al.note
      FROM public."InventoryAdjustmentLog" al
      JOIN public."InventoryEntry" ie ON ie.id = al.entry_id
     WHERE ie.pallet_code = p_pallet_code

    UNION ALL
    -- 5. DỒN / TÁCH PALLET — tem có thể là NGUỒN hoặc ĐÍCH của thao tác
    SELECT po.created_at,
           CASE WHEN po.type = 'MERGE' THEN 'MERGED'
                WHEN po.type = 'SPLIT' THEN 'SPLIT'
                ELSE 'UNGROUPED' END,
           po.operated_by_name, NULL, NULL, NULL, NULL, po.warehouse_id,
           NULL,
           CASE WHEN p_pallet_code = ANY(po.source_codes) THEN 'tem này là NGUỒN'
                ELSE 'tem này là KẾT QUẢ' END
      FROM public."PalletOperation" po
     WHERE (po.source_codes @> ARRAY[p_pallet_code] OR po.target_codes @> ARRAY[p_pallet_code])
       AND po.undone_at IS NULL

    UNION ALL
    -- 5b. …và lần HOÀN TÁC thao tác đó (nếu có) là một tác động riêng
    SELECT po.undone_at, 'UNDONE', po.undone_by_name, NULL, NULL, NULL, NULL, po.warehouse_id,
           NULL, 'hoàn tác ' || po.type
      FROM public."PalletOperation" po
     WHERE (po.source_codes @> ARRAY[p_pallet_code] OR po.target_codes @> ARRAY[p_pallet_code])
       AND po.undone_at IS NOT NULL

    UNION ALL
    -- 6. HẠ XUỐNG KHO LẺ (quét lệnh fill)
    SELECT fs.created_at, 'FILLED', fs.scanned_by_name,
           fs.from_location_code, fs.to_location_code, fs.qty_base, NULL,
           loc.warehouse_id, fo.order_code, NULL
      FROM public."FillTaskScan" fs
      LEFT JOIN public."Location"  loc ON loc.id = fs.to_location_id
      LEFT JOIN public."FillOrder" fo  ON fo.id  = fs.fill_order_id
     WHERE fs.pallet_code = p_pallet_code

    UNION ALL
    -- 7. XUẤT HÀNG (quét tem ở cửa) — chứng từ = Số xe của chuyến
    SELECT ose.scanned_at AT TIME ZONE 'UTC', 'PICKED', emp.name, NULL, NULL,
           ose.cartons_scanned, NULL, g.warehouse_id,
           COALESCE(g.group_code, g.license_plate),
           CASE WHEN ose.is_loose_picking THEN 'nhặt lẻ' END
      FROM public."OutboundScanEntry" ose
      LEFT JOIN public."Employee"          emp ON emp.id = ose.scanned_by
      LEFT JOIN public."OutboundItem"      oi  ON oi.id  = ose.item_id
      LEFT JOIN public."OutboundDelivery"  od  ON od.id  = oi.do_id
      LEFT JOIN public."GroupDeliveryOrder" g  ON g.id   = od.gdo_id
     WHERE ose.pallet_code = p_pallet_code

    UNION ALL
    -- 8. NHẬT KÝ VIỆC (Việc cần làm) — giao việc, nhận, hạ, đưa ra, hệ thống huỷ.
    SELECT e.at, 'TASK_' || e.event, e.actor,
           t.from_location_code, COALESCE(dl.location_code, tl.location_code),
           NULL, NULL, t.warehouse_id,
           COALESCE(g.group_code, g.license_plate), e.note
      FROM public.wms_task_events e
      JOIN public.wms_tasks t ON t.id = e.task_id
      LEFT JOIN public."Location" dl ON dl.id = t.drop_location_id
      LEFT JOIN public."Location" tl ON tl.id = t.to_location_id
      LEFT JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
     WHERE t.pallet_code = p_pallet_code

    UNION ALL
    -- 9. HÀNG LẺ CỦA TEM NÀY QUAY VỀ thành tem con ".N" (26/10, sổ nhận trả). Cộng dồn vào chính tem này đã có dòng
    --    ĐIỀU CHỈNH (nguồn 4) ⇒ chỉ kể lần nhận vào tem KHÁC.
    SELECT rs.created_at, 'RETURNED', emp.name, NULL, loc.location_code,
           rs.qty_base, NULL, r.warehouse_id,
           COALESCE('chuyến ' || r.group_code, r.return_code),
           'vào tem con ' || ie.pallet_code
      FROM public.inbound_return_scan rs
      JOIN public.inbound_return r ON r.id = rs.return_id
      JOIN public."InventoryEntry" ie ON ie.id = rs.entry_id
      LEFT JOIN public."Location" loc ON loc.id = ie.location_id
      LEFT JOIN public."Employee" emp ON emp.id = rs.created_by
     WHERE rs.source_pallet_code = p_pallet_code AND NOT rs.merged AND ie.pallet_code <> p_pallet_code
  )
  -- HAI NHÓM, KHÔNG TRỘN: `grp='STOCK'` = hàng thật sự bị động vào; `grp='TASK'` = việc được giao/nhận/huỷ.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'grp', CASE WHEN x.kind LIKE 'TASK\_%' THEN 'TASK' ELSE 'STOCK' END,
           'at', x.at, 'kind', x.kind, 'actor', x.actor,
           'from_code', x.from_code, 'to_code', x.to_code,
           'qty_base', x.qty_base, 'qty_cartons', x.qty_cartons,
           'warehouse_id', x.warehouse_id, 'ref', x.ref, 'note', x.note
         ) ORDER BY x.at), '[]'::jsonb)
    INTO v_events
    FROM (
      -- Trần áp cho TỪNG NHÓM, không áp cho cả danh sách
      SELECT * FROM (
        SELECT ev.*,
               row_number() OVER (
                 PARTITION BY (CASE WHEN ev.kind LIKE 'TASK\_%' THEN 'TASK' ELSE 'STOCK' END)
                 ORDER BY ev.at DESC
               ) AS rn
          FROM ev
         WHERE ev.at IS NOT NULL
           AND (p_warehouse_ids IS NULL OR ev.warehouse_id IS NULL OR ev.warehouse_id = ANY(p_warehouse_ids))
      ) z
      WHERE z.rn <= GREATEST(1, LEAST(p_limit, 2000))
    ) x;

  -- Ảnh hiện tại của tem (có thể nhiều dòng nếu tem từng được dùng lại sau khi xuất hết)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'entry_id', ie.id, 'status', ie.status, 'warehouse_id', ie.warehouse_id,
           'warehouse_name', w.name, 'location_code', loc.location_code,
           'material_code', m.material_code, 'material_name', m.short_name, 'category', m.category,
           'entry_unit', m.entry_unit, 'base_unit', m.base_unit, 'units_per_carton', m.units_per_carton,
           'cartons_imported', ie.cartons_imported, 'cartons_remaining', ie.cartons_remaining,
           'production_date', ie.production_date, 'expiry_date', ie.expiry_date, 'batch', ie.batch,
           'import_date', ie.import_date
         ) ORDER BY ie.created_at), '[]'::jsonb)
    INTO v_pallet
    FROM public."InventoryEntry" ie
    LEFT JOIN public."Location"  loc ON loc.id = ie.location_id
    LEFT JOIN public."Warehouse" w   ON w.id   = ie.warehouse_id
    LEFT JOIN public."Material"  m   ON m.id   = ie.material_id
   WHERE ie.pallet_code = p_pallet_code
     AND (p_warehouse_ids IS NULL OR ie.warehouse_id IS NULL OR ie.warehouse_id = ANY(p_warehouse_ids));

  RETURN jsonb_build_object('pallet_code', p_pallet_code, 'entries', v_pallet, 'events', v_events);
END $function$;
REVOKE ALL ON FUNCTION public.pallet_ledger(text, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pallet_ledger(text, text[], integer) TO service_role;

CREATE OR REPLACE FUNCTION public.lot_trace(p_kind text, p_value text DEFAULT NULL::text, p_prod_from date DEFAULT NULL::date, p_prod_to date DEFAULT NULL::date, p_ship_from date DEFAULT NULL::date, p_ship_to date DEFAULT NULL::date, p_wh_ids text[] DEFAULT NULL::text[], p_categories text[] DEFAULT NULL::text[], p_limit integer DEFAULT 500, p_codes text[] DEFAULT NULL::text[], p_cycle text DEFAULT NULL::text, p_machine text DEFAULT NULL::text, p_nmsx text DEFAULT NULL::text, p_pallet text DEFAULT NULL::text, p_material text DEFAULT NULL::text, p_batch text DEFAULT NULL::text, p_npp text DEFAULT NULL::text, p_trip text DEFAULT NULL::text, p_plate text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_val    text := btrim(coalesce(p_value, ''));
  v_like   text := like_esc(coalesce(p_value, ''));   -- bản ĐÃ ESCAPE cho LIKE/ILIKE (kind cũ)
  v_codes  text[];
  v_lim    int  := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_ship   jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_nship  int := 0; v_nstock int := 0; v_ncust int := 0; v_ntrip int := 0;
  v_qship  numeric := 0; v_qhand numeric := 0; v_qret numeric := 0;
  v_where  text;
  v_pref   text;
  v_scope_ship text := '';
  v_scope_stk  text := '';
  v_empty  jsonb := jsonb_build_object('codes', 0, 'shipments', '[]'::jsonb, 'stock', '[]'::jsonb,
                                       'summary', jsonb_build_object('pallets', 0, 'shipments', 0,
                                       'stock_rows', 0, 'customers', 0, 'trips', 0,
                                       'qty_shipped', 0, 'qty_returned', 0, 'qty_on_hand', 0, 'truncated', false));
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

  -- 26/10: `returned` = phần NHẬN TRẢ VỀ (sổ inbound_return_scan) của (tem, chuyến) — gán vào DÒNG ĐẦU của cặp đó
  EXECUTE
    'WITH rr AS (
       SELECT rs.source_pallet_code AS pallet_code, r.gdo_id, sum(rs.qty_base) AS qty
         FROM unnest($1::text[]) AS pc(code)
         JOIN inbound_return_scan rs ON rs.source_pallet_code = pc.code
         JOIN inbound_return r       ON r.id = rs.return_id
        WHERE r.gdo_id IS NOT NULL
        GROUP BY 1, 2
     ), s0 AS (
       SELECT e.pallet_code, e.cartons_scanned, e.scanned_at, e.pct_date,
              ie.production_date, ie.expiry_date, ie.batch,
              coalesce(m.material_code, oi.material_code_raw) AS material_code, m.short_name,
              g.id AS gdo_id, g.group_code, g.delivery_date, g.license_plate, g.status AS trip_status,
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
     ), s AS (
       SELECT s0.*,
              CASE WHEN row_number() OVER (PARTITION BY s0.pallet_code, s0.gdo_id ORDER BY s0.scanned_at, s0.delivery_code) = 1
                   THEN coalesce(rr.qty, 0) ELSE 0 END AS returned
         FROM s0 LEFT JOIN rr ON rr.pallet_code = s0.pallet_code AND rr.gdo_id = s0.gdo_id
     ), t AS (SELECT s.*, row_number() OVER (ORDER BY s.scanned_at DESC NULLS LAST) rn FROM s)
     SELECT count(*)::int, coalesce(sum(t.cartons_scanned), 0), coalesce(sum(t.returned), 0),
            count(DISTINCT t.distributor_name)::int, count(DISTINCT t.group_code)::int,
            coalesce(jsonb_agg(to_jsonb(t) - ''rn'' - ''gdo_id'' ORDER BY t.scanned_at DESC NULLS LAST)
                     FILTER (WHERE t.rn <= $2), ''[]''::jsonb)
       FROM t'
    INTO v_nship, v_qship, v_qret, v_ncust, v_ntrip, v_ship
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
      'customers', v_ncust, 'trips', v_ntrip, 'qty_shipped', v_qship, 'qty_returned', v_qret, 'qty_on_hand', v_qhand,
      'truncated', (v_nship > v_lim OR v_nstock > v_lim)));
END $function$;
