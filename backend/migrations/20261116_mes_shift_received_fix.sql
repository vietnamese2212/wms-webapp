-- MES 16/11 — BÁO CÁO CA: sửa hai số tính sai (rà module Sản xuất 16/11, lớp C113).
--
-- 1) "NHẬP" BỎ SÓT HÀNG NHẬN GỘP VÀO DÒNG TỒN ĐÃ CÓ.
--    Bản 20261114g đếm Nhập = dòng InventoryEntry TẠO MỚI trong ca. Kho chế biến chế độ QTY_DATE (kho thật duy nhất trên staging, CBBV)
--    lưu một dòng / (mã, NSX): nhận thêm cùng NSX thì CỘNG vào dòng cũ (inboundController: cartons_imported += n), không tạo dòng mới
--    ⇒ lần nhận đó không lên cột Nhập, và "tồn đầu (sổ)" dựng ngược bị lệch theo.
--    Sửa: lúc CHỐT ca chụp BỘ ĐẾM NHẬP CỘNG DỒN của kho (Σ cartons_imported mọi dòng, mọi trạng thái, trừ dòng tách pallet
--    origin = 'SPLIT') vào production_shift_report.cum_in. Ca sau: Nhập = bộ đếm hiện tại − bộ đếm lúc chốt ca trước.
--    Bắt được nhận gộp, nhận dòng mới; gỡ số đã nhận / xoá dòng nhập nhầm ra số âm (đúng nghĩa: nhập bị huỷ).
--    Ca ĐẦU TIÊN của kho (chưa có bộ đếm) giữ cách cũ: dòng tạo mới trong ca (bỏ dòng tách pallet).
-- 2) "TỒN ĐẦU (sổ)" KHI CA TRƯỚC KHÔNG ĐẾM MÃ ĐÓ.
--    Bản cũ dựng ngược = tồn hiện tại + đã dùng − đã nhập ⇒ sai mỗi khi trong ca có xuất tiêu hao / điều chỉnh / kiểm kê.
--    Ca trước đã chụp tồn sổ lúc chốt (qty_book) đúng tại from_at của ca này ⇒ dùng nó (mã vắng trong bản chụp = tồn sổ 0).
--    Chỉ ca đầu tiên của kho mới còn dựng ngược.
BEGIN;

ALTER TABLE public.production_shift_report ADD COLUMN IF NOT EXISTS cum_in jsonb CHECK (cum_in IS NULL OR jsonb_typeof(cum_in) = 'object');

-- Bộ đếm nhập cộng dồn của một kho, theo mã (đơn vị gốc)
CREATE OR REPLACE FUNCTION public.mes_wh_cum_in(p_wh text)
RETURNS TABLE (material_id text, qty numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT e.material_id, sum(COALESCE(e.cartons_imported, 0))
    FROM "InventoryEntry" e
   WHERE e.warehouse_id = p_wh AND e.material_id IS NOT NULL AND COALESCE(e.origin, 'IMPORT') <> 'SPLIT'
   GROUP BY e.material_id
$$;

CREATE OR REPLACE FUNCTION public.mes_shift_calc(p_report_id text)
RETURNS TABLE (material_id text, opening numeric, opening_src text, received numeric, used numeric, book numeric)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
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
    UNION SELECT p.mid FROM prev p WHERE p.cnt > 0 OR p.bk > 0 UNION SELECT l.material_id FROM production_shift_count l WHERE l.report_id = r.id
  )
  SELECT k.mid,
         CASE WHEN p.cnt IS NOT NULL THEN p.cnt
              WHEN v_prev IS NOT NULL THEN COALESCE(p.bk, 0)                                    -- tồn sổ đúng lúc chốt ca trước
              ELSE COALESCE(s.q, 0) + COALESCE(u.q, 0) - COALESCE(rc.q, 0) END,                 -- ca đầu tiên: dựng ngược
         CASE WHEN p.cnt IS NOT NULL THEN 'COUNT' ELSE 'BOOK' END,
         COALESCE(rc.q, 0), COALESCE(u.q, 0), COALESCE(s.q, 0)
    FROM keys k
    LEFT JOIN stock s ON s.mid = k.mid LEFT JOIN used u ON u.mid = k.mid
    LEFT JOIN recv rc ON rc.mid = k.mid LEFT JOIN prev p ON p.mid = k.mid;
