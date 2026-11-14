-- MES 14/11 (đêm) — BÀN LÀM VIỆC CỦA MẺ (user: "hình dung có 1 bàn làm việc của mẻ đó — mẻ yêu cầu NVL như thế nào, số lượng bao nhiêu
-- thì user thao tác với bàn làm việc đó phải input thông tin vào đầy đủ"; "nếu có QR code thì phải quét QR code và điền số lượng").
--   • production_recipe (+ _line) — ĐỊNH MỨC nguyên liệu của một mã bán thành phẩm cho một cỡ mẻ chuẩn (một định mức / mã)
--   • batch_requirement           — YÊU CẦU nguyên liệu của MỘT mẻ: chép từ định mức × (kế hoạch / cỡ mẻ chuẩn) lúc mở mẻ, sửa được theo mẻ
--   • production_batch.cycle      — chu kỳ (biểu mẫu giấy ghi BTP / chu kỳ / mẻ)
--   • mes_consume_lot             — hàng CÓ TEM QR không đi được đường "chọn lô" (MESERR:MUST_SCAN); chỉ tồn gộp không tem mới chọn lô
--   • mes_stock                   — trả thêm phần không tem / số tem để màn hình biết dòng nào phải quét
--   • mes_batch_board             — bàn làm việc: mỗi nguyên liệu một dòng (yêu cầu · đã cấp · tồn kho chế biến) trong MỘT lời gọi
-- "Có tem" = mã tem khác mã hàng (tồn gộp theo NSX của kho QTY_DATE lưu pallet_code = mã hàng).
BEGIN;

ALTER TABLE public.production_batch ADD COLUMN IF NOT EXISTS cycle text CHECK (cycle IS NULL OR length(cycle) <= 20);

CREATE TABLE IF NOT EXISTS public.production_recipe (
  id           text PRIMARY KEY,
  material_id  text NOT NULL UNIQUE REFERENCES public."Material"(id),
  base_qty     numeric NOT NULL CHECK (base_qty > 0 AND base_qty <= 10000000),   -- cỡ mẻ chuẩn (đơn vị gốc của mã BTP)
  note         text CHECK (note IS NULL OR length(note) <= 500),
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL,
  updated_by   text
);
ALTER TABLE public.production_recipe ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.production_recipe_line (
  id           text PRIMARY KEY,
  recipe_id    text NOT NULL REFERENCES public.production_recipe(id) ON DELETE CASCADE,
  material_id  text NOT NULL REFERENCES public."Material"(id),
  qty          numeric NOT NULL CHECK (qty > 0 AND qty <= 10000000),
  sort_order   integer NOT NULL DEFAULT 0,
  note         text CHECK (note IS NULL OR length(note) <= 200),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL,
  UNIQUE (recipe_id, material_id)
);
ALTER TABLE public.production_recipe_line ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.batch_requirement (
  id            text PRIMARY KEY,
  batch_id      text NOT NULL REFERENCES public.production_batch(id),
  material_id   text NOT NULL REFERENCES public."Material"(id),
  qty_required  numeric NOT NULL CHECK (qty_required > 0 AND qty_required <= 10000000),
  sort_order    integer NOT NULL DEFAULT 0,
  note          text CHECK (note IS NULL OR length(note) <= 200),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL,
  updated_by    text,
  UNIQUE (batch_id, material_id)
);
ALTER TABLE public.batch_requirement ENABLE ROW LEVEL SECURITY;

-- LƯU ĐỊNH MỨC — p: {material_id, base_qty, note, is_active, lines:[{material_id, qty, note}], actor_name}. Thay trọn danh sách dòng.
CREATE OR REPLACE FUNCTION public.mes_recipe_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_mat  text := p->>'material_id';
  v_id   text;
  v_base numeric := (p->>'base_qty')::numeric;
  l      jsonb;
  v_i    integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Material" WHERE id = v_mat) THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mã bán thành phẩm'; END IF;
  IF v_base IS NULL OR v_base <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Cỡ mẻ chuẩn phải lớn hơn 0'; END IF;
  IF (SELECT count(*) <> count(DISTINCT x->>'material_id') FROM jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) x) THEN
    RAISE EXCEPTION 'MESERR:DUPLICATE|Một nguyên liệu bị khai hai lần trong định mức';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) x WHERE x->>'material_id' = v_mat) THEN
    RAISE EXCEPTION 'MESERR:SELF|Định mức không được chứa chính mã bán thành phẩm';
  END IF;
  SELECT id INTO v_id FROM production_recipe WHERE material_id = v_mat FOR UPDATE;
  IF v_id IS NULL THEN
    v_id := gen_random_uuid()::text;
    INSERT INTO production_recipe (id, material_id, base_qty, note, is_active, updated_at, updated_by)
    VALUES (v_id, v_mat, v_base, nullif(btrim(coalesce(p->>'note', '')), ''), coalesce((p->>'is_active')::boolean, true), now(), p->>'actor_name');
  ELSE
    UPDATE production_recipe SET base_qty = v_base, note = nullif(btrim(coalesce(p->>'note', '')), ''),
           is_active = coalesce((p->>'is_active')::boolean, is_active), updated_at = now(), updated_by = p->>'actor_name' WHERE id = v_id;
    DELETE FROM production_recipe_line WHERE recipe_id = v_id;
  END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) LOOP
    v_i := v_i + 1;
    IF NOT EXISTS (SELECT 1 FROM "Material" WHERE id = l->>'material_id') THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Có nguyên liệu không còn trong danh mục'; END IF;
    INSERT INTO production_recipe_line (id, recipe_id, material_id, qty, sort_order, note, updated_at)
    VALUES (gen_random_uuid()::text, v_id, l->>'material_id', (l->>'qty')::numeric, v_i, nullif(btrim(coalesce(l->>'note', '')), ''), now());
  END LOOP;
  RETURN jsonb_build_object('id', v_id, 'lines', v_i);
