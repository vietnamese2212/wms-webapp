-- MES 22/11 — DASHBOARD BÁO CÁO NVL THEO THỜI GIAN (user 21–22/11: "báo cáo chưa chuyên nghiệp, học hỏi các phần mềm MES hiện đại" ·
-- "1 ngày 36 mẻ, vận hành nhiều tháng, nhiều năm thì sao, lên dashboard thế nào" · "từ dashboard click vào thì ra dữ liệu xem được").
-- User chốt: khuôn "trung tâm điều hành" · kỳ 1 ngày / 7 ngày / 1 tháng / 3 tháng / 1 năm / 3 năm / tự chọn · KHÔNG thẻ giá trị (chưa có
-- giá chuẩn) · KHÔNG hiệu suất thu hồi (chưa ghi nước) · mục tiêu = cấu hình tự đặt.
--
-- Quy mô: 36 mẻ/ngày ≈ 13.000 mẻ/năm, ≈ 160.000 dòng định mức + 400.000 lần cấp/năm. Trình duyệt KHÔNG nhận từng dòng: máy chủ gom sẵn,
-- mỗi biểu đồ vài chục – vài trăm điểm. Số của mẻ đã nạp bồn bị khoá (18/11 c) ⇒ ghi MỘT lần vào SỔ TỔNG HỢP:
--   • production_batch_fact     — một dòng / mẻ đã nạp bồn: ngày SX · ca · BTP · số dòng NVL theo trạng thái · KG định mức / phiếu /
--                                  thực cấp / sửa phiếu / cấp lệch / lệch (chỉ NVL tính KG) · thời gian mở → nạp · QA bồn · sai thứ tự.
--   • production_batch_dev_line — một dòng / NVL LỆCH của mẻ đã nạp (vượt · dưới · ngoài định mức) — cho "NVL gây lệch" + bảng chi tiết.
--   Dựng / dựng lại bằng mes_batch_fact_build(mẻ) từ trigger: lần NẠP đầu (tank_movement FILL), và khi mẻ đã có sổ mà phiếu / lần cấp /
--   ca / ngày SX / trạng thái đổi. Mẻ chưa nạp bồn (vài chục) tính trực tiếp lúc xem ⇒ "Hôm nay" vẫn sống.
-- Luật trạng thái một dòng = mes_line_state (SQL) — bản sao của cellState (frontend/src/utils/cycleReport.ts); CÙNG bảng ca
-- backend/tests/unit/mesLineStateCases.json chạy ở test TS và ở khối DO cuối file này. Đổi luật ⇒ sửa cả hai.
-- RPC chỉ đọc: mes_dashboard(p) (mọi khối của dashboard trong MỘT lời gọi) · mes_dashboard_detail(p) (bảng dữ liệu khi bấm vào biểu đồ).
-- Mục tiêu: Warehouse.mes_dev_target_pct (± % lệch, trống = 0,5) · mes_pass_target_pct (% mẻ đạt, trống = 95) — Cài đặt MES.
BEGIN;

-- ── 1. mục tiêu (Cài đặt MES, theo kho chế biến) ───────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public."Warehouse" ADD COLUMN IF NOT EXISTS mes_dev_target_pct numeric, ADD COLUMN IF NOT EXISTS mes_pass_target_pct numeric;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_mes_targets_chk') THEN
    ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_mes_targets_chk CHECK (
      (mes_dev_target_pct IS NULL OR (mes_dev_target_pct > 0 AND mes_dev_target_pct <= 50))
      AND (mes_pass_target_pct IS NULL OR (mes_pass_target_pct > 0 AND mes_pass_target_pct <= 100)));
  END IF;
END $$;
COMMENT ON COLUMN public."Warehouse".mes_dev_target_pct IS 'MES — mục tiêu lệch NVL so định mức (± %), dashboard Báo cáo NVL; null = 0,5';
COMMENT ON COLUMN public."Warehouse".mes_pass_target_pct IS 'MES — mục tiêu % mẻ đạt định mức (không NVL nào lệch ngoài mức cho phép); null = 95';

-- ── 2. luật trạng thái một dòng (bản SQL của reqLineState + cellSettled + cellState) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_req_state(p_req numeric, p_iss numeric, p_tol numeric, p_closed boolean) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_req IS NULL THEN 'extra'
    WHEN COALESCE(p_iss, 0) > (CASE WHEN p_tol IS NULL THEN p_req ELSE p_req * (1 + p_tol / 100) END) + 0.0005 THEN 'over'
    WHEN COALESCE(p_iss, 0) > 0 AND COALESCE(p_iss, 0) >= (CASE WHEN p_tol IS NULL THEN p_req ELSE p_req * (1 - p_tol / 100) END) - 0.0005 THEN 'ok'
    WHEN p_closed THEN 'under'
    WHEN COALESCE(p_iss, 0) > 0 THEN 'progress'
    ELSE 'none' END
