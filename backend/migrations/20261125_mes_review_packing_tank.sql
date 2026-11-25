-- Rà soát MES 25/11 (docs/plans/MES_REVIEW_2026-11-25.md) — ĐỢT 1: Sổ đóng gói ↔ sổ bồn.
--   X3  Hủy trang sổ đã ĐÓNG mà đã rút bồn ⇒ lượng rút không được trả, bồn hụt vĩnh viễn, gia phả còn nối trang đã hủy.
--       User chốt 25/11: cho hủy khi 0 pallet VÀ lượng rút bồn thuần = 0; còn rút thì bắt sửa lượng rút về 0 trước.
--       Một hàm packing_run_cancel khoá trang (FOR UPDATE, cùng khoá với mes_run_redraw) rồi mới đếm pallet + lượng rút
--       ⇒ không đua với sửa lượng rút. Controller cancelRun gọi hàm này (trước đây đếm rời rồi update).
--   X4  mes_run_redraw: nhánh RÚT THÊM không chặn trộn mã khi bồn nay đã chứa BTP khác (chỉ nhánh trả về có chặn) — lệch luật
--       production.md ("Chặn: … bồn nay đã chứa mã khác"). Đưa khối kiểm lên TRƯỚC chỗ rẽ nhánh, áp cả hai chiều.
--   Gia phả: mes_genealogy bỏ trang sổ đã hủy (lớp chặn phụ sau X3; staging 0 trang hủy còn lượng rút).
BEGIN;

