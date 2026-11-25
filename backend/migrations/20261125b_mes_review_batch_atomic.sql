-- Rà soát MES 25/11 (docs/plans/MES_REVIEW_2026-11-25.md) — ĐỢT 2: sửa mẻ / bồn trong MỘT giao dịch.
--   B4  updateBatch ghi patch (kế hoạch / mã / ngày / ca) rồi mới gọi mes_batch_identity — lỗi sau đó ⇒ mẻ giữ kế hoạch / mã mới chưa kiểm
--       chỗ; lưu lại lần sau thì không còn "đổi" ⇒ bàn NVL KHÔNG BAO GIỜ tính lại. Nay mes_batch_update làm hết trong một giao dịch:
--       khoá BỒN (cũ + mới) rồi MẺ (cùng thứ tự với mes_tank_fill / mes_batch_create ⇒ không khoá chéo), kiểm, ghi, đổi mã lô, tính lại
--       bàn, đặt phiếu bổ sung (F9 — nhận luôn extra_forms). Lỗi ở bất kỳ bước nào ⇒ không ghi gì.
--   B3  createBatch nuốt lỗi áp công thức / gắn phiếu và vẫn trả 201 ⇒ mes_batch_create gọi hai bước đó BÊN TRONG.
--   B2  số mẻ tự lấy va mã lô của mẻ đã huỷ cùng bồn ⇒ hàm chung mes_next_batch_no (nhảy qua mã đã dùng) cho cả mes_batch_create lẫn
--       route next-code. KHÔNG đổi luật "số của mẻ huỷ dùng lại được ở bồn khác" (max vẫn bỏ mẻ huỷ).
--   G2  mes_batch_set_requirements / mes_batch_apply_recipe / mes_batch_requirements_refresh chặn QA đã duyệt SAU khoá mẻ (trước chỉ
--       controller kiểm trước khoá ⇒ đua với QA bấm duyệt).
--   G3  hai bước duyệt phiếu thành mes_batch_approve (khoá mẻ; QA bỏ duyệt kiểm "đã nạp bồn" sau khoá — đua với mes_tank_fill).
--   B6  mes_tank_transfer chặn bồn đích đã ĐẶT cho mẻ mã khác (user chốt 25/11: chỉ chặn trộn mã, đủ chỗ vẫn theo lượng thực chứa).
--   B8  sửa bồn thành mes_tank_update (khoá bồn): không đổi đơn vị / ngừng dùng khi bồn còn hàng HOẶC đã đặt cho mẻ chưa nạp.
BEGIN;

-- ── B2: số mẻ kế tiếp — MỘT luật cho form (next-code) và hàm tạo mẻ ──
CREATE OR REPLACE FUNCTION public.mes_next_batch_no(p_wh text, p_cycle text, p_tank text) RETURNS integer
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE v_no integer;
BEGIN
  SELECT COALESCE(max(batch_no), 0) + 1 INTO v_no FROM production_batch
   WHERE warehouse_id = p_wh AND cycle = p_cycle AND status <> 'CANCELLED';
  -- mã lô ghép ra trùng mẻ đã huỷ trên CÙNG bồn ⇒ nhảy số (mã lô là duy nhất trong kho, kể cả mẻ huỷ)
  IF p_tank IS NOT NULL AND coalesce(mes_plant_letter(p_wh), '') <> '' AND p_cycle ~ '^[A-Z0-9]{1,6}$' THEN
    WHILE v_no < 9999 AND EXISTS (SELECT 1 FROM production_batch WHERE warehouse_id = p_wh AND batch_code = mes_batch_code(p_wh, p_cycle, v_no, p_tank)) LOOP
      v_no := v_no + 1;
    END LOOP;
  END IF;
  RETURN LEAST(v_no, 9999);
