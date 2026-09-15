-- 20260915b — LỆNH FILL THEO NGÀY (user chốt 15/09):
--   "1 ngày, 1 kho, 1 loại kho chỉ có 1 lệnh fill — chi tiết trong đó thay đổi, cuối ngày Hoàn thành"
--   + "lệnh fill có thể được vào gán người, và người đó sẽ nhận kế hoạch cả ngày".
--
-- VÌ SAO ĐỔI MÔ HÌNH: bản 05/08 đóng đinh "một lần bấm Ra lệnh = MỘT lệnh" — đúng khi fill 100% do
-- người bấm (mỗi mẻ là một quyết định có chủ). Nhưng từ 15/09 MÁY cũng ra lệnh, mà máy không quyết
-- từng mẻ: nó liên tục trả lời MỘT câu hỏi "hôm nay kho này còn thiếu gì ở ô lẻ". Đơn vị công việc
-- đúng vì thế là TRẠNG THÁI của một ngày, không phải SỰ KIỆN của một lần bấm. Hệ quả đo được của mô
-- hình cũ: đơn phát sinh làm tăng nhu cầu cho mã ĐÃ có dòng treo cùng NSX thì dòng mới đụng khoá
-- uq_filltask_pending_matdate ⇒ đường tự động nuốt 23505 và phần tăng KHÔNG BAO GIỜ thành lệnh
-- (đường bấm tay thì cộng dồn — hai cửa cùng một sổ mà khác luật, lớp lỗi quen thuộc).
--
-- SAU MIGRATION NÀY:
--   · khoá ổn định (kho, ngày xuất, loại kho) ⇒ mọi thay đổi là UPDATE dòng, không còn tranh INSERT;
--   · giảm được TỪNG PHẦN (không còn "thừa 30 mà dòng 100 nên không rút gì"), sàn = phần ĐÃ QUÉT;
--   · lệnh KHÔNG tự DONE khi hết dòng treo — nếu tự đóng thì 10h sáng đóng, 11h có đơn mới là phải
--     mở lại một chứng từ đã đóng. Lệnh chỉ ĐANG MỞ (PENDING) → ĐÃ CHỐT (DONE, cuối ngày);
--   · gán người ở cấp LỆNH = nhận kế hoạch cả ngày, dòng máy thêm sau tự kế thừa người đó.
--
-- Idempotent (chạy lại không hỏng).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Cột mới trên FillOrder
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "FillOrder"
  ADD COLUMN IF NOT EXISTS warehouse_type text,                       -- NULL = mã chưa khai Loại kho
  ADD COLUMN IF NOT EXISTS assignee_id    text REFERENCES "Employee"(id),
  ADD COLUMN IF NOT EXISTS assignee_name  text,
  ADD COLUMN IF NOT EXISTS assigned_by    text,
  ADD COLUMN IF NOT EXISTS assigned_at    timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by      text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) GỘP lệnh đang mở về đúng một lệnh cho mỗi (kho, ngày, loại kho)
--    Chỉ đụng lệnh/dòng còn PENDING — lịch sử đã chốt giữ nguyên hình dạng cũ.
-- ─────────────────────────────────────────────────────────────────────────────
WITH tcat AS (
  SELECT t.id AS task_id, t.fill_order_id, t.warehouse_id, t.target_date,
         COALESCE(m.category, '') AS cat
  FROM "FillTask" t
  LEFT JOIN "Material" m ON m.id = t.material_id
  WHERE t.status = 'PENDING' AND t.fill_order_id IS NOT NULL
), grp AS (
  -- lệnh đích của mỗi nhóm = lệnh CŨ NHẤT đang chứa dòng của nhóm đó (giữ mã lệnh người đã nhìn thấy)
  SELECT DISTINCT ON (c.warehouse_id, c.target_date, c.cat)
         c.warehouse_id, c.target_date, c.cat, o.id AS order_id
  FROM tcat c JOIN "FillOrder" o ON o.id = c.fill_order_id
  ORDER BY c.warehouse_id, c.target_date, c.cat, o.created_at, o.id
)
UPDATE "FillTask" t
   SET fill_order_id = g.order_id, updated_at = now()
  FROM tcat c
  JOIN grp g ON g.warehouse_id = c.warehouse_id AND g.target_date = c.target_date AND g.cat = c.cat
 WHERE t.id = c.task_id AND t.fill_order_id IS DISTINCT FROM g.order_id;