CREATE OR REPLACE FUNCTION public.packing_run_cancel(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  r      record;
  v_pal  int;
  v_draw numeric;
  v_unit text;
  v_note text := left(btrim(coalesce(p->>'note', '')), 500);
BEGIN
  SELECT * INTO r FROM packing_runs WHERE id = (p->>'run_id')::uuid FOR UPDATE;
  IF NOT FOUND OR r.status = 'CANCELLED' THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy trang sổ (hoặc đã hủy)'; END IF;
  SELECT count(*) INTO v_pal FROM packing_logs WHERE run_id = r.id AND status <> 'CANCELLED';
  IF v_pal > 0 THEN
    RAISE EXCEPTION 'MESERR:RUN_HAS_PALLETS|Trang sổ đã có % pallet ghi vào — hủy từng pallet trước, hoặc bấm Giờ kết thúc để đóng trang', v_pal;
  END IF;
  SELECT COALESCE(-sum(qty), 0) INTO v_draw FROM tank_movement WHERE packing_run_id = r.id AND kind = 'DRAW';
  IF v_draw <> 0 THEN
    SELECT unit INTO v_unit FROM production_tank WHERE id = r.tank_id;
    RAISE EXCEPTION 'MESERR:RUN_HAS_TANK_DRAW|Trang sổ đã rút % % từ bồn — sửa lượng rút về 0 trước (nút Sửa lượng rút), rồi mới hủy trang',
      trim(to_char(v_draw, 'FM999999990.###')), coalesce(v_unit, '');
  END IF;
  UPDATE packing_runs SET status = 'CANCELLED', note = CASE WHEN v_note <> '' THEN v_note ELSE note END, updated_at = now() WHERE id = r.id;
  RETURN jsonb_build_object('id', r.id);
END $$;
REVOKE ALL ON FUNCTION public.packing_run_cancel(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.packing_run_cancel(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.mes_run_redraw(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  r        record;
  t        record;
  d        record;
  v_new    numeric := (p->>'tank_qty')::numeric;
  v_reason text := left(btrim(coalesce(p->>'reason', '')), 500);
  v_cur    numeric;
  v_delta  numeric;
  v_ret    numeric;
  v_n      integer;
  v_i      integer := 0;
  v_given  numeric := 0;
  v_share  numeric;
  v_lot    text;
  v_content numeric;
  v_mat    text;
  v_other  text;
  v_take   jsonb := NULL;
BEGIN
  IF v_reason = '' THEN RAISE EXCEPTION 'MESERR:REASON|Nhập lý do sửa lượng rút'; END IF;
  IF v_new IS NULL OR v_new < 0 THEN RAISE EXCEPTION 'MESERR:QTY|Lượng rút phải là số không âm'; END IF;
  SELECT * INTO r FROM packing_runs WHERE id = (p->>'run_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy trang sổ'; END IF;
  IF r.status <> 'CLOSED' THEN RAISE EXCEPTION 'MESERR:RUN_NOT_CLOSED|Chỉ sửa lượng rút của trang sổ ĐÃ ĐÓNG — trang đang mở thì khai khi bấm Giờ kết thúc'; END IF;
  IF r.tank_id IS NULL THEN RAISE EXCEPTION 'MESERR:NO_TANK|Trang sổ chưa gắn bồn — gắn bồn (Sửa trang sổ) rồi mới khai lượng rút'; END IF;
  SELECT * INTO t FROM production_tank WHERE id = r.tank_id FOR UPDATE;
  PERFORM 1 FROM tank_lot WHERE tank_id = t.id FOR UPDATE;
  SELECT COALESCE(-sum(qty), 0) INTO v_cur FROM tank_movement WHERE packing_run_id = r.id AND kind = 'DRAW';
  v_delta := v_new - v_cur;
  IF v_delta = 0 THEN RETURN jsonb_build_object('drawn', v_cur, 'delta', 0, 'warnings', '[]'::jsonb); END IF;

  -- 25/11 (X4): trang đã rút mã X mà bồn nay đang chứa mã khác ⇒ chặn CẢ rút thêm lẫn trả về (trước chỉ chặn trả về)
  IF v_cur > 0 THEN
    SELECT ob.material_id INTO v_mat FROM tank_movement mv JOIN production_batch ob ON ob.id = mv.batch_id
     WHERE mv.packing_run_id = r.id AND mv.kind = 'DRAW' LIMIT 1;
    SELECT m.material_code INTO v_other FROM tank_lot l JOIN production_batch ob ON ob.id = l.batch_id JOIN "Material" m ON m.id = ob.material_id
     WHERE l.tank_id = t.id AND l.status = 'ACTIVE' AND l.qty_remaining > 0 AND ob.material_id <> v_mat LIMIT 1;
    IF v_other IS NOT NULL THEN
      RAISE EXCEPTION 'MESERR:MIX_MATERIAL|Bồn % nay đang chứa mã % — không sửa lượng rút của trang này được (trang đã rút mã khác)', t.code, v_other;
    END IF;
  END IF;

  IF v_delta > 0 THEN
    v_take := mes_tank_take(jsonb_build_object('tank_id', t.id, 'qty', v_delta, 'kind', 'DRAW', 'packing_run_id', r.id,
                'qa_gate', p->>'qa_gate', 'reason', v_reason, 'actor_id', p->>'actor_id', 'actor_name', p->>'actor_name'));
    UPDATE packing_runs SET updated_at = now() WHERE id = r.id;
    RETURN jsonb_build_object('drawn', v_new, 'delta', v_delta, 'warnings', coalesce(v_take->'warnings', '[]'::jsonb));
  END IF;

  -- GIẢM: trả phần chênh về bồn
  v_ret := -v_delta;
  SELECT COALESCE(sum(qty_remaining), 0) INTO v_content FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE';
  IF v_content + v_ret > t.capacity THEN
    RAISE EXCEPTION 'MESERR:OVER_CAPACITY|Bồn % chỉ còn chỗ cho % % — không trả lại được % %', t.code, t.capacity - v_content, t.unit, v_ret, t.unit;
  END IF;
  SELECT count(*) INTO v_n FROM (SELECT batch_id FROM tank_movement WHERE packing_run_id = r.id AND kind = 'DRAW'
                                  GROUP BY batch_id HAVING sum(qty) < 0) x;
  FOR d IN SELECT batch_id, -sum(qty) AS net FROM tank_movement WHERE packing_run_id = r.id AND kind = 'DRAW'
            GROUP BY batch_id HAVING sum(qty) < 0 ORDER BY -sum(qty), batch_id LOOP
    v_i := v_i + 1;
    -- mẻ rút nhiều nhất nhận phần dư làm tròn; không mẻ nào bị trả quá lượng trang đã rút của nó
    v_share := CASE WHEN v_i = v_n THEN v_ret - v_given ELSE round(v_ret * d.net / v_cur, 3) END;
    v_share := LEAST(v_share, d.net);
    CONTINUE WHEN v_share <= 0;
    v_given := v_given + v_share;
    SELECT id INTO v_lot FROM tank_lot WHERE tank_id = t.id AND batch_id = d.batch_id AND status = 'ACTIVE';
    IF v_lot IS NULL THEN   -- lô đã cạn ⇒ mở lại đúng lô gần nhất của mẻ trong bồn (giữ lúc nạp + hạn lưu gốc)
      SELECT id INTO v_lot FROM tank_lot WHERE tank_id = t.id AND batch_id = d.batch_id ORDER BY filled_at DESC, id LIMIT 1;
      IF v_lot IS NULL THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy lô của mẻ trong bồn %', t.code; END IF;
      UPDATE tank_lot SET status = 'ACTIVE', emptied_at = NULL, qty_remaining = qty_remaining + v_share, updated_at = now() WHERE id = v_lot;
    ELSE
      UPDATE tank_lot SET qty_remaining = qty_remaining + v_share, updated_at = now() WHERE id = v_lot;
    END IF;
    INSERT INTO tank_movement (id, tank_id, tank_lot_id, batch_id, kind, qty, packing_run_id, reason, created_by, created_by_name, created_at, updated_at)
    VALUES (gen_random_uuid()::text, t.id, v_lot, d.batch_id, 'DRAW', v_share, r.id, v_reason, p->>'actor_id', p->>'actor_name', now(), now());
  END LOOP;
  IF abs(v_given - v_ret) > 0.0005 THEN
    RAISE EXCEPTION 'MESERR:QTY|Lượng % không chia được cho các mẻ của trang — nhập tối đa 3 số lẻ', v_new;
  END IF;
  UPDATE production_tank SET updated_at = now() WHERE id = t.id;
  UPDATE packing_runs SET updated_at = now() WHERE id = r.id;
  RETURN jsonb_build_object('drawn', v_new, 'delta', v_delta, 'warnings', '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.mes_run_redraw(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_run_redraw(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.mes_genealogy(p_kind text, p_value text, p_wh_ids text[] DEFAULT NULL::text[], p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  v_val  text := btrim(coalesce(p_value, ''));
  v_lim  int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_ids  text[];
  v_out  jsonb;
BEGIN
  IF v_val = '' THEN RETURN jsonb_build_object('batches', '[]'::jsonb); END IF;
  IF p_kind = 'BATCH' THEN
    SELECT array_agg(id) INTO v_ids FROM production_batch WHERE upper(batch_code) = upper(v_val);
  ELSIF p_kind = 'RM_PALLET' THEN
    SELECT array_agg(DISTINCT batch_id) INTO v_ids FROM batch_consumption WHERE pallet_code = v_val AND reversed_at IS NULL;
  ELSIF p_kind = 'FG_PALLET' THEN
    -- lượng rút THUẦN của (trang, mẻ) > 0 mới nối — sửa lượng rút về 0 thì mẻ đó rời khỏi gia phả của trang
    SELECT array_agg(DISTINCT d.batch_id) INTO v_ids
      FROM (SELECT mv.batch_id FROM packing_logs pl JOIN tank_movement mv ON mv.packing_run_id = pl.run_id AND mv.kind = 'DRAW'
             WHERE pl.pallet_code = v_val AND pl.status <> 'CANCELLED'
             GROUP BY mv.packing_run_id, mv.batch_id HAVING sum(mv.qty) < 0) d;
  ELSE
    RAISE EXCEPTION 'MESERR:KIND|Cách tra không hợp lệ';
  END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'prod_date' DESC, x->>'batch_code'), '[]'::jsonb) INTO v_out FROM (
    SELECT jsonb_build_object(
      'id', b.id, 'batch_code', b.batch_code, 'warehouse_id', b.warehouse_id, 'warehouse_name', w.name,
      'prod_date', b.prod_date, 'machine_code', b.machine_code, 'shift', b.shift, 'status', b.status, 'qa_status', b.qa_status,
      'material_code', m.material_code, 'material_name', m.short_name, 'base_unit', m.base_unit,
      'materials', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'pallet_code', c.pallet_code, 'material_code', cm.material_code, 'material_name', cm.short_name,
                 'base_unit', cm.base_unit, 'production_date', c.production_date, 'batch_lot', c.batch_lot,
                 'ncc_name', n.name, 'qty', c.qty, 'source', c.source, 'at', c.created_at)
               ORDER BY cm.material_code, c.created_at), '[]'::jsonb)
          FROM batch_consumption c
          JOIN "Material" cm ON cm.id = c.material_id
          LEFT JOIN "TransportCompany" n ON n.id = c.ncc_id   -- NCC dùng chung bảng ĐVVT / NCC
         WHERE c.batch_id = b.id AND c.reversed_at IS NULL),
      'runs', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'run_id', r.id, 'run_date', r.run_date, 'machine_code', r.machine_code, 'material_codes', r.material_codes,
                 'warehouse_id', r.warehouse_id, 'tank_code', tk.code, 'qty', d.qty,
                 'pallets', (SELECT COALESCE(jsonb_agg(pl.pallet_code ORDER BY pl.open_scan_at), '[]'::jsonb)
                               FROM packing_logs pl WHERE pl.run_id = r.id AND pl.status <> 'CANCELLED'))
               ORDER BY r.run_date, r.start_at), '[]'::jsonb)
          FROM (SELECT mv.packing_run_id, mv.tank_id, -sum(mv.qty) AS qty FROM tank_movement mv
                 WHERE mv.batch_id = b.id AND mv.kind = 'DRAW' AND mv.packing_run_id IS NOT NULL
                 GROUP BY mv.packing_run_id, mv.tank_id HAVING sum(mv.qty) < 0) d
          JOIN packing_runs r ON r.id = d.packing_run_id AND r.status <> 'CANCELLED'   -- 25/11: trang đã hủy không thuộc gia phả
          LEFT JOIN production_tank tk ON tk.id = d.tank_id)
    ) AS x
    FROM production_batch b
    JOIN "Warehouse" w ON w.id = b.warehouse_id
    JOIN "Material" m ON m.id = b.material_id
   WHERE b.id = ANY(coalesce(v_ids, ARRAY[]::text[]))
     AND (p_wh_ids IS NULL OR b.warehouse_id = ANY(p_wh_ids))
   LIMIT v_lim
  ) s;
  RETURN jsonb_build_object('batches', v_out);