END $$;

-- LƯU SỐ ĐẾM / CHỐT CA — thân như 20261114g, thêm chụp bộ đếm nhập (cum_in) lúc chốt
CREATE OR REPLACE FUNCTION public.mes_shift_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
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
  -- CHỐT: chụp mọi con số; nguyên liệu chưa nhập số đếm vẫn có dòng (qty_actual null = không đếm)
  INSERT INTO production_shift_count (id, report_id, material_id, qty_opening, opening_src, qty_received, qty_used, qty_book, updated_at)
  SELECT gen_random_uuid()::text, r.id, c.material_id, c.opening, c.opening_src, c.received, c.used, c.book, now()
    FROM mes_shift_calc(r.id) c
  ON CONFLICT (report_id, material_id) DO UPDATE SET qty_opening = EXCLUDED.qty_opening, opening_src = EXCLUDED.opening_src,
         qty_received = EXCLUDED.qty_received, qty_used = EXCLUDED.qty_used, qty_book = EXCLUDED.qty_book, updated_at = now();
  UPDATE production_shift_report SET status = 'CLOSED', to_at = clock_timestamp(), closed_by = p->>'actor_id', closed_by_name = p->>'actor_name',
         cum_in = (SELECT COALESCE(jsonb_object_agg(k.material_id, k.qty), '{}'::jsonb) FROM mes_wh_cum_in(r.warehouse_id) k),
         updated_at = now()
   WHERE id = r.id;
  RETURN jsonb_build_object('status', 'CLOSED');
END $$;

-- mes_shift_report trả to_jsonb(r) — bộ đếm là số nội bộ, không gửi ra màn hình
CREATE OR REPLACE FUNCTION public.mes_shift_report(p_report_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  r        record;
  v_rows   jsonb;
  v_batch  jsonb;
BEGIN
  SELECT * INTO r FROM production_shift_report WHERE id = p_report_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'batch_code', b.batch_code, 'cycle', b.cycle, 'shift', b.shift, 'machine_code', b.machine_code,
           'material_code', m.material_code, 'material_name', m.short_name) ORDER BY b.created_at, b.batch_code), '[]'::jsonb) INTO v_batch
    FROM production_batch b JOIN "Material" m ON m.id = b.material_id
   WHERE b.warehouse_id = r.warehouse_id
     AND EXISTS (SELECT 1 FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL AND c.created_at >= r.from_at AND (r.to_at IS NULL OR c.created_at < r.to_at));
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'material_code'), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object('material_id', m.id, 'material_code', m.material_code, 'material_name', m.short_name,
             'base_unit', m.base_unit, 'entry_unit', m.entry_unit, 'units_per_carton', m.units_per_carton,
             'opening', d.opening, 'opening_src', d.opening_src, 'received', d.received, 'used', d.used, 'book', d.book, 'actual', d.actual,
             'by_batch', COALESCE((SELECT jsonb_object_agg(q.batch_id, q.qty) FROM (
                 SELECT c.batch_id, sum(c.qty) AS qty FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
                  WHERE b.warehouse_id = r.warehouse_id AND c.material_id = m.id AND c.reversed_at IS NULL
                    AND c.created_at >= r.from_at AND (r.to_at IS NULL OR c.created_at < r.to_at) GROUP BY c.batch_id) q), '{}'::jsonb)) AS x
      FROM (
        SELECT l.material_id, l.qty_opening AS opening, l.opening_src, l.qty_received AS received, l.qty_used AS used, l.qty_book AS book, l.qty_actual AS actual
          FROM production_shift_count l WHERE r.status = 'CLOSED' AND l.report_id = r.id
        UNION ALL
        SELECT c.material_id, c.opening, c.opening_src, c.received, c.used, c.book,
               (SELECT l.qty_actual FROM production_shift_count l WHERE l.report_id = r.id AND l.material_id = c.material_id)
          FROM mes_shift_calc(r.id) c WHERE r.status = 'OPEN'
      ) d JOIN "Material" m ON m.id = d.material_id
  ) s;
  RETURN jsonb_build_object('report', to_jsonb(r) - 'cum_in', 'batches', v_batch, 'rows', v_rows);
END $$;

REVOKE ALL ON FUNCTION public.mes_wh_cum_in(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_wh_cum_in(text) TO service_role;

COMMIT;
