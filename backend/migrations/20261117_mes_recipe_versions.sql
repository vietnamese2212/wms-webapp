-- MES 17/11 — NHIỀU CÔNG THỨC CHO MỘT MÃ BÁN THÀNH PHẨM + PHIẾU CỦA MẺ GIỮ ĐỊNH MỨC GỐC (user chốt 16–17/11, phiếu chế biến giấy
-- HN-…-QT-01-BM-01 "SC CĐ Long Thành"):
--   • "Ở nhiều thời điểm công thức sẽ khác nhau ⇒ tạo được nhiều công thức để chọn, và thay đổi được trên giao diện mẻ: thêm, xoá, sửa, đổi".
--     production_recipe: + name (tên công thức, duy nhất trong một mã) + is_default (mỗi mã đúng một công thức mặc định khi có công thức
--     đang dùng) — bỏ UNIQUE(material_id). Mở mẻ chọn công thức (mặc định = công thức mặc định); production_batch.recipe_id ghi lại.
--   • Mức lệch cho phép từng dòng công thức (tol_pct, %) — cấp vượt mức ⇒ CHỈ TÔ ĐỎ, vẫn cho cấp (user chốt "Tô chỉ đỏ").
--   • Phiếu của mẻ (batch_requirement) GIỮ ĐỊNH MỨC GỐC (qty_standard = công thức × kế hoạch) — sửa trên mẻ không ghi đè số gốc.
--     Sửa / thêm / bỏ / đổi mã bắt buộc lý do, ghi người + giờ (quyền mới production.edit_requirement — "người được phân quyền (trưởng ca)").
--     Bỏ một dòng của công thức = BỎ MỀM (removed_at) — vẫn thấy "đã bỏ (gốc 60 kg) · lý do"; dòng tự thêm thì xoá hẳn.
--     Đổi mã = dòng cũ bỏ mềm + dòng mới ghi replaces_material_id ("thay cho …").
BEGIN;

