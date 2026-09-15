-- 20260915d — FILL HÀNG: HÀNG ĐỢI ĐỐI CHIẾU THEO (kho, ngày xuất) + báo cáo tính dòng "chốt ngày — chưa thực hiện"
--
-- Ba việc user chốt 15/09 (vòng 3) sau khi rà rủi ro:
--
-- (1) "Đơn nhặt lẻ của NGÀY nào đổi thì máy ra lệnh cho NGÀY đó" — thay cho "có người mở trang thì soát
--     lại HÔM NAY, nghỉ 10 phút giữa hai lượt". Khuôn = `wms_replan_queue` (14/09): trigger ghi (kho, ngày)
--     vào hàng đợi khi đơn / chuyến / tồn ở ô lẻ / việc LOOSE_FEED đổi; lần đọc kế tiếp lấy dòng ra (DELETE
--     … RETURNING = nguyên tử, chỉ MỘT instance lấy được) rồi đối chiếu đúng ngày đó. Chân trời = hôm nay
--     và ngày mai: ca 22h chuẩn bị cho chuyến NGÀY MAI là lúc kho cần lệnh fill nhất, mà bản "chỉ hôm nay"
--     bỏ đúng ca đó. Không có pg_cron nên vẫn giữ một lượt QUÉT AN TOÀN mỗi 30 phút (thứ trigger bỏ sót:
--     quét nhặt lẻ làm nhu cầu tụt, đổi công tắc…) — nhưng mốc quét nằm Ở DB, không trong RAM lambda.
--
-- (2) THUÊ (lease) theo kho: hai instance cùng thấy "thiếu 100" thì `fill_task_topup` cộng delta hai lần —
--     dòng máy đặt tự hạ lại ở lượt sau, dòng NGƯỜI đặt thì thừa vĩnh viễn (máy không hạ dòng người).
--     `fill_reconcile_take` khoá dòng trạng thái của kho (FOR UPDATE), cấp lease 90 s; ai không có lease
--     thì để yên hàng đợi cho lượt sau. Lease hết hạn tự nhả — tiến trình chết không khoá kho mãi.
--
-- (3) Báo cáo Kết quả: `fill_report` lọc `status <> 'CANCELLED'` nên dòng "Chốt ngày — chưa thực hiện"
--     BIẾN MẤT khỏi mẫu số ⇒ sau chốt ai cũng 100 % — đúng lớp "đo mức phục vụ xoá dấu vết" (28/08).
--     Migration 20260915b tự hứa "phần huỷ này là mẫu số" mà RPC báo cáo không đọc. Nay chữ lý do có MỘT
--     nguồn (`fill_close_reason()`), cửa chốt ghi bằng nó, báo cáo đếm theo nó (cột `missed_n`).
--
-- Idempotent (chạy lại không hỏng).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) fill_close_reason — một chuỗi, hai chỗ dùng (cửa chốt + báo cáo)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fill_close_reason() RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'Chốt ngày — chưa thực hiện'::text $$;

