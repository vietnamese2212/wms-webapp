-- MES 14/11 (tối) — user chốt: (1) "Sửa được" lượng rút bồn SAU KHI trang sổ đã đóng; (2) setting MES dời sang trang "Cài đặt MES".
--   • mes_run_redraw  — đặt lại TỔNG lượng một trang sổ ĐÃ ĐÓNG rút từ bồn (khai bù / sửa số gõ nhầm). Sổ bồn chỉ GHI THÊM:
--       tăng  ⇒ rút thêm phần chênh (cùng luật QA / chia theo tỷ lệ của mes_tank_take);
--       giảm  ⇒ trả phần chênh về bồn, chia theo tỷ lệ lượng THUẦN trang đã rút của từng mẻ (dòng DRAW dấu +, kèm lý do).
--   • mes_genealogy   — chỉ nối (trang, mẻ) có lượng rút thuần > 0 (thân hàm chép từ 20261114, đổi 2 chỗ).
--   • quyền production.configure (trang Cài đặt MES) — cấp theo NĂNG LỰC đang có: chức danh đã sửa được công tắc này ở
--     Cài đặt WMS (wms_settings.manage_warehouse) VÀ đã xem được MES ⇒ không ai mất khả năng khi dời chỗ.
BEGIN;

CREATE OR REPLACE FUNCTION public.mes_run_redraw(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
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
  SELECT ob.material_id INTO v_mat FROM tank_movement mv JOIN production_batch ob ON ob.id = mv.batch_id
   WHERE mv.packing_run_id = r.id AND mv.kind = 'DRAW' LIMIT 1;
  SELECT m.material_code INTO v_other FROM tank_lot l JOIN production_batch ob ON ob.id = l.batch_id JOIN "Material" m ON m.id = ob.material_id
   WHERE l.tank_id = t.id AND l.status = 'ACTIVE' AND l.qty_remaining > 0 AND ob.material_id <> v_mat LIMIT 1;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'MESERR:MIX_MATERIAL|Bồn % nay đang chứa mã % — không trả lượng rút cũ về được', t.code, v_other;
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

CREATE OR REPLACE FUNCTION public.mes_genealogy(p_kind text, p_value text, p_wh_ids text[] DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
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
          JOIN packing_runs r ON r.id = d.packing_run_id
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

-- Quyền production.configure — theo năng lực đang có; chức danh đã có thì không đè
UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(j.module_permissions, '{production}', (j.module_permissions->'production') || '["configure"]'::jsonb, true),
       updated_at = now()
 WHERE j.module_permissions->'wms_settings' ? 'manage_warehouse'
   AND j.module_permissions->'production' ? 'view'
   AND NOT (j.module_permissions->'production' ? 'configure');

COMMIT;
