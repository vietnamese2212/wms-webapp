-- ═══════════════════════════════════════════════════════════════════════════════
-- PHÂN TRANG SERVER cho list Nhập kho (thay trần cứng 10.000 dòng).
-- Bối cảnh: user xem CẢ THÁNG+ (~500 dòng/ngày ⇒ 15.000+ dòng); FE cũ kéo TOÀN BỘ
-- rồi render + cộng tổng client-side → 22MB payload, không tải nổi. Chốt 27/07:
-- phân trang như Tồn kho + tổng SummaryBand tính bằng SQL trên TOÀN BỘ kết quả lọc.
--
-- ⚠️ BẮT BUỘC plpgsql + SET plan_cache_mode = force_custom_plan (đo thật 27/07 trên
-- 15.000 phiếu / 30.000 pallet): bản LANGUAGE sql bị GENERIC PLAN — không biết giá trị
-- tham số → ước lượng dòng sai trên CTE → nested loop 15k×30k → hàm chạy >300s trong khi
-- thân query chỉ 1,6s. plpgsql + force_custom_plan luôn plan theo GIÁ TRỊ THẬT.
--
-- 3 hàm — WHERE PHẢI GIỮ KHỚP NHAU (page ↔ summary cùng bộ lọc → pager và SummaryBand
-- không lệch; sửa điều kiện ở hàm này thì sửa cả hàm kia):
--   inbound_orders_page(...)    → 1 trang id (thứ tự nhóm-theo-chuyến) + tổng số dòng
--   inbound_orders_summary(...) → tổng SummaryBand + bảng "Vị trí hàng nhập"
--   inbound_orders_facets(...)  → option filter Material / Chu kỳ / Máy (DISTINCT dưới DB)
--
-- Semantics GIỮ NGUYÊN như listOrders + applyClientFilters cũ (FE Inbound.tsx):
--   · p_status null → mọi phiếu trừ CANCELLED
--   · p_category (filter Loại kho UI): warehouse_type = category HOẶC source_type TRANSFER
--   · p_scope_categories (scope loại của user; CHỈ áp khi p_category null):
--     warehouse_type ∈ scope HOẶC TRANSFER (chuyển kho luôn hiện)
--   · TRANSFER được MIỄN filter Chu kỳ / Máy / Ca (applyClientFilters cũ cũng miễn)
--   · p_importer_ids = Employee.id đã resolve từ tên ở Node:
--     imported_by ∈ ids HOẶC (imported_by IS NULL VÀ created_by ∈ ids)
--     (mirror FE: importerName = imported_by_emp?.name ?? created_by_emp?.name)
--   · search: import_code ILIKE %term% HOẶC material_id ∈ p_search_mat_ids
--     HOẶC id ∈ p_search_order_ids (Node resolve mã hàng/tem pallet như cũ)
--   · Quy đổi "thùng": mirror qtyEntryDecimal (utils/qtyUnits.ts BE+FE KHỚP NHAU):
--     có entry_unit + units_per_carton>0 → ROUND(qty/upc, 3) per-mã TRƯỚC khi cộng
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 trang id + tổng ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inbound_orders_page(
  p_offset            integer,
  p_limit             integer,
  p_warehouse_ids     text[] DEFAULT NULL,
  p_scope_categories  text[] DEFAULT NULL,
  p_category          text   DEFAULT NULL,
  p_status            text   DEFAULT NULL,
  p_date_from         date   DEFAULT NULL,
  p_date_to           date   DEFAULT NULL,
  p_material_ids      text[] DEFAULT NULL,
  p_cycles            text[] DEFAULT NULL,
  p_machines          text[] DEFAULT NULL,
  p_shift_ids         text[] DEFAULT NULL,
  p_source_types      text[] DEFAULT NULL,
  p_importer_ids      text[] DEFAULT NULL,
  p_search            text   DEFAULT NULL,
  p_search_mat_ids    text[] DEFAULT NULL,
  p_search_order_ids  text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE result jsonb;
BEGIN
WITH f AS (
  SELECT pi.id, pi.import_date, pi.created_at,
         -- Khóa nhóm "cùng chuyến" (mirror inboundGroupKey FE): lệnh TMS trước, rồi xe NCC theo cổng
         CASE WHEN pi.tms_order_id IS NOT NULL THEN 'tms:' || pi.tms_order_id::text
              WHEN pi.source_type = 'NCC' AND pi.gate_registration_id IS NOT NULL
                THEN 'gate:' || pi.gate_registration_id::text
              ELSE NULL END AS grp,
         COALESCE(CASE s.name WHEN 'Ca 1' THEN 0 WHEN 'Ca 2' THEN 1
                              WHEN 'Ca 3' THEN 2 WHEN 'HC' THEN 3 END, 99) AS shift_ord
  FROM "ProductionImport" pi
  LEFT JOIN "ImportShift" s ON s.id = pi.shift_id
  WHERE (p_warehouse_ids IS NULL OR pi.warehouse_id = ANY (p_warehouse_ids))
    AND ((p_status IS NULL AND pi.status <> 'CANCELLED') OR pi.status = p_status)
    AND (p_date_from IS NULL OR pi.import_date >= p_date_from::timestamp)
    AND (p_date_to   IS NULL OR pi.import_date < (p_date_to + 1)::timestamp)
    AND (p_category IS NULL OR pi.warehouse_type = p_category OR pi.source_type = 'TRANSFER')
    AND (p_category IS NOT NULL OR p_scope_categories IS NULL
         OR pi.warehouse_type = ANY (p_scope_categories) OR pi.source_type = 'TRANSFER')
    AND (p_material_ids IS NULL OR pi.material_id = ANY (p_material_ids))
    AND (p_shift_ids    IS NULL OR pi.source_type = 'TRANSFER' OR pi.shift_id = ANY (p_shift_ids))
    AND (p_source_types IS NULL OR pi.source_type = ANY (p_source_types))
    AND (p_importer_ids IS NULL OR pi.imported_by = ANY (p_importer_ids)
         OR (pi.imported_by IS NULL AND pi.created_by = ANY (p_importer_ids)))
    AND (p_cycles IS NULL OR pi.source_type = 'TRANSFER' OR EXISTS (
          SELECT 1 FROM "InventoryEntry" ie
          WHERE ie.import_order_id = pi.id AND ie.cycle = ANY (p_cycles)))
    AND (p_machines IS NULL OR pi.source_type = 'TRANSFER' OR EXISTS (
          SELECT 1 FROM "InventoryEntry" ie
          WHERE ie.import_order_id = pi.id AND ie.machine_code = ANY (p_machines)))
    AND (p_search IS NULL
         OR pi.import_code ILIKE '%' || p_search || '%'
         OR pi.material_id = ANY (COALESCE(p_search_mat_ids, ARRAY[]::text[]))
         OR pi.id = ANY (COALESCE(p_search_order_ids, ARRAY[]::text[])))
),
pg AS (
  SELECT id,
         row_number() OVER (ORDER BY import_date DESC, (grp IS NULL), COALESCE(grp, ''),
                            shift_ord, created_at, id) AS rn
  FROM f
  ORDER BY import_date DESC, (grp IS NULL), COALESCE(grp, ''), shift_ord, created_at, id
  LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
)
SELECT jsonb_build_object(
  'total', (SELECT count(*) FROM f),
  'ids',   COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb)
) INTO result;
  RETURN result;