CREATE OR REPLACE FUNCTION fill_order_close(
  p_order_id text,
  p_actor    text,
  p_now      text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE o "FillOrder"%ROWTYPE; n int;
BEGIN
  SELECT * INTO o FROM "FillOrder" WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND              THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF o.status <> 'PENDING'  THEN RETURN jsonb_build_object('code', 'NOT_OPEN', 'status', o.status); END IF;

  UPDATE "FillTask"
     SET status = 'CANCELLED', cancel_reason = fill_close_reason(), updated_at = p_now::timestamptz
   WHERE fill_order_id = o.id AND status = 'PENDING';
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE "FillOrder"
     SET status = 'DONE', closed_at = p_now::timestamptz, closed_by = p_actor, updated_at = p_now::timestamptz
   WHERE id = o.id;
  RETURN jsonb_build_object('code', 'CLOSED', 'order_code', o.order_code, 'cancelled_lines', n);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) fill_report — dòng huỷ vì CHỐT NGÀY ở lại mẫu số (missed_n); dòng máy thu hồi / người huỷ vẫn bỏ
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fill_report(
  p_wh_scope     text[],
  p_warehouse_id text,
  p_from         date,
  p_to           date
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
BEGIN
  IF p_wh_scope IS NOT NULL AND p_warehouse_id IS NOT NULL
     AND NOT (p_warehouse_id = ANY (p_wh_scope)) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'total', 0, 'done', 0, 'missed', 0, 'qty_entry', 0, 'unassigned', 0);
  END IF;

  RETURN (
    WITH t AS (
      SELECT f.*,
             qty_entry_decimal(f.qty_base, m.entry_unit, m.units_per_carton)      AS qty_entry,
             qty_entry_decimal(f.qty_done_base, m.entry_unit, m.units_per_carton) AS qty_done_entry,
             (f.status = 'CANCELLED' AND f.cancel_reason = fill_close_reason())   AS missed
      FROM "FillTask" f
      LEFT JOIN "Material" m ON m.id = f.material_id
      WHERE (f.status <> 'CANCELLED' OR f.cancel_reason = fill_close_reason())
        AND (p_warehouse_id IS NULL OR f.warehouse_id = p_warehouse_id)
        AND (p_wh_scope     IS NULL OR f.warehouse_id = ANY (p_wh_scope))
        AND (p_from IS NULL OR f.target_date >= p_from)
        AND (p_to   IS NULL OR f.target_date <= p_to)
    ),
    g AS (
      SELECT COALESCE(assignee_id, '__none__')                       AS assignee_id,
             COALESCE(max(assignee_name), 'Chưa gán')                AS assignee_name,
             count(*)                                                AS total_n,
             count(*) FILTER (WHERE status = 'DONE')                 AS done_n,
             count(*) FILTER (WHERE missed)                          AS missed_n,
             sum(qty_done_entry)                                     AS done_qty_entry,
             sum(qty_entry)                                          AS total_qty_entry,
             avg(EXTRACT(EPOCH FROM (done_at - COALESCE(assigned_at, created_at))) / 60.0)
               FILTER (WHERE status = 'DONE' AND done_at IS NOT NULL) AS avg_minutes
      FROM t GROUP BY COALESCE(assignee_id, '__none__')
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'assignee_id',     CASE WHEN assignee_id = '__none__' THEN NULL ELSE assignee_id END,
                 'assignee_name',   assignee_name,
                 'total_n',         total_n,
                 'done_n',          done_n,
                 'missed_n',        missed_n,
                 'pending_n',       total_n - done_n - missed_n,
                 'done_qty_entry',  COALESCE(done_qty_entry, 0),
                 'total_qty_entry', COALESCE(total_qty_entry, 0),
                 'avg_minutes',     CASE WHEN avg_minutes IS NULL THEN NULL ELSE round(avg_minutes::numeric, 1) END,
                 'rate',            CASE WHEN total_n = 0 THEN 0 ELSE round(done_n::numeric * 100 / total_n, 1) END)
               ORDER BY done_n::numeric / NULLIF(total_n, 0) NULLS FIRST, total_n DESC)
               FROM g), '[]'::jsonb),
      'total',      (SELECT count(*) FROM t),
      'done',       (SELECT count(*) FROM t WHERE status = 'DONE'),
      'missed',     (SELECT count(*) FROM t WHERE missed),
      'unassigned', (SELECT count(*) FROM t WHERE assignee_id IS NULL),
      'qty_entry',  (SELECT COALESCE(sum(qty_done_entry), 0) FROM t)
    )
  );
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Hàng đợi + trạng thái đối chiếu (bảng NỘI BỘ: không realtime, RLS đóng như wms_replan_queue)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fill_reconcile_queue (
  warehouse_id text        NOT NULL,
  target_date  date        NOT NULL,
  queued_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, target_date)
);
DROP TRIGGER IF EXISTS trg_wms_notify ON public.fill_reconcile_queue;
ALTER TABLE public.fill_reconcile_queue ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.fill_reconcile_state (
  warehouse_id text PRIMARY KEY,
  last_sweep   timestamptz,            -- lượt quét an toàn gần nhất (thay throttle trong RAM lambda)
  lease_until  timestamptz,            -- instance đang đối chiếu giữ kho tới lúc này
  updated_at   timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_wms_notify ON public.fill_reconcile_state;
ALTER TABLE public.fill_reconcile_state ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) fill_reconcile_enqueue — ghi (kho, ngày) nếu kho có bật tự ra lệnh và ngày trong chân trời
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fill_reconcile_enqueue(p_wh text, p_date date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
BEGIN
  IF p_wh IS NULL OR p_date IS NULL THEN RETURN; END IF;
  -- CHÂN TRỜI hôm nay + mai: ngày xa hơn được lượt quét an toàn bắt khi tới lượt; ngày đã qua thì xe đi rồi
  IF p_date < today OR p_date > today + 1 THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Warehouse" w WHERE w.id = p_wh AND w.auto_fill = true)
     AND NOT EXISTS (SELECT 1 FROM warehouse_type_configs c WHERE c.warehouse_id = p_wh AND c.auto_fill = true)
  THEN RETURN; END IF;
  INSERT INTO fill_reconcile_queue (warehouse_id, target_date, queued_at)
  VALUES (p_wh, p_date, now())
  ON CONFLICT (warehouse_id, target_date) DO UPDATE SET queued_at = EXCLUDED.queued_at;
EXCEPTION WHEN OTHERS THEN
  RETURN;   -- hàng đợi hỏng không được làm hỏng giao dịch nghiệp vụ
END $$;

-- 4a) Đơn nhặt lẻ đổi (nhu cầu) — chỉ dòng CÓ nhặt lẻ; KHÔNG bắt cartons_scanned (đường nóng của PDA,
--     quét từ ô lẻ làm cần và có cùng tụt nên "thiếu" không đổi; lượt quét an toàn bù ca lấy nguyên pallet)
CREATE OR REPLACE FUNCTION public.fill_enqueue_from_item() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; g record;
BEGIN
  r := COALESCE(NEW, OLD);
  IF r.do_id IS NULL THEN RETURN NULL; END IF;
  IF COALESCE(NEW.loose_picking, 0) <= 0 AND COALESCE(OLD.loose_picking, 0) <= 0 THEN RETURN NULL; END IF;
  SELECT g2.warehouse_id, g2.delivery_date INTO g
  FROM "OutboundDelivery" d JOIN "GroupDeliveryOrder" g2 ON g2.id = d.gdo_id
  WHERE d.id = r.do_id;
  IF FOUND THEN PERFORM fill_reconcile_enqueue(g.warehouse_id, g.delivery_date); END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_fill_enqueue_item ON public."OutboundItem";
