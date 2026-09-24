-- ============================================================================
-- 20260922c — Hai vi phạm bất biến gói 00 do đợt 0 ZSD02 (20260922) để lại  (22/09/2026)
-- ----------------------------------------------------------------------------
-- Bậc fast chạy SAU khi áp 20260922 lên staging bắt ra hai điều mà bậc offline không thấy:
--
-- (1) HAI BẢNG MỚI QUÊN BẬT RLS: `erp_so_lines` + `sap_route`. Hôm nay anon/authenticated đã
--     0 quyền bảng trong public (20260902c) nên chưa đọc được gì, nhưng RLS là lớp thứ hai —
--     bảng nào cũng phải bật (bất biến "Mọi bảng public đều bật RLS", RPC rls_gap_tables).
--
-- (2) `erp_outbound_orders.storage_location` + `erp_so_lines.storage_location` MANG GIÁ TRỊ TRÙNG
--     mã Loại kho (FG01/FG02/PM01) mà không nằm trong cascade `rename_warehouse_type`.
--     KHÔNG đưa vào cascade — đây là mã STORAGE LOCATION THÔ của SAP chép nguyên từ file
--     (cùng bản chất với `Warehouse.sap_storage_locations`, cột KHAI mã SAP để khớp phạm vi kho):
--       • đổi tên Loại kho trong app KHÔNG đổi được mã SAP; lần nạp ZSD02/VL06O kế tiếp lại ghi
--         FG01 vào chính dòng đó ⇒ cascade chỉ tạo dữ liệu lẫn lộn (dòng cũ FGX, dòng mới FG01);
--       • `sapScopeCheck` so `storage_location` với `Warehouse.sap_storage_locations` — hai bên
--         cùng là mã SAP, cùng đứng ngoài cascade thì mới tiếp tục khớp nhau;
--       • cùng lớp với `Material.product_type` đã miễn trừ 15/08 ("trùng chữ nhưng KHÁC NGHĨA").
--     ⇒ Thêm 3 cột mã-SAP-thô vào danh sách miễn trừ của RPC gác `warehouse_type_column_coverage`
--     (`Warehouse.sap_storage_locations` đưa vào luôn dù staging đang rỗng — cùng bản chất, để lúc
--     kho khai Sloc thì phép kiểm không đỏ oan). Thân RPC còn lại giữ nguyên bản 20260815b.
--
-- Vì sao lọt: đợt 0 chỉ chạy cổng OFFLINE trước khi push; bất biến toàn DB (RLS, độ phủ cascade)
-- phải áp migration rồi mới đo được ⇒ sau migration mới PHẢI chạy `--tier fast` đầy đủ.
-- CÁCH CHẠY: Supabase Dashboard → SQL Editor → dán → Run. Apply CẢ staging LẪN production.
-- ============================================================================

BEGIN;

-- ── 1) RLS cho hai bảng mới ─────────────────────────────────────────────────
ALTER TABLE public.erp_so_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sap_route    ENABLE ROW LEVEL SECURITY;

-- ── 2) RPC gác độ phủ cascade: miễn trừ cột mã SAP thô ──────────────────────
CREATE OR REPLACE FUNCTION public.warehouse_type_column_coverage()
 RETURNS TABLE(tbl text, col text, n bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  vals text[];
  def  text;
  r    record;
  hit  boolean;
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
       -- MIỄN TRỪ: như bản cũ (backup đóng băng · sổ migration · danh mục gốc · trùng chữ khác nghĩa)
       AND c.table_name NOT LIKE 'x\_bak\_%' AND c.table_name NOT LIKE 'bak\_%'
       AND c.table_name <> '_prisma_migrations'
       AND c.table_name <> 'x_seed_manifest'
       AND NOT (c.table_name = 'LookupValue'   AND c.column_name = 'value')
       AND NOT (c.table_name = 'Material'      AND c.column_name = 'product_type')
       AND NOT (c.table_name = 'WarehouseZone' AND c.column_name = 'code')
       AND NOT (c.table_name = 'Location'      AND c.column_name = 'sub_code')
       -- MIỄN TRỪ 22/09: mã STORAGE LOCATION THÔ của SAP (chép nguyên từ VL06O/ZSD02, và cột khai
       -- mã SAP theo kho để khớp phạm vi). Trùng chữ với Loại kho vì taxonomy 15/08 lấy theo mã SAP,
       -- nhưng đổi tên Loại kho trong app không đổi được mã SAP — cascade vào đây chỉ làm dữ liệu lẫn.
       AND NOT (c.table_name = 'erp_outbound_orders' AND c.column_name = 'storage_location')
       AND NOT (c.table_name = 'erp_so_lines'        AND c.column_name = 'storage_location')
       AND NOT (c.table_name = 'Warehouse'           AND c.column_name = 'sap_storage_locations')
  LOOP
    CONTINUE WHEN def ~ format('UPDATE\s+"?%s"?\s+SET[^;]*%s', r.t, r.cl);

    -- EXISTS thay count(*): cột CÓ giá trị dừng ở dòng đầu; cột KHÔNG có vẫn phải quét hết nhưng
    -- không còn chi phí gom đếm. n trả 1 (mục đích của phép kiểm là danh sách cột, không phải số dòng).
    EXECUTE CASE WHEN r.dt = 'ARRAY'
      THEN format('SELECT EXISTS(SELECT 1 FROM %I WHERE %I && $1)', r.t, r.cl)
      ELSE format('SELECT EXISTS(SELECT 1 FROM %I WHERE %I IS NOT NULL AND string_to_array(%I, ''+'') && $1)', r.t, r.cl, r.cl)
    END INTO hit USING vals;

    IF hit THEN
      tbl := r.t; col := r.cl; n := 1; RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

-- ── 3) KIỂM ngay trong transaction ──────────────────────────────────────────
DO $$
DECLARE bad int; gaps text;
BEGIN
  SELECT count(*) INTO bad FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN ('erp_so_lines', 'sap_route')
     AND NOT c.relrowsecurity;
  IF bad > 0 THEN RAISE EXCEPTION 'RLS chưa bật trên % bảng', bad; END IF;

  SELECT string_agg(tbl || '.' || col, ', ') INTO gaps FROM warehouse_type_column_coverage();
  IF gaps IS NOT NULL THEN RAISE EXCEPTION 'Cascade đổi tên Loại kho còn sót: %', gaps; END IF;
END $$;

COMMIT;

-- KIỂM SAU KHI CHẠY
--   SELECT * FROM rls_gap_tables();                           -- phải rỗng
--   SELECT * FROM warehouse_type_column_coverage();          -- phải 0 dòng
