-- MES 14/11 (đêm) — BÁO CÁO SỬ DỤNG NGUYÊN VẬT LIỆU THEO CA (thay biểu mẫu giấy NB-QA-BM-CB.01 — user: "mục tiêu là bỏ các tờ giấy này đi").
-- Một báo cáo = một CA của một kho chế biến: mở ca → cấp nguyên liệu cho các mẻ (đã ghi ở batch_consumption) → cuối ca nhập TỒN CUỐI
-- THỰC TẾ và CHỐT. Số tự tính, không ai gõ lại:
--   • Tồn đầu thực tế  = số đếm lúc chốt ca TRƯỚC (giao ca); ca đầu tiên chưa có số đếm ⇒ dựng từ sổ: tồn hiện tại + đã dùng − đã nhập trong ca
--   • Nhập             = hàng vào kho chế biến trong ca (dòng tồn tạo mới trong khoảng thời gian của ca)
--   • Dùng theo mẻ     = batch_consumption (không tính dòng đã huỷ) ghi trong ca, tách theo từng mẻ
--   • Tồn cuối sổ sách = tồn của kho chế biến trên app lúc chốt
--   • Chênh lệch       = tồn cuối thực tế − tồn cuối sổ sách (KHÔNG tự sửa tồn — muốn khớp sổ thì kiểm kê / điều chỉnh tồn như mọi kho)
-- Khoảng thời gian của ca = từ lúc chốt ca trước tới lúc chốt ca này ⇒ các ca nối nhau, không hở, không trùng. Mỗi kho một ca đang mở.
-- Chốt ca = chụp mọi con số vào production_shift_count (báo cáo đã chốt không đổi khi tồn kho về sau đổi).
BEGIN;

CREATE TABLE IF NOT EXISTS public.production_shift_report (
  id              text PRIMARY KEY,
  warehouse_id    text NOT NULL REFERENCES public."Warehouse"(id),
  report_date     date NOT NULL,
  shift           text NOT NULL CHECK (length(btrim(shift)) BETWEEN 1 AND 40),
  from_at         timestamptz NOT NULL,
  to_at           timestamptz,
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  note            text CHECK (note IS NULL OR length(note) <= 1000),      -- giao ca
  opened_by_name  text,
  closed_by       text,
  closed_by_name  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL,
  UNIQUE (warehouse_id, report_date, shift)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_report_open ON public.production_shift_report (warehouse_id) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_shift_report_wh_date ON public.production_shift_report (warehouse_id, report_date DESC);
ALTER TABLE public.production_shift_report ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.production_shift_count (
  id            text PRIMARY KEY,
  report_id     text NOT NULL REFERENCES public.production_shift_report(id) ON DELETE CASCADE,
  material_id   text NOT NULL REFERENCES public."Material"(id),
  qty_actual    numeric CHECK (qty_actual IS NULL OR (qty_actual >= 0 AND qty_actual <= 100000000)),   -- tồn cuối THỰC TẾ (người đếm)
  -- chụp lúc chốt (null khi ca còn mở):
  qty_opening   numeric,
  opening_src   text CHECK (opening_src IS NULL OR opening_src IN ('COUNT', 'BOOK')),
  qty_received  numeric,
  qty_used      numeric,
  qty_book      numeric,
  note          text CHECK (note IS NULL OR length(note) <= 200),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL,
  UNIQUE (report_id, material_id)
);
ALTER TABLE public.production_shift_count ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_batch_cons_created ON public.batch_consumption (created_at);

-- Số của một ca ĐANG MỞ, tính sống tới lúc gọi (ca đã chốt đọc bản chụp, không gọi hàm này)
CREATE OR REPLACE FUNCTION public.mes_shift_calc(p_report_id text)
RETURNS TABLE (material_id text, opening numeric, opening_src text, received numeric, used numeric, book numeric)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  r      record;
  v_prev text;
BEGIN
  SELECT * INTO r FROM production_shift_report WHERE id = p_report_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT x.id INTO v_prev FROM production_shift_report x
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
    SELECT e.material_id AS mid, sum(COALESCE(e.cartons_imported, 0)) AS q
      FROM "InventoryEntry" e WHERE e.warehouse_id = r.warehouse_id AND e.created_at >= r.from_at GROUP BY 1
  ), prev AS (
    SELECT l.material_id AS mid, l.qty_actual AS q FROM production_shift_count l WHERE l.report_id = v_prev AND l.qty_actual IS NOT NULL
  ), keys AS (
    SELECT mid FROM stock WHERE q > 0 UNION SELECT mid FROM used UNION SELECT mid FROM recv WHERE q > 0
    UNION SELECT mid FROM prev WHERE q > 0 UNION SELECT l.material_id FROM production_shift_count l WHERE l.report_id = r.id
  )
  SELECT k.mid,
         COALESCE(p.q, COALESCE(s.q, 0) + COALESCE(u.q, 0) - COALESCE(rc.q, 0)),
         CASE WHEN p.mid IS NOT NULL THEN 'COUNT' ELSE 'BOOK' END,
         COALESCE(rc.q, 0), COALESCE(u.q, 0), COALESCE(s.q, 0)
    FROM keys k
    LEFT JOIN stock s ON s.mid = k.mid LEFT JOIN used u ON u.mid = k.mid
    LEFT JOIN recv rc ON rc.mid = k.mid LEFT JOIN prev p ON p.mid = k.mid;