CREATE TRIGGER trg_fill_enqueue_item
  AFTER INSERT OR DELETE OR UPDATE OF loose_picking, cartons_ordered, status, date_rule, material_id
  ON public."OutboundItem"
  FOR EACH ROW EXECUTE FUNCTION public.fill_enqueue_from_item();

-- 4b) Chuyến đổi ngày / huỷ / bất động / sống lại / đổi kho — ghi CẢ ngày cũ lẫn ngày mới
CREATE OR REPLACE FUNCTION public.fill_enqueue_from_gdo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM fill_reconcile_enqueue(OLD.warehouse_id, OLD.delivery_date); END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN PERFORM fill_reconcile_enqueue(NEW.warehouse_id, NEW.delivery_date); END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_fill_enqueue_gdo ON public."GroupDeliveryOrder";
CREATE TRIGGER trg_fill_enqueue_gdo
  AFTER INSERT OR DELETE OR UPDATE OF delivery_date, status, awaiting_sap, plan_dropped, warehouse_id
  ON public."GroupDeliveryOrder"
  FOR EACH ROW EXECUTE FUNCTION public.fill_enqueue_from_gdo();

-- 4c) Tồn ở Ô NHẶT LẺ đổi (hàng vào/ra ô lẻ bằng bất kỳ đường nào: fill tay, phiếu nhập cất thẳng,
--     chuyển vị trí, nhặt lẻ trừ dần) — ngày nào cũng có thể bị ảnh hưởng ⇒ ghi cả hôm nay lẫn mai
CREATE OR REPLACE FUNCTION public.fill_enqueue_from_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE wh text; today date; pf boolean;
BEGIN
  SELECT true INTO pf FROM "Location" l
   WHERE l.is_pick_face AND l.id IN (NEW.location_id, OLD.location_id) LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  wh := COALESCE(NEW.warehouse_id, OLD.warehouse_id);
  today := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  PERFORM fill_reconcile_enqueue(wh, today);
  PERFORM fill_reconcile_enqueue(wh, today + 1);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_fill_enqueue_entry ON public."InventoryEntry";
CREATE TRIGGER trg_fill_enqueue_entry
  AFTER INSERT OR DELETE OR UPDATE OF status, cartons_remaining, cartons_reserved, location_id, warehouse_id
  ON public."InventoryEntry"
  FOR EACH ROW EXECUTE FUNCTION public.fill_enqueue_from_entry();

-- 4d) Việc LOOSE_FEED của bộ lập kế hoạch (đường hạ hàng thứ hai — Fill trừ nó vào "đang có lệnh")
CREATE OR REPLACE FUNCTION public.fill_enqueue_from_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; g record;
BEGIN
  r := COALESCE(NEW, OLD);
  IF r.kind IS DISTINCT FROM 'LOOSE_FEED' OR r.gdo_id IS NULL THEN RETURN NULL; END IF;
  SELECT warehouse_id, delivery_date INTO g FROM "GroupDeliveryOrder" WHERE id = r.gdo_id;
  IF FOUND THEN PERFORM fill_reconcile_enqueue(g.warehouse_id, g.delivery_date); END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_fill_enqueue_task ON public.wms_tasks;
CREATE TRIGGER trg_fill_enqueue_task
  AFTER INSERT OR DELETE OR UPDATE OF status, qty_base
  ON public.wms_tasks
  FOR EACH ROW EXECUTE FUNCTION public.fill_enqueue_from_task();

