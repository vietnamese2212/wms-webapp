-- MES: CHẾ ĐỘ "KHÔNG ĐỊNH MỨC" theo kho chế biến (27/11 — user: "có định mức thì như hiện tại, còn không có định mức nghĩa là định mức
-- không có số lượng: mã BTP A được cấu tạo bởi các mã NVL 1, 2, 3… thôi"). User chốt bảng tình huống 27/11:
--   • Công tắc Warehouse.mes_no_norm (Cài đặt MES → Luồng làm việc của mẻ → Định mức: Có số lượng / Chỉ danh sách mã). Mặc định false = như cũ.
--   • Mẻ NHỚ chế độ lúc lập (production_batch.no_norm) — đổi công tắc chỉ áp cho mẻ lập sau; mẻ đang chạy đi hết luồng cũ.
--   • Mẻ không định mức: QA lập (không hai bước duyệt) kèm lượng mẻ theo phiếu chế biến giấy + danh sách mã đối chiếu với phiếu;
--     batch_requirement.qty_required = NULL (cột thôi NOT NULL); cấp mã KHÔNG có trong danh sách ⇒ CHẶN (MESERR:NOT_ON_LIST);
--     nạp bồn khi còn mã trong danh sách chưa cấp lần nào ⇒ CHẶN (fill_blockers, kho chặn theo bước); không báo đủ / thiếu / vượt.
--   • Công thức "chỉ danh sách mã": production_recipe.base_qty + production_recipe_line.qty = NULL (thôi NOT NULL) — có số thì phải đủ.
--     Kho CÓ định mức lập mẻ bằng công thức chưa có số lượng ⇒ CHẶN (MESERR:RECIPE_NO_QTY).
--   • Báo cáo: ô NVL của mẻ không định mức có trạng thái 'nonorm' (mes_batch_cells) — không vào số dòng / lệch / mẻ đạt;
--     production_batch_fact.no_norm + mes_dash_batches.no_norm; dashboard trả filled_norm / no_norm để tính "mẻ đạt" chỉ trên mẻ có định mức.
--   • mes_batch_stage thêm tham số p_no_norm (mặc định false): mẻ không định mức không có 'wait_lead' / 'wait_qa'.
-- Một chỗ cho mỗi luật: mã lạ = mes_no_norm_code_check (hai hàm cấp + controller scanCheck) · số lượng của dòng = trigger mes_req_qty_guard.
BEGIN;

ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS mes_no_norm boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN "Warehouse".mes_no_norm IS 'MES 27/11: kho chế biến chạy KHÔNG định mức (công thức chỉ danh sách mã; QA lập mẻ; cấp chỉ chặn mã lạ). Mặc định false = có định mức.';
ALTER TABLE production_batch ADD COLUMN IF NOT EXISTS no_norm boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN production_batch.no_norm IS 'MES 27/11: chế độ của kho LÚC LẬP mẻ (Warehouse.mes_no_norm) — không đổi theo công tắc về sau.';
ALTER TABLE production_batch_fact ADD COLUMN IF NOT EXISTS no_norm boolean NOT NULL DEFAULT false;
ALTER TABLE batch_requirement ALTER COLUMN qty_required DROP NOT NULL;
ALTER TABLE production_recipe ALTER COLUMN base_qty DROP NOT NULL;
ALTER TABLE production_recipe_line ALTER COLUMN qty DROP NOT NULL;

-- số lượng của dòng phiếu theo chế độ của MẺ: mẻ không định mức ⇒ luôn NULL; mẻ có định mức ⇒ bắt buộc (cột thôi NOT NULL)
CREATE OR REPLACE FUNCTION public.mes_req_qty_guard()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE v_nn boolean;
BEGIN
  SELECT no_norm INTO v_nn FROM production_batch WHERE id = NEW.batch_id;
  IF coalesce(v_nn, false) THEN
    NEW.qty_required := NULL; NEW.qty_standard := NULL; NEW.tol_pct := NULL;
  ELSIF NEW.qty_required IS NULL THEN
    RAISE EXCEPTION 'MESERR:QTY|Mẻ có định mức — mỗi nguyên liệu phải có số lượng';
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_mes_req_qty_guard ON batch_requirement;
CREATE TRIGGER trg_mes_req_qty_guard BEFORE INSERT OR UPDATE ON batch_requirement FOR EACH ROW EXECUTE FUNCTION public.mes_req_qty_guard();

-- mã cấp vào mẻ KHÔNG ĐỊNH MỨC phải có trong danh sách NVL của mẻ (user chốt 27/11: chặn). Mẻ có định mức: không kiểm (như cũ — "ngoài phiếu").
CREATE OR REPLACE FUNCTION public.mes_no_norm_code_check(p_batch_id text, p_material_id text)
 RETURNS void LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE v_nn boolean; v_bcode text; v_code text;
BEGIN
  SELECT no_norm, batch_code INTO v_nn, v_bcode FROM production_batch WHERE id = p_batch_id;
  IF NOT coalesce(v_nn, false) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM batch_requirement WHERE batch_id = p_batch_id AND material_id = p_material_id AND removed_at IS NULL) THEN RETURN; END IF;
  SELECT material_code INTO v_code FROM "Material" WHERE id = p_material_id;
  RAISE EXCEPTION 'MESERR:NOT_ON_LIST|Mã % không có trong danh sách NVL của mẻ % — sai mã? Phiếu chế biến có mã này thì QA thêm vào danh sách rồi quét lại',
    coalesce(v_code, '?'), v_bcode;
END $function$;

-- tình trạng mẻ: thêm p_no_norm (mẻ không định mức không chờ hai bước duyệt)
DROP FUNCTION IF EXISTS public.mes_batch_stage(text, text, timestamptz, timestamptz, boolean, boolean, boolean, boolean);
CREATE FUNCTION public.mes_batch_stage(p_status text, p_qa text, p_lead timestamp with time zone, p_qa_ok timestamp with time zone, p_filled boolean, p_consumed boolean, p_gate boolean, p_log_pending boolean, p_no_norm boolean DEFAULT false)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_status = 'CANCELLED' THEN 'cancelled'
    WHEN p_qa = 'REJECTED' THEN 'rejected'
    WHEN p_filled THEN CASE WHEN p_qa IS DISTINCT FROM 'RELEASED' THEN 'filled'
                            WHEN p_gate AND COALESCE(p_log_pending, false) THEN 'closing'   -- 26/11: QA bồn đạt, phiếu chưa đóng
                            ELSE 'released' END
    WHEN p_gate AND NOT COALESCE(p_no_norm, false) AND p_lead IS NULL THEN 'wait_lead'
    WHEN p_gate AND NOT COALESCE(p_no_norm, false) AND p_qa_ok IS NULL THEN 'wait_qa'
    WHEN p_gate THEN 'working'
    WHEN p_consumed OR p_qa_ok IS NOT NULL THEN 'working'
    WHEN p_lead IS NOT NULL THEN 'wait_qa'
    ELSE 'new'
  END
$function$;