END $$;

-- CHÉP ĐỊNH MỨC VÀO MẺ — p: {batch_id, replace, actor_name}. Yêu cầu = dòng định mức × (kế hoạch / cỡ mẻ chuẩn); mẻ không kế hoạch ⇒ × 1.
CREATE OR REPLACE FUNCTION public.mes_batch_apply_recipe(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  b     record;
  r     record;
  v_k   numeric;
  v_n   integer := 0;
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF b.status <> 'OPEN' THEN RAISE EXCEPTION 'MESERR:BATCH_NOT_OPEN|Mẻ % đã đóng — mở lại mới sửa yêu cầu nguyên liệu được', b.batch_code; END IF;
  SELECT * INTO r FROM production_recipe WHERE material_id = b.material_id AND is_active;
  IF NOT FOUND THEN RETURN jsonb_build_object('count', 0, 'no_recipe', true); END IF;
  v_k := CASE WHEN b.planned_qty IS NOT NULL THEN b.planned_qty / r.base_qty ELSE 1 END;
  IF coalesce((p->>'replace')::boolean, false) THEN DELETE FROM batch_requirement WHERE batch_id = b.id; END IF;
  INSERT INTO batch_requirement (id, batch_id, material_id, qty_required, sort_order, note, updated_at, updated_by)
  SELECT gen_random_uuid()::text, b.id, l.material_id, GREATEST(round(l.qty * v_k, 3), 0.001), l.sort_order, l.note, now(), p->>'actor_name'
    FROM production_recipe_line l WHERE l.recipe_id = r.id
  ON CONFLICT (batch_id, material_id) DO UPDATE SET qty_required = EXCLUDED.qty_required, sort_order = EXCLUDED.sort_order,
         note = EXCLUDED.note, updated_at = now(), updated_by = EXCLUDED.updated_by;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('count', v_n, 'no_recipe', false, 'factor', v_k);
END $$;

-- ĐẶT LẠI YÊU CẦU CỦA MẺ — p: {batch_id, items:[{material_id, qty, note}], actor_name}. Thay trọn danh sách (dòng vắng mặt = bỏ yêu cầu).
CREATE OR REPLACE FUNCTION public.mes_batch_set_requirements(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  b    record;
  l    jsonb;
  v_i  integer := 0;
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
  DELETE FROM batch_requirement WHERE batch_id = b.id
     AND material_id NOT IN (SELECT x->>'material_id' FROM jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) x);
  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) LOOP
    v_i := v_i + 1;
    IF NOT EXISTS (SELECT 1 FROM "Material" WHERE id = l->>'material_id') THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Có nguyên liệu không còn trong danh mục'; END IF;
    INSERT INTO batch_requirement (id, batch_id, material_id, qty_required, sort_order, note, updated_at, updated_by)
    VALUES (gen_random_uuid()::text, b.id, l->>'material_id', (l->>'qty')::numeric, v_i, nullif(btrim(coalesce(l->>'note', '')), ''), now(), p->>'actor_name')
    ON CONFLICT (batch_id, material_id) DO UPDATE SET qty_required = EXCLUDED.qty_required, sort_order = EXCLUDED.sort_order,
           note = EXCLUDED.note, updated_at = now(), updated_by = EXCLUDED.updated_by;
  END LOOP;
  UPDATE production_batch SET updated_at = now() WHERE id = b.id;
  RETURN jsonb_build_object('count', v_i);
