-- Rà soát MES 25/11 — "NVL đã mất" (user chốt 25/11, docs/plans/MES_REVIEW_2026-11-25.md mục 8):
--   · "Về nguyên lý tồn phải về làm tồn ảo trước, nhưng nếu nó đã sử dụng hoặc không tái dùng được phần nào thì phải được ghi nhận
--      (block toàn bộ hoặc phần nào, có lý do)" · "Huỷ lô nào thì tồn lô đó hồi về, block đúng lô. Điều chỉnh thì làm đúng lô block."
--   · "Điều chỉnh tồn được (quyền Điều chỉnh tồn). Phần mềm chạy riêng, kiểm kê thực tế đối chiếu với SAP ⇒ cần show phần chênh lệch là gì."
-- MÔ HÌNH = HÀNG CHẶN (như tồn bị chặn của SAP):
--   · Huỷ cấp (một dòng, hoặc cả mẻ hỏng) HOÀN ĐỦ về đúng lô đã cấp; phần không tái dùng được tách thành HÀNG CHẶN của chính lô đó
--     (inventory_block). Phần chặn ra khỏi cartons_remaining ⇒ không cửa cấp / xuất / nhặt / fill nào lấy được (không cửa nào phải sửa),
--     nhưng vẫn nằm trong TỒN SỔ của kho (báo cáo ca: sổ = dùng được + đang chặn) ⇒ đếm cuối ca lộ ra phần đã mất.
--   · Điều chỉnh (quyền inventory.adjust): XOÁ phần chặn khỏi tồn sổ đúng lô chặn (WRITE_OFF), hoặc BỎ CHẶN trả về dùng được (RELEASE).
--     "Điều chỉnh tồn theo số đếm" ở ca đã chốt MỚI NHẤT = xoá các lô chặn (có trước lúc chốt) của mã đếm thiếu, tối đa bằng phần thiếu,
--     lô chặn cũ trước. Phần thiếu không có lô chặn KHÔNG tự trừ (không biết lô) — điều chỉnh từng lô ở Tồn kho.
--   · Sổ chênh lệch (mes_stock_variance): mọi tác động làm tồn app khác sổ SAP trong kỳ (xoá hàng chặn + điều chỉnh tay / kiểm kê / nạp Excel),
--     kèm hàng đang chặn (chưa điều chỉnh) — để kiểm kê đối chiếu SAP biết "phần chênh lệch là gì".
BEGIN;