-- cửa chung của hai hàm cấp: mẻ không định mức không cần hai bước duyệt (vẫn phải mở phiếu theo dõi)
CREATE OR REPLACE FUNCTION public.mes_consume_flow_gate(p_batch_id text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE b record; v_gate boolean; v_open text;
BEGIN
  SELECT pb.lead_ok_at, pb.qa_ok_at, pb.warehouse_id, pb.no_norm INTO b FROM production_batch pb WHERE pb.id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  SELECT coalesce(w.mes_flow_gate, false) INTO v_gate FROM "Warehouse" w WHERE w.id = b.warehouse_id;
  IF NOT coalesce(v_gate, false) THEN RETURN; END IF;
  IF NOT coalesce(b.no_norm, false) THEN
    IF b.lead_ok_at IS NULL THEN RAISE EXCEPTION 'MESERR:NOT_APPROVED|Trưởng ca chưa duyệt phiếu của mẻ — chưa cấp nguyên liệu được'; END IF;
    IF b.qa_ok_at IS NULL THEN RAISE EXCEPTION 'MESERR:NOT_APPROVED|QA chưa duyệt phiếu của mẻ — chưa cấp nguyên liệu được'; END IF;
  END IF;
  -- 26/11: phải MỞ phiếu theo dõi (bấm "Bắt đầu" — ghi giờ bắt đầu của mẻ) rồi mới cấp
  v_open := mes_log_unopened(p_batch_id);
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'MESERR:LOG_NOT_STARTED|Chưa mở phiếu theo dõi (%) — bấm "Bắt đầu phiếu" để ghi giờ bắt đầu rồi mới cấp nguyên liệu', v_open;
  END IF;
END $function$;

-- mẻ cho dashboard: thêm cột no_norm (đổi kiểu trả ⇒ DROP rồi tạo lại; mes_dashboard · mes_dashboard_detail gọi lúc chạy)
DROP FUNCTION IF EXISTS public.mes_dash_batches(text, date, date);
CREATE FUNCTION public.mes_dash_batches(p_wh text, p_from date, p_to date)
 RETURNS TABLE(batch_id text, prod_date date, shift text, btp_id text, batch_code text, batch_no integer, created_at timestamp with time zone, filled_at timestamp with time zone, filled boolean, open_min integer, qa_status text, rm_bad integer, lines integer, pending integer, ok integer, over integer, under integer, extra integer, edited integer, std_kg numeric, sheet_kg numeric, iss_kg numeric, edit_kg numeric, exec_kg numeric, total_kg numeric, no_norm boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH live AS (
    SELECT pb.* FROM production_batch pb
     WHERE pb.warehouse_id = p_wh AND pb.status <> 'CANCELLED'
       AND pb.prod_date BETWEEN p_from AND p_to
       AND NOT EXISTS (SELECT 1 FROM production_batch_fact f WHERE f.batch_id = pb.id)),
  a AS (SELECT * FROM mes_batch_agg(ARRAY(SELECT id FROM live)))
  SELECT f.batch_id, f.prod_date, f.shift, f.btp_id, f.batch_code, f.batch_no, f.created_at, f.filled_at, true, f.open_min, f.qa_status, f.rm_bad,
         f.lines, f.pending, f.ok, f.over, f.under, f.extra, f.edited, f.std_kg, f.sheet_kg, f.iss_kg, f.edit_kg, f.exec_kg, f.total_kg, f.no_norm
    FROM production_batch_fact f WHERE f.warehouse_id = p_wh AND f.prod_date BETWEEN p_from AND p_to
  UNION ALL
  SELECT l.id, COALESCE(l.prod_date, (l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date), NULLIF(btrim(COALESCE(l.shift, '')), ''), l.material_id,
         l.batch_code, l.batch_no, l.created_at, NULL::timestamptz, false, NULL::int, l.qa_status,
         (SELECT count(*) FROM batch_consumption c WHERE c.batch_id = l.id AND c.reversed_at IS NULL AND COALESCE(c.rotation_violation, false))::int,
         COALESCE(a.lines, 0), COALESCE(a.pending, 0), COALESCE(a.ok, 0), COALESCE(a.over, 0), COALESCE(a.under, 0), COALESCE(a.extra, 0), COALESCE(a.edited, 0),
         COALESCE(a.std_kg, 0), COALESCE(a.sheet_kg, 0), COALESCE(a.iss_kg, 0), COALESCE(a.edit_kg, 0), COALESCE(a.exec_kg, 0), COALESCE(a.total_kg, 0), l.no_norm
    FROM live l LEFT JOIN a ON a.batch_id = l.id
$function$;

CREATE OR REPLACE FUNCTION public.mes_batch_create(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  v_nn    boolean;
BEGIN
  -- 27/11 KHÔNG ĐỊNH MỨC: chế độ của KHO lúc lập ⇒ chép vào mẻ (đổi công tắc về sau không đổi mẻ đã lập)
  SELECT coalesce(w.mes_no_norm, false) INTO v_nn FROM "Warehouse" w WHERE w.id = v_wh;
  v_nn := coalesce(v_nn, false);
  IF v_nn AND v_plan IS NULL THEN RAISE EXCEPTION 'MESERR:QTY|Nhập lượng mẻ (theo phiếu chế biến)'; END IF;
  PERFORM 1 FROM production_tank WHERE id = v_tank FOR UPDATE;
  PERFORM mes_tank_room_check(v_tank, v_wh, p->>'material_id', v_plan, NULL);
  IF v_no IS NULL THEN v_no := mes_next_batch_no(v_wh, v_cycle, v_tank); END IF;
  v_code := mes_batch_code(v_wh, v_cycle, v_no, v_tank);
  SELECT status INTO v_dup FROM production_batch WHERE warehouse_id = v_wh AND batch_code = v_code;
  IF v_dup = 'CANCELLED' THEN RAISE EXCEPTION 'MESERR:CODE_USED|Mã lô % đã dùng cho một mẻ đã huỷ — chọn số mẻ khác', v_code; END IF;
  INSERT INTO production_batch (id, warehouse_id, batch_code, material_id, prod_date, machine_code, shift, cycle, batch_no, tank_id, planned_qty, note,
                                status, qa_status, opened_by, opened_by_name, no_norm, created_at, updated_at)
  VALUES (v_id, v_wh, v_code, p->>'material_id', (p->>'prod_date')::date, nullif(p->>'machine_code', ''), nullif(p->>'shift', ''), v_cycle, v_no, v_tank,
          v_plan, nullif(p->>'note', ''), 'OPEN', 'HOLD', p->>'actor_id', p->>'actor_name', v_nn, now(), now());
  -- bàn làm việc: chép ĐỊNH MỨC (công thức chọn hoặc mặc định) — lỗi ⇒ không tạo mẻ (trước đây nuốt lỗi, trả 201 với bàn trống)
  v_ap := mes_batch_apply_recipe(jsonb_build_object('batch_id', v_id, 'recipe_id', nullif(p->>'recipe_id', ''), 'actor_name', p->>'actor_name'));
  -- 27/11 KHÔNG ĐỊNH MỨC: QA đối chiếu danh sách mã với phiếu chế biến giấy lúc lập mẻ ⇒ danh sách gửi kèm THAY danh sách của công thức (không số lượng)
  IF v_nn AND jsonb_typeof(p->'items') = 'array' THEN
    IF (SELECT count(*) <> count(DISTINCT x->>'material_id') FROM jsonb_array_elements(p->'items') x) THEN
      RAISE EXCEPTION 'MESERR:DUPLICATE|Một nguyên liệu bị khai hai lần';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'items') x WHERE x->>'material_id' = p->>'material_id') THEN
      RAISE EXCEPTION 'MESERR:SELF|Danh sách không được chứa chính mã bán thành phẩm của mẻ';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'items') x WHERE NOT EXISTS (SELECT 1 FROM "Material" m WHERE m.id = x->>'material_id')) THEN
      RAISE EXCEPTION 'MESERR:NOT_FOUND|Có nguyên liệu không còn trong danh mục';
    END IF;
    DELETE FROM batch_requirement WHERE batch_id = v_id;
    INSERT INTO batch_requirement (id, batch_id, material_id, qty_required, qty_standard, tol_pct, sort_order, updated_at, updated_by)
    SELECT gen_random_uuid()::text, v_id, x.e->>'material_id', NULL, NULL, NULL, x.o::int, now(), p->>'actor_name'
      FROM jsonb_array_elements(p->'items') WITH ORDINALITY x(e, o);
    v_ap := v_ap || jsonb_build_object('count', jsonb_array_length(p->'items'));
  END IF;
  IF v_nn AND NOT EXISTS (SELECT 1 FROM batch_requirement WHERE batch_id = v_id AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'MESERR:EMPTY_SHEET|Danh sách NVL của mẻ đang trống — thêm các mã có trên phiếu chế biến';
  END IF;
  PERFORM mes_batch_set_forms(jsonb_build_object('batch_id', v_id)
    || CASE WHEN jsonb_typeof(p->'extra_forms') = 'array' THEN jsonb_build_object('forms', p->'extra_forms') ELSE '{}'::jsonb END);
  UPDATE production_tank SET updated_at = now() WHERE id = v_tank;   -- sơ đồ bồn thấy ngay phần "đã đặt"
  RETURN (SELECT to_jsonb(b) FROM production_batch b WHERE b.id = v_id) || jsonb_build_object('requirement_count', coalesce((v_ap->>'count')::int, 0));
END $function$;

CREATE OR REPLACE FUNCTION public.mes_batch_apply_recipe(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  -- 27/11 KHÔNG ĐỊNH MỨC: mẻ không định mức chép DANH SÁCH MÃ (không số lượng); mẻ có định mức cần công thức có số lượng (chặn — user chốt 27/11)
  IF NOT b.no_norm AND (r.base_qty IS NULL OR EXISTS (SELECT 1 FROM production_recipe_line x WHERE x.recipe_id = r.id AND x.qty IS NULL)) THEN
    RAISE EXCEPTION 'MESERR:RECIPE_NO_QTY|Công thức "%" chỉ có danh sách mã, chưa có số lượng — kho đang chạy có định mức: vào Sản xuất (MES) → Định mức điền số lượng rồi mở mẻ', r.name;
  END IF;
  IF b.no_norm AND coalesce((p->>'replace')::boolean, false)
     AND EXISTS (SELECT 1 FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL) THEN
    RAISE EXCEPTION 'MESERR:CONSUMED|Mẻ đã cấp nguyên liệu — sửa từng mã trong danh sách thay vì đổi công thức';
  END IF;
  v_k := CASE WHEN b.no_norm THEN NULL WHEN b.planned_qty IS NOT NULL THEN b.planned_qty / r.base_qty ELSE 1 END;
  IF coalesce((p->>'replace')::boolean, false) THEN DELETE FROM batch_requirement WHERE batch_id = b.id; END IF;
  INSERT INTO batch_requirement (id, batch_id, material_id, qty_required, qty_standard, tol_pct, sort_order, note, updated_at, updated_by)
  SELECT gen_random_uuid()::text, b.id, l.material_id,
         CASE WHEN b.no_norm THEN NULL ELSE GREATEST(round(l.qty * v_k, 3), 0.001) END,
         CASE WHEN b.no_norm THEN NULL ELSE GREATEST(round(l.qty * v_k, 3), 0.001) END,
         CASE WHEN b.no_norm THEN NULL ELSE l.tol_pct END, l.sort_order, l.note, now(), p->>'actor_name'
    FROM production_recipe_line l WHERE l.recipe_id = r.id
  ON CONFLICT (batch_id, material_id) DO UPDATE SET qty_required = EXCLUDED.qty_required, qty_standard = EXCLUDED.qty_standard,
         tol_pct = EXCLUDED.tol_pct, sort_order = EXCLUDED.sort_order, note = EXCLUDED.note, removed_at = NULL, replaces_material_id = NULL,
         change_reason = NULL, changed_by_name = NULL, changed_at = NULL, updated_at = now(), updated_by = EXCLUDED.updated_by;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE production_batch SET recipe_id = r.id, updated_at = now() WHERE id = b.id;
  RETURN jsonb_build_object('count', v_n, 'no_recipe', false, 'factor', v_k, 'recipe_id', r.id, 'recipe_name', r.name);
END $function$;

CREATE OR REPLACE FUNCTION public.mes_batch_set_requirements(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  -- 27/11 KHÔNG ĐỊNH MỨC: danh sách mã sửa được tới khi mẻ nạp bồn
  IF b.no_norm AND EXISTS (SELECT 1 FROM tank_movement WHERE batch_id = b.id AND kind = 'FILL') THEN
    RAISE EXCEPTION 'MESERR:FILLED|Mẻ đã nạp BTP vào bồn — không sửa danh sách NVL được nữa';
  END IF;
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
    -- 27/11 KHÔNG ĐỊNH MỨC: mã đã cấp vào mẻ không bỏ khỏi danh sách được (nếu bỏ, phần đã cấp thành "mã lạ" mà cửa cấp vốn chặn)
    IF b.no_norm AND EXISTS (SELECT 1 FROM batch_consumption c WHERE c.batch_id = b.id AND c.material_id = cur.material_id AND c.reversed_at IS NULL) THEN
      RAISE EXCEPTION 'MESERR:CONSUMED|Mã % đã cấp vào mẻ — huỷ các dòng cấp của mã này trước rồi mới bỏ khỏi danh sách',
        (SELECT material_code FROM "Material" WHERE id = cur.material_id);
    END IF;
    IF cur.qty_standard IS NULL AND NOT b.no_norm THEN DELETE FROM batch_requirement WHERE id = cur.id;
    ELSE UPDATE batch_requirement SET removed_at = now(), change_reason = v_reason, changed_by_name = v_actor, changed_at = now(),
                updated_at = now(), updated_by = v_actor WHERE id = cur.id;
    END IF;
  END LOOP;
  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) LOOP
    v_i := v_i + 1;
    v_qty := CASE WHEN b.no_norm THEN NULL ELSE nullif(l->>'qty', '')::numeric END;
    IF NOT b.no_norm AND (v_qty IS NULL OR v_qty <= 0) THEN RAISE EXCEPTION 'MESERR:QTY|Mỗi nguyên liệu phải có số lượng lớn hơn 0'; END IF;
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
    ELSIF cur.removed_at IS NOT NULL OR cur.qty_required IS DISTINCT FROM v_qty THEN
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
  IF v_chg > 0 AND v_reason IS NULL THEN
    RAISE EXCEPTION 'MESERR:REASON|%', CASE WHEN b.no_norm THEN 'Nhập lý do sửa danh sách NVL của mẻ' ELSE 'Nhập lý do sửa định mức của mẻ' END;
  END IF;
  IF b.no_norm AND NOT EXISTS (SELECT 1 FROM batch_requirement WHERE batch_id = b.id AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'MESERR:EMPTY_SHEET|Danh sách NVL của mẻ không được trống';
  END IF;
  UPDATE production_batch SET updated_at = now() WHERE id = b.id;
  RETURN jsonb_build_object('count', v_i, 'changed', v_chg);
END $function$;

CREATE OR REPLACE FUNCTION public.mes_batch_requirements_refresh(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  IF b.no_norm THEN RETURN jsonb_build_object('mode', 'scale', 'count', 0); END IF;   -- 27/11 KHÔNG ĐỊNH MỨC: không có số để nhân theo kế hoạch
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
END $function$;

CREATE OR REPLACE FUNCTION public.mes_batch_approve(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  b      record;
  v_step text := p->>'step';
  v_ok   boolean := coalesce((p->>'approve')::boolean, false);
  v_busy text := 'MESERR:BATCH_STATUS|Phiếu vừa được người khác duyệt / bỏ duyệt — tải lại';
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR UPDATE;   -- chờ lượt nạp bồn đang chạy (mes_tank_fill giữ FOR NO KEY UPDATE)
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF b.no_norm THEN RAISE EXCEPTION 'MESERR:NO_NORM|Mẻ không định mức không có bước duyệt phiếu — QA lập mẻ là đã duyệt'; END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION public.mes_batch_labels(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE b record; v_n integer := (p->>'count')::integer; v_gate boolean; v_reprint boolean;
BEGIN
  IF v_n IS NULL OR v_n < 1 OR v_n > 99 THEN RAISE EXCEPTION 'MESERR:QTY|Số pallet từ 1 đến 99'; END IF;
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF b.status <> 'OPEN' THEN RAISE EXCEPTION 'MESERR:BATCH_STATUS|Mẻ không còn mở — không in tem được'; END IF;
  IF b.tank_id IS NULL THEN RAISE EXCEPTION 'MESERR:TANK|Mẻ chưa chọn bồn — chọn bồn rồi mới in tem'; END IF;
  SELECT coalesce(mes_flow_gate, false) INTO v_gate FROM "Warehouse" WHERE id = b.warehouse_id;
  IF v_gate AND NOT b.no_norm AND (b.lead_ok_at IS NULL OR b.qa_ok_at IS NULL) THEN RAISE EXCEPTION 'MESERR:NOT_APPROVED|Phiếu của mẻ chưa đủ hai bước duyệt — chưa in tem được'; END IF;
  IF EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = b.id AND mv.kind = 'FILL') AND (b.label_at IS NULL OR v_n <> b.label_count) THEN
    RAISE EXCEPTION 'MESERR:FILLED|Mẻ đã nạp bồn — không đổi số pallet được nữa';
  END IF;
  v_reprint := b.label_at IS NOT NULL AND b.label_count = v_n;
  IF NOT v_reprint THEN
    UPDATE production_batch SET label_count = v_n, label_ver = label_ver + 1, label_at = now(), label_by_name = p->>'actor_name', updated_at = now() WHERE id = b.id;
  END IF;
  RETURN (SELECT jsonb_build_object('batch_code', x.batch_code, 'count', x.label_count, 'ver', x.label_ver, 'reprint', v_reprint) FROM production_batch x WHERE x.id = b.id);
END $function$;

CREATE OR REPLACE FUNCTION public.mes_batch_gate(p_batch_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  b record; v_gate boolean; v_short jsonb; v_missing jsonb; v_scanned int; v_need_log boolean;
  v_block text[] := '{}';
  v_filled boolean; v_stage text; v_has_req boolean; v_step text; v_open text; v_pending boolean;
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p_batch_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(mes_flow_gate, false) INTO v_gate FROM "Warehouse" WHERE id = b.warehouse_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('material_code', m.material_code, 'name', m.short_name, 'required', r.qty_required, 'issued', x.issued)
                            ORDER BY r.sort_order), '[]'::jsonb) INTO v_short
    FROM batch_requirement r
    JOIN "Material" m ON m.id = r.material_id
    CROSS JOIN LATERAL (SELECT COALESCE(sum(c.qty), 0) AS issued FROM batch_consumption c
                         WHERE c.batch_id = r.batch_id AND c.material_id = r.material_id AND c.reversed_at IS NULL) x
   WHERE r.batch_id = b.id AND r.removed_at IS NULL
     AND (x.issued <= 0 OR x.issued < r.qty_required * (1 - COALESCE(r.tol_pct, 0) / 100) - 0.0005);

  -- ô bắt buộc còn trống (phiếu đã mở) — 26/11: điều kiện ĐÓNG phiếu, không còn chặn nạp bồn
  SELECT COALESCE(jsonb_agg(jsonb_build_object('form', l.form, 'title', COALESCE(f.short, l.form), 'key', fld->>'key', 'label', fld->>'label')), '[]'::jsonb)
    INTO v_missing
    FROM batch_process_log l
    LEFT JOIN production_process_form f ON f.code = l.form
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.blocks, f.blocks, '[]'::jsonb)) blk
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN blk->>'type' = 'fields' THEN blk->'fields' ELSE '[]'::jsonb END) fld
   WHERE l.batch_id = b.id AND (fld->>'required') = 'true' AND COALESCE(btrim(l.data->>(fld->>'key')), '') = '';
  v_need_log := EXISTS (
    SELECT 1 FROM production_process_form f, jsonb_array_elements(f.blocks) blk, jsonb_array_elements(CASE WHEN blk->>'type' = 'fields' THEN blk->'fields' ELSE '[]'::jsonb END) fld
     WHERE f.is_active AND (NOT f.optional OR f.code = ANY(b.extra_forms)) AND (fld->>'required') = 'true'
       AND NOT EXISTS (SELECT 1 FROM batch_process_log l WHERE l.batch_id = b.id AND l.form = f.code));
  v_open := mes_log_unopened(b.id);
  v_pending := mes_log_pending(b.id);

  SELECT count(*) INTO v_scanned FROM batch_pour_scan s WHERE s.batch_id = b.id AND s.label_ver = b.label_ver AND s.tank_id = b.tank_id;

  IF NOT b.no_norm THEN   -- 27/11 KHÔNG ĐỊNH MỨC: mẻ do QA lập — không có hai bước duyệt
    IF b.lead_ok_at IS NULL THEN v_block := v_block || 'Trưởng ca chưa duyệt phiếu'::text; END IF;
    IF b.qa_ok_at IS NULL THEN v_block := v_block || 'QA chưa duyệt phiếu'::text; END IF;
  END IF;
  IF jsonb_array_length(v_short) > 0 THEN
    v_block := v_block || format(CASE WHEN b.no_norm THEN '%s mã trong danh sách chưa cấp (%s)' ELSE '%s nguyên liệu cấp chưa đủ (%s)' END, jsonb_array_length(v_short),
      (SELECT string_agg(x->>'material_code', ', ') FROM (SELECT x FROM jsonb_array_elements(v_short) x LIMIT 5) s));
  END IF;
  IF b.label_at IS NULL OR b.label_count IS NULL THEN v_block := v_block || 'Chưa in tem pallet của mẻ'::text;
  ELSIF v_scanned < b.label_count THEN v_block := v_block || format('Mới quét %s/%s tem pallet tại bồn', v_scanned, b.label_count); END IF;

  v_filled := EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = b.id AND mv.kind = 'FILL');
  v_stage := mes_batch_stage(b.status, b.qa_status, b.lead_ok_at, b.qa_ok_at, v_filled,
               EXISTS (SELECT 1 FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL), v_gate, v_pending, b.no_norm);
  v_has_req := EXISTS (SELECT 1 FROM batch_requirement r WHERE r.batch_id = b.id AND r.removed_at IS NULL);
  -- BƯỚC ĐANG TỚI — bước đầu tiên chưa xong, đúng thứ tự dải bước của trang mẻ (26/11: Mở phiếu trước Cấp NVL, Đóng phiếu sau QA bồn).
  -- Kho không chặn theo bước: hai bước duyệt không giữ chân khi mẻ đã làm; không có bước Đóng phiếu (tình trạng không có 'closing').
  v_step := CASE
    WHEN v_stage IN ('cancelled', 'released') THEN NULL
    WHEN v_stage = 'closing' THEN 'close'
    WHEN v_stage IN ('filled', 'rejected') THEN 'tankqa'
    WHEN v_stage IN ('new', 'wait_lead') AND NOT b.no_norm THEN 'lead'
    WHEN v_stage = 'wait_qa' THEN 'qa'
    WHEN v_open IS NOT NULL THEN 'log'
    WHEN NOT v_has_req OR jsonb_array_length(v_short) > 0 THEN 'rm'
    WHEN b.label_at IS NULL OR COALESCE(b.label_count, 0) = 0 THEN 'label'
    WHEN v_scanned < b.label_count THEN 'pour'
    ELSE 'fill'
  END;

  RETURN jsonb_build_object(
    'flow_gate', v_gate, 'lead_ok', b.lead_ok_at IS NOT NULL, 'qa_ok', b.qa_ok_at IS NOT NULL,
    'can_consume', (NOT v_gate) OR ((b.no_norm OR (b.lead_ok_at IS NOT NULL AND b.qa_ok_at IS NOT NULL)) AND v_open IS NULL),
    'label_count', b.label_count, 'label_valid', b.label_at IS NOT NULL, 'label_ver', b.label_ver, 'scanned', v_scanned,
    'short', v_short, 'missing', v_missing, 'need_log', v_need_log, 'has_req', v_has_req,
    'need_open', v_open IS NOT NULL, 'open_forms', v_open, 'log_pending', v_pending,
    'fill_blockers', CASE WHEN v_gate THEN to_jsonb(v_block) ELSE '[]'::jsonb END,
    'stage', v_stage, 'step', v_step, 'no_norm', b.no_norm);
