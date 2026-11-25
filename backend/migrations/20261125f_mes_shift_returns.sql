-- Rà soát MES 25/11 (docs/plans/MES_REVIEW_2026-11-25.md) — ĐỢT 7: SỔ CA.
--   N4  Huỷ cấp NVL thuộc ca ĐÃ CHỐT ⇒ tồn tăng lại nhưng sổ ca đang mở lệch đúng bằng lượng hoàn, không cột nào giải thích.
--       User chốt 25/11: ghi thành cột "Hoàn từ ca trước" của ca đang mở (sổ cân: đầu + nhập − dùng + hoàn = sổ), KÈM công tắc chặn khi
--       cần ("vì khi đó khả năng cao NVL đã mất rồi") — Warehouse.mes_block_reverse_closed (Cài đặt MES, mặc định TẮT = như cũ).
--       Báo cáo ca ĐÃ CHỐT không đổi nữa khi lần cấp của nó bị huỷ về sau: "dùng theo mẻ" đếm lần cấp chưa huỷ TẠI LÚC CHỐT.
--   B15 Chốt ca lúc xưởng đang quét: lần cấp có created_at = now() (lúc giao dịch BẮT ĐẦU) mà commit sau thời điểm chụp ⇒ không vào ca
--       nào. Nay: mọi cửa cấp / huỷ cấp lấy khoá CHIA SẺ theo kho (trong mes_open_batch_wh), chốt ca lấy khoá ĐỘC QUYỀN trước khi chụp;
--       thời điểm cấp / huỷ = clock_timestamp() lúc ghi ⇒ lần ghi chờ khoá sau khi chốt rơi vào ca sau, lần ghi trước khi chốt được chụp.
BEGIN;

ALTER TABLE public."Warehouse" ADD COLUMN IF NOT EXISTS mes_block_reverse_closed boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public."Warehouse".mes_block_reverse_closed IS
  'MES 25/11: chặn huỷ cấp NVL của lần cấp thuộc ca đã chốt (NVL thường đã dùng / mất — xử lý chênh bằng kiểm kê). Cửa ghi: Cài đặt MES.';
ALTER TABLE public.production_shift_count ADD COLUMN IF NOT EXISTS qty_returned numeric;

CREATE OR REPLACE FUNCTION public.mes_open_batch_wh(p_batch_id text) RETURNS text
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_wh text; v_status text; v_code text;
BEGIN
  SELECT warehouse_id, status, batch_code INTO v_wh, v_status, v_code FROM production_batch WHERE id = p_batch_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF v_status <> 'OPEN' THEN RAISE EXCEPTION 'MESERR:BATCH_NOT_OPEN|Mẻ % đã huỷ — không cấp / huỷ cấp nguyên liệu được', v_code; END IF;
  IF EXISTS (SELECT 1 FROM tank_movement WHERE batch_id = p_batch_id AND kind = 'FILL') THEN
    RAISE EXCEPTION 'MESERR:BATCH_FILLED|Mẻ % đã nạp BTP vào bồn — sổ nguyên liệu của mẻ đã khoá (không cấp thêm, không huỷ dòng cấp)', v_code;
  END IF;
  -- 25/11 (B15): khoá CHIA SẺ theo kho — chốt ca (mes_shift_save) lấy khoá ĐỘC QUYỀN cùng khoá ⇒ không lần cấp nào lọt giữa hai ca
  PERFORM pg_advisory_xact_lock_shared(hashtext('mes_shift:' || v_wh));
  RETURN v_wh;
END $$;