-- ── 1. Công thức: nhiều công thức / mã ──
ALTER TABLE public.production_recipe ADD COLUMN IF NOT EXISTS name text;
UPDATE public.production_recipe SET name = 'Chuẩn' WHERE name IS NULL;
ALTER TABLE public.production_recipe ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.production_recipe DROP CONSTRAINT IF EXISTS production_recipe_name_chk;
ALTER TABLE public.production_recipe ADD CONSTRAINT production_recipe_name_chk CHECK (length(btrim(name)) BETWEEN 1 AND 80);
ALTER TABLE public.production_recipe ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
UPDATE public.production_recipe SET is_default = true WHERE is_active AND NOT is_default;   -- trước đây mỗi mã một công thức
ALTER TABLE public.production_recipe DROP CONSTRAINT IF EXISTS production_recipe_material_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS production_recipe_mat_name_uq ON public.production_recipe (material_id, lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS production_recipe_one_default ON public.production_recipe (material_id) WHERE is_default;

ALTER TABLE public.production_recipe_line ADD COLUMN IF NOT EXISTS tol_pct numeric;
ALTER TABLE public.production_recipe_line DROP CONSTRAINT IF EXISTS production_recipe_line_tol_chk;
ALTER TABLE public.production_recipe_line ADD CONSTRAINT production_recipe_line_tol_chk CHECK (tol_pct IS NULL OR (tol_pct >= 0 AND tol_pct <= 100));

-- ── 2. Mẻ ghi công thức đã dùng ──
ALTER TABLE public.production_batch ADD COLUMN IF NOT EXISTS recipe_id text REFERENCES public.production_recipe(id);

-- ── 3. Phiếu của mẻ: định mức gốc · mức lệch · dấu sửa · bỏ mềm · đổi mã ──
ALTER TABLE public.batch_requirement
  ADD COLUMN IF NOT EXISTS qty_standard numeric,
  ADD COLUMN IF NOT EXISTS tol_pct numeric,
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS replaces_material_id text REFERENCES public."Material"(id),
  ADD COLUMN IF NOT EXISTS change_reason text,
  ADD COLUMN IF NOT EXISTS changed_by_name text,
  ADD COLUMN IF NOT EXISTS changed_at timestamptz;
ALTER TABLE public.batch_requirement DROP CONSTRAINT IF EXISTS batch_requirement_std_chk;
ALTER TABLE public.batch_requirement ADD CONSTRAINT batch_requirement_std_chk CHECK (qty_standard IS NULL OR qty_standard > 0);
ALTER TABLE public.batch_requirement DROP CONSTRAINT IF EXISTS batch_requirement_tol_chk;
ALTER TABLE public.batch_requirement ADD CONSTRAINT batch_requirement_tol_chk CHECK (tol_pct IS NULL OR (tol_pct >= 0 AND tol_pct <= 100));
ALTER TABLE public.batch_requirement DROP CONSTRAINT IF EXISTS batch_requirement_reason_chk;
ALTER TABLE public.batch_requirement ADD CONSTRAINT batch_requirement_reason_chk CHECK (change_reason IS NULL OR length(change_reason) <= 200);
-- yêu cầu cũ (trước bản này) coi như ĐÚNG công thức: gốc = số hiện có
UPDATE public.batch_requirement SET qty_standard = qty_required WHERE qty_standard IS NULL;

-- ── 4. LƯU CÔNG THỨC — p: {id?, material_id, name, base_qty, note, is_active, is_default, lines:[{material_id, qty, tol_pct, note}], actor_name}
-- id trống = tạo công thức MỚI cho mã. Tên trùng (không phân biệt hoa thường) trong cùng mã ⇒ DUPLICATE_NAME.
-- Mỗi mã có công thức đang dùng thì có đúng MỘT mặc định: đặt mặc định cho công thức này ⇒ bỏ mặc định ở công thức khác;
-- ngừng công thức mặc định ⇒ công thức đang dùng sửa gần nhất thành mặc định.
CREATE OR REPLACE FUNCTION public.mes_recipe_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_mat    text := p->>'material_id';
  v_id     text := nullif(p->>'id', '');
  v_name   text := btrim(coalesce(p->>'name', ''));
  v_base   numeric := (p->>'base_qty')::numeric;
  v_active boolean := coalesce((p->>'is_active')::boolean, true);
  v_def    boolean := coalesce((p->>'is_default')::boolean, false);
  cur      record;
  l        jsonb;
  v_i      integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Material" WHERE id = v_mat) THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mã bán thành phẩm'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'MESERR:NAME|Nhập tên công thức'; END IF;
  IF length(v_name) > 80 THEN RAISE EXCEPTION 'MESERR:NAME|Tên công thức tối đa 80 ký tự'; END IF;
  IF v_base IS NULL OR v_base <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Cỡ mẻ chuẩn phải lớn hơn 0'; END IF;
  IF (SELECT count(*) <> count(DISTINCT x->>'material_id') FROM jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) x) THEN
    RAISE EXCEPTION 'MESERR:DUPLICATE|Một nguyên liệu bị khai hai lần trong công thức';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) x WHERE x->>'material_id' = v_mat) THEN
    RAISE EXCEPTION 'MESERR:SELF|Công thức không được chứa chính mã bán thành phẩm';
  END IF;
  -- khoá mọi công thức của mã: hai người cùng đặt mặc định ⇒ lần lượt, không vỡ chỉ mục "một mặc định"
  PERFORM 1 FROM production_recipe WHERE material_id = v_mat FOR UPDATE;
  IF v_id IS NOT NULL THEN
    SELECT * INTO cur FROM production_recipe WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy công thức'; END IF;
    IF cur.material_id <> v_mat THEN RAISE EXCEPTION 'MESERR:MISMATCH|Công thức không thuộc mã bán thành phẩm này'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM production_recipe WHERE material_id = v_mat AND lower(btrim(name)) = lower(v_name) AND id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'MESERR:DUPLICATE_NAME|Mã này đã có công thức tên "%"', v_name;
  END IF;
  IF NOT v_active THEN v_def := false; END IF;
  IF v_def THEN UPDATE production_recipe SET is_default = false, updated_at = now() WHERE material_id = v_mat AND is_default AND id IS DISTINCT FROM v_id; END IF;
  IF v_id IS NULL THEN
    v_id := gen_random_uuid()::text;
    INSERT INTO production_recipe (id, material_id, name, base_qty, note, is_active, is_default, updated_at, updated_by)
    VALUES (v_id, v_mat, v_name, v_base, nullif(btrim(coalesce(p->>'note', '')), ''), v_active, v_def, now(), p->>'actor_name');
  ELSE
    UPDATE production_recipe SET name = v_name, base_qty = v_base, note = nullif(btrim(coalesce(p->>'note', '')), ''),
           is_active = v_active, is_default = v_def, updated_at = now(), updated_by = p->>'actor_name' WHERE id = v_id;
    DELETE FROM production_recipe_line WHERE recipe_id = v_id;
  END IF;
  -- mã có công thức đang dùng mà không còn mặc định ⇒ công thức đang dùng sửa gần nhất làm mặc định
  IF NOT EXISTS (SELECT 1 FROM production_recipe WHERE material_id = v_mat AND is_default) THEN
    UPDATE production_recipe SET is_default = true
     WHERE id = (SELECT id FROM production_recipe WHERE material_id = v_mat AND is_active ORDER BY (id = v_id) DESC, updated_at DESC LIMIT 1);
  END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) LOOP
    v_i := v_i + 1;
    IF NOT EXISTS (SELECT 1 FROM "Material" WHERE id = l->>'material_id') THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Có nguyên liệu không còn trong danh mục'; END IF;
    INSERT INTO production_recipe_line (id, recipe_id, material_id, qty, tol_pct, sort_order, note, updated_at)
    VALUES (gen_random_uuid()::text, v_id, l->>'material_id', (l->>'qty')::numeric, nullif(l->>'tol_pct', '')::numeric, v_i,
            nullif(btrim(coalesce(l->>'note', '')), ''), now());
  END LOOP;
  RETURN jsonb_build_object('id', v_id, 'lines', v_i, 'is_default', (SELECT is_default FROM production_recipe WHERE id = v_id));