END $$;
REVOKE ALL ON FUNCTION public.mes_genealogy(text, text, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_genealogy(text, text, text[], integer) TO service_role;

-- Lưới tự kiểm (dữ liệu giả trong khối con, rollback hết bằng ngoại lệ SELFTEST_OK):
--   X4: trang đã rút 100 từ mẻ mã A (lô đã cạn), bồn nay chứa mẻ mã B ⇒ sửa lượng rút lên 150 phải MIX_MATERIAL
--   X3: trang đó (0 pallet, rút thuần 100) ⇒ hủy phải RUN_HAS_TANK_DRAW; trang 0 pallet rút thuần 0 ⇒ hủy được
DO $$
DECLARE
  v_wh text; m1 text; m2 text;
  v_run uuid := gen_random_uuid(); v_run0 uuid := gen_random_uuid();
  v_err text;
BEGIN
  SELECT w.id INTO v_wh FROM "Warehouse" w WHERE w.parent_warehouse_id IS NOT NULL ORDER BY w.id LIMIT 1;
  SELECT id INTO m1 FROM "Material" WHERE is_semi_finished ORDER BY id LIMIT 1;
  SELECT id INTO m2 FROM "Material" WHERE is_semi_finished AND id <> m1 ORDER BY id LIMIT 1;
  IF v_wh IS NULL OR m2 IS NULL THEN RAISE NOTICE 'tự kiểm X3/X4: thiếu kho phụ / 2 mã BTP — bỏ qua'; RETURN; END IF;
  BEGIN
    INSERT INTO production_tank (id, warehouse_id, code, capacity, unit, updated_at) VALUES ('QAX4_T', v_wh, 'QAX4T', 1000, 'L', now());
    INSERT INTO production_batch (id, warehouse_id, batch_code, material_id, prod_date, updated_at)
    VALUES ('QAX4_BA', v_wh, 'QAX4BA', m1, current_date, now()), ('QAX4_BB', v_wh, 'QAX4BB', m2, current_date, now());
    INSERT INTO tank_lot (id, tank_id, batch_id, qty_in, qty_remaining, filled_at, status, updated_at)
    VALUES ('QAX4_LA', 'QAX4_T', 'QAX4_BA', 100, 0, now() - interval '1 day', 'EMPTY', now()),
           ('QAX4_LB', 'QAX4_T', 'QAX4_BB', 100, 100, now(), 'ACTIVE', now());
    INSERT INTO packing_runs (id, warehouse_id, run_date, material_code, machine_code, start_at, status, tank_id, updated_at)
    VALUES (v_run, v_wh, current_date, 'QAX4', 'QAX4', now(), 'CLOSED', 'QAX4_T', now()),
           (v_run0, v_wh, current_date, 'QAX4', 'QAX4', now(), 'CLOSED', 'QAX4_T', now());
    INSERT INTO tank_movement (id, tank_id, tank_lot_id, batch_id, kind, qty, packing_run_id, updated_at)
    VALUES ('QAX4_MV', 'QAX4_T', 'QAX4_LA', 'QAX4_BA', 'DRAW', -100, v_run, now());
    v_err := NULL;
    BEGIN PERFORM mes_run_redraw(jsonb_build_object('run_id', v_run, 'tank_qty', 150, 'reason', 'tự kiểm'));
    EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR v_err NOT LIKE 'MESERR:MIX_MATERIAL%' THEN RAISE EXCEPTION 'X4: rút thêm khi bồn đã đổi mã phải MIX_MATERIAL, nhận %', coalesce(v_err, 'không lỗi'); END IF;
    v_err := NULL;
    BEGIN PERFORM packing_run_cancel(jsonb_build_object('run_id', v_run));
    EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR v_err NOT LIKE 'MESERR:RUN_HAS_TANK_DRAW%' THEN RAISE EXCEPTION 'X3: hủy trang còn rút bồn phải RUN_HAS_TANK_DRAW, nhận %', coalesce(v_err, 'không lỗi'); END IF;
    PERFORM packing_run_cancel(jsonb_build_object('run_id', v_run0, 'note', 'tự kiểm'));
    IF (SELECT status FROM packing_runs WHERE id = v_run0) <> 'CANCELLED' THEN RAISE EXCEPTION 'X3: trang rút thuần 0 phải hủy được'; END IF;
    RAISE EXCEPTION 'SELFTEST_OK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'SELFTEST_OK' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'tự kiểm X3/X4: OK';
END $$;

COMMIT;
