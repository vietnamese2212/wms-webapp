-- ============================================================================
-- CUTOVER production 24/09/2026 — PART 2/10
-- 14 migration · 20260821j_warehouse_id_uuid_callers.sql → 20260827d_shared_cost_only_when_unfiltered.sql
-- Dán TRỌN file vào Supabase SQL Editor của project PRODUCTION svicyfquresxaigfxsdb rồi Run.
-- Cả part nằm trong MỘT transaction: lỗi bất kỳ đâu = rollback trọn part, schema không dở dang.
-- Chạy lại lần hai sẽ báo "đã tồn tại" rồi tự rollback — không hỏng gì.
-- ============================================================================
BEGIN;


-- ─────────────────────────────────────────────────────────────────────────
-- [20260821j_warehouse_id_uuid_callers.sql]
-- ─────────────────────────────────────────────────────────────────────────
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



-- ─────────────────────────────────────────────────────────────────────────
-- [20260824_booking_sequence.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260824 — STT chuẩn bị hàng theo booking khung giờ (user chốt 24/08).
-- Kho nhìn số 1,2,3… biết xe nào chuẩn bị trước. Số là DẪN XUẤT (không lưu cột):
-- sort theo (khung giờ time_from, giờ đặt lịch) rồi ROW_NUMBER — đổi/hủy booking là số
-- tự cập nhật, không cần đánh lại. Dãy số riêng theo (kho, ngày, chiều XUẤT/NHẬP).
-- Tie-break cùng khung giờ = vs.created_at (giờ tạo dòng xe ~ giờ đặt; KHÔNG dùng
-- updated_at vì sự kiện cổng/gate ghi lên cùng dòng sẽ xáo thứ tự giữa ngày).
-- Trả DÒNG jsonb trong 1 lời gọi (luật pool PostgREST — không trả id rồi nạp lại).

CREATE OR REPLACE FUNCTION booking_sequence(
  p_warehouse_ids text[],   -- NULL = mọi kho (user scope NATIONAL); ASSIGNED truyền danh sách kho
  p_from date,
  p_to   date
) RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'warehouse_id',  t.warehouse_id,
    'date',          t.date::text,
    'direction',     t.direction,
    'stt',           t.stt,
    'order_code',    t.order_code,
    'license_plate', t.license_plate,
    'time_from',     t.time_from,
    'time_to',       t.time_to
  ) ORDER BY t.warehouse_id, t.date, t.direction, t.stt), '[]'::jsonb)
  FROM (
    SELECT ds.warehouse_id, ds.date, o.direction, o.order_code, vs.license_plate,
           to_char(ds.time_from, 'HH24:MI') AS time_from,
           to_char(ds.time_to,   'HH24:MI') AS time_to,
           row_number() OVER (
             PARTITION BY ds.warehouse_id, ds.date, o.direction
             ORDER BY ds.time_from, vs.created_at, vs.id
           ) AS stt
    FROM "TmsVehicleSlot" vs
    JOIN "DeliverySlot" ds ON ds.id = vs.slot_id
    JOIN "TmsOrder"     o  ON o.id  = vs.order_id
    WHERE ds.date BETWEEN p_from AND p_to
      AND (p_warehouse_ids IS NULL OR ds.warehouse_id = ANY (p_warehouse_ids))
      AND COALESCE(o.plan_dropped, false) = false   -- lệnh bị bỏ khỏi kế hoạch: slot đã tự nhả, gác thêm cho chắc
  ) t
$$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260824b_loose_settings.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 24/08/2026 — SETTING NHẶT LẺ THEO KHO + THEO LOẠI KHO (user chốt cùng ngày, 2 tầng như chiến thuật 21/08)
-- Trước nay luật tự sinh nhặt lẻ là HARDCODE một công thức (phần dư dưới 1 pallet nguyên) —
-- user cần: kho tắt hẳn nhặt lẻ · POSM lấy TOÀN BỘ SL vào nhặt lẻ · trần thùng (phần lẻ quá lớn
-- thì bốc nguyên pallet nhanh hơn nhặt tay).
--
--   loose_mode:        'REMAINDER' = phần lẻ dưới pallet (hành vi cũ) · 'ALL' = toàn bộ SL · 'OFF' = không nhặt lẻ
--   loose_max_cartons: trần THÙNG cho chế độ REMAINDER — phần lẻ quy thùng VƯỢT trần thì không đưa
--                      vào nhặt lẻ (đi luồng quét pallet + khai chỗ đặt phần dư). ALL/OFF bỏ qua trần.
--                      Mã không khai quy cách thùng: REMAINDER luôn = 0 (như cũ), trần không đụng tới.
--
-- Tầng kho (Warehouse): NULL = 'REMAINDER' (hành vi cũ — migration không đổi kho nào).
-- Tầng loại (warehouse_type_configs): NULL = theo mặc định kho.
-- OFF ép 0 MỌI ĐƯỜNG kể cả cột "Nhặt lẻ" ghi tay trong file upload kiểu cũ (user chốt 24/08).

ALTER TABLE "Warehouse"
  ADD COLUMN IF NOT EXISTS loose_mode        text,
  ADD COLUMN IF NOT EXISTS loose_max_cartons numeric;
ALTER TABLE "Warehouse" DROP CONSTRAINT IF EXISTS wh_loose_mode_valid;
ALTER TABLE "Warehouse" ADD CONSTRAINT wh_loose_mode_valid
  CHECK (loose_mode IS NULL OR loose_mode IN ('REMAINDER', 'ALL', 'OFF'));
ALTER TABLE "Warehouse" DROP CONSTRAINT IF EXISTS wh_loose_max_valid;
ALTER TABLE "Warehouse" ADD CONSTRAINT wh_loose_max_valid
  CHECK (loose_max_cartons IS NULL OR (loose_max_cartons >= 1 AND loose_max_cartons <= 100000));

ALTER TABLE warehouse_type_configs
  ADD COLUMN IF NOT EXISTS loose_mode        text,
  ADD COLUMN IF NOT EXISTS loose_max_cartons numeric;
ALTER TABLE warehouse_type_configs DROP CONSTRAINT IF EXISTS wtc_loose_mode_valid;
ALTER TABLE warehouse_type_configs ADD CONSTRAINT wtc_loose_mode_valid
  CHECK (loose_mode IS NULL OR loose_mode IN ('REMAINDER', 'ALL', 'OFF'));
ALTER TABLE warehouse_type_configs DROP CONSTRAINT IF EXISTS wtc_loose_max_valid;
ALTER TABLE warehouse_type_configs ADD CONSTRAINT wtc_loose_max_valid
  CHECK (loose_max_cartons IS NULL OR (loose_max_cartons >= 1 AND loose_max_cartons <= 100000));

COMMENT ON COLUMN "Warehouse".loose_mode IS 'Tự sinh nhặt lẻ: REMAINDER=phần lẻ dưới pallet (NULL=vậy, hành vi cũ) · ALL=toàn bộ SL · OFF=không nhặt lẻ (ép 0 cả số tay upload cũ)';
COMMENT ON COLUMN "Warehouse".loose_max_cartons IS 'Trần THÙNG cho chế độ REMAINDER — phần lẻ vượt trần thì không nhặt lẻ. NULL = không chặn';
COMMENT ON COLUMN warehouse_type_configs.loose_mode IS 'Override nhặt lẻ theo LOẠI KHO của mã hàng. NULL = theo mặc định kho';
COMMENT ON COLUMN warehouse_type_configs.loose_max_cartons IS 'Override trần thùng nhặt lẻ theo loại. NULL = theo mặc định kho';



-- ─────────────────────────────────────────────────────────────────────────
-- [20260824c_loosepage_wh_types_by_item.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 24/08/2026 — Trang NHẶT LẺ: filter "Loại kho" phải theo LOẠI CỦA MÃ ĐANG NHẶT LẺ,
-- không theo hàng xe CHỞ (GroupDeliveryOrder.warehouse_type là chuỗi ghép 'FG01+PM01').
-- Bug user bắt 24/08: chuyến chở lẫn FG01+PM01 nhưng FG lẻ = 0 (vượt trần nhặt lẻ) → filter
-- FG01 vẫn hiện chuyến chỉ còn POSM. Trang Nhặt lẻ là danh sách VIỆC NHẶT, nên filter đi theo
-- Material.category của item có loose_picking > 0.
-- GIỮ NGUYÊN: p_cat_scope (quyền theo loại) vẫn cắt ở cấp CHUYẾN giao ≥1 (luật 30/07 —
-- chuyến là 1 xe vật lý); chỉ p_wh_types (filter user chọn) + facets wh_types đổi sang item-level.

-- ── loose_picking_facets ──
CREATE OR REPLACE FUNCTION public.loose_picking_facets(p_wh_scope text[], p_cat_scope text[], p_warehouse_id text, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
  RETURN (
    WITH j AS (
      SELECT DISTINCT g.id, i.export_type, g.dvvt, d.distributor_name, m.category
      FROM "OutboundItem" i
      JOIN "OutboundDelivery"   d ON d.id = i.do_id
      JOIN "GroupDeliveryOrder" g ON g.id = d.gdo_id AND g.status <> 'CANCELLED'
      LEFT JOIN "Material"      m ON m.id = i.material_id
      WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
        AND (p_from IS NULL OR g.delivery_date >= p_from)
        AND (p_to   IS NULL OR g.delivery_date <= p_to)
        AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
        AND (p_wh_scope  IS NULL OR g.warehouse_id = ANY (p_wh_scope))
        AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR wt_cats(g.warehouse_type) && p_cat_scope)
    )
    SELECT jsonb_build_object(
      'dvvts',        COALESCE((SELECT jsonb_agg(DISTINCT dvvt)             FROM j WHERE dvvt IS NOT NULL), '[]'::jsonb),
      'npps',         COALESCE((SELECT jsonb_agg(DISTINCT distributor_name) FROM j WHERE distributor_name IS NOT NULL), '[]'::jsonb),
      'wh_types',     COALESCE((SELECT jsonb_agg(DISTINCT category)         FROM j WHERE category IS NOT NULL), '[]'::jsonb),
      'export_types', COALESCE((SELECT jsonb_agg(DISTINCT export_type)      FROM j WHERE export_type IS NOT NULL), '[]'::jsonb)
    )
  );
END $function$;

-- ── loose_picking_page ──
CREATE OR REPLACE FUNCTION public.loose_picking_page(p_wh_scope text[], p_cat_scope text[], p_warehouse_id text, p_from date, p_to date, p_wh_types text[], p_export_types text[], p_dvvts text[], p_npps text[], p_search text, p_offset integer, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE r jsonb; s text;
BEGIN
  s := CASE WHEN p_search IS NULL OR btrim(p_search) = '' THEN NULL
            ELSE lower(immutable_unaccent(btrim(p_search))) END;

  WITH it AS (
    SELECT i.id, i.do_id, i.material_id, i.material_code_raw,
           i.cartons_ordered, i.cartons_scanned, i.loose_picking, i.export_type
    FROM "OutboundItem" i
    WHERE i.loose_picking > 0 AND i.status <> 'CANCELLED'
  ),
  j AS (
    SELECT it.*, d.gdo_id, d.distributor_name,
           g.group_code, g.dvvt, g.warehouse_type, g.delivery_date,
           m.entry_unit, m.units_per_carton, m.short_name, m.material_code, m.category,
           COALESCE(ls.done, 0) AS loose_scanned
    FROM it
    JOIN "OutboundDelivery"    d ON d.id = it.do_id
    JOIN "GroupDeliveryOrder"  g ON g.id = d.gdo_id AND g.status <> 'CANCELLED'
    LEFT JOIN "Material"       m ON m.id = it.material_id
    LEFT JOIN LATERAL (
      SELECT sum(se.cartons_scanned) AS done
      FROM "OutboundScanEntry" se
      WHERE se.item_id = it.id AND se.is_loose_picking
    ) ls ON TRUE
    WHERE (p_from IS NULL OR g.delivery_date >= p_from)
      AND (p_to   IS NULL OR g.delivery_date <= p_to)
      AND (p_warehouse_id IS NULL OR g.warehouse_id = p_warehouse_id)
      AND (p_wh_scope  IS NULL OR g.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR g.warehouse_type IS NULL OR wt_cats(g.warehouse_type) && p_cat_scope)
  ),
  st AS (
    SELECT j.*,
           GREATEST(0, loose_picking
                       - GREATEST(0, (cartons_scanned - loose_scanned)
                                     - (cartons_ordered - loose_picking))) AS effective
    FROM j
  ),
  st2 AS (
    SELECT st.*, LEAST(loose_scanned, effective) AS done FROM st
  ),
  gg AS (
    SELECT gdo_id,
           max(group_code)     AS group_code,
           max(delivery_date)  AS delivery_date,
           count(*)            AS items_n,
           count(*) FILTER (WHERE effective - done > 0) AS pending_n,
           sum(qty_entry_decimal(effective, entry_unit, units_per_carton)) AS loose_total,
           sum(qty_entry_decimal(done,      entry_unit, units_per_carton)) AS loose_done,
           max(export_type)    AS export_type,
           max(dvvt)           AS dvvt,
           array_agg(DISTINCT category) FILTER (WHERE category IS NOT NULL) AS cats,
           array_agg(DISTINCT distributor_name) FILTER (WHERE distributor_name IS NOT NULL) AS npps,
           lower(immutable_unaccent(
             concat_ws(' ', max(group_code), max(export_type), max(dvvt),
                            string_agg(DISTINCT distributor_name, ' '),
                            string_agg(DISTINCT COALESCE(material_code, material_code_raw), ' '),
                            string_agg(DISTINCT short_name, ' ')))) AS hay
    FROM st2 GROUP BY gdo_id
  ),
  f AS (
    SELECT * FROM gg
    WHERE (p_wh_types     IS NULL OR cats && p_wh_types)
      AND (p_export_types IS NULL OR export_type    = ANY (p_export_types))
      AND (p_dvvts        IS NULL OR dvvt           = ANY (p_dvvts))
      AND (p_npps         IS NULL OR npps && p_npps)
      AND (s IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(string_to_array(s, ' ')) t
            WHERE t <> '' AND position(t IN hay) = 0))
  ),
  pg AS (
    SELECT gdo_id FROM f ORDER BY delivery_date, group_code, gdo_id OFFSET p_offset LIMIT p_limit
  ),
  -- gdo object dựng MỘT LẦN per chuyến (mirror payload controller cũ: gdo + warehouse embed +
  -- distributor_names từ MỌI delivery của chuyến + export_type = item nhặt lẻ ĐẦU TIÊN có khai)
  gdoj AS (
    SELECT pg.gdo_id,
           jsonb_build_object(
             'id', g.id, 'group_code', g.group_code, 'delivery_date', g.delivery_date,
             'planned_date', g.planned_date, 'status', g.status, 'started_at', g.started_at,
             'dvvt', g.dvvt, 'warehouse_type', g.warehouse_type,
             'warehouse', CASE WHEN w.id IS NULL THEN NULL ELSE
               jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name) END,
             'distributor_names', COALESCE((
               SELECT jsonb_agg(DISTINCT d2.distributor_name)
               FROM "OutboundDelivery" d2
               WHERE d2.gdo_id = g.id AND d2.distributor_name IS NOT NULL), '[]'::jsonb),
             'export_type', (
               SELECT i2.export_type
               FROM "OutboundDelivery" d3 JOIN "OutboundItem" i2 ON i2.do_id = d3.id
               WHERE d3.gdo_id = g.id AND i2.loose_picking > 0 AND i2.status <> 'CANCELLED'
                 AND i2.export_type IS NOT NULL
               ORDER BY i2.id LIMIT 1)
           ) AS gdo
    FROM pg
    JOIN "GroupDeliveryOrder" g ON g.id = pg.gdo_id
    LEFT JOIN "Warehouse" w ON w.id = g.warehouse_id
  )
  SELECT jsonb_build_object(
    'gdo_ids',     COALESCE((SELECT jsonb_agg(gdo_id) FROM pg), '[]'::jsonb),
    -- MỚI: item đầy đủ (to_jsonb toàn bộ cột như select '*' cũ) + material + gdo + loose_scanned
    'items',       COALESCE((
      SELECT jsonb_agg(to_jsonb(i)
               || jsonb_build_object(
                    'material', CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object(
                      'id', m.id, 'material_code', m.material_code, 'short_name', m.short_name,
                      'base_unit', m.base_unit, 'entry_unit', m.entry_unit,
                      'units_per_carton', m.units_per_carton) END,
                    'gdo', gdoj.gdo,
                    'loose_scanned', COALESCE(ls.done, 0))
               ORDER BY i.id)
      FROM gdoj
      JOIN "OutboundDelivery" d ON d.gdo_id = gdoj.gdo_id
      JOIN "OutboundItem" i ON i.do_id = d.id AND i.loose_picking > 0 AND i.status <> 'CANCELLED'
      LEFT JOIN "Material" m ON m.id = i.material_id
      LEFT JOIN LATERAL (
        SELECT sum(se.cartons_scanned) AS done
        FROM "OutboundScanEntry" se
        WHERE se.item_id = i.id AND se.is_loose_picking
      ) ls ON TRUE), '[]'::jsonb),
    'total',       (SELECT count(*)                FROM f),
    'items_n',     (SELECT COALESCE(sum(items_n), 0)     FROM f),
    'pending_n',   (SELECT COALESCE(sum(pending_n), 0)   FROM f),
    'loose_total', (SELECT COALESCE(sum(loose_total), 0)  FROM f),
    'loose_done',  (SELECT COALESCE(sum(loose_done), 0)   FROM f)
  ) INTO r;
  RETURN r;