-- ── 1. Sổ hàng chặn ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_block (
  id               text PRIMARY KEY,
  entry_id         text NOT NULL REFERENCES public."InventoryEntry"(id),
  warehouse_id     text NOT NULL REFERENCES public."Warehouse"(id),
  material_id      text NOT NULL REFERENCES public."Material"(id),
  pallet_code      text NOT NULL,
  qty              numeric NOT NULL CHECK (qty > 0),                       -- lượng chặn lúc ghi (đơn vị gốc)
  qty_written_off  numeric NOT NULL DEFAULT 0 CHECK (qty_written_off >= 0), -- đã xoá khỏi tồn sổ (điều chỉnh)
  qty_released     numeric NOT NULL DEFAULT 0 CHECK (qty_released >= 0),    -- đã bỏ chặn (trả về dùng được)
  reason           text NOT NULL,
  source           text NOT NULL CHECK (source IN ('REVERSE', 'BATCH_CANCEL')),
  batch_id         text REFERENCES public.production_batch(id),
  consumption_id   text REFERENCES public.batch_consumption(id),
  created_by       text,
  created_by_name  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL,
  CONSTRAINT inventory_block_qty_ck CHECK (qty_written_off + qty_released <= qty)
);
CREATE INDEX IF NOT EXISTS idx_inv_block_open   ON public.inventory_block (warehouse_id, material_id) WHERE qty_written_off + qty_released < qty;
CREATE INDEX IF NOT EXISTS idx_inv_block_wh_at  ON public.inventory_block (warehouse_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inv_block_entry  ON public.inventory_block (entry_id);
CREATE INDEX IF NOT EXISTS idx_inv_block_pallet ON public.inventory_block (pallet_code);
ALTER TABLE public.inventory_block ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.inventory_block_event (
  id               text PRIMARY KEY,
  block_id         text NOT NULL REFERENCES public.inventory_block(id),
  warehouse_id     text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('WRITE_OFF', 'RELEASE')),
  qty              numeric NOT NULL CHECK (qty > 0),
  note             text,
  shift_report_id  text REFERENCES public.production_shift_report(id),
  actor_id         text,
  actor_name       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_block_ev_wh_at ON public.inventory_block_event (warehouse_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inv_block_ev_block ON public.inventory_block_event (block_id);
ALTER TABLE public.inventory_block_event ENABLE ROW LEVEL SECURITY;

-- realtime: trigger phát tín hiệu được event trigger tự gắn khi CREATE TABLE; bảng đã có từ lượt chạy trước thì gắn lại cho chắc
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_wms_notify' AND tgrelid = 'public.inventory_block'::regclass) THEN
    CREATE TRIGGER trg_wms_notify AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.inventory_block FOR EACH STATEMENT EXECUTE FUNCTION public.wms_notify_change();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_wms_notify' AND tgrelid = 'public.inventory_block_event'::regclass) THEN
    CREATE TRIGGER trg_wms_notify AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.inventory_block_event FOR EACH STATEMENT EXECUTE FUNCTION public.wms_notify_change();
  END IF;
END $$;

ALTER TABLE public.production_batch
  ADD COLUMN IF NOT EXISTS cancel_reason     text,
  ADD COLUMN IF NOT EXISTS cancelled_at      timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by      text,
  ADD COLUMN IF NOT EXISTS cancelled_by_name text;
ALTER TABLE public.production_shift_report
  ADD COLUMN IF NOT EXISTS stock_adjusted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS stock_adjusted_by      text,
  ADD COLUMN IF NOT EXISTS stock_adjusted_by_name text;
ALTER TABLE public.production_shift_count
  ADD COLUMN IF NOT EXISTS qty_blocked     numeric,   -- trong tồn sổ lúc chốt: phần đang chặn
  ADD COLUMN IF NOT EXISTS qty_adjust      numeric,   -- điều chỉnh tồn trong ca (tay / kiểm kê / nạp Excel / xoá hàng chặn)
  ADD COLUMN IF NOT EXISTS qty_written_off numeric;   -- xoá hàng chặn bởi "Điều chỉnh tồn theo số đếm" của chính báo cáo này
-- sổ điều chỉnh theo thời gian (sổ ca + sổ chênh lệch lọc theo khoảng giờ)
CREATE INDEX IF NOT EXISTS idx_invadjlog_at ON public."InventoryAdjustmentLog" (adjusted_at);

-- ── 2. Hàm đọc dùng chung ───────────────────────────────────────────────────────────────────────────────────────────────
-- hàng chặn CÒN MỞ của một kho theo mã (MỘT chỗ tính "đang chặn" cho sổ ca / sổ chênh lệch)
CREATE OR REPLACE FUNCTION public.mes_block_open(p_wh text)
RETURNS TABLE(material_id text, qty numeric)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT k.material_id, sum(k.qty - k.qty_written_off - k.qty_released)
    FROM inventory_block k
   WHERE k.warehouse_id = p_wh AND k.qty_written_off + k.qty_released < k.qty
   GROUP BY k.material_id
$$;

-- tác động làm ĐỔI TỒN SỔ (dùng được + chặn) của một kho trong [from, to): điều chỉnh tay / kiểm kê / nạp Excel / nhập gộp (InventoryAdjustmentLog)
-- + xoá hàng chặn (−). Chặn / bỏ chặn không đổi tồn sổ (chuyển giữa dùng được ↔ chặn) nên không tính.
CREATE OR REPLACE FUNCTION public.mes_wh_adjust(p_wh text, p_from timestamptz, p_to timestamptz)
RETURNS TABLE(material_id text, qty numeric)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT x.mid, sum(x.q) FROM (
    SELECT e.material_id AS mid, l.delta AS q
      FROM "InventoryAdjustmentLog" l JOIN "InventoryEntry" e ON e.id = l.entry_id
     WHERE e.warehouse_id = p_wh AND l.adjusted_at >= p_from AND (p_to IS NULL OR l.adjusted_at < p_to)
    UNION ALL
    SELECT k.material_id, -ev.qty
      FROM inventory_block_event ev JOIN inventory_block k ON k.id = ev.block_id
     WHERE ev.warehouse_id = p_wh AND ev.kind = 'WRITE_OFF' AND ev.created_at >= p_from AND (p_to IS NULL OR ev.created_at < p_to)
  ) x WHERE x.mid IS NOT NULL GROUP BY x.mid
$$;

-- ── 3. Huỷ một dòng cấp: hoàn ĐỦ về đúng lô, phần không tái dùng được ⇒ hàng chặn của lô đó ────────────────────────────────
-- Dùng chung cho "Huỷ cấp" (một dòng) và "Huỷ mẻ" (mọi dòng). p_keep_closed = true (huỷ mẻ): dòng thuộc ca đã chốt mà kho bật chặn
-- ⇒ GIỮ nguyên là cấp cho mẻ huỷ (hao hụt của mẻ) thay vì báo lỗi.
-- Thứ tự khoá: mẻ (FOR SHARE, qua mes_open_batch_wh) → dòng cấp → dòng tồn — CÙNG thứ tự với huỷ mẻ (mẻ FOR UPDATE trước) ⇒ không khoá chéo.
CREATE OR REPLACE FUNCTION public.mes_consume_reverse_line(p_cid text, p_reason text, p_block numeric, p_keep_closed boolean, p_source text,
                                                           p_actor_id text, p_actor_name text)
RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  c       record;
  e       record;
  v_batch text;
  v_new   numeric;
  v_wh    text;
  v_shift record;
  v_block numeric := COALESCE(p_block, 0);
  v_why   text := left(btrim(coalesce(p_reason, '')), 500);
BEGIN
  IF length(v_why) = 0 THEN RAISE EXCEPTION 'MESERR:REASON|Nhập lý do huỷ'; END IF;
  SELECT batch_id INTO v_batch FROM batch_consumption WHERE id = p_cid;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy dòng rút'; END IF;
  v_wh := mes_open_batch_wh(v_batch);
  SELECT * INTO c FROM batch_consumption WHERE id = p_cid FOR UPDATE;
  IF c.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'MESERR:ALREADY_REVERSED|Dòng rút này đã huỷ rồi'; END IF;
  IF v_block < 0 OR v_block > c.qty THEN
    RAISE EXCEPTION 'MESERR:BLOCK_QTY|Phần không tái dùng (chặn) của tem % phải từ 0 tới % (lượng đã cấp)', c.pallet_code, c.qty;
  END IF;
  -- mã có đơn vị thùng ⇒ số gốc phải nguyên (cùng luật qtyIntegerError của mọi cửa nhập số)
  IF v_block <> trunc(v_block) AND EXISTS (SELECT 1 FROM "Material" m WHERE m.id = c.material_id AND COALESCE(btrim(m.entry_unit), '') <> '' AND COALESCE(m.units_per_carton, 0) > 0) THEN
    RAISE EXCEPTION 'MESERR:BLOCK_QTY|Mã của tem % tính theo thùng — phần chặn phải là số nguyên theo đơn vị gốc', c.pallet_code;
  END IF;
  -- 25/11 (N4, user chốt): kho bật "chặn huỷ cấp của ca đã chốt" ⇒ lần cấp nằm trong một ca đã chốt không huỷ được nữa
  IF (SELECT mes_block_reverse_closed FROM "Warehouse" WHERE id = v_wh) THEN
    SELECT s.report_date, s.shift INTO v_shift FROM production_shift_report s
     WHERE s.warehouse_id = v_wh AND s.status = 'CLOSED' AND s.from_at <= c.created_at AND s.to_at > c.created_at
     ORDER BY s.to_at DESC LIMIT 1;
    IF FOUND THEN
      IF p_keep_closed THEN RETURN jsonb_build_object('id', c.id, 'kept', true, 'qty', c.qty); END IF;
      RAISE EXCEPTION 'MESERR:SHIFT_CLOSED|Lần cấp này thuộc ca % ngày % đã chốt — kho đặt chặn huỷ cấp của ca đã chốt (NVL thường đã dùng / mất). Chênh lệch xử lý bằng kiểm kê / điều chỉnh tồn',
        v_shift.shift, to_char(v_shift.report_date, 'DD-MM-YYYY');
    END IF;
  END IF;
  SELECT * INTO e FROM "InventoryEntry" WHERE id = c.entry_id FOR UPDATE;
  v_new := COALESCE(e.cartons_remaining, 0) + c.qty - v_block;
  UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = inventory_entry_status(e.status, v_new, COALESCE(e.cartons_imported, 0), e.cartons_reserved),
         updated_at = now() WHERE id = e.id;
  UPDATE batch_consumption SET reversed_at = clock_timestamp(), reversed_by = p_actor_id, reversed_by_name = p_actor_name,
         reverse_reason = v_why, updated_at = now() WHERE id = c.id;
  IF v_block > 0 THEN
    INSERT INTO inventory_block (id, entry_id, warehouse_id, material_id, pallet_code, qty, reason, source, batch_id, consumption_id,
                                 created_by, created_by_name, created_at, updated_at)
    VALUES (gen_random_uuid()::text, e.id, e.warehouse_id, c.material_id, c.pallet_code, v_block, v_why, p_source, c.batch_id, c.id,
            p_actor_id, p_actor_name, clock_timestamp(), now());
  END IF;
  RETURN jsonb_build_object('id', c.id, 'entry_id', e.id, 'remaining', v_new, 'blocked', v_block, 'kept', false);
END $function$;

CREATE OR REPLACE FUNCTION public.mes_consume_reverse(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  RETURN mes_consume_reverse_line(p->>'consumption_id', p->>'reason', NULLIF(p->>'qty_block', '')::numeric, false, 'REVERSE',
                                  p->>'actor_id', p->>'actor_name');
END $function$;

-- ── 4. Huỷ mẻ (kể cả mẻ hỏng đã cấp NVL) — MỘT giao dịch: hoàn từng dòng (chặn đúng lô phần không tái dùng) + mẻ Huỷ ─────────
-- p: batch_id · reason (bắt buộc khi mẻ có dòng cấp) · lines [{consumption_id, qty_block}] = ĐÚNG tập dòng cấp còn hiệu lực
-- (màn mở lâu, có người cấp / huỷ cấp thêm ⇒ LINES_CHANGED, không huỷ nhầm theo bản cũ) · actor_id · actor_name
CREATE OR REPLACE FUNCTION public.mes_batch_cancel(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  b        record;
  l        record;
  v_lines  jsonb := COALESCE(p->'lines', '[]'::jsonb);
  v_live   text[];
  v_given  text[];
  v_res    jsonb;
  v_ret    int := 0;
  v_kept   int := 0;
  v_blk    numeric := 0;
  v_reason text := left(btrim(coalesce(p->>'reason', '')), 500);
BEGIN
  IF jsonb_typeof(v_lines) <> 'array' THEN RAISE EXCEPTION 'MESERR:BAD_INPUT|lines phải là danh sách'; END IF;
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF b.status <> 'OPEN' THEN RAISE EXCEPTION 'MESERR:BATCH_STATUS|Mẻ đang ở trạng thái %', b.status; END IF;
  IF EXISTS (SELECT 1 FROM tank_movement WHERE batch_id = b.id) THEN
    RAISE EXCEPTION 'MESERR:BATCH_HAS_TANK|Mẻ đã nạp bồn — không huỷ được; phần trong bồn xả bỏ ở trang Bồn';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id), '{}') INTO v_live FROM batch_consumption WHERE batch_id = b.id AND reversed_at IS NULL;
  SELECT COALESCE(array_agg(x->>'consumption_id' ORDER BY x->>'consumption_id'), '{}') INTO v_given FROM jsonb_array_elements(v_lines) x;
  IF v_live IS DISTINCT FROM v_given THEN
    RAISE EXCEPTION 'MESERR:LINES_CHANGED|Nguyên liệu đã cấp của mẻ vừa thay đổi (có người cấp / huỷ cấp) — tải lại rồi huỷ mẻ';
  END IF;
  IF cardinality(v_live) > 0 AND length(v_reason) = 0 THEN RAISE EXCEPTION 'MESERR:REASON|Nhập lý do huỷ mẻ'; END IF;
  FOR l IN SELECT x->>'consumption_id' AS cid, NULLIF(x->>'qty_block', '')::numeric AS blk FROM jsonb_array_elements(v_lines) x LOOP
    v_res := mes_consume_reverse_line(l.cid, 'Huỷ mẻ ' || b.batch_code || ': ' || v_reason, l.blk, true, 'BATCH_CANCEL',
                                      p->>'actor_id', p->>'actor_name');
    IF (v_res->>'kept')::boolean THEN v_kept := v_kept + 1;
    ELSE v_ret := v_ret + 1; v_blk := v_blk + COALESCE((v_res->>'blocked')::numeric, 0); END IF;
  END LOOP;
  UPDATE production_batch SET status = 'CANCELLED', cancel_reason = NULLIF(v_reason, ''), cancelled_at = clock_timestamp(),
         cancelled_by = p->>'actor_id', cancelled_by_name = p->>'actor_name', updated_at = now()
   WHERE id = b.id;
  RETURN jsonb_build_object('id', b.id, 'status', 'CANCELLED', 'reversed', v_ret, 'kept', v_kept, 'blocked', v_blk);
END $function$;

-- ── 5. Xử lý hàng chặn: XOÁ khỏi tồn sổ (điều chỉnh) hoặc BỎ CHẶN (trả về dùng được) — đúng lô chặn ─────────────────────────
-- p: block_id · kind WRITE_OFF | RELEASE · qty (bỏ trống = hết phần đang chặn) · note · shift_report_id · actor_id · actor_name
CREATE OR REPLACE FUNCTION public.mes_block_act(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  k      record;
  e      record;
  v_wh   text;
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_open numeric;
  v_qty  numeric;
  v_new  numeric;
BEGIN
  IF v_kind NOT IN ('WRITE_OFF', 'RELEASE') THEN RAISE EXCEPTION 'MESERR:BAD_INPUT|Thao tác phải là WRITE_OFF hoặc RELEASE'; END IF;
  SELECT warehouse_id INTO v_wh FROM inventory_block WHERE id = p->>'block_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy dòng hàng chặn'; END IF;
  -- như mọi cửa đổi tồn của kho chế biến: khoá CHIA SẺ theo kho ⇒ chốt ca (khoá độc quyền) chụp số không lọt lượt này
  PERFORM pg_advisory_xact_lock_shared(hashtext('mes_shift:' || v_wh));
  SELECT * INTO k FROM inventory_block WHERE id = p->>'block_id' FOR UPDATE;
  v_open := k.qty - k.qty_written_off - k.qty_released;
  IF v_open <= 0 THEN RAISE EXCEPTION 'MESERR:BLOCK_CLOSED|Hàng chặn của tem % đã xử lý hết', k.pallet_code; END IF;
  v_qty := COALESCE(NULLIF(p->>'qty', '')::numeric, v_open);
  IF v_qty <= 0 OR v_qty > v_open THEN
    RAISE EXCEPTION 'MESERR:BLOCK_QTY|Lượng phải lớn hơn 0 và không quá % (phần đang chặn của tem %)', v_open, k.pallet_code;
  END IF;
  IF v_qty <> trunc(v_qty) AND EXISTS (SELECT 1 FROM "Material" m WHERE m.id = k.material_id AND COALESCE(btrim(m.entry_unit), '') <> '' AND COALESCE(m.units_per_carton, 0) > 0) THEN
    RAISE EXCEPTION 'MESERR:BLOCK_QTY|Mã của tem % tính theo thùng — lượng phải là số nguyên theo đơn vị gốc', k.pallet_code;
  END IF;
  IF v_kind = 'RELEASE' THEN
    SELECT * INTO e FROM "InventoryEntry" WHERE id = k.entry_id FOR UPDATE;
    v_new := COALESCE(e.cartons_remaining, 0) + v_qty;
    UPDATE "InventoryEntry" SET cartons_remaining = v_new,
           status = inventory_entry_status(e.status, v_new, COALESCE(e.cartons_imported, 0), e.cartons_reserved), updated_at = now()
     WHERE id = e.id;
    UPDATE inventory_block SET qty_released = qty_released + v_qty, updated_at = now() WHERE id = k.id;
  ELSE
    UPDATE inventory_block SET qty_written_off = qty_written_off + v_qty, updated_at = now() WHERE id = k.id;
  END IF;
  INSERT INTO inventory_block_event (id, block_id, warehouse_id, kind, qty, note, shift_report_id, actor_id, actor_name, created_at, updated_at)
  VALUES (gen_random_uuid()::text, k.id, k.warehouse_id, v_kind, v_qty, NULLIF(left(btrim(coalesce(p->>'note', '')), 500), ''),
          NULLIF(p->>'shift_report_id', ''), p->>'actor_id', p->>'actor_name', clock_timestamp(), now());
  RETURN jsonb_build_object('block_id', k.id, 'kind', v_kind, 'qty', v_qty, 'open', v_open - v_qty);
END $function$;

-- ── 6. Sổ ca: tồn sổ = dùng được + đang chặn; thêm "Đang chặn" + "Điều chỉnh" (sổ cân: đầu + nhập − dùng + hoàn + điều chỉnh = sổ) ──
DROP FUNCTION IF EXISTS public.mes_shift_calc(text);
CREATE FUNCTION public.mes_shift_calc(p_report_id text)
 RETURNS TABLE(material_id text, opening numeric, opening_src text, received numeric, used numeric, book numeric, returned numeric,
               blocked numeric, adjusted numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  WITH blk AS (
    -- 25/11 (NVL đã mất): phần không tái dùng được của lần cấp bị huỷ — vẫn là TỒN SỔ ("tồn về làm tồn ảo trước") cho tới khi điều chỉnh
    SELECT bo.material_id AS mid, bo.qty AS q FROM mes_block_open(r.warehouse_id) bo
  ), stock AS (
    SELECT z.mid, sum(z.q) AS q FROM (
      SELECT e.material_id AS mid, COALESCE(e.cartons_remaining, e.cartons_imported, 0) AS q
        FROM "InventoryEntry" e WHERE e.warehouse_id = r.warehouse_id AND e.status IN ('IN_STOCK', 'PARTIAL')
      UNION ALL
      SELECT bk.mid, bk.q FROM blk bk
    ) z GROUP BY 1
  ), used AS (
    SELECT c.material_id AS mid, sum(c.qty) AS q
      FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
     WHERE b.warehouse_id = r.warehouse_id AND c.reversed_at IS NULL AND c.created_at >= r.from_at GROUP BY 1
  ), ret AS (
    -- 25/11 (N4): lần cấp của ca TRƯỚC bị huỷ trong ca này ⇒ hàng về lại tồn sổ (cả phần bị chặn) ⇒ "Hoàn từ ca trước"
    SELECT c.material_id AS mid, sum(c.qty) AS q
      FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
     WHERE b.warehouse_id = r.warehouse_id AND c.created_at < r.from_at AND c.reversed_at >= r.from_at GROUP BY 1
  ), adj AS (
    -- điều chỉnh tồn trong ca (tay / kiểm kê / nạp Excel / xoá hàng chặn) — trước đây làm sổ lệch mà không cột nào giải thích
    SELECT a.material_id AS mid, a.qty AS q FROM mes_wh_adjust(r.warehouse_id, r.from_at, NULL) a
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
    UNION SELECT rt.mid FROM ret rt UNION SELECT aj.mid FROM adj aj WHERE aj.q <> 0
    UNION SELECT p.mid FROM prev p WHERE p.cnt > 0 OR p.bk > 0 UNION SELECT l.material_id FROM production_shift_count l WHERE l.report_id = r.id
  )
  SELECT k.mid,
         CASE WHEN p.cnt IS NOT NULL THEN p.cnt
              WHEN v_prev IS NOT NULL THEN COALESCE(p.bk, 0)                                    -- tồn sổ đúng lúc chốt ca trước
              ELSE COALESCE(s.q, 0) + COALESCE(u.q, 0) - COALESCE(rc.q, 0) - COALESCE(rt.q, 0) - COALESCE(aj.q, 0) END,   -- ca đầu tiên: dựng ngược
         CASE WHEN p.cnt IS NOT NULL THEN 'COUNT' ELSE 'BOOK' END,
         COALESCE(rc.q, 0), COALESCE(u.q, 0), COALESCE(s.q, 0), COALESCE(rt.q, 0), COALESCE(bk.q, 0), COALESCE(aj.q, 0)
    FROM keys k
    LEFT JOIN stock s ON s.mid = k.mid LEFT JOIN used u ON u.mid = k.mid
    LEFT JOIN recv rc ON rc.mid = k.mid LEFT JOIN prev p ON p.mid = k.mid LEFT JOIN ret rt ON rt.mid = k.mid
    LEFT JOIN blk bk ON bk.mid = k.mid LEFT JOIN adj aj ON aj.mid = k.mid;
END $function$;
REVOKE ALL ON FUNCTION public.mes_shift_calc(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_shift_calc(text) TO service_role;

CREATE OR REPLACE FUNCTION public.mes_shift_save(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  INSERT INTO production_shift_count (id, report_id, material_id, qty_opening, opening_src, qty_received, qty_used, qty_book, qty_returned,
                                      qty_blocked, qty_adjust, updated_at)
  SELECT gen_random_uuid()::text, r.id, c.material_id, c.opening, c.opening_src, c.received, c.used, c.book, c.returned, c.blocked, c.adjusted, now()
    FROM mes_shift_calc(r.id) c
  ON CONFLICT (report_id, material_id) DO UPDATE SET qty_opening = EXCLUDED.qty_opening, opening_src = EXCLUDED.opening_src,
         qty_received = EXCLUDED.qty_received, qty_used = EXCLUDED.qty_used, qty_book = EXCLUDED.qty_book, qty_returned = EXCLUDED.qty_returned,
         qty_blocked = EXCLUDED.qty_blocked, qty_adjust = EXCLUDED.qty_adjust, updated_at = now();
  UPDATE production_shift_report SET status = 'CLOSED', to_at = clock_timestamp(), closed_by = p->>'actor_id', closed_by_name = p->>'actor_name',
         cum_in = (SELECT COALESCE(jsonb_object_agg(k.material_id, k.qty), '{}'::jsonb) FROM mes_wh_cum_in(r.warehouse_id) k),
         updated_at = now()
   WHERE id = r.id;
  RETURN jsonb_build_object('status', 'CLOSED');
END $function$;

-- ── 7. "Điều chỉnh tồn theo số đếm" — kế hoạch (xem trước) + thực hiện; MỘT hàm kế hoạch cho cả hai ────────────────────────────
-- Chỉ ca đã chốt MỚI NHẤT của kho, chưa điều chỉnh lần nào (phần lệch của ca cũ đã nằm trong số của ca sau — điều chỉnh hai lần là trừ hai lần).
-- Mỗi mã đếm thiếu: xoá các lô chặn có trước lúc chốt, cũ trước, tối đa bằng phần thiếu. Thiếu không có lô chặn / thừa ⇒ không tự làm.
CREATE OR REPLACE FUNCTION public.mes_shift_adjust_plan(p_report_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  r      record;
  v_why  text;
  v_mats jsonb;
BEGIN
  SELECT * INTO r FROM production_shift_report WHERE id = p_report_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy báo cáo ca'; END IF;
  v_why := CASE
    WHEN r.status <> 'CLOSED' THEN 'Ca chưa chốt — chốt ca rồi mới điều chỉnh theo số đếm'
    WHEN r.stock_adjusted_at IS NOT NULL THEN 'Ca này đã điều chỉnh tồn theo số đếm rồi'
    WHEN EXISTS (SELECT 1 FROM production_shift_report x WHERE x.warehouse_id = r.warehouse_id AND x.status = 'CLOSED' AND x.to_at > r.to_at)
      THEN 'Đã có ca chốt sau ca này — phần lệch đã nằm trong số của ca sau, điều chỉnh ở ca chốt mới nhất'
  END;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'material_id', m.id, 'material_code', m.material_code, 'material_name', m.short_name,
           'base_unit', m.base_unit, 'entry_unit', m.entry_unit, 'units_per_carton', m.units_per_carton,
           'book', l.qty_book, 'actual', l.qty_actual, 'diff', l.qty_actual - l.qty_book,
           'write_off', COALESCE(bl.take, 0),
           'unexplained', GREATEST(l.qty_book - l.qty_actual, 0) - COALESCE(bl.take, 0),
           'blocks', COALESCE(bl.blocks, '[]'::jsonb)
         ) ORDER BY m.material_code), '[]'::jsonb)
    INTO v_mats
    FROM production_shift_count l
    JOIN "Material" m ON m.id = l.material_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('block_id', z.id, 'pallet_code', z.pallet_code, 'open', z.open, 'take', z.take, 'reason', z.reason,
                                          'created_at', z.created_at, 'created_by_name', z.created_by_name) ORDER BY z.created_at, z.id) AS blocks,
             sum(z.take) AS take
        FROM (
          SELECT y.*, LEAST(y.open, GREATEST(GREATEST(l.qty_book - l.qty_actual, 0) - (y.cum - y.open), 0)) AS take
            FROM (
              SELECT k.id, k.pallet_code, k.reason, k.created_at, k.created_by_name, k.qty - k.qty_written_off - k.qty_released AS open,
                     sum(k.qty - k.qty_written_off - k.qty_released) OVER (ORDER BY k.created_at, k.id) AS cum
                FROM inventory_block k
               WHERE k.warehouse_id = r.warehouse_id AND k.material_id = l.material_id AND k.qty_written_off + k.qty_released < k.qty
                 AND (r.to_at IS NULL OR k.created_at < r.to_at)
            ) y
        ) z
    ) bl ON true
   WHERE l.report_id = r.id AND l.qty_actual IS NOT NULL AND l.qty_book IS NOT NULL AND l.qty_actual <> l.qty_book;
  RETURN jsonb_build_object('ok', v_why IS NULL, 'reason', v_why, 'materials', v_mats);
END $function$;

-- p: report_id · material_ids (tuỳ chọn — chỉ điều chỉnh các mã này) · actor_id · actor_name
CREATE OR REPLACE FUNCTION public.mes_shift_adjust(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  r       record;
  v_plan  jsonb;
  m       jsonb;
  bk      jsonb;
  v_only  text[];
  v_n     int := 0;
  v_mat   numeric;
BEGIN
  SELECT * INTO r FROM production_shift_report WHERE id = p->>'report_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy báo cáo ca'; END IF;
  -- khoá ĐỘC QUYỀN như chốt ca: không ca nào chốt chen giữa (luật "ca chốt mới nhất") và không lượt cấp nào đổi số giữa chừng
  PERFORM pg_advisory_xact_lock(hashtext('mes_shift:' || r.warehouse_id));
  IF jsonb_typeof(p->'material_ids') = 'array' THEN SELECT array_agg(x) INTO v_only FROM jsonb_array_elements_text(p->'material_ids') x; END IF;
  v_plan := mes_shift_adjust_plan(r.id);
  IF NOT (v_plan->>'ok')::boolean THEN RAISE EXCEPTION 'MESERR:ADJUST_NOT_ALLOWED|%', v_plan->>'reason'; END IF;
  FOR m IN SELECT * FROM jsonb_array_elements(v_plan->'materials') LOOP
    CONTINUE WHEN v_only IS NOT NULL AND NOT (m->>'material_id' = ANY(v_only));
    v_mat := 0;
    FOR bk IN SELECT * FROM jsonb_array_elements(m->'blocks') LOOP
      CONTINUE WHEN (bk->>'take')::numeric <= 0;
      PERFORM mes_block_act(jsonb_build_object('block_id', bk->>'block_id', 'kind', 'WRITE_OFF', 'qty', (bk->>'take')::numeric,
        'note', 'Điều chỉnh theo số đếm ' || r.shift || ' ngày ' || to_char(r.report_date, 'DD-MM-YYYY'),
        'shift_report_id', r.id, 'actor_id', p->>'actor_id', 'actor_name', p->>'actor_name'));
      v_n := v_n + 1; v_mat := v_mat + (bk->>'take')::numeric;
    END LOOP;
    IF v_mat > 0 THEN
      UPDATE production_shift_count SET qty_written_off = v_mat, updated_at = now() WHERE report_id = r.id AND material_id = m->>'material_id';
    END IF;
  END LOOP;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'MESERR:NOTHING_TO_ADJUST|Không có lô chặn nào khớp phần đếm thiếu — phần lệch còn lại điều chỉnh từng lô ở Tồn kho';
  END IF;
  UPDATE production_shift_report SET stock_adjusted_at = clock_timestamp(), stock_adjusted_by = p->>'actor_id',
         stock_adjusted_by_name = p->>'actor_name', updated_at = now() WHERE id = r.id;
  RETURN jsonb_build_object('blocks', v_n);
END $function$;

-- ── 8. Báo cáo ca: thêm đang chặn · điều chỉnh · đã xoá theo số đếm + "ca chốt mới nhất" ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_shift_report(p_report_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  r        record;
  v_rows   jsonb;
  v_batch  jsonb;
  v_latest boolean;
BEGIN
  SELECT * INTO r FROM production_shift_report WHERE id = p_report_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_latest := r.status = 'CLOSED' AND NOT EXISTS (SELECT 1 FROM production_shift_report x
                WHERE x.warehouse_id = r.warehouse_id AND x.status = 'CLOSED' AND x.to_at > r.to_at);
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
             'returned', d.returned, 'blocked', d.blocked, 'adjusted', d.adjusted, 'written_off', d.written_off,
             'by_batch', COALESCE((SELECT jsonb_object_agg(q.batch_id, q.qty) FROM (
                 SELECT c.batch_id, sum(c.qty) AS qty FROM batch_consumption c JOIN production_batch b ON b.id = c.batch_id
                  WHERE b.warehouse_id = r.warehouse_id AND c.material_id = m.id
                    AND (c.reversed_at IS NULL OR (r.to_at IS NOT NULL AND c.reversed_at >= r.to_at))
                    AND c.created_at >= r.from_at AND (r.to_at IS NULL OR c.created_at < r.to_at) GROUP BY c.batch_id) q), '{}'::jsonb)) AS x
      FROM (
        SELECT l.material_id, l.qty_opening AS opening, l.opening_src, l.qty_received AS received, l.qty_used AS used, l.qty_book AS book,
               l.qty_actual AS actual, COALESCE(l.qty_returned, 0) AS returned, COALESCE(l.qty_blocked, 0) AS blocked,
               COALESCE(l.qty_adjust, 0) AS adjusted, COALESCE(l.qty_written_off, 0) AS written_off
          FROM production_shift_count l WHERE r.status = 'CLOSED' AND l.report_id = r.id
        UNION ALL
        SELECT c.material_id, c.opening, c.opening_src, c.received, c.used, c.book,
               (SELECT l.qty_actual FROM production_shift_count l WHERE l.report_id = r.id AND l.material_id = c.material_id), c.returned,
               c.blocked, c.adjusted, 0::numeric
          FROM mes_shift_calc(r.id) c WHERE r.status = 'OPEN'
      ) d JOIN "Material" m ON m.id = d.material_id
  ) s;
  RETURN jsonb_build_object('report', (to_jsonb(r) - 'cum_in') || jsonb_build_object('latest_closed', v_latest), 'batches', v_batch, 'rows', v_rows);
END $function$;

-- ── 9. Sổ chênh lệch tồn (đối chiếu SAP) ──────────────────────────────────────────────────────────────────────────────────
-- p: warehouse_id · date_from · date_to (ngày VN, gồm cả hai đầu) · part summary | events | blocks · material_id (tuỳ chọn) · limit · offset
--   summary — mỗi mã: tồn sổ hiện tại · đang chặn (chưa điều chỉnh) · trong kỳ: chặn / bỏ chặn / xoá hàng chặn / điều chỉnh khác · chênh lệch
--             so sổ SAP trong kỳ = −xoá hàng chặn + điều chỉnh khác (tác động app có mà SAP không có — Cấp / Huỷ cấp SAP nhận qua Dữ liệu thô)
--   events  — từng tác động trong kỳ (mới → cũ, phân trang): BLOCK · RELEASE · WRITE_OFF · ADJUST; effect = phần làm đổi tồn sổ
--   blocks  — hàng đang chặn (mọi thời điểm) của kho để xoá / bỏ chặn
CREATE OR REPLACE FUNCTION public.mes_stock_variance(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_wh    text := p->>'warehouse_id';
  v_from  timestamptz := ((p->>'date_from')::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_to    timestamptz := (((p->>'date_to')::date) + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_mat   text := NULLIF(p->>'material_id', '');
  v_part  text := COALESCE(p->>'part', 'summary');
  v_lim   int := LEAST(GREATEST(COALESCE((p->>'limit')::int, 200), 1), 2000);
  v_off   int := GREATEST(COALESCE((p->>'offset')::int, 0), 0);
  v_out   jsonb;
  v_total bigint;
BEGIN
  IF v_part = 'blocks' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', k.id, 'entry_id', k.entry_id, 'pallet_code', k.pallet_code, 'material_id', m.id, 'material_code', m.material_code,
             'material_name', m.short_name, 'base_unit', m.base_unit, 'entry_unit', m.entry_unit, 'units_per_carton', m.units_per_carton,
             'production_date', e.production_date, 'batch_lot', e.batch, 'qty', k.qty, 'open', k.qty - k.qty_written_off - k.qty_released,
             'written_off', k.qty_written_off, 'released', k.qty_released, 'reason', k.reason, 'source', k.source,
             'batch_id', k.batch_id, 'batch_code', b.batch_code, 'created_at', k.created_at, 'created_by_name', k.created_by_name
           ) ORDER BY k.created_at), '[]'::jsonb) INTO v_out
      FROM inventory_block k JOIN "Material" m ON m.id = k.material_id
      LEFT JOIN "InventoryEntry" e ON e.id = k.entry_id LEFT JOIN production_batch b ON b.id = k.batch_id
     WHERE k.warehouse_id = v_wh AND k.qty_written_off + k.qty_released < k.qty AND (v_mat IS NULL OR k.material_id = v_mat);
    RETURN jsonb_build_object('rows', v_out);
  END IF;

  IF v_part = 'events' THEN
    WITH ev AS (
      SELECT k.created_at AS at, 'BLOCK'::text AS kind, k.material_id, k.pallet_code, k.entry_id, k.qty AS qty, 0::numeric AS effect,
             k.reason AS note, k.created_by_name AS actor, b.batch_code AS ref
        FROM inventory_block k LEFT JOIN production_batch b ON b.id = k.batch_id
       WHERE k.warehouse_id = v_wh AND k.created_at >= v_from AND k.created_at < v_to
      UNION ALL
      SELECT ev.created_at, ev.kind, k.material_id, k.pallet_code, k.entry_id, ev.qty,
             CASE WHEN ev.kind = 'WRITE_OFF' THEN -ev.qty ELSE 0 END,
             COALESCE(ev.note || ' · ', '') || 'chặn vì: ' || k.reason, ev.actor_name,
             (SELECT s.shift || ' ' || to_char(s.report_date, 'DD-MM-YYYY') FROM production_shift_report s WHERE s.id = ev.shift_report_id)
        FROM inventory_block_event ev JOIN inventory_block k ON k.id = ev.block_id
       WHERE ev.warehouse_id = v_wh AND ev.created_at >= v_from AND ev.created_at < v_to
      UNION ALL
      SELECT l.adjusted_at, 'ADJUST', e.material_id, e.pallet_code, e.id, l.delta, l.delta, l.note, l.actor_name, NULL
        FROM "InventoryAdjustmentLog" l JOIN "InventoryEntry" e ON e.id = l.entry_id
       WHERE e.warehouse_id = v_wh AND l.adjusted_at >= v_from AND l.adjusted_at < v_to
    ), f AS (SELECT * FROM ev WHERE ev.material_id IS NOT NULL AND (v_mat IS NULL OR ev.material_id = v_mat))
    SELECT (SELECT count(*) FROM f),
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'at', f.at, 'kind', f.kind, 'material_id', m.id, 'material_code', m.material_code, 'material_name', m.short_name,
             'base_unit', m.base_unit, 'entry_unit', m.entry_unit, 'units_per_carton', m.units_per_carton,
             'pallet_code', f.pallet_code, 'production_date', e.production_date, 'batch_lot', e.batch,
             'qty', f.qty, 'effect', f.effect, 'note', f.note, 'actor', f.actor, 'ref', f.ref) ORDER BY f.at DESC)
             FROM (SELECT * FROM f ORDER BY f.at DESC LIMIT v_lim OFFSET v_off) f
             JOIN "Material" m ON m.id = f.material_id LEFT JOIN "InventoryEntry" e ON e.id = f.entry_id), '[]'::jsonb)
      INTO v_total, v_out;
    RETURN jsonb_build_object('rows', v_out, 'total', v_total);
  END IF;

  -- summary
  WITH book AS (
    SELECT z.mid, sum(z.q) AS q FROM (
      SELECT e.material_id AS mid, COALESCE(e.cartons_remaining, e.cartons_imported, 0) AS q
        FROM "InventoryEntry" e WHERE e.warehouse_id = v_wh AND e.status IN ('IN_STOCK', 'PARTIAL')
      UNION ALL
      SELECT bo.material_id, bo.qty FROM mes_block_open(v_wh) bo
    ) z GROUP BY 1
  ), opn AS (SELECT bo.material_id AS mid, bo.qty AS q FROM mes_block_open(v_wh) bo
  ), blk AS (
    SELECT k.material_id AS mid, sum(k.qty) AS q FROM inventory_block k
     WHERE k.warehouse_id = v_wh AND k.created_at >= v_from AND k.created_at < v_to GROUP BY 1
  ), evs AS (
    SELECT k.material_id AS mid, sum(ev.qty) FILTER (WHERE ev.kind = 'WRITE_OFF') AS wo, sum(ev.qty) FILTER (WHERE ev.kind = 'RELEASE') AS rel
      FROM inventory_block_event ev JOIN inventory_block k ON k.id = ev.block_id
     WHERE ev.warehouse_id = v_wh AND ev.created_at >= v_from AND ev.created_at < v_to GROUP BY 1
  ), adj AS (
    SELECT e.material_id AS mid, sum(l.delta) AS q, count(*) AS n
      FROM "InventoryAdjustmentLog" l JOIN "InventoryEntry" e ON e.id = l.entry_id
     WHERE e.warehouse_id = v_wh AND l.adjusted_at >= v_from AND l.adjusted_at < v_to GROUP BY 1
  ), keys AS (
    SELECT mid FROM opn UNION SELECT mid FROM blk UNION SELECT mid FROM evs UNION SELECT mid FROM adj
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'material_id', m.id, 'material_code', m.material_code, 'material_name', m.short_name,
           'base_unit', m.base_unit, 'entry_unit', m.entry_unit, 'units_per_carton', m.units_per_carton,
           'book', COALESCE(bo.q, 0), 'blocked_open', COALESCE(o.q, 0), 'blocked', COALESCE(bl.q, 0), 'released', COALESCE(ev.rel, 0),
           'written_off', COALESCE(ev.wo, 0), 'adjusted', COALESCE(a.q, 0), 'adjust_count', COALESCE(a.n, 0),
           'variance', COALESCE(a.q, 0) - COALESCE(ev.wo, 0)
         ) ORDER BY m.material_code), '[]'::jsonb) INTO v_out
    FROM keys k JOIN "Material" m ON m.id = k.mid
    LEFT JOIN book bo ON bo.mid = k.mid LEFT JOIN opn o ON o.mid = k.mid LEFT JOIN blk bl ON bl.mid = k.mid
    LEFT JOIN evs ev ON ev.mid = k.mid LEFT JOIN adj a ON a.mid = k.mid
   WHERE k.mid IS NOT NULL AND (v_mat IS NULL OR k.mid = v_mat);
  RETURN jsonb_build_object('rows', v_out);