END $$;

-- ── 5. CHÉP CÔNG THỨC VÀO MẺ — p: {batch_id, recipe_id?, replace, actor_name}
-- recipe_id trống ⇒ công thức của mẻ (còn dùng, đúng mã) → công thức mặc định → công thức đang dùng sửa gần nhất.
-- Yêu cầu = gốc = dòng công thức × (kế hoạch / cỡ mẻ chuẩn); mẻ không kế hoạch ⇒ × 1. Ghi production_batch.recipe_id.
CREATE OR REPLACE FUNCTION public.mes_batch_apply_recipe(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  b     record;
  r     record;
  v_rid text := nullif(p->>'recipe_id', '');
  v_k   numeric;
  v_n   integer := 0;
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF b.status <> 'OPEN' THEN RAISE EXCEPTION 'MESERR:BATCH_NOT_OPEN|Mẻ % đã đóng — mở lại mới sửa yêu cầu nguyên liệu được', b.batch_code; END IF;
  IF v_rid IS NOT NULL THEN
    SELECT * INTO r FROM production_recipe WHERE id = v_rid;
    IF NOT FOUND OR r.material_id <> b.material_id THEN RAISE EXCEPTION 'MESERR:RECIPE_MISMATCH|Công thức không thuộc mã bán thành phẩm của mẻ'; END IF;
    IF NOT r.is_active THEN RAISE EXCEPTION 'MESERR:RECIPE_INACTIVE|Công thức "%" đã ngừng dùng', r.name; END IF;
  ELSE
    SELECT * INTO r FROM production_recipe WHERE id = b.recipe_id AND material_id = b.material_id AND is_active;
    IF NOT FOUND THEN
      SELECT * INTO r FROM production_recipe WHERE material_id = b.material_id AND is_active ORDER BY is_default DESC, updated_at DESC LIMIT 1;
    END IF;
    IF NOT FOUND THEN
      UPDATE production_batch SET recipe_id = NULL WHERE id = b.id AND recipe_id IS NOT NULL;
      RETURN jsonb_build_object('count', 0, 'no_recipe', true);
    END IF;
  END IF;
  v_k := CASE WHEN b.planned_qty IS NOT NULL THEN b.planned_qty / r.base_qty ELSE 1 END;
  IF coalesce((p->>'replace')::boolean, false) THEN DELETE FROM batch_requirement WHERE batch_id = b.id; END IF;
  INSERT INTO batch_requirement (id, batch_id, material_id, qty_required, qty_standard, tol_pct, sort_order, note, updated_at, updated_by)
  SELECT gen_random_uuid()::text, b.id, l.material_id, GREATEST(round(l.qty * v_k, 3), 0.001), GREATEST(round(l.qty * v_k, 3), 0.001),
         l.tol_pct, l.sort_order, l.note, now(), p->>'actor_name'
    FROM production_recipe_line l WHERE l.recipe_id = r.id
  ON CONFLICT (batch_id, material_id) DO UPDATE SET qty_required = EXCLUDED.qty_required, qty_standard = EXCLUDED.qty_standard,
         tol_pct = EXCLUDED.tol_pct, sort_order = EXCLUDED.sort_order, note = EXCLUDED.note, removed_at = NULL, replaces_material_id = NULL,
         change_reason = NULL, changed_by_name = NULL, changed_at = NULL, updated_at = now(), updated_by = EXCLUDED.updated_by;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE production_batch SET recipe_id = r.id, updated_at = now() WHERE id = b.id;
  RETURN jsonb_build_object('count', v_n, 'no_recipe', false, 'factor', v_k, 'recipe_id', r.id, 'recipe_name', r.name);
END $$;

-- ── 6. SỬA PHIẾU CỦA MẺ — p: {batch_id, items:[{material_id, qty, note, replaces}], reason, actor_name}. Thay trọn danh sách:
--   dòng vắng mặt: dòng của công thức (có gốc) ⇒ BỎ MỀM kèm lý do; dòng tự thêm ⇒ xoá.
--   dòng có mặt: mới ⇒ thêm (gốc trống, có thể "thay cho" một mã của phiếu); đã có ⇒ cập nhật lượng, thôi "bỏ"; về đúng gốc ⇒ xoá dấu sửa.
--   Có thay đổi mà không lý do ⇒ REASON (không ghi gì).
CREATE OR REPLACE FUNCTION public.mes_batch_set_requirements(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  b        record;
  l        jsonb;
  cur      record;
  v_i      integer := 0;
  v_chg    integer := 0;
  v_qty    numeric;
  v_rep    text;
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_actor  text := p->>'actor_name';
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF b.status <> 'OPEN' THEN RAISE EXCEPTION 'MESERR:BATCH_NOT_OPEN|Mẻ % đã đóng — mở lại mới sửa yêu cầu nguyên liệu được', b.batch_code; END IF;
  IF (SELECT count(*) <> count(DISTINCT x->>'material_id') FROM jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) x) THEN
    RAISE EXCEPTION 'MESERR:DUPLICATE|Một nguyên liệu bị khai hai lần';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) x WHERE x->>'material_id' = b.material_id) THEN
    RAISE EXCEPTION 'MESERR:SELF|Yêu cầu không được chứa chính mã bán thành phẩm của mẻ';
  END IF;
  -- dòng đang hiệu lực mà danh sách mới không còn
  FOR cur IN SELECT * FROM batch_requirement WHERE batch_id = b.id AND removed_at IS NULL
                AND material_id NOT IN (SELECT x->>'material_id' FROM jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) x) LOOP
    v_chg := v_chg + 1;
    IF cur.qty_standard IS NULL THEN DELETE FROM batch_requirement WHERE id = cur.id;
    ELSE UPDATE batch_requirement SET removed_at = now(), change_reason = v_reason, changed_by_name = v_actor, changed_at = now(),
                updated_at = now(), updated_by = v_actor WHERE id = cur.id;
    END IF;
  END LOOP;
  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) LOOP
    v_i := v_i + 1;
    v_qty := (l->>'qty')::numeric;
    IF NOT EXISTS (SELECT 1 FROM "Material" WHERE id = l->>'material_id') THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Có nguyên liệu không còn trong danh mục'; END IF;
    SELECT * INTO cur FROM batch_requirement WHERE batch_id = b.id AND material_id = l->>'material_id';
    IF NOT FOUND THEN
      v_rep := nullif(l->>'replaces', '');
      IF v_rep IS NOT NULL AND NOT EXISTS (SELECT 1 FROM batch_requirement WHERE batch_id = b.id AND material_id = v_rep) THEN v_rep := NULL; END IF;
      INSERT INTO batch_requirement (id, batch_id, material_id, qty_required, qty_standard, sort_order, note, replaces_material_id,
                                     change_reason, changed_by_name, changed_at, updated_at, updated_by)
      VALUES (gen_random_uuid()::text, b.id, l->>'material_id', v_qty, NULL, v_i, nullif(btrim(coalesce(l->>'note', '')), ''), v_rep,
              v_reason, v_actor, now(), now(), v_actor);
      v_chg := v_chg + 1;
    ELSIF cur.removed_at IS NOT NULL OR cur.qty_required <> v_qty THEN
      v_chg := v_chg + 1;
      IF cur.qty_standard IS NOT NULL AND v_qty = cur.qty_standard AND cur.replaces_material_id IS NULL THEN
        -- về đúng định mức gốc ⇒ thôi dấu sửa
        UPDATE batch_requirement SET qty_required = v_qty, removed_at = NULL, change_reason = NULL, changed_by_name = NULL, changed_at = NULL,
               sort_order = v_i, updated_at = now(), updated_by = v_actor WHERE id = cur.id;
      ELSE
        UPDATE batch_requirement SET qty_required = v_qty, removed_at = NULL, change_reason = v_reason, changed_by_name = v_actor, changed_at = now(),
               sort_order = v_i, updated_at = now(), updated_by = v_actor WHERE id = cur.id;
      END IF;
    ELSE
      UPDATE batch_requirement SET sort_order = v_i WHERE id = cur.id AND sort_order <> v_i;
    END IF;
  END LOOP;
  IF v_chg > 0 AND v_reason IS NULL THEN RAISE EXCEPTION 'MESERR:REASON|Nhập lý do sửa định mức của mẻ'; END IF;
  UPDATE production_batch SET updated_at = now() WHERE id = b.id;
  RETURN jsonb_build_object('count', v_i, 'changed', v_chg);