END $$;

-- MỞ CA — p: {warehouse_id, report_date, shift, actor_name}. Kho còn ca đang mở ⇒ phải chốt ca đó trước.
CREATE OR REPLACE FUNCTION public.mes_shift_open(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_wh   text := p->>'warehouse_id';
  v_open record;
  v_from timestamptz;
  v_id   text := gen_random_uuid()::text;
BEGIN
  PERFORM 1 FROM "Warehouse" WHERE id = v_wh FOR UPDATE;   -- hai người cùng mở ca ⇒ xếp hàng
  SELECT * INTO v_open FROM production_shift_report WHERE warehouse_id = v_wh AND status = 'OPEN';
  IF FOUND THEN
    RAISE EXCEPTION 'MESERR:SHIFT_OPEN|Kho còn ca % ngày % chưa chốt — chốt ca đó trước khi mở ca mới', v_open.shift, to_char(v_open.report_date, 'DD-MM-YYYY');
  END IF;
  IF EXISTS (SELECT 1 FROM production_shift_report WHERE warehouse_id = v_wh AND report_date = (p->>'report_date')::date AND shift = btrim(p->>'shift')) THEN
    RAISE EXCEPTION 'MESERR:SHIFT_DUP|Ca % ngày % đã có báo cáo', btrim(p->>'shift'), to_char((p->>'report_date')::date, 'DD-MM-YYYY');
  END IF;
  SELECT max(to_at) INTO v_from FROM production_shift_report WHERE warehouse_id = v_wh AND status = 'CLOSED';
  -- kho chưa từng chốt ca: tính từ đầu ngày hôm nay (giờ VN)
  v_from := COALESCE(v_from, (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')) AT TIME ZONE 'Asia/Ho_Chi_Minh');
  INSERT INTO production_shift_report (id, warehouse_id, report_date, shift, from_at, status, opened_by_name, updated_at)
  VALUES (v_id, v_wh, (p->>'report_date')::date, btrim(p->>'shift'), v_from, 'OPEN', p->>'actor_name', now());
  RETURN jsonb_build_object('id', v_id, 'from_at', v_from);
END $$;

-- LƯU SỐ ĐẾM / CHỐT CA — p: {report_id, items:[{material_id, qty_actual|null}], note, close, actor_id, actor_name}
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
  UPDATE production_shift_report SET status = 'CLOSED', to_at = clock_timestamp(), closed_by = p->>'actor_id', closed_by_name = p->>'actor_name', updated_at = now()
   WHERE id = r.id;
  RETURN jsonb_build_object('status', 'CLOSED');
END $$;

-- ĐỌC BÁO CÁO — một lời gọi: đầu báo cáo + các mẻ có dùng nguyên liệu trong ca + mỗi nguyên liệu một dòng (kèm lượng dùng theo từng mẻ)
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
  RETURN jsonb_build_object('report', to_jsonb(r), 'batches', v_batch, 'rows', v_rows);
END $$;

REVOKE ALL ON FUNCTION public.mes_shift_calc(text), public.mes_shift_open(jsonb), public.mes_shift_save(jsonb), public.mes_shift_report(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_shift_calc(text), public.mes_shift_open(jsonb), public.mes_shift_save(jsonb), public.mes_shift_report(text) TO service_role;

-- Quyền production.shift_report (mở / chốt báo cáo ca, nhập tồn cuối thực tế) — theo năng lực: QA lô hoặc người mở mẻ; đã có thì không đè
UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(j.module_permissions, '{production}', (j.module_permissions->'production') || '["shift_report"]'::jsonb, true),
       updated_at = now()
 WHERE (j.module_permissions->'production' ? 'qa_release' OR j.module_permissions->'production' ? 'open_batch')
   AND NOT (j.module_permissions->'production' ? 'shift_report');

COMMIT;
