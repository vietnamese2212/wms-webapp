-- 20260821j — VÁ 4 hàm còn so `warehouse_id` (đã là text từ 20260821h) với UUID.
--
-- BÀI HỌC (tự dính ngay lượt này, ghi để đừng lặp): trước khi đổi kiểu cột tôi có quét chỗ phụ
-- thuộc, nhưng quét SAI CÁCH — chỉ tìm token `::uuid` NẰM CÙNG DÒNG với `warehouse_id`. Nó bỏ sót
-- hàm khai THAM SỐ kiểu uuid (`p_warehouse_ids uuid[]`, `p_wh uuid`) vì dòng chữ ký không chứa hai
-- thứ đó cạnh nhau. Hậu quả đúng như chính migration 20260821h đã cảnh báo: **42883 lúc CHẠY**, gói
-- QA đỏ ở 2 chỗ (`GET /wms/inventory/facets` 500 và gói RACE 7/14 vì quick-export/manual-complete
-- 500 `operator does not exist: text = uuid`).
-- Cách quét ĐÚNG (đã dùng để dựng danh sách này, và nay thành bất biến gói QA 00):
--   (a) mọi hàm có THAM SỐ kiểu uuid mà thân hàm chạm `warehouse_id`, VÀ
--   (b) mọi DÒNG trong thân hàm có cả `warehouse_id` lẫn `uuid`.
-- ⇒ đúng 4 hàm dưới đây, không còn chỗ nào khác.

-- Đổi KIỂU tham số thì phải DROP trước: CREATE OR REPLACE với chữ ký khác là đẻ OVERLOAD thứ hai
-- cùng tên → PostgREST thấy 2 ứng viên cùng khớp = PGRST203 cho MỌI lời gọi (bẫy đã ghi ở 20260817).
DROP FUNCTION IF EXISTS public.inventory_facet_values(uuid[], text[]);
DROP FUNCTION IF EXISTS public.pallet_ops_page(uuid, text, text, text, timestamptz, timestamptz, integer, integer);