CREATE OR REPLACE FUNCTION public.mes_consume_reverse(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  c     record;
  e     record;
  v_new numeric;
  v_wh  text;
  v_shift record;
BEGIN
  IF length(btrim(coalesce(p->>'reason', ''))) = 0 THEN RAISE EXCEPTION 'MESERR:REASON|Nhập lý do huỷ'; END IF;
  SELECT * INTO c FROM batch_consumption WHERE id = p->>'consumption_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy dòng rút'; END IF;
  IF c.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'MESERR:ALREADY_REVERSED|Dòng rút này đã huỷ rồi'; END IF;
  v_wh := mes_open_batch_wh(c.batch_id);
  -- 25/11 (N4, user chốt): kho bật "chặn huỷ cấp của ca đã chốt" ⇒ lần cấp nằm trong một ca đã chốt không huỷ được nữa
  IF (SELECT mes_block_reverse_closed FROM "Warehouse" WHERE id = v_wh) THEN
    SELECT s.report_date, s.shift INTO v_shift FROM production_shift_report s
     WHERE s.warehouse_id = v_wh AND s.status = 'CLOSED' AND s.from_at <= c.created_at AND s.to_at > c.created_at
     ORDER BY s.to_at DESC LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'MESERR:SHIFT_CLOSED|Lần cấp này thuộc ca % ngày % đã chốt — kho đặt chặn huỷ cấp của ca đã chốt (NVL thường đã dùng / mất). Chênh lệch xử lý bằng kiểm kê / điều chỉnh tồn',
        v_shift.shift, to_char(v_shift.report_date, 'DD-MM-YYYY');
    END IF;
  END IF;
  SELECT * INTO e FROM "InventoryEntry" WHERE id = c.entry_id FOR UPDATE;
  v_new := COALESCE(e.cartons_remaining, 0) + c.qty;
  UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = inventory_entry_status(e.status, v_new, COALESCE(e.cartons_imported, 0), e.cartons_reserved),
         updated_at = now() WHERE id = e.id;
  UPDATE batch_consumption SET reversed_at = clock_timestamp(), reversed_by = p->>'actor_id', reversed_by_name = p->>'actor_name',
         reverse_reason = left(btrim(p->>'reason'), 500), updated_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('id', c.id, 'entry_id', e.id, 'remaining', v_new);
END $$;

-- ── mes_shift_calc: thêm cột returned (đổi kiểu trả về ⇒ bỏ rồi tạo lại) ──
DROP FUNCTION IF EXISTS public.mes_shift_calc(text);
CREATE FUNCTION public.mes_shift_calc(p_report_id text)
RETURNS TABLE(material_id text, opening numeric, opening_src text, received numeric, used numeric, book numeric, returned numeric)
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  r          record;
  v_prev     text;
  v_prev_cum jsonb;
BEGIN
  SELECT * INTO r FROM production_shift_report WHERE id = p_report_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT x.id, x.cum_in INTO v_prev, v_prev_cum FROM production_shift_report x
   WHERE x.warehouse_id = r.warehouse_id AND x.status = 'CLOSED' AND x.to_at <= r.from_at ORDER BY x.to_at DESC LIMIT 1;
  RETURN QUERY
  WITH stock AS (
    SELECT e.material_id AS mid, sum(COALESCE(e.cartons_remaining, e.cartons_imported, 0)) AS q
      FROM "InventoryEntry" e WHERE e.warehouse_id = r.warehouse_id AND e.status IN ('IN_STOCK', 'PARTIAL') GROUP BY 1
  ), used AS (
    SELECT c.material_id AS mid, sum(c.qty) AS q
      FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
     WHERE b.warehouse_id = r.warehouse_id AND c.reversed_at IS NULL AND c.created_at >= r.from_at GROUP BY 1
  ), ret AS (
    -- 25/11 (N4): lần cấp của ca TRƯỚC bị huỷ trong ca này ⇒ hàng về lại tồn ⇒ "Hoàn từ ca trước" (sổ cân: đầu + nhập − dùng + hoàn = sổ)
    SELECT c.material_id AS mid, sum(c.qty) AS q
      FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
     WHERE b.warehouse_id = r.warehouse_id AND c.created_at < r.from_at AND c.reversed_at >= r.from_at GROUP BY 1
  ), recv AS (
    -- có bộ đếm của ca trước ⇒ chênh bộ đếm (bắt cả nhận gộp vào dòng cũ)
    SELECT k.material_id AS mid, k.qty - COALESCE((v_prev_cum->>k.material_id)::numeric, 0) AS q
      FROM mes_wh_cum_in(r.warehouse_id) k WHERE v_prev_cum IS NOT NULL
    UNION ALL   -- mã có trong bộ đếm cũ mà nay không còn dòng nào (dòng nhập bị xoá hết)
    SELECT j.key, -(j.value)::numeric FROM jsonb_each_text(COALESCE(v_prev_cum, '{}'::jsonb)) j
     WHERE v_prev_cum IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mes_wh_cum_in(r.warehouse_id) k WHERE k.material_id = j.key)
    UNION ALL   -- ca đầu tiên của kho: dòng tạo mới trong ca
    SELECT e.material_id, sum(COALESCE(e.cartons_imported, 0))
      FROM "InventoryEntry" e
     WHERE v_prev_cum IS NULL AND e.warehouse_id = r.warehouse_id AND e.created_at >= r.from_at AND COALESCE(e.origin, 'IMPORT') <> 'SPLIT'
     GROUP BY 1
  ), prev AS (
    SELECT l.material_id AS mid, l.qty_actual AS cnt, l.qty_book AS bk FROM production_shift_count l WHERE l.report_id = v_prev
  ), keys AS (
    SELECT s.mid FROM stock s WHERE s.q > 0 UNION SELECT u.mid FROM used u UNION SELECT rc.mid FROM recv rc WHERE rc.q <> 0
    UNION SELECT rt.mid FROM ret rt
    UNION SELECT p.mid FROM prev p WHERE p.cnt > 0 OR p.bk > 0 UNION SELECT l.material_id FROM production_shift_count l WHERE l.report_id = r.id
  )
  SELECT k.mid,
         CASE WHEN p.cnt IS NOT NULL THEN p.cnt
              WHEN v_prev IS NOT NULL THEN COALESCE(p.bk, 0)                                    -- tồn sổ đúng lúc chốt ca trước
              ELSE COALESCE(s.q, 0) + COALESCE(u.q, 0) - COALESCE(rc.q, 0) - COALESCE(rt.q, 0) END,   -- ca đầu tiên: dựng ngược
         CASE WHEN p.cnt IS NOT NULL THEN 'COUNT' ELSE 'BOOK' END,
         COALESCE(rc.q, 0), COALESCE(u.q, 0), COALESCE(s.q, 0), COALESCE(rt.q, 0)
    FROM keys k
    LEFT JOIN stock s ON s.mid = k.mid LEFT JOIN used u ON u.mid = k.mid
    LEFT JOIN recv rc ON rc.mid = k.mid LEFT JOIN prev p ON p.mid = k.mid LEFT JOIN ret rt ON rt.mid = k.mid;