END $function$;

REVOKE ALL ON FUNCTION public.mes_block_open(text), public.mes_wh_adjust(text, timestamptz, timestamptz),
  public.mes_consume_reverse_line(text, text, numeric, boolean, text, text, text), public.mes_consume_reverse(jsonb), public.mes_batch_cancel(jsonb),
  public.mes_block_act(jsonb), public.mes_shift_save(jsonb), public.mes_shift_adjust_plan(text), public.mes_shift_adjust(jsonb),
  public.mes_shift_report(text), public.mes_stock_variance(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_block_open(text), public.mes_wh_adjust(text, timestamptz, timestamptz),
  public.mes_consume_reverse_line(text, text, numeric, boolean, text, text, text), public.mes_consume_reverse(jsonb), public.mes_batch_cancel(jsonb),
  public.mes_block_act(jsonb), public.mes_shift_save(jsonb), public.mes_shift_adjust_plan(text), public.mes_shift_adjust(jsonb),
  public.mes_shift_report(text), public.mes_stock_variance(jsonb) TO service_role;

-- ── 10. Sổ pallet: thêm chặn / bỏ chặn / xoá hàng chặn (hàng thật sự bị động vào — nhóm STOCK) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.pallet_ledger(p_pallet_code text, p_warehouse_ids text[] DEFAULT NULL::text[], p_limit integer DEFAULT 400)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_events jsonb;
  v_pallet jsonb;
BEGIN
  WITH ev AS (
    -- 1. SX GHI SỔ ĐÓNG GÓI — pallet ra đời
    SELECT COALESCE(pl.close_scan_at, pl.open_scan_at, pl.created_at) AS at,
           'PACKED'::text            AS kind,
           pl.packed_by_name         AS actor,
           NULL::text                AS from_code,
           NULL::text                AS to_code,
           pl.qty_cartons            AS qty_base,   -- cột tên "cartons" nhưng GIÁ TRỊ là base (xem đầu file)
           NULL::numeric             AS qty_cartons, -- giữ ô này rỗng: không nguồn nào ghi theo thùng
           pl.warehouse_id           AS warehouse_id,
           NULLIF(pl.machine_code,'') AS ref,
           pl.note                   AS note
      FROM public.packing_logs pl
     WHERE pl.pallet_code = p_pallet_code AND pl.status <> 'CANCELLED'

    UNION ALL
    -- 2. VÀO SỔ TỒN (nhập kho / tách ra pallet con / NHẬN HÀNG TRẢ VỀ — 26/10) — dòng InventoryEntry được tạo
    SELECT ie.created_at,
           CASE WHEN pi.source_type = 'RETURN' THEN 'RETURNED' ELSE 'RECEIVED' END,
           emp.name,
           NULL, loc.location_code, ie.cartons_imported, NULL,
           ie.warehouse_id,
           CASE WHEN ie.parent_pallet_code IS NOT NULL THEN 'tách từ ' || ie.parent_pallet_code
                WHEN pi.source_type = 'RETURN' THEN COALESCE('chuyến ' || r.group_code, r.return_code) END,
           CASE WHEN pi.source_type = 'RETURN' THEN r.reason END
      FROM public."InventoryEntry" ie
      LEFT JOIN public."Location" loc ON loc.id = ie.location_id
      LEFT JOIN public."Employee" emp ON emp.id = ie.created_by
      LEFT JOIN public."ProductionImport" pi ON pi.id = ie.import_order_id
      LEFT JOIN public.inbound_return r ON r.id = pi.return_id
     WHERE ie.pallet_code = p_pallet_code

    UNION ALL
    -- 3. CHUYỂN VỊ TRÍ / KIỂM KÊ — một sổ, phân biệt bằng location_changed_to
    SELECT sl.counted_at,
           CASE WHEN sl.location_changed_to IS NOT NULL THEN 'MOVED' ELSE 'COUNTED' END,
           sl.counted_by_name, sl.location_from_code, sl.location_code,
           sl.physical_qty, NULL, sl.warehouse_id, NULL, sl.note
      FROM public."StocktakeLog" sl
     WHERE sl.pallet_code = p_pallet_code
       -- KHÔNG KỂ HAI LẦN MỘT VIỆC (18/09): bỏ dòng MOVED nào đã có vết quét fill khớp (nguồn 6 kể giàu hơn)
       AND NOT (
         sl.location_changed_to IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public."FillTaskScan" fs
            WHERE fs.pallet_code     = sl.pallet_code
              AND fs.to_location_id  = sl.location_changed_to
              AND fs.created_at BETWEEN sl.counted_at - interval '2 minutes'
                                    AND sl.counted_at + interval '2 minutes'
         )
       )

    UNION ALL
    -- 4. ĐIỀU CHỈNH TỒN (+/-)
    SELECT al.adjusted_at, 'ADJUSTED', al.actor_name, NULL, NULL,
           al.delta, NULL, ie.warehouse_id,
           ie.cartons_remaining::text, al.note
      FROM public."InventoryAdjustmentLog" al
      JOIN public."InventoryEntry" ie ON ie.id = al.entry_id
     WHERE ie.pallet_code = p_pallet_code

    UNION ALL
    -- 5. DỒN / TÁCH PALLET — tem có thể là NGUỒN hoặc ĐÍCH của thao tác
    SELECT po.created_at,
           CASE WHEN po.type = 'MERGE' THEN 'MERGED'
                WHEN po.type = 'SPLIT' THEN 'SPLIT'
                ELSE 'UNGROUPED' END,
           po.operated_by_name, NULL, NULL, NULL, NULL, po.warehouse_id,
           NULL,
           CASE WHEN p_pallet_code = ANY(po.source_codes) THEN 'tem này là NGUỒN'
                ELSE 'tem này là KẾT QUẢ' END
      FROM public."PalletOperation" po
     WHERE (po.source_codes @> ARRAY[p_pallet_code] OR po.target_codes @> ARRAY[p_pallet_code])
       AND po.undone_at IS NULL

    UNION ALL
    -- 5b. …và lần HOÀN TÁC thao tác đó (nếu có) là một tác động riêng
    SELECT po.undone_at, 'UNDONE', po.undone_by_name, NULL, NULL, NULL, NULL, po.warehouse_id,
           NULL, 'hoàn tác ' || po.type
      FROM public."PalletOperation" po
     WHERE (po.source_codes @> ARRAY[p_pallet_code] OR po.target_codes @> ARRAY[p_pallet_code])
       AND po.undone_at IS NOT NULL

    UNION ALL
    -- 6. HẠ XUỐNG KHO LẺ (quét lệnh fill)
    SELECT fs.created_at, 'FILLED', fs.scanned_by_name,
           fs.from_location_code, fs.to_location_code, fs.qty_base, NULL,
           loc.warehouse_id, fo.order_code, NULL
      FROM public."FillTaskScan" fs
      LEFT JOIN public."Location"  loc ON loc.id = fs.to_location_id
      LEFT JOIN public."FillOrder" fo  ON fo.id  = fs.fill_order_id
     WHERE fs.pallet_code = p_pallet_code

    UNION ALL
    -- 7. XUẤT HÀNG (quét tem ở cửa) — chứng từ = Số xe của chuyến
    SELECT ose.scanned_at AT TIME ZONE 'UTC', 'PICKED', emp.name, NULL, NULL,
           ose.cartons_scanned, NULL, g.warehouse_id,
           COALESCE(g.group_code, g.license_plate),
           CASE WHEN ose.is_loose_picking THEN 'nhặt lẻ' END
      FROM public."OutboundScanEntry" ose
      LEFT JOIN public."Employee"          emp ON emp.id = ose.scanned_by
      LEFT JOIN public."OutboundItem"      oi  ON oi.id  = ose.item_id
      LEFT JOIN public."OutboundDelivery"  od  ON od.id  = oi.do_id
      LEFT JOIN public."GroupDeliveryOrder" g  ON g.id   = od.gdo_id
     WHERE ose.pallet_code = p_pallet_code

    UNION ALL
    -- 8. NHẬT KÝ VIỆC (Việc cần làm) — giao việc, nhận, hạ, đưa ra, hệ thống huỷ.
    SELECT e.at, 'TASK_' || e.event, e.actor,
           t.from_location_code, COALESCE(dl.location_code, tl.location_code),
           NULL, NULL, t.warehouse_id,
           COALESCE(g.group_code, g.license_plate), e.note
      FROM public.wms_task_events e
      JOIN public.wms_tasks t ON t.id = e.task_id
      LEFT JOIN public."Location" dl ON dl.id = t.drop_location_id
      LEFT JOIN public."Location" tl ON tl.id = t.to_location_id
      LEFT JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
     WHERE t.pallet_code = p_pallet_code

    UNION ALL
    -- 9. HÀNG LẺ CỦA TEM NÀY QUAY VỀ thành tem con ".N" (26/10, sổ nhận trả). Cộng dồn vào chính tem này đã có dòng
    --    ĐIỀU CHỈNH (nguồn 4) ⇒ chỉ kể lần nhận vào tem KHÁC.
    SELECT rs.created_at, 'RETURNED', emp.name, NULL, loc.location_code,
           rs.qty_base, NULL, r.warehouse_id,
           COALESCE('chuyến ' || r.group_code, r.return_code),
           'vào tem con ' || ie.pallet_code
      FROM public.inbound_return_scan rs
      JOIN public.inbound_return r ON r.id = rs.return_id
      JOIN public."InventoryEntry" ie ON ie.id = rs.entry_id
      LEFT JOIN public."Location" loc ON loc.id = ie.location_id
      LEFT JOIN public."Employee" emp ON emp.id = rs.created_by
     WHERE rs.source_pallet_code = p_pallet_code AND NOT rs.merged AND ie.pallet_code <> p_pallet_code

    UNION ALL
    -- 10. RÚT VÀO MẺ CHẾ BIẾN (MES 14/11) — mỗi dòng sổ tiêu hao; lần huỷ dòng rút (hoàn tồn) là một tác động riêng
    SELECT bc.created_at, 'CONSUMED', bc.created_by_name, NULL, NULL,
           bc.qty, NULL, b.warehouse_id, b.batch_code,
           CASE WHEN bc.source = 'LOT' THEN 'rút theo lô (không quét tem)' END
      FROM public.batch_consumption bc
      JOIN public.production_batch b ON b.id = bc.batch_id
     WHERE bc.pallet_code = p_pallet_code

    UNION ALL
    SELECT bc.reversed_at, 'CONSUME_REVERSED', bc.reversed_by_name, NULL, NULL,
           bc.qty, NULL, b.warehouse_id, b.batch_code, bc.reverse_reason
      FROM public.batch_consumption bc
      JOIN public.production_batch b ON b.id = bc.batch_id
     WHERE bc.pallet_code = p_pallet_code AND bc.reversed_at IS NOT NULL

    UNION ALL
    -- 11. HÀNG CHẶN (25/11 — huỷ cấp mà phần NVL không tái dùng được): chặn đúng tem · bỏ chặn (trả về dùng được) · xoá khỏi tồn (điều chỉnh)
    SELECT k.created_at, 'BLOCKED', k.created_by_name, NULL, NULL, k.qty, NULL, k.warehouse_id, b.batch_code, k.reason
      FROM public.inventory_block k LEFT JOIN public.production_batch b ON b.id = k.batch_id
     WHERE k.pallet_code = p_pallet_code

    UNION ALL
    SELECT ev.created_at, CASE ev.kind WHEN 'RELEASE' THEN 'BLOCK_RELEASED' ELSE 'BLOCK_WRITTEN_OFF' END, ev.actor_name, NULL, NULL,
           ev.qty, NULL, ev.warehouse_id, NULL, COALESCE(ev.note || ' · ', '') || 'chặn vì: ' || k.reason
      FROM public.inventory_block_event ev JOIN public.inventory_block k ON k.id = ev.block_id
     WHERE k.pallet_code = p_pallet_code
  )
  -- HAI NHÓM, KHÔNG TRỘN: `grp='STOCK'` = hàng thật sự bị động vào; `grp='TASK'` = việc được giao/nhận/huỷ.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'grp', CASE WHEN x.kind LIKE 'TASK\_%' THEN 'TASK' ELSE 'STOCK' END,
           'at', x.at, 'kind', x.kind, 'actor', x.actor,
           'from_code', x.from_code, 'to_code', x.to_code,
           'qty_base', x.qty_base, 'qty_cartons', x.qty_cartons,
           'warehouse_id', x.warehouse_id, 'ref', x.ref, 'note', x.note
         ) ORDER BY x.at), '[]'::jsonb)
    INTO v_events
    FROM (
      -- Trần áp cho TỪNG NHÓM, không áp cho cả danh sách
      SELECT * FROM (
        SELECT ev.*,
               row_number() OVER (
                 PARTITION BY (CASE WHEN ev.kind LIKE 'TASK\_%' THEN 'TASK' ELSE 'STOCK' END)
                 ORDER BY ev.at DESC
               ) AS rn
          FROM ev
         WHERE ev.at IS NOT NULL
           AND (p_warehouse_ids IS NULL OR ev.warehouse_id IS NULL OR ev.warehouse_id = ANY(p_warehouse_ids))
      ) z
      WHERE z.rn <= GREATEST(1, LEAST(p_limit, 2000))
    ) x;

  -- Ảnh hiện tại của tem (có thể nhiều dòng nếu tem từng được dùng lại sau khi xuất hết)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'entry_id', ie.id, 'status', ie.status, 'warehouse_id', ie.warehouse_id,
           'warehouse_name', w.name, 'location_code', loc.location_code,
           'material_code', m.material_code, 'material_name', m.short_name, 'category', m.category,
           'entry_unit', m.entry_unit, 'base_unit', m.base_unit, 'units_per_carton', m.units_per_carton,
           'cartons_imported', ie.cartons_imported, 'cartons_remaining', ie.cartons_remaining,
           'production_date', ie.production_date, 'expiry_date', ie.expiry_date, 'batch', ie.batch,
           'import_date', ie.import_date
         ) ORDER BY ie.created_at), '[]'::jsonb)
    INTO v_pallet
    FROM public."InventoryEntry" ie
    LEFT JOIN public."Location"  loc ON loc.id = ie.location_id
    LEFT JOIN public."Warehouse" w   ON w.id   = ie.warehouse_id
    LEFT JOIN public."Material"  m   ON m.id   = ie.material_id
   WHERE ie.pallet_code = p_pallet_code
     AND (p_warehouse_ids IS NULL OR ie.warehouse_id IS NULL OR ie.warehouse_id = ANY(p_warehouse_ids));

  RETURN jsonb_build_object('pallet_code', p_pallet_code, 'entries', v_pallet, 'events', v_events);