-- 1) inventory_facet_values: p_warehouse_ids uuid[] → text[]  (facet trang Tồn kho)
CREATE OR REPLACE FUNCTION public.inventory_facet_values(p_warehouse_ids text[] DEFAULT NULL::text[], p_categories text[] DEFAULT NULL::text[])
 RETURNS TABLE(kind text, val text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH scoped AS (
    SELECT e.cycle, e.machine_code, e.ncc_id
    FROM "InventoryEntry" e
    WHERE e.status IN ('IN_STOCK', 'PARTIAL')
      AND (p_warehouse_ids IS NULL OR cardinality(p_warehouse_ids) = 0
           OR e.warehouse_id = ANY (p_warehouse_ids))
      AND (p_categories IS NULL OR cardinality(p_categories) = 0
           OR EXISTS (SELECT 1 FROM "Material" m
                      WHERE m.id = e.material_id AND m.category = ANY (p_categories)))
  )
  SELECT 'cycle'::text,   cycle        FROM scoped WHERE cycle        IS NOT NULL AND cycle <> ''        GROUP BY cycle
  UNION ALL
  SELECT 'machine'::text, machine_code FROM scoped WHERE machine_code IS NOT NULL AND machine_code <> '' GROUP BY machine_code
  UNION ALL
  SELECT 'ncc'::text,     ncc_id::text FROM scoped WHERE ncc_id       IS NOT NULL                        GROUP BY ncc_id;
$function$;

-- 2) pallet_ops_page: p_wh uuid → text  (lịch sử Dồn/Tách pallet)
CREATE OR REPLACE FUNCTION public.pallet_ops_page(p_wh text, p_type text, p_category text, p_search text, p_from timestamp with time zone, p_to timestamp with time zone, p_offset integer, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE r jsonb;
BEGIN
  WITH f AS (
    SELECT o.id, o.created_at, o.type, o.undone_at
    FROM "PalletOperation" o
    WHERE (p_wh     IS NULL OR o.warehouse_id = p_wh)
      AND (p_type   IS NULL OR o.type = p_type)
      AND (p_from   IS NULL OR o.created_at >= p_from)
      AND (p_to     IS NULL OR o.created_at <= p_to)
      AND (p_search IS NULL OR o.source_codes @> ARRAY[p_search] OR o.target_codes @> ARRAY[p_search])
      -- null-inclusive: thao tác không suy được mã hàng vẫn hiện (quy ước toàn app)
      AND (p_category IS NULL OR EXISTS (
            SELECT 1 FROM "Material" m
            WHERE m.material_code = pallet_op_material_code(o.target_codes, o.source_codes)
              AND m.category = p_category)
           OR pallet_op_material_code(o.target_codes, o.source_codes) IS NULL)
  )
  SELECT jsonb_build_object(
    'ids',      COALESCE((SELECT jsonb_agg(id ORDER BY created_at DESC, id)
                          FROM (SELECT id, created_at FROM f
                                ORDER BY created_at DESC, id OFFSET p_offset LIMIT p_limit) pg), '[]'::jsonb),
    -- 4 ô SummaryBand đếm trên TOÀN BỘ bộ lọc (đếm ở FE = chỉ đếm trang đang xem)
    'total',    (SELECT count(*) FROM f),
    'merge_n',  (SELECT count(*) FROM f WHERE type = 'MERGE'),
    'split_n',  (SELECT count(*) FROM f WHERE type = 'SPLIT'),
    'undone_n', (SELECT count(*) FROM f WHERE undone_at IS NOT NULL)
  ) INTO r;
  RETURN r;
END $function$;

-- 3) outbound_pool_apply: bỏ `p_warehouse_id::uuid` khi so với cột đã là text (Xuất luôn / hoàn tồn)
CREATE OR REPLACE FUNCTION public.outbound_pool_apply(p_item_id text, p_material_code text, p_warehouse_id text, p_mode text, p_new_qty numeric, p_item_status text, p_chosen_date text DEFAULT NULL::text, p_claim_only_pending boolean DEFAULT false, p_touch_pool boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_now   timestamp := (now() AT TIME ZONE 'UTC');
  v_old   numeric;
  v_status text;
  v_delta numeric;
  v_rows  record;
  v_pool  RECORD;
  v_total numeric := 0;
  v_need  numeric;
  v_take  numeric;
  v_entry text := NULL;
  v_scan_id text;
  v_has_rows boolean := false;
BEGIN
  SELECT cartons_scanned, status INTO v_old, v_status
  FROM "OutboundItem" WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'NOT_FOUND'); END IF;
  IF p_claim_only_pending AND v_status = 'COMPLETED' THEN
    RETURN jsonb_build_object('outcome', 'CLAIM_LOST');
  END IF;

  v_old   := COALESCE(v_old, 0);
  v_delta := p_new_qty - v_old;

  IF p_touch_pool AND v_delta <> 0 THEN
    -- Khóa TOÀN BỘ dòng pool của (mã, kho) — vài chục dòng là nhiều (1 dòng/NSX ở QTY_DATE)
    CREATE TEMP TABLE IF NOT EXISTS _pool_rows(
      id text, remaining numeric, imported numeric, pdate text, ord int) ON COMMIT DROP;
    TRUNCATE _pool_rows;
    -- FOR UPDATE không đứng chung window function → khóa ở subquery, đánh số ở ngoài
    INSERT INTO _pool_rows
    SELECT locked.id, locked.cartons_remaining, locked.cartons_imported,
           to_char(locked.production_date, 'YYYY-MM-DD'),
           row_number() OVER (ORDER BY locked.production_date ASC NULLS LAST, locked.id)::int
    FROM (
      SELECT e.id, e.cartons_remaining, e.cartons_imported, e.production_date
      FROM "InventoryEntry" e
      WHERE e.pallet_code = p_material_code AND e.warehouse_id = p_warehouse_id
        AND (p_mode <> 'QTY_DATE' OR p_chosen_date IS NULL
             OR to_char(e.production_date, 'YYYY-MM-DD') = p_chosen_date)
      FOR UPDATE OF e
    ) locked;
    SELECT COALESCE(SUM(remaining), 0), COUNT(*) > 0 INTO v_total, v_has_rows FROM _pool_rows;

    IF v_delta > 0 THEN
      -- TRỪ TỒN
      IF NOT v_has_rows THEN
        IF p_mode IN ('QTY', 'QTY_DATE') THEN
          RETURN jsonb_build_object('outcome', 'INSUFFICIENT', 'available', 0);
        END IF;   -- NONE/khác: không theo dõi mã này — đi tiếp không đụng tồn
      ELSIF v_total < v_delta THEN
        RETURN jsonb_build_object('outcome', 'INSUFFICIENT', 'available', v_total);
      ELSE
        v_need := v_delta;
        FOR v_pool IN
          SELECT * FROM _pool_rows WHERE remaining > 0
          ORDER BY CASE WHEN p_mode = 'QTY_DATE' THEN ord ELSE NULL END ASC NULLS LAST,
                   CASE WHEN p_mode = 'QTY_DATE' THEN NULL ELSE remaining END DESC NULLS LAST
        LOOP
          EXIT WHEN v_need <= 0;
          v_take := LEAST(v_need, v_pool.remaining);
          UPDATE "InventoryEntry" SET
            cartons_remaining = cartons_remaining - v_take,
            status = CASE WHEN cartons_remaining - v_take = 0 THEN 'EXPORTED'
                          WHEN cartons_remaining - v_take < cartons_imported THEN 'PARTIAL'
                          ELSE 'IN_STOCK' END,
            updated_at = v_now
          WHERE id = v_pool.id;
          v_need := v_need - v_take;
          IF v_entry IS NULL THEN v_entry := v_pool.id; END IF;
        END LOOP;
      END IF;
    ELSE
      -- HOÀN TỒN |v_delta|: dòng còn tồn đầu tiên (QTY_DATE = NSX cũ nhất), không có thì dòng đầu
      IF v_has_rows THEN
        SELECT id INTO v_entry FROM _pool_rows
        ORDER BY (remaining > 0) DESC, ord ASC LIMIT 1;
        UPDATE "InventoryEntry" SET
          cartons_remaining = cartons_remaining - v_delta,   -- v_delta âm → cộng
          status = CASE WHEN cartons_remaining - v_delta = 0 THEN 'EXPORTED'
                        WHEN cartons_remaining - v_delta < cartons_imported THEN 'PARTIAL'
                        ELSE 'IN_STOCK' END,
          updated_at = v_now
        WHERE id = v_entry;
      END IF;   -- không dòng nào = mã không theo dõi → hoàn là noop (như cũ)
    END IF;
  END IF;

  UPDATE "OutboundItem"
  SET status = p_item_status, cartons_scanned = p_new_qty, updated_at = v_now
  WHERE id = p_item_id;

  IF p_touch_pool THEN
    SELECT id INTO v_scan_id FROM "OutboundScanEntry" WHERE item_id = p_item_id LIMIT 1;
    IF v_scan_id IS NOT NULL THEN
      UPDATE "OutboundScanEntry"
      SET cartons_scanned = p_new_qty,
          inventory_entry_id = COALESCE(v_entry, inventory_entry_id),
          updated_at = v_now
      WHERE id = v_scan_id;
    ELSE
      INSERT INTO "OutboundScanEntry"(id, item_id, inventory_entry_id, pallet_code, cartons_scanned,
        is_loose_picking, scanned_at, created_at, updated_at)
      VALUES (gen_random_uuid()::text, p_item_id, v_entry, p_material_code, p_new_qty,
        false, v_now, v_now, v_now);
    END IF;
  END IF;

  RETURN jsonb_build_object('outcome', 'OK', 'inv_entry_id', v_entry, 'available', v_total - v_delta);