-- Vết quét đi theo dòng của nó (cột fill_order_id trên FillTaskScan là bản sao để lọc nhanh)
UPDATE "FillTaskScan" s
   SET fill_order_id = t.fill_order_id
  FROM "FillTask" t
 WHERE t.id = s.task_id AND s.fill_order_id IS DISTINCT FROM t.fill_order_id;

-- Khai Loại kho cho lệnh còn mở (sau khi gộp thì mỗi lệnh chỉ còn một loại)
WITH oc AS (
  SELECT t.fill_order_id AS oid,
         min(COALESCE(m.category, ''))                AS cat,
         count(DISTINCT COALESCE(m.category, ''))     AS n
  FROM "FillTask" t
  LEFT JOIN "Material" m ON m.id = t.material_id
  WHERE t.status = 'PENDING' AND t.fill_order_id IS NOT NULL
  GROUP BY 1
)
UPDATE "FillOrder" o
   SET warehouse_type = NULLIF(oc.cat, ''), updated_at = now()
  FROM oc
 WHERE o.id = oc.oid AND oc.n = 1 AND o.warehouse_type IS DISTINCT FROM NULLIF(oc.cat, '');

-- Lệnh bị rút hết dòng treo: còn dòng lịch sử ⇒ coi như ĐÃ CHỐT; rỗng hoàn toàn ⇒ xoá vỏ
UPDATE "FillOrder" o
   SET status = 'DONE', closed_at = now(), closed_by = 'Hệ thống (gộp lệnh theo ngày)', updated_at = now()
 WHERE o.status = 'PENDING'
   AND EXISTS (SELECT 1 FROM "FillTask" t WHERE t.fill_order_id = o.id)
   AND NOT EXISTS (SELECT 1 FROM "FillTask" t WHERE t.fill_order_id = o.id AND t.status = 'PENDING');

DELETE FROM "FillOrder" o
 WHERE o.status = 'PENDING'
   AND NOT EXISTS (SELECT 1 FROM "FillTask"     t WHERE t.fill_order_id = o.id)
   AND NOT EXISTS (SELECT 1 FROM "FillTaskScan" s WHERE s.fill_order_id = o.id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Khoá "một lệnh ĐANG MỞ cho mỗi (kho, ngày, loại)"
--    Chỉ áp cho PENDING: ngày đã chốt rồi mà phát sinh đơn muộn thì vẫn mở được lệnh mới —
--    khoá cả DONE là biến "chốt sổ" thành ngõ cụt.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE dup int;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT 1 FROM "FillOrder" WHERE status = 'PENDING'
     GROUP BY warehouse_id, target_date, COALESCE(warehouse_type, '') HAVING count(*) > 1
  ) d;
  IF dup > 0 THEN
    RAISE EXCEPTION 'Còn % nhóm (kho, ngày, loại) có >1 lệnh đang mở — dừng migration, xem lại bước gộp', dup;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fillorder_open
  ON "FillOrder" (warehouse_id, target_date, COALESCE(warehouse_type, ''))
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_fillorder_assignee
  ON "FillOrder" (assignee_id, target_date) WHERE assignee_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Rollup KHÔNG còn tự đóng lệnh
--    Giữ nguyên chữ ký (fill_scan_apply + fill_scan_wh_direct + controller đang gọi) nhưng đổi
--    nghĩa: lệnh của một ngày sống tới lúc được CHỐT. Tiến độ hiện bằng số dòng/thùng đã xong,
--    không bằng trạng thái lệnh.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fill_order_rollup(p_order_id text, p_now timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM "FillOrder" WHERE id = p_order_id;
  IF st IS NULL THEN RETURN NULL; END IF;
  UPDATE "FillOrder" SET updated_at = p_now WHERE id = p_order_id;
  RETURN st;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) fill_order_ensure — lấy-hoặc-tạo lệnh ĐANG MỞ của (kho, ngày, loại)