END;
$$;

-- ── Tổng SummaryBand + bảng "Vị trí hàng nhập" (TOÀN BỘ kết quả lọc, tính dưới DB) ──
CREATE OR REPLACE FUNCTION inbound_orders_summary(
  p_warehouse_ids     text[] DEFAULT NULL,
  p_scope_categories  text[] DEFAULT NULL,
  p_category          text   DEFAULT NULL,
  p_status            text   DEFAULT NULL,
  p_date_from         date   DEFAULT NULL,
  p_date_to           date   DEFAULT NULL,
  p_material_ids      text[] DEFAULT NULL,
  p_cycles            text[] DEFAULT NULL,
  p_machines          text[] DEFAULT NULL,
  p_shift_ids         text[] DEFAULT NULL,
  p_source_types      text[] DEFAULT NULL,
  p_importer_ids      text[] DEFAULT NULL,
  p_search            text   DEFAULT NULL,
  p_search_mat_ids    text[] DEFAULT NULL,
  p_search_order_ids  text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE result jsonb;
BEGIN
WITH ord AS (
  SELECT pi.id, pi.status, pi.source_type, pi.posm_entry_id, pi.posm_cartons, pi.location_id,
         m.material_code AS mat_code, m.entry_unit, m.units_per_carton
  FROM "ProductionImport" pi
  LEFT JOIN "Material" m ON m.id = pi.material_id
  WHERE (p_warehouse_ids IS NULL OR pi.warehouse_id = ANY (p_warehouse_ids))
    AND ((p_status IS NULL AND pi.status <> 'CANCELLED') OR pi.status = p_status)
    AND (p_date_from IS NULL OR pi.import_date >= p_date_from::timestamp)
    AND (p_date_to   IS NULL OR pi.import_date < (p_date_to + 1)::timestamp)
    AND (p_category IS NULL OR pi.warehouse_type = p_category OR pi.source_type = 'TRANSFER')
    AND (p_category IS NOT NULL OR p_scope_categories IS NULL
         OR pi.warehouse_type = ANY (p_scope_categories) OR pi.source_type = 'TRANSFER')
    AND (p_material_ids IS NULL OR pi.material_id = ANY (p_material_ids))
    AND (p_shift_ids    IS NULL OR pi.source_type = 'TRANSFER' OR pi.shift_id = ANY (p_shift_ids))
    AND (p_source_types IS NULL OR pi.source_type = ANY (p_source_types))
    AND (p_importer_ids IS NULL OR pi.imported_by = ANY (p_importer_ids)
         OR (pi.imported_by IS NULL AND pi.created_by = ANY (p_importer_ids)))
    AND (p_cycles IS NULL OR pi.source_type = 'TRANSFER' OR EXISTS (
          SELECT 1 FROM "InventoryEntry" ie
          WHERE ie.import_order_id = pi.id AND ie.cycle = ANY (p_cycles)))
    AND (p_machines IS NULL OR pi.source_type = 'TRANSFER' OR EXISTS (
          SELECT 1 FROM "InventoryEntry" ie
          WHERE ie.import_order_id = pi.id AND ie.machine_code = ANY (p_machines)))
    AND (p_search IS NULL
         OR pi.import_code ILIKE '%' || p_search || '%'
         OR pi.material_id = ANY (COALESCE(p_search_mat_ids, ARRAY[]::text[]))
         OR pi.id = ANY (COALESCE(p_search_order_ids, ARRAY[]::text[])))
),
ent AS (
  SELECT ie.import_order_id AS oid, ie.cartons_imported, ie.pallet_code,
         l.location_code, l.sub_code
  FROM "InventoryEntry" ie
  JOIN ord o ON o.id = ie.import_order_id
  LEFT JOIN "Location" l ON l.id = ie.location_id
),
-- Per-order: tổng thô + xử lý pallet POSM DÙNG CHUNG (mirror computeOrderStats BE):
--   phiếu TẠO shared entry (có entry pallet_code = mã hàng mình) → thay phần shared bằng posm_cartons;
--   phiếu MƯỢN (posm_cartons>0, không có shared trong entries mình) → cộng thêm + 1 pallet.
oagg AS (
  SELECT o.id, o.status, o.source_type, o.location_id, o.entry_unit, o.units_per_carton,
         o.posm_entry_id, o.posm_cartons,
         COALESCE(SUM(e.cartons_imported), 0)::numeric AS base_cartons,
         COUNT(e.oid)::int AS pallet_cnt,
         COALESCE(SUM(e.cartons_imported) FILTER (WHERE e.pallet_code = o.mat_code), 0)::numeric AS shared_own,
         COALESCE(BOOL_OR(e.pallet_code = o.mat_code), false) AS is_creator
  FROM ord o
  LEFT JOIN ent e ON e.oid = o.id
  GROUP BY o.id, o.status, o.source_type, o.location_id, o.entry_unit, o.units_per_carton,
           o.posm_entry_id, o.posm_cartons, o.mat_code
),
adj AS (
  SELECT *,
    CASE WHEN posm_entry_id IS NOT NULL AND posm_cartons IS NOT NULL THEN
           CASE WHEN is_creator THEN base_cartons - shared_own + posm_cartons
                WHEN posm_cartons > 0 THEN base_cartons + posm_cartons
                ELSE base_cartons END
         ELSE base_cartons END AS total_cartons,
    CASE WHEN posm_entry_id IS NOT NULL AND posm_cartons IS NOT NULL
              AND NOT is_creator AND posm_cartons > 0
         THEN pallet_cnt + 1 ELSE pallet_cnt END AS pallet_total
  FROM oagg
),
conv AS (
  SELECT *,
    CASE WHEN entry_unit IS NOT NULL AND btrim(entry_unit) <> '' AND COALESCE(units_per_carton, 0) > 0
         THEN ROUND(total_cartons / units_per_carton, 3) ELSE total_cartons END AS cartons_conv
  FROM adj
),
-- Bảng "Vị trí hàng nhập": theo vị trí THẬT của từng pallet; quy đổi per-order-per-vị-trí
-- rồi mới cộng (mirror locationSummary FE)
loc_e AS (
  SELECT e.oid,
         COALESCE(e.location_code || '-' || e.sub_code, '(chưa xác định)') AS loc,
         COUNT(*)::int AS pallets, SUM(e.cartons_imported)::numeric AS cartons
  FROM ent e
  GROUP BY e.oid, COALESCE(e.location_code || '-' || e.sub_code, '(chưa xác định)')
),
loc_conv AS (
  SELECT le.loc, le.pallets,
         CASE WHEN a.entry_unit IS NOT NULL AND btrim(a.entry_unit) <> '' AND COALESCE(a.units_per_carton, 0) > 0
              THEN ROUND(le.cartons / a.units_per_carton, 3) ELSE le.cartons END AS cartons
  FROM loc_e le JOIN adj a ON a.id = le.oid
  UNION ALL
  -- Fallback FE: phiếu 0 entry nhưng mượn pallet POSM chung → tính theo vị trí của phiếu
  SELECT COALESCE(l.location_code || '-' || l.sub_code, '(chưa xác định)'), a.pallet_total,
         CASE WHEN a.entry_unit IS NOT NULL AND btrim(a.entry_unit) <> '' AND COALESCE(a.units_per_carton, 0) > 0
              THEN ROUND(a.total_cartons / a.units_per_carton, 3) ELSE a.total_cartons END
  FROM adj a LEFT JOIN "Location" l ON l.id = a.location_id
  WHERE a.pallet_cnt = 0 AND a.pallet_total > 0
),
locs AS (
  SELECT loc, SUM(pallets)::int AS pallets, SUM(cartons) AS cartons
  FROM loc_conv GROUP BY loc
)
SELECT jsonb_build_object(
  'total_orders',  (SELECT count(*) FROM adj),
  'sx',            (SELECT count(*) FROM adj
                    WHERE source_type IS DISTINCT FROM 'NCC' AND source_type IS DISTINCT FROM 'TRANSFER'),
  'ncc',           (SELECT count(*) FROM adj WHERE source_type = 'NCC'),
  'tf',            (SELECT count(*) FROM adj WHERE source_type = 'TRANSFER'),
  'completed',     (SELECT count(*) FROM adj WHERE status = 'COMPLETED'),
  'total_pallets', COALESCE((SELECT SUM(pallet_total) FROM adj), 0),
  'total_cartons', COALESCE((SELECT SUM(cartons_conv) FROM conv), 0),
  'locations',     COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'loc', loc, 'pallets', pallets, 'cartons', cartons)
                       ORDER BY pallets DESC, loc) FROM locs), '[]'::jsonb)
) INTO result;
  RETURN result;