END $$;
REVOKE ALL ON FUNCTION public.mes_next_batch_no(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_next_batch_no(text, text, text) TO service_role;

-- ── G2: ba cửa ghi bàn NVL chặn QA đã duyệt SAU khoá mẻ ──
CREATE OR REPLACE FUNCTION public.mes_batch_apply_recipe(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
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
  IF b.qa_ok_at IS NOT NULL THEN RAISE EXCEPTION 'MESERR:APPROVED|QA đã duyệt phiếu của mẻ — bỏ duyệt rồi mới sửa được'; END IF;
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

CREATE OR REPLACE FUNCTION public.mes_batch_set_requirements(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
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
  IF b.qa_ok_at IS NOT NULL THEN RAISE EXCEPTION 'MESERR:APPROVED|QA đã duyệt phiếu của mẻ — bỏ duyệt rồi mới sửa được'; END IF;
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

CREATE OR REPLACE FUNCTION public.mes_batch_requirements_refresh(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
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
  IF b.status = 'OPEN' AND b.qa_ok_at IS NOT NULL THEN RAISE EXCEPTION 'MESERR:APPROVED|QA đã duyệt phiếu của mẻ — bỏ duyệt rồi mới sửa được'; END IF;
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

-- ── B2 + B3: tạo mẻ — số kế tiếp theo hàm chung; áp công thức + phiếu bổ sung TRONG cùng giao dịch ──
CREATE OR REPLACE FUNCTION public.mes_batch_create(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_wh    text := p->>'warehouse_id';
  v_cycle text := upper(btrim(coalesce(p->>'cycle', '')));
  v_no    integer := nullif(p->>'batch_no', '')::integer;
  v_tank  text := p->>'tank_id';
  v_plan  numeric := nullif(p->>'planned_qty', '')::numeric;
  v_code  text;
  v_id    text := gen_random_uuid()::text;
  v_dup   text;
  v_ap    jsonb;
BEGIN
  PERFORM 1 FROM production_tank WHERE id = v_tank FOR UPDATE;
  PERFORM mes_tank_room_check(v_tank, v_wh, p->>'material_id', v_plan, NULL);
  IF v_no IS NULL THEN v_no := mes_next_batch_no(v_wh, v_cycle, v_tank); END IF;
  v_code := mes_batch_code(v_wh, v_cycle, v_no, v_tank);
  SELECT status INTO v_dup FROM production_batch WHERE warehouse_id = v_wh AND batch_code = v_code;
  IF v_dup = 'CANCELLED' THEN RAISE EXCEPTION 'MESERR:CODE_USED|Mã lô % đã dùng cho một mẻ đã huỷ — chọn số mẻ khác', v_code; END IF;
  INSERT INTO production_batch (id, warehouse_id, batch_code, material_id, prod_date, machine_code, shift, cycle, batch_no, tank_id, planned_qty, note,
                                status, qa_status, opened_by, opened_by_name, created_at, updated_at)
  VALUES (v_id, v_wh, v_code, p->>'material_id', (p->>'prod_date')::date, nullif(p->>'machine_code', ''), nullif(p->>'shift', ''), v_cycle, v_no, v_tank,
          v_plan, nullif(p->>'note', ''), 'OPEN', 'HOLD', p->>'actor_id', p->>'actor_name', now(), now());
  -- bàn làm việc: chép ĐỊNH MỨC (công thức chọn hoặc mặc định) — lỗi ⇒ không tạo mẻ (trước đây nuốt lỗi, trả 201 với bàn trống)
  v_ap := mes_batch_apply_recipe(jsonb_build_object('batch_id', v_id, 'recipe_id', nullif(p->>'recipe_id', ''), 'actor_name', p->>'actor_name'));
  PERFORM mes_batch_set_forms(jsonb_build_object('batch_id', v_id)
    || CASE WHEN jsonb_typeof(p->'extra_forms') = 'array' THEN jsonb_build_object('forms', p->'extra_forms') ELSE '{}'::jsonb END);
  UPDATE production_tank SET updated_at = now() WHERE id = v_tank;   -- sơ đồ bồn thấy ngay phần "đã đặt"
  RETURN (SELECT to_jsonb(b) FROM production_batch b WHERE b.id = v_id) || jsonb_build_object('requirement_count', coalesce((v_ap->>'count')::int, 0));
END $$;

-- ── B4 + F9: sửa mẻ — MỘT giao dịch ──
CREATE OR REPLACE FUNCTION public.mes_batch_update(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  b          record;
  v_tank_old text;
  v_tank_new text;
  v_mat      text;
  v_plan     numeric;
  v_mat_chg  boolean;
  v_plan_chg boolean;
  v_id_chg   boolean;
  v_ident    jsonb := '{}'::jsonb;
BEGIN
  SELECT tank_id INTO v_tank_old FROM production_batch WHERE id = p->>'batch_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  v_tank_new := CASE WHEN p ? 'tank_id' THEN p->>'tank_id' ELSE v_tank_old END;
  -- khoá BỒN rồi mới tới MẺ — cùng thứ tự với mes_tank_fill / mes_batch_create ⇒ không khoá chéo
  PERFORM 1 FROM production_tank WHERE id IN (v_tank_old, v_tank_new) ORDER BY id FOR UPDATE;
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR UPDATE;
  IF b.tank_id IS DISTINCT FROM v_tank_old THEN RAISE EXCEPTION 'MESERR:BUSY|Mẻ vừa được người khác đổi bồn — tải lại rồi sửa'; END IF;
  IF b.status = 'CANCELLED' THEN RAISE EXCEPTION 'MESERR:BATCH_CANCELLED|Mẻ đã huỷ — không sửa được'; END IF;
  v_mat  := CASE WHEN p ? 'material_id' THEN p->>'material_id' ELSE b.material_id END;
  v_plan := CASE WHEN p ? 'planned_qty' THEN nullif(p->>'planned_qty', '')::numeric ELSE b.planned_qty END;
  v_mat_chg  := v_mat IS DISTINCT FROM b.material_id;
  v_plan_chg := v_plan IS DISTINCT FROM b.planned_qty;
  IF (v_mat_chg OR v_plan_chg) AND b.qa_ok_at IS NOT NULL THEN
    RAISE EXCEPTION 'MESERR:APPROVED|QA đã duyệt phiếu của mẻ — bỏ duyệt rồi mới sửa được';
  END IF;
  IF v_mat_chg AND (EXISTS (SELECT 1 FROM batch_consumption WHERE batch_id = b.id AND reversed_at IS NULL)
                    OR EXISTS (SELECT 1 FROM tank_movement WHERE batch_id = b.id)) THEN
    RAISE EXCEPTION 'MESERR:BATCH_LOCKED|Mẻ đã có NVL rút vào hoặc đã nạp bồn — không đổi được mã bán thành phẩm (chuỗi truy xuất đã ghi theo mã cũ)';
  END IF;
  UPDATE production_batch SET
    material_id  = v_mat,
    planned_qty  = v_plan,
    prod_date    = CASE WHEN p ? 'prod_date' THEN (p->>'prod_date')::date ELSE prod_date END,
    machine_code = CASE WHEN p ? 'machine_code' THEN nullif(upper(btrim(coalesce(p->>'machine_code', ''))), '') ELSE machine_code END,
    shift        = CASE WHEN p ? 'shift' THEN nullif(btrim(coalesce(p->>'shift', '')), '') ELSE shift END,
    note         = CASE WHEN p ? 'note' THEN nullif(btrim(coalesce(p->>'note', '')), '') ELSE note END,
    updated_at   = now()
  WHERE id = b.id;
  -- chu kỳ / số mẻ / bồn ⇒ mes_batch_identity (đọc lại mẻ ⇒ kiểm chỗ ở bồn MỚI theo kế hoạch / mã MỚI)
  v_id_chg := (p ? 'cycle' AND upper(btrim(coalesce(p->>'cycle', ''))) IS DISTINCT FROM b.cycle)
           OR (p ? 'batch_no' AND nullif(p->>'batch_no', '')::integer IS DISTINCT FROM b.batch_no)
           OR (v_tank_new IS DISTINCT FROM b.tank_id);
  IF v_id_chg THEN
    v_ident := mes_batch_identity(jsonb_build_object('batch_id', b.id)
      || CASE WHEN p ? 'cycle' THEN jsonb_build_object('cycle', p->'cycle') ELSE '{}'::jsonb END
      || CASE WHEN p ? 'batch_no' THEN jsonb_build_object('batch_no', p->'batch_no') ELSE '{}'::jsonb END
      || CASE WHEN p ? 'tank_id' THEN jsonb_build_object('tank_id', p->'tank_id') ELSE '{}'::jsonb END);
  END IF;
  -- kế hoạch / mã đổi mà bồn giữ nguyên ⇒ vẫn phải vừa bồn (mẻ chưa nạp)
  IF (v_mat_chg OR v_plan_chg) AND v_tank_new IS NOT DISTINCT FROM b.tank_id AND b.tank_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM tank_movement WHERE batch_id = b.id AND kind = 'FILL') THEN
    PERFORM mes_tank_room_check(b.tank_id, b.warehouse_id, v_mat, v_plan, b.id);
  END IF;
  -- bàn làm việc theo kịp mẻ (C114): đổi mã ⇒ chép định mức mã mới; đổi kế hoạch ⇒ nhân theo tỷ lệ
  IF v_mat_chg OR v_plan_chg THEN
    PERFORM mes_batch_requirements_refresh(jsonb_build_object('batch_id', b.id, 'reset', v_mat_chg, 'old_planned', b.planned_qty, 'actor_name', p->>'actor_name'));
  END IF;
  -- phiếu bổ sung: gửi kèm ⇒ đặt đúng danh sách; đổi mã mà không gửi ⇒ mặc định theo mã mới (phiếu đã ghi giữ nguyên)
  IF jsonb_typeof(p->'extra_forms') = 'array' THEN
    PERFORM mes_batch_set_forms(jsonb_build_object('batch_id', b.id, 'forms', p->'extra_forms'));
  ELSIF v_mat_chg THEN
    PERFORM mes_batch_set_forms(jsonb_build_object('batch_id', b.id));
  END IF;
  RETURN (SELECT to_jsonb(x) FROM production_batch x WHERE x.id = b.id) || jsonb_build_object('relabel', coalesce((v_ident->>'relabel')::boolean, false));
END $$;
REVOKE ALL ON FUNCTION public.mes_batch_update(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_batch_update(jsonb) TO service_role;

-- ── G3: hai bước duyệt phiếu — khoá mẻ rồi mới kiểm ──
CREATE OR REPLACE FUNCTION public.mes_batch_approve(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  b      record;
  v_step text := p->>'step';
  v_ok   boolean := coalesce((p->>'approve')::boolean, false);
  v_busy text := 'MESERR:BATCH_STATUS|Phiếu vừa được người khác duyệt / bỏ duyệt — tải lại';
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR UPDATE;   -- chờ lượt nạp bồn đang chạy (mes_tank_fill giữ FOR NO KEY UPDATE)
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF b.status <> 'OPEN' THEN RAISE EXCEPTION 'MESERR:BATCH_STATUS|Mẻ không còn mở'; END IF;
  IF v_step = 'lead' AND v_ok THEN
    IF b.lead_ok_at IS NOT NULL THEN RAISE EXCEPTION '%', v_busy; END IF;
    IF NOT EXISTS (SELECT 1 FROM batch_requirement WHERE batch_id = b.id AND removed_at IS NULL) THEN
      RAISE EXCEPTION 'MESERR:EMPTY_SHEET|Phiếu của mẻ chưa có nguyên liệu nào — khai nguyên liệu rồi mới duyệt';
    END IF;
    UPDATE production_batch SET lead_ok_at = now(), lead_ok_by = p->>'actor_id', lead_ok_by_name = p->>'actor_name', updated_at = now() WHERE id = b.id;
  ELSIF v_step = 'lead' THEN
    IF b.lead_ok_at IS NULL THEN RAISE EXCEPTION '%', v_busy; END IF;
    IF b.qa_ok_at IS NOT NULL THEN RAISE EXCEPTION 'MESERR:APPROVED|QA đã duyệt — QA bỏ duyệt trước'; END IF;
    UPDATE production_batch SET lead_ok_at = NULL, lead_ok_by = NULL, lead_ok_by_name = NULL, updated_at = now() WHERE id = b.id;
  ELSIF v_step = 'qa' AND v_ok THEN
    IF b.qa_ok_at IS NOT NULL THEN RAISE EXCEPTION '%', v_busy; END IF;
    IF b.lead_ok_at IS NULL THEN RAISE EXCEPTION 'MESERR:NOT_APPROVED|Trưởng ca chưa duyệt phiếu'; END IF;
    UPDATE production_batch SET qa_ok_at = now(), qa_ok_by = p->>'actor_id', qa_ok_by_name = p->>'actor_name', updated_at = now() WHERE id = b.id;
  ELSIF v_step = 'qa' THEN
    IF b.qa_ok_at IS NULL THEN RAISE EXCEPTION '%', v_busy; END IF;
    IF EXISTS (SELECT 1 FROM tank_movement WHERE batch_id = b.id) THEN RAISE EXCEPTION 'MESERR:FILLED|Mẻ đã nạp bồn — không bỏ duyệt được nữa'; END IF;
    UPDATE production_batch SET qa_ok_at = NULL, qa_ok_by = NULL, qa_ok_by_name = NULL, updated_at = now() WHERE id = b.id;
  ELSE
    RAISE EXCEPTION 'MESERR:KIND|Bước duyệt không hợp lệ';
  END IF;
  RETURN (SELECT to_jsonb(x) FROM production_batch x WHERE x.id = b.id);
END $$;
REVOKE ALL ON FUNCTION public.mes_batch_approve(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_batch_approve(jsonb) TO service_role;

-- ── B6: chuyển bồn — bồn đích đã ĐẶT cho mẻ mã khác ⇒ chặn trộn mã ──
CREATE OR REPLACE FUNCTION public.mes_tank_transfer(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  a       record;
  b       record;
  part    jsonb;
  v_qty   numeric := (p->>'qty')::numeric;
  v_cur   numeric;
  v_other text;
  v_mat   text;
  v_take  jsonb;
  v_lot   text;
BEGIN
  IF p->>'from_tank_id' = p->>'to_tank_id' THEN RAISE EXCEPTION 'MESERR:SAME_TANK|Chọn hai bồn khác nhau'; END IF;
  -- khoá hai bồn theo thứ tự id ⇒ hai lệnh chuyển ngược chiều không khoá chéo nhau
  PERFORM 1 FROM production_tank WHERE id IN (p->>'from_tank_id', p->>'to_tank_id') ORDER BY id FOR UPDATE;
  SELECT * INTO a FROM production_tank WHERE id = p->>'from_tank_id';
  SELECT * INTO b FROM production_tank WHERE id = p->>'to_tank_id';
  IF a.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy bồn'; END IF;
  IF NOT b.is_active THEN RAISE EXCEPTION 'MESERR:TANK_INACTIVE|Bồn % đang ngừng dùng', b.code; END IF;
  IF a.warehouse_id <> b.warehouse_id THEN RAISE EXCEPTION 'MESERR:WRONG_WAREHOUSE|Hai bồn phải cùng một kho'; END IF;
  IF a.unit <> b.unit THEN RAISE EXCEPTION 'MESERR:UNIT|Hai bồn khác đơn vị (% / %)', a.unit, b.unit; END IF;
  SELECT DISTINCT ob.material_id INTO v_mat FROM tank_lot l JOIN production_batch ob ON ob.id = l.batch_id
   WHERE l.tank_id = a.id AND l.status = 'ACTIVE' LIMIT 1;
  SELECT m.material_code INTO v_other FROM tank_lot l JOIN production_batch ob ON ob.id = l.batch_id JOIN "Material" m ON m.id = ob.material_id
   WHERE l.tank_id = b.id AND l.status = 'ACTIVE' AND ob.material_id <> v_mat LIMIT 1;
  IF v_other IS NOT NULL THEN RAISE EXCEPTION 'MESERR:MIX_MATERIAL|Bồn % đang chứa mã % — không trộn mã khác', b.code, v_other; END IF;
  -- 25/11 (B6): bồn đích đã đặt cho mẻ CHƯA NẠP mang mã khác (mẻ gắn bồn từ lúc mở, tem in theo bồn) ⇒ chặn, như lúc mở mẻ
  SELECT ob.batch_code INTO v_other FROM production_batch ob
   WHERE ob.tank_id = b.id AND ob.status = 'OPEN' AND ob.material_id <> v_mat
     AND NOT EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = ob.id AND mv.kind = 'FILL') LIMIT 1;
  IF v_other IS NOT NULL THEN RAISE EXCEPTION 'MESERR:MIX_MATERIAL|Bồn % đã đặt cho mẻ % (mã khác) — chọn bồn khác', b.code, v_other; END IF;
  SELECT COALESCE(sum(qty_remaining), 0) INTO v_cur FROM tank_lot WHERE tank_id = b.id AND status = 'ACTIVE';
  IF v_cur + v_qty > b.capacity THEN
    RAISE EXCEPTION 'MESERR:OVER_CAPACITY|Bồn % chỉ còn chỗ cho % %', b.code, b.capacity - v_cur, b.unit;
  END IF;
  v_take := mes_tank_take(jsonb_build_object('tank_id', a.id, 'qty', v_qty, 'kind', 'TRANSFER_OUT', 'ref_tank_id', b.id,
              'reason', p->>'reason', 'actor_id', p->>'actor_id', 'actor_name', p->>'actor_name'));
  FOR part IN SELECT * FROM jsonb_array_elements(v_take->'parts') LOOP
    SELECT id INTO v_lot FROM tank_lot WHERE tank_id = b.id AND batch_id = part->>'batch_id' AND status = 'ACTIVE' FOR UPDATE;
    IF v_lot IS NULL THEN
      v_lot := gen_random_uuid()::text;
      INSERT INTO tank_lot (id, tank_id, batch_id, qty_in, qty_remaining, filled_at, expires_at, status, created_at, updated_at)
      VALUES (v_lot, b.id, part->>'batch_id', (part->>'qty')::numeric, (part->>'qty')::numeric,
              (part->>'filled_at')::timestamptz, nullif(part->>'expires_at', '')::timestamptz, 'ACTIVE', now(), now());
    ELSE
      UPDATE tank_lot SET qty_in = qty_in + (part->>'qty')::numeric, qty_remaining = qty_remaining + (part->>'qty')::numeric,
             -- trộn với phần cũ hơn ⇒ hạn lưu theo phần CŨ NHẤT (đi kèm sớm nhất)
             filled_at = LEAST(filled_at, (part->>'filled_at')::timestamptz),
             expires_at = CASE WHEN expires_at IS NULL THEN nullif(part->>'expires_at', '')::timestamptz
                               WHEN nullif(part->>'expires_at', '') IS NULL THEN expires_at
                               ELSE LEAST(expires_at, (part->>'expires_at')::timestamptz) END,
             updated_at = now() WHERE id = v_lot;
    END IF;
    INSERT INTO tank_movement (id, tank_id, tank_lot_id, batch_id, kind, qty, ref_tank_id, reason, created_by, created_by_name, created_at, updated_at)
    VALUES (gen_random_uuid()::text, b.id, v_lot, part->>'batch_id', 'TRANSFER_IN', (part->>'qty')::numeric, a.id,
            nullif(left(btrim(coalesce(p->>'reason', '')), 500), ''), p->>'actor_id', p->>'actor_name', now(), now());
  END LOOP;
  UPDATE production_tank SET updated_at = now() WHERE id = b.id;
  RETURN jsonb_build_object('parts', v_take->'parts');
END $$;

-- ── B8: sửa bồn — khoá bồn; bồn còn hàng HOẶC đã đặt cho mẻ chưa nạp thì không đổi đơn vị / không ngừng dùng ──
CREATE OR REPLACE FUNCTION public.mes_tank_update(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  t      record;
  v_cur  numeric;
  v_code text;
BEGIN
  SELECT * INTO t FROM production_tank WHERE id = p->>'tank_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy bồn'; END IF;
  SELECT COALESCE(sum(qty_remaining), 0) INTO v_cur FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE';
  SELECT ob.batch_code INTO v_code FROM production_batch ob
   WHERE ob.tank_id = t.id AND ob.status = 'OPEN' AND NOT EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = ob.id AND mv.kind = 'FILL')
   ORDER BY ob.created_at LIMIT 1;
  IF p ? 'unit' AND p->>'unit' IS DISTINCT FROM t.unit THEN
    IF v_cur > 0 THEN RAISE EXCEPTION 'MESERR:TANK_NOT_EMPTY|Bồn đang có hàng — không đổi đơn vị được'; END IF;
    IF v_code IS NOT NULL THEN RAISE EXCEPTION 'MESERR:TANK_NOT_EMPTY|Bồn đã đặt cho mẻ % (chưa nạp) — không đổi đơn vị được; đổi bồn của mẻ trước', v_code; END IF;
  END IF;
  IF p ? 'capacity' AND (p->>'capacity')::numeric < v_cur THEN
    RAISE EXCEPTION 'MESERR:TANK_NOT_EMPTY|Bồn đang chứa % % — sức chứa không được nhỏ hơn', v_cur, t.unit;
  END IF;
  IF p ? 'is_active' AND NOT coalesce((p->>'is_active')::boolean, true) THEN
    IF v_cur > 0 THEN RAISE EXCEPTION 'MESERR:TANK_NOT_EMPTY|Bồn đang có hàng — rút / chuyển / xả hết trước khi ngừng dùng'; END IF;
    IF v_code IS NOT NULL THEN RAISE EXCEPTION 'MESERR:TANK_NOT_EMPTY|Bồn đã đặt cho mẻ % (chưa nạp) — đổi bồn của mẻ trước khi ngừng dùng', v_code; END IF;
  END IF;
  UPDATE production_tank SET
    name      = CASE WHEN p ? 'name' THEN nullif(btrim(coalesce(p->>'name', '')), '') ELSE name END,
    capacity  = CASE WHEN p ? 'capacity' THEN (p->>'capacity')::numeric ELSE capacity END,
    unit      = CASE WHEN p ? 'unit' THEN p->>'unit' ELSE unit END,
    is_active = CASE WHEN p ? 'is_active' THEN (p->>'is_active')::boolean ELSE is_active END,
    note      = CASE WHEN p ? 'note' THEN nullif(btrim(coalesce(p->>'note', '')), '') ELSE note END,
    updated_at = now(), updated_by = p->>'actor_name'
  WHERE id = t.id;
  RETURN (SELECT to_jsonb(x) FROM production_tank x WHERE x.id = t.id);
END $$;
REVOKE ALL ON FUNCTION public.mes_tank_update(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_tank_update(jsonb) TO service_role;

-- Lưới tự kiểm (dữ liệu giả trong khối con, rollback hết bằng SELFTEST_OK)
DO $$
DECLARE
  v_wh text; m1 text; m2 text; v_u text; v_err text; r jsonb; b1 jsonb; b2 jsonb; b3 jsonb; v_no int;
BEGIN
  SELECT w.id INTO v_wh FROM "Warehouse" w WHERE w.parent_warehouse_id IS NOT NULL AND coalesce(mes_plant_letter(w.id), '') <> '' ORDER BY w.id LIMIT 1;
  SELECT u INTO v_u FROM (SELECT upper(coalesce(base_unit, '')) u FROM "Material" WHERE is_semi_finished AND upper(coalesce(base_unit, '')) IN ('L', 'KG')
                          GROUP BY 1 HAVING count(*) >= 2 ORDER BY 1 LIMIT 1) x;
  SELECT id INTO m1 FROM "Material" WHERE is_semi_finished AND upper(coalesce(base_unit, '')) = v_u ORDER BY id LIMIT 1;
  SELECT id INTO m2 FROM "Material" WHERE is_semi_finished AND upper(coalesce(base_unit, '')) = v_u AND id <> m1 ORDER BY id LIMIT 1;
  IF v_wh IS NULL OR m2 IS NULL THEN RAISE NOTICE 'tự kiểm đợt 2: thiếu kho phụ có mã NMSX / 2 mã BTP cùng đơn vị — bỏ qua'; RETURN; END IF;
  BEGIN
    INSERT INTO production_tank (id, warehouse_id, code, capacity, unit, updated_at)
    VALUES ('QAW2_T1', v_wh, 'QAW2A', 1000, v_u, now()), ('QAW2_T2', v_wh, 'QAW2B', 100, v_u, now()), ('QAW2_T3', v_wh, 'QAW2C', 1000, v_u, now());
    -- B2: mẻ 1, mẻ 2 trên T1; huỷ mẻ 2 ⇒ số kế tiếp trên T1 phải nhảy sang 3 (không va mã mẻ đã huỷ)
    b1 := mes_batch_create(jsonb_build_object('warehouse_id', v_wh, 'material_id', m1, 'prod_date', current_date, 'cycle', 'QW2', 'tank_id', 'QAW2_T1', 'planned_qty', 100, 'shift', 'Ca 1'));
    b2 := mes_batch_create(jsonb_build_object('warehouse_id', v_wh, 'material_id', m1, 'prod_date', current_date, 'cycle', 'QW2', 'tank_id', 'QAW2_T1', 'planned_qty', 100, 'shift', 'Ca 1'));
    UPDATE production_batch SET status = 'CANCELLED' WHERE id = b2->>'id';
    v_no := mes_next_batch_no(v_wh, 'QW2', 'QAW2_T1');
    IF v_no <> 3 THEN RAISE EXCEPTION 'B2: số kế tiếp phải 3 (nhảy qua mã mẻ huỷ), nhận %', v_no; END IF;
    b3 := mes_batch_create(jsonb_build_object('warehouse_id', v_wh, 'material_id', m1, 'prod_date', current_date, 'cycle', 'QW2', 'tank_id', 'QAW2_T1', 'shift', 'Ca 1'));
    IF (b3->>'batch_no')::int <> 3 THEN RAISE EXCEPTION 'B2: tạo mẻ tự lấy số phải ra 3, nhận %', b3->>'batch_no'; END IF;
    -- B4: đổi kế hoạch 5000 + đổi sang bồn 100 L ⇒ lỗi chỗ, mẻ KHÔNG đổi gì (trước đây kế hoạch đã ghi trước khi kiểm)
    v_err := NULL;
    BEGIN PERFORM mes_batch_update(jsonb_build_object('batch_id', b1->>'id', 'planned_qty', 5000, 'tank_id', 'QAW2_T2', 'note', 'đổi'));
    EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR v_err NOT LIKE 'MESERR:OVER_CAPACITY%' THEN RAISE EXCEPTION 'B4: phải OVER_CAPACITY, nhận %', coalesce(v_err, 'không lỗi'); END IF;
    IF (SELECT planned_qty FROM production_batch WHERE id = b1->>'id') <> 100 OR (SELECT tank_id FROM production_batch WHERE id = b1->>'id') <> 'QAW2_T1'
       OR (SELECT note FROM production_batch WHERE id = b1->>'id') IS NOT NULL THEN
      RAISE EXCEPTION 'B4: sửa lỗi mà mẻ đã bị ghi một phần';
    END IF;
    r := mes_batch_update(jsonb_build_object('batch_id', b1->>'id', 'planned_qty', 200));
    IF (r->>'planned_qty')::numeric <> 200 THEN RAISE EXCEPTION 'B4: sửa hợp lệ phải ghi'; END IF;
    -- G2 + G3: duyệt hai bước ⇒ sửa định mức bị chặn APPROVED; QA bỏ duyệt được khi chưa nạp
    INSERT INTO batch_requirement (id, batch_id, material_id, qty_required, updated_at) VALUES ('QAW2_RQ', b1->>'id', m2, 1, now());
    PERFORM mes_batch_approve(jsonb_build_object('batch_id', b1->>'id', 'step', 'lead', 'approve', true));
    PERFORM mes_batch_approve(jsonb_build_object('batch_id', b1->>'id', 'step', 'qa', 'approve', true));
    v_err := NULL;
    BEGIN PERFORM mes_batch_set_requirements(jsonb_build_object('batch_id', b1->>'id', 'items', '[]'::jsonb, 'reason', 'x'));
    EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR v_err NOT LIKE 'MESERR:APPROVED%' THEN RAISE EXCEPTION 'G2: QA đã duyệt mà sửa định mức phải APPROVED, nhận %', coalesce(v_err, 'không lỗi'); END IF;
    PERFORM mes_batch_approve(jsonb_build_object('batch_id', b1->>'id', 'step', 'qa', 'approve', false));
    -- B6: T3 đang chứa mã m2 (lô giả); T1 đã đặt cho mẻ mã m1 chưa nạp ⇒ chuyển T3 → T1 phải MIX_MATERIAL
    INSERT INTO production_batch (id, warehouse_id, batch_code, material_id, prod_date, updated_at) VALUES ('QAW2_BX', v_wh, 'QAW2BX', m2, current_date, now());
    INSERT INTO tank_lot (id, tank_id, batch_id, qty_in, qty_remaining, filled_at, status, updated_at) VALUES ('QAW2_LX', 'QAW2_T3', 'QAW2_BX', 50, 50, now(), 'ACTIVE', now());
    v_err := NULL;
    BEGIN PERFORM mes_tank_transfer(jsonb_build_object('from_tank_id', 'QAW2_T3', 'to_tank_id', 'QAW2_T1', 'qty', 10));
    EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR v_err NOT LIKE 'MESERR:MIX_MATERIAL%' THEN RAISE EXCEPTION 'B6: chuyển vào bồn đã đặt mã khác phải MIX_MATERIAL, nhận %', coalesce(v_err, 'không lỗi'); END IF;
    -- B8: T1 trống nhưng đã đặt cho mẻ chưa nạp ⇒ không đổi đơn vị / không ngừng dùng
    v_err := NULL;
    BEGIN PERFORM mes_tank_update(jsonb_build_object('tank_id', 'QAW2_T1', 'unit', CASE WHEN v_u = 'KG' THEN 'L' ELSE 'KG' END));
    EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR v_err NOT LIKE 'MESERR:TANK_NOT_EMPTY%' THEN RAISE EXCEPTION 'B8: đổi đơn vị bồn đã đặt phải TANK_NOT_EMPTY, nhận %', coalesce(v_err, 'không lỗi'); END IF;
    RAISE EXCEPTION 'SELFTEST_OK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'SELFTEST_OK' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'tự kiểm đợt 2 (B2 B4 G2 G3 B6 B8): OK';
END $$;

COMMIT;
