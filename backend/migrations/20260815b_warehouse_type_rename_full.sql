-- ============================================================================
-- ĐỔI TÊN Loại kho: PHỦ ĐỦ MỌI CỘT + RPC GÁC không cho sót lần sau  (15/08/2026)
-- ----------------------------------------------------------------------------
-- VÌ SAO: `rename_warehouse_type` cascade 15 bảng theo bản đồ "14 chỗ" ghi tay hồi
-- 27/07. Quét SỐNG toàn bộ 603 cột text/text[] của DB production 15/08 ra 18 cột
-- đang mang giá trị Loại kho ⇒ RPC BỎ SÓT 2 cột có dữ liệu thật:
--     • OutboundItem.material_type  (280 dòng) — gán thẳng từ Material.category
--       (outboundController createGDO/upload/patch: `material_type = matInfo?.category`)
--     • alert_events.category        (14 dòng) — gán từ warehouse_type của chuyến/tồn
--       (alertScanner: `category: g.warehouse_type`)
-- Sót = đổi tên xong 294 dòng trỏ vào loại KHÔNG CÒN TỒN TẠI, không lỗi, không cảnh
-- báo — đúng họ lỗi "vô hình" của cột snapshot.
--
-- KHÔNG đưa vào cascade (có lý do, whitelist trong RPC gác bên dưới):
--     • LookupValue.value        — CHÍNH danh mục, hàm đã tự UPDATE ở đầu
--     • Material.product_type    — nhãn "Loại SP" người dùng tự gõ khi upload Mã hàng;
--       trùng chữ 'POSM' nhưng KHÁC NGHĨA với Loại kho. Đổi nó là sửa dữ liệu người dùng.
--     • x_bak_* / bak_*          — bảng sao lưu, cố ý đóng băng nguyên trạng
--
-- LUẬT "bug chết hai lần": sửa RPC (1) + RPC gác `warehouse_type_column_coverage`
-- vào gói QA 00-invariant (2) ⇒ thêm cột mới mang Loại kho mà quên cascade = QA ĐỎ.
-- CÁCH CHẠY: Supabase Dashboard → SQL Editor → dán → Run. Apply CẢ staging LẪN production.
-- ============================================================================

BEGIN;