END $$;

-- ── 7. BÀN LÀM VIỆC — thêm gốc / mức lệch / dấu sửa / bỏ mềm / đổi mã. required = NULL khi dòng đã bỏ.
CREATE OR REPLACE FUNCTION public.mes_batch_board(p_batch_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  b  record;
  v  jsonb;
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p_batch_id;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sort_order')::int, x->>'material_code'), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object(
             'material_id', m.id, 'material_code', m.material_code, 'material_name', m.short_name,
             'base_unit', m.base_unit, 'entry_unit', m.entry_unit, 'units_per_carton', m.units_per_carton,
             'required', CASE WHEN r.removed_at IS NULL THEN r.qty_required END, 'standard', r.qty_standard, 'tol_pct', r.tol_pct,
             'removed', r.removed_at IS NOT NULL, 'change_reason', r.change_reason, 'changed_by_name', r.changed_by_name, 'changed_at', r.changed_at,
             'replaces_code', rp.material_code, 'replaced_by_code', rb.material_code,
             'note', r.note, 'sort_order', COALESCE(r.sort_order, 100000),
             'consumed', COALESCE(c.qty, 0), 'lines', COALESCE(c.n, 0),
             'available', COALESCE(s.avail, 0), 'available_no_tem', COALESCE(s.avail_no_tem, 0), 'tem_pallets', COALESCE(s.tems, 0)) AS x
      FROM (SELECT material_id FROM batch_requirement WHERE batch_id = b.id
            UNION SELECT material_id FROM batch_consumption WHERE batch_id = b.id AND reversed_at IS NULL) k
      JOIN "Material" m ON m.id = k.material_id
      LEFT JOIN batch_requirement r ON r.batch_id = b.id AND r.material_id = k.material_id
      LEFT JOIN "Material" rp ON rp.id = r.replaces_material_id
      LEFT JOIN LATERAL (SELECT mm.material_code FROM batch_requirement x2 JOIN "Material" mm ON mm.id = x2.material_id
                          WHERE x2.batch_id = b.id AND x2.replaces_material_id = k.material_id AND x2.removed_at IS NULL LIMIT 1) rb ON true
      LEFT JOIN LATERAL (SELECT sum(qty) AS qty, count(*) AS n FROM batch_consumption
                          WHERE batch_id = b.id AND material_id = k.material_id AND reversed_at IS NULL) c ON true
      LEFT JOIN LATERAL (SELECT sum(z.av) AS avail, sum(z.av) FILTER (WHERE NOT z.tem) AS avail_no_tem, count(*) FILTER (WHERE z.tem) AS tems
                           FROM (SELECT COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0) AS av,
                                        upper(e.pallet_code) <> upper(m.material_code) AS tem
                                   FROM "InventoryEntry" e
                                  WHERE e.warehouse_id = b.warehouse_id AND e.material_id = k.material_id
                                    AND e.status IN ('IN_STOCK', 'PARTIAL') AND NOT qa_is_hold(e.qa_status_id)) z
                          WHERE z.av > 0) s ON true
  ) q;
  RETURN v;