END $function$;
REVOKE ALL ON FUNCTION public.pallet_ledger(text, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pallet_ledger(text, text[], integer) TO service_role;

-- ── Lưới tự kiểm (dữ liệu giả, rollback) ────────────────────────────────────────────────────────────────────────────────
-- cấp 10 → huỷ cấp chặn 4 (tồn 46 dùng được + 4 chặn) · chặn quá lượng cấp ⇒ BLOCK_QTY · cấp 5 → huỷ mẻ thiếu dòng ⇒ LINES_CHANGED ·
-- huỷ mẻ chặn 5 ⇒ mẻ Huỷ, tồn 41, chặn mở 9 · chốt ca đếm 41 ⇒ sổ 50 (gồm chặn 9), lệch −9 · kế hoạch xoá 9 · điều chỉnh ⇒ chặn mở 0, tồn 41 ·
-- điều chỉnh lần hai ⇒ ADJUST_NOT_ALLOWED · bỏ chặn 2 của lô chặn mới ⇒ tồn +2 · sổ chênh lệch: xoá 9 ⇒ chênh −9
DO $$
DECLARE v_wh text; m1 text; v_u text; rm text; b1 jsonb; b2 jsonb; v_c text; v_c2 text; v_c3 text; v_err text; v_rem numeric; v_blk numeric;
        v_plan jsonb; v_cnt record; v_st text; v_bid text; v_var jsonb; v_book numeric;
BEGIN
  SELECT w.id INTO v_wh FROM "Warehouse" w WHERE w.parent_warehouse_id IS NOT NULL AND coalesce(mes_plant_letter(w.id), '') <> '' ORDER BY w.id LIMIT 1;
  SELECT id, upper(coalesce(base_unit, '')) INTO m1, v_u FROM "Material" WHERE is_semi_finished AND upper(coalesce(base_unit, '')) IN ('L', 'KG') ORDER BY id LIMIT 1;
  SELECT id INTO rm FROM "Material" x WHERE NOT coalesce(x.is_semi_finished, false) AND x.entry_unit IS NULL
     AND NOT EXISTS (SELECT 1 FROM inventory_block k WHERE k.material_id = x.id) ORDER BY x.id LIMIT 1;
  IF v_wh IS NULL OR m1 IS NULL OR rm IS NULL THEN RAISE NOTICE 'tự kiểm hàng chặn: thiếu kho phụ / mã — bỏ qua'; RETURN; END IF;
  BEGIN
    UPDATE production_shift_report SET status = 'CLOSED', to_at = coalesce(to_at, now() - interval '2 hours') WHERE warehouse_id = v_wh AND status = 'OPEN';
    UPDATE "Warehouse" SET mes_flow_gate = false, mes_block_reverse_closed = false WHERE id = v_wh;
    -- mã NVL thử không được có hàng chặn / tồn khác trong kho (bảng mới — lượt đầu luôn rỗng; chạy lại trên DB có dữ liệu thì lọc theo tem)
    INSERT INTO production_tank (id, warehouse_id, code, capacity, unit, updated_at) VALUES ('QAW8_T', v_wh, 'QAW8T', 1000, v_u, now());
    b1 := mes_batch_create(jsonb_build_object('warehouse_id', v_wh, 'material_id', m1, 'prod_date', current_date, 'cycle', 'QW8', 'tank_id', 'QAW8_T', 'shift', 'Ca 1'));
    INSERT INTO "InventoryEntry" (id, pallet_code, material_id, warehouse_id, cartons_imported, cartons_remaining, cartons_reserved, status, updated_at)
    VALUES ('QAW8_E', 'QAW8TEM', rm, v_wh, 50, 50, 0, 'IN_STOCK', now());
    INSERT INTO production_shift_report (id, warehouse_id, report_date, shift, from_at, status, updated_at)
    VALUES ('QAW8_S1', v_wh, current_date, 'QA Ca 8', clock_timestamp() - interval '1 minute', 'OPEN', now());
    PERFORM mes_consume_scan(jsonb_build_object('batch_id', b1->>'id', 'entry_id', 'QAW8_E', 'qty', 10));
    SELECT id INTO v_c FROM batch_consumption WHERE batch_id = b1->>'id';
    -- (1) huỷ cấp 10, chặn 4 ⇒ tồn 46 dùng được, 4 chặn đúng tem
    PERFORM mes_consume_reverse(jsonb_build_object('consumption_id', v_c, 'reason', 'tự kiểm', 'qty_block', 4));
    SELECT cartons_remaining INTO v_rem FROM "InventoryEntry" WHERE id = 'QAW8_E';
    SELECT sum(qty) INTO v_blk FROM inventory_block WHERE entry_id = 'QAW8_E' AND qty_written_off + qty_released < qty;
    IF v_rem IS DISTINCT FROM 46 OR v_blk IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'B1: huỷ cấp 10 chặn 4 phải ra tồn 46 + chặn 4, nhận % + %', v_rem, v_blk; END IF;
    -- (2) chặn quá lượng cấp
    PERFORM mes_consume_scan(jsonb_build_object('batch_id', b1->>'id', 'entry_id', 'QAW8_E', 'qty', 5));
    SELECT id INTO v_c2 FROM batch_consumption WHERE batch_id = b1->>'id' AND reversed_at IS NULL;
    v_err := NULL;
    BEGIN PERFORM mes_consume_reverse(jsonb_build_object('consumption_id', v_c2, 'reason', 'tự kiểm', 'qty_block', 6));
    EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR v_err NOT LIKE 'MESERR:BLOCK_QTY%' THEN RAISE EXCEPTION 'B2: chặn 6 > cấp 5 phải BLOCK_QTY, nhận %', coalesce(v_err, 'không lỗi'); END IF;
    -- (3) huỷ mẻ với danh sách dòng cũ ⇒ LINES_CHANGED; đúng danh sách, chặn hết 5 ⇒ mẻ Huỷ, tồn 41, chặn mở 9
    v_err := NULL;
    BEGIN PERFORM mes_batch_cancel(jsonb_build_object('batch_id', b1->>'id', 'reason', 'mẻ hỏng', 'lines', '[]'::jsonb));
    EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR v_err NOT LIKE 'MESERR:LINES_CHANGED%' THEN RAISE EXCEPTION 'B3: huỷ mẻ thiếu dòng phải LINES_CHANGED, nhận %', coalesce(v_err, 'không lỗi'); END IF;
    PERFORM mes_batch_cancel(jsonb_build_object('batch_id', b1->>'id', 'reason', 'mẻ hỏng', 'lines',
      jsonb_build_array(jsonb_build_object('consumption_id', v_c2, 'qty_block', 5))));
    SELECT status INTO v_st FROM production_batch WHERE id = b1->>'id';
    SELECT cartons_remaining INTO v_rem FROM "InventoryEntry" WHERE id = 'QAW8_E';
    SELECT sum(qty - qty_written_off - qty_released) INTO v_blk FROM inventory_block WHERE entry_id = 'QAW8_E' AND qty_written_off + qty_released < qty;
    IF v_st <> 'CANCELLED' OR v_rem IS DISTINCT FROM 41 OR v_blk IS DISTINCT FROM 9 THEN
      RAISE EXCEPTION 'B3: huỷ mẻ chặn 5 phải ra mẻ CANCELLED, tồn 41, chặn 9 — nhận %, %, %', v_st, v_rem, v_blk;
    END IF;
    -- (4) chốt ca đếm = sổ − 9 (sổ gồm chặn 9); kế hoạch xoá đúng 9; điều chỉnh ⇒ chặn mở 0, tồn dùng được vẫn 41
    SELECT c.book INTO v_book FROM mes_shift_calc('QAW8_S1') c WHERE c.material_id = rm;
    PERFORM mes_shift_save(jsonb_build_object('report_id', 'QAW8_S1', 'items', jsonb_build_array(jsonb_build_object('material_id', rm, 'qty_actual', v_book - 9)), 'close', true));
    SELECT qty_book, qty_blocked, qty_actual INTO v_cnt FROM production_shift_count WHERE report_id = 'QAW8_S1' AND material_id = rm;
    IF v_cnt.qty_blocked IS DISTINCT FROM 9::numeric OR v_cnt.qty_book - v_cnt.qty_actual IS DISTINCT FROM 9::numeric THEN
      RAISE EXCEPTION 'B4: sổ lúc chốt phải gồm chặn 9 và lệch 9, nhận chặn % sổ % đếm %', v_cnt.qty_blocked, v_cnt.qty_book, v_cnt.qty_actual;
    END IF;
    v_plan := mes_shift_adjust_plan('QAW8_S1');
    IF NOT (v_plan->>'ok')::boolean OR (SELECT (x->>'write_off')::numeric FROM jsonb_array_elements(v_plan->'materials') x WHERE x->>'material_id' = rm) IS DISTINCT FROM 9 THEN
      RAISE EXCEPTION 'B4: kế hoạch điều chỉnh phải xoá 9, nhận %', v_plan;
    END IF;
    PERFORM mes_shift_adjust(jsonb_build_object('report_id', 'QAW8_S1', 'material_ids', jsonb_build_array(rm)));
    SELECT cartons_remaining INTO v_rem FROM "InventoryEntry" WHERE id = 'QAW8_E';
    SELECT COALESCE(sum(qty - qty_written_off - qty_released), 0) INTO v_blk FROM inventory_block WHERE entry_id = 'QAW8_E';
    IF v_rem IS DISTINCT FROM 41 OR v_blk IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'B4: sau điều chỉnh phải tồn 41, chặn 0 — nhận %, %', v_rem, v_blk; END IF;
    v_err := NULL;
    BEGIN PERFORM mes_shift_adjust(jsonb_build_object('report_id', 'QAW8_S1'));
    EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
    IF v_err IS NULL OR v_err NOT LIKE 'MESERR:ADJUST_NOT_ALLOWED%' THEN RAISE EXCEPTION 'B5: điều chỉnh lần hai phải bị chặn, nhận %', coalesce(v_err, 'không lỗi'); END IF;
    -- (6) mẻ mới: cấp 3, huỷ cấp chặn 3, bỏ chặn 2 ⇒ tồn 41 − 3 + 0 + 2 = 40; còn chặn 1
    b2 := mes_batch_create(jsonb_build_object('warehouse_id', v_wh, 'material_id', m1, 'prod_date', current_date, 'cycle', 'QW8', 'tank_id', 'QAW8_T', 'shift', 'Ca 1'));
    PERFORM mes_consume_scan(jsonb_build_object('batch_id', b2->>'id', 'entry_id', 'QAW8_E', 'qty', 3));
    SELECT id INTO v_c3 FROM batch_consumption WHERE batch_id = b2->>'id';
    PERFORM mes_consume_reverse(jsonb_build_object('consumption_id', v_c3, 'reason', 'tự kiểm', 'qty_block', 3));
    SELECT id INTO v_bid FROM inventory_block WHERE consumption_id = v_c3;
    PERFORM mes_block_act(jsonb_build_object('block_id', v_bid, 'kind', 'RELEASE', 'qty', 2));
    SELECT cartons_remaining INTO v_rem FROM "InventoryEntry" WHERE id = 'QAW8_E';
    SELECT qty - qty_written_off - qty_released INTO v_blk FROM inventory_block WHERE id = v_bid;
    IF v_rem IS DISTINCT FROM 40 OR v_blk IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'B6: bỏ chặn 2 phải ra tồn 40, còn chặn 1 — nhận %, %', v_rem, v_blk; END IF;
    -- (7) sổ chênh lệch hôm nay: mã thử có xoá 9 ⇒ chênh −9, đang chặn 1
    v_var := mes_stock_variance(jsonb_build_object('warehouse_id', v_wh, 'date_from', to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD'),
               'date_to', to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD'), 'material_id', rm));
    IF (v_var->'rows'->0->>'written_off')::numeric IS DISTINCT FROM 9 OR (v_var->'rows'->0->>'blocked_open')::numeric IS DISTINCT FROM 1
       OR (v_var->'rows'->0->>'variance')::numeric IS DISTINCT FROM (-9 + COALESCE((v_var->'rows'->0->>'adjusted')::numeric, 0)) THEN
      RAISE EXCEPTION 'B7: sổ chênh lệch phải ra xoá 9, đang chặn 1, chênh = điều chỉnh khác − 9 — nhận %', v_var;
    END IF;
    RAISE EXCEPTION 'SELFTEST_OK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'SELFTEST_OK' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'tự kiểm hàng chặn (huỷ cấp / huỷ mẻ chặn đúng lô · điều chỉnh theo số đếm · bỏ chặn · sổ chênh lệch): OK';
END $$;

COMMIT;