END;
$$;

-- ── Option filter Material / Chu kỳ / Máy (DISTINCT dưới DB — filter luôn nhanh) ──
-- Chỉ nhận filter NỀN (kho/loại/ngày/status) — không nhận chính các filter nó cấp option
-- (khuôn như inventory_facet_values; cascade-exclude client cũ bỏ, đổi lấy 1 call cache được).
CREATE OR REPLACE FUNCTION inbound_orders_facets(
  p_warehouse_ids     text[] DEFAULT NULL,
  p_scope_categories  text[] DEFAULT NULL,
  p_category          text   DEFAULT NULL,
  p_status            text   DEFAULT NULL,
  p_date_from         date   DEFAULT NULL,
  p_date_to           date   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE result jsonb;
BEGIN
WITH ord AS (
  SELECT pi.id, pi.material_id
  FROM "ProductionImport" pi
  WHERE (p_warehouse_ids IS NULL OR pi.warehouse_id = ANY (p_warehouse_ids))
    AND ((p_status IS NULL AND pi.status <> 'CANCELLED') OR pi.status = p_status)
    AND (p_date_from IS NULL OR pi.import_date >= p_date_from::timestamp)
    AND (p_date_to   IS NULL OR pi.import_date < (p_date_to + 1)::timestamp)
    AND (p_category IS NULL OR pi.warehouse_type = p_category OR pi.source_type = 'TRANSFER')
    AND (p_category IS NOT NULL OR p_scope_categories IS NULL
         OR pi.warehouse_type = ANY (p_scope_categories) OR pi.source_type = 'TRANSFER')
),
mats AS (
  SELECT DISTINCT o.material_id AS value,
         COALESCE(m.short_name, m.material_description, o.material_id) AS label
  FROM ord o JOIN "Material" m ON m.id = o.material_id
),
cyc AS (
  SELECT DISTINCT ie.cycle AS v
  FROM "InventoryEntry" ie JOIN ord o ON o.id = ie.import_order_id
  WHERE ie.cycle IS NOT NULL AND ie.cycle <> ''
),
mach AS (
  SELECT DISTINCT ie.machine_code AS v
  FROM "InventoryEntry" ie JOIN ord o ON o.id = ie.import_order_id
  WHERE ie.machine_code IS NOT NULL AND ie.machine_code <> ''
)
SELECT jsonb_build_object(
  'materials', COALESCE((SELECT jsonb_agg(jsonb_build_object('value', value, 'label', label)
                          ORDER BY label) FROM mats), '[]'::jsonb),
  'cycles',    COALESCE((SELECT jsonb_agg(v ORDER BY v) FROM cyc), '[]'::jsonb),
  'machines',  COALESCE((SELECT jsonb_agg(v ORDER BY v) FROM mach), '[]'::jsonb)
) INTO result;
  RETURN result;
END;
$$;