END $function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260825_wh_type_enforced_per_rule.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 25/08/2026 — MỨC XỬ LÝ (Bắt buộc / Chỉ cảnh báo) của TỪNG LUẬT CẤT kế thừa PER-LUẬT.
--
-- Trước: `warehouse_type_configs.putaway_enforced` THAY THẾ nguyên mảng của kho ⇒ loại khai 1 luật
-- là mất hết các luật bắt buộc khác của kho. Đo thật trên staging: Kho Ba Vì bắt buộc
-- [MAX_MATERIALS, FULL] nhưng loại PM01 khai riêng [FULL] ⇒ hàng POSM lặng lẽ THOÁT luật
-- "tối đa 2 mã/vị trí" — không ai đọc form mà đoán ra được điều đó.
--
-- Nay (user chốt 25/08 "nếu không có giá trị gì thì để bao nhiêu thì để, nếu có thì cũng cho theo
-- rule"): mỗi luật có 3 trạng thái ở tầng loại, ĐỘC LẬP nhau — giống hệt các cờ boolean khác của
-- tầng này (Theo kho / Có / Không):
--   • KHÔNG khai ở cả 2 cột            → theo kho
--   • có trong `putaway_enforced`      → loại BẬT bắt buộc (dù kho không bật)
--   • có trong `putaway_enforced_off`  → loại ép về CHỈ CẢNH BÁO (dù kho đang bắt buộc)
-- Hiệu lực = (kho ∪ loại.on) \ loại.off  — xem `mergedConfig` trong backend/src/utils/putaway.ts.
--
-- KHÔNG backfill: dòng cũ giữ nguyên `putaway_enforced`, nay được hiểu là "bật thêm" thay vì
-- "thay thế". Đây CHÍNH LÀ thay đổi hành vi user yêu cầu (PM01 quay lại chấp hành luật số mã của
-- kho). Tính năng 2 tầng mới có từ 21/08 và CHƯA merge production nên chỉ staging bị ảnh hưởng.

ALTER TABLE warehouse_type_configs
  ADD COLUMN IF NOT EXISTS putaway_enforced_off text[];

COMMENT ON COLUMN warehouse_type_configs.putaway_enforced IS
  'Luật cất mà LOẠI này ép về mức BẮT BUỘC (hợp với danh sách của kho). NULL/rỗng = không bật thêm gì.';
COMMENT ON COLUMN warehouse_type_configs.putaway_enforced_off IS
  'Luật cất mà LOẠI này ép về mức CHỈ CẢNH BÁO, kể cả khi kho đang bắt buộc. NULL/rỗng = theo kho.';



-- ─────────────────────────────────────────────────────────────────────────
-- [20260826_location_max_materials.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- SỐ MÃ TỐI ĐA / VỊ TRÍ — chuyển từ cấu hình theo KHO + LOẠI KHO sang theo TỪNG VỊ TRÍ (26/08).
--
-- VÌ SAO ĐỔI TRỤC (user chốt): "Ngoài đường", "Mặt đất", "Kho lẻ" là nơi CHỨA CHUNG, nhưng chúng
-- nằm CÙNG KHU và CÙNG LOẠI HÀNG với kệ thường — đo staging: B_TP1_NGOÀI ĐƯỜNG SCA giữ 29 mã và
-- B_TP2_MẶT ĐẤT giữ 28 mã, cả hai đều thuộc khu TP1/TP2 hàng thành phẩm y như các kệ 1-2 mã bên
-- cạnh. Loại kho = loại HÀNG nên không có cách nào tách chúng ⇒ trục cũ sai từ gốc. "Chứa chung"
-- là thuộc tính VẬT LÝ của cái ô, phải khai trên cái ô.
--
-- NGỮ NGHĨA (user chốt 26/08) — cố ý CHỈ 2 trạng thái, không kế thừa tầng nào:
--   NULL  = KHÔNG GIỚI HẠN  (mặc định của mọi vị trí, kể cả vị trí mới tạo)
--   N ≥ 1 = ô này tối đa N mã
-- Nhìn vào ô là biết luật của ô — không phải tra ngược lên kho rồi lên loại kho mới suy ra được.
-- Đây là lý do KHÔNG dùng quy ước "0 = không giới hạn" của `max_pallets`: ở đây trạng thái mặc
-- định phải là ô TRỐNG, và trống thì không được mang nghĩa "giới hạn 0 mã" (= cấm mọi thứ).
--
-- KHÔNG backfill (user chốt "mặc định bỏ trống"): sau migration mọi vị trí = không giới hạn.
-- Kho Ba Vì đang khai 2 mã ở TẦNG KHO sẽ MẤT giới hạn đó cho tới khi khai lại bằng nút khai hàng
-- loạt trên trang Vị trí kho. Đây là thay đổi hành vi CÓ CHỦ ĐÍCH, đã báo trước.
--
-- Hai cột của trục cũ (`Warehouse.putaway_max_materials`, `warehouse_type_configs.putaway_max_materials`)
-- KHÔNG drop ở đây: code đang chạy trên production vẫn SELECT chúng, drop trước khi deploy = 500
-- hàng loạt. Dọn ở migration `20260826b_drop_wh_max_materials.sql`, chạy SAU khi bản mới đã live.

ALTER TABLE public."Location"
  ADD COLUMN IF NOT EXISTS max_materials integer;

-- Trần 1000 cùng lý do với tầng kho cũ: cột `integer`, số quá lớn (1e12) làm Postgres tràn kiểu →
-- 500 thay vì lỗi nhập liệu 4xx (fuzz 15/08 bắt được). Ô lớn nhất đo thật mới 111 mã.
ALTER TABLE public."Location"
  DROP CONSTRAINT IF EXISTS location_max_materials_range;
ALTER TABLE public."Location"
  ADD CONSTRAINT location_max_materials_range
  CHECK (max_materials IS NULL OR (max_materials >= 1 AND max_materials <= 1000));

COMMENT ON COLUMN public."Location".max_materials IS
  'Số mã tối đa được để chung trong vị trí này. NULL = không giới hạn (mặc định). Khai theo TỪNG vị trí — không kế thừa từ Kho/Loại kho (đổi trục 26/08).';



-- ─────────────────────────────────────────────────────────────────────────
-- [20260826b_drop_wh_max_materials.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- DỌN trục cũ của "số mã tối đa / vị trí" — chạy SAU khi bản code 26/08 đã LIVE.
--
-- Trần số mã nay khai trên `Location.max_materials` (migration 20260826). Hai cột dưới đây là tàn
-- dư của trục cũ (Kho → Loại kho) và KHÔNG còn ai đọc.
--
-- ⚠️ THỨ TỰ BẮT BUỘC — đừng gộp vào migration trước:
--   1. deploy code mới (đã gỡ 2 cột khỏi PUTAWAY_WH_COLS + WH_TYPE_CFG_COLS)
--   2. xác nhận bản mới đang chạy (GET /api/version khớp commit)
--   3. MỚI chạy file này
-- Drop trước bước 2 thì code CŨ vẫn đang `select putaway_max_materials` → PostgREST trả 42703 →
-- 500 hàng loạt ở mọi lượt quét nhập. Đây đúng khuôn "migration additive trước, DROP sau khi code
-- live" trong CLAUDE.md.
--
-- Dữ liệu mất đi: Kho Ba Vì đang khai 2. Đã báo user và user chốt KHÔNG chuyển sang vị trí
-- ("mặc định bỏ trống") — kho khai lại bằng nút khai hàng loạt trên trang Vị trí kho.
-- Giá trị cũ được chụp lại vào bảng sao lưu trước khi drop, phòng khi muốn dò lại con số cũ.

-- [cutover] gỡ: BEGIN;

CREATE TABLE IF NOT EXISTS public.x_bak_20260826_max_materials AS
SELECT 'Warehouse'::text AS nguon, w.id::text AS ban_ghi, w.name AS ten,
       w.putaway_max_materials AS gia_tri_cu
  FROM public."Warehouse" w
 WHERE w.putaway_max_materials IS NOT NULL;

INSERT INTO public.x_bak_20260826_max_materials (nguon, ban_ghi, ten, gia_tri_cu)
SELECT 'warehouse_type_configs', c.warehouse_id::text || '|' || c.type_code, c.type_code,
       c.putaway_max_materials
  FROM public.warehouse_type_configs c
 WHERE c.putaway_max_materials IS NOT NULL;

-- ⚠️ BẢNG SAO LƯU CŨNG PHẢI KHOÁ RLS — quên bước này là bảng hở với anon key.
-- Đo thật 26/08: tôi tạo bảng trên mà không bật RLS ⇒ bất biến "mọi bảng public đều bật RLS" của
-- gói QA 00 đỏ ngay ở CI. 3 bảng `x_bak_*` trước đó đều đã bật + 0 policy (khoá hẳn) — cùng khuôn.
-- `CREATE TABLE AS` KHÔNG kế thừa RLS của bảng nguồn, nên phải bật TAY, lần nào cũng vậy.
ALTER TABLE public.x_bak_20260826_max_materials ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."Warehouse"              DROP COLUMN IF EXISTS putaway_max_materials;
ALTER TABLE public.warehouse_type_configs   DROP COLUMN IF EXISTS putaway_max_materials;

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260826c_pallet_truck_loadplan.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- SƠ ĐỒ XẾP XE — phân biệt XE PALLET và XE THƯỜNG (user chốt 26/08).
--
-- BÀI TOÁN: xe pallet chở hàng ĐÃ LÊN PALLET (sức chứa tính bằng "16-17 pallet" = số CHỖ PALLET
-- trên sàn), còn xe xá thì xếp từng thùng bằng tay. Cùng một đơn hàng nhưng hai cách xếp khác hẳn
-- nhau, nên sơ đồ phải biết xe thuộc loại nào.
--
-- VÌ SAO KHÔNG ĐỌC TÊN: danh mục hiện có 'XE PALLET (16-17 PALLET)', 'XE 4 PALLET', 'XE XÁ' —
-- tên đã ngầm phân biệt, nhưng đọc vai trò theo TÊN TIẾNG VIỆT là luồng hỏng âm thầm khi ai đó
-- sửa tên danh mục (luật CLAUDE.md, ratchet `role_by_vietnamese_name` gác). Phải là CỜ.
--
-- PHÂN VAI (user chốt): LOẠI XE giữ CỜ pallet (quyết định CÁCH VẼ) · BIỂN SỐ giữ KÍCH THƯỚC
-- (chọn xe là có luôn D×R×C). Hai thứ ở hai bảng vì chúng trả lời hai câu hỏi khác nhau: "xe này
-- xếp kiểu gì" là thuộc tính của LOẠI, "lòng thùng bao nhiêu" là thuộc tính của CHIẾC XE.

-- [cutover] gỡ: BEGIN;

-- ── 1. LOẠI XE: cờ xe chở pallet ────────────────────────────────────────────
-- Mặc định false = xe thường = ĐÚNG hành vi hiện tại (xếp từng thùng), nên không kho nào đổi
-- hành vi cho tới khi có người tick cờ.
ALTER TABLE public."VehicleType"
  ADD COLUMN IF NOT EXISTS is_pallet_truck boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."VehicleType".is_pallet_truck IS
  'Xe chở hàng đã lên pallet (sức chứa tính bằng số chỗ pallet trên sàn). Quyết định CÁCH VẼ sơ đồ xếp xe: bật = gom hàng lên pallet rồi xếp pallet; tắt = xếp từng thùng như cũ.';

-- ── 2. BIỂN SỐ XE: kích thước lòng thùng ────────────────────────────────────
-- numeric (không integer) cho khớp kiểu 3 cột cùng nghĩa đã có ở "VehicleType".
ALTER TABLE public."Vehicle"
  ADD COLUMN IF NOT EXISTS box_length_mm numeric,
  ADD COLUMN IF NOT EXISTS box_width_mm  numeric,
  ADD COLUMN IF NOT EXISTS box_height_mm numeric;

-- Chặn số vô lý ngay ở DB (0/âm làm thuật toán xếp chia cho 0; >30m không phải xe tải).
-- NULL = chưa khai (hợp lệ — 952 xe hiện có đều chưa khai).
ALTER TABLE public."Vehicle" DROP CONSTRAINT IF EXISTS vehicle_box_dims_range;
ALTER TABLE public."Vehicle" ADD CONSTRAINT vehicle_box_dims_range CHECK (
      (box_length_mm IS NULL OR (box_length_mm > 0 AND box_length_mm <= 30000))
  AND (box_width_mm  IS NULL OR (box_width_mm  > 0 AND box_width_mm  <= 30000))
  AND (box_height_mm IS NULL OR (box_height_mm > 0 AND box_height_mm <= 30000))
);

COMMENT ON COLUMN public."Vehicle".box_length_mm IS
  'Chiều DÀI lòng thùng xe (mm) — sơ đồ xếp xe tự điền khi chọn biển số. NULL = chưa khai.';

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260826d_material_pallet_color.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- MÀU PALLET khai theo MÃ (user chốt 26/08): sơ đồ xếp xe vẽ ĐẾ pallet đồng màu, rõ nét phân
-- biệt với hàng phía trên; tương lai có pallet dạng khác (mỗi dạng = 1 mã is_pallet_carrier riêng,
-- mỗi mã 1 màu) nên màu phải nằm trên MÃ chứ không hardcode.
-- Chỉ có nghĩa khi `is_pallet_carrier` = true; hex #rrggbb; NULL = dùng màu mặc định (xanh Loscam).
ALTER TABLE public."Material"
  ADD COLUMN IF NOT EXISTS pallet_color text;

ALTER TABLE public."Material" DROP CONSTRAINT IF EXISTS material_pallet_color_hex;
ALTER TABLE public."Material" ADD CONSTRAINT material_pallet_color_hex
  CHECK (pallet_color IS NULL OR pallet_color ~ '^#[0-9a-fA-F]{6}$');

COMMENT ON COLUMN public."Material".pallet_color IS
  'Màu vẽ pallet trên sơ đồ xếp xe 3D (#rrggbb) — chỉ dùng khi is_pallet_carrier. NULL = màu mặc định.';



-- ─────────────────────────────────────────────────────────────────────────
-- [20260826e_materials_dims_filter.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- Trang Mã hàng: lọc theo KÍCH THƯỚC THÙNG đã khai hay chưa + theo CỜ đặc biệt (phi hàng hóa /
-- pallet mang hàng / hàng nhẹ lên nóc), và đếm "chưa khai KT thùng" cho SummaryBand.
--
-- Vì sao phải nằm trong RPC: danh mục 2.740 mã đã phân trang SERVER (20260728_materials_paged_rpc)
-- — lọc ở máy chỉ lọc được 200 dòng đang xem, số ô band cũng sai. Cùng lý do với 'incomplete'/'dup'.
--
-- Bối cảnh 26/08: sơ đồ xếp xe 3D cần D×R×C thùng; đo trên đơn thật 15/08 thì 201/202 mã đang dùng
-- CHƯA khai kích thước ⇒ phải có đường tìm nhanh "mã nào chưa khai" rồi áp hàng loạt.
--
-- ⚠️ plpgsql + force_custom_plan (bài học 27/07: LANGUAGE sql bị generic plan).
-- ⚠️ Giữ 2 hàm KHỚP NHAU khi sửa mệnh đề lọc.

DROP FUNCTION IF EXISTS materials_page(int, int, text[], text[], text[], text[], text[], text[], jsonb, text[], text[]);
CREATE FUNCTION materials_page(
  p_offset       int,
  p_limit        int,
  p_tokens       text[] DEFAULT NULL,   -- từ khoá ĐÃ chuẩn hoá (bỏ dấu, thường) — khớp AND từng token
  p_categories   text[] DEFAULT NULL,   -- lọc Loại hàng
  p_scope_cats   text[] DEFAULT NULL,   -- scope Loại hàng theo quyền (NULL = đủ quyền)
  p_status       text[] DEFAULT NULL,   -- 'active' | 'inactive'
  p_qr           text[] DEFAULT NULL,   -- 'has_qr' | 'no_qr'
  p_dq           text[] DEFAULT NULL,   -- 'incomplete' | 'dup'
  p_cat_rules    jsonb  DEFAULT '[]',   -- [{"c":"FG01","sl":true,"pe":false}]
  p_legacy_no_sl text[] DEFAULT NULL,   -- loại KHÔNG bắt HSD khi chưa khai cờ
  p_legacy_pe    text[] DEFAULT NULL,   -- loại BẮT Pallet/EA khi chưa khai cờ
  p_dims         text[] DEFAULT NULL,   -- 'has_dims' | 'no_dims' (kích thước thùng D×R×C)
  p_flags        text[] DEFAULT NULL    -- 'non_stock' | 'pallet_carrier' | 'stack_on_top'
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH rules AS (
    SELECT r->>'c' AS c, (r->>'sl')::boolean AS sl, (r->>'pe')::boolean AS pe
    FROM jsonb_array_elements(COALESCE(p_cat_rules, '[]'::jsonb)) r
  ),
  base AS (
    SELECT m.id, m.material_code, m.material_description, m.short_name, m.old_code, m.category,
           m.base_unit, m.entry_unit, m.is_active, m.no_qr_tracking,
           m.cartons_per_pallet, m.shelf_life_days, m.pallet_per_ea, m.search_norm,
           (COALESCE(m.carton_length_mm, 0) > 0 AND COALESCE(m.carton_width_mm, 0) > 0
            AND COALESCE(m.carton_height_mm, 0) > 0) AS has_dims,
           COALESCE(m.is_non_stock, false)     AS f_non_stock,
           COALESCE(m.is_pallet_carrier, false) AS f_pallet,
           COALESCE(m.stack_on_top, false)      AS f_on_top
    FROM "Material" m
    WHERE (p_scope_cats IS NULL OR m.category IS NULL OR m.category = ANY (p_scope_cats))
  ),
  dup AS (
    SELECT lower(btrim(material_description)) AS k
    FROM base WHERE btrim(COALESCE(material_description, '')) <> ''
    GROUP BY 1 HAVING count(*) > 1
  ),
  flagged AS (
    SELECT b.*,
           (lower(btrim(COALESCE(b.material_description, ''))) IN (SELECT k FROM dup)) AS is_dup,
           (b.category IS NULL OR b.category = ''
            OR b.base_unit IS NULL OR b.base_unit = ''
            OR b.cartons_per_pallet IS NULL OR b.cartons_per_pallet <= 0
            OR (COALESCE(r.sl, b.category IS NOT NULL AND NOT (b.category = ANY (COALESCE(p_legacy_no_sl, '{}'))))
                AND b.shelf_life_days IS NULL)
            OR (COALESCE(r.pe, b.category IS NOT NULL AND (b.category = ANY (COALESCE(p_legacy_pe, '{}'))))
                AND b.pallet_per_ea IS NULL)) AS is_incomplete
    FROM base b LEFT JOIN rules r ON r.c = b.category
  ),
  f AS (
    SELECT * FROM flagged x
    WHERE (p_status IS NULL OR (x.is_active AND 'active' = ANY (p_status)) OR (NOT x.is_active AND 'inactive' = ANY (p_status)))
      AND (p_qr IS NULL OR (x.no_qr_tracking AND 'no_qr' = ANY (p_qr)) OR (NOT x.no_qr_tracking AND 'has_qr' = ANY (p_qr)))
      AND (p_categories IS NULL OR COALESCE(x.category, '') = ANY (p_categories))
      AND (p_dq IS NULL OR (x.is_incomplete AND 'incomplete' = ANY (p_dq)) OR (x.is_dup AND 'dup' = ANY (p_dq)))
      AND (p_dims IS NULL OR (x.has_dims AND 'has_dims' = ANY (p_dims)) OR (NOT x.has_dims AND 'no_dims' = ANY (p_dims)))
      AND (p_flags IS NULL
           OR (x.f_non_stock AND 'non_stock' = ANY (p_flags))
           OR (x.f_pallet    AND 'pallet_carrier' = ANY (p_flags))
           OR (x.f_on_top    AND 'stack_on_top' = ANY (p_flags)))
      -- tìm kiếm: MỌI token phải có mặt (giống omniMatch ở FE), gộp cột chuẩn hoá + loại/ĐVT
      AND (p_tokens IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p_tokens) t
            WHERE position(t IN (COALESCE(x.search_norm, '') || ' ' ||
                   lower(COALESCE(x.category, '') || ' ' || COALESCE(x.base_unit, '') || ' ' || COALESCE(x.entry_unit, '')))) = 0))
  )
  , pg AS (
    SELECT id, material_code, is_dup FROM f ORDER BY material_code
    LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    'ids',     COALESCE((SELECT jsonb_agg(id ORDER BY material_code) FROM pg), '[]'::jsonb),
    'dup_ids', COALESCE((SELECT jsonb_agg(id) FROM pg WHERE is_dup), '[]'::jsonb),
    'total',   (SELECT count(*) FROM f)
  ) INTO result;
  RETURN result;
END $$;

DROP FUNCTION IF EXISTS materials_summary(text[], text[], text[], text[], text[], text[], jsonb, text[], text[]);
CREATE FUNCTION materials_summary(
  p_tokens       text[] DEFAULT NULL,
  p_categories   text[] DEFAULT NULL,
  p_scope_cats   text[] DEFAULT NULL,
  p_status       text[] DEFAULT NULL,
  p_qr           text[] DEFAULT NULL,
  p_dq           text[] DEFAULT NULL,
  p_cat_rules    jsonb  DEFAULT '[]',
  p_legacy_no_sl text[] DEFAULT NULL,
  p_legacy_pe    text[] DEFAULT NULL,
  p_dims         text[] DEFAULT NULL,
  p_flags        text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH rules AS (
    SELECT r->>'c' AS c, (r->>'sl')::boolean AS sl, (r->>'pe')::boolean AS pe
    FROM jsonb_array_elements(COALESCE(p_cat_rules, '[]'::jsonb)) r
  ),
  base AS (
    SELECT m.id, m.material_code, m.material_description, m.category,
           m.base_unit, m.entry_unit, m.is_active, m.no_qr_tracking,
           m.cartons_per_pallet, m.shelf_life_days, m.pallet_per_ea, m.search_norm,
           (COALESCE(m.carton_length_mm, 0) > 0 AND COALESCE(m.carton_width_mm, 0) > 0
            AND COALESCE(m.carton_height_mm, 0) > 0) AS has_dims,
           COALESCE(m.is_non_stock, false)      AS f_non_stock,
           COALESCE(m.is_pallet_carrier, false) AS f_pallet,
           COALESCE(m.stack_on_top, false)      AS f_on_top
    FROM "Material" m
    WHERE (p_scope_cats IS NULL OR m.category IS NULL OR m.category = ANY (p_scope_cats))
  ),
  dup AS (
    SELECT lower(btrim(material_description)) AS k
    FROM base WHERE btrim(COALESCE(material_description, '')) <> ''
    GROUP BY 1 HAVING count(*) > 1
  ),
  flagged AS (
    SELECT b.*,
           (lower(btrim(COALESCE(b.material_description, ''))) IN (SELECT k FROM dup)) AS is_dup,
           (b.category IS NULL OR b.category = ''
            OR b.base_unit IS NULL OR b.base_unit = ''
            OR b.cartons_per_pallet IS NULL OR b.cartons_per_pallet <= 0
            OR (COALESCE(r.sl, b.category IS NOT NULL AND NOT (b.category = ANY (COALESCE(p_legacy_no_sl, '{}'))))
                AND b.shelf_life_days IS NULL)
            OR (COALESCE(r.pe, b.category IS NOT NULL AND (b.category = ANY (COALESCE(p_legacy_pe, '{}'))))
                AND b.pallet_per_ea IS NULL)) AS is_incomplete
    FROM base b LEFT JOIN rules r ON r.c = b.category
  ),
  f AS (
    SELECT * FROM flagged x
    WHERE (p_status IS NULL OR (x.is_active AND 'active' = ANY (p_status)) OR (NOT x.is_active AND 'inactive' = ANY (p_status)))
      AND (p_qr IS NULL OR (x.no_qr_tracking AND 'no_qr' = ANY (p_qr)) OR (NOT x.no_qr_tracking AND 'has_qr' = ANY (p_qr)))
      AND (p_categories IS NULL OR COALESCE(x.category, '') = ANY (p_categories))
      AND (p_dq IS NULL OR (x.is_incomplete AND 'incomplete' = ANY (p_dq)) OR (x.is_dup AND 'dup' = ANY (p_dq)))
      AND (p_dims IS NULL OR (x.has_dims AND 'has_dims' = ANY (p_dims)) OR (NOT x.has_dims AND 'no_dims' = ANY (p_dims)))
      AND (p_flags IS NULL
           OR (x.f_non_stock AND 'non_stock' = ANY (p_flags))
           OR (x.f_pallet    AND 'pallet_carrier' = ANY (p_flags))
           OR (x.f_on_top    AND 'stack_on_top' = ANY (p_flags)))
      AND (p_tokens IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p_tokens) t
            WHERE position(t IN (COALESCE(x.search_norm, '') || ' ' ||
                   lower(COALESCE(x.category, '') || ' ' || COALESCE(x.base_unit, '') || ' ' || COALESCE(x.entry_unit, '')))) = 0))
  )
  SELECT jsonb_build_object(
    'total',      (SELECT count(*) FROM f),
    'active',     (SELECT count(*) FROM f WHERE is_active),
    'inactive',   (SELECT count(*) FROM f WHERE NOT is_active),
    'no_qr',      (SELECT count(*) FROM f WHERE no_qr_tracking),
    'incomplete', (SELECT count(*) FROM f WHERE is_incomplete),
    'dup',        (SELECT count(*) FROM f WHERE is_dup),
    'no_dims',    (SELECT count(*) FROM f WHERE NOT has_dims)
  ) INTO result;
  RETURN result;
END $$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260827_warehouse_productivity.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260827 — NĂNG SUẤT KHO theo khoảng ngày (user chốt 27/08: tab riêng trong Dashboard,
-- kiểu tab Nhập/Xuất/Tồn kho).
--
-- CHỐT NGUỒN SỐ (user chọn trong brainstorm 27/08):
--   · TẤN = CHỨNG TỪ, cộng CẢ HAI CHIỀU nhập + xuất (bốc hàng nhập cũng là công) — không lấy
--     phiếu cân vì chỉ kho có trạm cân mới có số (đo T8 staging: cân xuất 12.406t so chứng từ
--     19.105t ⇒ kho không có trạm sẽ trống trơn).
--   · CÔNG = module Chấm công (`Attendance`) — ngày công = CA1/CA2/CA3/HC, LEAVE không tính;
--     tổng giờ = ngày công × giờ chuẩn + OT − về sớm (ĐÚNG công thức `reportAttendance` đang dùng,
--     giờ chuẩn truyền vào từ cờ `standard_work_hours` để KHÔNG có bản sao mặc định thứ hai trong SQL).
--
-- QUY ƯỚC ĐƠN VỊ (base-unit): `cartons_imported`/`cartons_scanned` là BASE; `Material.weight_kg`
-- là KL của MỘT THÙNG (entry) — đúng như `gdo_weight_estimates` đang tính. ⇒ tấn = base ÷ units_per_carton
-- × weight_kg ÷ 1000. Mã chưa khai KL KHÔNG được coi là 0 âm thầm: đếm riêng `lines_no_weight`
-- để màn hình nói ra "có N dòng chưa khai khối lượng".
--
-- HIỆU NĂNG: 4 nguồn đều gom theo (kho, THÁNG) MỘT LƯỢT rồi mới tổng hợp 2 chiều (theo kho /
-- theo tháng) — không quét lại lần hai chỉ để vẽ biểu đồ xu hướng. Lọc ngày trên cột THÔ
-- (`>= p_from`, `< p_to + 1`) chứ không `::date` để còn dùng được index sẵn có
-- (idx_ie_wh_importdate, idx_gdo_wh_deliverydate, idx_attendance_date).
--
-- SCOPE: kho + loại hàng cắt như mọi RPC khác (null-inclusive với loại). ⚠️ CHẤM CÔNG KHÔNG CÓ
-- LOẠI HÀNG — một người bốc cả FG lẫn POSM, không tách được. Nên khi lọc theo loại thì TẤN bị cắt
-- mà CÔNG thì không ⇒ trả cờ `categories_filtered` để màn hình nói rõ, đừng để người đọc tưởng
-- năng suất tụt.

CREATE OR REPLACE FUNCTION public.warehouse_productivity(
  p_warehouse_ids text[]  DEFAULT NULL::text[],
  p_categories    text[]  DEFAULT NULL::text[],
  p_from          date    DEFAULT NULL::date,
  p_to            date    DEFAULT NULL::date,
  p_std_hours     numeric DEFAULT 8
) RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
with
-- Kho trong phạm vi — dòng nào cũng phải hiện dù kỳ đó không có việc (0 tấn vẫn là thông tin)
wh as (
  select w.id, w.name
  from "Warehouse" w
  where (p_warehouse_ids is null or w.id = any(p_warehouse_ids))
),
-- NHẬP: dòng tồn tạo trong kỳ. import_date là NGÀY nghiệp vụ VN lưu dạng timestamp lúc 00:00.
tin as (
  select ie.warehouse_id::text                        as wid,
         date_trunc('month', ie.import_date)::date    as mon,
         sum(case when coalesce(m.weight_kg,0) > 0
                  then ie.cartons_imported
                       / (case when coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)
                       * m.weight_kg
                  else 0 end) / 1000.0                as tons,
         count(*)                                     as pallets,
         count(*) filter (where coalesce(m.weight_kg,0) <= 0) as lines_no_weight
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date >= p_from and ie.import_date < (p_to + 1)
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by 1, 2
),
-- XUẤT: lấy số THỰC XUẤT (cartons_scanned) — năng suất là việc ĐÃ LÀM, không phải kế hoạch.
-- Chuyến đã huỷ không tính. Ngày quy về `delivery_date` (ngày xe chạy — cùng cột cả app đang lọc).
tout as (
  select g.warehouse_id::text                         as wid,
         date_trunc('month', g.delivery_date)::date   as mon,
         sum(case when coalesce(m.weight_kg,0) > 0
                  then oi.cartons_scanned
                       / (case when coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)
                       * m.weight_kg
                  else 0 end) / 1000.0                as tons,
         count(*) filter (where coalesce(m.weight_kg,0) <= 0 and coalesce(oi.cartons_scanned,0) > 0) as lines_no_weight
  from "GroupDeliveryOrder" g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi    on oi.do_id = d.id
  left join "Material" m    on m.id = oi.material_id
  where g.delivery_date between p_from and p_to
    and coalesce(g.status, '') <> 'CANCELLED'
    and (p_warehouse_ids is null or g.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by 1, 2
),
trips as (
  select g.warehouse_id::text                         as wid,
         date_trunc('month', g.delivery_date)::date   as mon,
         count(*)                                     as trips
  from "GroupDeliveryOrder" g
  where g.delivery_date between p_from and p_to
    and g.status = 'COMPLETED'
    and (p_warehouse_ids is null or g.warehouse_id::text = any(p_warehouse_ids))
  group by 1, 2
),
-- CÔNG: kho của dòng chấm công; dòng chưa gắn kho thì lấy kho của nhân sự (đừng để công rơi ra
-- ngoài mọi kho rồi tử số có mà mẫu số không).
lab as (
  select coalesce(a.warehouse_id, e.warehouse_id)::text as wid,
         date_trunc('month', a.work_date)::date         as mon,
         count(*) filter (where a.kind in ('CA1','CA2','CA3','HC'))                    as work_days,
         count(distinct a.employee_id) filter (where a.kind in ('CA1','CA2','CA3','HC')) as headcount,
         count(*) filter (where a.kind = 'LEAVE')                                      as leave_days,
         coalesce(sum(a.ot_hours), 0)                                                  as ot_hours,
         coalesce(sum(a.early_leave_hours), 0)                                         as early_hours
  from "Attendance" a
  left join "Employee" e on e.id = a.employee_id
  where a.work_date between p_from and p_to
    and (p_warehouse_ids is null or coalesce(a.warehouse_id, e.warehouse_id)::text = any(p_warehouse_ids))
  group by 1, 2
),
-- Gộp 4 nguồn về lưới (kho × tháng) — mọi tổng hợp phía sau đọc từ đây
cell as (
  select k.wid, k.mon,
         coalesce(tin.tons, 0)            as tons_in,
         coalesce(tout.tons, 0)           as tons_out,
         coalesce(tin.pallets, 0)         as pallets_in,
         coalesce(trips.trips, 0)         as trips,
         coalesce(lab.work_days, 0)       as work_days,
         coalesce(lab.headcount, 0)       as headcount,
         coalesce(lab.leave_days, 0)      as leave_days,
         coalesce(lab.ot_hours, 0)        as ot_hours,
         coalesce(lab.early_hours, 0)     as early_hours,
         coalesce(tin.lines_no_weight, 0) + coalesce(tout.lines_no_weight, 0) as lines_no_weight
  from (
    select wid, mon from tin
    union select wid, mon from tout
    union select wid, mon from trips
    union select wid, mon from lab
  ) k
  left join tin   on tin.wid = k.wid   and tin.mon = k.mon
  left join tout  on tout.wid = k.wid  and tout.mon = k.mon
  left join trips on trips.wid = k.wid and trips.mon = k.mon
  left join lab   on lab.wid = k.wid   and lab.mon = k.mon
  where k.wid is not null
),
-- Theo KHO (mọi kho trong phạm vi, kể cả kho không phát sinh)
per_wh as (
  select w.id                                  as warehouse_id,
         w.name                                as warehouse_name,
         coalesce(sum(c.tons_in), 0)           as tons_in,
         coalesce(sum(c.tons_out), 0)          as tons_out,
         coalesce(sum(c.pallets_in), 0)        as pallets_in,
         coalesce(sum(c.trips), 0)             as trips,
         coalesce(sum(c.work_days), 0)         as work_days,
         coalesce(max(c.headcount), 0)         as headcount,
         coalesce(sum(c.leave_days), 0)        as leave_days,
         coalesce(sum(c.ot_hours), 0)          as ot_hours,
         coalesce(sum(c.early_hours), 0)       as early_hours,
         coalesce(sum(c.lines_no_weight), 0)   as lines_no_weight
  from wh w
  left join cell c on c.wid = w.id
  group by w.id, w.name
),
-- Theo THÁNG (xu hướng) — cùng một lượt quét, không truy vấn lại
per_mon as (
  select c.mon                          as month,
         sum(c.tons_in)                 as tons_in,
         sum(c.tons_out)                as tons_out,
         sum(c.trips)                   as trips,
         sum(c.work_days)               as work_days,
         sum(c.ot_hours)                as ot_hours,
         sum(c.early_hours)             as early_hours
  from cell c
  join wh w on w.id = c.wid
  group by c.mon
)
select jsonb_build_object(
  'from',       p_from,
  'to',         p_to,
  'std_hours',  p_std_hours,
  'categories_filtered', (p_categories is not null),
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'warehouse_id',    r.warehouse_id,
      'warehouse_name',  r.warehouse_name,
      'tons_in',         round(r.tons_in::numeric, 3),
      'tons_out',        round(r.tons_out::numeric, 3),
      'tons',            round((r.tons_in + r.tons_out)::numeric, 3),
      'pallets_in',      r.pallets_in,
      'trips',           r.trips,
      'work_days',       r.work_days,
      'work_hours',      round((r.work_days * p_std_hours + r.ot_hours - r.early_hours)::numeric, 2),
      'ot_hours',        round(r.ot_hours::numeric, 2),
      'early_hours',     round(r.early_hours::numeric, 2),
      'leave_days',      r.leave_days,
      'headcount',       r.headcount,
      'lines_no_weight', r.lines_no_weight
    ) order by (r.tons_in + r.tons_out) desc, r.warehouse_name)
    from per_wh r), '[]'::jsonb),
  'by_month', coalesce((
    select jsonb_agg(jsonb_build_object(
      'month',      to_char(p.month, 'YYYY-MM'),
      'tons_in',    round(p.tons_in::numeric, 3),
      'tons_out',   round(p.tons_out::numeric, 3),
      'tons',       round((p.tons_in + p.tons_out)::numeric, 3),
      'trips',      p.trips,
      'work_days',  p.work_days,
      'work_hours', round((p.work_days * p_std_hours + p.ot_hours - p.early_hours)::numeric, 2),
      'ot_hours',   round(p.ot_hours::numeric, 2)
    ) order by p.month)
    from per_mon p), '[]'::jsonb),
  'totals', (
    select jsonb_build_object(
      'tons_in',         round(coalesce(sum(r.tons_in), 0)::numeric, 3),
      'tons_out',        round(coalesce(sum(r.tons_out), 0)::numeric, 3),
      'tons',            round(coalesce(sum(r.tons_in + r.tons_out), 0)::numeric, 3),
      'pallets_in',      coalesce(sum(r.pallets_in), 0),
      'trips',           coalesce(sum(r.trips), 0),
      'work_days',       coalesce(sum(r.work_days), 0),
      'work_hours',      round(coalesce(sum(r.work_days * p_std_hours + r.ot_hours - r.early_hours), 0)::numeric, 2),
      'ot_hours',        round(coalesce(sum(r.ot_hours), 0)::numeric, 2),
      'leave_days',      coalesce(sum(r.leave_days), 0),
      'headcount',       coalesce(sum(r.headcount), 0),
      'lines_no_weight', coalesce(sum(r.lines_no_weight), 0),
      'warehouses_no_labor', coalesce(count(*) filter (where r.work_days = 0 and (r.tons_in + r.tons_out) > 0), 0)
    ) from per_wh r)
);
$function$;

