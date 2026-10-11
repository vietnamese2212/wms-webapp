-- 11/10/2026 — HSD HIỆU LỰC tính sẵn trên từng pallet (`InventoryEntry.expiry_calc`) — user duyệt đề xuất 2 (rà hệ thống 11/10 tối).
--
-- Vì sao: vòng quét cảnh báo "Tồn cận date" (`alerts_expiry_candidates`, alertScanner mỗi 10') đọc MỌI pallet sống (19.589) rồi mới
-- lọc theo NSX + shelf-life của mã / NCC: 3.534 block (28 MB) mỗi lượt, trung bình 1,6 s, cache nguội trên NANO quá hạn 29 lần
-- 04–07/10 (`ALERT_RULE_FAILED_OVERLOAD`). Có cột HSD tính sẵn + chỉ mục một phần thì vòng quét chỉ đọc đúng pallet sắp hết hạn.
--
-- Công thức = ĐÚNG `effectiveExpiryMs` của utils/shelfLife.ts (BE ↔ FE mirror): HSD tường minh trên tem (V2) → không thì NSX +
-- shelf-life hiệu lực = shelf-life chọn theo lô (entry) > ngoại lệ NCC (CHỈ khi NCC khai ĐÚNG MỘT giá trị) > mặc định của mã;
-- thiếu NSX hoặc shelf-life ≤ 0 ⇒ NULL ("không biết hạn", KHÔNG phải hết hạn). Cột chỉ nuôi cửa LỌC; %Date hiển thị vẫn do
-- `computePctDate` tính (alertScanner tính lại trên ứng viên như cũ). Bất biến `inventory_expiry_mismatch()` = 0 (gói 00 mục 14e).
-- Trigger: BEFORE ROW trên InventoryEntry chỉ gán NEW (đọc Material, không ghi bảng khác — hợp lớp C79); đổi shelf-life ở Material
-- ⇒ trigger THEO CÂU (bảng chuyển tiếp) tính lại một lần cho pallet của các mã đổi.
-- Lên production: áp bất kỳ lúc nào (cột mới + backfill ~56k dòng vài giây; RPC đổi cách lọc, kết quả cùng dạng).
BEGIN;

ALTER TABLE public."InventoryEntry" ADD COLUMN IF NOT EXISTS expiry_calc date;

CREATE OR REPLACE FUNCTION public.inventory_expiry_calc(
  p_expiry date, p_prod timestamp, p_entry_shelf integer, p_mat_shelf integer, p_overrides jsonb, p_ncc uuid
) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  WITH o AS (
    SELECT (x->>'shelf_life_days')::numeric AS v
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_overrides) = 'array' THEN p_overrides ELSE '[]'::jsonb END) x
     WHERE p_ncc IS NOT NULL AND x->>'transport_company_id' = p_ncc::text
       AND (x->>'shelf_life_days') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' AND (x->>'shelf_life_days')::numeric > 0
  ), d AS (
    SELECT CASE WHEN coalesce(p_entry_shelf, 0) > 0 THEN p_entry_shelf
                WHEN (SELECT count(*) FROM o) = 1 THEN (SELECT v FROM o)::integer
                ELSE coalesce(p_mat_shelf, 0) END AS days
  )
  SELECT CASE WHEN p_expiry IS NOT NULL THEN p_expiry
              WHEN p_prod IS NULL OR d.days <= 0 THEN NULL
              ELSE p_prod::date + d.days END
    FROM d
$$;

CREATE OR REPLACE FUNCTION public.inventory_expiry_calc_set() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  m_shelf integer;
  m_over jsonb;
