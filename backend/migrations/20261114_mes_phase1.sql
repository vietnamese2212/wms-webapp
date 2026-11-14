-- ============================================================================
-- 20261114 — MES GIAI ĐOẠN 1: nối lô + tồn theo bồn (kế hoạch docs/plans/MES_PHASE1_PLAN.md, user chốt 14/11)
-- ============================================================================
-- Nhà máy sữa: NVL → MẺ chế biến → bán thành phẩm (BTP) trong BỒN → Sổ đóng gói → pallet thành phẩm.
--   • Kho chế biến = KHO PHỤ NỘI BỘ đã có (Warehouse.parent_warehouse_id, 10/07) — không thêm loại kho.
--   • production_batch   — mẻ / lô BTP (tạo tay trong app; mã lô app gợi ý, sửa được)
--   • batch_consumption  — SỔ TIÊU HAO: mỗi lần rút NVL vào mẻ trừ dòng tồn nào, bao nhiêu (quét tem / chọn lô)
--   • production_tank    — danh mục bồn của kho chế biến (sức chứa, đơn vị = base của mã BTP)
--   • tank_lot           — TỒN TRONG BỒN theo mẻ (nhiều mẻ chung một bồn được, cùng một mã BTP)
--   • tank_movement      — sổ bồn: nạp · rút cho trang sổ đóng gói · chuyển bồn · điều chỉnh · xả bỏ
-- Mọi lệnh ghi chạm ≥ 2 bảng = MỘT hàm (khoá dòng) — luật C97. Lỗi nghiệp vụ ném 'MESERR:<MÃ>|<câu>'.
-- Chuỗi truy xuất lô ⇒ KHÔNG đăng ký lưu trữ / xoá theo hạn (luật dataArchive).
-- Không policy / GRANT cho anon/authenticated; realtime tự gắn trigger khi CREATE TABLE.
-- ============================================================================
BEGIN;

