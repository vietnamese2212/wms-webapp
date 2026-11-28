-- 28/11/2026 — ĐƠN VỊ ĐO CẤU HÌNH ĐƯỢC: cờ "Đơn vị đo" trong danh mục Đơn vị tính (Cài đặt WMS), bỏ danh sách cố định trong code.
--
-- User 28/11: "Cho tự cấu hình đơn vị đo đi. Bởi ko thể phụ thuộc vào hard code đc nhé".
-- Bản 20261127d phân biệt đơn vị đo (KG, L… — bao chỉ là quy cách GỢI Ý) với đơn vị đếm (HOP, BT… — thùng là entry unit thật)
-- bằng một danh sách cố định có BA bản (BE + FE utils/qtyUnits.ts, hàm DB qty_is_measure_unit). Nay nguồn duy nhất là cờ
-- LookupValue.meta.measure của từng đơn vị (type 'unit_of_measure'):
--  1. Gắn cờ cho các đơn vị đang có trong danh mục mà danh sách cũ coi là đơn vị đo (staging: KG, G, L, M2) ⇒ hành vi không đổi.
--  2. qty_is_measure_unit đọc danh mục (STABLE). qty_whole_required giữ nguyên, gọi lại hàm này.
--  3. Hai CHECK của Material (CHECK chỉ được gọi hàm IMMUTABLE) ⇒ trigger trước khi ghi, cùng điều kiện, câu lỗi tiếng người.
--  4. material_units_reclassify: đổi cờ một đơn vị ⇒ chuyển các mã dùng nó làm đơn vị gốc cho khớp, trong cùng giao dịch:
--       đếm → đo: entry unit thật ⇒ quy cách gợi ý, số / pallet × hệ số (cùng phép đổi 20261127d);
--       đo → đếm: quy cách gợi ý ⇒ entry unit thật, số / pallet ÷ hệ số — CHẶN khi không chuyển trọn được (hệ số lẻ, số / pallet
--       không chia hết, tồn kho lẻ: mã đếm có thùng thì số theo đơn vị gốc phải nguyên).
--     p_apply = false: chỉ đếm, không ghi (màn Cài đặt hỏi trước khi lưu).
--  5. Trigger trên LookupValue gọi hàm trên mỗi khi cờ đổi ⇒ mọi cửa (màn hình, API, SQL tay) cùng một luật.
-- Chạy lại được.

BEGIN;

-- ── 1. Cờ trong danh mục (chỉ gắn cho đơn vị CHƯA khai cờ — chạy lại không đè lựa chọn của người dùng) ──────────
UPDATE "LookupValue"
   SET meta = coalesce(meta, '{}'::jsonb) || '{"measure": true}'::jsonb, updated_at = now(), updated_by = 'migration 20261128'
 WHERE type = 'unit_of_measure'
   AND upper(btrim(value)) = ANY (ARRAY['KG', 'G', 'MG', 'TON', 'L', 'ML', 'M', 'CM', 'MM', 'M2', 'M3'])
   AND NOT (coalesce(meta, '{}'::jsonb) ? 'measure');

-- ── 2. Hàm đọc cờ ──────────────────────────────────────────────────────────────────────────────────────────
-- Gỡ hai CHECK trước: chúng gọi hàm này và CHECK chỉ hợp lệ với hàm IMMUTABLE.
ALTER TABLE "Material" DROP CONSTRAINT IF EXISTS material_measure_no_entry_chk;
ALTER TABLE "Material" DROP CONSTRAINT IF EXISTS material_pack_hint_chk;

CREATE OR REPLACE FUNCTION public.qty_is_measure_unit(p_unit text)
RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM "LookupValue" lv
     WHERE lv.type = 'unit_of_measure'
       AND upper(btrim(lv.value)) = upper(btrim(coalesce(p_unit, '')))
       AND lv.meta -> 'measure' = 'true'::jsonb)
$$;
COMMENT ON FUNCTION public.qty_is_measure_unit(text) IS
  'Đơn vị gốc là ĐƠN VỊ ĐO (cân / đong / đo) — đọc cờ meta.measure của danh mục Đơn vị tính (Cài đặt WMS). Không có danh sách cố định.';

