-- MES 17/11 (khuya) — NGUYÊN LIỆU HẾT HẠN: CHẶN khi cấp vào mẻ, CHO QUA khi QA duyệt (user chốt 17/11: "Chặn và cho qua khi
-- QA duyệt"). Khác Xuất kho (user chốt 20/09 cho xuất hàng hết hạn — xuất huỷ): luật này CHỈ ở hai cửa cấp NVL vào mẻ.
--   • "Hết hạn" = HSD hiệu lực `InventoryEntry.expiry_calc` (trigger tính: HSD trên tem → NSX + hạn dùng) < HÔM NAY giờ VN.
--     Ngày HSD còn dùng được. Không biết HSD (thiếu NSX / hạn dùng) ⇒ không chặn.
--   • Duyệt theo TỪNG MẺ cho TỪNG TEM (entry) hoặc TỪNG LÔ không tem (mã + NSX + mã lô) — sổ `mes_expiry_approval`,
--     một dòng / (mẻ, đối tượng): PENDING (công nhân gửi) → APPROVED / REJECTED (người có quyền production.approve_expired).
--   • Cửa ghi `mes_consume_scan` / `mes_consume_lot` tự kiểm (một giao dịch với phép trừ tồn) và ghi id dòng duyệt lên dòng cấp.
--   • Đồng bộ cửa "Không có tem": `mes_consume_lot` nhận + ghi vết luân chuyển như cửa quét (20261117d).
BEGIN;

-- 1. SỔ DUYỆT DÙNG HÀNG HẾT HẠN ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mes_expiry_approval (
  id                text PRIMARY KEY,
  batch_id          text NOT NULL REFERENCES public.production_batch(id),
  -- 'E:<entry_id>' (tem) · 'L:<material_id>|<NSX yyyy-mm-dd>|<mã lô>' (hàng không tem) — hàm mes_lot_subject
  subject_key       text NOT NULL,
  entry_id          text REFERENCES public."InventoryEntry"(id) ON DELETE SET NULL,
  material_id       text NOT NULL REFERENCES public."Material"(id),
  pallet_code       text,
  production_date   date,
  batch_lot         text,
  expiry_date       date,
  status            text NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by      text,
  requested_by_name text,
  requested_at      timestamptz,
  decided_by        text,
  decided_by_name   text,
  decided_at        timestamptz,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL,
  CONSTRAINT mes_expiry_approval_subject_uq UNIQUE (batch_id, subject_key)
);
ALTER TABLE public.mes_expiry_approval ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.mes_expiry_approval IS
  'MES 17/11: QA duyệt dùng NGUYÊN LIỆU HẾT HẠN cho một mẻ — từng tem (entry) hoặc từng lô không tem. Cửa cấp mes_consume_scan / mes_consume_lot đòi dòng APPROVED.';

ALTER TABLE public.batch_consumption ADD COLUMN IF NOT EXISTS expiry_approval_id text;
COMMENT ON COLUMN public.batch_consumption.expiry_approval_id IS 'Dòng cấp hàng HẾT HẠN: id dòng QA duyệt (mes_expiry_approval) — null = hàng còn hạn';

-- 2. HÀM PHỤ ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_vn_today() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
$$;

CREATE OR REPLACE FUNCTION public.mes_lot_subject(p_material text, p_date date, p_lot text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'L:' || p_material || '|' || coalesce(p_date::text, '') || '|' || coalesce(nullif(btrim(coalesce(p_lot, '')), ''), '')
$$;

-- Đối tượng xin / duyệt trong KHO CỦA MẺ: p.entry_id (tem) HOẶC p.material_id + p.production_date + p.batch_lot (lô không tem).
-- Trả {subject_key, entry_id, material_id, pallet_code, production_date, batch_lot, expiry_date, expired}.
CREATE OR REPLACE FUNCTION public.mes_expiry_subject(p jsonb, p_wh text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  e      record;
  v_code text;
  v_date date := nullif(p->>'production_date', '')::date;
  v_lot  text := nullif(btrim(coalesce(p->>'batch_lot', '')), '');
  v_exp  date;
  v_n    int;
BEGIN
  IF nullif(p->>'entry_id', '') IS NOT NULL THEN
    SELECT id, pallet_code, material_id, warehouse_id, production_date, batch, expiry_calc INTO e
      FROM "InventoryEntry" WHERE id = p->>'entry_id';
    IF NOT FOUND OR e.warehouse_id IS DISTINCT FROM p_wh THEN
      RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy tem trong kho của mẻ';
    END IF;
    RETURN jsonb_build_object('subject_key', 'E:' || e.id, 'entry_id', e.id, 'material_id', e.material_id, 'pallet_code', e.pallet_code,
      'production_date', e.production_date::date, 'batch_lot', nullif(btrim(coalesce(e.batch, '')), ''), 'expiry_date', e.expiry_calc,
      'expired', e.expiry_calc IS NOT NULL AND e.expiry_calc < mes_vn_today());
  END IF;
  IF nullif(p->>'material_id', '') IS NULL THEN RAISE EXCEPTION 'MESERR:SUBJECT|Chọn tem hoặc lô cần duyệt'; END IF;
  SELECT upper(material_code) INTO v_code FROM "Material" WHERE id = p->>'material_id';
  IF v_code IS NULL THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mã nguyên liệu'; END IF;
  SELECT min(expiry_calc), count(*) INTO v_exp, v_n FROM "InventoryEntry"
   WHERE warehouse_id = p_wh AND material_id = p->>'material_id' AND status IN ('IN_STOCK', 'PARTIAL')
     AND production_date::date IS NOT DISTINCT FROM v_date
     AND nullif(btrim(coalesce(batch, '')), '') IS NOT DISTINCT FROM v_lot
     AND NOT qa_is_hold(qa_status_id)
     AND COALESCE(cartons_remaining, cartons_imported, 0) - COALESCE(cartons_reserved, 0) > 0
     AND upper(pallet_code) = v_code;   -- hàng KHÔNG tem (tồn gộp, mã tem = mã hàng) — đúng tập mes_consume_lot rút
  IF v_n = 0 THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy lô không tem này trong kho của mẻ (hoặc đã hết hàng cấp được)'; END IF;
  RETURN jsonb_build_object('subject_key', mes_lot_subject(p->>'material_id', v_date, v_lot), 'entry_id', NULL,
    'material_id', p->>'material_id', 'pallet_code', NULL, 'production_date', v_date, 'batch_lot', v_lot, 'expiry_date', v_exp,
    'expired', v_exp IS NOT NULL AND v_exp < mes_vn_today());
END $$;

-- 3. GỬI QA DUYỆT (người cấp NVL) — p: {batch_id, entry_id | material_id + production_date + batch_lot, note?, actor_id, actor_name}
--    Đã APPROVED / đang PENDING ⇒ giữ nguyên; đã REJECTED ⇒ gửi lại (về PENDING).
CREATE OR REPLACE FUNCTION public.mes_expiry_request(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_wh text := mes_open_batch_wh(p->>'batch_id');
  s    jsonb := mes_expiry_subject(p, v_wh);
  r    mes_expiry_approval;
BEGIN
  IF NOT (s->>'expired')::boolean THEN RAISE EXCEPTION 'MESERR:NOT_EXPIRED|Hàng này còn hạn — không cần QA duyệt'; END IF;
  INSERT INTO mes_expiry_approval AS a (id, batch_id, subject_key, entry_id, material_id, pallet_code, production_date, batch_lot, expiry_date,
         status, requested_by, requested_by_name, requested_at, note, created_at, updated_at)
  VALUES (gen_random_uuid()::text, p->>'batch_id', s->>'subject_key', s->>'entry_id', s->>'material_id', s->>'pallet_code',
         (s->>'production_date')::date, s->>'batch_lot', (s->>'expiry_date')::date,
         'PENDING', p->>'actor_id', p->>'actor_name', now(), nullif(btrim(coalesce(p->>'note', '')), ''), now(), now())
  ON CONFLICT (batch_id, subject_key) DO UPDATE
     SET status = 'PENDING', requested_by = EXCLUDED.requested_by, requested_by_name = EXCLUDED.requested_by_name, requested_at = now(),
         decided_by = NULL, decided_by_name = NULL, decided_at = NULL, note = EXCLUDED.note, expiry_date = EXCLUDED.expiry_date, updated_at = now()
   WHERE a.status = 'REJECTED'
  RETURNING * INTO r;
  IF r.id IS NULL THEN
    SELECT * INTO r FROM mes_expiry_approval WHERE batch_id = p->>'batch_id' AND subject_key = s->>'subject_key';
  END IF;
  RETURN to_jsonb(r);
END $$;

-- 4. QA DUYỆT / TỪ CHỐI — p: {batch_id, entry_id | lô, decision 'APPROVED' | 'REJECTED', note, actor_id, actor_name}
--    Chưa có yêu cầu vẫn duyệt thẳng được (QA đứng tại bàn). Duyệt chỉ cho hàng ĐANG hết hạn.
CREATE OR REPLACE FUNCTION public.mes_expiry_decide(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_wh  text := mes_open_batch_wh(p->>'batch_id');
  s     jsonb := mes_expiry_subject(p, v_wh);
  v_dec text := upper(coalesce(p->>'decision', ''));
  v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
  r     mes_expiry_approval;
BEGIN
  IF v_dec NOT IN ('APPROVED', 'REJECTED') THEN RAISE EXCEPTION 'MESERR:DECISION|Chọn Duyệt hoặc Từ chối'; END IF;
  IF v_note IS NULL THEN RAISE EXCEPTION 'MESERR:REASON|Ghi căn cứ duyệt / lý do từ chối'; END IF;
  IF NOT (s->>'expired')::boolean THEN RAISE EXCEPTION 'MESERR:NOT_EXPIRED|Hàng này còn hạn — không cần QA duyệt'; END IF;
  INSERT INTO mes_expiry_approval AS a (id, batch_id, subject_key, entry_id, material_id, pallet_code, production_date, batch_lot, expiry_date,
         status, requested_by, requested_by_name, requested_at, decided_by, decided_by_name, decided_at, note, created_at, updated_at)
  VALUES (gen_random_uuid()::text, p->>'batch_id', s->>'subject_key', s->>'entry_id', s->>'material_id', s->>'pallet_code',
         (s->>'production_date')::date, s->>'batch_lot', (s->>'expiry_date')::date,
         v_dec, p->>'actor_id', p->>'actor_name', now(), p->>'actor_id', p->>'actor_name', now(), v_note, now(), now())
  ON CONFLICT (batch_id, subject_key) DO UPDATE
     SET status = EXCLUDED.status, decided_by = EXCLUDED.decided_by, decided_by_name = EXCLUDED.decided_by_name, decided_at = now(),
         note = EXCLUDED.note, expiry_date = EXCLUDED.expiry_date, updated_at = now()
  RETURNING * INTO r;
  RETURN to_jsonb(r);
END $$;

-- 5. CỬA CẤP THEO TEM — thêm cổng HẾT HẠN (giữ nguyên phần còn lại của 20261117d)
CREATE OR REPLACE FUNCTION public.mes_consume_scan(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_wh   text := mes_open_batch_wh(p->>'batch_id');
  v_qty  numeric := (p->>'qty')::numeric;
  v_rot  jsonb := COALESCE(p->'rotation', '{}'::jsonb);
  e      record;
  v_appr mes_expiry_approval;
  v_new  numeric;
  v_id   text := gen_random_uuid()::text;
BEGIN
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Số lượng rút phải lớn hơn 0'; END IF;
  SELECT * INTO e FROM "InventoryEntry" WHERE id = p->>'entry_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy dòng tồn'; END IF;
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
  UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = mes_entry_status(v_new, COALESCE(e.cartons_imported, 0)),
         updated_at = now() WHERE id = e.id;
  INSERT INTO batch_consumption (id, batch_id, entry_id, pallet_code, material_id, production_date, batch_lot, ncc_id,
         qty, source, created_by, created_by_name, created_at, updated_at,
         rotation_violation, rotation_principle, rotation_best_date, rotation_override_reason, expiry_approval_id)
  VALUES (v_id, p->>'batch_id', e.id, e.pallet_code, e.material_id, e.production_date::date, e.batch, e.ncc_id,
         v_qty, 'SCAN', p->>'actor_id', p->>'actor_name', now(), now(),
         CASE WHEN v_rot ? 'violation' THEN (v_rot->>'violation')::boolean END,
         NULLIF(v_rot->>'principle', ''), NULLIF(v_rot->>'best_date', ''), NULLIF(v_rot->>'override_reason', ''), v_appr.id);
  RETURN jsonb_build_object('rows', jsonb_build_array(jsonb_build_object('id', v_id, 'entry_id', e.id, 'pallet_code', e.pallet_code,
    'qty', v_qty, 'remaining', v_new, 'rotation_violation', (v_rot->>'violation')::boolean, 'expiry_approval_id', v_appr.id)));
END $$;

-- 6. CỬA CẤP THEO LÔ (không tem) — thêm cổng HẾT HẠN + ghi vết LUÂN CHUYỂN như cửa quét (đồng bộ hai cửa cùng một sổ)
-- p: {batch_id, material_id, production_date, batch_lot, qty, actor_id, actor_name, rotation?: {violation, principle, best_date, override_reason}}
CREATE OR REPLACE FUNCTION public.mes_consume_lot(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
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
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Số lượng rút phải lớn hơn 0'; END IF;
  v_left := v_qty;
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
    UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = mes_entry_status(v_new, COALESCE(e.cartons_imported, 0)),
           updated_at = now() WHERE id = e.id;
    v_id := gen_random_uuid()::text;
    INSERT INTO batch_consumption (id, batch_id, entry_id, pallet_code, material_id, production_date, batch_lot, ncc_id,
           qty, source, created_by, created_by_name, created_at, updated_at,
           rotation_violation, rotation_principle, rotation_best_date, rotation_override_reason, expiry_approval_id)
    VALUES (v_id, p->>'batch_id', e.id, e.pallet_code, e.material_id, e.production_date::date, e.batch, e.ncc_id,
           v_take, 'LOT', p->>'actor_id', p->>'actor_name', now(), now(),
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
END $$;

REVOKE ALL ON FUNCTION public.mes_vn_today(), public.mes_lot_subject(text, date, text), public.mes_expiry_subject(jsonb, text),
  public.mes_expiry_request(jsonb), public.mes_expiry_decide(jsonb), public.mes_consume_scan(jsonb), public.mes_consume_lot(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_vn_today(), public.mes_lot_subject(text, date, text), public.mes_expiry_subject(jsonb, text),
  public.mes_expiry_request(jsonb), public.mes_expiry_decide(jsonb), public.mes_consume_scan(jsonb), public.mes_consume_lot(jsonb)
  TO service_role;

-- 7. QUYỀN MỚI production.approve_expired ← chức danh đang có quyền QA duyệt phiếu của mẻ (approve_qa); đã có thì không đè
UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(j.module_permissions, '{production}',
         (SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements((j.module_permissions->'production') || '["approve_expired"]'::jsonb) x), true),
       updated_at = now()
 WHERE jsonb_typeof(j.module_permissions->'production') = 'array'
   AND j.module_permissions->'production' ? 'approve_qa'
   AND NOT (j.module_permissions->'production' ? 'approve_expired');

COMMIT;
