-- Chuẩn upload đa-user (user chốt 25/07): dọn di sản trùng + 2 UNIQUE INDEX chống đua.
-- Upload KH nhập upsert theo key (Ngày+Kho+NCC+Mã hàng) — JS check không đỡ được 2 người ghi
-- cùng mili-giây → DB phải là chốt chặn cuối. PG17 có NULLS NOT DISTINCT (ncc_id nullable).
-- Idempotent: chạy lại không phá (backup CREATE IF NOT EXISTS, gộp chỉ chạy khi còn trùng).

BEGIN;

-- ── 1) BACKUP dòng KH thuộc key trùng (ACTIVE, có mã hàng) ──────────────────
CREATE TABLE IF NOT EXISTS x_bak_plan_dup_20260725 AS
SELECT l.* FROM inbound_plan_lines l
JOIN (
  SELECT date, warehouse_id, ncc_id, material_id
  FROM inbound_plan_lines
  WHERE status <> 'CANCELLED' AND material_id IS NOT NULL
  GROUP BY 1,2,3,4 HAVING COUNT(*) > 1
) d ON l.date = d.date AND l.warehouse_id = d.warehouse_id
   AND l.ncc_id IS NOT DISTINCT FROM d.ncc_id AND l.material_id = d.material_id
WHERE l.status <> 'CANCELLED';

-- ── 2) GỘP dòng trùng key: giữ dòng CŨ NHẤT (cộng SL, nối PO), xóa dòng thừa ─
WITH ranked AS (
  SELECT id, date, warehouse_id, ncc_id, material_id,
         ROW_NUMBER() OVER (PARTITION BY date, warehouse_id, ncc_id, material_id ORDER BY created_at, id) rn
  FROM inbound_plan_lines
  WHERE status <> 'CANCELLED' AND material_id IS NOT NULL
), agg AS (
  SELECT l.date, l.warehouse_id, l.ncc_id, l.material_id,
         SUM(l.planned_boxes) boxes, SUM(l.planned_pallets) pallets,
         STRING_AGG(DISTINCT l.po_number, ', ') FILTER (WHERE l.po_number IS NOT NULL) pos
  FROM inbound_plan_lines l
  WHERE l.status <> 'CANCELLED' AND l.material_id IS NOT NULL
  GROUP BY 1,2,3,4 HAVING COUNT(*) > 1
)
UPDATE inbound_plan_lines l
SET planned_boxes = a.boxes, planned_pallets = a.pallets, po_number = a.pos, updated_at = NOW()
FROM ranked r
JOIN agg a ON r.date = a.date AND r.warehouse_id = a.warehouse_id
          AND r.ncc_id IS NOT DISTINCT FROM a.ncc_id AND r.material_id = a.material_id
WHERE l.id = r.id AND r.rn = 1;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY date, warehouse_id, ncc_id, material_id ORDER BY created_at, id) rn
  FROM inbound_plan_lines
  WHERE status <> 'CANCELLED' AND material_id IS NOT NULL
)
DELETE FROM inbound_plan_lines l USING ranked r WHERE l.id = r.id AND r.rn > 1;

-- ── 3) LỆNH INBOUND trùng nhóm: backup → dời dòng KH về lệnh CŨ NHẤT → hủy lệnh thừa ─
CREATE TABLE IF NOT EXISTS x_bak_order_dup_20260725 AS
SELECT o.* FROM "TmsOrder" o
JOIN (
  SELECT date, warehouse_id, warehouse_type, vehicle_type, ncc_id
  FROM "TmsOrder" WHERE direction = 'INBOUND' AND status <> 'CANCELLED'
  GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1
) d ON o.date = d.date AND o.warehouse_id = d.warehouse_id
   AND o.warehouse_type IS NOT DISTINCT FROM d.warehouse_type
   AND o.vehicle_type   IS NOT DISTINCT FROM d.vehicle_type
   AND o.ncc_id         IS NOT DISTINCT FROM d.ncc_id