END $function$;

CREATE OR REPLACE FUNCTION public.mes_batch_page(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_wh    text[] := ARRAY(SELECT jsonb_array_elements_text(coalesce(p->'wh_ids', '[]'::jsonb)));
  v_stage text := nullif(p->>'stage', '');
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
    SELECT b.id, b.prod_date, b.batch_code,
           mes_batch_stage(b.status, b.qa_status, b.lead_ok_at, b.qa_ok_at,
             EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = b.id AND mv.kind = 'FILL'),
             EXISTS (SELECT 1 FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL),
             COALESCE(w.mes_flow_gate, false),
             -- 26/11: phiếu chưa đóng ⇒ "Chờ đóng phiếu" (chỉ tính cho mẻ QA bồn đạt ở kho chặn theo bước)
             CASE WHEN COALESCE(w.mes_flow_gate, false) AND b.qa_status = 'RELEASED' THEN mes_log_pending(b.id) ELSE false END, b.no_norm) AS stage
      FROM production_batch b
      JOIN "Warehouse" w ON w.id = b.warehouse_id
     WHERE b.warehouse_id = ANY(v_wh)
       AND (v_from IS NULL OR b.prod_date >= v_from) AND (v_to IS NULL OR b.prod_date <= v_to)
       AND (v_q IS NULL OR b.batch_code ILIKE v_like
            OR EXISTS (SELECT 1 FROM "Material" m WHERE m.id = b.material_id AND (m.material_code ILIKE v_like OR m.short_name ILIKE v_like)))
  ), pg AS (
    SELECT f.id, f.stage, f.prod_date, f.batch_code FROM f
     WHERE v_stage IS NULL OR f.stage = v_stage
     ORDER BY f.prod_date DESC, f.batch_code DESC
     OFFSET (v_page - 1) * v_size LIMIT v_size
  )
  SELECT
    (SELECT jsonb_build_object(
       'total',     count(*) FILTER (WHERE v_stage IS NULL OR stage = v_stage),
       'new',       count(*) FILTER (WHERE stage = 'new'),
       'wait_lead', count(*) FILTER (WHERE stage = 'wait_lead'),
       'wait_qa',   count(*) FILTER (WHERE stage = 'wait_qa'),
       'working',   count(*) FILTER (WHERE stage = 'working'),
       'filled',    count(*) FILTER (WHERE stage = 'filled'),
       'closing',   count(*) FILTER (WHERE stage = 'closing'),
       'released',  count(*) FILTER (WHERE stage = 'released'),
       'rejected',  count(*) FILTER (WHERE stage = 'rejected'),
       'cancelled', count(*) FILTER (WHERE stage = 'cancelled')) FROM f),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', b.id, 'warehouse_id', b.warehouse_id, 'warehouse_name', w.name, 'batch_code', b.batch_code,
             'material_id', b.material_id, 'material_code', m.material_code, 'material_name', m.short_name, 'base_unit', m.base_unit,
             'machine_code', b.machine_code, 'shift', b.shift, 'cycle', b.cycle, 'batch_no', b.batch_no, 'tank_id', b.tank_id, 'tank_code', tk.code,
             'lead_ok_at', b.lead_ok_at, 'qa_ok_at', b.qa_ok_at, 'stage', pg.stage, 'no_norm', b.no_norm,
             -- bước đang tới của mẻ đang làm — chỉ dòng của TRANG đang xem, chỉ mẻ đang làm (vài mẻ) mới gọi hàm cổng
             'step', CASE WHEN pg.stage = 'working' THEN mes_batch_gate(b.id)->>'step' END,
             'prod_date', b.prod_date, 'planned_qty', b.planned_qty,
             'status', b.status, 'qa_status', b.qa_status, 'qa_at', b.qa_at, 'qa_by_name', b.qa_by_name,
             'note', b.note, 'opened_by_name', b.opened_by_name, 'created_at', b.created_at,
             'rm_lines', (SELECT count(*) FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL),
             'rm_materials', (SELECT count(DISTINCT c.material_id) FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL),
             'filled', (SELECT COALESCE(sum(mv.qty), 0) FROM tank_movement mv WHERE mv.batch_id = b.id AND mv.kind = 'FILL'),
             'in_tank', (SELECT COALESCE(sum(l.qty_remaining), 0) FROM tank_lot l WHERE l.batch_id = b.id AND l.status = 'ACTIVE')
           ) ORDER BY pg.prod_date DESC, pg.batch_code DESC), '[]'::jsonb)
       FROM pg
       JOIN production_batch b ON b.id = pg.id
       JOIN "Warehouse" w ON w.id = b.warehouse_id
       JOIN "Material" m ON m.id = b.material_id
       LEFT JOIN production_tank tk ON tk.id = b.tank_id)
  INTO v_sum, v_rows;
  RETURN jsonb_build_object('rows', v_rows, 'summary', v_sum, 'page', v_page, 'page_size', v_size);