END $$;

-- ── 8. SỬA KẾ HOẠCH / ĐỔI MÃ BTP ⇒ tính lại phiếu (C114) — nay theo CÔNG THỨC CỦA MẺ, nhân cả số gốc
CREATE OR REPLACE FUNCTION public.mes_batch_requirements_refresh(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  b       record;
  v_base  numeric;
  v_old   numeric;
  v_new   numeric;
  v_k     numeric;
  v_n     integer := 0;
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF coalesce((p->>'reset')::boolean, false) THEN
    DELETE FROM batch_requirement WHERE batch_id = b.id;
    UPDATE production_batch SET recipe_id = NULL WHERE id = b.id;   -- công thức cũ thuộc mã cũ
    IF b.status <> 'OPEN' THEN RETURN jsonb_build_object('mode', 'reset', 'count', 0); END IF;
    RETURN mes_batch_apply_recipe(jsonb_build_object('batch_id', b.id, 'actor_name', p->>'actor_name')) || jsonb_build_object('mode', 'reset');
  END IF;
  IF b.status <> 'OPEN' THEN RETURN jsonb_build_object('mode', 'scale', 'count', 0); END IF;
  SELECT base_qty INTO v_base FROM production_recipe WHERE id = b.recipe_id;
  IF v_base IS NULL THEN
    SELECT base_qty INTO v_base FROM production_recipe WHERE material_id = b.material_id AND is_active ORDER BY is_default DESC, updated_at DESC LIMIT 1;
  END IF;
  v_old := COALESCE(nullif(p->>'old_planned', '')::numeric, v_base);
  v_new := COALESCE(b.planned_qty, v_base);
  IF v_old IS NULL OR v_new IS NULL OR v_old <= 0 OR v_old = v_new THEN RETURN jsonb_build_object('mode', 'scale', 'count', 0); END IF;
  v_k := v_new / v_old;
  UPDATE batch_requirement SET qty_required = LEAST(GREATEST(round(qty_required * v_k, 3), 0.001), 10000000),
         qty_standard = CASE WHEN qty_standard IS NULL THEN NULL ELSE LEAST(GREATEST(round(qty_standard * v_k, 3), 0.001), 10000000) END,
         updated_at = now(), updated_by = p->>'actor_name'
   WHERE batch_id = b.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('mode', 'scale', 'count', v_n, 'factor', v_k);
END $$;

REVOKE ALL ON FUNCTION public.mes_recipe_save(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mes_batch_apply_recipe(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mes_batch_set_requirements(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mes_batch_board(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mes_batch_requirements_refresh(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_recipe_save(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mes_batch_apply_recipe(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mes_batch_set_requirements(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mes_batch_board(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mes_batch_requirements_refresh(jsonb) TO service_role;

COMMIT;