-- ── 3. Chốt chặn của Material (thay hai CHECK) ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.material_unit_kind_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_measure boolean := qty_is_measure_unit(NEW.base_unit);
BEGIN
  IF COALESCE(btrim(NEW.entry_unit), '') <> '' AND v_measure THEN
    RAISE EXCEPTION 'UNIT_MEASURE_NO_ENTRY: Mã % có đơn vị gốc % là đơn vị đo — % chỉ được khai là quy cách gợi ý, không làm đơn vị thùng',
      NEW.material_code, NEW.base_unit, NEW.entry_unit;
  END IF;
  IF NOT ((NEW.pack_unit IS NULL AND NEW.pack_size IS NULL)
          OR (COALESCE(btrim(NEW.pack_unit), '') <> '' AND COALESCE(NEW.pack_size, 0) > 0 AND v_measure
              AND upper(btrim(NEW.pack_unit)) <> upper(btrim(coalesce(NEW.base_unit, ''))))) THEN
    RAISE EXCEPTION 'UNIT_PACK_HINT: Mã % — quy cách gợi ý chỉ dành cho mã có đơn vị gốc là đơn vị đo, hệ số phải lớn hơn 0 và khác đơn vị gốc',
      NEW.material_code;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_material_unit_kind ON "Material";
CREATE TRIGGER trg_material_unit_kind
  BEFORE INSERT OR UPDATE OF base_unit, entry_unit, units_per_carton, pack_unit, pack_size ON "Material"
  FOR EACH ROW EXECUTE FUNCTION public.material_unit_kind_guard();