END $$;

-- BÀN LÀM VIỆC — mỗi nguyên liệu (có yêu cầu HOẶC đã cấp) một dòng: yêu cầu · đã cấp · tồn rút được ở kho chế biến (tách có tem / không tem)
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
             'required', r.qty_required, 'note', r.note, 'sort_order', COALESCE(r.sort_order, 100000),
             'consumed', COALESCE(c.qty, 0), 'lines', COALESCE(c.n, 0),
             'available', COALESCE(s.avail, 0), 'available_no_tem', COALESCE(s.avail_no_tem, 0), 'tem_pallets', COALESCE(s.tems, 0)) AS x
      FROM (SELECT material_id FROM batch_requirement WHERE batch_id = b.id
            UNION SELECT material_id FROM batch_consumption WHERE batch_id = b.id AND reversed_at IS NULL) k
      JOIN "Material" m ON m.id = k.material_id
      LEFT JOIN batch_requirement r ON r.batch_id = b.id AND r.material_id = k.material_id
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

CREATE OR REPLACE FUNCTION public.mes_consume_lot(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_wh    text := mes_open_batch_wh(p->>'batch_id');
  v_qty   numeric := (p->>'qty')::numeric;
  v_date  date := nullif(p->>'production_date', '')::date;
  v_lot   text := nullif(btrim(coalesce(p->>'batch_lot', '')), '');
  v_left  numeric;
  v_avail numeric := 0;
  v_take  numeric;
  v_new   numeric;
  v_id    text;
  v_rows  jsonb := '[]'::jsonb;
  v_code  text;
  v_tem   numeric;
  e       record;
BEGIN
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Số lượng rút phải lớn hơn 0'; END IF;
  v_left := v_qty;
  SELECT upper(material_code) INTO v_code FROM "Material" WHERE id = p->>'material_id';
  FOR e IN
    SELECT * FROM "InventoryEntry"
     WHERE warehouse_id = v_wh AND material_id = p->>'material_id'
       AND status IN ('IN_STOCK', 'PARTIAL')
       AND (production_date::date IS NOT DISTINCT FROM v_date)
       AND nullif(btrim(coalesce(batch, '')), '') IS NOT DISTINCT FROM v_lot   -- ĐÚNG lô đã chọn: lô không mã lô ≠ lô có mã lô cùng NSX
       AND NOT qa_is_hold(qa_status_id)
       AND COALESCE(cartons_remaining, cartons_imported, 0) - COALESCE(cartons_reserved, 0) > 0
       AND upper(pallet_code) = v_code   -- CHỈ hàng không có tem (tồn gộp, mã tem = mã hàng); hàng có tem QR phải quét
     ORDER BY expiry_date NULLS LAST, created_at, id
     FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0));
    v_new  := COALESCE(e.cartons_remaining, e.cartons_imported, 0) - v_take;
    UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = mes_entry_status(v_new, COALESCE(e.cartons_imported, 0)),
           updated_at = now() WHERE id = e.id;
    v_id := gen_random_uuid()::text;
    INSERT INTO batch_consumption (id, batch_id, entry_id, pallet_code, material_id, production_date, batch_lot, ncc_id,
           qty, source, created_by, created_by_name, created_at, updated_at)
    VALUES (v_id, p->>'batch_id', e.id, e.pallet_code, e.material_id, e.production_date::date, e.batch, e.ncc_id,
           v_take, 'LOT', p->>'actor_id', p->>'actor_name', now(), now());
    v_rows := v_rows || jsonb_build_object('id', v_id, 'entry_id', e.id, 'pallet_code', e.pallet_code, 'qty', v_take, 'remaining', v_new);
    v_avail := v_avail + v_take;
    v_left  := v_left - v_take;
  END LOOP;
  IF v_left > 0 THEN
    SELECT COALESCE(sum(COALESCE(cartons_remaining, cartons_imported, 0) - COALESCE(cartons_reserved, 0)), 0) INTO v_tem FROM "InventoryEntry"
     WHERE warehouse_id = v_wh AND material_id = p->>'material_id' AND status IN ('IN_STOCK', 'PARTIAL')
       AND (production_date::date IS NOT DISTINCT FROM v_date) AND nullif(btrim(coalesce(batch, '')), '') IS NOT DISTINCT FROM v_lot
       AND NOT qa_is_hold(qa_status_id) AND upper(pallet_code) <> v_code
       AND COALESCE(cartons_remaining, cartons_imported, 0) - COALESCE(cartons_reserved, 0) > 0;
    IF v_tem > 0 THEN
      RAISE EXCEPTION 'MESERR:MUST_SCAN|Lô này còn % nằm trên pallet / bao CÓ TEM QR — quét tem để cấp (chỉ hàng không có tem mới chọn lô bằng tay)', v_tem;
    END IF;
    RAISE EXCEPTION 'MESERR:SHORT|Lô đã chọn chỉ còn % có thể rút (cần %)', v_avail, v_qty;   -- huỷ cả giao dịch
  END IF;
  RETURN jsonb_build_object('rows', v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.mes_stock(p_wh text, p_material text DEFAULT NULL, p_search text DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_lim  int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_like text := '%' || like_esc(btrim(coalesce(p_search, ''))) || '%';
  v_out  jsonb;
BEGIN
  IF p_material IS NULL THEN
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'material_code'), '[]'::jsonb) INTO v_out FROM (
      SELECT jsonb_build_object('material_id', m.id, 'material_code', m.material_code, 'material_name', m.short_name,
               'base_unit', m.base_unit, 'entry_unit', m.entry_unit, 'units_per_carton', m.units_per_carton,
               'available', sum(COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0)),
               'available_no_tem', COALESCE(sum(COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0)) FILTER (WHERE upper(e.pallet_code) = upper(m.material_code)), 0),
               'lots', count(DISTINCT (e.production_date::date, e.batch))) AS x
        FROM "InventoryEntry" e JOIN "Material" m ON m.id = e.material_id
       WHERE e.warehouse_id = p_wh AND e.status IN ('IN_STOCK', 'PARTIAL') AND NOT qa_is_hold(e.qa_status_id)
         AND COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0) > 0
         AND (btrim(coalesce(p_search, '')) = '' OR m.material_code ILIKE v_like OR m.short_name ILIKE v_like OR m.material_description ILIKE v_like)
       GROUP BY m.id
       ORDER BY m.material_code
       LIMIT v_lim) s;
    RETURN jsonb_build_object('materials', v_out);
  END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'expiry_date') NULLS LAST, (x->>'production_date') NULLS LAST), '[]'::jsonb) INTO v_out FROM (
    SELECT jsonb_build_object('production_date', e.production_date::date, 'batch_lot', e.batch,
             'expiry_date', min(e.expiry_date),
             'available', sum(COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0)),
             'available_no_tem', COALESCE(sum(COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0)) FILTER (WHERE upper(e.pallet_code) = upper(m.material_code)), 0),
             'tem_pallets', count(*) FILTER (WHERE upper(e.pallet_code) <> upper(m.material_code)),
             'pallets', count(*)) AS x
      FROM "InventoryEntry" e JOIN "Material" m ON m.id = e.material_id
     WHERE e.warehouse_id = p_wh AND e.material_id = p_material AND e.status IN ('IN_STOCK', 'PARTIAL') AND NOT qa_is_hold(e.qa_status_id)
       AND COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0) > 0
     GROUP BY e.production_date::date, e.batch
     LIMIT 500) s;
  RETURN jsonb_build_object('lots', v_out);