$$;
-- so ĐỊNH MỨC GỐC; dòng chưa cấp xong (phiếu chưa đủ, mẻ chưa nạp) ⇒ progress / none (chưa có số lệch)
CREATE OR REPLACE FUNCTION public.mes_line_state(p_std numeric, p_req numeric, p_rm boolean, p_tol numeric, p_iss numeric, p_closed boolean) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN NOT (p_closed OR mes_req_state(CASE WHEN p_rm THEN NULL ELSE p_req END, p_iss, p_tol, false) IN ('ok', 'over', 'extra'))
      THEN CASE WHEN COALESCE(p_iss, 0) > 0 THEN 'progress' ELSE 'none' END
    WHEN p_std IS NULL THEN 'extra'
    ELSE mes_req_state(p_std, p_iss, p_tol, true) END
$$;

-- ── 3. ô NVL × mẻ có trạng thái (cùng nguồn với mes_cycle_report: phiếu kể cả dòng đã bỏ + lần cấp chưa huỷ) ────────────────────────
-- closed = mẻ đã nạp bồn hoặc QA loại (cùng nghĩa isFilled của màn: stage filled / released / rejected)
CREATE OR REPLACE FUNCTION public.mes_batch_cells(p_ids text[])
RETURNS TABLE(batch_id text, material_id text, is_kg boolean, std numeric, sheet numeric, iss numeric, tol numeric, rm boolean, why text, state text, closed boolean)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH b AS (
    SELECT pb.id, (pb.qa_status = 'REJECTED' OR EXISTS (SELECT 1 FROM tank_movement mv WHERE mv.batch_id = pb.id AND mv.kind = 'FILL')) AS closed
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
         mes_line_state(cell.std, cell.req, cell.rm, cell.tol, cell.iss, b.closed), b.closed
    FROM cell JOIN b ON b.id = cell.batch_id JOIN "Material" m ON m.id = cell.material_id
$$;

-- gom một mẻ (bản SQL của devAgg một mẻ): KG chỉ dòng ĐÃ CẤP XONG của NVL tính KG; sửa phiếu = phiếu − định mức; cấp lệch = thực cấp − phiếu
CREATE OR REPLACE FUNCTION public.mes_batch_agg(p_ids text[])
RETURNS TABLE(batch_id text, lines int, pending int, ok int, over int, under int, extra int, edited int,
              std_kg numeric, sheet_kg numeric, iss_kg numeric, edit_kg numeric, exec_kg numeric, total_kg numeric)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT c.batch_id, count(*)::int,
         count(*) FILTER (WHERE c.state IN ('progress', 'none'))::int,
         count(*) FILTER (WHERE c.state = 'ok')::int, count(*) FILTER (WHERE c.state = 'over')::int,
         count(*) FILTER (WHERE c.state = 'under')::int, count(*) FILTER (WHERE c.state = 'extra')::int,
         count(*) FILTER (WHERE c.state NOT IN ('progress', 'none') AND c.sheet <> c.std)::int,
         COALESCE(sum(c.std) FILTER (WHERE c.is_kg AND c.state NOT IN ('progress', 'none')), 0),
         COALESCE(sum(c.sheet) FILTER (WHERE c.is_kg AND c.state NOT IN ('progress', 'none')), 0),
         COALESCE(sum(c.iss) FILTER (WHERE c.is_kg AND c.state NOT IN ('progress', 'none')), 0),
         COALESCE(sum(c.sheet - c.std) FILTER (WHERE c.is_kg AND c.state NOT IN ('progress', 'none')), 0),
         COALESCE(sum(c.iss - c.sheet) FILTER (WHERE c.is_kg AND c.state NOT IN ('progress', 'none')), 0),
         COALESCE(sum(c.iss - c.std) FILTER (WHERE c.is_kg AND c.state NOT IN ('progress', 'none')), 0)
    FROM mes_batch_cells(p_ids) c GROUP BY c.batch_id
$$;

-- ── 4. sổ tổng hợp ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.production_batch_fact (
  batch_id     text PRIMARY KEY REFERENCES public.production_batch(id) ON DELETE CASCADE,
  warehouse_id text NOT NULL REFERENCES public."Warehouse"(id),
  prod_date    date NOT NULL,
  shift        text,
  btp_id       text NOT NULL REFERENCES public."Material"(id),
  batch_code   text,
  batch_no     integer,
  cycle        text,
  created_at   timestamptz NOT NULL,
  filled_at    timestamptz NOT NULL,
  open_min     integer,
  qa_status    text,
  rm_bad       integer NOT NULL DEFAULT 0,
  lines        integer NOT NULL DEFAULT 0,
  pending      integer NOT NULL DEFAULT 0,
  ok           integer NOT NULL DEFAULT 0,
  over         integer NOT NULL DEFAULT 0,
  under        integer NOT NULL DEFAULT 0,
  extra        integer NOT NULL DEFAULT 0,
  edited       integer NOT NULL DEFAULT 0,
  std_kg       numeric NOT NULL DEFAULT 0,
  sheet_kg     numeric NOT NULL DEFAULT 0,
  iss_kg       numeric NOT NULL DEFAULT 0,
  edit_kg      numeric NOT NULL DEFAULT 0,
  exec_kg      numeric NOT NULL DEFAULT 0,
  total_kg     numeric NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prod_batch_fact_wh_date ON public.production_batch_fact (warehouse_id, prod_date);
ALTER TABLE public.production_batch_fact ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.production_batch_fact IS 'MES — sổ tổng hợp: một dòng / mẻ đã nạp bồn (dashboard Báo cáo NVL). Dựng bởi mes_batch_fact_build từ trigger; không ghi tay.';

CREATE TABLE IF NOT EXISTS public.production_batch_dev_line (
  id           text PRIMARY KEY,
  batch_id     text NOT NULL REFERENCES public.production_batch(id) ON DELETE CASCADE,
  warehouse_id text NOT NULL REFERENCES public."Warehouse"(id),
  prod_date    date NOT NULL,
  shift        text,
  material_id  text NOT NULL REFERENCES public."Material"(id),
  state        text NOT NULL CHECK (state IN ('over', 'under', 'extra')),
  std          numeric NOT NULL DEFAULT 0,
  sheet        numeric NOT NULL DEFAULT 0,
  iss          numeric NOT NULL DEFAULT 0,
  why          text,
  updated_at   timestamptz NOT NULL,
  UNIQUE (batch_id, material_id)
);
CREATE INDEX IF NOT EXISTS idx_prod_batch_dev_wh_date ON public.production_batch_dev_line (warehouse_id, prod_date);
ALTER TABLE public.production_batch_dev_line ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.production_batch_dev_line IS 'MES — sổ tổng hợp: một dòng / NVL lệch (vượt · dưới · ngoài định mức) của mẻ đã nạp bồn. Dựng bởi mes_batch_fact_build.';

-- mẻ chưa nạp bồn trong khoảng ngày (tính trực tiếp): dùng chỉ mục có sẵn idx_prod_batch_wh_date (warehouse_id, prod_date DESC, batch_code)

-- ── 5. dựng / dựng lại sổ tổng hợp của MỘT mẻ ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_batch_fact_build(p_batch text) RETURNS void
LANGUAGE plpgsql SET search_path TO 'public' AS $$
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
                                     std_kg, sheet_kg, iss_kg, edit_kg, exec_kg, total_kg, updated_at)
  SELECT b.id, b.warehouse_id, v_date, v_shift, b.material_id, b.batch_code, b.batch_no, b.cycle, b.created_at, v_fill,
         GREATEST(0, round(extract(epoch FROM (v_fill - b.created_at)) / 60))::int, b.qa_status,
         (SELECT count(*) FROM batch_consumption c WHERE c.batch_id = b.id AND c.reversed_at IS NULL AND COALESCE(c.rotation_violation, false))::int,
         COALESCE(a.lines, 0), COALESCE(a.pending, 0), COALESCE(a.ok, 0), COALESCE(a.over, 0), COALESCE(a.under, 0), COALESCE(a.extra, 0), COALESCE(a.edited, 0),
         COALESCE(a.std_kg, 0), COALESCE(a.sheet_kg, 0), COALESCE(a.iss_kg, 0), COALESCE(a.edit_kg, 0), COALESCE(a.exec_kg, 0), COALESCE(a.total_kg, 0), now()
    FROM (SELECT 1) one LEFT JOIN mes_batch_agg(ARRAY[p_batch]) a ON true
  ON CONFLICT (batch_id) DO UPDATE SET warehouse_id = EXCLUDED.warehouse_id, prod_date = EXCLUDED.prod_date, shift = EXCLUDED.shift, btp_id = EXCLUDED.btp_id,
    batch_code = EXCLUDED.batch_code, batch_no = EXCLUDED.batch_no, cycle = EXCLUDED.cycle, created_at = EXCLUDED.created_at, filled_at = EXCLUDED.filled_at,
    open_min = EXCLUDED.open_min, qa_status = EXCLUDED.qa_status, rm_bad = EXCLUDED.rm_bad, lines = EXCLUDED.lines, pending = EXCLUDED.pending, ok = EXCLUDED.ok,
    over = EXCLUDED.over, under = EXCLUDED.under, extra = EXCLUDED.extra, edited = EXCLUDED.edited, std_kg = EXCLUDED.std_kg, sheet_kg = EXCLUDED.sheet_kg,
    iss_kg = EXCLUDED.iss_kg, edit_kg = EXCLUDED.edit_kg, exec_kg = EXCLUDED.exec_kg, total_kg = EXCLUDED.total_kg, updated_at = EXCLUDED.updated_at;
  DELETE FROM production_batch_dev_line WHERE batch_id = p_batch;
  INSERT INTO production_batch_dev_line (id, batch_id, warehouse_id, prod_date, shift, material_id, state, std, sheet, iss, why, updated_at)
  SELECT gen_random_uuid()::text, p_batch, b.warehouse_id, v_date, v_shift, c.material_id, c.state, c.std, c.sheet, c.iss, c.why, now()
    FROM mes_batch_cells(ARRAY[p_batch]) c WHERE c.state IN ('over', 'under', 'extra');
END $$;

-- ── 6. trigger: lần NẠP đầu dựng sổ; mẻ đã có sổ mà phiếu / lần cấp / thông tin mẻ đổi ⇒ dựng lại ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_fact_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_id text; v_old text;
BEGIN
  IF TG_TABLE_NAME = 'production_batch' THEN
    IF EXISTS (SELECT 1 FROM production_batch_fact f WHERE f.batch_id = NEW.id) THEN PERFORM mes_batch_fact_build(NEW.id); END IF;
  ELSIF TG_TABLE_NAME = 'tank_movement' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.kind = 'FILL' THEN PERFORM mes_batch_fact_build(NEW.batch_id); END IF;
    IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.kind = 'FILL' AND (TG_OP = 'DELETE' OR OLD.batch_id IS DISTINCT FROM NEW.batch_id) THEN PERFORM mes_batch_fact_build(OLD.batch_id); END IF;
  ELSE   -- batch_consumption · batch_requirement
    v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.batch_id ELSE NEW.batch_id END;
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN OLD.batch_id END;
    IF EXISTS (SELECT 1 FROM production_batch_fact f WHERE f.batch_id = v_id) THEN PERFORM mes_batch_fact_build(v_id); END IF;
    IF v_old IS NOT NULL AND v_old IS DISTINCT FROM v_id AND EXISTS (SELECT 1 FROM production_batch_fact f WHERE f.batch_id = v_old) THEN PERFORM mes_batch_fact_build(v_old); END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_mes_fact_batch ON public.production_batch;
CREATE TRIGGER trg_mes_fact_batch AFTER UPDATE ON public.production_batch FOR EACH ROW
  WHEN (OLD.shift IS DISTINCT FROM NEW.shift OR OLD.prod_date IS DISTINCT FROM NEW.prod_date OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.qa_status IS DISTINCT FROM NEW.qa_status OR OLD.material_id IS DISTINCT FROM NEW.material_id OR OLD.batch_code IS DISTINCT FROM NEW.batch_code
     OR OLD.batch_no IS DISTINCT FROM NEW.batch_no OR OLD.cycle IS DISTINCT FROM NEW.cycle OR OLD.warehouse_id IS DISTINCT FROM NEW.warehouse_id)
  EXECUTE FUNCTION public.mes_fact_touch();
DROP TRIGGER IF EXISTS trg_mes_fact_fill ON public.tank_movement;
CREATE TRIGGER trg_mes_fact_fill AFTER INSERT OR UPDATE OR DELETE ON public.tank_movement FOR EACH ROW EXECUTE FUNCTION public.mes_fact_touch();
DROP TRIGGER IF EXISTS trg_mes_fact_cons ON public.batch_consumption;
CREATE TRIGGER trg_mes_fact_cons AFTER INSERT OR UPDATE OR DELETE ON public.batch_consumption FOR EACH ROW EXECUTE FUNCTION public.mes_fact_touch();
DROP TRIGGER IF EXISTS trg_mes_fact_req ON public.batch_requirement;
CREATE TRIGGER trg_mes_fact_req AFTER INSERT OR UPDATE OR DELETE ON public.batch_requirement FOR EACH ROW EXECUTE FUNCTION public.mes_fact_touch();

-- ── 7. gom theo khoảng ngày SX: sổ tổng hợp (mẻ đã nạp) + tính trực tiếp (mẻ chưa nạp / chưa có sổ) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mes_dash_batches(p_wh text, p_from date, p_to date)
RETURNS TABLE(batch_id text, prod_date date, shift text, btp_id text, batch_code text, batch_no integer, created_at timestamptz,
              filled_at timestamptz, filled boolean, open_min integer, qa_status text, rm_bad integer,
              lines integer, pending integer, ok integer, over integer, under integer, extra integer, edited integer,
              std_kg numeric, sheet_kg numeric, iss_kg numeric, edit_kg numeric, exec_kg numeric, total_kg numeric)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH live AS (
    SELECT pb.* FROM production_batch pb
     WHERE pb.warehouse_id = p_wh AND pb.status <> 'CANCELLED'
       AND COALESCE(pb.prod_date, (pb.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) BETWEEN p_from AND p_to
       AND NOT EXISTS (SELECT 1 FROM production_batch_fact f WHERE f.batch_id = pb.id)),
  a AS (SELECT * FROM mes_batch_agg(ARRAY(SELECT id FROM live)))
  SELECT f.batch_id, f.prod_date, f.shift, f.btp_id, f.batch_code, f.batch_no, f.created_at, f.filled_at, true, f.open_min, f.qa_status, f.rm_bad,
         f.lines, f.pending, f.ok, f.over, f.under, f.extra, f.edited, f.std_kg, f.sheet_kg, f.iss_kg, f.edit_kg, f.exec_kg, f.total_kg
    FROM production_batch_fact f WHERE f.warehouse_id = p_wh AND f.prod_date BETWEEN p_from AND p_to
  UNION ALL
  SELECT l.id, COALESCE(l.prod_date, (l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date), NULLIF(btrim(COALESCE(l.shift, '')), ''), l.material_id,
         l.batch_code, l.batch_no, l.created_at, NULL::timestamptz, false, NULL::int, l.qa_status,
         (SELECT count(*) FROM batch_consumption c WHERE c.batch_id = l.id AND c.reversed_at IS NULL AND COALESCE(c.rotation_violation, false))::int,
         COALESCE(a.lines, 0), COALESCE(a.pending, 0), COALESCE(a.ok, 0), COALESCE(a.over, 0), COALESCE(a.under, 0), COALESCE(a.extra, 0), COALESCE(a.edited, 0),
         COALESCE(a.std_kg, 0), COALESCE(a.sheet_kg, 0), COALESCE(a.iss_kg, 0), COALESCE(a.edit_kg, 0), COALESCE(a.exec_kg, 0), COALESCE(a.total_kg, 0)
    FROM live l LEFT JOIN a ON a.batch_id = l.id
$$;

CREATE OR REPLACE FUNCTION public.mes_dash_lines(p_wh text, p_from date, p_to date)
RETURNS TABLE(batch_id text, prod_date date, shift text, material_id text, state text, std numeric, sheet numeric, iss numeric, why text)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH live AS (
    SELECT pb.id, COALESCE(pb.prod_date, (pb.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS pd, NULLIF(btrim(COALESCE(pb.shift, '')), '') AS sh
      FROM production_batch pb
     WHERE pb.warehouse_id = p_wh AND pb.status <> 'CANCELLED'
       AND COALESCE(pb.prod_date, (pb.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) BETWEEN p_from AND p_to
       AND NOT EXISTS (SELECT 1 FROM production_batch_fact f WHERE f.batch_id = pb.id))
  SELECT d.batch_id, d.prod_date, d.shift, d.material_id, d.state, d.std, d.sheet, d.iss, d.why
    FROM production_batch_dev_line d WHERE d.warehouse_id = p_wh AND d.prod_date BETWEEN p_from AND p_to
  UNION ALL
  SELECT c.batch_id, live.pd, live.sh, c.material_id, c.state, c.std, c.sheet, c.iss, c.why
    FROM live JOIN mes_batch_cells(ARRAY(SELECT id FROM live)) c ON c.batch_id = live.id
   WHERE c.state IN ('over', 'under', 'extra')
$$;

-- ── 8. DASHBOARD — mọi khối trong MỘT lời gọi ─────────────────────────────────────────────────────────────────────────────────────────
-- grain: 'batch' (1 ngày: mỗi mẻ một điểm) · 'day' · 'week' (thứ Hai đầu tuần) · 'month'. Kỳ trước = cùng số ngày liền trước (để so ▲▼).
CREATE OR REPLACE FUNCTION public.mes_dashboard(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  v_wh    text := nullif(p->>'warehouse_id', '');
  v_from  date := nullif(p->>'date_from', '')::date;
  v_to    date := nullif(p->>'date_to', '')::date;
  v_grain text := coalesce(nullif(p->>'grain', ''), 'day');
  v_days  int;
  v_dev   numeric;
  v_pass  numeric;
  v_out   jsonb;
BEGIN
  IF v_wh IS NULL THEN RAISE EXCEPTION 'MESERR:WAREHOUSE|Chọn kho chế biến'; END IF;
  IF v_from IS NULL OR v_to IS NULL OR v_to < v_from THEN RAISE EXCEPTION 'MESERR:DATE_RANGE|Khoảng ngày không hợp lệ'; END IF;
  v_days := v_to - v_from + 1;
  IF v_days > 1100 THEN RAISE EXCEPTION 'MESERR:DATE_RANGE|Tối đa 3 năm'; END IF;
  IF v_grain NOT IN ('batch', 'day', 'week', 'month') THEN RAISE EXCEPTION 'MESERR:KIND|Cách gom không hợp lệ'; END IF;
  SELECT COALESCE(w.mes_dev_target_pct, 0.5), COALESCE(w.mes_pass_target_pct, 95) INTO v_dev, v_pass FROM "Warehouse" w WHERE w.id = v_wh;

  WITH b AS MATERIALIZED (SELECT * FROM mes_dash_batches(v_wh, v_from, v_to)),
  l AS MATERIALIZED (SELECT * FROM mes_dash_lines(v_wh, v_from, v_to)),
  pv AS MATERIALIZED (SELECT * FROM mes_dash_batches(v_wh, v_from - v_days, v_from - 1)),
  bk AS (SELECT CASE v_grain WHEN 'week' THEN date_trunc('week', b.prod_date)::date WHEN 'month' THEN date_trunc('month', b.prod_date)::date ELSE b.prod_date END AS k, b.* FROM b),
  pct AS (SELECT b.*, CASE WHEN b.std_kg > 0 THEN round(b.total_kg / b.std_kg * 100, 3) END AS pct, (b.over + b.under + b.extra) AS dev FROM b)
  SELECT jsonb_build_object(
    'warehouse_id', v_wh, 'date_from', v_from, 'date_to', v_to, 'grain', v_grain, 'computed_at', now(),
    'targets', jsonb_build_object('dev_pct', v_dev, 'pass_pct', v_pass),
    'totals', (SELECT jsonb_build_object(
        'batches', count(*), 'filled', count(*) FILTER (WHERE filled), 'pass', count(*) FILTER (WHERE filled AND over + under + extra = 0),
        'dev_batches', count(*) FILTER (WHERE over + under + extra > 0),
        'lines', COALESCE(sum(lines), 0), 'pending', COALESCE(sum(pending), 0), 'ok', COALESCE(sum(ok), 0), 'over', COALESCE(sum(over), 0),
        'under', COALESCE(sum(under), 0), 'extra', COALESCE(sum(extra), 0), 'edited', COALESCE(sum(edited), 0),
        'std_kg', COALESCE(sum(std_kg), 0), 'sheet_kg', COALESCE(sum(sheet_kg), 0), 'iss_kg', COALESCE(sum(iss_kg), 0),
        'edit_kg', COALESCE(sum(edit_kg), 0), 'exec_kg', COALESCE(sum(exec_kg), 0), 'total_kg', COALESCE(sum(total_kg), 0),
        'avg_min', round(avg(open_min) FILTER (WHERE filled)), 'rm_bad', COALESCE(sum(rm_bad), 0),
        'qa_released', count(*) FILTER (WHERE qa_status = 'RELEASED'), 'qa_rejected', count(*) FILTER (WHERE qa_status = 'REJECTED')) FROM b),
    'prev', (SELECT jsonb_build_object(
        'batches', count(*), 'filled', count(*) FILTER (WHERE filled), 'pass', count(*) FILTER (WHERE filled AND over + under + extra = 0),
        'over', COALESCE(sum(over), 0), 'under', COALESCE(sum(under), 0), 'extra', COALESCE(sum(extra), 0),
        'std_kg', COALESCE(sum(std_kg), 0), 'total_kg', COALESCE(sum(total_kg), 0), 'avg_min', round(avg(open_min) FILTER (WHERE filled)),
        'qa_released', count(*) FILTER (WHERE qa_status = 'RELEASED'), 'qa_rejected', count(*) FILTER (WHERE qa_status = 'REJECTED')) FROM pv),
    'buckets', (SELECT COALESCE(jsonb_agg(jsonb_build_object('k', x.k, 'batches', x.n, 'filled', x.filled, 'pass', x.pass, 'dev_batches', x.devb,
                  'dev_lines', x.devl, 'std_kg', x.std, 'total_kg', x.tot, 'edit_kg', x.edit, 'exec_kg', x.exec) ORDER BY x.k), '[]'::jsonb)
                  FROM (SELECT k, count(*) AS n, count(*) FILTER (WHERE filled) AS filled, count(*) FILTER (WHERE filled AND over + under + extra = 0) AS pass,
                               count(*) FILTER (WHERE over + under + extra > 0) AS devb, sum(over + under + extra) AS devl,
                               sum(std_kg) AS std, sum(total_kg) AS tot, sum(edit_kg) AS edit, sum(exec_kg) AS exec FROM bk GROUP BY k) x),
    'points', CASE WHEN v_grain = 'batch' THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.batch_id, 'code', x.batch_code, 'no', x.batch_no,
                  'shift', x.shift, 'at', x.created_at, 'filled', x.filled, 'std_kg', x.std_kg, 'total_kg', x.total_kg, 'pct', x.pct, 'dev', x.dev,
                  'pending', x.pending) ORDER BY x.created_at), '[]'::jsonb) FROM pct x) END,
    'heat', (SELECT COALESCE(jsonb_agg(jsonb_build_object('shift', x.shift, 'k', x.k, 'batches', x.n, 'dev_batches', x.devb, 'std_kg', x.std, 'total_kg', x.tot)
                  ORDER BY x.k, x.shift NULLS LAST), '[]'::jsonb)
                  FROM (SELECT shift, k, count(*) AS n, count(*) FILTER (WHERE over + under + extra > 0) AS devb, sum(std_kg) AS std, sum(total_kg) AS tot
                          FROM bk GROUP BY shift, k) x),
    'shifts', (SELECT COALESCE(jsonb_agg(jsonb_build_object('shift', x.shift, 'batches', x.n, 'filled', x.filled, 'pass', x.pass, 'dev_lines', x.devl,
                  'std_kg', x.std, 'total_kg', x.tot) ORDER BY x.shift NULLS LAST), '[]'::jsonb)
                  FROM (SELECT shift, count(*) AS n, count(*) FILTER (WHERE filled) AS filled, count(*) FILTER (WHERE filled AND over + under + extra = 0) AS pass,
                               sum(over + under + extra) AS devl, sum(std_kg) AS std, sum(total_kg) AS tot FROM b GROUP BY shift) x),
    'btp', (SELECT COALESCE(jsonb_agg(jsonb_build_object('btp_id', x.btp_id, 'code', m.material_code, 'name', m.short_name, 'batches', x.n, 'filled', x.filled,
                  'pass', x.pass, 'dev_lines', x.devl, 'std_kg', x.std, 'total_kg', x.tot) ORDER BY x.n DESC, m.material_code), '[]'::jsonb)
                  FROM (SELECT btp_id, count(*) AS n, count(*) FILTER (WHERE filled) AS filled, count(*) FILTER (WHERE filled AND over + under + extra = 0) AS pass,
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
END $$;

-- ── 9. BẢNG DỮ LIỆU khi bấm vào dashboard ────────────────────────────────────────────────────────────────────────────────────────────
-- kind 'batches': từng mẻ (lọc ca · BTP · chỉ mẻ có NVL lệch / chỉ mẻ không đạt / mẻ đang làm) · kind 'lines': từng NVL lệch (lọc NVL · ca · BTP ·
-- trạng thái · chỉ dòng sửa phiếu · chỉ dòng cấp khác phiếu). shift '__none' = mẻ chưa ghi ca. Tối đa 500 dòng / lần, kèm tổng để màn nói rõ khi bị cắt.
CREATE OR REPLACE FUNCTION public.mes_dashboard_detail(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
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
              OR (v_only = 'pass' AND b.filled AND b.over + b.under + b.extra = 0)
              OR (v_only = 'filled' AND b.filled)
              OR (v_only = 'running' AND NOT b.filled)
              OR (v_only = 'edited' AND b.edited > 0)
              OR (v_only = 'qa_rejected' AND b.qa_status = 'REJECTED')
              OR (v_only = 'rm_bad' AND b.rm_bad > 0)))
    SELECT jsonb_build_object('kind', 'batches', 'total', (SELECT count(*) FROM f), 'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', x.batch_id, 'code', x.batch_code, 'no', x.batch_no, 'shift', x.shift, 'd', x.prod_date, 'at', x.created_at,
               'btp', m.material_code, 'btp_name', m.short_name, 'filled', x.filled, 'qa_status', x.qa_status, 'open_min', x.open_min, 'rm_bad', x.rm_bad,
               'lines', x.lines, 'pending', x.pending, 'over', x.over, 'under', x.under, 'extra', x.extra, 'edited', x.edited,
               'std_kg', x.std_kg, 'iss_kg', x.iss_kg, 'edit_kg', x.edit_kg, 'exec_kg', x.exec_kg, 'total_kg', x.total_kg, 'pct', x.pct)
               ORDER BY x.prod_date DESC, x.created_at DESC)
        FROM (SELECT * FROM f ORDER BY prod_date DESC, created_at DESC LIMIT v_lim) x JOIN "Material" m ON m.id = x.btp_id), '[]'::jsonb))
      INTO v_out;
  ELSE
    WITH bb AS MATERIALIZED (SELECT batch_id, btp_id, batch_code, batch_no, created_at, filled FROM mes_dash_batches(v_wh, v_from, v_to)),
    f AS MATERIALIZED (
      SELECT l.*, bb.btp_id, bb.batch_code, bb.batch_no, bb.created_at, bb.filled FROM mes_dash_lines(v_wh, v_from, v_to) l JOIN bb ON bb.batch_id = l.batch_id
       WHERE (v_shift IS NULL OR (v_shift = '__none' AND l.shift IS NULL) OR l.shift = v_shift)
         AND (v_btp IS NULL OR bb.btp_id = v_btp) AND (v_mat IS NULL OR l.material_id = v_mat)
         AND (v_only IS NULL OR l.state = v_only OR (v_only = 'edited' AND l.sheet <> l.std) OR (v_only = 'exec' AND l.iss <> l.sheet)))
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
END $$;

REVOKE ALL ON FUNCTION public.mes_req_state(numeric, numeric, numeric, boolean), public.mes_line_state(numeric, numeric, boolean, numeric, numeric, boolean),
  public.mes_batch_cells(text[]), public.mes_batch_agg(text[]), public.mes_batch_fact_build(text), public.mes_fact_touch(),
  public.mes_dash_batches(text, date, date), public.mes_dash_lines(text, date, date), public.mes_dashboard(jsonb), public.mes_dashboard_detail(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mes_dashboard(jsonb), public.mes_dashboard_detail(jsonb), public.mes_batch_fact_build(text) TO service_role;

-- ── 10. dựng sổ cho mọi mẻ đã nạp bồn ───────────────────────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT DISTINCT mv.batch_id FROM tank_movement mv WHERE mv.kind = 'FILL' AND mv.batch_id IS NOT NULL LOOP
    PERFORM mes_batch_fact_build(r.batch_id);
  END LOOP;
END $$;

-- ── 11. lưới tự kiểm ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r record; v_bad int; d jsonb; v_live record;
BEGIN
  -- (a) luật SQL = bảng ca dùng chung (backend/tests/unit/mesLineStateCases.json — cùng các ca test TS)
  SELECT count(*) INTO v_bad FROM (VALUES
    (90::numeric, 150::numeric, false, 1::numeric, 150::numeric, false, 'over'),
    (673.5::numeric, 600::numeric, false, 1::numeric, 600::numeric, false, 'under'),
    (100::numeric, 100::numeric, false, 1::numeric, 103::numeric, false, 'over'),
    (100::numeric, 100::numeric, false, 1::numeric, 100.8::numeric, false, 'ok'),
    (100::numeric, 100::numeric, false, 1::numeric, 40::numeric, false, 'progress'),
    (100::numeric, 100::numeric, false, 1::numeric, 0::numeric, false, 'none'),
    (100::numeric, 100::numeric, false, 1::numeric, 40::numeric, true, 'under'),
    (90::numeric, 150::numeric, false, 1::numeric, 100::numeric, false, 'progress'),
    (20::numeric, NULL::numeric, true, 1::numeric, 0::numeric, false, 'under'),
    (NULL::numeric, 5::numeric, false, 1::numeric, 5::numeric, false, 'extra'),
    (NULL::numeric, 5::numeric, false, 1::numeric, 2::numeric, false, 'progress'),
    (NULL::numeric, NULL::numeric, false, NULL::numeric, 3::numeric, false, 'extra'),
    (1.5::numeric, 1.5::numeric, false, NULL::numeric, 2::numeric, false, 'over'),
    (1.5::numeric, 1.5::numeric, false, NULL::numeric, 1.5::numeric, false, 'ok'),
    (150::numeric, 150::numeric, false, 1::numeric, 151::numeric, false, 'ok'),
    (100::numeric, 100::numeric, false, 1::numeric, 98.9::numeric, false, 'progress'),
    (100::numeric, 100::numeric, false, 1::numeric, 98.9::numeric, true, 'under'),
    (100::numeric, 100::numeric, false, NULL::numeric, 99.9996::numeric, false, 'ok'),
    (100::numeric, 100::numeric, false, NULL::numeric, 99.999::numeric, false, 'progress'),
    (20::numeric, 20::numeric, false, 1::numeric, 0::numeric, true, 'under')
  ) AS c(std, req, rm, tol, iss, closed, want) WHERE mes_line_state(c.std, c.req, c.rm, c.tol, c.iss, c.closed) IS DISTINCT FROM c.want;
  IF v_bad > 0 THEN RAISE EXCEPTION 'mes_line_state lệch bảng ca dùng chung ở % ca', v_bad; END IF;
  -- (b) sổ tổng hợp = tính trực tiếp, từng mẻ đã nạp
  FOR r IN SELECT f.* FROM production_batch_fact f LOOP
    SELECT * INTO v_live FROM mes_batch_agg(ARRAY[r.batch_id]);
    IF COALESCE(v_live.lines, 0) <> r.lines OR COALESCE(v_live.over, 0) <> r.over OR COALESCE(v_live.under, 0) <> r.under OR COALESCE(v_live.extra, 0) <> r.extra
       OR COALESCE(v_live.std_kg, 0) <> r.std_kg OR COALESCE(v_live.total_kg, 0) <> r.total_kg THEN
      RAISE EXCEPTION 'sổ tổng hợp mẻ % lệch tính trực tiếp', r.batch_code;
    END IF;
    IF (SELECT count(*) FROM production_batch_dev_line dl WHERE dl.batch_id = r.batch_id) <> r.over + r.under + r.extra THEN
      RAISE EXCEPTION 'mẻ %: số dòng NVL lệch trong sổ ≠ tổng vượt + dưới + ngoài', r.batch_code;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM tank_movement mv JOIN production_batch pb ON pb.id = mv.batch_id
              WHERE mv.kind = 'FILL' AND pb.status <> 'CANCELLED' AND NOT EXISTS (SELECT 1 FROM production_batch_fact f WHERE f.batch_id = mv.batch_id)) THEN
    RAISE EXCEPTION 'có mẻ đã nạp bồn mà chưa có sổ tổng hợp';
  END IF;
  -- (c) dashboard cả đời từng kho = cộng mọi mẻ chưa huỷ (tính trực tiếp) · bảng chi tiết cùng số mẻ / số dòng lệch
  FOR r IN SELECT warehouse_id, min(COALESCE(prod_date, created_at::date)) AS d0, max(COALESCE(prod_date, created_at::date)) AS d1
             FROM production_batch WHERE status <> 'CANCELLED' GROUP BY warehouse_id LOOP
    CONTINUE WHEN r.d1 - r.d0 > 1100;
    d := mes_dashboard(jsonb_build_object('warehouse_id', r.warehouse_id, 'date_from', r.d0, 'date_to', r.d1, 'grain', 'month'));
    SELECT count(*) AS n, COALESCE(sum(a.total_kg), 0) AS tot, COALESCE(sum(a.over + a.under + a.extra), 0) AS dev INTO v_live
      FROM production_batch pb LEFT JOIN mes_batch_agg(ARRAY[pb.id]) a ON true
     WHERE pb.warehouse_id = r.warehouse_id AND pb.status <> 'CANCELLED';
    IF (d->'totals'->>'batches')::int <> v_live.n OR (d->'totals'->>'total_kg')::numeric <> v_live.tot
       OR (d->'totals'->>'over')::int + (d->'totals'->>'under')::int + (d->'totals'->>'extra')::int <> v_live.dev THEN
      RAISE EXCEPTION 'mes_dashboard kho %: % mẻ / lệch % / dòng lệch % ≠ tính trực tiếp % / % / %', r.warehouse_id,
        d->'totals'->>'batches', d->'totals'->>'total_kg', (d->'totals'->>'over')::int + (d->'totals'->>'under')::int + (d->'totals'->>'extra')::int, v_live.n, v_live.tot, v_live.dev;
    END IF;
    IF (mes_dashboard_detail(jsonb_build_object('warehouse_id', r.warehouse_id, 'date_from', r.d0, 'date_to', r.d1, 'kind', 'batches'))->>'total')::int <> v_live.n
       OR (mes_dashboard_detail(jsonb_build_object('warehouse_id', r.warehouse_id, 'date_from', r.d0, 'date_to', r.d1, 'kind', 'lines'))->>'total')::int <> v_live.dev
       OR (d->>'pareto_total')::int <> v_live.dev THEN
      RAISE EXCEPTION 'mes_dashboard_detail kho %: số mẻ / số dòng lệch không khớp dashboard', r.warehouse_id;
    END IF;
  END LOOP;
END $$;

COMMIT;