-- ── 1. Bảng ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.production_tank (
  id            text PRIMARY KEY,
  warehouse_id  text NOT NULL REFERENCES public."Warehouse"(id),
  code          text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,19}$'),
  name          text CHECK (name IS NULL OR length(name) <= 100),
  capacity      numeric NOT NULL CHECK (capacity > 0 AND capacity <= 10000000),
  unit          text NOT NULL CHECK (unit IN ('L', 'KG')),
  is_active     boolean NOT NULL DEFAULT true,
  note          text CHECK (note IS NULL OR length(note) <= 500),
  created_by    text,
  updated_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL,
  UNIQUE (warehouse_id, code)
);
ALTER TABLE public.production_tank ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.production_batch (
  id              text PRIMARY KEY,
  warehouse_id    text NOT NULL REFERENCES public."Warehouse"(id),
  batch_code      text NOT NULL CHECK (batch_code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  material_id     text NOT NULL REFERENCES public."Material"(id),
  machine_code    text CHECK (machine_code IS NULL OR length(machine_code) <= 20),
  shift           text CHECK (shift IS NULL OR length(shift) <= 40),
  prod_date       date NOT NULL,
  planned_qty     numeric CHECK (planned_qty IS NULL OR (planned_qty > 0 AND planned_qty <= 10000000)),
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'CANCELLED')),
  qa_status       text NOT NULL DEFAULT 'HOLD' CHECK (qa_status IN ('HOLD', 'RELEASED', 'REJECTED')),
  qa_by           text,
  qa_by_name      text,
  qa_at           timestamptz,
  qa_note         text CHECK (qa_note IS NULL OR length(qa_note) <= 500),
  note            text CHECK (note IS NULL OR length(note) <= 500),
  opened_by       text,
  opened_by_name  text,
  closed_by       text,
  closed_by_name  text,
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL,
  UNIQUE (warehouse_id, batch_code)
);
CREATE INDEX IF NOT EXISTS idx_prod_batch_wh_date ON public.production_batch (warehouse_id, prod_date DESC, batch_code);
CREATE INDEX IF NOT EXISTS idx_prod_batch_material ON public.production_batch (material_id);
ALTER TABLE public.production_batch ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.batch_consumption (
  id               text PRIMARY KEY,
  batch_id         text NOT NULL REFERENCES public.production_batch(id),
  entry_id         text NOT NULL REFERENCES public."InventoryEntry"(id),   -- RESTRICT: dòng tồn đã vào mẻ không được xoá (chuỗi truy xuất)
  pallet_code      text NOT NULL,
  material_id      text NOT NULL REFERENCES public."Material"(id),
  production_date  date,
  batch_lot        text,            -- InventoryEntry.batch (mã lô tem V2) lúc rút
  ncc_id           uuid,
  qty              numeric NOT NULL CHECK (qty > 0),
  source           text NOT NULL CHECK (source IN ('SCAN', 'LOT')),
  created_by       text,
  created_by_name  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL,
  reversed_at      timestamptz,
  reversed_by      text,
  reversed_by_name text,
  reverse_reason   text CHECK (reverse_reason IS NULL OR length(reverse_reason) <= 500)
);
CREATE INDEX IF NOT EXISTS idx_batch_cons_batch  ON public.batch_consumption (batch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_batch_cons_pallet ON public.batch_consumption (pallet_code);
CREATE INDEX IF NOT EXISTS idx_batch_cons_entry  ON public.batch_consumption (entry_id);
ALTER TABLE public.batch_consumption ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.tank_lot (
  id             text PRIMARY KEY,
  tank_id        text NOT NULL REFERENCES public.production_tank(id),
  batch_id       text NOT NULL REFERENCES public.production_batch(id),
  qty_in         numeric NOT NULL CHECK (qty_in >= 0),
  qty_remaining  numeric NOT NULL CHECK (qty_remaining >= 0),
  filled_at      timestamptz NOT NULL,
  expires_at     timestamptz,
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EMPTY')),
  emptied_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL
);
-- một mẻ chỉ có MỘT lô đang sống trong một bồn (nạp thêm = cộng vào lô đó)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tank_lot_active ON public.tank_lot (tank_id, batch_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_tank_lot_batch ON public.tank_lot (batch_id);
ALTER TABLE public.tank_lot ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.tank_movement (
  id               text PRIMARY KEY,
  tank_id          text NOT NULL REFERENCES public.production_tank(id),
  tank_lot_id      text REFERENCES public.tank_lot(id),
  batch_id         text REFERENCES public.production_batch(id),
  kind             text NOT NULL CHECK (kind IN ('FILL', 'DRAW', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUST', 'DISCARD')),
  qty              numeric NOT NULL CHECK (qty <> 0),      -- có dấu: + vào bồn · − ra bồn
  packing_run_id   uuid REFERENCES public.packing_runs(id) ON DELETE SET NULL,
  ref_tank_id      text REFERENCES public.production_tank(id),
  reason           text CHECK (reason IS NULL OR length(reason) <= 500),
  warning          text,                                    -- cảnh báo đã hiện lúc rút (QA chưa thả · quá hạn lưu) — giữ vết
  created_by       text,
  created_by_name  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tank_mv_tank  ON public.tank_movement (tank_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tank_mv_batch ON public.tank_movement (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tank_mv_run   ON public.tank_movement (packing_run_id) WHERE packing_run_id IS NOT NULL;
ALTER TABLE public.tank_movement ENABLE ROW LEVEL SECURITY;

-- ── 2. Cột thêm ─────────────────────────────────────────────────────────────────────────────────
-- Hạn lưu bồn (giờ) của mã BTP — null = không giới hạn. Quá hạn CHỈ CẢNH BÁO (user chốt 14/11).
ALTER TABLE public."Material" ADD COLUMN IF NOT EXISTS tank_hold_hours integer
  CHECK (tank_hold_hours IS NULL OR tank_hold_hours BETWEEN 1 AND 8760);
-- Trang sổ đóng gói rút từ bồn nào (tuỳ chọn)
ALTER TABLE public.packing_runs ADD COLUMN IF NOT EXISTS tank_id text REFERENCES public.production_tank(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_packing_runs_tank ON public.packing_runs (tank_id) WHERE tank_id IS NOT NULL;
-- Công tắc 2 tầng: rút BTP chưa QA thả — OFF (im) · WARN (cảnh báo, mặc định — user chốt 14/11) · BLOCK (chặn)
ALTER TABLE public."Warehouse" ADD COLUMN IF NOT EXISTS production_qa_gate text NOT NULL DEFAULT 'WARN'
  CHECK (production_qa_gate IN ('OFF', 'WARN', 'BLOCK'));
ALTER TABLE public.warehouse_type_configs ADD COLUMN IF NOT EXISTS production_qa_gate text
  CHECK (production_qa_gate IS NULL OR production_qa_gate IN ('OFF', 'WARN', 'BLOCK'));

-- ── 3. Hàm ──────────────────────────────────────────────────────────────────────────────────────
-- Bậc thang trạng thái dòng tồn — y hệt outbound_consume_exact.
CREATE OR REPLACE FUNCTION public.mes_entry_status(p_remaining numeric, p_imported numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_remaining <= 0 THEN 'EXPORTED' WHEN p_remaining < p_imported THEN 'PARTIAL' ELSE 'IN_STOCK' END
$$;

-- Mẻ phải ĐANG MỞ mới rút / huỷ rút được. Trả kho của mẻ.
CREATE OR REPLACE FUNCTION public.mes_open_batch_wh(p_batch_id text)
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_wh text; v_status text;
BEGIN
  SELECT warehouse_id, status INTO v_wh, v_status FROM production_batch WHERE id = p_batch_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF v_status <> 'OPEN' THEN RAISE EXCEPTION 'MESERR:BATCH_NOT_OPEN|Mẻ đang ở trạng thái % — mở lại mẻ trước khi rút / huỷ rút', v_status; END IF;
  RETURN v_wh;
END $$;

-- 3a. RÚT NVL VÀO MẺ theo TEM (một dòng tồn) — p: {batch_id, entry_id, qty, actor_id, actor_name}
CREATE OR REPLACE FUNCTION public.mes_consume_scan(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_wh   text := mes_open_batch_wh(p->>'batch_id');
  v_qty  numeric := (p->>'qty')::numeric;
  e      record;
  v_new  numeric;
  v_id   text := gen_random_uuid()::text;
BEGIN
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Số lượng rút phải lớn hơn 0'; END IF;
  SELECT * INTO e FROM "InventoryEntry" WHERE id = p->>'entry_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy dòng tồn'; END IF;
  IF e.warehouse_id IS DISTINCT FROM v_wh THEN
    RAISE EXCEPTION 'MESERR:WRONG_WAREHOUSE|Tem % không nằm trong kho của mẻ — chuyển hàng sang kho chế biến trước', e.pallet_code;
  END IF;
  IF qa_is_hold(e.qa_status_id) THEN
    RAISE EXCEPTION 'MESERR:QA_HOLD|Tem % đang bị QA giữ — không rút vào mẻ được', e.pallet_code;
  END IF;
  IF COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0) < v_qty THEN
    RAISE EXCEPTION 'MESERR:SHORT|Tem % chỉ còn % có thể rút', e.pallet_code,
      COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0);
  END IF;
  v_new := COALESCE(e.cartons_remaining, e.cartons_imported, 0) - v_qty;
  UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = mes_entry_status(v_new, COALESCE(e.cartons_imported, 0)),
         updated_at = now() WHERE id = e.id;
  INSERT INTO batch_consumption (id, batch_id, entry_id, pallet_code, material_id, production_date, batch_lot, ncc_id,
         qty, source, created_by, created_by_name, created_at, updated_at)
  VALUES (v_id, p->>'batch_id', e.id, e.pallet_code, e.material_id, e.production_date::date, e.batch, e.ncc_id,
         v_qty, 'SCAN', p->>'actor_id', p->>'actor_name', now(), now());
  RETURN jsonb_build_object('rows', jsonb_build_array(jsonb_build_object('id', v_id, 'entry_id', e.id, 'pallet_code', e.pallet_code, 'qty', v_qty, 'remaining', v_new)));
END $$;

-- 3b. RÚT NVL VÀO MẺ theo LÔ (không có tem) — p: {batch_id, material_id, production_date?, batch_lot?, qty, actor_id, actor_name}
--     Trừ FEFO trong đúng lô (NSX và/hoặc mã lô) đã chọn; không đủ thì không trừ gì (không rút dở).
CREATE OR REPLACE FUNCTION public.mes_consume_lot(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_wh    text := mes_open_batch_wh(p->>'batch_id');
  v_qty   numeric := (p->>'qty')::numeric;
  v_date  date := nullif(p->>'production_date', '')::date;
  v_lot   text := nullif(btrim(coalesce(p->>'batch_lot', '')), '');
  v_left  numeric;
  v_avail numeric := 0;
  v_take  numeric;
  v_new   numeric;
  v_id    text;
  v_rows  jsonb := '[]'::jsonb;
  e       record;
BEGIN
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Số lượng rút phải lớn hơn 0'; END IF;
  v_left := v_qty;
  FOR e IN
    SELECT * FROM "InventoryEntry"
     WHERE warehouse_id = v_wh AND material_id = p->>'material_id'
       AND status IN ('IN_STOCK', 'PARTIAL')
       AND (production_date::date IS NOT DISTINCT FROM v_date)
       AND (v_lot IS NULL OR batch = v_lot)
       AND NOT qa_is_hold(qa_status_id)
       AND COALESCE(cartons_remaining, cartons_imported, 0) - COALESCE(cartons_reserved, 0) > 0
     ORDER BY expiry_date NULLS LAST, created_at, id
     FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, COALESCE(e.cartons_remaining, e.cartons_imported, 0) - COALESCE(e.cartons_reserved, 0));
    v_new  := COALESCE(e.cartons_remaining, e.cartons_imported, 0) - v_take;
    UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = mes_entry_status(v_new, COALESCE(e.cartons_imported, 0)),
           updated_at = now() WHERE id = e.id;
    v_id := gen_random_uuid()::text;
    INSERT INTO batch_consumption (id, batch_id, entry_id, pallet_code, material_id, production_date, batch_lot, ncc_id,
           qty, source, created_by, created_by_name, created_at, updated_at)
    VALUES (v_id, p->>'batch_id', e.id, e.pallet_code, e.material_id, e.production_date::date, e.batch, e.ncc_id,
           v_take, 'LOT', p->>'actor_id', p->>'actor_name', now(), now());
    v_rows := v_rows || jsonb_build_object('id', v_id, 'entry_id', e.id, 'pallet_code', e.pallet_code, 'qty', v_take, 'remaining', v_new);
    v_avail := v_avail + v_take;
    v_left  := v_left - v_take;
  END LOOP;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'MESERR:SHORT|Lô đã chọn chỉ còn % có thể rút (cần %)', v_avail, v_qty;   -- huỷ cả giao dịch
  END IF;
  RETURN jsonb_build_object('rows', v_rows);
END $$;

-- 3c. HUỶ DÒNG RÚT (ghi nhầm) — hoàn đúng lượng vào đúng dòng tồn, giữ vết. p: {consumption_id, reason, actor_id, actor_name}
CREATE OR REPLACE FUNCTION public.mes_consume_reverse(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  c     record;
  e     record;
  v_new numeric;
BEGIN
  IF length(btrim(coalesce(p->>'reason', ''))) = 0 THEN RAISE EXCEPTION 'MESERR:REASON|Nhập lý do huỷ'; END IF;
  SELECT * INTO c FROM batch_consumption WHERE id = p->>'consumption_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy dòng rút'; END IF;
  IF c.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'MESERR:ALREADY_REVERSED|Dòng rút này đã huỷ rồi'; END IF;
  PERFORM mes_open_batch_wh(c.batch_id);
  SELECT * INTO e FROM "InventoryEntry" WHERE id = c.entry_id FOR UPDATE;
  v_new := COALESCE(e.cartons_remaining, 0) + c.qty;
  UPDATE "InventoryEntry" SET cartons_remaining = v_new, status = mes_entry_status(v_new, COALESCE(e.cartons_imported, 0)),
         updated_at = now() WHERE id = e.id;
  UPDATE batch_consumption SET reversed_at = now(), reversed_by = p->>'actor_id', reversed_by_name = p->>'actor_name',
         reverse_reason = left(btrim(p->>'reason'), 500), updated_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('id', c.id, 'entry_id', e.id, 'remaining', v_new);
END $$;

-- 3d. NẠP BTP CỦA MẺ VÀO BỒN — p: {batch_id, tank_id, qty, actor_id, actor_name}
CREATE OR REPLACE FUNCTION public.mes_tank_fill(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  t       record;
  b       record;
  v_qty   numeric := (p->>'qty')::numeric;
  v_unit  text;
  v_hold  integer;
  v_cur   numeric;
  v_other text;
  v_lot   text;
BEGIN
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Lượng nạp phải lớn hơn 0'; END IF;
  SELECT * INTO t FROM production_tank WHERE id = p->>'tank_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy bồn'; END IF;
  IF NOT t.is_active THEN RAISE EXCEPTION 'MESERR:TANK_INACTIVE|Bồn % đang ngừng dùng', t.code; END IF;
  SELECT * INTO b FROM production_batch WHERE id = p->>'batch_id' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy mẻ'; END IF;
  IF b.status = 'CANCELLED' THEN RAISE EXCEPTION 'MESERR:BATCH_CANCELLED|Mẻ đã huỷ'; END IF;
  IF b.warehouse_id <> t.warehouse_id THEN RAISE EXCEPTION 'MESERR:WRONG_WAREHOUSE|Bồn % không thuộc kho của mẻ', t.code; END IF;
  SELECT upper(coalesce(base_unit, '')), tank_hold_hours INTO v_unit, v_hold FROM "Material" WHERE id = b.material_id;
  IF v_unit <> t.unit THEN
    RAISE EXCEPTION 'MESERR:UNIT|Bồn % tính theo %, mã bán thành phẩm tính theo % — không nạp được', t.code, t.unit, coalesce(nullif(v_unit, ''), '(trống)');
  END IF;
  SELECT m.material_code INTO v_other
    FROM tank_lot l JOIN production_batch ob ON ob.id = l.batch_id JOIN "Material" m ON m.id = ob.material_id
   WHERE l.tank_id = t.id AND l.status = 'ACTIVE' AND ob.material_id <> b.material_id LIMIT 1;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'MESERR:MIX_MATERIAL|Bồn % đang chứa mã % — không trộn mã bán thành phẩm khác vào cùng bồn', t.code, v_other;
  END IF;
  SELECT COALESCE(sum(qty_remaining), 0) INTO v_cur FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE';
  IF v_cur + v_qty > t.capacity THEN
    RAISE EXCEPTION 'MESERR:OVER_CAPACITY|Bồn % chỉ còn chỗ cho % % (sức chứa %, đang chứa %)', t.code, t.capacity - v_cur, t.unit, t.capacity, v_cur;
  END IF;
  SELECT id INTO v_lot FROM tank_lot WHERE tank_id = t.id AND batch_id = b.id AND status = 'ACTIVE' FOR UPDATE;
  IF v_lot IS NULL THEN
    v_lot := gen_random_uuid()::text;
    INSERT INTO tank_lot (id, tank_id, batch_id, qty_in, qty_remaining, filled_at, expires_at, status, created_at, updated_at)
    VALUES (v_lot, t.id, b.id, v_qty, v_qty, now(), CASE WHEN v_hold IS NOT NULL THEN now() + make_interval(hours => v_hold) END, 'ACTIVE', now(), now());
  ELSE
    UPDATE tank_lot SET qty_in = qty_in + v_qty, qty_remaining = qty_remaining + v_qty, updated_at = now() WHERE id = v_lot;
  END IF;
  INSERT INTO tank_movement (id, tank_id, tank_lot_id, batch_id, kind, qty, created_by, created_by_name, created_at, updated_at)
  VALUES (gen_random_uuid()::text, t.id, v_lot, b.id, 'FILL', v_qty, p->>'actor_id', p->>'actor_name', now(), now());
  UPDATE production_tank SET updated_at = now() WHERE id = t.id;   -- tín hiệu realtime cho màn Bồn
  RETURN jsonb_build_object('tank_lot_id', v_lot, 'content', v_cur + v_qty, 'capacity', t.capacity);
END $$;

-- 3e. LẤY RA KHỎI BỒN (rút cho trang sổ · xả bỏ · điều chỉnh giảm · chuyển đi) — chia THEO TỶ LỆ lượng còn của từng mẻ
--     (hàng trong bồn đã trộn). Dùng chung cho mọi lệnh lấy ra. p: {tank_id, qty, kind, packing_run_id?, ref_tank_id?,
--     reason?, qa_gate 'OFF'|'WARN'|'BLOCK', actor_id, actor_name}. Trả {parts:[{lot_id,batch_id,qty,filled_at,expires_at}], warnings:[]}
CREATE OR REPLACE FUNCTION public.mes_tank_take(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  t        record;
  l        record;
  v_qty    numeric := (p->>'qty')::numeric;
  v_kind   text := p->>'kind';
  v_gate   text := coalesce(p->>'qa_gate', 'WARN');
  v_total  numeric;
  v_n      integer;
  v_i      integer := 0;
  v_given  numeric := 0;
  v_share  numeric;
  v_parts  jsonb := '[]'::jsonb;
  v_warn   text[] := ARRAY[]::text[];
  v_hold   text[];
  v_exp    text[];
  v_wtext  text;
BEGIN
  IF v_kind NOT IN ('DRAW', 'DISCARD', 'ADJUST', 'TRANSFER_OUT') THEN RAISE EXCEPTION 'MESERR:KIND|Loại thao tác bồn không hợp lệ'; END IF;
  IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'MESERR:QTY|Lượng lấy ra phải lớn hơn 0'; END IF;
  SELECT * INTO t FROM production_tank WHERE id = p->>'tank_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy bồn'; END IF;
  PERFORM 1 FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE' FOR UPDATE;
  SELECT COALESCE(sum(qty_remaining), 0), count(*) INTO v_total, v_n FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE' AND qty_remaining > 0;
  IF v_qty > v_total THEN
    RAISE EXCEPTION 'MESERR:TANK_SHORT|Bồn % chỉ đang chứa % % (cần %) — khớp lại mức bồn bằng "Điều chỉnh" nếu đồng hồ báo khác', t.code, v_total, t.unit, v_qty;
  END IF;
  IF v_kind = 'DRAW' THEN
    SELECT array_agg(DISTINCT b.batch_code) INTO v_hold FROM tank_lot l2 JOIN production_batch b ON b.id = l2.batch_id
     WHERE l2.tank_id = t.id AND l2.status = 'ACTIVE' AND l2.qty_remaining > 0 AND b.qa_status <> 'RELEASED';
    IF v_hold IS NOT NULL AND v_gate = 'BLOCK' THEN
      RAISE EXCEPTION 'MESERR:QA_BLOCK|Bồn % có lô chưa được QA thả: % — kho đặt CHẶN rút', t.code, array_to_string(v_hold, ', ');
    END IF;
    IF v_hold IS NOT NULL AND v_gate = 'WARN' THEN v_warn := v_warn || ('Lô chưa QA thả: ' || array_to_string(v_hold, ', ')); END IF;
    SELECT array_agg(DISTINCT b.batch_code) INTO v_exp FROM tank_lot l2 JOIN production_batch b ON b.id = l2.batch_id
     WHERE l2.tank_id = t.id AND l2.status = 'ACTIVE' AND l2.qty_remaining > 0 AND l2.expires_at IS NOT NULL AND l2.expires_at < now();
    IF v_exp IS NOT NULL THEN v_warn := v_warn || ('Lô quá hạn lưu bồn: ' || array_to_string(v_exp, ', ')); END IF;
  END IF;
  v_wtext := nullif(array_to_string(v_warn, ' · '), '');
  FOR l IN SELECT * FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE' AND qty_remaining > 0 ORDER BY qty_remaining, filled_at, id LOOP
    v_i := v_i + 1;
    -- lô cuối (lượng còn lớn nhất) nhận phần dư làm tròn ⇒ Σ đúng bằng lượng lấy, không lô nào âm
    v_share := CASE WHEN v_i = v_n THEN v_qty - v_given ELSE round(v_qty * l.qty_remaining / v_total, 3) END;
    v_share := LEAST(v_share, l.qty_remaining);
    CONTINUE WHEN v_share <= 0;
    v_given := v_given + v_share;
    UPDATE tank_lot SET qty_remaining = qty_remaining - v_share,
           status = CASE WHEN qty_remaining - v_share <= 0 THEN 'EMPTY' ELSE 'ACTIVE' END,
           emptied_at = CASE WHEN qty_remaining - v_share <= 0 THEN now() ELSE emptied_at END,
           updated_at = now() WHERE id = l.id;
    INSERT INTO tank_movement (id, tank_id, tank_lot_id, batch_id, kind, qty, packing_run_id, ref_tank_id, reason, warning,
           created_by, created_by_name, created_at, updated_at)
    VALUES (gen_random_uuid()::text, t.id, l.id, l.batch_id, v_kind, -v_share, nullif(p->>'packing_run_id', '')::uuid,
           nullif(p->>'ref_tank_id', ''), nullif(left(btrim(coalesce(p->>'reason', '')), 500), ''), v_wtext,
           p->>'actor_id', p->>'actor_name', now(), now());
    v_parts := v_parts || jsonb_build_object('lot_id', l.id, 'batch_id', l.batch_id, 'qty', v_share, 'filled_at', l.filled_at, 'expires_at', l.expires_at);
  END LOOP;
  UPDATE production_tank SET updated_at = now() WHERE id = t.id;
  RETURN jsonb_build_object('parts', v_parts, 'warnings', to_jsonb(v_warn), 'content', v_total - v_given, 'unit', t.unit);
END $$;

-- 3f. ĐIỀU CHỈNH MỨC BỒN khớp đồng hồ — p: {tank_id, level, reason, actor_id, actor_name}. Giảm ⇒ chia theo tỷ lệ;
--     tăng ⇒ cộng theo tỷ lệ vào các lô đang sống (bồn trống thì không "tăng" được — phải nạp từ mẻ).
CREATE OR REPLACE FUNCTION public.mes_tank_adjust(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  t       record;
  l       record;
  v_level numeric := (p->>'level')::numeric;
  v_total numeric;
  v_delta numeric;
  v_n     integer;
  v_i     integer := 0;
  v_given numeric := 0;
  v_share numeric;
BEGIN
  IF length(btrim(coalesce(p->>'reason', ''))) = 0 THEN RAISE EXCEPTION 'MESERR:REASON|Nhập lý do điều chỉnh'; END IF;
  IF v_level IS NULL OR v_level < 0 THEN RAISE EXCEPTION 'MESERR:QTY|Mức bồn phải là số không âm'; END IF;
  SELECT * INTO t FROM production_tank WHERE id = p->>'tank_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy bồn'; END IF;
  IF v_level > t.capacity THEN RAISE EXCEPTION 'MESERR:OVER_CAPACITY|Mức % vượt sức chứa bồn (%)', v_level, t.capacity; END IF;
  PERFORM 1 FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE' FOR UPDATE;
  SELECT COALESCE(sum(qty_remaining), 0), count(*) INTO v_total, v_n FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE' AND qty_remaining > 0;
  v_delta := v_level - v_total;
  IF v_delta = 0 THEN RETURN jsonb_build_object('content', v_total, 'delta', 0); END IF;
  IF v_delta < 0 THEN
    RETURN mes_tank_take(jsonb_build_object('tank_id', t.id, 'qty', -v_delta, 'kind', 'ADJUST', 'reason', p->>'reason',
                                            'actor_id', p->>'actor_id', 'actor_name', p->>'actor_name'))
           || jsonb_build_object('delta', v_delta);
  END IF;
  IF v_n = 0 THEN RAISE EXCEPTION 'MESERR:TANK_EMPTY|Bồn % đang trống — muốn có hàng thì nạp từ mẻ, không điều chỉnh tăng', t.code; END IF;
  FOR l IN SELECT * FROM tank_lot WHERE tank_id = t.id AND status = 'ACTIVE' AND qty_remaining > 0 ORDER BY qty_remaining, filled_at, id LOOP
    v_i := v_i + 1;
    v_share := CASE WHEN v_i = v_n THEN v_delta - v_given ELSE round(v_delta * l.qty_remaining / v_total, 3) END;
    CONTINUE WHEN v_share <= 0;
    v_given := v_given + v_share;
    UPDATE tank_lot SET qty_remaining = qty_remaining + v_share, updated_at = now() WHERE id = l.id;
    INSERT INTO tank_movement (id, tank_id, tank_lot_id, batch_id, kind, qty, reason, created_by, created_by_name, created_at, updated_at)
    VALUES (gen_random_uuid()::text, t.id, l.id, l.batch_id, 'ADJUST', v_share, left(btrim(p->>'reason'), 500),
           p->>'actor_id', p->>'actor_name', now(), now());
  END LOOP;
  UPDATE production_tank SET updated_at = now() WHERE id = t.id;
  RETURN jsonb_build_object('content', v_level, 'delta', v_delta);
END $$;

-- 3g. CHUYỂN BỒN — p: {from_tank_id, to_tank_id, qty, reason?, actor_id, actor_name}. Lô sang bồn mới GIỮ lúc nạp + hạn lưu gốc.
CREATE OR REPLACE FUNCTION public.mes_tank_transfer(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
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

-- 3h. ĐÓNG TRANG SỔ + KHAI LƯỢNG RÚT TỪ BỒN trong MỘT giao dịch — p: {run_id, end_at, qty_total, pallet_count,
--     closed_by, closed_by_name, tank_qty, qa_gate, actor_id, actor_name}. tank_qty null/0 = chỉ đóng trang.
CREATE OR REPLACE FUNCTION public.mes_close_run(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  r      record;
  v_qty  numeric := nullif(p->>'tank_qty', '')::numeric;
  v_take jsonb := NULL;
BEGIN
  SELECT * INTO r FROM packing_runs WHERE id = (p->>'run_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESERR:NOT_FOUND|Không tìm thấy trang sổ'; END IF;
  IF r.status <> 'OPEN' THEN RAISE EXCEPTION 'MESERR:RUN_NOT_OPEN|Trang sổ vừa được người khác đóng'; END IF;
  IF v_qty IS NOT NULL AND v_qty > 0 THEN
    IF r.tank_id IS NULL THEN RAISE EXCEPTION 'MESERR:NO_TANK|Trang sổ chưa gắn bồn — không khai lượng rút được'; END IF;
    v_take := mes_tank_take(jsonb_build_object('tank_id', r.tank_id, 'qty', v_qty, 'kind', 'DRAW', 'packing_run_id', r.id,
                'qa_gate', p->>'qa_gate', 'actor_id', p->>'actor_id', 'actor_name', p->>'actor_name'));
  END IF;
  UPDATE packing_runs SET status = 'CLOSED', end_at = (p->>'end_at')::timestamptz,
         qty_total = (p->>'qty_total')::numeric, pallet_count = (p->>'pallet_count')::integer,
         closed_by = CASE WHEN coalesce(p->>'closed_by', '') ~ '^[0-9a-fA-F-]{36}$' THEN (p->>'closed_by')::uuid END,
         closed_by_name = nullif(p->>'closed_by_name', ''), updated_at = now()
   WHERE id = r.id;
  RETURN jsonb_build_object('run', (SELECT to_jsonb(x) FROM packing_runs x WHERE x.id = r.id), 'tank', v_take);
END $$;

-- 3i. Mở trang sổ: thêm tank_id (bồn đã được BE kiểm phạm vi + thuộc kho phụ của kho trang sổ)
CREATE OR REPLACE FUNCTION packing_open_run(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_codes   text[] := ARRAY(SELECT DISTINCT upper(trim(x)) FROM jsonb_array_elements_text(p->'material_codes') x WHERE trim(x) <> '');
  v_wh      text   := trim(coalesce(p->>'warehouse_id', ''));
  v_machine text   := upper(trim(coalesce(p->>'machine_code', '')));
  v_dup     text[];
  v_row     packing_runs;
BEGIN
  IF v_wh = '' THEN RAISE EXCEPTION 'PACKOPEN:Chọn Kho / Nhà máy'; END IF;
  IF coalesce(array_length(v_codes, 1), 0) = 0 THEN RAISE EXCEPTION 'PACKOPEN:Chọn Mã sản phẩm'; END IF;
  IF array_length(v_codes, 1) > 10 THEN RAISE EXCEPTION 'PACKOPEN:Tối đa 10 mã / 1 trang sổ'; END IF;
  IF v_machine = '' THEN RAISE EXCEPTION 'PACKOPEN:Nhập Máy'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('packing_open|' || v_wh || '|' || v_machine));

  SELECT array_agg(DISTINCT c) INTO v_dup
    FROM packing_runs r, unnest(r.material_codes) c
   WHERE r.status = 'OPEN' AND r.warehouse_id = v_wh AND r.machine_code = v_machine
     AND c = ANY(v_codes);
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'PACKDUP:Mã % đang có trang sổ MỞ trên máy này — dùng trang đó hoặc bấm Giờ kết thúc trước', array_to_string(v_dup, ', ');
  END IF;

  INSERT INTO packing_runs (id, warehouse_id, run_date, shift, cycle,
      material_code, material_codes, material_id, machine_code, start_at, status,
      opened_by, opened_by_name, note, tank_id, created_at, updated_at)
  VALUES (gen_random_uuid(), v_wh,
      coalesce(nullif(p->>'run_date', '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
      nullif(left(trim(coalesce(p->>'shift', '')), 40), ''),
      nullif(left(trim(coalesce(p->>'cycle', '')), 40), ''),
      v_codes[1], v_codes,
      CASE WHEN coalesce(p->>'material_id', '') ~ '^[0-9a-fA-F-]{36}$' THEN (p->>'material_id')::uuid END,
      left(v_machine, 10),
      coalesce(nullif(p->>'start_at', '')::timestamptz, now()), 'OPEN',
      CASE WHEN coalesce(p->>'opened_by', '') ~ '^[0-9a-fA-F-]{36}$' THEN (p->>'opened_by')::uuid END,
      nullif(p->>'opened_by_name', ''),
      nullif(left(trim(coalesce(p->>'note', '')), 500), ''),
      nullif(p->>'tank_id', ''),
      now(), now())
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;

-- 3j. TRUY XUẤT SẢN XUẤT (gia phả lô) — p_kind: 'BATCH' (mã lô BTP) · 'FG_PALLET' (tem thành phẩm) · 'RM_PALLET' (tem / mã pool NVL).
--     Trả danh sách mẻ liên quan, mỗi mẻ kèm NVL đã rút (pallet · NSX · NCC) và các trang sổ đã rút BTP của mẻ (bồn · lượng ·
--     pallet thành phẩm). Đi tiếp từ pallet thành phẩm tới NPP / xe = lot_trace sẵn có (màn Truy xuất lô gọi tiếp).
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
    SELECT array_agg(DISTINCT mv.batch_id) INTO v_ids
      FROM packing_logs pl JOIN tank_movement mv ON mv.packing_run_id = pl.run_id AND mv.kind = 'DRAW'
     WHERE pl.pallet_code = v_val AND pl.status <> 'CANCELLED';
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
                 GROUP BY mv.packing_run_id, mv.tank_id) d
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

REVOKE ALL ON FUNCTION public.mes_entry_status(numeric, numeric), public.mes_open_batch_wh(text), public.mes_consume_scan(jsonb),
  public.mes_consume_lot(jsonb), public.mes_consume_reverse(jsonb), public.mes_tank_fill(jsonb), public.mes_tank_take(jsonb),
  public.mes_tank_adjust(jsonb), public.mes_tank_transfer(jsonb), public.mes_close_run(jsonb),
  public.mes_genealogy(text, text, text[], integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mes_entry_status(numeric, numeric), public.mes_open_batch_wh(text), public.mes_consume_scan(jsonb),
  public.mes_consume_lot(jsonb), public.mes_consume_reverse(jsonb), public.mes_tank_fill(jsonb), public.mes_tank_take(jsonb),
  public.mes_tank_adjust(jsonb), public.mes_tank_transfer(jsonb), public.mes_close_run(jsonb),
  public.mes_genealogy(text, text, text[], integer) TO service_role;

-- 3k. SỔ PALLET: thêm nguồn 10 "Rút vào mẻ" (luật: nguồn mới của sổ pallet = thêm nhánh vào pallet_ledger, không dựng sổ mới).
--     Thân hàm chép NGUYÊN từ 20261026b, chỉ thêm nhánh 10.
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

-- ── 4. Cấp quyền theo NĂNG LỰC sẵn có (lớp C37 — module ra máy mà 0 chức danh có quyền) ───────────
--   • view · open_batch · consume · tank_ops ← packing.open_run (trưởng ca / người mở trang sổ đang lo xưởng)
--   • view · consume                          ← packing.record   (công nhân ghi sổ)
--   • view · qa_release                       ← inventory.qa_update (QA)
--   • view · manage_tank                      ← wms_settings.manage_machine (người khai danh mục máy)
--   • reverse (huỷ dòng rút) · export         ← CHƯA tự cấp: quyết định quản trị, tick trong trình phân quyền
-- Chỉ điền cho chức danh CHƯA có key `production` — admin đã tự cấp/gỡ thì không đè.
WITH src AS (
  SELECT id, COALESCE(module_permissions, '{}'::jsonb) AS mp FROM public."JobTitle" WHERE module_permissions->'production' IS NULL
), capab AS (
  SELECT id,
         (mp->'packing' ? 'open_run')          AS run_mgr,
         (mp->'packing' ? 'record')            AS recorder,
         (mp->'inventory' ? 'qa_update')       AS qa,
         (mp->'wms_settings' ? 'manage_machine') AS setup
    FROM src
), grant_rows AS (
  SELECT * FROM capab WHERE run_mgr OR recorder OR qa OR setup
)
UPDATE public."JobTitle" j
   SET module_permissions = jsonb_set(COALESCE(j.module_permissions, '{}'::jsonb), '{production}',
         to_jsonb(ARRAY(SELECT DISTINCT x FROM unnest(
           ARRAY['view']
           || CASE WHEN g.run_mgr THEN ARRAY['open_batch', 'consume', 'tank_ops'] ELSE ARRAY[]::text[] END
           || CASE WHEN g.recorder THEN ARRAY['consume'] ELSE ARRAY[]::text[] END
           || CASE WHEN g.qa THEN ARRAY['qa_release'] ELSE ARRAY[]::text[] END
           || CASE WHEN g.setup THEN ARRAY['manage_tank'] ELSE ARRAY[]::text[] END) x ORDER BY x)), true),
       updated_at = now()
  FROM grant_rows g
 WHERE j.id = g.id;

COMMIT;
