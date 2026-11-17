-- MES 17/11 — PHIẾU BỔ SUNG theo mã bán thành phẩm (user: "BTP dịch thạch chính là 1 phiếu bổ sung thêm của các BTP có tính chất
-- liên quan tới thạch, nếu không có thì bỏ đi. Khi tạo mẻ cũng có thể chỉnh … có thể thêm vào bởi trưởng ca, QA trong chức năng sửa").
--   • production_process_form.optional  = phiếu BỔ SUNG: chỉ có ở mẻ được chọn (phiếu thường — MIX — mẻ nào cũng có).
--   • production_process_form.material_ids = mã BTP mặc định có phiếu bổ sung này (mở mẻ mã đó ⇒ tick sẵn).
--   • production_batch.extra_forms = phiếu bổ sung của MẺ (chỉnh lúc mở mẻ · trưởng ca / QA thêm, bớt khi mẻ còn mở).
-- Một hàm cho mọi cửa: mes_batch_form_error (ghi phiếu · bấm giờ) · mes_batch_set_forms (mở mẻ · đổi mã · thêm / bớt) · cổng mẻ.

BEGIN;

ALTER TABLE production_process_form ADD COLUMN IF NOT EXISTS optional boolean NOT NULL DEFAULT false;
ALTER TABLE production_process_form ADD COLUMN IF NOT EXISTS material_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE production_batch ADD COLUMN IF NOT EXISTS extra_forms text[] NOT NULL DEFAULT '{}';

UPDATE production_process_form SET optional = true, updated_at = now() WHERE code = 'JELLY' AND NOT optional;
-- mẻ đã có phiếu bổ sung (đã ghi) ⇒ giữ phiếu đó trên mẻ
UPDATE production_batch b SET extra_forms = s.forms
  FROM (SELECT l.batch_id, array_agg(DISTINCT l.form ORDER BY l.form) forms
          FROM batch_process_log l JOIN production_process_form f ON f.code = l.form AND f.optional GROUP BY l.batch_id) s
 WHERE s.batch_id = b.id AND b.extra_forms = '{}';

-- Phiếu nào ĐƯỢC GHI trên mẻ — null = được; khác = lý do (ghi phiếu, bấm giờ đều gọi)
CREATE OR REPLACE FUNCTION public.mes_batch_form_error(p_batch_id text, p_form text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE b record; f record; v_has boolean;
BEGIN
  SELECT id, status, extra_forms INTO b FROM production_batch WHERE id = p_batch_id;
  IF NOT FOUND THEN RETURN 'NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF b.status = 'CANCELLED' THEN RETURN 'BATCH_CANCELLED|Mẻ đã huỷ — không ghi phiếu được'; END IF;
  SELECT code, short, optional, is_active INTO f FROM production_process_form WHERE code = p_form;
  IF NOT FOUND THEN RETURN 'NOT_FOUND|Không có mẫu phiếu này'; END IF;
  SELECT EXISTS (SELECT 1 FROM batch_process_log WHERE batch_id = b.id AND form = p_form) INTO v_has;
  IF v_has THEN RETURN NULL; END IF;   -- phiếu đã có vẫn sửa được dù mẫu đã ngưng / đã bỏ khỏi mẻ
  IF NOT f.is_active THEN RETURN 'PROCESS_FORM_INACTIVE|Mẫu phiếu này đã ngưng dùng — bật lại ở Cài đặt MES'; END IF;
  IF f.optional AND NOT (p_form = ANY(b.extra_forms)) THEN
    RETURN format('FORM_NOT_ON_BATCH|Mẻ này không có phiếu "%s" — trưởng ca hoặc QA thêm phiếu vào mẻ trước', f.short);
  END IF;
  RETURN NULL;
END $$;

-- Phiếu bổ sung mặc định của một mã BTP
CREATE OR REPLACE FUNCTION public.mes_default_forms(p_material text) RETURNS text[]
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(array_agg(code ORDER BY sort_order, code), '{}') FROM production_process_form
   WHERE optional AND is_active AND p_material = ANY(material_ids)
$$;

-- ĐẶT phiếu bổ sung của mẻ — p: {batch_id, forms?: text[], actor_name}. forms vắng / null ⇒ mặc định theo mã BTP của mẻ.
-- Phiếu đã ghi luôn được giữ (không bỏ được: dữ liệu của lô). Thêm chỉ phiếu bổ sung đang dùng. Chỉ khi mẻ còn mở.
CREATE OR REPLACE FUNCTION public.mes_batch_set_forms(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  b record; v_want text[]; v_logged text[]; v_bad text; v_new text[];
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF b.status <> 'OPEN' THEN RAISE EXCEPTION 'MESERR:BATCH_STATUS|Mẻ không còn mở — không đổi phiếu được'; END IF;
  SELECT COALESCE(array_agg(DISTINCT l.form), '{}') INTO v_logged
    FROM batch_process_log l JOIN production_process_form f ON f.code = l.form AND f.optional WHERE l.batch_id = b.id;
  IF p ? 'forms' AND jsonb_typeof(p->'forms') = 'array' THEN
    SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_want FROM jsonb_array_elements_text(p->'forms') x;
    -- phiếu lạ / không phải phiếu bổ sung / đã ngưng (mà mẻ chưa có)
    SELECT string_agg(x, ', ') INTO v_bad FROM unnest(v_want) x
     WHERE NOT EXISTS (SELECT 1 FROM production_process_form f WHERE f.code = x AND f.optional AND (f.is_active OR x = ANY(b.extra_forms)));
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'MESERR:FORM_INVALID|Không thêm được phiếu: % (không phải phiếu bổ sung đang dùng)', v_bad; END IF;
    -- bỏ phiếu đã ghi ⇒ chặn
    SELECT string_agg(COALESCE(f.short, x), ', ') INTO v_bad FROM unnest(v_logged) x LEFT JOIN production_process_form f ON f.code = x
     WHERE NOT (x = ANY(v_want));
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'MESERR:FORM_HAS_LOG|Phiếu % đã ghi — không bỏ khỏi mẻ được', v_bad; END IF;
  ELSE
    v_want := mes_default_forms(b.material_id) || v_logged;
  END IF;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_new FROM unnest(v_want) x;
  IF v_new IS DISTINCT FROM (SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}') FROM unnest(b.extra_forms) x) THEN
    UPDATE production_batch SET extra_forms = v_new, updated_at = now() WHERE id = b.id;
  END IF;
  RETURN jsonb_build_object('extra_forms', to_jsonb(v_new));
END $$;

-- ─── CỔNG CỦA MẺ: "chưa ghi phiếu" tính theo TỪNG phiếu của mẻ (phiếu thường + phiếu bổ sung của mẻ) ─────────────
CREATE OR REPLACE FUNCTION public.mes_batch_gate(p_batch_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  b record; v_gate boolean; v_short jsonb; v_missing jsonb; v_scanned int; v_need_log boolean;
  v_block text[] := '{}';
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object('form', l.form, 'title', COALESCE(f.short, l.form), 'key', fld->>'key', 'label', fld->>'label')), '[]'::jsonb)
    INTO v_missing
    FROM batch_process_log l
    LEFT JOIN production_process_form f ON f.code = l.form
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.blocks, f.blocks, '[]'::jsonb)) blk
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN blk->>'type' = 'fields' THEN blk->'fields' ELSE '[]'::jsonb END) fld
   WHERE l.batch_id = b.id AND (fld->>'required') = 'true' AND COALESCE(btrim(l.data->>(fld->>'key')), '') = '';
  -- phiếu của mẻ có ô bắt buộc mà chưa mở lần nào
  v_need_log := EXISTS (
    SELECT 1 FROM production_process_form f, jsonb_array_elements(f.blocks) blk, jsonb_array_elements(CASE WHEN blk->>'type' = 'fields' THEN blk->'fields' ELSE '[]'::jsonb END) fld
     WHERE f.is_active AND (NOT f.optional OR f.code = ANY(b.extra_forms)) AND (fld->>'required') = 'true'
       AND NOT EXISTS (SELECT 1 FROM batch_process_log l WHERE l.batch_id = b.id AND l.form = f.code));

  SELECT count(*) INTO v_scanned FROM batch_pour_scan s WHERE s.batch_id = b.id AND s.label_ver = b.label_ver AND s.tank_id = b.tank_id;

  IF b.lead_ok_at IS NULL THEN v_block := v_block || 'Trưởng ca chưa duyệt phiếu'::text; END IF;
  IF b.qa_ok_at IS NULL THEN v_block := v_block || 'QA chưa duyệt phiếu'::text; END IF;
  IF jsonb_array_length(v_short) > 0 THEN
    v_block := v_block || format('%s nguyên liệu cấp chưa đủ (%s)', jsonb_array_length(v_short),
      (SELECT string_agg(x->>'material_code', ', ') FROM (SELECT x FROM jsonb_array_elements(v_short) x LIMIT 5) s));
  END IF;
  IF v_need_log THEN v_block := v_block || 'Chưa ghi phiếu theo dõi'::text; END IF;
  IF jsonb_array_length(v_missing) > 0 THEN
    v_block := v_block || format('Phiếu còn %s ô bắt buộc chưa ghi (%s)', jsonb_array_length(v_missing),
      (SELECT string_agg(x->>'label', ', ') FROM (SELECT x FROM jsonb_array_elements(v_missing) x LIMIT 5) s));
  END IF;
  IF b.label_at IS NULL OR b.label_count IS NULL THEN v_block := v_block || 'Chưa in tem pallet của mẻ'::text;
  ELSIF v_scanned < b.label_count THEN v_block := v_block || format('Mới quét %s/%s tem pallet tại bồn', v_scanned, b.label_count); END IF;

  RETURN jsonb_build_object(
    'flow_gate', v_gate, 'lead_ok', b.lead_ok_at IS NOT NULL, 'qa_ok', b.qa_ok_at IS NOT NULL,
    'can_consume', (NOT v_gate) OR (b.lead_ok_at IS NOT NULL AND b.qa_ok_at IS NOT NULL),
    'label_count', b.label_count, 'label_valid', b.label_at IS NOT NULL, 'label_ver', b.label_ver, 'scanned', v_scanned,
    'short', v_short, 'missing', v_missing, 'need_log', v_need_log,
    'fill_blockers', CASE WHEN v_gate THEN to_jsonb(v_block) ELSE '[]'::jsonb END);