END $$;
REVOKE ALL ON FUNCTION public.mes_shift_calc(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_shift_calc(text) TO service_role;

CREATE OR REPLACE FUNCTION public.mes_shift_save(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  r    record;
  l    jsonb;
BEGIN
  SELECT * INTO r FROM production_shift_report WHERE id = p->>'report_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy báo cáo ca'; END IF;
  IF r.status <> 'OPEN' THEN RAISE EXCEPTION 'MESERR:SHIFT_CLOSED|Ca này đã chốt — không sửa được số đếm'; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) LOOP
    IF NOT EXISTS (SELECT 1 FROM "Material" WHERE id = l->>'material_id') THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Có nguyên liệu không còn trong danh mục'; END IF;
    INSERT INTO production_shift_count (id, report_id, material_id, qty_actual, updated_at)
    VALUES (gen_random_uuid()::text, r.id, l->>'material_id', nullif(l->>'qty_actual', '')::numeric, now())
    ON CONFLICT (report_id, material_id) DO UPDATE SET qty_actual = EXCLUDED.qty_actual, updated_at = now();
  END LOOP;
  IF p ? 'note' THEN UPDATE production_shift_report SET note = nullif(btrim(coalesce(p->>'note', '')), ''), updated_at = now() WHERE id = r.id; END IF;
  IF NOT coalesce((p->>'close')::boolean, false) THEN
    UPDATE production_shift_report SET updated_at = now() WHERE id = r.id;
    RETURN jsonb_build_object('status', 'OPEN');
  END IF;
  -- 25/11 (B15): chờ mọi lượt cấp / huỷ cấp đang chạy của kho xong rồi mới chụp (khoá ĐỘC QUYỀN ↔ khoá chia sẻ trong mes_open_batch_wh)
  PERFORM pg_advisory_xact_lock(hashtext('mes_shift:' || r.warehouse_id));
  -- CHỐT: chụp mọi con số; nguyên liệu chưa nhập số đếm vẫn có dòng (qty_actual null = không đếm)
  INSERT INTO production_shift_count (id, report_id, material_id, qty_opening, opening_src, qty_received, qty_used, qty_book, qty_returned, updated_at)
  SELECT gen_random_uuid()::text, r.id, c.material_id, c.opening, c.opening_src, c.received, c.used, c.book, c.returned, now()
    FROM mes_shift_calc(r.id) c
  ON CONFLICT (report_id, material_id) DO UPDATE SET qty_opening = EXCLUDED.qty_opening, opening_src = EXCLUDED.opening_src,
         qty_received = EXCLUDED.qty_received, qty_used = EXCLUDED.qty_used, qty_book = EXCLUDED.qty_book, qty_returned = EXCLUDED.qty_returned,
         updated_at = now();
  UPDATE production_shift_report SET status = 'CLOSED', to_at = clock_timestamp(), closed_by = p->>'actor_id', closed_by_name = p->>'actor_name',
         cum_in = (SELECT COALESCE(jsonb_object_agg(k.material_id, k.qty), '{}'::jsonb) FROM mes_wh_cum_in(r.warehouse_id) k),
         updated_at = now()
   WHERE id = r.id;
  RETURN jsonb_build_object('status', 'CLOSED');
END $$;

CREATE OR REPLACE FUNCTION public.mes_shift_report(p_report_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  r        record;
  v_rows   jsonb;
  v_batch  jsonb;
BEGIN
  SELECT * INTO r FROM production_shift_report WHERE id = p_report_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- lần cấp "sống" của ca: chưa huỷ — với ca ĐÃ CHỐT là chưa huỷ TẠI LÚC CHỐT (25/11: huỷ về sau không làm báo cáo đã chốt đổi số)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'batch_code', b.batch_code, 'cycle', b.cycle, 'shift', b.shift, 'machine_code', b.machine_code,
           'material_code', m.material_code, 'material_name', m.short_name) ORDER BY b.created_at, b.batch_code), '[]'::jsonb) INTO v_batch
    FROM production_batch b JOIN "Material" m ON m.id = b.material_id
   WHERE b.warehouse_id = r.warehouse_id
     AND EXISTS (SELECT 1 FROM batch_consumption c WHERE c.batch_id = b.id
                   AND (c.reversed_at IS NULL OR (r.to_at IS NOT NULL AND c.reversed_at >= r.to_at))
                   AND c.created_at >= r.from_at AND (r.to_at IS NULL OR c.created_at < r.to_at));
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'material_code'), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object('material_id', m.id, 'material_code', m.material_code, 'material_name', m.short_name,
             'base_unit', m.base_unit, 'entry_unit', m.entry_unit, 'units_per_carton', m.units_per_carton,
             'opening', d.opening, 'opening_src', d.opening_src, 'received', d.received, 'used', d.used, 'book', d.book, 'actual', d.actual,
             'returned', d.returned,
             'by_batch', COALESCE((SELECT jsonb_object_agg(q.batch_id, q.qty) FROM (
                 SELECT c.batch_id, sum(c.qty) AS qty FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
                  WHERE b.warehouse_id = r.warehouse_id AND c.material_id = m.id
                    AND (c.reversed_at IS NULL OR (r.to_at IS NOT NULL AND c.reversed_at >= r.to_at))
                    AND c.created_at >= r.from_at AND (r.to_at IS NULL OR c.created_at < r.to_at) GROUP BY c.batch_id) q), '{}'::jsonb)) AS x
      FROM (
        SELECT l.material_id, l.qty_opening AS opening, l.opening_src, l.qty_received AS received, l.qty_used AS used, l.qty_book AS book,
               l.qty_actual AS actual, COALESCE(l.qty_returned, 0) AS returned
          FROM production_shift_count l WHERE r.status = 'CLOSED' AND l.report_id = r.id
        UNION ALL
        SELECT c.material_id, c.opening, c.opening_src, c.received, c.used, c.book,
               (SELECT l.qty_actual FROM production_shift_count l WHERE l.report_id = r.id AND l.material_id = c.material_id), c.returned
          FROM mes_shift_calc(r.id) c WHERE r.status = 'OPEN'
      ) d JOIN "Material" m ON m.id = d.material_id
  ) s;
  RETURN jsonb_build_object('report', to_jsonb(r) - 'cum_in', 'batches', v_batch, 'rows', v_rows);