--    Trả cả người đang giữ kế hoạch để dòng mới KẾ THỪA: gán ở cấp lệnh = "nhận kế hoạch cả ngày",
--    nên dòng máy thêm lúc 11h phải thuộc về đúng người đã nhận từ 7h, không thì lời hứa đó rỗng.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fill_order_ensure(
  p_id           text,      -- id dựng sẵn ở caller (chỉ dùng khi phải TẠO)
  p_warehouse_id text,
  p_target_date  date,
  p_type         text,      -- NULL = mã chưa khai Loại kho
  p_order_code   text,
  p_auto         boolean,
  p_actor        text,
  p_now          text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE o "FillOrder"%ROWTYPE;
BEGIN
  FOR i IN 1..3 LOOP
    SELECT * INTO o FROM "FillOrder"
     WHERE warehouse_id = p_warehouse_id AND target_date = p_target_date
       AND COALESCE(warehouse_type, '') = COALESCE(p_type, '') AND status = 'PENDING'
     LIMIT 1;
    IF FOUND THEN RETURN to_jsonb(o) || jsonb_build_object('created', false); END IF;

    BEGIN
      INSERT INTO "FillOrder"(id, order_code, warehouse_id, target_date, warehouse_type,
                              status, auto_created, created_by, created_at, updated_at)
      VALUES (p_id, p_order_code, p_warehouse_id, p_target_date, p_type,
              'PENDING', COALESCE(p_auto, false), p_actor, p_now::timestamptz, p_now::timestamptz)
      RETURNING * INTO o;
      RETURN to_jsonb(o) || jsonb_build_object('created', true);
    EXCEPTION WHEN unique_violation THEN
      -- người khác vừa tạo (khoá ngày HOẶC khoá mã lệnh) → vòng sau đọc lại / caller đổi mã
      IF i = 3 THEN RETURN NULL; END IF;
      PERFORM pg_sleep(0.05 * i);
    END;
  END LOOP;
  RETURN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) fill_task_reduce — HẠ số lượng một dòng (thay cho "huỷ trọn dòng")
--    Sàn = phần ĐÃ QUÉT (user chốt): người đã hạ 60/100 thì dòng thành 60 và đóng, không thành 40.
--    Chỉ đụng dòng do MÁY đặt — giảm dòng người đặt là rút quyết định của người.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fill_task_reduce(
  p_task_id    text,
  p_target_qty numeric,
  p_reason     text,
  p_now        text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  t        "FillTask"%ROWTYPE;
  v_done   numeric;
  v_new    numeric;
  v_pal    int;
BEGIN
  SELECT * INTO t FROM "FillTask" WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND                     THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF t.status <> 'PENDING'         THEN RETURN jsonb_build_object('code', 'NOT_PENDING'); END IF;
  IF COALESCE(t.created_by,'') <> 'Hệ thống' THEN RETURN jsonb_build_object('code', 'MANUAL'); END IF;

  v_done := COALESCE(t.qty_done_base, 0);
  v_new  := GREATEST(COALESCE(p_target_qty, 0), v_done);
  IF v_new >= t.qty_base THEN RETURN jsonb_build_object('code', 'NOOP'); END IF;

  IF v_new <= 0 THEN
    UPDATE "FillTask"
       SET status = 'CANCELLED', cancel_reason = p_reason, updated_at = p_now::timestamptz
     WHERE id = t.id;
    RETURN jsonb_build_object('code', 'CANCELLED', 'freed', t.qty_base - v_done);
  END IF;

  -- Số pallet co theo SL, nhưng không thấp hơn số pallet đã quét (đã hạ rồi thì có thật)
  v_pal := GREATEST(COALESCE(t.scanned_pallets, 0), 1,
                    CEIL(v_new / NULLIF(t.qty_base, 0) * GREATEST(t.required_pallets, 1))::int);
  UPDATE "FillTask"
     SET qty_base = v_new, required_pallets = v_pal,
         status   = CASE WHEN v_done > 0 AND v_new <= v_done THEN 'DONE' ELSE 'PENDING' END,
         done_at  = CASE WHEN v_done > 0 AND v_new <= v_done THEN p_now::timestamptz ELSE done_at END,
         updated_at = p_now::timestamptz
   WHERE id = t.id;
  RETURN jsonb_build_object('code', 'REDUCED', 'freed', t.qty_base - v_new, 'qty', v_new);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) fill_order_close — CHỐT NGÀY
--    Dòng còn treo lúc chốt thì huỷ kèm lý do (xe đã đi rồi) — để lại dòng PENDING trong một lệnh
--    đã đóng là đẻ ra việc mồ côi không ai nhìn. Phần huỷ này cũng chính là mẫu số của báo cáo
--    "tỷ lệ hoàn thành" nên nó phải có vết, không được xoá.
-- ─────────────────────────────────────────────────────────────────────────────
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
     SET status = 'CANCELLED', cancel_reason = 'Chốt ngày — chưa thực hiện', updated_at = p_now::timestamptz
   WHERE fill_order_id = o.id AND status = 'PENDING';
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE "FillOrder"
     SET status = 'DONE', closed_at = p_now::timestamptz, closed_by = p_actor, updated_at = p_now::timestamptz
   WHERE id = o.id;
  RETURN jsonb_build_object('code', 'CLOSED', 'order_code', o.order_code, 'cancelled_lines', n);
END $$;