END $$;

-- ─── PHIẾU: bấm ghi giờ — thêm luật "phiếu có trên mẻ" (mes_batch_form_error) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_log_stamp(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  b record; l record; f record; v_key text := p->>'key'; v_form text := p->>'form'; v_blocks jsonb; v_ok boolean; v_err text;
  v_hhmm text := to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI');
  v_stamp jsonb := jsonb_build_object('by', p->>'actor_name', 'at', now());
BEGIN
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  v_err := mes_batch_form_error(b.id, v_form);
  IF v_err IS NOT NULL THEN RAISE EXCEPTION 'MESERR:%', v_err; END IF;
  SELECT * INTO f FROM production_process_form WHERE code = v_form;
  SELECT * INTO l FROM batch_process_log WHERE batch_id = b.id AND form = v_form FOR UPDATE;
  IF l.confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'MESERR:PROCESS_LOG_CONFIRMED|Phiếu đã được QA xác nhận — bỏ xác nhận rồi mới ghi được'; END IF;
  v_blocks := COALESCE(l.blocks, f.blocks);
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_blocks) blk, jsonb_array_elements(CASE WHEN blk->>'type' = 'fields' THEN blk->'fields' ELSE '[]'::jsonb END) fld
                  WHERE fld->>'key' = v_key AND fld->>'kind' = 'time') INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'MESERR:KIND|Ô này không phải mốc giờ của phiếu'; END IF;
  IF l.id IS NULL THEN
    INSERT INTO batch_process_log (id, batch_id, form, data, stamps, created_by_name, updated_by_name, created_at, updated_at)
    VALUES (gen_random_uuid()::text, b.id, v_form, jsonb_build_object(v_key, v_hhmm), jsonb_build_object(v_key, v_stamp), p->>'actor_name', p->>'actor_name', now(), now());
  ELSE
    IF COALESCE(btrim(l.data->>v_key), '') <> '' THEN
      RAISE EXCEPTION 'MESERR:ALREADY|Mốc này đã ghi lúc % — muốn sửa giờ thì mở phiếu', l.data->>v_key;
    END IF;
    UPDATE batch_process_log SET data = data || jsonb_build_object(v_key, v_hhmm), stamps = stamps || jsonb_build_object(v_key, v_stamp),
           updated_by_name = p->>'actor_name', updated_at = now() WHERE id = l.id;
  END IF;
  RETURN jsonb_build_object('key', v_key, 'value', v_hhmm);
END $$;

COMMIT;