END $function$;

-- 4) scan_insert_pallet: bỏ `::uuid` khi GHI warehouse_id (cast text→uuid→text vô nghĩa và dễ nổ)
CREATE OR REPLACE FUNCTION public.scan_insert_pallet(p_entry jsonb, p_location_id text, p_stack_layer integer, p_max_materials integer DEFAULT NULL::integer)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_max  int;
  v_used int;
  v_mats int;
  v_has  boolean;
  v_id   text;
BEGIN
  SELECT max_pallets INTO v_max FROM "Location" WHERE id = p_location_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOLOC'; END IF;

  IF p_stack_layer = 1 THEN
    IF v_max > 0 THEN
      SELECT count(*) INTO v_used FROM "InventoryEntry"
        WHERE location_id = p_location_id AND stack_layer = 1
          AND status IN ('IN_STOCK','PARTIAL','QUARANTINE') AND cartons_remaining > 0;
      IF v_used >= v_max THEN RETURN 'FULL|'||v_used||'|'||v_max; END IF;
    END IF;
  ELSE
    PERFORM 1 FROM "InventoryEntry"
      WHERE location_id = p_location_id AND stack_layer = p_stack_layer - 1 AND status = 'IN_STOCK' LIMIT 1;
    IF NOT FOUND THEN RETURN 'NO_BASE'; END IF;
  END IF;

  -- Số mã trong ô — ĐẾM DƯỚI LOCK (khoá dòng Location ở trên). Mã đã có sẵn trong ô thì không
  -- làm tăng số mã ⇒ không chặn (khớp đúng putawayBlock ở backend).
  IF p_max_materials IS NOT NULL THEN
    SELECT count(DISTINCT material_id),
           bool_or(material_id = p_entry->>'material_id')
      INTO v_mats, v_has
      FROM "InventoryEntry"
      WHERE location_id = p_location_id AND stack_layer = 1
        AND status IN ('IN_STOCK','PARTIAL') AND cartons_remaining > 0;
    IF COALESCE(v_has, false) = false AND COALESCE(v_mats, 0) >= p_max_materials THEN
      RETURN 'MAXMAT|'||COALESCE(v_mats,0)||'|'||p_max_materials;
    END IF;
  END IF;

  INSERT INTO "InventoryEntry" (
    id, pallet_code, location_id, warehouse_id, material_id, manufacturer_id,
    nmsx, cycle, machine_code, pallet_sequence_no, stack_layer,
    cartons_imported, cartons_remaining, production_date, qa_status_id, batch, expiry_date,
    import_order_id, created_by, updated_by, status, ncc_id, shelf_life_days,
    import_date, update_date, created_at, updated_at,
    putaway_checked, putaway_violation, putaway_override_reason
  ) VALUES (
    p_entry->>'id', p_entry->>'pallet_code', p_entry->>'location_id',
    NULLIF(p_entry->>'warehouse_id',''), p_entry->>'material_id', p_entry->>'manufacturer_id',
    p_entry->>'nmsx', p_entry->>'cycle', p_entry->>'machine_code',
    NULLIF(p_entry->>'pallet_sequence_no','')::int, (p_entry->>'stack_layer')::int,
    (p_entry->>'cartons_imported')::numeric, NULLIF(p_entry->>'cartons_remaining','')::numeric,
    NULLIF(p_entry->>'production_date','')::timestamp, p_entry->>'qa_status_id',
    p_entry->>'batch', NULLIF(p_entry->>'expiry_date','')::date,
    p_entry->>'import_order_id', p_entry->>'created_by', p_entry->>'updated_by',
    COALESCE(NULLIF(p_entry->>'status',''),'IN_STOCK'), NULLIF(p_entry->>'ncc_id','')::uuid, NULLIF(p_entry->>'shelf_life_days','')::int,
    NULLIF(p_entry->>'import_date','')::timestamp, NULLIF(p_entry->>'update_date','')::timestamp,
    (p_entry->>'created_at')::timestamp, (p_entry->>'updated_at')::timestamp,
    -- COALESCE: bundle cũ / đường ghi khác không gửi khoá này thì giữ nghĩa "chưa đo"
    COALESCE((p_entry->>'putaway_checked')::boolean, false),
    NULLIF(p_entry->>'putaway_violation',''), NULLIF(p_entry->>'putaway_override_reason','')
  ) RETURNING id INTO v_id;

  RETURN 'OK|'||v_id;