END $$;

CREATE OR REPLACE FUNCTION public.mes_batch_page(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public
SET plan_cache_mode = force_custom_plan AS $$
DECLARE
  v_wh    text[] := ARRAY(SELECT jsonb_array_elements_text(coalesce(p->'wh_ids', '[]'::jsonb)));
  v_st    text := nullif(p->>'status', '');
  v_qa    text := nullif(p->>'qa', '');
  v_from  date := nullif(p->>'date_from', '')::date;
  v_to    date := nullif(p->>'date_to', '')::date;
  v_q     text := nullif(btrim(coalesce(p->>'search', '')), '');
  v_size  int  := least(greatest(coalesce((p->>'page_size')::int, 100), 1), 1000);
  v_page  int  := greatest(coalesce((p->>'page')::int, 1), 1);
  v_like  text;
  v_rows  jsonb;
  v_sum   jsonb;
BEGIN
  v_like := '%' || like_esc(coalesce(v_q, '')) || '%';
  WITH f AS (
    SELECT b.* FROM production_batch b
     WHERE b.warehouse_id = ANY(v_wh)
       AND (v_from IS NULL OR b.prod_date >= v_from) AND (v_to IS NULL OR b.prod_date <= v_to)
       AND (v_q IS NULL OR b.batch_code ILIKE v_like
            OR EXISTS (SELECT 1 FROM "Material" m WHERE m.id = b.material_id AND (m.material_code ILIKE v_like OR m.short_name ILIKE v_like)))
  )
  SELECT jsonb_build_object(
           'total',     count(*) FILTER (WHERE (v_st IS NULL OR status = v_st) AND (v_qa IS NULL OR qa_status = v_qa)),
           'open',      count(*) FILTER (WHERE status = 'OPEN'),
           'closed',    count(*) FILTER (WHERE status = 'CLOSED'),
           'cancelled', count(*) FILTER (WHERE status = 'CANCELLED'),
           'qa_hold',   count(*) FILTER (WHERE qa_status = 'HOLD' AND status <> 'CANCELLED'),
           'qa_released', count(*) FILTER (WHERE qa_status = 'RELEASED' AND status <> 'CANCELLED'),
           'qa_rejected', count(*) FILTER (WHERE qa_status = 'REJECTED' AND status <> 'CANCELLED'))
    INTO v_sum FROM f;

  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'prod_date') DESC, r->>'batch_code' DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
             'id', b.id, 'warehouse_id', b.warehouse_id, 'warehouse_name', w.name, 'batch_code', b.batch_code,
             'material_id', b.material_id, 'material_code', m.material_code, 'material_name', m.short_name, 'base_unit', m.base_unit,
             'machine_code', b.machine_code, 'shift', b.shift, 'cycle', b.cycle, 'prod_date', b.prod_date, 'planned_qty', b.planned_qty,
             'status', b.status, 'qa_status', b.qa_status, 'qa_at', b.qa_at, 'qa_by_name', b.qa_by_name,
             'note', b.note, 'opened_by_name', b.opened_by_name, 'created_at', b.created_at, 'closed_at', b.closed_at,
             'rm_lines', (SELECT count(*) FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL),
             'rm_materials', (SELECT count(DISTINCT c.material_id) FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL),
             'filled', (SELECT COALESCE(sum(mv.qty), 0) FROM tank_movement mv WHERE mv.batch_id = b.id AND mv.kind = 'FILL'),
             'in_tank', (SELECT COALESCE(sum(l.qty_remaining), 0) FROM tank_lot l WHERE l.batch_id = b.id AND l.status = 'ACTIVE')
           ) AS r
      FROM production_batch b
      JOIN "Warehouse" w ON w.id = b.warehouse_id
      JOIN "Material" m ON m.id = b.material_id
     WHERE b.warehouse_id = ANY(v_wh)
       AND (v_st IS NULL OR b.status = v_st) AND (v_qa IS NULL OR b.qa_status = v_qa)
       AND (v_from IS NULL OR b.prod_date >= v_from) AND (v_to IS NULL OR b.prod_date <= v_to)
       AND (v_q IS NULL OR b.batch_code ILIKE v_like OR m.material_code ILIKE v_like OR m.short_name ILIKE v_like)
     ORDER BY b.prod_date DESC, b.batch_code DESC
     OFFSET (v_page - 1) * v_size LIMIT v_size
  ) s;
  RETURN jsonb_build_object('rows', v_rows, 'summary', v_sum, 'page', v_page, 'page_size', v_size);
END $$;

REVOKE ALL ON FUNCTION public.mes_recipe_save(jsonb), public.mes_batch_apply_recipe(jsonb), public.mes_batch_set_requirements(jsonb),
  public.mes_batch_board(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_recipe_save(jsonb), public.mes_batch_apply_recipe(jsonb), public.mes_batch_set_requirements(jsonb),
  public.mes_batch_board(text) TO service_role;

-- Quyền production.manage_recipe (khai định mức) — theo năng lực: chức danh đã cấu hình được MES; đã có thì không đè
UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(j.module_permissions, '{production}', (j.module_permissions->'production') || '["manage_recipe"]'::jsonb, true),
       updated_at = now()
 WHERE j.module_permissions->'production' ? 'configure'
   AND NOT (j.module_permissions->'production' ? 'manage_recipe');

COMMIT;