COMMENT ON FUNCTION public.warehouse_productivity(text[], text[], date, date, numeric) IS
  'Năng suất kho theo khoảng ngày: tấn nhập/xuất (chứng từ, base ÷ upc × weight_kg), số chuyến, ngày công/giờ công/OT từ Attendance. Gom theo (kho × tháng) 1 lượt rồi tổng hợp 2 chiều.';

-- CACHE — dùng LẠI bảng `dashboard_cache` + cờ `dashboard_cache_seconds` của trang chủ (20260821f),
-- không đẻ cơ chế cache thứ hai. Đo trên dữ liệu lớn staging (145k dòng): 1 tháng ~320-400ms,
-- 12 tháng ~1,65s — không nặng như dashboard_all nhưng vẫn là tổng hợp toàn công ty, mà tab này
-- ai mở cũng chạy lại y hệt nhau. p_ttl_seconds <= 0 ⇒ bỏ qua cache (giữ đường cũ nguyên vẹn).
CREATE OR REPLACE FUNCTION public.warehouse_productivity_cached(
  p_warehouse_ids text[]  DEFAULT NULL::text[],
  p_categories    text[]  DEFAULT NULL::text[],
  p_from          date    DEFAULT NULL::date,
  p_to            date    DEFAULT NULL::date,
  p_std_hours     numeric DEFAULT 8,
  p_ttl_seconds   int     DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_key  text;
  v_hit  jsonb;
  v_calc jsonb;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RETURN warehouse_productivity(p_warehouse_ids, p_categories, p_from, p_to, p_std_hours);
  END IF;

  -- Khoá = ĐÚNG bộ tham số; sắp mảng để 2 user cùng phạm vi (khác thứ tự id) dùng chung 1 dòng.
  v_key := 'prod|' || md5(
       coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p_warehouse_ids) x), '*')
    || '|' || coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p_categories) x), '*')
    || '|' || coalesce(p_from::text, '*') || '|' || coalesce(p_to::text, '*')
    || '|' || coalesce(p_std_hours::text, '*'));

  SELECT payload INTO v_hit FROM public.dashboard_cache
   WHERE key = v_key AND computed_at > now() - make_interval(secs => p_ttl_seconds);
  IF v_hit IS NOT NULL THEN
    RETURN v_hit || jsonb_build_object('cached', true);
  END IF;

  v_calc := warehouse_productivity(p_warehouse_ids, p_categories, p_from, p_to, p_std_hours);
  INSERT INTO public.dashboard_cache(key, payload, computed_at) VALUES (v_key, v_calc, now())
  ON CONFLICT (key) DO UPDATE SET payload = excluded.payload, computed_at = excluded.computed_at;
  RETURN v_calc;