-- ── 1) rename_warehouse_type: 15 bảng → 17 bảng ─────────────────────────────
CREATE OR REPLACE FUNCTION public.rename_warehouse_type(p_old text, p_new text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  counts jsonb := '{}'::jsonb;
  n bigint;
BEGIN
  p_new := btrim(p_new);
  IF p_old IS NULL OR p_new IS NULL OR p_new = '' OR p_old = p_new THEN
    RAISE EXCEPTION 'Tên mới không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = p_old) THEN
    RAISE EXCEPTION 'Loại kho "%" không tồn tại', p_old USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = p_new) THEN
    RAISE EXCEPTION 'Loại kho "%" đã tồn tại', p_new USING ERRCODE = '23505';
  END IF;

  UPDATE "LookupValue" SET value = p_new, updated_at = now()
    WHERE type = 'warehouse_type' AND value = p_old;

  UPDATE "Material" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Material', n);

  -- MẢNG (multi-loại 27/07): Location / WarehouseZone / StocktakeLog
  UPDATE "Location" SET categories = array_replace(categories, p_old, p_new)
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Location', n);

  UPDATE "WarehouseZone" SET categories = array_replace(categories, p_old, p_new)
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('WarehouseZone', n);

  UPDATE "StocktakeLog" SET categories = array_replace(categories, p_old, p_new), updated_at = now()
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('StocktakeLog', n);

  UPDATE "Employee" SET allowed_categories = array_replace(allowed_categories, p_old, p_new)
    WHERE p_old = ANY(allowed_categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Employee', n);

  UPDATE "Warehouse" SET carton_scan_categories = array_replace(carton_scan_categories, p_old, p_new)
    WHERE p_old = ANY(carton_scan_categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Warehouse', n);

  UPDATE "SlotTemplate" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('SlotTemplate', n);

  UPDATE "DeliverySlot" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('DeliverySlot', n);

  UPDATE "TmsOrder" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('TmsOrder', n);

  -- Cửa đặt lịch (03/08) — giá trị ĐƠN, tách khỏi luật giao ≥1 nhưng vẫn là Loại kho
  UPDATE "TmsOrder" SET booking_category = p_new WHERE booking_category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('TmsOrder.booking_category', n);

  UPDATE khvc_lines SET booking_category = p_new WHERE booking_category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('khvc_lines', n);

  -- Chuyến chở lẫn: thay ĐÚNG phần tử trong chuỗi ghép (DISTINCT phòng khi ghép ra trùng)
  UPDATE "GroupDeliveryOrder"
     SET warehouse_type = (SELECT string_agg(DISTINCT c, '+')
                             FROM unnest(array_replace(wt_cats(warehouse_type), p_old, p_new)) c)
   WHERE wt_cats(warehouse_type) @> ARRAY[p_old];
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('GroupDeliveryOrder', n);

  -- ⭐ MỚI 15/08 — snapshot Loại kho trên DÒNG ĐƠN XUẤT (= Material.category lúc tạo)
  UPDATE "OutboundItem" SET material_type = p_new WHERE material_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('OutboundItem', n);

  -- ⭐ MỚI 15/08 — snapshot Loại kho trong cảnh báo vận hành
  UPDATE alert_events SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('alert_events', n);

  UPDATE gate_registrations SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('gate_registrations', n);

  UPDATE inbound_plan_lines SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('inbound_plan_lines', n);

  UPDATE "ProductionImport" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('ProductionImport', n);

  UPDATE "PalletLabelPrint" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('PalletLabelPrint', n);

  RETURN counts;
END;
$function$;

-- ── 2) RPC GÁC — quét SỐNG mọi cột, trả về cột nào mang Loại kho mà cascade bỏ sót ──
--    Trả 0 dòng = phủ đủ. Gói QA 00-invariant gọi hàm này.
CREATE OR REPLACE FUNCTION public.warehouse_type_column_coverage()
 RETURNS TABLE(tbl text, col text, n bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  vals text[];
  def  text;
  r    record;
  cnt  bigint;
BEGIN
  SELECT array_agg(value) INTO vals FROM "LookupValue" WHERE type = 'warehouse_type';
  IF vals IS NULL OR array_length(vals, 1) = 0 THEN RETURN; END IF;

  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'rename_warehouse_type';
  IF def IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy rename_warehouse_type — không kiểm được độ phủ';
  END IF;

  FOR r IN
    SELECT c.table_name t, c.column_name cl, c.data_type dt
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
     WHERE c.table_schema = 'public' AND tb.table_type = 'BASE TABLE'
       AND (c.data_type IN ('text', 'character varying')
            OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text', '_varchar')))
       -- MIỄN TRỪ (lý do ở đầu file): bảng sao lưu đóng băng · sổ migration ·
       -- chính danh mục · "Loại SP" người dùng tự gõ (trùng chữ, khác nghĩa) ·
       -- MÃ KHU / mã khu con do người dùng ĐẶT TAY (staging có khu code 'PK01'="Kho Bao Bì",
       -- 'RM01'="Kho NL", cùng dãy với TP1/MNVL/SCA1) — trùng chữ chứ không phải Loại kho
       AND c.table_name NOT LIKE 'x\_bak\_%' AND c.table_name NOT LIKE 'bak\_%'
       AND c.table_name <> '_prisma_migrations'
       AND NOT (c.table_name = 'LookupValue'   AND c.column_name = 'value')
       AND NOT (c.table_name = 'Material'      AND c.column_name = 'product_type')
       AND NOT (c.table_name = 'WarehouseZone' AND c.column_name = 'code')
       AND NOT (c.table_name = 'Location'      AND c.column_name = 'sub_code')
  LOOP
    -- Cột đã nằm trong cascade thì khỏi quét (nhanh + khỏi báo oan)
    CONTINUE WHEN def ~ format('UPDATE\s+"?%s"?\s+SET[^;]*%s', r.t, r.cl);

    EXECUTE CASE WHEN r.dt = 'ARRAY'
      THEN format('SELECT count(*) FROM %I WHERE %I && $1', r.t, r.cl)
      ELSE format('SELECT count(*) FROM %I WHERE %I IS NOT NULL AND string_to_array(%I, ''+'') && $1', r.t, r.cl, r.cl)
    END INTO cnt USING vals;

    IF cnt > 0 THEN
      tbl := r.t; col := r.cl; n := cnt; RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

COMMIT;

-- ============================================================================
-- KIỂM SAU KHI CHẠY
--   SELECT * FROM warehouse_type_column_coverage();          -- phải 0 dòng
--   -- round-trip (an toàn, tự trả về trạng thái cũ):
--   SELECT rename_warehouse_type('FG01','ZZTMP');
--   SELECT rename_warehouse_type('ZZTMP','FG01');
-- ============================================================================