END $function$;

CREATE OR REPLACE FUNCTION public.mes_cycle_report(p_wh text, p_cycle text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gate    boolean;
  v_batches jsonb;
  v_rows    jsonb;
  v_people  jsonb;
BEGIN
  SELECT coalesce(mes_flow_gate, false) INTO v_gate FROM "Warehouse" WHERE id = p_wh;

  -- MẺ — tình trạng tính bằng CÙNG hàm với danh sách mẻ; bước đang tới chỉ hỏi hàm cổng cho mẻ đang làm
  WITH bs AS (SELECT b.* FROM production_batch b WHERE b.warehouse_id = p_wh AND b.cycle = p_cycle),
  fx AS (SELECT mv.batch_id, sum(mv.qty) AS qty, min(mv.created_at) AS first_at,
                (array_agg(mv.created_by_name ORDER BY mv.created_at))[1] AS by_name
           FROM tank_movement mv JOIN bs ON bs.id = mv.batch_id WHERE mv.kind = 'FILL' GROUP BY mv.batch_id),
  -- lần cấp: còn hiệu lực (n) · sai thứ tự luân chuyển (bad) · hàng hết hạn QA duyệt (exp) · đã huỷ (rev — cấp nhầm phải huỷ)
  cx AS (SELECT c.batch_id,
                min(c.created_at) FILTER (WHERE c.reversed_at IS NULL) AS first_at, max(c.created_at) FILTER (WHERE c.reversed_at IS NULL) AS last_at,
                count(*) FILTER (WHERE c.reversed_at IS NULL) AS n,
                count(*) FILTER (WHERE c.reversed_at IS NULL AND COALESCE(c.rotation_violation, false)) AS bad,
                count(*) FILTER (WHERE c.reversed_at IS NULL AND c.expiry_approval_id IS NOT NULL) AS exp,
                count(*) FILTER (WHERE c.reversed_at IS NOT NULL) AS rev
           FROM batch_consumption c JOIN bs ON bs.id = c.batch_id GROUP BY c.batch_id),
  st AS (SELECT b.id, mes_batch_stage(b.status, b.qa_status, b.lead_ok_at, b.qa_ok_at, fx.batch_id IS NOT NULL, COALESCE(cx.n, 0) > 0, v_gate,
                                   CASE WHEN v_gate AND b.qa_status = 'RELEASED' THEN mes_log_pending(b.id) ELSE false END, b.no_norm) AS stage
           FROM bs b LEFT JOIN fx ON fx.batch_id = b.id LEFT JOIN cx ON cx.batch_id = b.id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', b.id, 'batch_code', b.batch_code, 'batch_no', b.batch_no, 'shift', b.shift, 'prod_date', b.prod_date,
           'material_id', b.material_id, 'material_code', m.material_code, 'material_name', m.short_name, 'base_unit', m.base_unit,
           'tank_id', b.tank_id, 'tank_code', tk.code, 'planned_qty', b.planned_qty, 'status', b.status, 'qa_status', b.qa_status, 'no_norm', b.no_norm,
           'stage', st.stage, 'step', CASE WHEN st.stage = 'working' THEN mes_batch_gate(b.id)->>'step' END,
           'created_at', b.created_at, 'opened_by_name', b.opened_by_name,
           'lead_ok_at', b.lead_ok_at, 'lead_ok_by_name', b.lead_ok_by_name, 'qa_ok_at', b.qa_ok_at, 'qa_ok_by_name', b.qa_ok_by_name,
           'label_at', b.label_at, 'label_by_name', b.label_by_name, 'label_count', b.label_count,
           'rm_first_at', cx.first_at, 'rm_last_at', cx.last_at, 'rm_lines', COALESCE(cx.n, 0),
           'rm_bad', COALESCE(cx.bad, 0), 'rm_exp', COALESCE(cx.exp, 0), 'rm_rev', COALESCE(cx.rev, 0),
           'filled_qty', COALESCE(fx.qty, 0), 'filled_at', fx.first_at, 'filled_by_name', fx.by_name,
           'tank_qa_at', CASE WHEN b.qa_status IN ('RELEASED', 'REJECTED') THEN b.qa_at END,
           'tank_qa_by_name', CASE WHEN b.qa_status IN ('RELEASED', 'REJECTED') THEN b.qa_by_name END
         ) ORDER BY b.created_at, b.batch_no), '[]'::jsonb)
    INTO v_batches
    FROM bs b
    JOIN st ON st.id = b.id
    JOIN "Material" m ON m.id = b.material_id
    LEFT JOIN production_tank tk ON tk.id = b.tank_id
    LEFT JOIN fx ON fx.batch_id = b.id
    LEFT JOIN cx ON cx.batch_id = b.id;

  -- NVL × MẺ (21/11 — user: "người ta quan tâm định mức và sự chênh lệch của từng ca, từng mẻ"; chốt so với ĐỊNH MỨC GỐC theo công thức,
  -- tách phần trưởng ca sửa phiếu): std = định mức gốc (qty_standard; null = dòng thêm tay vào phiếu) · req = phiếu của mẻ đang hiệu lực
  -- (null = dòng đã bỏ khỏi phiếu, hoặc mã cấp ngoài phiếu) · rm = dòng đã bỏ (vẫn có mặt: định mức gốc của nó vẫn tính) · why = lý do sửa ·
  -- iss = lần cấp chưa huỷ. Trước 21/11 dòng đã bỏ không có mặt và "định mức" là phiếu đã sửa ⇒ sửa phiếu bằng đúng số cấp thì lệch 0.
  WITH bs AS (SELECT id, no_norm FROM production_batch WHERE warehouse_id = p_wh AND cycle = p_cycle AND status <> 'CANCELLED'),
  req AS (SELECT r.batch_id, r.material_id, CASE WHEN r.removed_at IS NULL THEN r.qty_required END AS qty_required, r.qty_standard,
                 r.removed_at IS NOT NULL AS rm, r.change_reason, r.tol_pct, r.sort_order
            FROM batch_requirement r JOIN bs ON bs.id = r.batch_id),
  iss AS (SELECT c.batch_id, c.material_id, sum(c.qty) AS qty, count(*) AS n
            FROM batch_consumption c JOIN bs ON bs.id = c.batch_id WHERE c.reversed_at IS NULL GROUP BY c.batch_id, c.material_id),
  cell AS (SELECT COALESCE(req.batch_id, iss.batch_id) AS batch_id, COALESCE(req.material_id, iss.material_id) AS material_id,
                  req.qty_required AS req, req.qty_standard AS std, COALESCE(req.rm, false) AS rm, req.change_reason AS why,
                  req.tol_pct AS tol, req.sort_order, COALESCE(iss.qty, 0) AS iss, COALESCE(iss.n, 0) AS n
             FROM req FULL JOIN iss ON iss.batch_id = req.batch_id AND iss.material_id = req.material_id),
  mat AS (SELECT m.id, m.material_code, m.short_name, m.base_unit, m.entry_unit, m.units_per_carton,
                 min(cell.sort_order) AS sort_order,
                 jsonb_object_agg(cell.batch_id, jsonb_build_object('req', cell.req, 'std', cell.std, 'rm', cell.rm, 'why', cell.why, 'tol', cell.tol, 'iss', cell.iss, 'n', cell.n)
                   || CASE WHEN bs.no_norm THEN '{"nn": true}'::jsonb ELSE '{}'::jsonb END) AS cells   -- 27/11 KHÔNG ĐỊNH MỨC: ô của mẻ không định mức — chỉ thực cấp
            FROM cell JOIN "Material" m ON m.id = cell.material_id JOIN bs ON bs.id = cell.batch_id
           GROUP BY m.id, m.material_code, m.short_name, m.base_unit, m.entry_unit, m.units_per_carton)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'material_id', mat.id, 'material_code', mat.material_code, 'material_name', mat.short_name,
           'base_unit', mat.base_unit, 'entry_unit', mat.entry_unit, 'units_per_carton', mat.units_per_carton, 'cells', mat.cells
         ) ORDER BY mat.sort_order NULLS LAST, mat.material_code), '[]'::jsonb)
    INTO v_rows FROM mat;

  -- NHÂN SỰ — mỗi việc một sự kiện có người · mẻ · lúc; đếm theo người (tên). Dòng cấp đã huỷ đếm riêng (rm_rev) — không vào "lần cấp".
  WITH bs AS (SELECT * FROM production_batch WHERE warehouse_id = p_wh AND cycle = p_cycle),
  ev AS (
    SELECT b.opened_by_name AS who, 'open'::text AS k, b.id AS batch_id, b.shift, b.created_at AS at, false AS bad, false AS exp, false AS rev
      FROM bs b WHERE b.opened_by_name IS NOT NULL
    UNION ALL SELECT b.lead_ok_by_name, 'lead', b.id, b.shift, b.lead_ok_at, false, false, false FROM bs b WHERE b.lead_ok_at IS NOT NULL AND b.lead_ok_by_name IS NOT NULL
    UNION ALL SELECT b.qa_ok_by_name, 'qaok', b.id, b.shift, b.qa_ok_at, false, false, false FROM bs b WHERE b.qa_ok_at IS NOT NULL AND b.qa_ok_by_name IS NOT NULL
    UNION ALL SELECT b.label_by_name, 'label', b.id, b.shift, b.label_at, false, false, false FROM bs b WHERE b.label_at IS NOT NULL AND b.label_by_name IS NOT NULL
    UNION ALL SELECT c.created_by_name, 'rm', c.batch_id, b.shift, c.created_at, COALESCE(c.rotation_violation, false), c.expiry_approval_id IS NOT NULL, c.reversed_at IS NOT NULL
      FROM batch_consumption c JOIN bs b ON b.id = c.batch_id WHERE c.created_by_name IS NOT NULL
    UNION ALL SELECT s.scanned_by_name, 'pour', s.batch_id, b.shift, s.created_at, false, false, false
      FROM batch_pour_scan s JOIN bs b ON b.id = s.batch_id WHERE s.scanned_by_name IS NOT NULL
    UNION ALL SELECT mv.created_by_name, 'fill', mv.batch_id, b.shift, mv.created_at, false, false, false
      FROM tank_movement mv JOIN bs b ON b.id = mv.batch_id WHERE mv.kind = 'FILL' AND mv.created_by_name IS NOT NULL
    UNION ALL SELECT b.qa_by_name, 'tankqa', b.id, b.shift, b.qa_at, false, false, false
      FROM bs b WHERE b.qa_status IN ('RELEASED', 'REJECTED') AND b.qa_at IS NOT NULL AND b.qa_by_name IS NOT NULL
    UNION ALL SELECT st.value->>'by', 'log', l.batch_id, b.shift, (st.value->>'at')::timestamptz, false, false, false
      FROM batch_process_log l JOIN bs b ON b.id = l.batch_id CROSS JOIN LATERAL jsonb_each(COALESCE(l.stamps, '{}'::jsonb)) st
     WHERE jsonb_typeof(st.value) = 'object' AND st.value->>'by' IS NOT NULL AND st.value->>'at' IS NOT NULL
    UNION ALL SELECT l.confirmed_by_name, 'logok', l.batch_id, b.shift, l.confirmed_at, false, false, false
      FROM batch_process_log l JOIN bs b ON b.id = l.batch_id WHERE l.confirmed_at IS NOT NULL AND l.confirmed_by_name IS NOT NULL
  ), pp AS (
    SELECT btrim(ev.who) AS name,
           count(*) FILTER (WHERE k = 'open') AS open, count(*) FILTER (WHERE k = 'lead') AS lead, count(*) FILTER (WHERE k = 'qaok') AS qaok,
           count(*) FILTER (WHERE k = 'label') AS label,
           count(*) FILTER (WHERE k = 'rm' AND NOT rev) AS rm, count(*) FILTER (WHERE k = 'rm' AND rev) AS rm_rev,
           count(*) FILTER (WHERE k = 'rm' AND NOT rev AND bad) AS rm_bad, count(*) FILTER (WHERE k = 'rm' AND NOT rev AND exp) AS rm_exp,
           count(DISTINCT batch_id) FILTER (WHERE k = 'rm' AND NOT rev) AS rm_batches,
           count(*) FILTER (WHERE k = 'pour') AS pour, count(*) FILTER (WHERE k = 'fill') AS fill, count(*) FILTER (WHERE k = 'tankqa') AS tankqa,
           count(*) FILTER (WHERE k = 'log') AS log, count(*) FILTER (WHERE k = 'logok') AS logok,
           count(DISTINCT batch_id) AS batches,
           COALESCE(jsonb_agg(DISTINCT ev.shift) FILTER (WHERE ev.shift IS NOT NULL), '[]'::jsonb) AS shifts,
           min(at) AS first_at, max(at) AS last_at
      FROM ev WHERE btrim(ev.who) <> '' GROUP BY btrim(ev.who)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(pp) ORDER BY pp.first_at, pp.name), '[]'::jsonb) INTO v_people FROM pp;

  RETURN jsonb_build_object('warehouse_id', p_wh, 'cycle', p_cycle, 'batches', v_batches, 'rows', v_rows, 'people', v_people);