BEGIN
  SELECT m.shelf_life_days, m.supplier_shelf_life_overrides INTO m_shelf, m_over FROM public."Material" m WHERE m.id = NEW.material_id;
  NEW.expiry_calc := public.inventory_expiry_calc(NEW.expiry_date, NEW.production_date, NEW.shelf_life_days, m_shelf, m_over, NEW.ncc_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_inventory_expiry_calc ON public."InventoryEntry";
CREATE TRIGGER trg_inventory_expiry_calc BEFORE INSERT OR UPDATE OF production_date, expiry_date, shelf_life_days, material_id, ncc_id
  ON public."InventoryEntry" FOR EACH ROW EXECUTE FUNCTION public.inventory_expiry_calc_set();

-- Material đổi shelf-life / ngoại lệ NCC ⇒ tính lại pallet của đúng các mã đổi, MỘT câu (bảng chuyển tiếp không đi cùng UPDATE OF <cột>)
CREATE OR REPLACE FUNCTION public.material_expiry_recalc() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public."InventoryEntry" e
     SET expiry_calc = public.inventory_expiry_calc(e.expiry_date, e.production_date, e.shelf_life_days, n.shelf_life_days, n.supplier_shelf_life_overrides, e.ncc_id)
    FROM newtab n JOIN oldtab o ON o.id = n.id
   WHERE e.material_id = n.id
     AND (o.shelf_life_days IS DISTINCT FROM n.shelf_life_days OR o.supplier_shelf_life_overrides IS DISTINCT FROM n.supplier_shelf_life_overrides)
     AND e.expiry_calc IS DISTINCT FROM public.inventory_expiry_calc(e.expiry_date, e.production_date, e.shelf_life_days, n.shelf_life_days, n.supplier_shelf_life_overrides, e.ncc_id);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_material_expiry_recalc ON public."Material";
CREATE TRIGGER trg_material_expiry_recalc AFTER UPDATE ON public."Material"
  REFERENCING OLD TABLE AS oldtab NEW TABLE AS newtab FOR EACH STATEMENT EXECUTE FUNCTION public.material_expiry_recalc();

-- dựng cột một lần cho dữ liệu đang có (cột expiry_calc không nằm trong UPDATE OF của trigger nào ⇒ không dội trigger khác)
UPDATE public."InventoryEntry" e
   SET expiry_calc = public.inventory_expiry_calc(e.expiry_date, e.production_date, e.shelf_life_days, m.shelf_life_days, m.supplier_shelf_life_overrides, e.ncc_id)
  FROM public."Material" m WHERE m.id = e.material_id;

-- chỉ mục một phần: chỉ pallet CÒN HÀNG và CÓ hạn — vòng quét lọc `expiry_calc <= hôm nay + N`
CREATE INDEX IF NOT EXISTS idx_ie_expiry_calc_live ON public."InventoryEntry" (expiry_calc)
  WHERE expiry_calc IS NOT NULL AND cartons_remaining > 0;

-- bất biến cho gói 00: pallet sống có cột lệch công thức
CREATE OR REPLACE FUNCTION public.inventory_expiry_mismatch() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public."InventoryEntry" e LEFT JOIN public."Material" m ON m.id = e.material_id
   WHERE e.cartons_remaining > 0
     AND e.expiry_calc IS DISTINCT FROM public.inventory_expiry_calc(e.expiry_date, e.production_date, e.shelf_life_days, m.shelf_life_days, m.supplier_shelf_life_overrides, e.ncc_id)
$$;

-- vòng quét: cùng dạng trả về, chỉ đổi cách LỌC — theo cột tính sẵn thay vì ba nhánh OR đọc hết pallet
CREATE OR REPLACE FUNCTION public.alerts_expiry_candidates(p_days integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_j), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object(
      'warehouse_id',   g.warehouse_id,
      'warehouse_name', w.name,
      'material_id',    g.material_id,
      'material_code',  m.material_code,
      'short_name',     m.short_name,
      'category',       m.category,
      'entry_unit',        m.entry_unit,
      'base_unit',         m.base_unit,
      'units_per_carton',  m.units_per_carton,
      'production_date', g.production_date,
      'expiry_date',     g.expiry_date,
      'shelf_life_days', g.shelf_life_days,
      'ncc_id',          g.ncc_id,
      'mat_shelf_life_days', m.shelf_life_days,
      'supplier_shelf_life_overrides', m.supplier_shelf_life_overrides,
      'qty_base',        g.qty_base,
      'pallets',         g.pallets
    ) AS row_j
    FROM (
      SELECT e.warehouse_id, e.material_id, e.production_date, e.expiry_date,
             e.shelf_life_days, e.ncc_id,
             SUM(e.cartons_remaining) AS qty_base, COUNT(*) AS pallets, MIN(e.expiry_calc) AS expiry_calc
      FROM "InventoryEntry" e
      WHERE e.expiry_calc IS NOT NULL AND e.cartons_remaining > 0
        AND e.expiry_calc <= current_date + p_days
        AND e.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
      GROUP BY e.warehouse_id, e.material_id, e.production_date, e.expiry_date, e.shelf_life_days, e.ncc_id
    ) g
    JOIN "Material" m ON m.id = g.material_id
    LEFT JOIN "Warehouse" w ON w.id::text = g.warehouse_id::text
    ORDER BY g.expiry_calc
    LIMIT 2000
  ) t;
  RETURN v;
END $function$;

COMMIT;