END;
$$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260827b_warehouse_costs.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260827b — MODULE CHI PHÍ KHO (user chốt 27/08: "tạo 1 module chi phí riêng và kê khai vào").
--
-- App KHÔNG có bất kỳ dữ liệu chi phí nào từ trước — đây là nguồn nhập MỚI, không phải dẫn xuất.
-- Hạt nhân: một dòng = (Kho × Tháng × Khoản mục) → số tiền. Khoá duy nhất trên đúng 3 cột đó nên
-- khai lại là ĐÈ, upload lại KHÔNG nhân đôi (idempotent theo khoá nghiệp vụ — chuẩn upload của dự án).
--
-- Ba quyết định đáng ghi:
--  1. KỲ = THÁNG (kế toán chốt theo tháng). Tab Năng suất cho chọn khoảng ngày tự do ⇒ khoảng LẺ
--     thì chi phí PHÂN BỔ THEO NGÀY (số ngày của tháng nằm trong khoảng ÷ số ngày của tháng) và
--     màn hình phải NÓI RÕ là số phân bổ — cờ `cost_prorated` trong payload.
--  2. Cho phép dòng chi phí CHUNG (`warehouse_id IS NULL`) — chi phí quản lý vùng/văn phòng không
--     thuộc kho nào. Phân bổ xuống kho theo TẤN. Nếu bắt gán hết về kho thì kế toán sẽ nhét bừa
--     vào một kho và chỉ số kho đó xấu oan.
--  3. Kỳ có TRẠNG THÁI: bảng `warehouse_cost_locks` khoá (kho × tháng). Khoá ở CẤP KỲ chứ không
--     phải cột trên từng dòng — nếu để trên dòng thì kỳ đã chốt vẫn THÊM được dòng mới (chưa có
--     dòng thì chưa có khoá). Đây là số đưa lên lãnh đạo, sửa lén sau cuộc họp là chuyện có thật.
--
-- Danh mục khoản mục dùng LẠI `LookupValue` type `cost_item` (đúng cơ chế của ĐVT/Loại kho, nhãn
-- ở `meta.label`) — kế toán tự thêm khoản mục mà không cần sửa code.