WHERE o.direction = 'INBOUND' AND o.status <> 'CANCELLED';

WITH ranked AS (
  SELECT id, date, warehouse_id, warehouse_type, vehicle_type, ncc_id,
         ROW_NUMBER() OVER (PARTITION BY date, warehouse_id, warehouse_type, vehicle_type, ncc_id ORDER BY created_at, id) rn,
         FIRST_VALUE(id) OVER (PARTITION BY date, warehouse_id, warehouse_type, vehicle_type, ncc_id ORDER BY created_at, id) keeper_id
  FROM "TmsOrder" WHERE direction = 'INBOUND' AND status <> 'CANCELLED'
)
UPDATE inbound_plan_lines l
SET tms_order_id = r.keeper_id, updated_at = NOW()
FROM ranked r
WHERE l.tms_order_id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY date, warehouse_id, warehouse_type, vehicle_type, ncc_id ORDER BY created_at, id) rn
  FROM "TmsOrder" WHERE direction = 'INBOUND' AND status <> 'CANCELLED'
)
UPDATE "TmsOrder" o SET status = 'CANCELLED', updated_at = NOW()
FROM ranked r WHERE o.id = r.id AND r.rn > 1;

-- ── 4) Recalc cache lệnh bị ảnh hưởng (mirror qtyEntryDecimal: base/upc khi có entry) ─
UPDATE "TmsOrder" o
SET planned_boxes = s.boxes, planned_pallets = s.pallets, updated_at = NOW()
FROM (
  SELECT l.tms_order_id,
         SUM(CASE WHEN m.entry_unit IS NOT NULL AND COALESCE(m.units_per_carton, 0) > 0
                  THEN l.planned_boxes::numeric / m.units_per_carton
                  ELSE l.planned_boxes END) boxes,
         SUM(l.planned_pallets) pallets
  FROM inbound_plan_lines l
  LEFT JOIN "Material" m ON m.id = l.material_id
  WHERE l.status <> 'CANCELLED'
  GROUP BY 1
) s
WHERE o.id = s.tms_order_id
  AND o.id IN (
    SELECT DISTINCT tms_order_id FROM x_bak_plan_dup_20260725 WHERE tms_order_id IS NOT NULL
    UNION SELECT id FROM x_bak_order_dup_20260725
  );

-- ── 5) Gác an toàn: còn trùng (vd lệnh dup không hủy được) → FAIL rõ, không tạo index mù ─
DO $$
DECLARE n1 int; n2 int;
BEGIN
  SELECT COUNT(*) INTO n1 FROM (
    SELECT 1 FROM inbound_plan_lines WHERE status <> 'CANCELLED' AND material_id IS NOT NULL
    GROUP BY date, warehouse_id, ncc_id, material_id HAVING COUNT(*) > 1) t;
  SELECT COUNT(*) INTO n2 FROM (
    SELECT 1 FROM "TmsOrder" WHERE direction = 'INBOUND' AND status <> 'CANCELLED'
    GROUP BY date, warehouse_id, warehouse_type, vehicle_type, ncc_id HAVING COUNT(*) > 1) t;
  IF n1 > 0 OR n2 > 0 THEN
    RAISE EXCEPTION 'Còn trùng sau dọn: % key dòng KH, % nhóm lệnh — kiểm tay rồi chạy lại', n1, n2;
  END IF;
END $$;

-- ── 6) UNIQUE INDEX chống đua (partial: chỉ dòng/lệnh sống) ─────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_plan_line_active_key
  ON inbound_plan_lines (date, warehouse_id, ncc_id, material_id) NULLS NOT DISTINCT
  WHERE status <> 'CANCELLED' AND material_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tms_order_inbound_group
  ON "TmsOrder" (date, warehouse_id, warehouse_type, vehicle_type, ncc_id) NULLS NOT DISTINCT
  WHERE direction = 'INBOUND' AND status <> 'CANCELLED';

COMMIT;
