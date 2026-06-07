-- Backfill GDO group_code: ddmmyy_Kho_NN → warehouseCode_X_ddmmyy_stt
-- Backfill TRF order_code: TRFyymmdd_srcWh_xxx → TRF_destWh_newGroupCode

-- Step 1: Update GDO group_code
-- Xử lý mọi dạng cũ bắt đầu bằng 6 chữ số (vd: 060626_ĐT_01, 110526_BV_P01)
WITH ranked AS (
  SELECT
    g.id,
    COALESCE(w.code::text, 'XX')    AS wh_code,
    substring(g.group_code, 1, 6)   AS ddmmyy,
    ROW_NUMBER() OVER (
      PARTITION BY g.warehouse_id, substring(g.group_code, 1, 6)
      ORDER BY COALESCE(
        NULLIF(
          regexp_replace(
            regexp_replace(g.group_code, '^.*_', ''),
            '[^\d]', '', 'g'
          ),
          ''
        ),
        '0'
      )::int
    ) AS stt
  FROM "GroupDeliveryOrder" g
  LEFT JOIN "Warehouse" w ON w.id = g.warehouse_id
  WHERE g.group_code ~ '^\d{6}_'
)
UPDATE "GroupDeliveryOrder" g
SET
  group_code = r.wh_code || '_X_' || r.ddmmyy || '_' || LPAD(r.stt::text, 2, '0'),
  updated_at = NOW()
FROM ranked r
WHERE g.id = r.id;

-- Step 2: Update TRF order_code (sau khi GDO đã được cập nhật)
UPDATE "TmsOrder" o
SET
  order_code = 'TRF_' || dw.code::text || '_' || g.group_code,
  updated_at = NOW()
FROM "GroupDeliveryOrder" g, "Warehouse" dw
WHERE dw.id = o.destination_warehouse_id
  AND o.source_type = 'TRANSFER'
  AND o.transfer_gdo_id = g.id
  AND o.order_code ~ '^TRF\d{6}_';