CREATE TABLE IF NOT EXISTS public.warehouse_costs (
  id            text        PRIMARY KEY,
  warehouse_id  text        NULL REFERENCES public."Warehouse"(id) ON DELETE CASCADE,
  period        date        NOT NULL,        -- LUÔN là ngày đầu tháng
  cost_item     text        NOT NULL,        -- mã khoản mục (LookupValue type cost_item)
  amount        numeric     NOT NULL DEFAULT 0,   -- VND
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  updated_at    timestamptz NOT NULL,
  updated_by    text,
  CONSTRAINT warehouse_costs_period_is_month CHECK (period = date_trunc('month', period)::date),
  CONSTRAINT warehouse_costs_amount_nonneg   CHECK (amount >= 0)
);

-- Khoá nghiệp vụ. Kho NULL (chi phí chung) phải coi là MỘT giá trị chứ không phải "khác nhau hết"
-- ⇒ coalesce về '*', nếu không thì mỗi lần khai chi phí chung lại đẻ thêm một dòng.
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_costs_key
  ON public.warehouse_costs (coalesce(warehouse_id, '*'), period, cost_item);
CREATE INDEX IF NOT EXISTS idx_warehouse_costs_period ON public.warehouse_costs (period);

ALTER TABLE public.warehouse_costs ENABLE ROW LEVEL SECURITY;   -- chỉ service_role (bất biến QA 00)