-- ── 4. Chuyển mã khi đổi cờ ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.material_units_reclassify(p_unit text, p_measure boolean, p_apply boolean, p_actor text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_unit    text := upper(btrim(coalesce(p_unit, '')));
  v_actor   text := left(coalesce(nullif(btrim(p_actor), ''), 'đổi cờ đơn vị đo'), 200);
  v_total   int;
  v_sample  jsonb;
  v_blocked int;
  v_blocks  jsonb;
BEGIN
  IF v_unit = '' THEN RAISE EXCEPTION 'UNIT_BAD_INPUT: Thiếu mã đơn vị'; END IF;

  IF p_measure THEN
    -- ĐẾM → ĐO: mọi mã đơn vị gốc này đang có entry unit ⇒ thành quy cách gợi ý. Luôn chuyển trọn (nhân số nguyên).
    SELECT count(*),
           coalesce(jsonb_agg(jsonb_build_object('code', material_code, 'name', coalesce(short_name, material_description),
                    'from', entry_unit || ' = ' || coalesce(units_per_carton::text, '?') || ' ' || v_unit)
                    ORDER BY material_code) FILTER (WHERE rn <= 20), '[]'::jsonb)
      INTO v_total, v_sample
      FROM (SELECT m.*, row_number() OVER (ORDER BY m.material_code) rn FROM "Material" m
             WHERE upper(btrim(m.base_unit)) = v_unit AND COALESCE(btrim(m.entry_unit), '') <> '') x;
    v_blocked := 0; v_blocks := '[]'::jsonb;

    IF p_apply AND v_total > 0 THEN
      UPDATE "Material" m SET
        pack_unit = CASE WHEN COALESCE(m.units_per_carton, 0) > 0 THEN upper(btrim(m.entry_unit)) END,
        pack_size = CASE WHEN COALESCE(m.units_per_carton, 0) > 0 THEN m.units_per_carton END,
        cartons_per_pallet    = CASE WHEN COALESCE(m.units_per_carton, 0) > 0 THEN m.cartons_per_pallet * m.units_per_carton ELSE m.cartons_per_pallet END,
        cartons_per_pallet_mn = CASE WHEN COALESCE(m.units_per_carton, 0) > 0 THEN m.cartons_per_pallet_mn * m.units_per_carton ELSE m.cartons_per_pallet_mn END,
        warehouse_pallet_overrides = CASE
          WHEN COALESCE(m.units_per_carton, 0) > 0 AND jsonb_typeof(m.warehouse_pallet_overrides) = 'array' THEN (
            SELECT coalesce(jsonb_agg(CASE WHEN o ? 'cartons_per_pallet' AND jsonb_typeof(o->'cartons_per_pallet') = 'number'
                                           THEN jsonb_set(o, '{cartons_per_pallet}', to_jsonb((o->>'cartons_per_pallet')::numeric * m.units_per_carton))
                                           ELSE o END), '[]'::jsonb)
              FROM jsonb_array_elements(m.warehouse_pallet_overrides) o)
          ELSE m.warehouse_pallet_overrides END,
        entry_unit = NULL,
        units_per_carton = NULL,
        updated_at = now(),
        updated_by = v_actor
      WHERE upper(btrim(m.base_unit)) = v_unit AND COALESCE(btrim(m.entry_unit), '') <> '';
    END IF;

  ELSE
    -- ĐO → ĐẾM: quy cách gợi ý ⇒ entry unit thật. Chuyển được khi: hệ số nguyên (units_per_carton là số nguyên), số / pallet
    -- chia hết cho hệ số (số / pallet theo thùng là số nguyên), tồn kho của mã không có số lẻ (mã đếm có thùng ⇒ số nguyên).
    WITH c AS (
      SELECT m.*,
             array_remove(ARRAY[
               CASE WHEN m.pack_size <> trunc(m.pack_size) THEN '1 ' || m.pack_unit || ' = ' || m.pack_size || ' ' || v_unit || ' — hệ số phải là số nguyên' END,
               CASE WHEN m.cartons_per_pallet IS NOT NULL AND m.pack_size = trunc(m.pack_size) AND m.cartons_per_pallet % m.pack_size::int <> 0
                    THEN 'số / pallet ' || m.cartons_per_pallet || ' ' || v_unit || ' không chia hết cho ' || m.pack_size END,
               CASE WHEN m.cartons_per_pallet_mn IS NOT NULL AND m.pack_size = trunc(m.pack_size) AND m.cartons_per_pallet_mn % m.pack_size::int <> 0
                    THEN 'số / pallet (miền Nam) ' || m.cartons_per_pallet_mn || ' ' || v_unit || ' không chia hết cho ' || m.pack_size END,
               CASE WHEN jsonb_typeof(m.warehouse_pallet_overrides) = 'array' AND EXISTS (
                      SELECT 1 FROM jsonb_array_elements(m.warehouse_pallet_overrides) o
                       WHERE jsonb_typeof(o->'cartons_per_pallet') = 'number'
                         AND mod((o->>'cartons_per_pallet')::numeric, m.pack_size) <> 0)
                    THEN 'số / pallet riêng của kho không chia hết cho ' || m.pack_size END,
               CASE WHEN EXISTS (
                      SELECT 1 FROM "InventoryEntry" e
                       WHERE e.material_id = m.id
                         AND (COALESCE(e.cartons_remaining, 0) <> trunc(COALESCE(e.cartons_remaining, 0))
                              OR COALESCE(e.cartons_imported, 0) <> trunc(COALESCE(e.cartons_imported, 0))))
                    THEN 'đang có tồn kho số lẻ theo ' || v_unit END
             ], NULL) AS reasons,
             row_number() OVER (ORDER BY m.material_code) rn
        FROM "Material" m
       WHERE upper(btrim(m.base_unit)) = v_unit AND m.pack_unit IS NOT NULL
    )
    SELECT count(*),
           coalesce(jsonb_agg(jsonb_build_object('code', material_code, 'name', coalesce(short_name, material_description),
                    'from', pack_unit || ' = ' || pack_size || ' ' || v_unit)
                    ORDER BY material_code) FILTER (WHERE rn <= 20), '[]'::jsonb),
           count(*) FILTER (WHERE cardinality(reasons) > 0),
           coalesce(jsonb_agg(jsonb_build_object('code', material_code, 'name', coalesce(short_name, material_description),
                    'reason', array_to_string(reasons, ' · '))
                    ORDER BY material_code) FILTER (WHERE cardinality(reasons) > 0), '[]'::jsonb)
      INTO v_total, v_sample, v_blocked, v_blocks
      FROM c;

    IF p_apply AND v_blocked > 0 THEN
      RAISE EXCEPTION 'UNIT_RECLASSIFY_BLOCKED: % mã dùng % làm đơn vị gốc không chuyển sang đơn vị đếm được (vd %: %) — sửa các mã đó ở Mã hàng trước',
        v_blocked, v_unit, v_blocks->0->>'code', v_blocks->0->>'reason';
    END IF;

    IF p_apply AND v_total > 0 THEN
      UPDATE "Material" m SET
        entry_unit = upper(btrim(m.pack_unit)),
        units_per_carton = m.pack_size::int,
        cartons_per_pallet    = m.cartons_per_pallet / m.pack_size::int,
        cartons_per_pallet_mn = m.cartons_per_pallet_mn / m.pack_size::int,
        warehouse_pallet_overrides = CASE
          WHEN jsonb_typeof(m.warehouse_pallet_overrides) = 'array' THEN (
            SELECT coalesce(jsonb_agg(CASE WHEN o ? 'cartons_per_pallet' AND jsonb_typeof(o->'cartons_per_pallet') = 'number'
                                           THEN jsonb_set(o, '{cartons_per_pallet}', to_jsonb((o->>'cartons_per_pallet')::numeric / m.pack_size))
                                           ELSE o END), '[]'::jsonb)
              FROM jsonb_array_elements(m.warehouse_pallet_overrides) o)
          ELSE m.warehouse_pallet_overrides END,
        pack_unit = NULL,
        pack_size = NULL,
        updated_at = now(),
        updated_by = v_actor
      WHERE upper(btrim(m.base_unit)) = v_unit AND m.pack_unit IS NOT NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object('unit', v_unit, 'measure', p_measure, 'total', v_total, 'sample', v_sample,
                            'blocked', v_blocked, 'blockers', v_blocks, 'applied', p_apply AND v_blocked = 0);
END $$;

-- ── 5. Đổi cờ ở danh mục ⇒ chuyển mã ngay trong cùng giao dịch ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lookup_unit_measure_sync()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_new boolean := coalesce(NEW.meta -> 'measure' = 'true'::jsonb, false);
  v_old boolean;
BEGIN
  IF NEW.type <> 'unit_of_measure' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.type = 'unit_of_measure' THEN
    v_old := coalesce(OLD.meta -> 'measure' = 'true'::jsonb, false);
    IF v_old = v_new AND upper(btrim(OLD.value)) = upper(btrim(NEW.value)) THEN RETURN NEW; END IF;
  END IF;
  PERFORM material_units_reclassify(NEW.value, v_new, true, coalesce(NEW.updated_by, NEW.created_by));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lookup_unit_measure_sync ON "LookupValue";
CREATE TRIGGER trg_lookup_unit_measure_sync
  AFTER INSERT OR UPDATE OF meta, value, type ON "LookupValue"
  FOR EACH ROW EXECUTE FUNCTION public.lookup_unit_measure_sync();

-- Hàm chỉ chạy từ backend (service role) — không mở cho vai đăng nhập / ẩn danh.
REVOKE ALL ON FUNCTION public.material_units_reclassify(text, boolean, boolean, text) FROM PUBLIC, anon, authenticated;

-- ── Kiểm: dữ liệu hiện có khớp luật mới ────────────────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "Material" WHERE COALESCE(btrim(entry_unit), '') <> '' AND qty_is_measure_unit(base_unit);
  IF n > 0 THEN RAISE EXCEPTION 'còn % mã đơn vị đo mang entry unit', n; END IF;
  SELECT count(*) INTO n FROM "Material" WHERE pack_unit IS NOT NULL AND NOT qty_is_measure_unit(base_unit);
  IF n > 0 THEN RAISE EXCEPTION 'còn % mã có quy cách gợi ý mà đơn vị gốc không phải đơn vị đo', n; END IF;
END $$;

COMMIT;
