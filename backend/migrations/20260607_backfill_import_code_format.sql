-- Backfill ProductionImport import_code:
--   NK-YYYYMMDD-NNN → warehouseCode_N_ddmmyy_stt
-- Đánh số lại theo thứ tự created_at trong cùng warehouse + ngày

WITH ranked AS (
  SELECT
    p.id,
    COALESCE(w.code::text, 'XX') AS wh_code,
    -- import_date dạng YYYY-MM-DD → ddmmyy
    to_char(p.import_date::date, 'DDMMYY') AS ddmmyy,
    ROW_NUMBER() OVER (
      PARTITION BY p.warehouse_id, p.import_date
      ORDER BY p.created_at
    ) AS stt
  FROM "ProductionImport" p
  LEFT JOIN "Warehouse" w ON w.id = p.warehouse_id
  WHERE p.import_code ~ '^NK-'
)
UPDATE "ProductionImport" p
SET
  import_code = r.wh_code || '_N_' || r.ddmmyy || '_' || LPAD(r.stt::text, 2, '0'),
  updated_at  = NOW()
FROM ranked r
WHERE p.id = r.id;
