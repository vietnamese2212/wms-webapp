-- 20260819: RPC chẩn đoán warehouse_type_column_coverage TIMEOUT trên dữ liệu lớn.
-- Staging nay giữ ~150k dòng nghiệp vụ vĩnh viễn (seed 18/08) → count(*) từng cột text của MỌI
-- bảng vượt statement_timeout ⇒ gói QA 00-invariant đỏ oan (57014).
-- Sửa 2 lớp: (1) chỉ cần BIẾT CÓ HAY KHÔNG chứ không cần đếm — EXISTS dừng ở dòng khớp đầu tiên;
-- (2) hàm chẩn đoán chạy 1 lần mỗi lượt QA → cho phép timeout riêng 120s, không đụng timeout role.

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