END $$;

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

-- Lưới tự kiểm (dữ liệu giả, rollback): cấp ở ca đã chốt → công tắc bật ⇒ huỷ bị SHIFT_CLOSED; tắt ⇒ huỷ được và ca đang mở có "Hoàn" đúng lượng
DO $$
DECLARE v_wh text; m1 text; v_u text; rm text; b1 jsonb; v_err text; v_c text; v_ret numeric; v_used numeric;
BEGIN
  SELECT w.id INTO v_wh FROM "Warehouse" w WHERE w.parent_warehouse_id IS NOT NULL AND coalesce(mes_plant_letter(w.id), '') <> '' ORDER BY w.id LIMIT 1;
  SELECT id, upper(coalesce(base_unit, '')) INTO m1, v_u FROM "Material" WHERE is_semi_finished AND upper(coalesce(base_unit, '')) IN ('L', 'KG') ORDER BY id LIMIT 1;
  SELECT id INTO rm FROM "Material" WHERE NOT coalesce(is_semi_finished, false) AND entry_unit IS NULL ORDER BY id LIMIT 1;
  IF v_wh IS NULL OR m1 IS NULL OR rm IS NULL THEN RAISE NOTICE 'tự kiểm sổ ca: thiếu kho phụ / mã — bỏ qua'; RETURN; END IF;
  BEGIN
    UPDATE production_shift_report SET status = 'CLOSED', to_at = coalesce(to_at, now() - interval '2 hours') WHERE warehouse_id = v_wh AND status = 'OPEN';
    UPDATE "Warehouse" SET mes_flow_gate = false, mes_block_reverse_closed = false WHERE id = v_wh;
    INSERT INTO production_tank (id, warehouse_id, code, capacity, unit, updated_at) VALUES ('QAW7_T', v_wh, 'QAW7T', 1000, v_u, now());
    b1 := mes_batch_create(jsonb_build_object('warehouse_id', v_wh, 'material_id', m1, 'prod_date', current_date, 'cycle', 'QW7', 'tank_id', 'QAW7_T', 'shift', 'Ca 1'));
    INSERT INTO "InventoryEntry" (id, pallet_code, material_id, warehouse_id, cartons_imported, cartons_remaining, cartons_reserved, status, updated_at)
    VALUES ('QAW7_E', 'QAW7TEM', rm, v_wh, 50, 50, 0, 'IN_STOCK', now());
    PERFORM mes_consume_scan(jsonb_build_object('batch_id', b1->>'id', 'entry_id', 'QAW7_E', 'qty', 5));
    SELECT id INTO v_c FROM batch_consumption WHERE batch_id = b1->>'id';
    -- ca 1 chốt (bao lần cấp), ca 2 mở
    INSERT INTO production_shift_report (id, warehouse_id, report_date, shift, from_at, to_at, status, updated_at)
    VALUES ('QAW7_S1', v_wh, current_date, 'QA Ca 1', clock_timestamp() - interval '1 hour', clock_timestamp(), 'CLOSED', now());
    INSERT INTO production_shift_report (id, warehouse_id, report_date, shift, from_at, status, updated_at)
    VALUES ('QAW7_S2', v_wh, current_date, 'QA Ca 2', (SELECT to_at FROM production_shift_report WHERE id = 'QAW7_S1'), 'OPEN', now());
    UPDATE "Warehouse" SET mes_block_reverse_closed = true WHERE id = v_wh;
    v_err := NULL;
    BEGIN PERFORM mes_consume_reverse(jsonb_build_object('consumption_id', v_c, 'reason', 'tự kiểm'));
    EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR v_err NOT LIKE 'MESERR:SHIFT_CLOSED%' THEN RAISE EXCEPTION 'N4: công tắc bật mà huỷ cấp của ca đã chốt không bị chặn, nhận %', coalesce(v_err, 'không lỗi'); END IF;
    UPDATE "Warehouse" SET mes_block_reverse_closed = false WHERE id = v_wh;
    PERFORM mes_consume_reverse(jsonb_build_object('consumption_id', v_c, 'reason', 'tự kiểm'));
    SELECT returned, used INTO v_ret, v_used FROM mes_shift_calc('QAW7_S2') WHERE material_id = rm;
    IF v_ret IS DISTINCT FROM 5 OR v_used IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'N4: ca đang mở phải có Hoàn 5 / Dùng 0, nhận % / %', v_ret, v_used; END IF;
    RAISE EXCEPTION 'SELFTEST_OK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'SELFTEST_OK' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'tự kiểm sổ ca (N4 hoàn từ ca trước + công tắc chặn): OK';
END $$;

COMMIT;