-- 4e) Bật công tắc (kho hoặc loại kho) ⇒ soát ngay, không chờ lượt quét an toàn
CREATE OR REPLACE FUNCTION public.fill_enqueue_from_switch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE wh text; today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
BEGIN
  wh := CASE WHEN TG_TABLE_NAME = 'Warehouse' THEN NEW.id ELSE NEW.warehouse_id END;
  PERFORM fill_reconcile_enqueue(wh, today);
  PERFORM fill_reconcile_enqueue(wh, today + 1);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_fill_enqueue_switch_wh ON public."Warehouse";
CREATE TRIGGER trg_fill_enqueue_switch_wh
  AFTER UPDATE OF auto_fill ON public."Warehouse"
  FOR EACH ROW WHEN (NEW.auto_fill = true) EXECUTE FUNCTION public.fill_enqueue_from_switch();
DROP TRIGGER IF EXISTS trg_fill_enqueue_switch_type ON public.warehouse_type_configs;
CREATE TRIGGER trg_fill_enqueue_switch_type
  AFTER INSERT OR UPDATE OF auto_fill ON public.warehouse_type_configs
  FOR EACH ROW WHEN (NEW.auto_fill = true) EXECUTE FUNCTION public.fill_enqueue_from_switch();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) fill_reconcile_take — MỘT round-trip: lấy ngày cần soát + thuê kho
--    Trả {leased, days[]}. leased=false ⇒ kho đang có instance khác đối chiếu (hoặc không có gì để làm);
--    hàng đợi để nguyên cho lượt sau. days gồm dòng hàng đợi (≤ hôm nay+1) và, tới hạn quét an toàn,
--    cả hôm nay lẫn mai. Dòng của ngày ĐÃ QUA bị xoá (xe đi rồi, chốt lười lo phần còn lại).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fill_reconcile_take(
  p_wh      text,
  p_today   date,
  p_sweep_s int DEFAULT 1800,
  p_lease_s int DEFAULT 90
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st fill_reconcile_state%ROWTYPE; days date[] := '{}';
BEGIN
  INSERT INTO fill_reconcile_state (warehouse_id) VALUES (p_wh) ON CONFLICT (warehouse_id) DO NOTHING;
  SELECT * INTO st FROM fill_reconcile_state WHERE warehouse_id = p_wh FOR UPDATE;
  IF st.lease_until IS NOT NULL AND st.lease_until > now() THEN
    RETURN jsonb_build_object('leased', false, 'busy', true, 'days', '[]'::jsonb);
  END IF;

  DELETE FROM fill_reconcile_queue WHERE warehouse_id = p_wh AND target_date < p_today;
  WITH x AS (
    DELETE FROM fill_reconcile_queue
     WHERE warehouse_id = p_wh AND target_date <= p_today + 1
     RETURNING target_date
  )
  SELECT COALESCE(array_agg(target_date), '{}') INTO days FROM x;

  IF st.last_sweep IS NULL OR st.last_sweep < now() - make_interval(secs => p_sweep_s) THEN
    days := days || p_today || (p_today + 1);
    UPDATE fill_reconcile_state SET last_sweep = now(), updated_at = now() WHERE warehouse_id = p_wh;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), '{}') INTO days FROM unnest(days) u;
  IF COALESCE(array_length(days, 1), 0) = 0 THEN
    RETURN jsonb_build_object('leased', false, 'busy', false, 'days', '[]'::jsonb);
  END IF;

  UPDATE fill_reconcile_state
     SET lease_until = now() + make_interval(secs => p_lease_s), updated_at = now()
   WHERE warehouse_id = p_wh;
  RETURN jsonb_build_object('leased', true, 'busy', false, 'days', to_jsonb(days));
END $$;

-- Thuê riêng cho đường BẤM TAY (POST /wms/fill/auto): cùng một ổ khoá với đường tự động
CREATE OR REPLACE FUNCTION public.fill_reconcile_lease(p_wh text, p_lease_s int DEFAULT 90) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st fill_reconcile_state%ROWTYPE;
BEGIN
  INSERT INTO fill_reconcile_state (warehouse_id) VALUES (p_wh) ON CONFLICT (warehouse_id) DO NOTHING;
  SELECT * INTO st FROM fill_reconcile_state WHERE warehouse_id = p_wh FOR UPDATE;
  IF st.lease_until IS NOT NULL AND st.lease_until > now() THEN RETURN false; END IF;
  UPDATE fill_reconcile_state
     SET lease_until = now() + make_interval(secs => p_lease_s), updated_at = now()
   WHERE warehouse_id = p_wh;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.fill_reconcile_release(p_wh text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE fill_reconcile_state SET lease_until = NULL, updated_at = now() WHERE warehouse_id = p_wh
$$;