CREATE TABLE IF NOT EXISTS public.warehouse_cost_locks (
  id            text        PRIMARY KEY,
  warehouse_id  text        NULL REFERENCES public."Warehouse"(id) ON DELETE CASCADE,
  period        date        NOT NULL,
  locked_at     timestamptz NOT NULL DEFAULT now(),
  locked_by     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL,
  CONSTRAINT warehouse_cost_locks_period_is_month CHECK (period = date_trunc('month', period)::date)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_cost_locks_key
  ON public.warehouse_cost_locks (coalesce(warehouse_id, '*'), period);
ALTER TABLE public.warehouse_cost_locks ENABLE ROW LEVEL SECURITY;

-- Danh mục khoản mục mặc định (kế toán sửa/thêm được ở màn danh mục). `is_labor` để tách được
-- "chi phí NHÂN CÔNG/tấn" — khoản đội lên nhiều nhất và là khoản kho tác động được.
INSERT INTO public."LookupValue"(id, type, value, sort_order, created_at, updated_at, meta)
SELECT gen_random_uuid(), 'cost_item', v.code, v.ord, now(), now(),
       jsonb_build_object('label', v.label, 'is_labor', v.is_labor, 'group', v.grp)
FROM (VALUES
  ('LABOR',     'Nhân công',            1, true,  'VARIABLE'),
  ('RENT',      'Thuê kho / bãi',       2, false, 'FIXED'),
  ('UTILITY',   'Điện nước',            3, false, 'VARIABLE'),
  ('FORKLIFT',  'Xe nâng & nhiên liệu', 4, false, 'VARIABLE'),
  ('PACKAGING', 'Bao bì / vật tư',      5, false, 'VARIABLE'),
  ('MAINT',     'Bảo trì',              6, false, 'FIXED'),
  ('OTHER',     'Khác',                 7, false, 'VARIABLE')
) AS v(code, label, ord, is_labor, grp)
WHERE NOT EXISTS (
  SELECT 1 FROM public."LookupValue" l WHERE l.type = 'cost_item' AND l.value = v.code
);

-- ── Năng suất kho: BỔ SUNG chi phí vào RPC 20260827 (giữ nguyên signature + mọi khoá cũ) ───────
-- Chi phí đi CHUNG payload với tấn/công để màn hình chỉ cần 1 lời gọi; backend LỌC BỎ các khoá
-- chi phí khi người dùng không có quyền `warehouse_cost.view` (cache lưu bản đủ, cắt ở tầng API).
CREATE OR REPLACE FUNCTION public.warehouse_productivity(
  p_warehouse_ids text[]  DEFAULT NULL::text[],
  p_categories    text[]  DEFAULT NULL::text[],
  p_from          date    DEFAULT NULL::date,
  p_to            date    DEFAULT NULL::date,
  p_std_hours     numeric DEFAULT 8
) RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
with
wh as (
  select w.id, w.name
  from "Warehouse" w
  where (p_warehouse_ids is null or w.id = any(p_warehouse_ids))
),
tin as (
  select ie.warehouse_id::text                        as wid,
         date_trunc('month', ie.import_date)::date    as mon,
         sum(case when coalesce(m.weight_kg,0) > 0
                  then ie.cartons_imported
                       / (case when coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)
                       * m.weight_kg
                  else 0 end) / 1000.0                as tons,
         count(*)                                     as pallets,
         count(*) filter (where coalesce(m.weight_kg,0) <= 0) as lines_no_weight
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date >= p_from and ie.import_date < (p_to + 1)
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by 1, 2
),
tout as (
  select g.warehouse_id::text                         as wid,
         date_trunc('month', g.delivery_date)::date   as mon,
         sum(case when coalesce(m.weight_kg,0) > 0
                  then oi.cartons_scanned
                       / (case when coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)
                       * m.weight_kg
                  else 0 end) / 1000.0                as tons,
         count(*) filter (where coalesce(m.weight_kg,0) <= 0 and coalesce(oi.cartons_scanned,0) > 0) as lines_no_weight
  from "GroupDeliveryOrder" g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi    on oi.do_id = d.id
  left join "Material" m    on m.id = oi.material_id
  where g.delivery_date between p_from and p_to
    and coalesce(g.status, '') <> 'CANCELLED'
    and (p_warehouse_ids is null or g.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by 1, 2
),
trips as (
  select g.warehouse_id::text                         as wid,
         date_trunc('month', g.delivery_date)::date   as mon,
         count(*)                                     as trips
  from "GroupDeliveryOrder" g
  where g.delivery_date between p_from and p_to
    and g.status = 'COMPLETED'
    and (p_warehouse_ids is null or g.warehouse_id::text = any(p_warehouse_ids))
  group by 1, 2
),
lab as (
  select coalesce(a.warehouse_id, e.warehouse_id)::text as wid,
         date_trunc('month', a.work_date)::date         as mon,
         count(*) filter (where a.kind in ('CA1','CA2','CA3','HC'))                      as work_days,
         count(distinct a.employee_id) filter (where a.kind in ('CA1','CA2','CA3','HC')) as headcount,
         count(*) filter (where a.kind = 'LEAVE')                                        as leave_days,
         coalesce(sum(a.ot_hours), 0)                                                    as ot_hours,
         coalesce(sum(a.early_leave_hours), 0)                                           as early_hours
  from "Attendance" a
  left join "Employee" e on e.id = a.employee_id
  where a.work_date between p_from and p_to
    and (p_warehouse_ids is null or coalesce(a.warehouse_id, e.warehouse_id)::text = any(p_warehouse_ids))
  group by 1, 2
),
-- CHI PHÍ: tỷ lệ ngày của THÁNG nằm trong khoảng đang xem (khoảng tròn tháng ⇒ frac = 1).
cost_raw as (
  select wc.warehouse_id                                     as wid,
         wc.amount * (
           greatest(0, (least(p_to, (wc.period + interval '1 month - 1 day')::date)
                        - greatest(p_from, wc.period) + 1))::numeric
           / extract(day from (wc.period + interval '1 month - 1 day'))::numeric
         )                                                   as amount,
         coalesce((li.meta->>'is_labor')::boolean, false)     as is_labor,
         (greatest(p_from, wc.period) > wc.period
          or least(p_to, (wc.period + interval '1 month - 1 day')::date) < (wc.period + interval '1 month - 1 day')::date) as partial
  from public.warehouse_costs wc
  left join "LookupValue" li on li.type = 'cost_item' and li.value = wc.cost_item
  where wc.period between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
    and (wc.warehouse_id is null or p_warehouse_ids is null or wc.warehouse_id = any(p_warehouse_ids))
),
cost_own as (
  select wid,
         sum(amount)                                        as amount,
         sum(amount) filter (where is_labor)                as labor
  from cost_raw where wid is not null group by wid
),
cost_shared as (
  select coalesce(sum(amount), 0) as amount, coalesce(sum(amount) filter (where is_labor), 0) as labor
  from cost_raw where wid is null
),
cell as (
  select k.wid, k.mon,
         coalesce(tin.tons, 0)            as tons_in,
         coalesce(tout.tons, 0)           as tons_out,
         coalesce(tin.pallets, 0)         as pallets_in,
         coalesce(trips.trips, 0)         as trips,
         coalesce(lab.work_days, 0)       as work_days,
         coalesce(lab.headcount, 0)       as headcount,
         coalesce(lab.leave_days, 0)      as leave_days,
         coalesce(lab.ot_hours, 0)        as ot_hours,
         coalesce(lab.early_hours, 0)     as early_hours,
         coalesce(tin.lines_no_weight, 0) + coalesce(tout.lines_no_weight, 0) as lines_no_weight
  from (
    select wid, mon from tin
    union select wid, mon from tout
    union select wid, mon from trips
    union select wid, mon from lab
  ) k
  left join tin   on tin.wid = k.wid   and tin.mon = k.mon
  left join tout  on tout.wid = k.wid  and tout.mon = k.mon
  left join trips on trips.wid = k.wid and trips.mon = k.mon
  left join lab   on lab.wid = k.wid   and lab.mon = k.mon
  where k.wid is not null
),
per_wh0 as (
  select w.id                                  as warehouse_id,
         w.name                                as warehouse_name,
         coalesce(sum(c.tons_in), 0)           as tons_in,
         coalesce(sum(c.tons_out), 0)          as tons_out,
         coalesce(sum(c.pallets_in), 0)        as pallets_in,
         coalesce(sum(c.trips), 0)             as trips,
         coalesce(sum(c.work_days), 0)         as work_days,
         coalesce(max(c.headcount), 0)         as headcount,
         coalesce(sum(c.leave_days), 0)        as leave_days,
         coalesce(sum(c.ot_hours), 0)          as ot_hours,
         coalesce(sum(c.early_hours), 0)       as early_hours,
         coalesce(sum(c.lines_no_weight), 0)   as lines_no_weight
  from wh w
  left join cell c on c.wid = w.id
  group by w.id, w.name
),
-- Chi phí CHUNG chia xuống kho theo TẤN (kỳ không có tấn thì để nguyên ở tổng, không chia bừa)
per_wh as (
  select p.*,
         coalesce(co.amount, 0) as cost_own,
         coalesce(co.labor, 0)  as cost_labor_own,
         case when sum(p.tons_in + p.tons_out) over () > 0
              then (select amount from cost_shared) * (p.tons_in + p.tons_out) / sum(p.tons_in + p.tons_out) over ()
              else 0 end        as cost_shared_alloc,
         case when sum(p.tons_in + p.tons_out) over () > 0
              then (select labor from cost_shared) * (p.tons_in + p.tons_out) / sum(p.tons_in + p.tons_out) over ()
              else 0 end        as cost_labor_shared_alloc
  from per_wh0 p
  left join cost_own co on co.wid = p.warehouse_id
),
per_mon as (
  select c.mon                          as month,
         sum(c.tons_in)                 as tons_in,
         sum(c.tons_out)                as tons_out,
         sum(c.trips)                   as trips,
         sum(c.work_days)               as work_days,
         sum(c.ot_hours)                as ot_hours,
         sum(c.early_hours)             as early_hours
  from cell c
  join wh w on w.id = c.wid
  group by c.mon
)
select jsonb_build_object(
  'from',       p_from,
  'to',         p_to,
  'std_hours',  p_std_hours,
  'categories_filtered', (p_categories is not null),
  'cost_prorated', coalesce((select bool_or(partial) from cost_raw), false),
  'cost_shared',   round(coalesce((select amount from cost_shared), 0)::numeric, 0),
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'warehouse_id',    r.warehouse_id,
      'warehouse_name',  r.warehouse_name,
      'tons_in',         round(r.tons_in::numeric, 3),
      'tons_out',        round(r.tons_out::numeric, 3),
      'tons',            round((r.tons_in + r.tons_out)::numeric, 3),
      'pallets_in',      r.pallets_in,
      'trips',           r.trips,
      'work_days',       r.work_days,
      'work_hours',      round((r.work_days * p_std_hours + r.ot_hours - r.early_hours)::numeric, 2),
      'ot_hours',        round(r.ot_hours::numeric, 2),
      'early_hours',     round(r.early_hours::numeric, 2),
      'leave_days',      r.leave_days,
      'headcount',       r.headcount,
      'lines_no_weight', r.lines_no_weight,
      'cost',            round((r.cost_own + r.cost_shared_alloc)::numeric, 0),
      'cost_own',        round(r.cost_own::numeric, 0),
      'cost_labor',      round((r.cost_labor_own + r.cost_labor_shared_alloc)::numeric, 0)
    ) order by (r.tons_in + r.tons_out) desc, r.warehouse_name)
    from per_wh r), '[]'::jsonb),
  'by_month', coalesce((
    select jsonb_agg(jsonb_build_object(
      'month',      to_char(p.month, 'YYYY-MM'),
      'tons_in',    round(p.tons_in::numeric, 3),
      'tons_out',   round(p.tons_out::numeric, 3),
      'tons',       round((p.tons_in + p.tons_out)::numeric, 3),
      'trips',      p.trips,
      'work_days',  p.work_days,
      'work_hours', round((p.work_days * p_std_hours + p.ot_hours - p.early_hours)::numeric, 2),
      'ot_hours',   round(p.ot_hours::numeric, 2)
    ) order by p.month)
    from per_mon p), '[]'::jsonb),
  'totals', (
    select jsonb_build_object(
      'tons_in',         round(coalesce(sum(r.tons_in), 0)::numeric, 3),
      'tons_out',        round(coalesce(sum(r.tons_out), 0)::numeric, 3),
      'tons',            round(coalesce(sum(r.tons_in + r.tons_out), 0)::numeric, 3),
      'pallets_in',      coalesce(sum(r.pallets_in), 0),
      'trips',           coalesce(sum(r.trips), 0),
      'work_days',       coalesce(sum(r.work_days), 0),
      'work_hours',      round(coalesce(sum(r.work_days * p_std_hours + r.ot_hours - r.early_hours), 0)::numeric, 2),
      'ot_hours',        round(coalesce(sum(r.ot_hours), 0)::numeric, 2),
      'early_hours',     round(coalesce(sum(r.early_hours), 0)::numeric, 2),
      'leave_days',      coalesce(sum(r.leave_days), 0),
      'headcount',       coalesce(sum(r.headcount), 0),
      'lines_no_weight', coalesce(sum(r.lines_no_weight), 0),
      'cost',            round(coalesce(sum(r.cost_own), 0)::numeric + coalesce((select amount from cost_shared), 0)::numeric, 0),
      'cost_labor',      round(coalesce(sum(r.cost_labor_own), 0)::numeric + coalesce((select labor from cost_shared), 0)::numeric, 0),
      'warehouses_no_labor', coalesce(count(*) filter (where r.work_days = 0 and (r.tons_in + r.tons_out) > 0), 0),
      'warehouses_no_cost',  coalesce(count(*) filter (where r.cost_own = 0 and (r.tons_in + r.tons_out) > 0), 0)
    ) from per_wh r)
);
$function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260827c_cost_no_alloc.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260827c — DÒNG TỪNG KHO CHỈ MANG CHI PHÍ RIÊNG CỦA KHO (bỏ phân bổ chi phí chung xuống kho).
--
-- Vì sao đổi (bắt được khi soi màn hình thật ngay sau khi làm xong 20260827b): bản đầu chia chi phí
-- CHUNG xuống từng kho theo tấn — nghe hợp lý, nhưng mẫu số là "tấn của các kho ĐANG LỌC". Người
-- dùng lọc 1 kho (Kho Ba Vì) thì kho đó GÁNH 100% chi phí chung toàn công ty ⇒ chi phí/tấn của kho
-- phồng lên vô lý, mà nhìn số thì không ai biết vì sao. Muốn chia đúng thì mẫu số phải là tấn của
-- TOÀN CÔNG TY, tức phải quét thêm một lượt không lọc kho — đắt, và vẫn khó giải thích.
--
-- Chốt cách đơn giản mà không đọc sai được:
--   · Dòng từng kho  = chi phí RIÊNG của kho đó (chi phí/tấn của kho = tiền của kho ÷ tấn của kho).
--   · Ô tổng         = Σ chi phí riêng + chi phí CHUNG, kèm dòng ghi rõ "gồm N chi phí chung".
-- Ai muốn biết phần chung đã cộng vào đâu thì nhìn `cost_shared` — không giấu, không chia lén.