EXCEPTION WHEN unique_violation THEN
  RETURN 'DUP';
END $function$;

-- ACL sau DROP là ACL mặc định; grant lại cho khớp trạng thái trước đó.
GRANT EXECUTE ON FUNCTION public.inventory_facet_values(text[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.pallet_ops_page(text, text, text, text, timestamptz, timestamptz, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Kiểm sau khi apply:
--   SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc
--    WHERE proname IN ('inventory_facet_values','pallet_ops_page');
--   -- kỳ vọng: ĐÚNG 1 bản mỗi hàm, tham số kho kiểu text (không còn uuid).
--   Và không hàm nào còn so warehouse_id với uuid — phép kiểm này nay là BẤT BIẾN
--   trong gói QA 00-invariant (quét pg_proc), không phải kiểm tay nữa.

-- ── BẤT BIẾN: không hàm nào được so `warehouse_id` (text) với uuid ─────────────────────────────
-- Đây là KHOÁ cho đúng điểm mù đã làm tôi sập lượt này: quét tay bằng grep chỉ tìm token `::uuid`
-- cùng dòng nên bỏ sót hàm khai THAM SỐ kiểu uuid, và lỗi kiểu này chỉ nổ LÚC CHẠY (42883).
-- Máy soi 2 chiều: (a) dòng nào vừa nói warehouse_id vừa nói uuid, (b) tham số tên kho khai uuid.
-- Gói QA 00-invariant gọi hàm này mỗi lượt ⇒ ai viết RPC mới theo phản xạ cũ là ĐỎ ngay.
CREATE OR REPLACE FUNCTION public.warehouse_id_uuid_mismatch()
RETURNS TABLE(fn text, why text)
LANGUAGE sql STABLE
AS $mismatch$
  SELECT p.proname::text,
         'thân hàm có dòng vừa nói warehouse_id vừa nói uuid'::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname <> 'warehouse_id_uuid_mismatch'
     AND pg_get_functiondef(p.oid) ~* ('warehouse_id[^' || chr(10) || ']*muuidM')
  UNION
  SELECT p.proname::text,
         ('tham số kho khai kiểu uuid → ' || pg_get_function_identity_arguments(p.oid))::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND pg_get_function_identity_arguments(p.oid) ~* 'm(p_wh|p_warehouse[a-z_]*)M[[:space:]]+uuid'
$mismatch$;

REVOKE ALL ON FUNCTION public.warehouse_id_uuid_mismatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.warehouse_id_uuid_mismatch() TO service_role;
