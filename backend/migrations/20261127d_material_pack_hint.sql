-- 27/11/2026 — QUY CÁCH GỢI Ý cho mã cân / đong (đường trắng: 1 bao = 20 kg) tách khỏi entry unit.
--
-- User chốt 27/11: "hàng NVL như đường trắng: key 1000 kg sẽ giữ là 1000 kg, chỉ gợi ý là 50 bao thôi, kg vẫn là đơn vị chính"
-- — còn hàng thành phẩm (1 thùng = 48 hộp) thì thùng là đơn vị thật (60 hộp = 1 thùng + 12 hộp).
-- Bản 20261127c khai bao vào entry_unit / units_per_carton ⇒ ~35 hàm DB, file Excel, số / pallet, ô tổng "SL (quy đổi)" đều
-- coi đường là "có thùng" và đếm 1.000 kg thành 50 (ô tổng chuyến xuất ghi "50 thùng"). Sửa ở GỐC: mã có đơn vị gốc là ĐƠN VỊ ĐO
-- không mang entry unit; quy cách bao nằm ở HAI CỘT RIÊNG chỉ dùng để in dòng gợi ý. Mọi đường tính khác thấy mã y như trước khi
-- khai bao — không phải sửa từng hàm.
--
--  1. Hàm qty_is_measure_unit — MỘT danh sách đơn vị đo trong DB (khớp MEASURE_UNIT_CODES ở utils/qtyUnits.ts BE + FE;
--     test backend/tests/unit/measureUnitsSql.test.ts đối chiếu). qty_whole_required gọi lại hàm này.
--  2. Cột Material.pack_unit / pack_size.
--  3. Chuyển mã đang khai đơn vị đo + entry (staging: chỉ đường trắng 210000262) sang quy cách gợi ý. Số / pallet đang theo bao
--     (50) đổi lại theo đơn vị gốc (1.000 kg) — số / pallet theo entry nếu có, không thì theo đơn vị gốc (palletCalc).
--  4. CHECK: mã đơn vị đo không được có entry unit; quy cách gợi ý chỉ cho mã đơn vị đo. Cửa ghi nào quên tách (form, Excel, API)
--     là lỗi ngay thay vì âm thầm đếm sai.
-- Chạy lại được.

BEGIN;

-- ── 1. Danh sách đơn vị đo ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qty_is_measure_unit(p_unit text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT upper(btrim(coalesce(p_unit, ''))) = ANY (ARRAY['KG', 'G', 'MG', 'TON', 'L', 'ML', 'M', 'CM', 'MM', 'M2', 'M3'])
$$;

CREATE OR REPLACE FUNCTION public.qty_whole_required(p_material text)
RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE((
    SELECT COALESCE(btrim(m.entry_unit), '') <> '' AND COALESCE(m.units_per_carton, 0) > 0
           AND NOT qty_is_measure_unit(m.base_unit)
      FROM "Material" m WHERE m.id = p_material), false)
$$;

-- ── 2. Cột quy cách gợi ý ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS pack_unit text;
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS pack_size numeric;
COMMENT ON COLUMN "Material".pack_unit IS 'Quy cách GỢI Ý của mã cân / đong (BAO…) — chỉ để in "50 bao"; không dùng để quy đổi / cộng tổng';
COMMENT ON COLUMN "Material".pack_size IS 'Số đơn vị gốc trong 1 pack_unit (1 bao = 20 kg)';

-- ── 3. Chuyển dữ liệu ─────────────────────────────────────────────────────────────────────────────────────
UPDATE "Material" m SET
  pack_unit = upper(btrim(m.entry_unit)),
  pack_size = m.units_per_carton,
  cartons_per_pallet    = m.cartons_per_pallet * m.units_per_carton,
  cartons_per_pallet_mn = m.cartons_per_pallet_mn * m.units_per_carton,
  warehouse_pallet_overrides = CASE
    WHEN jsonb_typeof(m.warehouse_pallet_overrides) = 'array' THEN (
      SELECT coalesce(jsonb_agg(CASE WHEN o ? 'cartons_per_pallet' AND jsonb_typeof(o->'cartons_per_pallet') = 'number'
                                     THEN jsonb_set(o, '{cartons_per_pallet}', to_jsonb((o->>'cartons_per_pallet')::numeric * m.units_per_carton))
                                     ELSE o END), '[]'::jsonb)
        FROM jsonb_array_elements(m.warehouse_pallet_overrides) o)
    ELSE m.warehouse_pallet_overrides END,
  entry_unit = NULL,
  units_per_carton = NULL,
  updated_at = now(),
  updated_by = 'migration 20261127d'
WHERE COALESCE(btrim(m.entry_unit), '') <> '' AND COALESCE(m.units_per_carton, 0) > 0
  AND qty_is_measure_unit(m.base_unit);

-- Mã đơn vị đo còn entry mà KHÔNG có hệ số (dữ liệu hỏng, app vốn coi như không entry) ⇒ bỏ entry cho CHECK qua.
UPDATE "Material" m SET entry_unit = NULL, updated_at = now(), updated_by = 'migration 20261127d'
WHERE COALESCE(btrim(m.entry_unit), '') <> '' AND qty_is_measure_unit(m.base_unit);

-- ── 4. Chốt chặn ──────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "Material" DROP CONSTRAINT IF EXISTS material_measure_no_entry_chk;
ALTER TABLE "Material" ADD CONSTRAINT material_measure_no_entry_chk
  CHECK (COALESCE(btrim(entry_unit), '') = '' OR NOT qty_is_measure_unit(base_unit));
ALTER TABLE "Material" DROP CONSTRAINT IF EXISTS material_pack_hint_chk;
ALTER TABLE "Material" ADD CONSTRAINT material_pack_hint_chk
  CHECK ((pack_unit IS NULL AND pack_size IS NULL)
         OR (COALESCE(btrim(pack_unit), '') <> '' AND COALESCE(pack_size, 0) > 0 AND qty_is_measure_unit(base_unit)
             AND upper(btrim(pack_unit)) <> upper(btrim(coalesce(base_unit, '')))));

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "Material" WHERE COALESCE(btrim(entry_unit), '') <> '' AND qty_is_measure_unit(base_unit);
  IF n > 0 THEN RAISE EXCEPTION 'còn % mã đơn vị đo mang entry unit', n; END IF;
END $$;

COMMIT;