CREATE OR REPLACE FUNCTION public.warehouse_productivity(
  p_warehouse_ids text[]  DEFAULT NULL::text[],
  p_categories    text[]  DEFAULT NULL::text[],
  p_from          date    DEFAULT NULL::date,
  p_to            date    DEFAULT NULL::date,
  p_std_hours     numeric DEFAULT 8
) RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
with
wh as (
  select w.id, w.name
  from "Warehouse" w
  where (p_warehouse_ids is null or w.id = any(p_warehouse_ids))
),
tin as (
  select ie.warehouse_id::text                        as wid,
         date_trunc('month', ie.import_date)::date    as mon,
         sum(case when coalesce(m.weight_kg,0) > 0
                  then ie.cartons_imported
                       / (case when coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)
                       * m.weight_kg
                  else 0 end) / 1000.0                as tons,
         count(*)                                     as pallets,
         count(*) filter (where coalesce(m.weight_kg,0) <= 0) as lines_no_weight
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date >= p_from and ie.import_date < (p_to + 1)
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by 1, 2
),
tout as (
  select g.warehouse_id::text                         as wid,
         date_trunc('month', g.delivery_date)::date   as mon,
         sum(case when coalesce(m.weight_kg,0) > 0
                  then oi.cartons_scanned
                       / (case when coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)
                       * m.weight_kg
                  else 0 end) / 1000.0                as tons,
         count(*) filter (where coalesce(m.weight_kg,0) <= 0 and coalesce(oi.cartons_scanned,0) > 0) as lines_no_weight
  from "GroupDeliveryOrder" g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi    on oi.do_id = d.id
  left join "Material" m    on m.id = oi.material_id
  where g.delivery_date between p_from and p_to
    and coalesce(g.status, '') <> 'CANCELLED'
    and (p_warehouse_ids is null or g.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by 1, 2
),
trips as (
  select g.warehouse_id::text                         as wid,
         date_trunc('month', g.delivery_date)::date   as mon,
         count(*)                                     as trips
  from "GroupDeliveryOrder" g
  where g.delivery_date between p_from and p_to
    and g.status = 'COMPLETED'
    and (p_warehouse_ids is null or g.warehouse_id::text = any(p_warehouse_ids))
  group by 1, 2
),
lab as (
  select coalesce(a.warehouse_id, e.warehouse_id)::text as wid,
         date_trunc('month', a.work_date)::date         as mon,
         count(*) filter (where a.kind in ('CA1','CA2','CA3','HC'))                      as work_days,
         count(distinct a.employee_id) filter (where a.kind in ('CA1','CA2','CA3','HC')) as headcount,
         count(*) filter (where a.kind = 'LEAVE')                                        as leave_days,
         coalesce(sum(a.ot_hours), 0)                                                    as ot_hours,
         coalesce(sum(a.early_leave_hours), 0)                                           as early_hours
  from "Attendance" a
  left join "Employee" e on e.id = a.employee_id
  where a.work_date between p_from and p_to
    and (p_warehouse_ids is null or coalesce(a.warehouse_id, e.warehouse_id)::text = any(p_warehouse_ids))
  group by 1, 2
),
-- Chi phí: tỷ lệ ngày của THÁNG nằm trong khoảng đang xem (khoảng tròn tháng ⇒ frac = 1)
cost_raw as (
  select wc.warehouse_id                                     as wid,
         wc.amount * (
           greatest(0, (least(p_to, (wc.period + interval '1 month - 1 day')::date)
                        - greatest(p_from, wc.period) + 1))::numeric
           / extract(day from (wc.period + interval '1 month - 1 day'))::numeric
         )                                                   as amount,
         coalesce((li.meta->>'is_labor')::boolean, false)     as is_labor,
         (greatest(p_from, wc.period) > wc.period
          or least(p_to, (wc.period + interval '1 month - 1 day')::date) < (wc.period + interval '1 month - 1 day')::date) as partial
  from public.warehouse_costs wc
  left join "LookupValue" li on li.type = 'cost_item' and li.value = wc.cost_item
  where wc.period between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
    and (wc.warehouse_id is null or p_warehouse_ids is null or wc.warehouse_id = any(p_warehouse_ids))
),
cost_own as (
  select wid, sum(amount) as amount, sum(amount) filter (where is_labor) as labor
  from cost_raw where wid is not null group by wid
),
cost_shared as (
  select coalesce(sum(amount), 0) as amount, coalesce(sum(amount) filter (where is_labor), 0) as labor
  from cost_raw where wid is null
),
cell as (
  select k.wid, k.mon,
         coalesce(tin.tons, 0)            as tons_in,
         coalesce(tout.tons, 0)           as tons_out,
         coalesce(tin.pallets, 0)         as pallets_in,
         coalesce(trips.trips, 0)         as trips,
         coalesce(lab.work_days, 0)       as work_days,
         coalesce(lab.headcount, 0)       as headcount,
         coalesce(lab.leave_days, 0)      as leave_days,
         coalesce(lab.ot_hours, 0)        as ot_hours,
         coalesce(lab.early_hours, 0)     as early_hours,
         coalesce(tin.lines_no_weight, 0) + coalesce(tout.lines_no_weight, 0) as lines_no_weight
  from (
    select wid, mon from tin
    union select wid, mon from tout
    union select wid, mon from trips
    union select wid, mon from lab
  ) k
  left join tin   on tin.wid = k.wid   and tin.mon = k.mon
  left join tout  on tout.wid = k.wid  and tout.mon = k.mon
  left join trips on trips.wid = k.wid and trips.mon = k.mon
  left join lab   on lab.wid = k.wid   and lab.mon = k.mon
  where k.wid is not null
),
per_wh as (
  select w.id                                  as warehouse_id,
         w.name                                as warehouse_name,
         coalesce(sum(c.tons_in), 0)           as tons_in,
         coalesce(sum(c.tons_out), 0)          as tons_out,
         coalesce(sum(c.pallets_in), 0)        as pallets_in,
         coalesce(sum(c.trips), 0)             as trips,
         coalesce(sum(c.work_days), 0)         as work_days,
         coalesce(max(c.headcount), 0)         as headcount,
         coalesce(sum(c.leave_days), 0)        as leave_days,
         coalesce(sum(c.ot_hours), 0)          as ot_hours,
         coalesce(sum(c.early_hours), 0)       as early_hours,
         coalesce(sum(c.lines_no_weight), 0)   as lines_no_weight,
         coalesce(max(co.amount), 0)           as cost_own,
         coalesce(max(co.labor), 0)            as cost_labor_own
  from wh w
  left join cell c    on c.wid = w.id
  left join cost_own co on co.wid = w.id
  group by w.id, w.name
),
per_mon as (
  select c.mon                          as month,
         sum(c.tons_in)                 as tons_in,
         sum(c.tons_out)                as tons_out,
         sum(c.trips)                   as trips,
         sum(c.work_days)               as work_days,
         sum(c.ot_hours)                as ot_hours,
         sum(c.early_hours)             as early_hours
  from cell c
  join wh w on w.id = c.wid
  group by c.mon
)
select jsonb_build_object(
  'from',       p_from,
  'to',         p_to,
  'std_hours',  p_std_hours,
  'categories_filtered', (p_categories is not null),
  'cost_prorated', coalesce((select bool_or(partial) from cost_raw), false),
  'cost_shared',   round(coalesce((select amount from cost_shared), 0)::numeric, 0),
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'warehouse_id',    r.warehouse_id,
      'warehouse_name',  r.warehouse_name,
      'tons_in',         round(r.tons_in::numeric, 3),
      'tons_out',        round(r.tons_out::numeric, 3),
      'tons',            round((r.tons_in + r.tons_out)::numeric, 3),
      'pallets_in',      r.pallets_in,
      'trips',           r.trips,
      'work_days',       r.work_days,
      'work_hours',      round((r.work_days * p_std_hours + r.ot_hours - r.early_hours)::numeric, 2),
      'ot_hours',        round(r.ot_hours::numeric, 2),
      'early_hours',     round(r.early_hours::numeric, 2),
      'leave_days',      r.leave_days,
      'headcount',       r.headcount,
      'lines_no_weight', r.lines_no_weight,
      -- CHI PHÍ RIÊNG của kho — KHÔNG gánh phần chung (xem ghi chú đầu file)
      'cost',            round(r.cost_own::numeric, 0),
      'cost_own',        round(r.cost_own::numeric, 0),
      'cost_labor',      round(r.cost_labor_own::numeric, 0)
    ) order by (r.tons_in + r.tons_out) desc, r.warehouse_name)
    from per_wh r), '[]'::jsonb),
  'by_month', coalesce((
    select jsonb_agg(jsonb_build_object(
      'month',      to_char(p.month, 'YYYY-MM'),
      'tons_in',    round(p.tons_in::numeric, 3),
      'tons_out',   round(p.tons_out::numeric, 3),
      'tons',       round((p.tons_in + p.tons_out)::numeric, 3),
      'trips',      p.trips,
      'work_days',  p.work_days,
      'work_hours', round((p.work_days * p_std_hours + p.ot_hours - p.early_hours)::numeric, 2),
      'ot_hours',   round(p.ot_hours::numeric, 2)
    ) order by p.month)
    from per_mon p), '[]'::jsonb),
  'totals', (
    select jsonb_build_object(
      'tons_in',         round(coalesce(sum(r.tons_in), 0)::numeric, 3),
      'tons_out',        round(coalesce(sum(r.tons_out), 0)::numeric, 3),
      'tons',            round(coalesce(sum(r.tons_in + r.tons_out), 0)::numeric, 3),
      'pallets_in',      coalesce(sum(r.pallets_in), 0),
      'trips',           coalesce(sum(r.trips), 0),
      'work_days',       coalesce(sum(r.work_days), 0),
      'work_hours',      round(coalesce(sum(r.work_days * p_std_hours + r.ot_hours - r.early_hours), 0)::numeric, 2),
      'ot_hours',        round(coalesce(sum(r.ot_hours), 0)::numeric, 2),
      'early_hours',     round(coalesce(sum(r.early_hours), 0)::numeric, 2),
      'leave_days',      coalesce(sum(r.leave_days), 0),
      'headcount',       coalesce(sum(r.headcount), 0),
      'lines_no_weight', coalesce(sum(r.lines_no_weight), 0),
      -- Tổng = Σ chi phí riêng các kho + chi phí CHUNG (ô tổng nói rõ "gồm N chi phí chung")
      'cost',            round(coalesce(sum(r.cost_own), 0)::numeric + coalesce((select amount from cost_shared), 0)::numeric, 0),
      'cost_labor',      round(coalesce(sum(r.cost_labor_own), 0)::numeric + coalesce((select labor from cost_shared), 0)::numeric, 0),
      'warehouses_no_labor', coalesce(count(*) filter (where r.work_days = 0 and (r.tons_in + r.tons_out) > 0), 0),
      'warehouses_no_cost',  coalesce(count(*) filter (where r.cost_own = 0 and (r.tons_in + r.tons_out) > 0), 0)
    ) from per_wh r)
);
$function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260827d_shared_cost_only_when_unfiltered.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260827d — CHI PHÍ CHUNG chỉ cộng vào tổng khi đang xem TOÀN BỘ (không lọc kho / không bị scope).
--
-- Bắt được trong lượt check-app 27/08 bằng một VAI THẬT (kế toán chỉ được gán Kho Ba Vì):
--   · Trang Chi phí kho  → 1.063.200.000  (đúng: sổ CẮT dòng chi phí chung khỏi người bị giới hạn kho)
--   · Tab Năng suất      → 1.304.200.000  (sai: cộng TRỌN 241.000.000 chi phí chung toàn công ty)
-- Hai màn hình cùng một kỳ lệch nhau 241 triệu ⇒ (a) người xem tưởng một trong hai màn hỏng,
-- (b) chi phí/tấn của kho bị thổi lên, (c) người chỉ quản 1 kho đọc được con số cấp CÔNG TY.
--
-- Luật chốt: chi phí `warehouse_id IS NULL` (CHUNG) là số CẤP CÔNG TY, không phân bổ được cho kho
-- nào (đã bỏ phân bổ ở 20260827c) ⇒ chỉ có nghĩa khi đang nhìn toàn bộ. Lọc 1 kho — dù do người
-- dùng tự chọn hay do quyền cắt — thì ô tổng chỉ mang tiền RIÊNG của (các) kho đang xem, và
-- `cost_shared` trả 0 nên màn hình cũng thôi hiện dòng "gồm N chi phí chung".
--
-- Chỉ đổi ĐÚNG mệnh đề lọc của cost_raw; phần còn lại giữ nguyên bản 20260827c.