END $function$;

CREATE OR REPLACE FUNCTION public.mes_batch_board(p_batch_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
             'removed', r.removed_at IS NOT NULL, 'listed', r.batch_id IS NOT NULL AND r.removed_at IS NULL, 'change_reason', r.change_reason, 'changed_by_name', r.changed_by_name, 'changed_at', r.changed_at,
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
END $function$;

CREATE OR REPLACE FUNCTION public.mes_batch_cells(p_ids text[])
 RETURNS TABLE(batch_id text, material_id text, is_kg boolean, std numeric, sheet numeric, iss numeric, tol numeric, rm boolean, why text, state text, closed boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH b AS (
    SELECT pb.id, (pb.qa_status = 'REJECTED' OR EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = pb.id AND mv.kind = 'FILL')) AS closed, pb.no_norm AS nn
      FROM production_batch pb WHERE pb.id = ANY(p_ids) AND pb.status <> 'CANCELLED'),
  rq AS (SELECT r.batch_id, r.material_id, CASE WHEN r.removed_at IS NULL THEN r.qty_required END AS req, r.qty_standard AS std,
                r.removed_at IS NOT NULL AS rm, r.change_reason AS why, r.tol_pct AS tol
           FROM batch_requirement r JOIN b ON b.id = r.batch_id),
  cs AS (SELECT c.batch_id, c.material_id, sum(c.qty) AS qty FROM batch_consumption c JOIN b ON b.id = c.batch_id
          WHERE c.reversed_at IS NULL GROUP BY c.batch_id, c.material_id),
  cell AS (SELECT COALESCE(rq.batch_id, cs.batch_id) AS batch_id, COALESCE(rq.material_id, cs.material_id) AS material_id,
                  rq.req, rq.std, COALESCE(rq.rm, false) AS rm, rq.why, rq.tol, COALESCE(cs.qty, 0) AS iss
             FROM rq FULL JOIN cs ON cs.batch_id = rq.batch_id AND cs.material_id = rq.material_id)
  SELECT cell.batch_id, cell.material_id, upper(btrim(COALESCE(m.base_unit, ''))) = 'KG',
         COALESCE(cell.std, 0), CASE WHEN cell.rm OR cell.req IS NULL THEN 0 ELSE cell.req END, cell.iss, cell.tol, cell.rm, cell.why,
         CASE WHEN b.nn THEN 'nonorm' ELSE mes_line_state(cell.std, cell.req, cell.rm, cell.tol, cell.iss, b.closed) END, b.closed
    FROM cell JOIN b ON b.id = cell.batch_id JOIN "Material" m ON m.id = cell.material_id
$function$;

CREATE OR REPLACE FUNCTION public.mes_batch_agg(p_ids text[])
 RETURNS TABLE(batch_id text, lines integer, pending integer, ok integer, over integer, under integer, extra integer, edited integer, std_kg numeric, sheet_kg numeric, iss_kg numeric, edit_kg numeric, exec_kg numeric, total_kg numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT c.batch_id, count(*) FILTER (WHERE c.state <> 'nonorm')::int,
         count(*) FILTER (WHERE c.state IN ('progress', 'none'))::int,
         count(*) FILTER (WHERE c.state = 'ok')::int, count(*) FILTER (WHERE c.state = 'over')::int,
         count(*) FILTER (WHERE c.state = 'under')::int, count(*) FILTER (WHERE c.state = 'extra')::int,
         count(*) FILTER (WHERE c.state NOT IN ('progress', 'none') AND c.sheet <> c.std)::int,
         COALESCE(sum(c.std) FILTER (WHERE c.is_kg AND c.state NOT IN ('progress', 'none')), 0),
         COALESCE(sum(c.sheet) FILTER (WHERE c.is_kg AND c.state NOT IN ('progress', 'none')), 0),
         COALESCE(sum(c.iss) FILTER (WHERE c.is_kg AND c.state NOT IN ('progress', 'none')), 0),
         COALESCE(sum(c.sheet - c.std) FILTER (WHERE c.is_kg AND c.state NOT IN ('progress', 'none')), 0),
         COALESCE(sum(c.iss - c.sheet) FILTER (WHERE c.is_kg AND c.state NOT IN ('progress', 'none', 'nonorm')), 0),
         COALESCE(sum(c.iss - c.std) FILTER (WHERE c.is_kg AND c.state NOT IN ('progress', 'none', 'nonorm')), 0)
    FROM mes_batch_cells(p_ids) c GROUP BY c.batch_id
$function$;

CREATE OR REPLACE FUNCTION public.mes_dev_line_keep(p_state text, p_std numeric, p_sheet numeric, p_iss numeric)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_state IN ('over', 'under', 'extra')
      OR (p_state NOT IN ('progress', 'none', 'nonorm') AND (p_sheet IS DISTINCT FROM p_std OR p_iss IS DISTINCT FROM p_sheet))
$function$;

CREATE OR REPLACE FUNCTION public.mes_batch_fact_build(p_batch text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  b       production_batch%ROWTYPE;
  v_fill  timestamptz;
  v_date  date;
  v_shift text;
BEGIN
  IF p_batch IS NULL THEN RETURN; END IF;
  -- hai giao dịch cùng sửa một mẻ: người sau chờ người trước xong rồi mới đọc ⇒ sổ không bỏ sót lần cấp của ai
  PERFORM pg_advisory_xact_lock(hashtext('mes_batch_fact'), hashtext(p_batch));
  SELECT * INTO b FROM production_batch WHERE id = p_batch;
  IF FOUND THEN SELECT min(mv.created_at) INTO v_fill FROM tank_movement mv WHERE mv.batch_id = p_batch AND mv.kind = 'FILL'; END IF;
  IF NOT FOUND OR b.id IS NULL OR b.status = 'CANCELLED' OR v_fill IS NULL THEN
    DELETE FROM production_batch_dev_line WHERE batch_id = p_batch;
    DELETE FROM production_batch_fact WHERE batch_id = p_batch;
    RETURN;
  END IF;
  v_date := COALESCE(b.prod_date, (b.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);
  v_shift := NULLIF(btrim(COALESCE(b.shift, '')), '');
  INSERT INTO production_batch_fact (batch_id, warehouse_id, prod_date, shift, btp_id, batch_code, batch_no, cycle, created_at, filled_at, open_min,
                                     qa_status, rm_bad, lines, pending, ok, over, under, extra, edited,
                                     std_kg, sheet_kg, iss_kg, edit_kg, exec_kg, total_kg, no_norm, updated_at)
  SELECT b.id, b.warehouse_id, v_date, v_shift, b.material_id, b.batch_code, b.batch_no, b.cycle, b.created_at, v_fill,
         GREATEST(0, round(extract(epoch FROM (v_fill - b.created_at)) / 60))::int, b.qa_status,
         (SELECT count(*) FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL AND COALESCE(c.rotation_violation, false))::int,
         COALESCE(a.lines, 0), COALESCE(a.pending, 0), COALESCE(a.ok, 0), COALESCE(a.over, 0), COALESCE(a.under, 0), COALESCE(a.extra, 0), COALESCE(a.edited, 0),
         COALESCE(a.std_kg, 0), COALESCE(a.sheet_kg, 0), COALESCE(a.iss_kg, 0), COALESCE(a.edit_kg, 0), COALESCE(a.exec_kg, 0), COALESCE(a.total_kg, 0), b.no_norm, now()
    FROM (SELECT 1) one LEFT JOIN mes_batch_agg(ARRAY[p_batch]) a ON true
  ON CONFLICT (batch_id) DO UPDATE SET warehouse_id = EXCLUDED.warehouse_id, prod_date = EXCLUDED.prod_date, shift = EXCLUDED.shift, btp_id = EXCLUDED.btp_id,
    batch_code = EXCLUDED.batch_code, batch_no = EXCLUDED.batch_no, cycle = EXCLUDED.cycle, created_at = EXCLUDED.created_at, filled_at = EXCLUDED.filled_at,
    open_min = EXCLUDED.open_min, qa_status = EXCLUDED.qa_status, rm_bad = EXCLUDED.rm_bad, lines = EXCLUDED.lines, pending = EXCLUDED.pending, ok = EXCLUDED.ok,
    over = EXCLUDED.over, under = EXCLUDED.under, extra = EXCLUDED.extra, edited = EXCLUDED.edited, std_kg = EXCLUDED.std_kg, sheet_kg = EXCLUDED.sheet_kg,
    iss_kg = EXCLUDED.iss_kg, edit_kg = EXCLUDED.edit_kg, exec_kg = EXCLUDED.exec_kg, total_kg = EXCLUDED.total_kg, no_norm = EXCLUDED.no_norm, updated_at = EXCLUDED.updated_at;
  DELETE FROM production_batch_dev_line WHERE batch_id = p_batch;
  INSERT INTO production_batch_dev_line (id, batch_id, warehouse_id, prod_date, shift, material_id, state, std, sheet, iss, why, updated_at)
  SELECT gen_random_uuid()::text, p_batch, b.warehouse_id, v_date, v_shift, c.material_id, c.state, c.std, c.sheet, c.iss, c.why, now()
    FROM mes_batch_cells(ARRAY[p_batch]) c WHERE mes_dev_line_keep(c.state, c.std, c.sheet, c.iss);
END $function$;

CREATE OR REPLACE FUNCTION public.mes_dashboard(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wh    text := nullif(p->>'warehouse_id', '');
  v_from  date := nullif(p->>'date_from', '')::date;
  v_to    date := nullif(p->>'date_to', '')::date;
  v_grain text := coalesce(nullif(p->>'grain', ''), 'day');
  v_days  int;
  v_pfrom date;
  v_pto   date;
  v_dev   numeric;
  v_pass  numeric;
  v_out   jsonb;
BEGIN
  IF v_wh IS NULL THEN RAISE EXCEPTION 'MESERR:WAREHOUSE|Chọn kho chế biến'; END IF;
  IF v_from IS NULL OR v_to IS NULL OR v_to < v_from THEN RAISE EXCEPTION 'MESERR:DATE_RANGE|Khoảng ngày không hợp lệ'; END IF;
  v_days := v_to - v_from + 1;
  IF v_days > 1100 THEN RAISE EXCEPTION 'MESERR:DATE_RANGE|Tối đa 3 năm'; END IF;
  IF v_grain NOT IN ('batch', 'day', 'week', 'month', 'year') THEN RAISE EXCEPTION 'MESERR:KIND|Cách gom không hợp lệ'; END IF;
  -- kỳ so (▲▼): màn gửi kỳ liền trước CÙNG kiểu (tháng trước · năm trước…); vắng ⇒ cùng số ngày liền trước như 22/11
  v_pfrom := COALESCE(nullif(p->>'prev_from', '')::date, v_from - v_days);
  v_pto := COALESCE(nullif(p->>'prev_to', '')::date, v_from - 1);
  IF v_pto < v_pfrom OR v_pto - v_pfrom > 1100 THEN RAISE EXCEPTION 'MESERR:DATE_RANGE|Kỳ so không hợp lệ'; END IF;
  SELECT COALESCE(w.mes_dev_target_pct, 0.5), COALESCE(w.mes_pass_target_pct, 95) INTO v_dev, v_pass FROM "Warehouse" w WHERE w.id = v_wh;

  WITH b AS MATERIALIZED (SELECT * FROM mes_dash_batches(v_wh, v_from, v_to)),
  l AS MATERIALIZED (SELECT * FROM mes_dash_lines(v_wh, v_from, v_to) WHERE state IN ('over', 'under', 'extra')),   -- 25/11 B7: sổ dòng nay có cả dòng sửa phiếu / cấp lệch trong dung sai; pareto · ngoại lệ chỉ tính dòng LỆCH
  pv AS MATERIALIZED (SELECT * FROM mes_dash_batches(v_wh, v_pfrom, v_pto)),
  bk AS (SELECT CASE v_grain WHEN 'week' THEN date_trunc('week', b.prod_date)::date WHEN 'month' THEN date_trunc('month', b.prod_date)::date
                            WHEN 'year' THEN date_trunc('year', b.prod_date)::date ELSE b.prod_date END AS k, b.* FROM b),
  pct AS (SELECT b.*, CASE WHEN b.std_kg > 0 THEN round(b.total_kg / b.std_kg * 100, 3) END AS pct, (b.over + b.under + b.extra) AS dev FROM b)
  SELECT jsonb_build_object(
    'warehouse_id', v_wh, 'date_from', v_from, 'date_to', v_to, 'grain', v_grain, 'prev_from', v_pfrom, 'prev_to', v_pto, 'computed_at', now(),
    'targets', jsonb_build_object('dev_pct', v_dev, 'pass_pct', v_pass),
    'totals', (SELECT jsonb_build_object(
        'batches', count(*), 'filled', count(*) FILTER (WHERE filled), 'filled_norm', count(*) FILTER (WHERE filled AND NOT no_norm), 'no_norm', count(*) FILTER (WHERE no_norm), 'pass', count(*) FILTER (WHERE filled AND NOT no_norm AND over + under + extra = 0),
        'dev_batches', count(*) FILTER (WHERE over + under + extra > 0),
        'lines', COALESCE(sum(lines), 0), 'pending', COALESCE(sum(pending), 0), 'ok', COALESCE(sum(ok), 0), 'over', COALESCE(sum(over), 0),
        'under', COALESCE(sum(under), 0), 'extra', COALESCE(sum(extra), 0), 'edited', COALESCE(sum(edited), 0),
        'std_kg', COALESCE(sum(std_kg), 0), 'sheet_kg', COALESCE(sum(sheet_kg), 0), 'iss_kg', COALESCE(sum(iss_kg), 0),
        'edit_kg', COALESCE(sum(edit_kg), 0), 'exec_kg', COALESCE(sum(exec_kg), 0), 'total_kg', COALESCE(sum(total_kg), 0),
        'avg_min', round(avg(open_min) FILTER (WHERE filled)), 'rm_bad', COALESCE(sum(rm_bad), 0),
        'qa_released', count(*) FILTER (WHERE qa_status = 'RELEASED'), 'qa_rejected', count(*) FILTER (WHERE qa_status = 'REJECTED')) FROM b),
    'prev', (SELECT jsonb_build_object(
        'batches', count(*), 'filled', count(*) FILTER (WHERE filled), 'filled_norm', count(*) FILTER (WHERE filled AND NOT no_norm), 'no_norm', count(*) FILTER (WHERE no_norm), 'pass', count(*) FILTER (WHERE filled AND NOT no_norm AND over + under + extra = 0),
        'over', COALESCE(sum(over), 0), 'under', COALESCE(sum(under), 0), 'extra', COALESCE(sum(extra), 0),
        'std_kg', COALESCE(sum(std_kg), 0), 'total_kg', COALESCE(sum(total_kg), 0), 'avg_min', round(avg(open_min) FILTER (WHERE filled)),
        'qa_released', count(*) FILTER (WHERE qa_status = 'RELEASED'), 'qa_rejected', count(*) FILTER (WHERE qa_status = 'REJECTED')) FROM pv),
    'buckets', (SELECT COALESCE(jsonb_agg(jsonb_build_object('k', x.k, 'batches', x.n, 'filled', x.filled, 'filled_norm', x.filled_norm, 'no_norm', x.nn, 'pass', x.pass, 'dev_batches', x.devb,
                  'dev_lines', x.devl, 'std_kg', x.std, 'total_kg', x.tot, 'edit_kg', x.edit, 'exec_kg', x.exec) ORDER BY x.k), '[]'::jsonb)
                  FROM (SELECT k, count(*) AS n, count(*) FILTER (WHERE filled) AS filled, count(*) FILTER (WHERE filled AND NOT no_norm) AS filled_norm, count(*) FILTER (WHERE no_norm) AS nn, count(*) FILTER (WHERE filled AND NOT no_norm AND over + under + extra = 0) AS pass,
                               count(*) FILTER (WHERE over + under + extra > 0) AS devb, sum(over + under + extra) AS devl,
                               sum(std_kg) AS std, sum(total_kg) AS tot, sum(edit_kg) AS edit, sum(exec_kg) AS exec FROM bk GROUP BY k) x),
    'points', CASE WHEN v_grain = 'batch' THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.batch_id, 'code', x.batch_code, 'no', x.batch_no,
                  'shift', x.shift, 'at', x.created_at, 'filled', x.filled, 'std_kg', x.std_kg, 'total_kg', x.total_kg, 'pct', x.pct, 'dev', x.dev,
                  'pending', x.pending) ORDER BY x.created_at), '[]'::jsonb) FROM pct x) END,
    'heat', (SELECT COALESCE(jsonb_agg(jsonb_build_object('shift', x.shift, 'k', x.k, 'batches', x.n, 'dev_batches', x.devb, 'std_kg', x.std, 'total_kg', x.tot)
                  ORDER BY x.k, x.shift NULLS LAST), '[]'::jsonb)
                  FROM (SELECT shift, k, count(*) AS n, count(*) FILTER (WHERE over + under + extra > 0) AS devb, sum(std_kg) AS std, sum(total_kg) AS tot
                          FROM bk GROUP BY shift, k) x),
    'shifts', (SELECT COALESCE(jsonb_agg(jsonb_build_object('shift', x.shift, 'batches', x.n, 'filled', x.filled, 'filled_norm', x.filled_norm, 'no_norm', x.nn, 'pass', x.pass, 'dev_lines', x.devl,
                  'std_kg', x.std, 'total_kg', x.tot) ORDER BY x.shift NULLS LAST), '[]'::jsonb)
                  FROM (SELECT shift, count(*) AS n, count(*) FILTER (WHERE filled) AS filled, count(*) FILTER (WHERE filled AND NOT no_norm) AS filled_norm, count(*) FILTER (WHERE no_norm) AS nn, count(*) FILTER (WHERE filled AND NOT no_norm AND over + under + extra = 0) AS pass,
                               sum(over + under + extra) AS devl, sum(std_kg) AS std, sum(total_kg) AS tot FROM b GROUP BY shift) x),
    'btp', (SELECT COALESCE(jsonb_agg(jsonb_build_object('btp_id', x.btp_id, 'code', m.material_code, 'name', m.short_name, 'batches', x.n, 'filled', x.filled, 'filled_norm', x.filled_norm, 'no_norm', x.nn,
                  'pass', x.pass, 'dev_lines', x.devl, 'std_kg', x.std, 'total_kg', x.tot) ORDER BY x.n DESC, m.material_code), '[]'::jsonb)
                  FROM (SELECT btp_id, count(*) AS n, count(*) FILTER (WHERE filled) AS filled, count(*) FILTER (WHERE filled AND NOT no_norm) AS filled_norm, count(*) FILTER (WHERE no_norm) AS nn, count(*) FILTER (WHERE filled AND NOT no_norm AND over + under + extra = 0) AS pass,
                               sum(over + under + extra) AS devl, sum(std_kg) AS std, sum(total_kg) AS tot FROM b GROUP BY btp_id) x
                  JOIN "Material" m ON m.id = x.btp_id),
    'pareto_total', (SELECT count(*) FROM l),
    'pareto', (SELECT COALESCE(jsonb_agg(jsonb_build_object('material_id', x.material_id, 'code', m.material_code, 'name', m.short_name, 'unit', m.base_unit,
                  'n', x.n, 'batches', x.nb, 'over', x.ov, 'under', x.un, 'extra', x.ex, 'std', x.std, 'iss', x.iss) ORDER BY x.n DESC, m.material_code), '[]'::jsonb)
                  FROM (SELECT material_id, count(*) AS n, count(DISTINCT batch_id) AS nb, count(*) FILTER (WHERE state = 'over') AS ov,
                               count(*) FILTER (WHERE state = 'under') AS un, count(*) FILTER (WHERE state = 'extra') AS ex, sum(std) AS std, sum(iss) AS iss
                          FROM l GROUP BY material_id ORDER BY count(*) DESC LIMIT 10) x
                  JOIN "Material" m ON m.id = x.material_id),
    'spc', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.batch_id, 'code', x.batch_code, 'no', x.batch_no, 'shift', x.shift, 'd', x.prod_date,
                  'at', x.created_at, 'pct', x.pct, 'dev', x.dev, 'filled', x.filled) ORDER BY x.created_at), '[]'::jsonb)
                  FROM (SELECT * FROM pct WHERE std_kg > 0 ORDER BY created_at DESC LIMIT 300) x),
    'exc', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.batch_id, 'code', x.batch_code, 'no', x.batch_no, 'shift', x.shift, 'd', x.prod_date,
                  'btp', m.material_code, 'filled', x.filled, 'std_kg', x.std_kg, 'total_kg', x.total_kg, 'pct', x.pct, 'dev', x.dev,
                  'edit_kg', x.edit_kg, 'exec_kg', x.exec_kg, 'extra', x.extra,
                  'mat', (SELECT jsonb_build_object('code', mm.material_code, 'name', mm.short_name, 'unit', mm.base_unit, 'state', ll.state, 'diff', ll.iss - ll.std)
                            FROM l ll JOIN "Material" mm ON mm.id = ll.material_id WHERE ll.batch_id = x.batch_id ORDER BY abs(ll.iss - ll.std) DESC LIMIT 1))
                  ORDER BY abs(x.pct) DESC, x.created_at DESC), '[]'::jsonb)
                  FROM (SELECT * FROM pct WHERE std_kg > 0 AND dev > 0 ORDER BY abs(pct) DESC, created_at DESC LIMIT 10) x
                  JOIN "Material" m ON m.id = x.btp_id)
  ) INTO v_out;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.mes_dashboard_detail(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wh    text := nullif(p->>'warehouse_id', '');
  v_from  date := nullif(p->>'date_from', '')::date;
  v_to    date := nullif(p->>'date_to', '')::date;
  v_kind  text := coalesce(nullif(p->>'kind', ''), 'batches');
  v_shift text := nullif(p->>'shift', '');
  v_btp   text := nullif(p->>'btp_id', '');
  v_mat   text := nullif(p->>'material_id', '');
  v_only  text := nullif(p->>'only', '');
  v_lim   int := least(greatest(coalesce((p->>'limit')::int, 500), 1), 500);
  v_out   jsonb;
BEGIN
  IF v_wh IS NULL THEN RAISE EXCEPTION 'MESERR:WAREHOUSE|Chọn kho chế biến'; END IF;
  IF v_from IS NULL OR v_to IS NULL OR v_to < v_from OR v_to - v_from > 1100 THEN RAISE EXCEPTION 'MESERR:DATE_RANGE|Khoảng ngày không hợp lệ'; END IF;
  IF v_kind NOT IN ('batches', 'lines') THEN RAISE EXCEPTION 'MESERR:KIND|Loại dữ liệu không hợp lệ'; END IF;
  IF v_kind = 'batches' THEN
    WITH f AS MATERIALIZED (
      SELECT b.*, CASE WHEN b.std_kg > 0 THEN round(b.total_kg / b.std_kg * 100, 3) END AS pct, (b.over + b.under + b.extra) AS dev
        FROM mes_dash_batches(v_wh, v_from, v_to) b
       WHERE (v_shift IS NULL OR (v_shift = '__none' AND b.shift IS NULL) OR b.shift = v_shift)
         AND (v_btp IS NULL OR b.btp_id = v_btp)
         AND (v_only IS NULL
              OR (v_only = 'dev' AND b.over + b.under + b.extra > 0)
              OR (v_only = 'fail' AND b.filled AND b.over + b.under + b.extra > 0)
              OR (v_only = 'pass' AND b.filled AND NOT b.no_norm AND b.over + b.under + b.extra = 0)
              OR (v_only = 'filled' AND b.filled)
              OR (v_only = 'running' AND NOT b.filled)
              OR (v_only = 'edited' AND b.edited > 0)
              OR (v_only = 'qa_rejected' AND b.qa_status = 'REJECTED')
              OR (v_only = 'rm_bad' AND b.rm_bad > 0)))
    SELECT jsonb_build_object('kind', 'batches', 'total', (SELECT count(*) FROM f), 'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', x.batch_id, 'code', x.batch_code, 'no', x.batch_no, 'shift', x.shift, 'd', x.prod_date, 'at', x.created_at,
               'btp', m.material_code, 'btp_name', m.short_name, 'filled', x.filled, 'qa_status', x.qa_status, 'open_min', x.open_min, 'rm_bad', x.rm_bad,
               'lines', x.lines, 'pending', x.pending, 'over', x.over, 'under', x.under, 'extra', x.extra, 'edited', x.edited,
               'std_kg', x.std_kg, 'iss_kg', x.iss_kg, 'edit_kg', x.edit_kg, 'exec_kg', x.exec_kg, 'total_kg', x.total_kg, 'pct', x.pct, 'no_norm', x.no_norm)
               ORDER BY x.prod_date DESC, x.created_at DESC)
        FROM (SELECT * FROM f ORDER BY prod_date DESC, created_at DESC LIMIT v_lim) x JOIN "Material" m ON m.id = x.btp_id), '[]'::jsonb))
      INTO v_out;
  ELSE
    WITH bb AS MATERIALIZED (SELECT batch_id, btp_id, batch_code, batch_no, created_at, filled FROM mes_dash_batches(v_wh, v_from, v_to)),
    f AS MATERIALIZED (
      SELECT l.*, bb.btp_id, bb.batch_code, bb.batch_no, bb.created_at, bb.filled FROM mes_dash_lines(v_wh, v_from, v_to) l JOIN bb ON bb.batch_id = l.batch_id
       WHERE (v_shift IS NULL OR (v_shift = '__none' AND l.shift IS NULL) OR l.shift = v_shift)
         AND (v_btp IS NULL OR bb.btp_id = v_btp) AND (v_mat IS NULL OR l.material_id = v_mat)
         AND CASE WHEN v_only = 'edited' THEN l.sheet <> l.std WHEN v_only = 'exec' THEN l.iss <> l.sheet
                  WHEN v_only IS NULL THEN l.state IN ('over', 'under', 'extra') ELSE l.state = v_only END)   -- 25/11 B7
    SELECT jsonb_build_object('kind', 'lines', 'total', (SELECT count(*) FROM f), 'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('batch_id', x.batch_id, 'code', x.batch_code, 'no', x.batch_no, 'shift', x.shift, 'd', x.prod_date,
               'filled', x.filled, 'btp', bm.material_code, 'mat_id', x.material_id, 'mat_code', m.material_code, 'mat_name', m.short_name, 'unit', m.base_unit,
               'state', x.state, 'std', x.std, 'sheet', x.sheet, 'iss', x.iss, 'diff', x.iss - x.std, 'edit', x.sheet - x.std, 'exec', x.iss - x.sheet,
               'pct', CASE WHEN x.std > 0 THEN round((x.iss - x.std) / x.std * 100, 1) END, 'why', x.why)
               ORDER BY x.prod_date DESC, x.created_at DESC, m.material_code)
        FROM (SELECT * FROM f ORDER BY prod_date DESC, created_at DESC LIMIT v_lim) x
        JOIN "Material" m ON m.id = x.material_id JOIN "Material" bm ON bm.id = x.btp_id), '[]'::jsonb))
      INTO v_out;
  END IF;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.mes_recipe_save(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mat    text := p->>'material_id';
  v_id     text := nullif(p->>'id', '');
  v_name   text := btrim(coalesce(p->>'name', ''));
  v_base   numeric := nullif(p->>'base_qty', '')::numeric;
  v_list   boolean;
  v_active boolean := coalesce((p->>'is_active')::boolean, true);
  v_def    boolean := coalesce((p->>'is_default')::boolean, false);
  cur      record;
  l        jsonb;
  v_i      integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Material" WHERE id = v_mat) THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mã bán thành phẩm'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'MESERR:NAME|Nhập tên công thức'; END IF;
  IF length(v_name) > 80 THEN RAISE EXCEPTION 'MESERR:NAME|Tên công thức tối đa 80 ký tự'; END IF;
  -- 27/11 KHÔNG ĐỊNH MỨC: công thức CHỈ DANH SÁCH MÃ = không cỡ mẻ chuẩn và không dòng nào có số lượng; có số thì phải đủ — không nửa vời
  v_list := v_base IS NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) x WHERE nullif(x->>'qty', '') IS NOT NULL);
  IF NOT v_list THEN
    IF v_base IS NULL OR v_base <= 0 THEN
      RAISE EXCEPTION 'MESERR:QTY|Cỡ mẻ chuẩn phải lớn hơn 0 — hoặc để trống cả cỡ mẻ lẫn mọi số lượng (công thức chỉ danh sách mã)';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) x WHERE nullif(x->>'qty', '') IS NULL OR (x->>'qty')::numeric <= 0) THEN
      RAISE EXCEPTION 'MESERR:QTY|Công thức có số lượng thì mọi nguyên liệu phải có số lượng lớn hơn 0 — hoặc để trống hết (chỉ danh sách mã)';
    END IF;
  END IF;
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
    VALUES (gen_random_uuid()::text, v_id, l->>'material_id', CASE WHEN v_list THEN NULL ELSE (l->>'qty')::numeric END,
            CASE WHEN v_list THEN NULL ELSE nullif(l->>'tol_pct', '')::numeric END, v_i,
            nullif(btrim(coalesce(l->>'note', '')), ''), now());
  END LOOP;
  RETURN jsonb_build_object('id', v_id, 'lines', v_i, 'is_default', (SELECT is_default FROM production_recipe WHERE id = v_id));