CREATE OR REPLACE FUNCTION public.warehouse_productivity(
  p_warehouse_ids text[]  DEFAULT NULL::text[],
  p_categories    text[]  DEFAULT NULL::text[],
  p_from          date    DEFAULT NULL::date,
  p_to            date    DEFAULT NULL::date,
  p_std_hours     numeric DEFAULT 8
) RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
with
wh as (
  select w.id, w.name
  from "Warehouse" w
  where (p_warehouse_ids is null or w.id = any(p_warehouse_ids))
),
tin as (
  select ie.warehouse_id::text                        as wid,
         date_trunc('month', ie.import_date)::date    as mon,
         sum(case when coalesce(m.weight_kg,0) > 0
                  then ie.cartons_imported
                       / (case when coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)
                       * m.weight_kg
                  else 0 end) / 1000.0                as tons,
         count(*)                                     as pallets,
         count(*) filter (where coalesce(m.weight_kg,0) <= 0) as lines_no_weight
  from "InventoryEntry" ie
  left join "Material" m on m.id = ie.material_id
  where ie.import_date >= p_from and ie.import_date < (p_to + 1)
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by 1, 2
),
tout as (
  select g.warehouse_id::text                         as wid,
         date_trunc('month', g.delivery_date)::date   as mon,
         sum(case when coalesce(m.weight_kg,0) > 0
                  then oi.cartons_scanned
                       / (case when coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end)
                       * m.weight_kg
                  else 0 end) / 1000.0                as tons,
         count(*) filter (where coalesce(m.weight_kg,0) <= 0 and coalesce(oi.cartons_scanned,0) > 0) as lines_no_weight
  from "GroupDeliveryOrder" g
  join "OutboundDelivery" d on d.gdo_id = g.id
  join "OutboundItem" oi    on oi.do_id = d.id
  left join "Material" m    on m.id = oi.material_id
  where g.delivery_date between p_from and p_to
    and coalesce(g.status, '') <> 'CANCELLED'
    and (p_warehouse_ids is null or g.warehouse_id::text = any(p_warehouse_ids))
    and (p_categories is null or m.category is null or m.category = any(p_categories))
  group by 1, 2
),
trips as (
  select g.warehouse_id::text                         as wid,
         date_trunc('month', g.delivery_date)::date   as mon,
         count(*)                                     as trips
  from "GroupDeliveryOrder" g
  where g.delivery_date between p_from and p_to
    and g.status = 'COMPLETED'
    and (p_warehouse_ids is null or g.warehouse_id::text = any(p_warehouse_ids))
  group by 1, 2
),
lab as (
  select coalesce(a.warehouse_id, e.warehouse_id)::text as wid,
         date_trunc('month', a.work_date)::date         as mon,
         count(*) filter (where a.kind in ('CA1','CA2','CA3','HC'))                      as work_days,
         count(distinct a.employee_id) filter (where a.kind in ('CA1','CA2','CA3','HC')) as headcount,
         count(*) filter (where a.kind = 'LEAVE')                                        as leave_days,
         coalesce(sum(a.ot_hours), 0)                                                    as ot_hours,
         coalesce(sum(a.early_leave_hours), 0)                                           as early_hours
  from "Attendance" a
  left join "Employee" e on e.id = a.employee_id
  where a.work_date between p_from and p_to
    and (p_warehouse_ids is null or coalesce(a.warehouse_id, e.warehouse_id)::text = any(p_warehouse_ids))
  group by 1, 2
),
-- Chi phí: tỷ lệ ngày của THÁNG nằm trong khoảng đang xem (khoảng tròn tháng ⇒ frac = 1).
-- ⚠️ Dòng CHUNG (warehouse_id null) CHỈ lấy khi p_warehouse_ids IS NULL — xem ghi chú đầu file.
cost_raw as (
  select wc.warehouse_id                                     as wid,
         wc.amount * (
           greatest(0, (least(p_to, (wc.period + interval '1 month - 1 day')::date)
                        - greatest(p_from, wc.period) + 1))::numeric
           / extract(day from (wc.period + interval '1 month - 1 day'))::numeric
         )                                                   as amount,
         coalesce((li.meta->>'is_labor')::boolean, false)     as is_labor,
         (greatest(p_from, wc.period) > wc.period
          or least(p_to, (wc.period + interval '1 month - 1 day')::date) < (wc.period + interval '1 month - 1 day')::date) as partial
  from public.warehouse_costs wc
  left join "LookupValue" li on li.type = 'cost_item' and li.value = wc.cost_item
  where wc.period between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
    and (case when wc.warehouse_id is null
              then p_warehouse_ids is null
              else p_warehouse_ids is null or wc.warehouse_id = any(p_warehouse_ids) end)
),
cost_own as (
  select wid, sum(amount) as amount, sum(amount) filter (where is_labor) as labor
  from cost_raw where wid is not null group by wid
),
cost_shared as (
  select coalesce(sum(amount), 0) as amount, coalesce(sum(amount) filter (where is_labor), 0) as labor
  from cost_raw where wid is null
),
cell as (
  select k.wid, k.mon,
         coalesce(tin.tons, 0)            as tons_in,
         coalesce(tout.tons, 0)           as tons_out,
         coalesce(tin.pallets, 0)         as pallets_in,
         coalesce(trips.trips, 0)         as trips,
         coalesce(lab.work_days, 0)       as work_days,
         coalesce(lab.headcount, 0)       as headcount,
         coalesce(lab.leave_days, 0)      as leave_days,
         coalesce(lab.ot_hours, 0)        as ot_hours,
         coalesce(lab.early_hours, 0)     as early_hours,
         coalesce(tin.lines_no_weight, 0) + coalesce(tout.lines_no_weight, 0) as lines_no_weight
  from (
    select wid, mon from tin
    union select wid, mon from tout
    union select wid, mon from trips
    union select wid, mon from lab
  ) k
  left join tin   on tin.wid = k.wid   and tin.mon = k.mon
  left join tout  on tout.wid = k.wid  and tout.mon = k.mon
  left join trips on trips.wid = k.wid and trips.mon = k.mon
  left join lab   on lab.wid = k.wid   and lab.mon = k.mon
  where k.wid is not null
),
per_wh as (
  select w.id                                  as warehouse_id,
         w.name                                as warehouse_name,
         coalesce(sum(c.tons_in), 0)           as tons_in,
         coalesce(sum(c.tons_out), 0)          as tons_out,
         coalesce(sum(c.pallets_in), 0)        as pallets_in,
         coalesce(sum(c.trips), 0)             as trips,
         coalesce(sum(c.work_days), 0)         as work_days,
         coalesce(max(c.headcount), 0)         as headcount,
         coalesce(sum(c.leave_days), 0)        as leave_days,
         coalesce(sum(c.ot_hours), 0)          as ot_hours,
         coalesce(sum(c.early_hours), 0)       as early_hours,
         coalesce(sum(c.lines_no_weight), 0)   as lines_no_weight,
         coalesce(max(co.amount), 0)           as cost_own,
         coalesce(max(co.labor), 0)            as cost_labor_own
  from wh w
  left join cell c    on c.wid = w.id
  left join cost_own co on co.wid = w.id
  group by w.id, w.name
),
per_mon as (
  select c.mon                          as month,
         sum(c.tons_in)                 as tons_in,
         sum(c.tons_out)                as tons_out,
         sum(c.trips)                   as trips,
         sum(c.work_days)               as work_days,
         sum(c.ot_hours)                as ot_hours,
         sum(c.early_hours)             as early_hours
  from cell c
  join wh w on w.id = c.wid
  group by c.mon
)
select jsonb_build_object(
  'from',       p_from,
  'to',         p_to,
  'std_hours',  p_std_hours,
  'categories_filtered', (p_categories is not null),
  'cost_prorated', coalesce((select bool_or(partial) from cost_raw), false),
  'cost_shared',   round(coalesce((select amount from cost_shared), 0)::numeric, 0),
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'warehouse_id',    r.warehouse_id,
      'warehouse_name',  r.warehouse_name,
      'tons_in',         round(r.tons_in::numeric, 3),
      'tons_out',        round(r.tons_out::numeric, 3),
      'tons',            round((r.tons_in + r.tons_out)::numeric, 3),
      'pallets_in',      r.pallets_in,
      'trips',           r.trips,
      'work_days',       r.work_days,
      'work_hours',      round((r.work_days * p_std_hours + r.ot_hours - r.early_hours)::numeric, 2),
      'ot_hours',        round(r.ot_hours::numeric, 2),
      'early_hours',     round(r.early_hours::numeric, 2),
      'leave_days',      r.leave_days,
      'headcount',       r.headcount,
      'lines_no_weight', r.lines_no_weight,
      'cost',            round(r.cost_own::numeric, 0),
      'cost_own',        round(r.cost_own::numeric, 0),
      'cost_labor',      round(r.cost_labor_own::numeric, 0)
    ) order by (r.tons_in + r.tons_out) desc, r.warehouse_name)
    from per_wh r), '[]'::jsonb),
  'by_month', coalesce((
    select jsonb_agg(jsonb_build_object(
      'month',      to_char(p.month, 'YYYY-MM'),
      'tons_in',    round(p.tons_in::numeric, 3),
      'tons_out',   round(p.tons_out::numeric, 3),
      'tons',       round((p.tons_in + p.tons_out)::numeric, 3),
      'trips',      p.trips,
      'work_days',  p.work_days,
      'work_hours', round((p.work_days * p_std_hours + p.ot_hours - p.early_hours)::numeric, 2),
      'ot_hours',   round(p.ot_hours::numeric, 2)
    ) order by p.month)
    from per_mon p), '[]'::jsonb),
  'totals', (
    select jsonb_build_object(
      'tons_in',         round(coalesce(sum(r.tons_in), 0)::numeric, 3),
      'tons_out',        round(coalesce(sum(r.tons_out), 0)::numeric, 3),
      'tons',            round(coalesce(sum(r.tons_in + r.tons_out), 0)::numeric, 3),
      'pallets_in',      coalesce(sum(r.pallets_in), 0),
      'trips',           coalesce(sum(r.trips), 0),
      'work_days',       coalesce(sum(r.work_days), 0),
      'work_hours',      round(coalesce(sum(r.work_days * p_std_hours + r.ot_hours - r.early_hours), 0)::numeric, 2),
      'ot_hours',        round(coalesce(sum(r.ot_hours), 0)::numeric, 2),
      'early_hours',     round(coalesce(sum(r.early_hours), 0)::numeric, 2),
      'leave_days',      coalesce(sum(r.leave_days), 0),
      'headcount',       coalesce(sum(r.headcount), 0),
      'lines_no_weight', coalesce(sum(r.lines_no_weight), 0),
      'cost',            round(coalesce(sum(r.cost_own), 0)::numeric + coalesce((select amount from cost_shared), 0)::numeric, 0),
      'cost_labor',      round(coalesce(sum(r.cost_labor_own), 0)::numeric + coalesce((select labor from cost_shared), 0)::numeric, 0),
      'warehouses_no_labor', coalesce(count(*) filter (where r.work_days = 0 and (r.tons_in + r.tons_out) > 0), 0),
      'warehouses_no_cost',  coalesce(count(*) filter (where r.cost_own = 0 and (r.tons_in + r.tons_out) > 0), 0)
    ) from per_wh r)
);
$function$;


COMMIT;
-- === HẾT PART 2/10 ===