END $function$;

CREATE OR REPLACE FUNCTION public.mes_consume_scan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wh   text := mes_open_batch_wh(p->>'batch_id');
  v_qty  numeric := (p->>'qty')::numeric;
  v_rot  jsonb := COALESCE(p->'rotation', '{}'::jsonb);
  e      record;
  v_appr mes_expiry_approval;
  v_new  numeric;
  v_id   text := gen_random_uuid()::text;
BEGIN
  PERFORM mes_consume_flow_gate(p->>'batch_id');   -- 25/11 N1: luật luồng chặt kiểm TRONG giao dịch, sau khoá mẻ (FOR SHARE)
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Số lượng rút phải lớn hơn 0'; END IF;
  SELECT * INTO e FROM "InventoryEntry" WHERE id = p->>'entry_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy dòng tồn'; END IF;
  PERFORM mes_no_norm_code_check(p->>'batch_id', e.material_id);   -- 27/11 KHÔNG ĐỊNH MỨC: mã lạ (không có trong danh sách của mẻ) ⇒ chặn
  IF e.warehouse_id IS DISTINCT FROM v_wh THEN
    RAISE EXCEPTION 'MESERR:WRONG_WAREHOUSE|Tem % không nằm trong kho của mẻ — chuyển hàng sang kho chế biến trước', e.pallet_code;
  END IF;
  IF e.status NOT IN ('IN_STOCK', 'PARTIAL') THEN
    RAISE EXCEPTION 'MESERR:NOT_IN_STOCK|Tem % không còn là hàng trong kho (trạng thái %) — không rút vào mẻ được', e.pallet_code, e.status;
  END IF;
  IF qa_is_hold(e.qa_status_id) THEN
    RAISE EXCEPTION 'MESERR:QA_HOLD|Tem % đang bị QA giữ — không rút vào mẻ được', e.pallet_code;
  END IF;
  IF e.expiry_calc IS NOT NULL AND e.expiry_calc < mes_vn_today() THEN
    SELECT * INTO v_appr FROM mes_expiry_approval WHERE batch_id = p->>'batch_id' AND subject_key = 'E:' || e.id;
    IF v_appr.status IS NULL OR v_appr.status = 'PENDING' THEN
      RAISE EXCEPTION 'MESERR:EXPIRED|Tem % đã hết hạn (HSD %) — chỉ cấp vào mẻ khi QA duyệt', e.pallet_code, to_char(e.expiry_calc, 'DD-MM-YYYY');
    ELSIF v_appr.status = 'REJECTED' THEN
      RAISE EXCEPTION 'MESERR:EXPIRED_REJECTED|QA đã từ chối dùng tem % (hết hạn %) cho mẻ này', e.pallet_code, to_char(e.expiry_calc, 'DD-MM-YYYY');
    END IF;
  END IF;
  IF COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0) < v_qty THEN
    RAISE EXCEPTION 'MESERR:SHORT|Tem % chỉ còn % có thể rút', e.pallet_code,
      COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0);
  END IF;
  v_new := COALESCE(e.cartons_remaining, e.cartons_imported, 0) - v_qty;
  UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = inventory_entry_status(e.status, v_new, COALESCE(e.cartons_imported, 0), e.cartons_reserved),
         updated_at = now() WHERE id = e.id;
  INSERT INTO batch_consumption (id, batch_id, entry_id, pallet_code, material_id, production_date, batch_lot, ncc_id,
         qty, source, created_by, created_by_name, created_at, updated_at,
         rotation_violation, rotation_principle, rotation_best_date, rotation_override_reason, expiry_approval_id)
  VALUES (v_id, p->>'batch_id', e.id, e.pallet_code, e.material_id, e.production_date::date, e.batch, e.ncc_id,
         v_qty, 'SCAN', p->>'actor_id', p->>'actor_name', clock_timestamp(), now(),
         CASE WHEN v_rot ? 'violation' THEN (v_rot->>'violation')::boolean END,
         NULLIF(v_rot->>'principle', ''), NULLIF(v_rot->>'best_date', ''), NULLIF(v_rot->>'override_reason', ''), v_appr.id);
  RETURN jsonb_build_object('rows', jsonb_build_array(jsonb_build_object('id', v_id, 'entry_id', e.id, 'pallet_code', e.pallet_code,
    'qty', v_qty, 'remaining', v_new, 'rotation_violation', (v_rot->>'violation')::boolean, 'expiry_approval_id', v_appr.id)));
END $function$;

CREATE OR REPLACE FUNCTION public.mes_consume_lot(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wh    text := mes_open_batch_wh(p->>'batch_id');
  v_qty   numeric := (p->>'qty')::numeric;
  v_date  date := nullif(p->>'production_date', '')::date;
  v_lot   text := nullif(btrim(coalesce(p->>'batch_lot', '')), '');
  v_rot   jsonb := COALESCE(p->'rotation', '{}'::jsonb);
  v_appr  mes_expiry_approval;
  v_exp   date;
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
  PERFORM mes_consume_flow_gate(p->>'batch_id');   -- 25/11 N1: luật luồng chặt kiểm TRONG giao dịch, sau khoá mẻ (FOR SHARE)
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Số lượng rút phải lớn hơn 0'; END IF;
  v_left := v_qty;
  PERFORM mes_no_norm_code_check(p->>'batch_id', p->>'material_id');   -- 27/11 KHÔNG ĐỊNH MỨC: mã lạ ⇒ chặn
  SELECT upper(material_code) INTO v_code FROM "Material" WHERE id = p->>'material_id';
  -- HẾT HẠN: lô (hàng không tem cấp được) có dòng quá HSD ⇒ phải có QA duyệt lô này cho mẻ này
  SELECT min(expiry_calc) INTO v_exp FROM "InventoryEntry"
   WHERE warehouse_id = v_wh AND material_id = p->>'material_id' AND status IN ('IN_STOCK', 'PARTIAL')
     AND (production_date::date IS NOT DISTINCT FROM v_date)
     AND nullif(btrim(coalesce(batch, '')), '') IS NOT DISTINCT FROM v_lot
     AND NOT qa_is_hold(qa_status_id)
     AND COALESCE(cartons_remaining, cartons_imported, 0) - COALESCE(cartons_reserved, 0) > 0
     AND upper(pallet_code) = v_code;
  IF v_exp IS NOT NULL AND v_exp < mes_vn_today() THEN
    SELECT * INTO v_appr FROM mes_expiry_approval WHERE batch_id = p->>'batch_id' AND subject_key = mes_lot_subject(p->>'material_id', v_date, v_lot);
    IF v_appr.status IS NULL OR v_appr.status = 'PENDING' THEN
      RAISE EXCEPTION 'MESERR:EXPIRED|Lô % đã hết hạn (HSD %) — chỉ cấp vào mẻ khi QA duyệt', coalesce(v_lot, to_char(v_date, 'DD-MM-YYYY'), '—'), to_char(v_exp, 'DD-MM-YYYY');
    ELSIF v_appr.status = 'REJECTED' THEN
      RAISE EXCEPTION 'MESERR:EXPIRED_REJECTED|QA đã từ chối dùng lô % (hết hạn %) cho mẻ này', coalesce(v_lot, to_char(v_date, 'DD-MM-YYYY'), '—'), to_char(v_exp, 'DD-MM-YYYY');
    END IF;
  END IF;
  FOR e IN
    SELECT * FROM "InventoryEntry"
     WHERE warehouse_id = v_wh AND material_id = p->>'material_id'
       AND status IN ('IN_STOCK', 'PARTIAL')
       AND (production_date::date IS NOT DISTINCT FROM v_date)
       AND nullif(btrim(coalesce(batch, '')), '') IS NOT DISTINCT FROM v_lot   -- ĐÚNG lô đã chọn: lô không mã lô ≠ lô có mã lô cùng NSX
       AND NOT qa_is_hold(qa_status_id)
       AND COALESCE(cartons_remaining, cartons_imported, 0) - COALESCE(cartons_reserved, 0) > 0
       AND upper(pallet_code) = v_code   -- CHỈ hàng không có tem (tồn gộp, mã tem = mã hàng); hàng có tem QR phải quét
     ORDER BY expiry_calc NULLS LAST, created_at, id
     FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0));
    v_new  := COALESCE(e.cartons_remaining, e.cartons_imported, 0) - v_take;
    UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = inventory_entry_status(e.status, v_new, COALESCE(e.cartons_imported, 0), e.cartons_reserved),
           updated_at = now() WHERE id = e.id;
    v_id := gen_random_uuid()::text;
    INSERT INTO batch_consumption (id, batch_id, entry_id, pallet_code, material_id, production_date, batch_lot, ncc_id,
           qty, source, created_by, created_by_name, created_at, updated_at,
           rotation_violation, rotation_principle, rotation_best_date, rotation_override_reason, expiry_approval_id)
    VALUES (v_id, p->>'batch_id', e.id, e.pallet_code, e.material_id, e.production_date::date, e.batch, e.ncc_id,
           v_take, 'LOT', p->>'actor_id', p->>'actor_name', clock_timestamp(), now(),
           CASE WHEN v_rot ? 'violation' THEN (v_rot->>'violation')::boolean END,
           NULLIF(v_rot->>'principle', ''), NULLIF(v_rot->>'best_date', ''), NULLIF(v_rot->>'override_reason', ''), v_appr.id);
    v_rows := v_rows || jsonb_build_object('id', v_id, 'entry_id', e.id, 'pallet_code', e.pallet_code, 'qty', v_take, 'remaining', v_new,
                'rotation_violation', (v_rot->>'violation')::boolean, 'expiry_approval_id', v_appr.id);
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
END $function$;

-- tự kiểm: mọi mẻ có tình trạng hợp lệ; mẻ có định mức không có dòng thiếu số lượng; công thức không nửa vời
DO $chk$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM production_batch b
   WHERE (mes_batch_gate(b.id)->>'stage') NOT IN ('new','wait_lead','wait_qa','working','filled','closing','released','rejected','cancelled');
  IF v_bad > 0 THEN RAISE EXCEPTION 'tự kiểm: % mẻ có tình trạng lạ', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM batch_requirement r JOIN production_batch b ON b.id = r.batch_id WHERE NOT b.no_norm AND r.qty_required IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'tự kiểm: % dòng phiếu của mẻ có định mức thiếu số lượng', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM production_recipe r
   WHERE (r.base_qty IS NULL AND EXISTS (SELECT 1 FROM production_recipe_line l WHERE l.recipe_id = r.id AND l.qty IS NOT NULL))
      OR (r.base_qty IS NOT NULL AND EXISTS (SELECT 1 FROM production_recipe_line l WHERE l.recipe_id = r.id AND l.qty IS NULL));
  IF v_bad > 0 THEN RAISE EXCEPTION 'tự kiểm: % công thức nửa có số nửa không', v_bad; END IF;
END $chk$;

COMMIT;
