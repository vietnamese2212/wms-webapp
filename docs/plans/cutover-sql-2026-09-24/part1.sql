-- ============================================================================
-- CUTOVER production 24/09/2026 — PART 1/10
-- 24 migration · 20260815d_putaway_rules.sql → 20260821i_inventory_summary_by_unit.sql
-- Dán TRỌN file vào Supabase SQL Editor của project PRODUCTION svicyfquresxaigfxsdb rồi Run.
-- Cả part nằm trong MỘT transaction: lỗi bất kỳ đâu = rollback trọn part, schema không dở dang.
-- Chạy lại lần hai sẽ báo "đã tồn tại" rồi tự rollback — không hỏng gì.
-- ============================================================================
BEGIN;


-- ─────────────────────────────────────────────────────────────────────────
-- [20260815d_putaway_rules.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- QUY TẮC CẤT HÀNG (putaway) THEO KHO — đợt A: nền dữ liệu + RPC gom "sự thật của ô".
-- Đối xứng với đợt 1 luân chuyển (20260814c): LẤY hàng và CẤT hàng là hai nửa của cùng một
-- nguyên tắc vận hành kho, nên cùng khai ở form Kho.
--
-- MẶC ĐỊNH = ĐÚNG HÀNH VI HÔM NAY ⇒ apply migration KHÔNG kho nào đổi cách chạy:
--   priority='CONSOLIDATE' (gom cùng mã — chính là ★ đang có), date_mix='ANY',
--   mọi cờ chặn = false, max_materials = NULL (không giới hạn).
-- Bật từng luật là quyết định vận hành của từng kho.

-- [cutover] gỡ: BEGIN;

ALTER TABLE public."Warehouse"
  ADD COLUMN IF NOT EXISTS putaway_priority        text    NOT NULL DEFAULT 'CONSOLIDATE',
  -- đợt B mới nối vào cửa ghi; khai sẵn ở đây để không phải migration lần hai
  ADD COLUMN IF NOT EXISTS putaway_required        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS putaway_max_materials   integer,          -- NULL = không giới hạn số mã/ô
  ADD COLUMN IF NOT EXISTS putaway_date_mix        text    NOT NULL DEFAULT 'ANY',
  ADD COLUMN IF NOT EXISTS putaway_block_pick_face boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS putaway_block_qa_hold   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS putaway_block_full      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS putaway_single_ncc      boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_putaway_priority_chk') THEN
    ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_putaway_priority_chk
      CHECK (putaway_priority IN ('CONSOLIDATE', 'SPREAD', 'ABC'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_putaway_date_mix_chk') THEN
    ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_putaway_date_mix_chk
      CHECK (putaway_date_mix IN ('ANY', 'SAME', 'NEWER_ONLY', 'OLDER_ONLY'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_putaway_max_materials_chk') THEN
    ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_putaway_max_materials_chk
      CHECK (putaway_max_materials IS NULL OR putaway_max_materials >= 1);
  END IF;
END $$;

COMMENT ON COLUMN public."Warehouse".putaway_priority IS
  'Ưu tiên gợi ý chỗ cất: CONSOLIDATE gom cùng mã | SPREAD rải vào ô còn nhiều chỗ | ABC theo hạng nhặt khu';
COMMENT ON COLUMN public."Warehouse".putaway_date_mix IS
  'Trộn date trong 1 ô: ANY tự do | SAME chỉ cùng date | NEWER_ONLY pallet mới phải có date >= mọi pallet đang có | OLDER_ONLY <=. "Date" = HSD nếu kho FEFO, NSX nếu FIFO/LIFO (utils/rotation.ts)';

-- ─────────────────────────────────────────────────────────────────────────────
-- SỰ THẬT CỦA Ô (slot facts) — gom trong SQL, MỘT round-trip cho cả danh sách.
--
-- Vì sao không kéo dòng tồn về backend rồi tự đếm: 50 ô nặng nhất của staging = 2.951 pallet
-- (1 ô cá biệt 115 pallet, 69 mã). Kéo đủ cột date/NCC/QA về là ~740KB MỖI LẦN GÕ PHÍM ở ô
-- tìm vị trí. Ở đây trả về mỗi ô một dòng.
--
-- `lots` KHÔNG phải danh sách pallet mà là danh sách NHÓM (mã, NCC, shelf-life khai theo lô,
-- có-HSD-tường-minh-hay-không) kèm min/max ngày trong nhóm. Trong một nhóm, shelf-life là HẰNG
-- SỐ nên thứ tự theo NSX trùng thứ tự theo HSD suy ra ⇒ min/max của nhóm ĐỦ để backend tính
-- đúng ngày sớm nhất / muộn nhất của cả ô, mà không cần kéo từng pallet. Tách nhóm theo
-- (expiry_date IS NULL) vì pallet có HSD tường minh (tem V2) và pallet suy từ NSX (tem V1)
-- không so sánh chung công thức được.
--
-- CHỦ ĐÍCH: hàm KHÔNG tự tính shelf-life. Luật shelf-life theo NCC nằm ở utils/shelfLife.ts;
-- chép nó xuống SQL là đẻ bản thứ hai — đúng thứ đợt luân chuyển 14/08 vừa dọn.
-- `lots` chỉ cần khi kho BẬT luật trộn date (mặc định 'ANY' = tắt) ⇒ mặc định KHÔNG trả, để
-- đường chạy thường nhẹ nhất có thể. Đo 50 ô nặng nhất staging: 2.951 pallet gom còn 578 nhóm
-- = 100KB nếu bật; tắt thì 0.
DROP FUNCTION IF EXISTS public.putaway_slot_facts(text[], text);
CREATE OR REPLACE FUNCTION public.putaway_slot_facts(
  p_loc_ids     text[],
  p_material_id text DEFAULT NULL,
  p_with_lots   boolean DEFAULT false
)
RETURNS TABLE (
  location_id   text,
  pallets       int,
  materials     int,
  same_material boolean,
  qa_hold       boolean,
  nccs          uuid[],
  lots          jsonb
)
LANGUAGE sql
STABLE
AS $$
  WITH live AS (
    SELECT ie.location_id, ie.material_id, ie.ncc_id, ie.qa_status_id,
           ie.production_date, ie.expiry_date, ie.shelf_life_days
    FROM public."InventoryEntry" ie
    WHERE ie.location_id = ANY(p_loc_ids)
      AND ie.stack_layer = 1
      AND ie.status IN ('IN_STOCK', 'PARTIAL')
      AND COALESCE(ie.cartons_remaining, 0) > 0
  ),
  grp AS (
    SELECT l.location_id, l.material_id, l.ncc_id, l.shelf_life_days,
           (l.expiry_date IS NULL)  AS no_exp,
           min(l.production_date)   AS pmin,
           max(l.production_date)   AS pmax,
           min(l.expiry_date)       AS emin,
           max(l.expiry_date)       AS emax
    FROM live l
    GROUP BY l.location_id, l.material_id, l.ncc_id, l.shelf_life_days, (l.expiry_date IS NULL)
  )
  SELECT l.location_id,
         count(*)::int                                                        AS pallets,
         count(DISTINCT l.material_id)::int                                   AS materials,
         bool_or(p_material_id IS NOT NULL AND l.material_id = p_material_id) AS same_material,
         bool_or(l.qa_status_id IS NOT NULL)                                  AS qa_hold,
         -- NULL = pallet chưa khai NCC → không kết luận (quy ước null-inclusive toàn app)
         COALESCE(array_remove(array_agg(DISTINCT l.ncc_id), NULL), '{}'::uuid[]) AS nccs,
         CASE WHEN NOT p_with_lots THEN '[]'::jsonb ELSE COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'm', g.material_id, 'n', g.ncc_id, 's', g.shelf_life_days,
                    'no_exp', g.no_exp, 'pmin', g.pmin, 'pmax', g.pmax,
                    'emin', g.emin, 'emax', g.emax))
           FROM grp g WHERE g.location_id = l.location_id
         ), '[]'::jsonb) END                                                  AS lots
  FROM live l
  GROUP BY l.location_id
$$;

GRANT EXECUTE ON FUNCTION public.putaway_slot_facts(text[], text, boolean) TO service_role;

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260815e_putaway_enforce.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- QUY TẮC CẤT HÀNG — đợt B: VẾT của từng lượt cất.
-- Đối xứng với 20260814c (luân chuyển): cột NULLABLE, dòng cũ để NULL = "chưa đo" và KHÔNG vào
-- mẫu số báo cáo tuân thủ — nếu coi dòng cũ là "đạt" thì tỷ lệ tuân thủ bị thổi lên ngay ngày đầu.

-- [cutover] gỡ: BEGIN;

ALTER TABLE public."InventoryEntry"
  -- true = lượt cất này ĐÃ được chấm theo quy tắc (mẫu số của % tuân thủ)
  ADD COLUMN IF NOT EXISTS putaway_checked         boolean NOT NULL DEFAULT false,
  -- mã lý do vi phạm (NO_IN / FULL / PICK_FACE / QA_HOLD / MAX_MATERIALS / NCC_MIX / DATE_MIX);
  -- NULL + checked = cất đúng quy tắc
  ADD COLUMN IF NOT EXISTS putaway_violation       text,
  -- lý do vượt rào, DANH SÁCH CỐ ĐỊNH (utils/putaway.ts) — để báo cáo gom nhóm được nguyên nhân
  ADD COLUMN IF NOT EXISTS putaway_override_reason text;

-- Chỉ đánh index phần VI PHẠM: báo cáo luôn hỏi "lượt nào sai", không ai quét cả bảng để đếm đúng.
CREATE INDEX IF NOT EXISTS idx_inventory_putaway_violation
  ON public."InventoryEntry" (warehouse_id, import_date)
  WHERE putaway_violation IS NOT NULL;

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260815f_scan_insert_putaway.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- scan_insert_pallet: nhận thêm 3 cột vết quy tắc cất hàng (20260815e).
--
-- BUG THẬT bắt được lúc kiểm sống đợt B: RPC insert bằng DANH SÁCH CỘT GHI TAY, nên key mới thêm
-- vào `entryObj` phía backend bị RƠI ÂM THẦM — không lỗi, không cảnh báo, API trả 200, chỉ có dữ
-- liệu là không tới nơi. tsc xanh, build xanh, test "quét thành công" cũng xanh.
-- ⇒ Kèm gác: bất biến QA 00 mục 12 đối chiếu key của `entryObj` với danh sách cột của RPC này,
--   thêm cột mà quên sửa RPC = ĐỎ ngay (luật "bug chết hai lần").

-- [cutover] gỡ: BEGIN;

CREATE OR REPLACE FUNCTION public.scan_insert_pallet(p_entry jsonb, p_location_id text, p_stack_layer integer)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_max  int;
  v_used int;
  v_id   text;
BEGIN
  SELECT max_pallets INTO v_max FROM "Location" WHERE id = p_location_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOLOC'; END IF;

  IF p_stack_layer = 1 THEN
    IF v_max > 0 THEN
      SELECT count(*) INTO v_used FROM "InventoryEntry"
        WHERE location_id = p_location_id AND stack_layer = 1
          AND status IN ('IN_STOCK','PARTIAL','QUARANTINE') AND cartons_remaining > 0;
      IF v_used >= v_max THEN RETURN 'FULL|'||v_used||'|'||v_max; END IF;
    END IF;
  ELSE
    PERFORM 1 FROM "InventoryEntry"
      WHERE location_id = p_location_id AND stack_layer = p_stack_layer - 1 AND status = 'IN_STOCK' LIMIT 1;
    IF NOT FOUND THEN RETURN 'NO_BASE'; END IF;
  END IF;

  INSERT INTO "InventoryEntry" (
    id, pallet_code, location_id, warehouse_id, material_id, manufacturer_id,
    nmsx, cycle, machine_code, pallet_sequence_no, stack_layer,
    cartons_imported, cartons_remaining, production_date, qa_status_id, batch, expiry_date,
    import_order_id, created_by, updated_by, status, ncc_id, shelf_life_days,
    import_date, update_date, created_at, updated_at,
    putaway_checked, putaway_violation, putaway_override_reason
  ) VALUES (
    p_entry->>'id', p_entry->>'pallet_code', p_entry->>'location_id',
    NULLIF(p_entry->>'warehouse_id','')::uuid, p_entry->>'material_id', p_entry->>'manufacturer_id',
    p_entry->>'nmsx', p_entry->>'cycle', p_entry->>'machine_code',
    NULLIF(p_entry->>'pallet_sequence_no','')::int, (p_entry->>'stack_layer')::int,
    (p_entry->>'cartons_imported')::numeric, NULLIF(p_entry->>'cartons_remaining','')::numeric,
    NULLIF(p_entry->>'production_date','')::timestamp, p_entry->>'qa_status_id',
    p_entry->>'batch', NULLIF(p_entry->>'expiry_date','')::date,
    p_entry->>'import_order_id', p_entry->>'created_by', p_entry->>'updated_by',
    COALESCE(NULLIF(p_entry->>'status',''),'IN_STOCK'), NULLIF(p_entry->>'ncc_id','')::uuid, NULLIF(p_entry->>'shelf_life_days','')::int,
    NULLIF(p_entry->>'import_date','')::timestamp, NULLIF(p_entry->>'update_date','')::timestamp,
    (p_entry->>'created_at')::timestamp, (p_entry->>'updated_at')::timestamp,
    -- COALESCE: bundle cũ / đường ghi khác không gửi khoá này thì giữ nghĩa "chưa đo"
    COALESCE((p_entry->>'putaway_checked')::boolean, false),
    NULLIF(p_entry->>'putaway_violation',''), NULLIF(p_entry->>'putaway_override_reason','')
  ) RETURNING id INTO v_id;

  RETURN 'OK|'||v_id;
EXCEPTION WHEN unique_violation THEN
  RETURN 'DUP';
END $function$;

-- Đọc định nghĩa 1 RPC (read-only) để bộ QA đối chiếu SỐNG danh sách cột với khoá backend gửi.
-- Không có cửa này thì bất biến 12 phải đoán, mà đoán chính là cách bug trên sống sót.
CREATE OR REPLACE FUNCTION public.rpc_source(p_name text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = p_name
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.rpc_source(text) TO service_role;

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260815g_putaway_maxmat_atomic.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- QUY TẮC CẤT HÀNG — luật "tối đa N mã / vị trí" phải kiểm DƯỚI ROW-LOCK.
--
-- ĐO THẬT 15/08: kho đặt 1 mã/ô, bắn 6 lượt quét ĐỒNG THỜI 6 mã khác nhau vào cùng ô trống →
-- **3 mã lọt vào**. Luật kiểm ở backend (đọc-rồi-ghi) nên nhiều lượt cùng đọc "ô đang có 0 mã"
-- rồi cùng ghi. Đây đúng lớp lỗi CLAUDE.md gọi tên: bộ đếm trên tài nguyên DÙNG CHUNG phải nguyên tử.
--
-- Cách sửa KHÔNG đẻ bản luật thứ hai: không chép cả bộ quy tắc xuống SQL, chỉ đưa DUY NHẤT ràng
-- buộc mang tính "đếm dưới khoá" vào RPC — cùng khuôn với phép kiểm sức chứa vốn đã nằm ở đây.
-- Backend vẫn là nơi QUYẾT ĐỊNH (nó truyền p_max_materials=NULL khi luật tắt hoặc khi đã được
-- duyệt vượt rào); RPC chỉ chốt lại con số dưới lock.

-- [cutover] gỡ: BEGIN;

DROP FUNCTION IF EXISTS public.scan_insert_pallet(jsonb, text, integer);
CREATE OR REPLACE FUNCTION public.scan_insert_pallet(
  p_entry         jsonb,
  p_location_id   text,
  p_stack_layer   integer,
  p_max_materials integer DEFAULT NULL   -- NULL = không ràng buộc (luật tắt / đã duyệt vượt rào)
)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_max  int;
  v_used int;
  v_mats int;
  v_has  boolean;
  v_id   text;
BEGIN
  SELECT max_pallets INTO v_max FROM "Location" WHERE id = p_location_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOLOC'; END IF;

  IF p_stack_layer = 1 THEN
    IF v_max > 0 THEN
      SELECT count(*) INTO v_used FROM "InventoryEntry"
        WHERE location_id = p_location_id AND stack_layer = 1
          AND status IN ('IN_STOCK','PARTIAL','QUARANTINE') AND cartons_remaining > 0;
      IF v_used >= v_max THEN RETURN 'FULL|'||v_used||'|'||v_max; END IF;
    END IF;
  ELSE
    PERFORM 1 FROM "InventoryEntry"
      WHERE location_id = p_location_id AND stack_layer = p_stack_layer - 1 AND status = 'IN_STOCK' LIMIT 1;
    IF NOT FOUND THEN RETURN 'NO_BASE'; END IF;
  END IF;

  -- Số mã trong ô — ĐẾM DƯỚI LOCK (khoá dòng Location ở trên). Mã đã có sẵn trong ô thì không
  -- làm tăng số mã ⇒ không chặn (khớp đúng putawayBlock ở backend).
  IF p_max_materials IS NOT NULL THEN
    SELECT count(DISTINCT material_id),
           bool_or(material_id = p_entry->>'material_id')
      INTO v_mats, v_has
      FROM "InventoryEntry"
      WHERE location_id = p_location_id AND stack_layer = 1
        AND status IN ('IN_STOCK','PARTIAL') AND cartons_remaining > 0;
    IF COALESCE(v_has, false) = false AND COALESCE(v_mats, 0) >= p_max_materials THEN
      RETURN 'MAXMAT|'||COALESCE(v_mats,0)||'|'||p_max_materials;
    END IF;
  END IF;

  INSERT INTO "InventoryEntry" (
    id, pallet_code, location_id, warehouse_id, material_id, manufacturer_id,
    nmsx, cycle, machine_code, pallet_sequence_no, stack_layer,
    cartons_imported, cartons_remaining, production_date, qa_status_id, batch, expiry_date,
    import_order_id, created_by, updated_by, status, ncc_id, shelf_life_days,
    import_date, update_date, created_at, updated_at,
    putaway_checked, putaway_violation, putaway_override_reason
  ) VALUES (
    p_entry->>'id', p_entry->>'pallet_code', p_entry->>'location_id',
    NULLIF(p_entry->>'warehouse_id','')::uuid, p_entry->>'material_id', p_entry->>'manufacturer_id',
    p_entry->>'nmsx', p_entry->>'cycle', p_entry->>'machine_code',
    NULLIF(p_entry->>'pallet_sequence_no','')::int, (p_entry->>'stack_layer')::int,
    (p_entry->>'cartons_imported')::numeric, NULLIF(p_entry->>'cartons_remaining','')::numeric,
    NULLIF(p_entry->>'production_date','')::timestamp, p_entry->>'qa_status_id',
    p_entry->>'batch', NULLIF(p_entry->>'expiry_date','')::date,
    p_entry->>'import_order_id', p_entry->>'created_by', p_entry->>'updated_by',
    COALESCE(NULLIF(p_entry->>'status',''),'IN_STOCK'), NULLIF(p_entry->>'ncc_id','')::uuid, NULLIF(p_entry->>'shelf_life_days','')::int,
    NULLIF(p_entry->>'import_date','')::timestamp, NULLIF(p_entry->>'update_date','')::timestamp,
    (p_entry->>'created_at')::timestamp, (p_entry->>'updated_at')::timestamp,
    -- COALESCE: bundle cũ / đường ghi khác không gửi khoá này thì giữ nghĩa "chưa đo"
    COALESCE((p_entry->>'putaway_checked')::boolean, false),
    NULLIF(p_entry->>'putaway_violation',''), NULLIF(p_entry->>'putaway_override_reason','')
  ) RETURNING id INTO v_id;

  RETURN 'OK|'||v_id;
EXCEPTION WHEN unique_violation THEN
  RETURN 'DUP';
END $function$;

GRANT EXECUTE ON FUNCTION public.scan_insert_pallet(jsonb, text, integer, integer) TO service_role;

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260815h_material_abc_extract.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- QUY TẮC CẤT HÀNG — đợt C: bóc luật ABC thành MỘT NGUỒN rồi cho cả Slotting lẫn Putaway dùng chung.
--
-- Vì sao phải bóc: luật "mã nào hạng A/B/C" đang nằm TRONG SQL của `slotting_stats`. Chiến thuật cất
-- hàng "Theo ABC" cần đúng luật đó — chép sang chỗ khác là đẻ bản thứ hai, tức tái phạm đúng thứ
-- chiến dịch 14–15/08 vừa dọn (rotation 4 bản, ★ 3 bản). Nên: một hàm `material_abc`, `slotting_stats`
-- gọi lại nó, không ai chép gì cả.
--
-- AN TOÀN: `slotting_stats` đang chạy thật (trang Tối ưu vị trí + Kiểm kê luân phiên ABC). Bản này
-- GIỮ NGUYÊN TỪNG BIỂU THỨC (kể cả `cum_picks`/`total_picks` để dòng `cum_share` không đổi cách tính)
-- và được nghiệm bằng cách DIFF NGUYÊN KHỐI jsonb đầu ra trước/sau trên mọi kho × 4 cửa sổ ngày ×
-- từng Loại kho. Lệch một ký tự = lùi lại.

-- [cutover] gỡ: BEGIN;

-- ─── NGUỒN DUY NHẤT của luật ABC ────────────────────────────────────────────
-- Ngưỡng: dồn theo lượt nhặt giảm dần — dưới 80% luỹ kế = A, dưới 95% = B, còn lại = C.
-- Mã KHÔNG có lượt nhặt nào → C (không phải "chưa xếp hạng": không ai lấy thì đúng là hạng C).
-- ABC là hạng TƯƠNG ĐỐI trong phạm vi (kho, loại hàng, cửa sổ ngày) — đổi phạm vi là đổi hạng,
-- nên 3 tham số này phải đi cùng nhau ở MỌI nơi gọi.
CREATE OR REPLACE FUNCTION public.material_abc(
  p_warehouse_id text,
  p_categories   text[] DEFAULT NULL,
  p_days         integer DEFAULT 30
)
RETURNS TABLE (
  material_id     text,
  material_code   text,
  short_name      text,
  category        text,
  picks           int,
  cartons_out     numeric,
  pallets_touched int,
  stock_pallets   int,
  stock_cartons   numeric,
  abc             text,
  cum_picks       numeric,
  total_picks     numeric
)
LANGUAGE sql
STABLE
AS $function$
WITH win AS (
  SELECT (now() AT TIME ZONE 'UTC') - make_interval(days => GREATEST(COALESCE(p_days, 30), 1)) AS t0
),
picks AS (
  SELECT ie.material_id,
         count(*)::int                              AS picks,
         COALESCE(sum(ose.cartons_scanned), 0)      AS cartons_out_base,
         count(DISTINCT ose.inventory_entry_id)::int AS pallets_touched
  FROM "OutboundScanEntry" ose
  JOIN "InventoryEntry" ie ON ie.id = ose.inventory_entry_id
  WHERE ie.warehouse_id::text = p_warehouse_id
    AND ose.scanned_at >= (SELECT t0 FROM win)
  GROUP BY ie.material_id
),
stock AS (
  SELECT ie.material_id,
         count(*)::int                          AS pallets,
         COALESCE(sum(ie.cartons_remaining), 0) AS cartons_base
  FROM "InventoryEntry" ie
  WHERE ie.warehouse_id::text = p_warehouse_id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  GROUP BY ie.material_id
),
mats AS (
  SELECT mu.material_id, m.material_code, m.short_name, m.category,
         COALESCE(p.picks, 0)           AS picks,
         COALESCE(p.cartons_out_base, 0) / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end) AS cartons_out,
         COALESCE(p.pallets_touched, 0) AS pallets_touched,
         COALESCE(st.pallets, 0)        AS stock_pallets,
         COALESCE(st.cartons_base, 0) / (case when m.entry_unit is not null and coalesce(m.units_per_carton,0) > 0 then m.units_per_carton else 1 end) AS stock_cartons
  FROM (SELECT material_id FROM picks UNION SELECT material_id FROM stock) mu
  JOIN "Material" m ON m.id = mu.material_id
  LEFT JOIN picks p  ON p.material_id  = mu.material_id
  LEFT JOIN stock st ON st.material_id = mu.material_id
  WHERE p_categories IS NULL OR m.category IS NULL OR m.category = ANY(p_categories)
)
SELECT material_id, material_code, short_name, category,
       picks, cartons_out, pallets_touched, stock_pallets, stock_cartons,
       CASE
         WHEN picks = 0 OR sum(picks) OVER () = 0 THEN 'C'
         WHEN (sum(picks) OVER (ORDER BY picks DESC, material_code) - picks)::numeric
              / NULLIF(sum(picks) OVER (), 0) < 0.80 THEN 'A'
         WHEN (sum(picks) OVER (ORDER BY picks DESC, material_code) - picks)::numeric
              / NULLIF(sum(picks) OVER (), 0) < 0.95 THEN 'B'
         ELSE 'C'
       END AS abc,
       sum(picks) OVER (ORDER BY picks DESC, material_code) AS cum_picks,
       sum(picks) OVER ()                                   AS total_picks
FROM mats
$function$;

GRANT EXECUTE ON FUNCTION public.material_abc(text, text[], integer) TO service_role;

-- ─── slotting_stats: GỌI LẠI hàm trên, không còn giữ bản luật riêng ─────────
-- `stock_by_zone` giữ ở đây vì khối `placement` cần tách theo sub_code (không phải luật ABC).
CREATE OR REPLACE FUNCTION public.slotting_stats(p_warehouse_id text, p_categories text[] DEFAULT NULL::text[], p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
WITH classed AS (
  SELECT * FROM public.material_abc(p_warehouse_id, p_categories, p_days)
),
stock_by_zone AS (
  SELECT ie.material_id, l.sub_code,
         count(*)::int                          AS pallets,
         COALESCE(sum(ie.cartons_remaining), 0) AS cartons_base
  FROM "InventoryEntry" ie
  LEFT JOIN "Location" l ON l.id = ie.location_id
  WHERE ie.warehouse_id::text = p_warehouse_id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  GROUP BY ie.material_id, l.sub_code
),
loc_used AS (
  SELECT l.id, l.location_code, l.sub_code, l.max_pallets, l.categories,
         l.slot_no_in, l.slot_no_out,
         count(ie.id)::int AS used_slots
  FROM "Location" l
  LEFT JOIN "InventoryEntry" ie ON ie.location_id = l.id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  WHERE l.warehouse_id = p_warehouse_id AND l.is_active = true
  GROUP BY l.id, l.location_code, l.sub_code, l.max_pallets, l.categories, l.slot_no_in, l.slot_no_out
)
SELECT jsonb_build_object(
  'total_picks', COALESCE((SELECT sum(picks) FROM classed), 0),
  'materials', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'material_id', c.material_id, 'code', c.material_code, 'name', c.short_name,
      'category', c.category,
      'picks', c.picks, 'cartons_out', c.cartons_out,
      'pallets_touched', c.pallets_touched, 'stock_pallets', c.stock_pallets,
      'stock_cartons', c.stock_cartons, 'abc', c.abc,
      'cum_share', CASE WHEN c.total_picks > 0 THEN round(c.cum_picks::numeric / c.total_picks, 4) ELSE 0 END
    ) ORDER BY c.picks DESC, c.material_code) FROM classed c), '[]'::jsonb),
  'placement', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'material_id', s.material_id, 'sub_code', s.sub_code,
      'pallets', s.pallets,
      'cartons', s.cartons_base / (case when m2.entry_unit is not null and coalesce(m2.units_per_carton,0) > 0 then m2.units_per_carton else 1 end)))
    FROM stock_by_zone s JOIN "Material" m2 ON m2.id = s.material_id
    WHERE s.material_id IN (SELECT material_id FROM classed)), '[]'::jsonb),
  'zones', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', z.id, 'code', z.code, 'name', z.name, 'categories', z.categories,
      'pick_rank', z.pick_rank, 'flow_type', z.flow_type,
      'capacity', COALESCE(zc.capacity, 0), 'used_slots', COALESCE(zc.used_slots, 0))
      ORDER BY z.pick_rank NULLS LAST, z.sort_order)
    FROM "WarehouseZone" z
    LEFT JOIN (SELECT sub_code, sum(max_pallets)::int AS capacity, sum(used_slots)::int AS used_slots
               FROM loc_used GROUP BY sub_code) zc ON zc.sub_code = z.code
    WHERE z.warehouse_id = p_warehouse_id AND z.is_active = true), '[]'::jsonb),
  'locations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', lu.id, 'location_code', lu.location_code, 'sub_code', lu.sub_code,
      'max_pallets', lu.max_pallets, 'used_slots', lu.used_slots,
      'slot_no_in', lu.slot_no_in, 'slot_no_out', lu.slot_no_out)
      ORDER BY lu.location_code)
    FROM loc_used lu), '[]'::jsonb)
);
$function$;

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260815i_rpc_source_revoke_public.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- BẢO MẬT: đóng `rpc_source` với PUBLIC/anon.
--
-- LỖ RÒ THẬT, đo bằng ANON KEY qua PostgREST (khoá này nằm công khai trong bundle FE):
--   POST /rest/v1/rpc/rpc_source {"p_name":"scan_insert_pallet"}  →  HTTP 200 + NGUYÊN VĂN mã hàm.
-- Nghĩa là bất kỳ ai cũng đọc được toàn bộ logic nghiệp vụ, tên bảng/cột của MỌI hàm trong schema.
--
-- Vì sao lọt: Postgres mặc định cấp EXECUTE cho PUBLIC trên hàm mới; `GRANT ... TO service_role`
-- ở migration 20260815f chỉ THÊM quyền, KHÔNG thu hồi quyền mặc định. Các RPC khác vô tình an toàn
-- nhờ chạm bảng có RLS (anon bị 401 ở tầng bảng), còn hàm này đọc `pg_proc` — KHÔNG có RLS.
--
-- BÀI HỌC CHUNG: hàm nào KHÔNG chạm bảng có RLS thì RLS không bảo vệ được nó; phải REVOKE tay.

-- [cutover] gỡ: BEGIN;

REVOKE ALL ON FUNCTION public.rpc_source(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_source(text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_source(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_source(text) TO service_role;

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260815j_secdef_revoke_public.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- BẢO MẬT — ĐÓNG các RPC đang mở cho ANON (khoá anon nằm CÔNG KHAI trong bundle FE).
--
-- ĐO THẬT 15/08 bằng chính anon key, qua PostgREST:
--   POST /rest/v1/rpc/packing_logs_recon         → HTTP 200 + dữ liệu nghiệp vụ THẬT
--       (id pallet, id trang sổ, id NGƯỜI đóng gói, trạng thái…)
--   POST /rest/v1/rpc/alerts_packing_unreceived  → HTTP 200 + id kho + số liệu
--   POST /rest/v1/rpc/packing_open_run           → HTTP 400 "PACKOPEN:Nhập Máy"
--       ⇒ lỗi NGHIỆP VỤ, tức hàm ĐÃ CHẠY QUA tầng quyền: payload đầy đủ là anon TẠO ĐƯỢC trang sổ.
--   POST /rest/v1/rpc/realtime_readiness         → HTTP 200 + bản đồ TOÀN BỘ bảng kèm trạng thái RLS
--   POST /rest/v1/rpc/rpc_source                 → (đã vá ở 20260815i) trả nguyên văn mã mọi hàm
--
-- VÌ SAO LỌT: Postgres mặc định cấp EXECUTE cho PUBLIC trên mọi hàm mới; `GRANT ... TO service_role`
-- chỉ THÊM quyền chứ không thu hồi mặc định. Hàm SECURITY DEFINER còn nguy hơn — nó chạy bằng quyền
-- CHỦ SỞ HỮU nên **RLS không chặn được gì**, tức lá chắn RLS của cả app vô hiệu ngay tại đó.
--
-- AN TOÀN KHI THU HỒI: frontend KHÔNG gọi `supabase.rpc(` ở bất kỳ đâu (mọi thứ đi qua API app,
-- backend dùng service_role). Đã grep xác nhận trước khi viết migration này.

-- [cutover] gỡ: BEGIN;

DO $$
DECLARE r record;
BEGIN
  -- 1) MỌI hàm SECURITY DEFINER trong public: cấm PUBLIC/anon/authenticated.
  --    Đây là lớp nguy hiểm nhất — bỏ qua RLS nên hở là ra dữ liệu thật.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;

  -- 2) Các hàm tiện ích ĐỌC CATALOG / phục vụ bộ QA — không chạm bảng có RLS nên RLS không che.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN ('realtime_readiness', 'rpc_source', 'weigh_ticket_warehouses')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- ─── LƯỚI GÁC: liệt kê hàm SECURITY DEFINER còn hở cho PUBLIC/anon ──────────
-- Bất biến QA gọi hàm này; thêm hàm SECURITY DEFINER mới mà quên REVOKE = ĐỎ ngay, không chờ ai nhớ.
-- (Bản thân hàm này cũng bị thu hồi khỏi PUBLIC ở dưới — không thì nó lại là cửa sổ mới.)
CREATE OR REPLACE FUNCTION public.secdef_public_grants()
RETURNS TABLE (fn text, grantee text)
LANGUAGE sql
STABLE
AS $$
  SELECT p.oid::regprocedure::text,
         CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
  WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
    AND a.privilege_type = 'EXECUTE'
    AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))
$$;

REVOKE ALL ON FUNCTION public.secdef_public_grants() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secdef_public_grants() TO service_role;

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260815k_putaway_bulk_move.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- QUY TẮC CẤT HÀNG — đợt D: bịt cửa "Chuyển vị trí hàng loạt" (trang Tồn kho).
--
-- LỖ HỔNG THẬT: đợt A+B gác luật cất hàng ở luồng NHẬP (tạo phiếu / đổi vị trí / quét / preview),
-- nhưng `PATCH /wms/inventory/bulk-location` — cửa mà công nhân kho dùng nhiều thứ hai — đi thẳng
-- xuống RPC move mà KHÔNG hỏi luật một câu nào. Kho bật "bắt buộc cất đúng quy tắc" xong vẫn dồn
-- được pallet vào ô đánh dấu CẤM ĐƯA HÀNG VÀO, vào vị trí nhặt lẻ, vượt số mã tối đa. Công tắc
-- người dùng yêu cầu hoá ra chỉ gác được một nửa số cửa.
--
-- Hai việc ở tầng SQL (phần luật vẫn nằm nguyên ở utils/putaway.ts — KHÔNG chép luật xuống đây):
--   1. `putaway_slot_facts` trả thêm `mats` = TẬP mã đang có trong ô. Cất một LÔ thì ràng buộc
--      "tối đa N mã/ô" phải tính trên HỢP của (mã đang có ∪ mã cả lô) — chỉ có số ĐẾM thì không
--      biết mã nào của lô đã có sẵn. Trả theo cờ (như `p_with_lots`) để đường chạy thường không
--      gánh thêm byte: ô nặng nhất staging 69 mã × 50 ô = ~128KB mỗi lần gõ phím ở ô tìm vị trí.
--   2. `move_pallets_to_location` nhận `p_max_materials` + 3 cột vết, đối xứng với
--      `scan_insert_pallet` (20260815g). Vì sao phải DƯỚI LOCK: hai người cùng dồn hàng vào một ô
--      thì mỗi bên đọc "ô đang có 2 mã" rồi cùng ghi — đúng lỗi đua đã đo ở màn quét 15/08.

-- [cutover] gỡ: BEGIN;

-- ─── 1. Tập mã đang có trong ô ───────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.putaway_slot_facts(text[], text, boolean);
CREATE OR REPLACE FUNCTION public.putaway_slot_facts(
  p_loc_ids     text[],
  p_material_id text    DEFAULT NULL,
  p_with_lots   boolean DEFAULT false,
  p_with_mats   boolean DEFAULT false
)
RETURNS TABLE (
  location_id   text,
  pallets       int,
  materials     int,
  same_material boolean,
  qa_hold       boolean,
  nccs          uuid[],
  mats          text[],
  lots          jsonb
)
LANGUAGE sql
STABLE
AS $$
  WITH live AS (
    SELECT ie.location_id, ie.material_id, ie.ncc_id, ie.qa_status_id,
           ie.production_date, ie.expiry_date, ie.shelf_life_days
    FROM public."InventoryEntry" ie
    WHERE ie.location_id = ANY(p_loc_ids)
      AND ie.stack_layer = 1
      AND ie.status IN ('IN_STOCK', 'PARTIAL')
      AND COALESCE(ie.cartons_remaining, 0) > 0
  ),
  grp AS (
    SELECT l.location_id, l.material_id, l.ncc_id, l.shelf_life_days,
           (l.expiry_date IS NULL)  AS no_exp,
           min(l.production_date)   AS pmin,
           max(l.production_date)   AS pmax,
           min(l.expiry_date)       AS emin,
           max(l.expiry_date)       AS emax
    FROM live l
    GROUP BY l.location_id, l.material_id, l.ncc_id, l.shelf_life_days, (l.expiry_date IS NULL)
  )
  SELECT l.location_id,
         count(*)::int                                                        AS pallets,
         count(DISTINCT l.material_id)::int                                   AS materials,
         bool_or(p_material_id IS NOT NULL AND l.material_id = p_material_id) AS same_material,
         bool_or(l.qa_status_id IS NOT NULL)                                  AS qa_hold,
         -- NULL = pallet chưa khai NCC → không kết luận (quy ước null-inclusive toàn app)
         COALESCE(array_remove(array_agg(DISTINCT l.ncc_id), NULL), '{}'::uuid[]) AS nccs,
         CASE WHEN NOT p_with_mats THEN '{}'::text[]
              ELSE COALESCE(array_remove(array_agg(DISTINCT l.material_id), NULL), '{}'::text[])
         END                                                                  AS mats,
         CASE WHEN NOT p_with_lots THEN '[]'::jsonb ELSE COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'm', g.material_id, 'n', g.ncc_id, 's', g.shelf_life_days,
                    'no_exp', g.no_exp, 'pmin', g.pmin, 'pmax', g.pmax,
                    'emin', g.emin, 'emax', g.emax))
           FROM grp g WHERE g.location_id = l.location_id
         ), '[]'::jsonb) END                                                  AS lots
  FROM live l
  GROUP BY l.location_id
$$;

REVOKE ALL ON FUNCTION public.putaway_slot_facts(text[], text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.putaway_slot_facts(text[], text, boolean, boolean) TO service_role;

-- ─── 2. Chuyển vị trí: chốt số mã dưới lock + ghi vết ────────────────────────
-- Bỏ bản 5 tham số: thêm tham số CÓ DEFAULT mà giữ bản cũ thì lời gọi 5 đối số thành NHẬP NHẰNG
-- (hai ứng viên cùng khớp) → Postgres báo lỗi thay vì chọn. Các caller khác (quét xuất phần dư,
-- Slotting, Fill) vẫn gọi đúng 5 tham số cũ và rơi vào default = hành vi KHÔNG ĐỔI.
DROP FUNCTION IF EXISTS public.move_pallets_to_location(text[], text, text, text, text);
CREATE OR REPLACE FUNCTION public.move_pallets_to_location(
  p_ids           text[],
  p_location_id   text,
  p_updated_by    text,
  p_update_date   text,
  p_now           text,
  p_max_materials integer DEFAULT NULL,   -- NULL = không ràng buộc (luật tắt / đã duyệt vượt rào)
  p_putaway_checked         boolean DEFAULT NULL,  -- NULL = không đụng 3 cột vết
  p_putaway_violation       text    DEFAULT NULL,
  p_putaway_override_reason text    DEFAULT NULL
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_max    int;
  v_active boolean;
  v_code   text;
  v_used   int;
  v_need   int;
  v_mats   int;
BEGIN
  v_need := COALESCE(array_length(p_ids, 1), 0);
  IF v_need = 0 THEN RETURN 'NO_IDS'; END IF;

  -- Khóa dòng Location → serialize mọi lượt dồn vào CÙNG vị trí
  SELECT max_pallets, is_active, location_code
    INTO v_max, v_active, v_code
  FROM "Location" WHERE id = p_location_id FOR UPDATE;
  IF NOT FOUND   THEN RETURN 'NOT_FOUND'; END IF;
  IF NOT v_active THEN RETURN 'INACTIVE'; END IF;

  -- Kiểm sức chứa DƯỚI LOCK (đếm sống; loại pallet đang được dời vào + pallet tồn=0)
  IF v_max > 0 THEN
    SELECT COUNT(*) INTO v_used
    FROM "InventoryEntry"
    WHERE location_id = p_location_id
      AND status IN ('IN_STOCK','PARTIAL','QUARANTINE')
      AND cartons_remaining > 0
      AND NOT (id = ANY(p_ids));
    IF (v_max - v_used) < v_need THEN
      RETURN 'FULL|' || GREATEST(0, v_max - v_used)::text || '|' || COALESCE(v_code, '');
    END IF;
  END IF;

  -- Số mã SAU KHI DỜI = mã đang ở lại trong ô ∪ mã của lô sắp vào. Bộ lọc dòng phải KHỚP
  -- `putaway_slot_facts` (stack_layer=1, IN_STOCK/PARTIAL, còn tồn) — lệch bộ lọc là backend
  -- chấm một đằng, RPC chốt một nẻo, và người dùng thấy "lúc chặn lúc không".
  IF p_max_materials IS NOT NULL THEN
    SELECT count(DISTINCT material_id) INTO v_mats
    FROM "InventoryEntry"
    WHERE stack_layer = 1
      AND status IN ('IN_STOCK','PARTIAL')
      AND COALESCE(cartons_remaining, 0) > 0
      AND ((location_id = p_location_id AND NOT (id = ANY(p_ids))) OR id = ANY(p_ids));
    IF COALESCE(v_mats, 0) > p_max_materials THEN
      RETURN 'MAXMAT|' || COALESCE(v_mats, 0)::text || '|' || p_max_materials::text;
    END IF;
  END IF;

  IF p_putaway_checked IS NULL THEN
    UPDATE "InventoryEntry"
       SET location_id = p_location_id,
           updated_at  = p_now::timestamp,
           update_date = p_update_date::timestamp,
           updated_by  = COALESCE(p_updated_by, updated_by)
     WHERE id = ANY(p_ids);
  ELSE
    -- Vết đi theo LẦN CẤT gần nhất: pallet được dời chỗ thì lý do "vì sao nó nằm đây" là của lần
    -- dời này, không phải của lần nhập kho đầu tiên. Gán thẳng (kể cả NULL) để lần cất ĐÚNG luật
    -- xoá được vết vi phạm cũ.
    UPDATE "InventoryEntry"
       SET location_id = p_location_id,
           updated_at  = p_now::timestamp,
           update_date = p_update_date::timestamp,
           updated_by  = COALESCE(p_updated_by, updated_by),
           putaway_checked         = p_putaway_checked,
           putaway_violation       = p_putaway_violation,
           putaway_override_reason = p_putaway_override_reason
     WHERE id = ANY(p_ids);
  END IF;

  RETURN 'OK|' || COALESCE(v_code, '');
END $$;

REVOKE ALL ON FUNCTION public.move_pallets_to_location(text[], text, text, text, text, integer, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_pallets_to_location(text[], text, text, text, text, integer, boolean, text, text)
  TO service_role;

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260816_putaway_enforce_per_rule.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- QUY TẮC CẤT HÀNG — tách "bắt buộc" theo TỪNG LUẬT (user chốt 16/08).
--
-- VÌ SAO: `putaway_required` là MỘT công tắc chung cho cả 7 luật ⇒ không diễn đạt được ý định
-- thật của người dùng. Đo trên Ba Vì 15/08:
--   · "Cấm đưa hàng vào" (ngoài đường, mặt đất) — user muốn CHỈ cấm GỢI Ý và cấm LÊN KẾ HOẠCH,
--     còn thực tế hết chỗ thì vẫn để ở đó. Bật công tắc chung là biến khu đang chứa 70 pallet
--     thành khu NGOẠI LỆ: mỗi lượt để hàng phải có người cầm quyền duyệt bấm chọn lý do, làm vài
--     chục lần/ngày thì người ta bấm "Khu đúng đã hết chỗ" theo phản xạ ⇒ được vỏ thủ tục, mất ruột.
--   · Luật trộn date thì NGƯỢC LẠI — chôn hàng phải lấy trước là lỗi thật, đáng chặn cứng
--     (chạy ngược 60 ngày: 1.724/5.542 lượt cất ở Ba Vì đang chôn hàng cần lấy trước = 31,1%).
-- Một công tắc không phục vụ được hai ý định trái chiều đó cùng lúc.
--
-- MÔ HÌNH MỚI: mỗi luật có 3 mức
--   Tắt      = giữ nguyên cách khai cũ (bỏ tick / để trống / date_mix='ANY') — luật không chấm
--   Cảnh báo = có chấm: loại khỏi gợi ý, loại khỏi kế hoạch Slotting, cất vẫn được + ghi vết
--   Bắt buộc = chặn thật (422), muốn qua phải có quyền `inbound.putaway_override` + chọn lý do
-- Mức Bắt buộc khai bằng MẢNG MÃ LUẬT `putaway_enforced`; rỗng = không luật nào chặn cứng.
--
-- BACKFILL GIỮ NGUYÊN HÀNH VI: kho đang bật công tắc chung → ép TẤT CẢ mã luật; kho tắt → mảng rỗng.
-- Sau backfill `putaway_required` hết ý nghĩa (đặt về false, giữ cột để không mất dữ liệu lịch sử).

-- [cutover] gỡ: BEGIN;

ALTER TABLE public."Warehouse"
  ADD COLUMN IF NOT EXISTS putaway_enforced text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_putaway_enforced_chk') THEN
    ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_putaway_enforced_chk
      CHECK (putaway_enforced <@ ARRAY['NO_IN','FULL','PICK_FACE','QA_HOLD','MAX_MATERIALS','NCC_MIX','DATE_MIX']::text[]);
  END IF;
END $$;

UPDATE public."Warehouse"
   SET putaway_enforced = ARRAY['NO_IN','FULL','PICK_FACE','QA_HOLD','MAX_MATERIALS','NCC_MIX','DATE_MIX']::text[],
       putaway_required = false,
       updated_at       = now()
 WHERE putaway_required IS TRUE;

-- Gác: sau migration không kho nào được còn dựa vào công tắc cũ (nếu còn = backfill trượt,
-- và trượt kiểu này thì kho đang "bắt buộc" tự nhiên thành "chỉ cảnh báo" mà KHÔNG AI BIẾT).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public."Warehouse" WHERE putaway_required IS TRUE;
  IF n > 0 THEN
    RAISE EXCEPTION 'Còn % kho giữ putaway_required=true — backfill chưa chuyển hết sang putaway_enforced', n;
  END IF;
END $$;

COMMENT ON COLUMN public."Warehouse".putaway_enforced IS
  'Mã luật cất hàng bị CHẶN CỨNG (422, cần quyền inbound.putaway_override + lý do). Luật có chấm nhưng KHÔNG nằm trong mảng = chỉ cảnh báo + loại khỏi gợi ý. Mã: NO_IN/FULL/PICK_FACE/QA_HOLD/MAX_MATERIALS/NCC_MIX/DATE_MIX (utils/putaway.ts)';
COMMENT ON COLUMN public."Warehouse".putaway_required IS
  'ĐÃ THAY THẾ bởi putaway_enforced (16/08) — giữ lại để không mất dữ liệu lịch sử, KHÔNG đọc nữa';

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260817_locations_filter_noin.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260817: filter "Không đưa hàng vào" (Location.slot_no_in) cho trang danh mục Vị trí kho.
-- Thêm p_slot_no_in (3 trạng thái: NULL = không lọc · true/false = chỉ có / chỉ chưa) vào
-- locations_page + locations_summary — cột NULL coi như false (chưa cấm).
-- DROP trước khi CREATE: thêm tham số DEFAULT bằng CREATE OR REPLACE sẽ tạo OVERLOAD thứ hai
-- cùng tên → PostgREST thấy 2 ứng viên cùng khớp là PGRST203 (ambiguous) cho MỌI lời gọi cũ.
DROP FUNCTION IF EXISTS public.locations_page(integer, integer, text[], text, text[], text[], boolean, boolean, boolean, boolean, text[]);
DROP FUNCTION IF EXISTS public.locations_summary(text[], text, text[], text[], boolean, boolean, text[]);

CREATE FUNCTION public.locations_page(
  p_offset integer, p_limit integer,
  p_wh_ids text[] DEFAULT NULL::text[], p_category text DEFAULT NULL::text,
  p_scope_cats text[] DEFAULT NULL::text[], p_tokens text[] DEFAULT NULL::text[],
  p_flag boolean DEFAULT NULL::boolean, p_incl_inactive boolean DEFAULT false,
  p_with_rows boolean DEFAULT false, p_pick_face boolean DEFAULT NULL::boolean,
  p_subs text[] DEFAULT NULL::text[], p_slot_no_in boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  result jsonb;
BEGIN
  WITH f AS (
    SELECT l.id, l.sub_code, l.row, l.shelf
    FROM "Location" l
    LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
    WHERE (p_wh_ids IS NULL OR l.warehouse_id = ANY (p_wh_ids))
      AND (p_incl_inactive OR l.is_active)
      AND (p_category IS NULL OR l.categories IS NULL OR l.categories @> ARRAY[p_category])
      AND (p_scope_cats IS NULL OR l.categories IS NULL OR l.categories && p_scope_cats)
      AND (p_flag IS NULL OR l.requires_stocktake = p_flag)
      AND (p_pick_face IS NULL OR l.is_pick_face = p_pick_face)
      AND (p_slot_no_in IS NULL OR COALESCE(l.slot_no_in, false) = p_slot_no_in)
      AND (p_subs IS NULL OR l.sub_code = ANY (p_subs))
      AND (p_tokens IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p_tokens) t
            WHERE position(t IN (COALESCE(l.search_norm, '') || ' ' ||
                   lower(COALESCE(array_to_string(l.categories, ' '), '') || ' ' ||
                         COALESCE(l.sub_type, '') || ' ' || COALESCE(l.row, '') || ' ' ||
                         COALESCE(l.shelf, '') || ' ' || COALESCE(w.code, '') || ' ' || COALESCE(w.name, '')))) = 0))
  ),
  pg AS (
    SELECT id, row_number() OVER (ORDER BY sub_code, row, shelf, id) rn
    FROM f ORDER BY sub_code, row, shelf, id
    LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    'ids',   COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb),
    'total', (SELECT count(*) FROM f),
    'rows',  CASE WHEN NOT p_with_rows THEN NULL ELSE COALESCE((
      SELECT jsonb_agg(to_jsonb(l)
               || jsonb_build_object(
                    'warehouse', CASE WHEN w.id IS NULL THEN NULL ELSE
                      jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name) END,
                    '_count', jsonb_build_object('inventory_entries', COALESCE(cnt.n, 0)),
                    'used_slots', COALESCE(us.n, 0),
                    'has_same_material', false)
               ORDER BY p.rn)
      FROM pg p
      JOIN "Location" l ON l.id = p.id
      LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
      LEFT JOIN LATERAL (
        SELECT count(*) n FROM "InventoryEntry" e WHERE e.location_id = l.id) cnt ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*) n FROM "InventoryEntry" e
        WHERE e.location_id = l.id AND e.stack_layer = 1
          AND e.status IN ('IN_STOCK', 'PARTIAL') AND e.cartons_remaining > 0) us ON TRUE), '[]'::jsonb) END
  ) INTO result;
  RETURN result;
END $function$;

CREATE FUNCTION public.locations_summary(
  p_wh_ids text[] DEFAULT NULL::text[], p_category text DEFAULT NULL::text,
  p_scope_cats text[] DEFAULT NULL::text[], p_tokens text[] DEFAULT NULL::text[],
  p_flag boolean DEFAULT NULL::boolean, p_pick_face boolean DEFAULT NULL::boolean,
  p_subs text[] DEFAULT NULL::text[], p_slot_no_in boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  result jsonb;
BEGIN
  WITH f AS (   -- SummaryBand luôn tính trên vị trí ĐANG DÙNG (mirror activeFiltered của FE cũ)
    SELECT l.id, l.max_pallets
    FROM "Location" l
    LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
    WHERE (p_wh_ids IS NULL OR l.warehouse_id = ANY (p_wh_ids))
      AND l.is_active
      AND (p_category IS NULL OR l.categories IS NULL OR l.categories @> ARRAY[p_category])
      AND (p_scope_cats IS NULL OR l.categories IS NULL OR l.categories && p_scope_cats)
      AND (p_flag IS NULL OR l.requires_stocktake = p_flag)
      AND (p_pick_face IS NULL OR l.is_pick_face = p_pick_face)
      AND (p_slot_no_in IS NULL OR COALESCE(l.slot_no_in, false) = p_slot_no_in)
      AND (p_subs IS NULL OR l.sub_code = ANY (p_subs))
      AND (p_tokens IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p_tokens) t
            WHERE position(t IN (COALESCE(l.search_norm, '') || ' ' ||
                   lower(COALESCE(array_to_string(l.categories, ' '), '') || ' ' ||
                         COALESCE(l.sub_type, '') || ' ' || COALESCE(l.row, '') || ' ' ||
                         COALESCE(l.shelf, '') || ' ' || COALESCE(w.code, '') || ' ' || COALESCE(w.name, '')))) = 0))
  ),
  used AS (
    SELECT f.id, f.max_pallets, count(e.id) AS used_slots
    FROM f LEFT JOIN "InventoryEntry" e
      ON e.location_id = f.id AND e.stack_layer = 1
     AND e.status IN ('IN_STOCK', 'PARTIAL') AND e.cartons_remaining > 0
    GROUP BY f.id, f.max_pallets
  )
  SELECT jsonb_build_object(
    'count',    (SELECT count(*) FROM used),
    'capacity', (SELECT COALESCE(sum(max_pallets), 0) FROM used),
    'used',     (SELECT COALESCE(sum(used_slots), 0) FROM used),
    'full',     (SELECT count(*) FROM used WHERE max_pallets > 0 AND used_slots >= max_pallets)
  ) INTO result;
  RETURN result;
END $function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260817b_slotting_stats_pickface.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260817b: slotting_stats trả thêm is_pick_face cho từng vị trí.
--
-- VÌ SAO: engine Slotting coi MỌI ô `slot_no_in` là "kho tạm" và xếp hàng ở đó vào diện KÉO ĐI
-- (P1, chạy mỗi lượt). Nhưng vị trí NHẶT LẺ (`is_pick_face`) là nơi tính năng Fill hàng CHỦ ĐỘNG
-- đổ hàng xuống để công nhân với tay lấy — nếu người dùng đánh dấu ô nhặt lẻ là "không đưa hàng
-- vào" (ý họ: cấm cất PALLET NGUYÊN vào đó) thì hai tính năng ĐÁNH NHAU: Fill đẩy hàng xuống,
-- Slotting lại lên kế hoạch bốc chính số hàng đó đi, người thực hiện xong thì Fill lại báo thiếu.
-- Đo thật trên staging 17/08 (kho Ba Vì, cấu hình do user vừa đặt): 13 ô mang cờ slot_no_in, trong
-- đó 3 ô LÀ vị trí nhặt lẻ (KHO 1 LẺ 86 pallet · KHO 3 LẺ 74 · PIN ROBOT 47) = 207 pallet sẽ bị
-- xếp lịch dọn đi mỗi lần lập kế hoạch.
--
-- Chỉ THÊM một khoá vào jsonb 'locations' — giữ NGUYÊN mọi biểu thức khác (cùng kỷ luật với
-- 20260815h: đổi hàm đang chạy thật thì phải diff nguyên khối trước/sau).
CREATE OR REPLACE FUNCTION public.slotting_stats(p_warehouse_id text, p_categories text[] DEFAULT NULL::text[], p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
WITH classed AS (
  SELECT * FROM public.material_abc(p_warehouse_id, p_categories, p_days)
),
stock_by_zone AS (
  SELECT ie.material_id, l.sub_code,
         count(*)::int                          AS pallets,
         COALESCE(sum(ie.cartons_remaining), 0) AS cartons_base
  FROM "InventoryEntry" ie
  LEFT JOIN "Location" l ON l.id = ie.location_id
  WHERE ie.warehouse_id::text = p_warehouse_id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  GROUP BY ie.material_id, l.sub_code
),
loc_used AS (
  SELECT l.id, l.location_code, l.sub_code, l.max_pallets, l.categories,
         l.slot_no_in, l.slot_no_out, l.is_pick_face,
         count(ie.id)::int AS used_slots
  FROM "Location" l
  LEFT JOIN "InventoryEntry" ie ON ie.location_id = l.id
    AND ie.status IN ('IN_STOCK', 'PARTIAL', 'QUARANTINE')
    AND ie.cartons_remaining > 0
  WHERE l.warehouse_id = p_warehouse_id AND l.is_active = true
  GROUP BY l.id, l.location_code, l.sub_code, l.max_pallets, l.categories, l.slot_no_in, l.slot_no_out, l.is_pick_face
)
SELECT jsonb_build_object(
  'total_picks', COALESCE((SELECT sum(picks) FROM classed), 0),
  'materials', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'material_id', c.material_id, 'code', c.material_code, 'name', c.short_name,
      'category', c.category,
      'picks', c.picks, 'cartons_out', c.cartons_out,
      'pallets_touched', c.pallets_touched, 'stock_pallets', c.stock_pallets,
      'stock_cartons', c.stock_cartons, 'abc', c.abc,
      'cum_share', CASE WHEN c.total_picks > 0 THEN round(c.cum_picks::numeric / c.total_picks, 4) ELSE 0 END
    ) ORDER BY c.picks DESC, c.material_code) FROM classed c), '[]'::jsonb),
  'placement', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'material_id', s.material_id, 'sub_code', s.sub_code,
      'pallets', s.pallets,
      'cartons', s.cartons_base / (case when m2.entry_unit is not null and coalesce(m2.units_per_carton,0) > 0 then m2.units_per_carton else 1 end)))
    FROM stock_by_zone s JOIN "Material" m2 ON m2.id = s.material_id
    WHERE s.material_id IN (SELECT material_id FROM classed)), '[]'::jsonb),
  'zones', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', z.id, 'code', z.code, 'name', z.name, 'categories', z.categories,
      'pick_rank', z.pick_rank, 'flow_type', z.flow_type,
      'capacity', COALESCE(zc.capacity, 0), 'used_slots', COALESCE(zc.used_slots, 0))
      ORDER BY z.pick_rank NULLS LAST, z.sort_order)
    FROM "WarehouseZone" z
    LEFT JOIN (SELECT sub_code, sum(max_pallets)::int AS capacity, sum(used_slots)::int AS used_slots
               FROM loc_used GROUP BY sub_code) zc ON zc.sub_code = z.code
    WHERE z.warehouse_id = p_warehouse_id AND z.is_active = true), '[]'::jsonb),
  'locations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', lu.id, 'location_code', lu.location_code, 'sub_code', lu.sub_code,
      'max_pallets', lu.max_pallets, 'used_slots', lu.used_slots,
      'slot_no_in', lu.slot_no_in, 'slot_no_out', lu.slot_no_out,
      'is_pick_face', COALESCE(lu.is_pick_face, false))
      ORDER BY lu.location_code)
    FROM loc_used lu), '[]'::jsonb)
);
$function$
;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260818_locations_filter_noout.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260818: filter 'Không lấy hàng đi' (Location.slot_no_out) cho trang danh mục Vị trí kho.
-- Đối xứng với p_slot_no_in của 20260817 (3 trạng thái: NULL = không lọc · true/false = chỉ có /
-- chỉ chưa; cột NULL coi như false). Làm nốt để trang Vị trí kho phủ ĐỦ cả 2 cờ, rồi mới gỡ khối
-- 'Vị trí đặc biệt' ở tab Cài đặt của Tối ưu vị trí (đường khai thứ hai cho cùng 2 cờ).
-- DROP trước khi CREATE: thêm tham số DEFAULT bằng CREATE OR REPLACE sẽ tạo OVERLOAD thứ hai
-- cùng tên → PostgREST thấy 2 ứng viên cùng khớp là PGRST203 (ambiguous) cho MỌI lời gọi cũ.
-- Bỏ CẢ chữ ký ĐANG SỐNG (bản 20260817, kết thúc bằng p_slot_no_in) LẪN chữ ký mới — bỏ sót bản
-- đang sống là CREATE bên dưới đẻ overload thứ hai, đúng cái bẫy migration trước đã dặn.
DROP FUNCTION IF EXISTS public.locations_page(integer, integer, text[], text, text[], text[], boolean, boolean, boolean, boolean, text[], boolean);
DROP FUNCTION IF EXISTS public.locations_page(integer, integer, text[], text, text[], text[], boolean, boolean, boolean, boolean, text[], boolean, boolean);
DROP FUNCTION IF EXISTS public.locations_summary(text[], text, text[], text[], boolean, boolean, text[], boolean);
DROP FUNCTION IF EXISTS public.locations_summary(text[], text, text[], text[], boolean, boolean, text[], boolean, boolean);

CREATE FUNCTION public.locations_page(
  p_offset integer, p_limit integer,
  p_wh_ids text[] DEFAULT NULL::text[], p_category text DEFAULT NULL::text,
  p_scope_cats text[] DEFAULT NULL::text[], p_tokens text[] DEFAULT NULL::text[],
  p_flag boolean DEFAULT NULL::boolean, p_incl_inactive boolean DEFAULT false,
  p_with_rows boolean DEFAULT false, p_pick_face boolean DEFAULT NULL::boolean,
  p_subs text[] DEFAULT NULL::text[], p_slot_no_in boolean DEFAULT NULL::boolean,
  p_slot_no_out boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  result jsonb;
BEGIN
  WITH f AS (
    SELECT l.id, l.sub_code, l.row, l.shelf
    FROM "Location" l
    LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
    WHERE (p_wh_ids IS NULL OR l.warehouse_id = ANY (p_wh_ids))
      AND (p_incl_inactive OR l.is_active)
      AND (p_category IS NULL OR l.categories IS NULL OR l.categories @> ARRAY[p_category])
      AND (p_scope_cats IS NULL OR l.categories IS NULL OR l.categories && p_scope_cats)
      AND (p_flag IS NULL OR l.requires_stocktake = p_flag)
      AND (p_pick_face IS NULL OR l.is_pick_face = p_pick_face)
      AND (p_slot_no_in IS NULL OR COALESCE(l.slot_no_in, false) = p_slot_no_in)
      AND (p_slot_no_out IS NULL OR COALESCE(l.slot_no_out, false) = p_slot_no_out)
      AND (p_subs IS NULL OR l.sub_code = ANY (p_subs))
      AND (p_tokens IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p_tokens) t
            WHERE position(t IN (COALESCE(l.search_norm, '') || ' ' ||
                   lower(COALESCE(array_to_string(l.categories, ' '), '') || ' ' ||
                         COALESCE(l.sub_type, '') || ' ' || COALESCE(l.row, '') || ' ' ||
                         COALESCE(l.shelf, '') || ' ' || COALESCE(w.code, '') || ' ' || COALESCE(w.name, '')))) = 0))
  ),
  pg AS (
    SELECT id, row_number() OVER (ORDER BY sub_code, row, shelf, id) rn
    FROM f ORDER BY sub_code, row, shelf, id
    LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    'ids',   COALESCE((SELECT jsonb_agg(id ORDER BY rn) FROM pg), '[]'::jsonb),
    'total', (SELECT count(*) FROM f),
    'rows',  CASE WHEN NOT p_with_rows THEN NULL ELSE COALESCE((
      SELECT jsonb_agg(to_jsonb(l)
               || jsonb_build_object(
                    'warehouse', CASE WHEN w.id IS NULL THEN NULL ELSE
                      jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name) END,
                    '_count', jsonb_build_object('inventory_entries', COALESCE(cnt.n, 0)),
                    'used_slots', COALESCE(us.n, 0),
                    'has_same_material', false)
               ORDER BY p.rn)
      FROM pg p
      JOIN "Location" l ON l.id = p.id
      LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
      LEFT JOIN LATERAL (
        SELECT count(*) n FROM "InventoryEntry" e WHERE e.location_id = l.id) cnt ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*) n FROM "InventoryEntry" e
        WHERE e.location_id = l.id AND e.stack_layer = 1
          AND e.status IN ('IN_STOCK', 'PARTIAL') AND e.cartons_remaining > 0) us ON TRUE), '[]'::jsonb) END
  ) INTO result;
  RETURN result;
END $function$;

CREATE FUNCTION public.locations_summary(
  p_wh_ids text[] DEFAULT NULL::text[], p_category text DEFAULT NULL::text,
  p_scope_cats text[] DEFAULT NULL::text[], p_tokens text[] DEFAULT NULL::text[],
  p_flag boolean DEFAULT NULL::boolean, p_pick_face boolean DEFAULT NULL::boolean,
  p_subs text[] DEFAULT NULL::text[], p_slot_no_in boolean DEFAULT NULL::boolean,
  p_slot_no_out boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  result jsonb;
BEGIN
  WITH f AS (   -- SummaryBand luôn tính trên vị trí ĐANG DÙNG (mirror activeFiltered của FE cũ)
    SELECT l.id, l.max_pallets
    FROM "Location" l
    LEFT JOIN "Warehouse" w ON w.id = l.warehouse_id
    WHERE (p_wh_ids IS NULL OR l.warehouse_id = ANY (p_wh_ids))
      AND l.is_active
      AND (p_category IS NULL OR l.categories IS NULL OR l.categories @> ARRAY[p_category])
      AND (p_scope_cats IS NULL OR l.categories IS NULL OR l.categories && p_scope_cats)
      AND (p_flag IS NULL OR l.requires_stocktake = p_flag)
      AND (p_pick_face IS NULL OR l.is_pick_face = p_pick_face)
      AND (p_slot_no_in IS NULL OR COALESCE(l.slot_no_in, false) = p_slot_no_in)
      AND (p_slot_no_out IS NULL OR COALESCE(l.slot_no_out, false) = p_slot_no_out)
      AND (p_subs IS NULL OR l.sub_code = ANY (p_subs))
      AND (p_tokens IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p_tokens) t
            WHERE position(t IN (COALESCE(l.search_norm, '') || ' ' ||
                   lower(COALESCE(array_to_string(l.categories, ' '), '') || ' ' ||
                         COALESCE(l.sub_type, '') || ' ' || COALESCE(l.row, '') || ' ' ||
                         COALESCE(l.shelf, '') || ' ' || COALESCE(w.code, '') || ' ' || COALESCE(w.name, '')))) = 0))
  ),
  used AS (
    SELECT f.id, f.max_pallets, count(e.id) AS used_slots
    FROM f LEFT JOIN "InventoryEntry" e
      ON e.location_id = f.id AND e.stack_layer = 1
     AND e.status IN ('IN_STOCK', 'PARTIAL') AND e.cartons_remaining > 0
    GROUP BY f.id, f.max_pallets
  )
  SELECT jsonb_build_object(
    'count',    (SELECT count(*) FROM used),
    'capacity', (SELECT COALESCE(sum(max_pallets), 0) FROM used),
    'used',     (SELECT COALESCE(sum(used_slots), 0) FROM used),
    'full',     (SELECT count(*) FROM used WHERE max_pallets > 0 AND used_slots >= max_pallets)
  ) INTO result;
  RETURN result;
END $function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260819b_dashboard_permission.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- 19/08/2026 — Thêm quyền dashboard.view (trang Tổng quan trước nay MỞ cho mọi user đăng nhập).
-- Luật "mặc định cờ mới = giá trị đang chạy": backfill CẤP quyền cho MỌI chức danh để hành vi
-- không đổi ngày apply; admin muốn siết thì gỡ per chức danh trong trình phân quyền.
-- [cutover] gỡ: BEGIN;

UPDATE "JobTitle"
SET module_permissions = jsonb_set(
      COALESCE(module_permissions, '{}'::jsonb),
      '{dashboard}', '["view"]'::jsonb, true),
    updated_at = now()
WHERE COALESCE(module_permissions, '{}'::jsonb) -> 'dashboard' IS NULL;

-- Gác an toàn: sau backfill không còn chức danh nào thiếu key dashboard
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "JobTitle"
  WHERE COALESCE(module_permissions, '{}'::jsonb) -> 'dashboard' IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'backfill dashboard.view thiếu % chức danh', n; END IF;
END $$;

-- [cutover] gỡ: COMMIT;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260820_stocktake_log_move_from.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20/08/2026 — Tab "Lịch sử" màn Chuyển vị trí quét QR: lịch sử chuyển cần "TỪ ô nào → ĐẾN ô nào",
-- nhưng StocktakeLog chỉ snapshot ô ĐÍCH (location_id/location_code) + location_changed_to.
-- Thêm 2 cột snapshot ô NGUỒN (null với dòng kiểm thường / dòng cũ trước migration — FE hiện "—").
ALTER TABLE "StocktakeLog" ADD COLUMN IF NOT EXISTS location_from_id   text;
ALTER TABLE "StocktakeLog" ADD COLUMN IF NOT EXISTS location_from_code text;

-- Lịch sử chuyển lọc WHERE location_changed_to IS NOT NULL — partial index để bảng kiểm kê
-- (phình nhanh nhất module, ~150k dòng/năm/kho) không làm chậm tab lịch sử chuyển.
CREATE INDEX IF NOT EXISTS idx_stocktakelog_moves
  ON "StocktakeLog" (counted_at DESC)
  WHERE location_changed_to IS NOT NULL;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260820b_control_tower_resources.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20/08/2026 — Control Tower kiểu Manhattan Facility Console: khối RESOURCES + cycle-time.
-- RPC MỚI cộng thêm (không đụng control_tower_stats đang chạy — additive, lỗi thì FE tự ẩn khối):
--   staff_out  : người quét XUẤT hôm nay (distinct + số lượt) + top 5 theo lượt quét
--   staff_in   : người tạo pallet NHẬP hôm nay + số pallet
--   stocktake  : người kiểm/chuyển hôm nay + lượt kiểm + lượt chuyển vị trí
--   forklift   : xe nâng ACTIVE / IDLE / CHƯA CHECK + tổng lỗi hạng mục hôm nay
--   inventory  : tồn sống tổng vs bị GIỮ (QA giữ / QUARANTINE) — "Good vs Locked Inventory"
--   gate_cycle : chu trình cổng hôm nay — Đăng ký→Vào TB (phút) · Vào→Ra TB (phút) · số xe đã ra
-- Chỉ lọc theo KHO (p_warehouse_ids) — khối resources không cắt theo Loại kho (nhân sự/xe nâng
-- không mang loại hàng; FE ghi chú rõ). Bẫy naive-UTC: OutboundScanEntry.scanned_at là timestamp
-- KHÔNG tz chứa UTC → so với t0/t1 (naive UTC); cột timestamptz (counted_at, entry_at) so z0/z1.
CREATE OR REPLACE FUNCTION public.control_tower_resources(
  p_warehouse_ids text[] DEFAULT NULL::text[],
  p_today date DEFAULT NULL::date
) RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
with day_range as (
  select ((p_today::timestamp at time zone 'Asia/Ho_Chi_Minh') at time zone 'UTC')       as t0,  -- naive UTC
         (((p_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') at time zone 'UTC') as t1,
         (p_today::timestamp at time zone 'Asia/Ho_Chi_Minh')       as z0,                        -- timestamptz
         ((p_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') as z1
),
scan_today as (
  select se.scanned_by
  from "OutboundScanEntry" se, day_range r
  where se.scanned_at >= r.t0 and se.scanned_at < r.t1
    and (p_warehouse_ids is null or exists (
      select 1 from "OutboundItem" oi
      join "OutboundDelivery" d on d.id = oi.do_id
      join "GroupDeliveryOrder" g on g.id = d.gdo_id
      where oi.id = se.item_id and g.warehouse_id = any(p_warehouse_ids)))
),
staff_out as (
  select count(distinct scanned_by) as n, count(*) as scans from scan_today where scanned_by is not null
),
top_out as (
  select coalesce(e.name, '—') as name, count(*) as scans
  from scan_today s
  left join "Employee" e on e.id::text = s.scanned_by
  where s.scanned_by is not null
  group by 1 order by 2 desc limit 5
),
staff_in as (
  select count(distinct ie.created_by) filter (where ie.created_by is not null) as n,
         count(*) as pallets
  from "InventoryEntry" ie
  where ie.import_date::date = p_today
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
),
stk as (
  select count(distinct st.counted_by) filter (where st.counted_by is not null) as n,
         count(*) as checks,
         count(*) filter (where st.location_changed_to is not null) as moves
  from "StocktakeLog" st, day_range r
  where st.counted_at >= r.z0 and st.counted_at < r.z1
    and (p_warehouse_ids is null or st.warehouse_id = any(p_warehouse_ids))
),
fk as (
  select l.status, coalesce(l.issue_count, 0) as issue_count, (l.id is not null) as checked
  from forklift_vehicles v
  left join forklift_daily_logs l on l.forklift_id = v.id and l.log_date = p_today
  where coalesce(v.is_active, true)
    and (p_warehouse_ids is null or v.warehouse_id = any(p_warehouse_ids))
),
fk_agg as (
  select count(*) as total,
         count(*) filter (where status = 'ACTIVE') as active,
         count(*) filter (where status = 'IDLE')   as idle,
         count(*) filter (where not checked)       as unchecked,
         coalesce(sum(issue_count), 0)             as issues
  from fk
),
inv as (
  select count(*) as total,
         count(*) filter (where qa_status_id is not null or status = 'QUARANTINE') as locked
  from "InventoryEntry" ie
  where ie.cartons_remaining > 0
    and ie.status in ('IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING')
    and (p_warehouse_ids is null or ie.warehouse_id::text = any(p_warehouse_ids))
),
gate_cycle as (
  select count(*) filter (where exit_at is not null)                                    as done_n,
         round(avg(extract(epoch from (exit_at - entry_at)) / 60)
               filter (where exit_at is not null and exit_at > entry_at))               as inout_mins,
         round(avg(extract(epoch from (entry_at - registered_at)) / 60)
               filter (where registered_at is not null and entry_at > registered_at))   as wait_mins
  from gate_registrations g
  where g.date = p_today and g.entry_at is not null
    and (p_warehouse_ids is null or g.warehouse_id = any(p_warehouse_ids))
)
select jsonb_build_object(
  'staff_out', (select jsonb_build_object('n', n, 'scans', scans) from staff_out),
  'top_out',   (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'scans', scans) order by scans desc), '[]'::jsonb) from top_out),
  'staff_in',  (select jsonb_build_object('n', coalesce(n, 0), 'pallets', pallets) from staff_in),
  'stocktake', (select jsonb_build_object('n', coalesce(n, 0), 'checks', checks, 'moves', moves) from stk),
  'forklift',  (select jsonb_build_object('total', total, 'active', active, 'idle', idle, 'unchecked', unchecked, 'issues', issues) from fk_agg),
  'inventory', (select jsonb_build_object('total', total, 'locked', locked) from inv),
  'gate_cycle',(select jsonb_build_object('done_n', done_n, 'inout_mins', inout_mins, 'wait_mins', wait_mins) from gate_cycle)
)
$function$;

-- Bảo mật (bài học 20260815i): Postgres mặc định GRANT EXECUTE cho PUBLIC trên hàm mới —
-- thu hồi rồi cấp lại đúng service_role (mọi lời gọi đi qua backend).
REVOKE ALL ON FUNCTION public.control_tower_resources(text[], date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.control_tower_resources(text[], date) TO service_role;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260821_warehouse_type_configs.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- LOẠI KHO THEO TỪNG KHO + CHIẾN THUẬT XUẤT/NHẬP 2 TẦNG            (21/08/2026)
-- Kế hoạch: docs/plans/WH_TYPE_STRATEGY_PLAN.md (Đợt 1, mục 2.1 + 2.6)
-- ----------------------------------------------------------------------------
-- VÌ SAO:
--   1. Mỗi kho vận hành một TẬP loại kho riêng (kho A không chạy RM01), nhưng app đang cho
--      mọi kho dùng cả danh mục ⇒ form nào cũng liệt kê loại kho không liên quan.
--   2. Chiến thuật xuất/nhập đang là MỘT bộ cho cả kho, trong khi thực tế FG01 chạy FEFO còn
--      RM01 chạy FIFO ngay trong cùng một kho.
-- CÁCH LÀM: 1 bảng `warehouse_type_configs` giải cả hai —
--   • SỰ TỒN TẠI của dòng  = "kho này CÓ vận hành loại này"
--   • Cột chiến thuật NULL = "kế thừa mặc định của kho" (mặc định sau backfill: TẤT CẢ NULL
--     ⇒ hành vi y hệt trước migration; đây là tiêu chí số 1 của đợt này)
--
-- 2 CỘT MỚI trên "Warehouse" (thang ưu tiên CẤT hàng tường minh — trước nay CỨNG trong code):
--   • putaway_same_mat_date_pref : trong các ô CÙNG MÃ thì ưu tiên date nào (Bước 2)
--   • putaway_fallback           : hết nhóm ưu tiên thì các ô còn lại xếp theo gì (Bước 3)
--   Default 'NONE'/'BY_CODE' = ĐÚNG hành vi hôm nay (★ cùng mã → còn lại theo tên vị trí).
--
-- LUẬT "bug chết hai lần": `warehouse_type_configs.type_code` MANG giá trị Loại kho ⇒ bắt buộc
-- vào cascade `rename_warehouse_type` (phần 4). RPC gác `warehouse_type_column_coverage`
-- (20260815b) quét SỐNG mọi cột nên nếu quên, gói QA 00-invariant sẽ ĐỎ — không cần bản đồ tay.
--
-- ⚠️ "Warehouse".id là TEXT (không phải uuid) — FK phải cùng kiểu.
-- CÁCH CHẠY: Supabase Dashboard → SQL Editor → dán → Run (STAGING trước, production khi merge).
-- ============================================================================

-- [cutover] gỡ: BEGIN;

-- ── 1) 2 cột thang ưu tiên cất hàng trên Warehouse ──────────────────────────
ALTER TABLE "Warehouse"
  ADD COLUMN IF NOT EXISTS putaway_same_mat_date_pref text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS putaway_fallback           text NOT NULL DEFAULT 'BY_CODE';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_same_mat_date_pref_chk') THEN
    ALTER TABLE "Warehouse" ADD CONSTRAINT warehouse_same_mat_date_pref_chk
      CHECK (putaway_same_mat_date_pref IN ('NONE','SAME_DATE','OLDER_FIRST','NEWER_FIRST'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_putaway_fallback_chk') THEN
    ALTER TABLE "Warehouse" ADD CONSTRAINT warehouse_putaway_fallback_chk
      CHECK (putaway_fallback IN ('BY_CODE','EMPTY_FIRST','MOST_FREE','LEAST_FILLED'));
  END IF;
END $$;

COMMENT ON COLUMN "Warehouse".putaway_same_mat_date_pref IS
  'Bước 2 thang cất hàng: trong các ô CÙNG MÃ ưu tiên date nào (NONE=không xét — hành vi trước 21/08)';
COMMENT ON COLUMN "Warehouse".putaway_fallback IS
  'Bước 3 thang cất hàng: các ô ngoài nhóm ưu tiên xếp theo gì (BY_CODE=tên vị trí — hành vi trước 21/08)';

-- ── 2) Bảng GÁN loại kho cho kho + chiến thuật riêng theo loại ──────────────
CREATE TABLE IF NOT EXISTS warehouse_type_configs (
  id                         text        PRIMARY KEY,
  warehouse_id               text        NOT NULL REFERENCES "Warehouse"(id) ON DELETE CASCADE,
  type_code                  text        NOT NULL,   -- mã LookupValue type='warehouse_type'
  -- NULL = kế thừa mặc định của kho (KHÔNG có giá trị "giống kho" nào khác)
  rotation_principle         text        NULL CHECK (rotation_principle IN ('FEFO','FIFO','LIFO')),
  rotation_required          boolean     NULL,
  putaway_priority           text        NULL CHECK (putaway_priority IN ('CONSOLIDATE','SPREAD','ABC')),
  putaway_enforced           text[]      NULL,       -- THAY THẾ nguyên mảng của kho, không merge
  putaway_max_materials      integer     NULL CHECK (putaway_max_materials BETWEEN 1 AND 1000),
  putaway_date_mix           text        NULL CHECK (putaway_date_mix IN ('ANY','SAME','NEWER_ONLY','OLDER_ONLY')),
  putaway_block_pick_face    boolean     NULL,
  putaway_block_qa_hold      boolean     NULL,
  putaway_block_full         boolean     NULL,
  putaway_single_ncc         boolean     NULL,
  putaway_same_mat_date_pref text        NULL CHECK (putaway_same_mat_date_pref IN ('NONE','SAME_DATE','OLDER_FIRST','NEWER_FIRST')),
  putaway_fallback           text        NULL CHECK (putaway_fallback IN ('BY_CODE','EMPTY_FIRST','MOST_FREE','LEAST_FILLED')),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL,
  updated_by                 text        NULL,
  CONSTRAINT uq_wtc_wh_type UNIQUE (warehouse_id, type_code)
);
CREATE INDEX IF NOT EXISTS idx_wtc_warehouse ON warehouse_type_configs(warehouse_id);

COMMENT ON TABLE warehouse_type_configs IS
  'Loại kho mà MỖI kho vận hành (sự tồn tại của dòng) + chiến thuật xuất/nhập riêng theo loại (cột NULL = kế thừa kho)';

-- ── 3) BACKFILL — kho hiện hành có sẵn loại đang dùng, không phải khai lại ───
--   Nguồn suy đoán: khu vực ∪ vị trí ∪ loại của mã đang có tồn trong kho.
--   Kho không dò ra loại nào (kho mới/kho NONE chưa có dữ liệu) → gán ĐỦ MỌI loại: kho 0 loại
--   sẽ bị Đợt 2 chặn oan mọi form. Chiến thuật để NULL hết ⇒ hành vi không đổi.
INSERT INTO warehouse_type_configs (id, warehouse_id, type_code, updated_at, updated_by)
SELECT gen_random_uuid()::text, s.wid, s.tc, now(), 'migration 20260821'
FROM (
  SELECT w.id AS wid, unnest(
    CASE WHEN coalesce(array_length(d.derived, 1), 0) > 0
         THEN d.derived
         ELSE (SELECT array_agg(DISTINCT value) FROM "LookupValue" WHERE type = 'warehouse_type')
    END) AS tc
  FROM "Warehouse" w
  CROSS JOIN LATERAL (
    SELECT array_agg(DISTINCT c) AS derived FROM (
      SELECT c FROM "WarehouseZone" z, unnest(z.categories) c WHERE z.warehouse_id = w.id
      UNION
      SELECT c FROM "Location" l, unnest(l.categories) c      WHERE l.warehouse_id = w.id
      UNION
      SELECT m.category FROM "InventoryEntry" e JOIN "Material" m ON m.id = e.material_id
       WHERE e.warehouse_id::text = w.id AND m.category IS NOT NULL
    ) x(c)
    -- Chỉ nhận mã CÒN trong danh mục (dữ liệu cũ có thể mang loại đã bị đổi tên/xoá)
    WHERE c IN (SELECT value FROM "LookupValue" WHERE type = 'warehouse_type')
  ) d
) s
ON CONFLICT (warehouse_id, type_code) DO NOTHING;

-- Lưới go-live: kho active mà 0 loại = mọi form của kho đó sẽ chặn oan ⇒ dừng migration, đừng
-- để phát hiện lúc vận hành (học migration 20260814_role_flags).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "Warehouse" w
   WHERE w.is_active = true
     AND NOT EXISTS (SELECT 1 FROM warehouse_type_configs c WHERE c.warehouse_id = w.id);
  IF n > 0 THEN
    RAISE EXCEPTION 'Backfill trượt: còn % kho ACTIVE chưa được gán loại kho nào', n;
  END IF;
END $$;

-- ── 4) Cascade ĐỔI TÊN loại kho — thêm cột thứ 19 (bắt buộc, xem đầu file) ───
CREATE OR REPLACE FUNCTION public.rename_warehouse_type(p_old text, p_new text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  counts jsonb := '{}'::jsonb;
  n bigint;
BEGIN
  p_new := btrim(p_new);
  IF p_old IS NULL OR p_new IS NULL OR p_new = '' OR p_old = p_new THEN
    RAISE EXCEPTION 'Tên mới không hợp lệ' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = p_old) THEN
    RAISE EXCEPTION 'Loại kho "%" không tồn tại', p_old USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM "LookupValue" WHERE type = 'warehouse_type' AND value = p_new) THEN
    RAISE EXCEPTION 'Loại kho "%" đã tồn tại', p_new USING ERRCODE = '23505';
  END IF;

  UPDATE "LookupValue" SET value = p_new, updated_at = now()
    WHERE type = 'warehouse_type' AND value = p_old;

  UPDATE "Material" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Material', n);

  -- MẢNG (multi-loại 27/07): Location / WarehouseZone / StocktakeLog
  UPDATE "Location" SET categories = array_replace(categories, p_old, p_new)
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Location', n);

  UPDATE "WarehouseZone" SET categories = array_replace(categories, p_old, p_new)
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('WarehouseZone', n);

  UPDATE "StocktakeLog" SET categories = array_replace(categories, p_old, p_new), updated_at = now()
    WHERE p_old = ANY(categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('StocktakeLog', n);

  UPDATE "Employee" SET allowed_categories = array_replace(allowed_categories, p_old, p_new)
    WHERE p_old = ANY(allowed_categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Employee', n);

  UPDATE "Warehouse" SET carton_scan_categories = array_replace(carton_scan_categories, p_old, p_new)
    WHERE p_old = ANY(carton_scan_categories);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('Warehouse', n);

  -- ⭐ MỚI 21/08 — TẬP loại kho mỗi kho vận hành + chiến thuật riêng theo loại.
  -- Sót cột này = đổi tên loại xong mọi dòng gán/chiến thuật per-loại trỏ vào mã CHẾT: kho mất
  -- loại đang vận hành, chiến thuật riêng im lặng rơi về mặc định kho.
  UPDATE warehouse_type_configs SET type_code = p_new, updated_at = now() WHERE type_code = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('warehouse_type_configs', n);

  UPDATE "SlotTemplate" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('SlotTemplate', n);

  UPDATE "DeliverySlot" SET cargo_type = p_new WHERE cargo_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('DeliverySlot', n);

  UPDATE "TmsOrder" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('TmsOrder', n);

  -- Cửa đặt lịch (03/08) — giá trị ĐƠN, tách khỏi luật giao ≥1 nhưng vẫn là Loại kho
  UPDATE "TmsOrder" SET booking_category = p_new WHERE booking_category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('TmsOrder.booking_category', n);

  UPDATE khvc_lines SET booking_category = p_new WHERE booking_category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('khvc_lines', n);

  -- Chuyến chở lẫn: thay ĐÚNG phần tử trong chuỗi ghép (DISTINCT phòng khi ghép ra trùng)
  UPDATE "GroupDeliveryOrder"
     SET warehouse_type = (SELECT string_agg(DISTINCT c, '+')
                             FROM unnest(array_replace(wt_cats(warehouse_type), p_old, p_new)) c)
   WHERE wt_cats(warehouse_type) @> ARRAY[p_old];
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('GroupDeliveryOrder', n);

  -- snapshot Loại kho trên DÒNG ĐƠN XUẤT (= Material.category lúc tạo)
  UPDATE "OutboundItem" SET material_type = p_new WHERE material_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('OutboundItem', n);

  -- snapshot Loại kho trong cảnh báo vận hành
  UPDATE alert_events SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('alert_events', n);

  UPDATE gate_registrations SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('gate_registrations', n);

  UPDATE inbound_plan_lines SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('inbound_plan_lines', n);

  UPDATE "ProductionImport" SET warehouse_type = p_new WHERE warehouse_type = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('ProductionImport', n);

  UPDATE "PalletLabelPrint" SET category = p_new WHERE category = p_old;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('PalletLabelPrint', n);

  RETURN counts;
END;
$function$;

-- Bảng cấu hình chỉ backend (service_role) đụng tới — đóng cửa PUBLIC/anon/authenticated như
-- mọi bảng cấu hình khác (bài học 20260815i: Postgres mặc định cấp EXECUTE/quyền cho PUBLIC).
ALTER TABLE warehouse_type_configs ENABLE ROW LEVEL SECURITY;

-- [cutover] gỡ: COMMIT;

-- ============================================================================
-- KIỂM SAU KHI CHẠY
--   SELECT count(*) FROM warehouse_type_configs;                      -- 750+ dòng
--   SELECT * FROM warehouse_type_column_coverage();                   -- phải 0 dòng
--   SELECT w.code, array_agg(c.type_code ORDER BY c.type_code)
--     FROM "Warehouse" w JOIN warehouse_type_configs c ON c.warehouse_id = w.id
--    WHERE w.code IN ('20000016','20000017') GROUP BY w.code;         -- Ba Vì 5 · Bàu Bàng 4
--   -- round-trip đổi tên (tự trả về trạng thái cũ):
--   SELECT rename_warehouse_type('FG01','ZZTMP'); SELECT rename_warehouse_type('ZZTMP','FG01');
-- ============================================================================



-- ─────────────────────────────────────────────────────────────────────────
-- [20260821b_wh_type_sort_order.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 21/08/2026 — THỨ TỰ LOẠI KHO THEO TỪNG KHO
-- Trước đây thứ tự loại kho chỉ nằm ở "LookupValue.sort_order" (DANH MỤC DÙNG CHUNG) nên kéo FG02
-- lên đầu ở kho A thì MỌI kho đều thấy FG02 đứng đầu. Nay mỗi (kho, loại) có thứ tự riêng.
--   sort_order NULL  = chưa sắp riêng → rơi về thứ tự danh mục dùng chung (hành vi cũ)
-- Danh mục dùng chung vẫn giữ nguyên vai trò: thứ tự mặc định + cây Đăng ký cổng.

ALTER TABLE warehouse_type_configs ADD COLUMN IF NOT EXISTS sort_order integer;

COMMENT ON COLUMN warehouse_type_configs.sort_order IS
  'Thứ tự loại kho RIÊNG của kho này (kéo-thả ở tab Loại kho khi đã chọn kho). NULL = theo danh mục dùng chung.';

-- Backfill = đúng thứ tự đang hiển thị hôm nay ⇒ mở màn không thấy gì xáo trộn
UPDATE warehouse_type_configs c
   SET sort_order = l.sort_order
  FROM "LookupValue" l
 WHERE l.type = 'warehouse_type'
   AND l.value = c.type_code
   AND c.sort_order IS NULL;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260821c_wh_type_shared_catalogue.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 21/08/2026 — LOẠI KHO = DANH MỤC CHUNG, SETTING RIÊNG TỪNG KHO (user chốt vòng cuối)
--   • Tên loại + Màu + Bắt buộc HSD + Bắt buộc Pallet/EA  = KHAI 1 LẦN, áp mọi kho
--     (2 cờ sau ràng buộc HỒ SƠ MÃ HÀNG, mà mã hàng dùng chung toàn hệ thống)
--   • Thứ tự · chiến thuật xuất/nhập · 3 cờ vận hành       = RIÊNG từng kho
--   • Tạo loại kho mới ⇒ MỌI kho đều có (không còn "kho vận hành loại nào")
--
-- 3 cờ vận hành chuyển xuống bảng gán vì app đọc chúng khi ĐANG ĐỨNG Ở MỘT KHO cụ thể:
--   is_ncc_goods  → quét tem nhập tại kho / sinh tem cho kho
--   requires_ncc  → quét nhập · lưu tay · upload tồn của kho
--   batch_char    → sinh tem V2 cho kho
-- NULL = theo giá trị chung ở danh mục ⇒ sau migration mọi cột NULL, hành vi y hệt trước.

ALTER TABLE warehouse_type_configs
  ADD COLUMN IF NOT EXISTS is_ncc_goods boolean,
  ADD COLUMN IF NOT EXISTS requires_ncc boolean,
  ADD COLUMN IF NOT EXISTS batch_char   text;

ALTER TABLE warehouse_type_configs DROP CONSTRAINT IF EXISTS wtc_batch_char_len;
ALTER TABLE warehouse_type_configs ADD CONSTRAINT wtc_batch_char_len
  CHECK (batch_char IS NULL OR batch_char ~ '^[A-Z0-9]$');

COMMENT ON COLUMN warehouse_type_configs.is_ncc_goods IS 'Riêng kho: QR V1 đoạn 4 = mã NCC. NULL = theo danh mục chung.';
COMMENT ON COLUMN warehouse_type_configs.requires_ncc IS 'Riêng kho: nhập kho bắt buộc có NCC. NULL = theo danh mục chung.';
COMMENT ON COLUMN warehouse_type_configs.batch_char   IS 'Riêng kho: ký tự cố định thế chỗ Máy trong mã lô V2. NULL = theo danh mục chung.';

-- MỌI KHO ĐỀU CÓ MỌI LOẠI — bù các cặp (kho, loại) còn thiếu.
-- Thứ tự cho dòng bù = thứ tự danh mục (kho nào đã sắp riêng thì phần cũ giữ nguyên).
INSERT INTO warehouse_type_configs (id, warehouse_id, type_code, sort_order, updated_at, updated_by)
SELECT gen_random_uuid(), w.id, l.value, l.sort_order, now(), 'migration 20260821c'
  FROM "Warehouse" w
  CROSS JOIN "LookupValue" l
 WHERE l.type = 'warehouse_type'
   AND NOT EXISTS (
     SELECT 1 FROM warehouse_type_configs c
      WHERE c.warehouse_id = w.id AND c.type_code = l.value);

-- Không kho nào được thiếu loại nào sau bước trên
DO $$
DECLARE thieu int;
BEGIN
  SELECT count(*) INTO thieu
    FROM "Warehouse" w CROSS JOIN "LookupValue" l
   WHERE l.type = 'warehouse_type'
     AND NOT EXISTS (SELECT 1 FROM warehouse_type_configs c
                      WHERE c.warehouse_id = w.id AND c.type_code = l.value);
  IF thieu > 0 THEN
    RAISE EXCEPTION 'Còn % cặp (kho, loại) chưa có dòng cấu hình — bù chưa đủ', thieu;
  END IF;
END $$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260821d_pallet_prints_page_warehouse.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 21/08/2026 — Lịch sử in tem trả thêm warehouse_id của TỪNG TEM.
--
-- Vì sao: cờ `is_ncc_goods` (đoạn 4 trên tem = NCC hay Máy) từ 21/08 khai RIÊNG được theo từng kho
-- (bảng warehouse_type_configs). Màn In tem in lại theo LỆNH IN, một lệnh có thể gồm tem của nhiều
-- kho ⇒ không thể hỏi cờ "theo kho đang chọn" (màn Lịch sử in không có filter kho). Muốn in đúng
-- nhãn thì mỗi tem phải mang kho của nó.
--
-- Thay đổi DUY NHẤT so bản 20260728h: CTE `t` select thêm p.warehouse_id (to_jsonb tự mang ra rows).
-- Không đổi mệnh đề WHERE, không đổi khóa gom phiếu, không đổi shape các key khác.
CREATE OR REPLACE FUNCTION public.pallet_prints_page(
  p_wh_scope text[], p_cat_scope text[], p_from timestamptz, p_to timestamptz, p_search text,
  p_modes text[], p_materials text[], p_cycles text[], p_machines text[], p_printers text[],
  p_offset integer, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE r jsonb;
BEGIN
  WITH b AS (
    -- Gom NGAY thành PHIẾU IN (đơn vị trang) — không vật hoá tập tem thô.
    -- Khoá phiếu = batch_id; log cũ chưa có batch_id thì gom theo created_at|mode|người in.
    SELECT COALESCE(p.batch_id::text,
                    p.created_at::text || '|' || p.mode || '|' || COALESCE(p.printed_by_name, '')) AS bkey,
           max(p.created_at) AS at, max(p.mode) AS md, count(*) AS n
    FROM "PalletLabelPrint" p
    WHERE (p_from IS NULL OR p.created_at >= p_from)
      AND (p_to   IS NULL OR p.created_at <= p_to)
      -- scope NULL-INCLUSIVE (dòng cũ chưa gắn kho/loại vẫn hiện) — giữ đúng quy ước toàn app
      AND (p_wh_scope  IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR p.category     IS NULL OR p.category     = ANY (p_cat_scope))
      AND (p_search    IS NULL OR p.qr_code ILIKE '%' || p_search || '%'
                               OR p.material_code ILIKE '%' || p_search || '%'
                               OR p.printed_by_name ILIKE '%' || p_search || '%')
      AND (p_modes     IS NULL OR p.mode            = ANY (p_modes))
      AND (p_materials IS NULL OR p.material_code   = ANY (p_materials))
      AND (p_cycles    IS NULL OR p.cycle           = ANY (p_cycles))
      AND (p_machines  IS NULL OR p.machine         = ANY (p_machines))
      AND (p_printers  IS NULL OR p.printed_by_name = ANY (p_printers))
    GROUP BY 1
  ),
  pg AS (SELECT bkey, at FROM b ORDER BY at DESC, bkey OFFSET p_offset LIMIT p_limit),
  -- Khoảng thời gian của ĐÚNG trang này → lấy tem bằng index, không quét bảng lần hai
  w  AS (SELECT min(at) AS lo, max(at) AS hi FROM pg),
  t AS (
    SELECT p.id, p.batch_id, p.qr_code, p.material_code, p.category, p.cycle, p.machine,
           p.seq, p.nmsx, p.qty, p.mode, p.printed_by_name, p.created_at, p.warehouse_id
    FROM "PalletLabelPrint" p, w
    WHERE p.created_at >= w.lo AND p.created_at <= w.hi
      AND (p_wh_scope  IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY (p_wh_scope))
      AND (p_cat_scope IS NULL OR p.category     IS NULL OR p.category     = ANY (p_cat_scope))
      AND (p_search    IS NULL OR p.qr_code ILIKE '%' || p_search || '%'
                               OR p.material_code ILIKE '%' || p_search || '%'
                               OR p.printed_by_name ILIKE '%' || p_search || '%')
      AND (p_modes     IS NULL OR p.mode            = ANY (p_modes))
      AND (p_materials IS NULL OR p.material_code   = ANY (p_materials))
      AND (p_cycles    IS NULL OR p.cycle           = ANY (p_cycles))
      AND (p_machines  IS NULL OR p.machine         = ANY (p_machines))
      AND (p_printers  IS NULL OR p.printed_by_name = ANY (p_printers))
      AND COALESCE(p.batch_id::text,
                   p.created_at::text || '|' || p.mode || '|' || COALESCE(p.printed_by_name, ''))
          IN (SELECT bkey FROM pg)
  )
  SELECT jsonb_build_object(
    -- Sắp xếp NGAY trong SQL (mới nhất trước) — backend không phải ghép chunk rồi sort lại
    'rows',       COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC, x.id) FROM t x), '[]'::jsonb),
    'total',      (SELECT count(*) FROM b),                          -- tổng PHIẾU IN khớp lọc
    'total_rows', (SELECT COALESCE(sum(n), 0) FROM b),               -- tổng TEM khớp lọc
    'new_n',      (SELECT count(*) FROM b WHERE md <> 'REPRINT'),
    'reprint_n',  (SELECT count(*) FROM b WHERE md  = 'REPRINT')
  ) INTO r;
  RETURN r;
END $function$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260821e_warehouse_scan_code_types.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 21/08/2026 — LOẠI MÃ CAMERA ĐỌC, đặt THEO TỪNG KHO (user chốt: "kho nào chỉ bắt QR, kho nào chỉ
-- bắt barcode, kho nào bắt cả 2").
--
-- Vì sao cần: mã vạch 1D KHÔNG có mã sửa lỗi ⇒ vạch mờ/moiré đọc ra số không có thật mà vẫn thoả
-- checksum (user báo "quét 14 ra 17"). Cách chặn TẬN GỐC ở kho chỉ dùng tem QR là ĐỪNG GIẢI mã vạch
-- ở đó — không giải thì không thể đọc sai. Kho có hàng NCC dán EAN trên thùng thì bật mã vạch.
--
-- MẶC ĐỊNH 'BOTH' = đúng hành vi đang chạy (từ 21/08 app đọc cả QR + 1D) ⇒ apply migration này
-- KHÔNG đổi hành vi kho nào; muốn siết thì đặt lại ở form Kho.
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS scan_code_types TEXT NOT NULL DEFAULT 'BOTH';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_scan_code_types_chk'
  ) THEN
    ALTER TABLE "Warehouse" ADD CONSTRAINT warehouse_scan_code_types_chk
      CHECK (scan_code_types IN ('QR', 'BARCODE', 'BOTH'));
  END IF;
END $$;

COMMENT ON COLUMN "Warehouse".scan_code_types IS
  'Loại mã camera được phép giải ở kho này: QR (chỉ tem QR) | BARCODE (chỉ mã vạch 1D) | BOTH.';



-- ─────────────────────────────────────────────────────────────────────────
-- [20260821f_dashboard_cache.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260821f — CACHE số liệu Dashboard (user chốt 21/08: 5 phút, đưa vào Cài đặt › Hệ thống).
--
-- VÌ SAO (đo 21/08 trên dữ liệu lớn — 55.779 dòng tồn, gói QA 06-readload, 8 luồng ghi + 6 người đọc):
--   Dashboard  p50 28.285ms · max 35.954ms · trả 500
-- Trang chủ là trang AI CŨNG mở đầu tiên, nên nó chậm là CẢ APP có cảm giác chậm.
--
-- ĐÃ LOẠI TRỪ query là nguyên nhân — đừng đi lại đường này:
--   · `dashboard_stats` chạy ẤM chỉ 64ms (2.721 buffer); lạnh 6,7s.
--   · Thử index giả định `(warehouse_id, material_id) INCLUDE (cartons_remaining)
--     WHERE cartons_remaining>0` trong BEGIN…ROLLBACK: cost 3811→2330 nhưng KHÔNG nhanh hơn 64ms ⇒
--     không tạo.
--   · 2 CTE `inv` và `by_unit` là cùng một lượt quét khác GROUP BY (gộp được về 1) nhưng chỉ lợi
--     ~30ms ⇒ không đáng rủi ro đổi số liệu trang chủ.
-- Nút thắt thật = XẾP HÀNG ở pool ~10 khe NỘI BỘ của PostgREST (memory `postgrest-pool-roundtrips`).
-- Cách duy nhất có tác dụng: ĐỪNG chạy tổng hợp nặng trong MỌI request.
--
-- Cache đặt Ở DB chứ không trong RAM của lambda: serverless có N instance, cache RAM thì mỗi
-- instance lạnh vẫn phải trả giá đủ (đúng lúc tải cao Vercel bung thêm instance = đúng lúc cache RAM
-- vô dụng nhất). Bảng dùng chung ⇒ instance thứ 2..N đọc 1 dòng nhỏ.

CREATE TABLE IF NOT EXISTS public.dashboard_cache (
  key         text        PRIMARY KEY,
  payload     jsonb       NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
-- Bật RLS: bất biến gói QA 00 đòi MỌI bảng public phải bật (không hở với anon key).
-- Không khai policy — chỉ service_role (bypass RLS) đọc/ghi bảng này.
ALTER TABLE public.dashboard_cache ENABLE ROW LEVEL SECURITY;

-- Bọc dashboard_all: TRẢ LẠI kết quả còn tươi, hết hạn thì tính rồi lưu.
-- p_ttl_seconds <= 0 ⇒ BỎ QUA cache hoàn toàn (cờ dashboard_cache_seconds = 0 → hành vi CŨ nguyên vẹn).
CREATE OR REPLACE FUNCTION public.dashboard_all_cached(
  p_warehouse_ids text[],
  p_categories    text[],
  p_today         date,
  p_ttl_seconds   int DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_key  text;
  v_hit  jsonb;
  v_calc jsonb;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RETURN dashboard_all(p_warehouse_ids, p_categories, p_today);
  END IF;

  -- Khoá cache = ĐÚNG bộ tham số. Sắp mảng trước khi ghép để 2 user cùng phạm vi kho nhưng thứ tự
  -- id khác nhau vẫn CHUNG một dòng cache (không thì cache phân mảnh vô ích).
  v_key := md5(
       coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p_warehouse_ids) x), '*')
    || '|' || coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p_categories) x), '*')
    || '|' || coalesce(p_today::text, '*'));

  SELECT payload INTO v_hit FROM public.dashboard_cache
   WHERE key = v_key AND computed_at > now() - make_interval(secs => p_ttl_seconds);
  IF v_hit IS NOT NULL THEN
    RETURN v_hit;
  END IF;

  v_calc := dashboard_all(p_warehouse_ids, p_categories, p_today);

  INSERT INTO public.dashboard_cache(key, payload, computed_at) VALUES (v_key, v_calc, now())
  ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;

  -- Dọn lười: khoá gắn NGÀY nên mỗi ngày sinh bộ khoá mới. Xoá dòng quá 2 ngày để bảng không phình.
  -- (Chỉ chạy ở nhánh MISS — tức tối đa vài lần / TTL, không phải mỗi request.)
  DELETE FROM public.dashboard_cache WHERE computed_at < now() - interval '2 days';

  RETURN v_calc;
END $$;

REVOKE ALL ON FUNCTION public.dashboard_all_cached(text[], text[], date, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_all_cached(text[], text[], date, int) TO service_role;

-- Kiểm sau khi apply:
--   SELECT dashboard_all_cached(NULL, NULL, current_date, 300);   -- lượt 1: tính + lưu
--   SELECT dashboard_all_cached(NULL, NULL, current_date, 300);   -- lượt 2: phải NHANH HẲN
--   SELECT dashboard_all_cached(NULL, NULL, current_date, 0)
--        = dashboard_all(NULL, NULL, current_date);               -- ttl=0 phải KHỚP đường cũ
--   SELECT count(*) FROM dashboard_cache;                         -- 1 dòng / (phạm vi, ngày)



-- ─────────────────────────────────────────────────────────────────────────
-- [20260821g_inventory_band_by_unit.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260821g — Ô tổng Tồn kho: TÁCH THEO ĐƠN VỊ (user chốt 21/08).
--
-- Vấn đề: ô "SL (quy đổi)" là MỘT con số cộng gộp nhiều đơn vị vật lý khác nhau. Đo thật trên
-- staging (Kho Bàu Bàng): 132.762.662 — công thức ĐÚNG (quy đổi per-mã trước khi cộng, đã đối
-- chiếu oracle độc lập, lệch 0,008 do làm tròn) nhưng **131.209.050 trong đó là EA** của 2.169
-- pallet mã không khai quy cách thùng, cộng lẫn 784.654 KG và ~538.000 thùng thật. Tooltip đã nói
-- "không phải số thùng thực tế" — nhưng bắt người đọc tra tooltip mới hiểu con số thì con số đó
-- chưa dùng được.
--
-- Nay RPC trả THÊM 'by_unit' (mảng { unit, qty } sắp giảm dần). TỔNG GIỮ NGUYÊN — không đổi công
-- thức, chỉ nói rõ nó gồm những gì. Thêm khoá vào jsonb là ADDITIVE: bundle FE cũ bỏ qua, không vỡ.
--
-- ⚠️ Nhánh by_unit phải KHỚP cách phân đơn vị của dashboard_stats (entry_unit khi mã có quy cách
-- thùng, còn lại base_unit) — 2 chỗ lệch nhau thì Dashboard và Tồn kho đá nhau.

CREATE OR REPLACE FUNCTION inventory_band_totals(
  p_ids            text[],
  p_status         text,
  p_wh_ids         text[],
  p_location_ids   text[],
  p_material_ids   text[],
  p_categories     text[],
  p_qa_ids         text[],
  p_search         text,
  p_search_mat_ids text[],
  p_search_loc_ids text[],
  p_manufacturer   text,
  p_cycles         text[],
  p_machines       text[],
  p_nmsx           text[],
  p_ncc_ids        text[],
  p_import_from    timestamptz,
  p_import_to      timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH e AS (
    SELECT ie.material_id, ie.cartons_remaining
    FROM "InventoryEntry" ie
    JOIN "Material" m ON m.id = ie.material_id       -- = `material:Material!inner`
    WHERE (p_ids IS NULL OR ie.id = ANY (p_ids))
      AND (CASE
             WHEN p_status IS NULL OR p_status = '' THEN
               ie.status = ANY (ARRAY['IN_STOCK','PARTIAL','LOOSE_PICKING']) AND ie.cartons_remaining > 0
             WHEN p_status = 'ALL' THEN TRUE
             ELSE ie.status = p_status
           END)
      AND (p_wh_ids       IS NULL OR ie.warehouse_id::text = ANY (p_wh_ids))
      AND (p_location_ids IS NULL OR ie.location_id  = ANY (p_location_ids))
      AND (p_material_ids IS NULL OR ie.material_id  = ANY (p_material_ids))
      AND (p_categories   IS NULL OR m.category      = ANY (p_categories))
      AND (p_qa_ids       IS NULL OR ie.qa_status_id = ANY (p_qa_ids))
      AND (p_manufacturer IS NULL OR ie.manufacturer_id = p_manufacturer)
      AND (p_cycles       IS NULL OR ie.cycle        = ANY (p_cycles))
      AND (p_machines     IS NULL OR ie.machine_code = ANY (p_machines))
      AND (p_nmsx         IS NULL OR ie.nmsx         = ANY (p_nmsx))
      AND (p_ncc_ids      IS NULL OR ie.ncc_id::text = ANY (p_ncc_ids))
      AND (p_import_from  IS NULL OR ie.import_date >= p_import_from)
      AND (p_import_to    IS NULL OR ie.import_date <= p_import_to)
      AND (p_search IS NULL
           OR ie.pallet_code ILIKE '%' || p_search || '%'
           OR (p_search_mat_ids IS NOT NULL AND ie.material_id = ANY (p_search_mat_ids))
           OR (p_search_loc_ids IS NOT NULL AND ie.location_id = ANY (p_search_loc_ids)))
  ),
  g AS (
    SELECT e.material_id, sum(e.cartons_remaining) AS rem,
           -- ô "Pallet" chỉ đếm pallet CÒN TỒN (>0): list chỉ hiện pallet 0 khi chọn "Tất cả"
           count(*) FILTER (WHERE e.cartons_remaining > 0) AS n_pallet
    FROM e GROUP BY 1
  )
  SELECT jsonb_build_object(
    'total_cartons_remaining',
      (SELECT COALESCE(sum(qty_entry_decimal(g.rem, m.entry_unit, m.units_per_carton)), 0)
       FROM g JOIN "Material" m ON m.id = g.material_id),
    'total_pallets_in_stock', (SELECT COALESCE(sum(n_pallet), 0) FROM g),
    -- TÁCH theo ĐƠN VỊ HIỂN THỊ (21/08): ô tổng gộp cả thùng + EA + KG + BAG nên con số to bất
    -- thường (đo Bàu Bàng: 132.762.662 mà 131,2 triệu trong đó là EA của mã không khai thùng).
    -- Công thức TỔNG giữ nguyên — chỉ NÓI RÕ nó gồm những gì. Đơn vị hiển thị = entry_unit khi mã
    -- có quy cách thùng, còn lại base_unit (KHỚP nhánh by_unit của dashboard_stats).
    'by_unit', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('unit', u.unit, 'qty', u.qty) ORDER BY u.qty DESC)
      FROM (
        SELECT CASE WHEN m.entry_unit IS NOT NULL AND COALESCE(m.units_per_carton, 0) > 0
                    THEN m.entry_unit ELSE COALESCE(m.base_unit, 'CAR') END AS unit,
               sum(qty_entry_decimal(g.rem, m.entry_unit, m.units_per_carton)) AS qty
        FROM g JOIN "Material" m ON m.id = g.material_id
        GROUP BY 1
      ) u WHERE u.qty <> 0), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;



-- ─────────────────────────────────────────────────────────────────────────
-- [20260821h_warehouse_id_type_align.sql]  (đã gỡ 2 lệnh BEGIN/COMMIT tầng ngoài — part tự bọc transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- 20260821h — DỌN LỆCH KIỂU: InventoryEntry.warehouse_id / PalletOperation.warehouse_id
--             uuid → text, cho khớp Warehouse.id (text) rồi đặt FK.
--
-- VÌ SAO (phát hiện 21/08 khi soi hiệu năng Dashboard):
--   `Warehouse.id` là **text** và 21 bảng khác đã trỏ FK vào nó (Location, ProductionImport,
--   GroupDeliveryOrder, FillTask, TmsOrder, Attendance…). ĐÚNG 2 bảng lạc kiểu: InventoryEntry và
--   PalletOperation khai **uuid**. Hậu quả đo được:
--     · KHÔNG đặt được FK ⇒ không có gì chặn warehouse_id trỏ vào kho không tồn tại.
--     · Mọi câu SQL nối 2 bảng buộc phải cast: `dashboard_stats` có 3 chỗ
--       `join "Warehouse" w on w.id = ie.warehouse_id::text` — cast trên CỘT làm index trên
--       warehouse_id không phục vụ được phép nối.
--     · Viết RPC mới theo phản xạ tự nhiên (`w.id = ie.warehouse_id`) là **42883 lúc chạy**, không
--       phải lúc biên dịch — đúng lớp lỗi "chỉ nổ khi có người dùng tới".
--
-- AN TOÀN — đã kiểm trước khi viết migration này:
--   · 0 dòng orphan ở CẢ HAI bảng (warehouse_id không khớp Warehouse nào) ⇒ FK gắn được ngay.
--   · KHÔNG view nào phụ thuộc cột; KHÔNG hàm nào dùng `::uuid` trên cột (nên đổi kiểu không vỡ RPC).
--   · Các chỗ đang cast `::text` vẫn chạy nguyên (text::text là no-op).
--   · 5 index chứa cột (idx_ie_facet_wh_status, idx_ie_wh_importdate, idx_ie_wh_mat_rem,
--     idx_inventory_putaway_violation, uq_inventory_active_wh_pallet) + idx_pallet_op_wh_created
--     được Postgres TỰ dựng lại trong ALTER — kiểm lại ở cuối file.
--
-- ⚠️ CHÚ Ý KHI APPLY PRODUCTION: `ALTER COLUMN … TYPE` GHI LẠI TOÀN BẢNG và giữ ACCESS EXCLUSIVE
--    (khoá đọc lẫn ghi) tới khi xong. InventoryEntry ở staging 55.779 dòng / 65MB chạy vài giây;
--    production lớn hơn thì phải APPLY TRONG CỬA SỔ NGHỈ, đừng chạy giữa giờ kho đang quét.
--    Không có bước đổi Ý NGHĨA dữ liệu nên không cần backup bảng (giá trị y nguyên, chỉ đổi kiểu).

-- [cutover] gỡ: BEGIN;

ALTER TABLE public."InventoryEntry"
  ALTER COLUMN warehouse_id TYPE text USING warehouse_id::text;

ALTER TABLE public."PalletOperation"
  ALTER COLUMN warehouse_id TYPE text USING warehouse_id::text;

-- FK theo ĐÚNG khuôn của bảng cùng họ (Location_warehouse_id_fkey): xoá kho vẫn còn tồn/lượt
-- dồn-tách là RESTRICT — chứng từ tồn kho không được thành mồ côi.
ALTER TABLE public."InventoryEntry"
  ADD CONSTRAINT "InventoryEntry_warehouse_id_fkey"
  FOREIGN KEY (warehouse_id) REFERENCES public."Warehouse"(id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public."PalletOperation"
  ADD CONSTRAINT "PalletOperation_warehouse_id_fkey"
  FOREIGN KEY (warehouse_id) REFERENCES public."Warehouse"(id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- [cutover] gỡ: COMMIT;

-- PostgREST giữ schema trong cache → phải nạp lại, không thì filter theo cột vừa đổi kiểu
-- có thể còn dùng bản cũ.
NOTIFY pgrst, 'reload schema';

-- Kiểm sau khi apply:
--   SELECT table_name, data_type FROM information_schema.columns
--    WHERE table_schema='public' AND column_name='warehouse_id'
--      AND table_name IN ('InventoryEntry','PalletOperation','Warehouse');   -- phải text
--   SELECT conname FROM pg_constraint WHERE conname LIKE '%warehouse_id_fkey'
--     AND conrelid IN ('public."InventoryEntry"'::regclass,'public."PalletOperation"'::regclass);
--   SELECT indexname FROM pg_indexes WHERE tablename='InventoryEntry'
--     AND indexdef ILIKE '%warehouse_id%';                                   -- phải còn ĐỦ 5
--   SELECT count(*) FROM "InventoryEntry" WHERE warehouse_id IS NOT NULL;    -- không đổi



-- ─────────────────────────────────────────────────────────────────────────
-- [20260821i_inventory_summary_by_unit.sql]
-- ─────────────────────────────────────────────────────────────────────────
-- 20260821i — Nhánh "Tổng hợp" của trang Tồn kho cũng TÁCH ĐƠN VỊ (đi kèm 20260821g).
--
-- 20260821g đã thêm 'by_unit' cho ô band của chế độ xem CHI TIẾT (RPC inventory_band_totals).
-- Trang Tồn kho có 2 chế độ xem dùng 2 RPC khác nhau, nên nếu chỉ sửa một bên thì CÙNG một trang
-- lúc hiện phần tách đơn vị lúc không — đúng kiểu "sửa 1 chỗ, chỗ kia lệch" mà CLAUDE.md dặn.
-- Nhánh by_unit ở đây phải KHỚP TUYỆT ĐỐI công thức của 20260821g + dashboard_stats.

CREATE OR REPLACE FUNCTION inventory_summary_page(
  p_ids            text[],   -- lọc %Date: tập id đã áp đủ filter khác (null = không dùng)
  p_status         text,     -- ''/null = "Còn tồn" (mặc định) · 'ALL' = mọi trạng thái · khác = đúng trạng thái đó
  p_wh_ids         text[],
  p_location_ids   text[],
  p_material_ids   text[],
  p_categories     text[],
  p_qa_ids         text[],
  p_search         text,
  p_search_mat_ids text[],
  p_search_loc_ids text[],
  p_manufacturer   text,
  p_cycles         text[],
  p_machines       text[],
  p_nmsx           text[],
  p_ncc_ids        text[],
  p_import_from    timestamptz,
  p_import_to      timestamptz,
  p_offset         int,
  p_limit          int
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET plan_cache_mode = force_custom_plan
AS $$
DECLARE r jsonb;
BEGIN
  WITH e AS (
    SELECT COALESCE(l.warehouse_id, ie.warehouse_id::text) AS wh_id,
           ie.material_id, ie.production_date, ie.ncc_id, ie.shelf_life_days, ie.expiry_date,
           ie.cartons_imported, ie.cartons_remaining
    FROM "InventoryEntry" ie
    -- INNER JOIN = `material:Material!inner` ở select cũ: entry không có mã hàng bị loại HẲN
    JOIN "Material" m ON m.id = ie.material_id
    LEFT JOIN "Location" l ON l.id = ie.location_id
    WHERE (p_ids IS NULL OR ie.id = ANY (p_ids))
      -- "Còn tồn" = trạng thái hoạt động VÀ tồn > 0 (upload cho phép tồn=0 → không lọt list)
      AND (CASE
             WHEN p_status IS NULL OR p_status = '' THEN
               ie.status = ANY (ARRAY['IN_STOCK','PARTIAL','LOOSE_PICKING']) AND ie.cartons_remaining > 0
             WHEN p_status = 'ALL' THEN TRUE
             ELSE ie.status = p_status
           END)
      -- Lọc KHO đi thẳng cột warehouse_id (KHÔNG liệt kê vị trí của kho — bug 504 Bàu Bàng 27/07)
      AND (p_wh_ids       IS NULL OR ie.warehouse_id::text = ANY (p_wh_ids))
      AND (p_location_ids IS NULL OR ie.location_id  = ANY (p_location_ids))
      AND (p_material_ids IS NULL OR ie.material_id  = ANY (p_material_ids))
      AND (p_categories   IS NULL OR m.category      = ANY (p_categories))
      AND (p_qa_ids       IS NULL OR ie.qa_status_id = ANY (p_qa_ids))
      AND (p_manufacturer IS NULL OR ie.manufacturer_id = p_manufacturer)
      AND (p_cycles       IS NULL OR ie.cycle        = ANY (p_cycles))
      AND (p_machines     IS NULL OR ie.machine_code = ANY (p_machines))
      AND (p_nmsx         IS NULL OR ie.nmsx         = ANY (p_nmsx))
      AND (p_ncc_ids      IS NULL OR ie.ncc_id::text = ANY (p_ncc_ids))
      AND (p_import_from  IS NULL OR ie.import_date >= p_import_from)
      AND (p_import_to    IS NULL OR ie.import_date <= p_import_to)
      -- Omni-search: mã pallet HOẶC mã/tên hàng HOẶC mã vị trí (2 tập id resolve sẵn ở tầng TS)
      AND (p_search IS NULL
           OR ie.pallet_code ILIKE '%' || p_search || '%'
           OR (p_search_mat_ids IS NOT NULL AND ie.material_id = ANY (p_search_mat_ids))
           OR (p_search_loc_ids IS NOT NULL AND ie.location_id = ANY (p_search_loc_ids)))
  ),
  g AS (
    SELECT wh_id, material_id, production_date, ncc_id, shelf_life_days, expiry_date,
           sum(cartons_imported)  AS cartons_imported,
           sum(cartons_remaining) AS cartons_remaining,
           -- chỉ đếm pallet CÒN TỒN (user chốt 05/07)
           count(*) FILTER (WHERE cartons_remaining > 0) AS pallet_count
    FROM e
    GROUP BY 1,2,3,4,5,6
  ),
  gg AS (
    SELECT g.*, m.material_code, m.short_name, m.category, m.base_unit, m.entry_unit,
           m.units_per_carton, m.shelf_life_days AS mat_shelf_life_days,
           m.supplier_shelf_life_overrides,
           COALESCE(w.name, '—') AS warehouse_name, tc.name AS ncc_name
    FROM g
    JOIN "Material" m ON m.id = g.material_id
    LEFT JOIN "Warehouse" w ON w.id = g.wh_id
    LEFT JOIN "TransportCompany" tc ON tc.id = g.ncc_id
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM gg),
    -- BASE UNIT: tổng cross-mã phải quy đổi THEO TỪNG MÃ trước khi cộng (cộng base thô rồi gắn
    -- nhãn "thùng" là thổi tổng). Dùng chung helper qty_entry_decimal — mirror utils/qtyUnits.
    'total_cartons_remaining',
      (SELECT COALESCE(sum(qty_entry_decimal(cartons_remaining, entry_unit, units_per_carton)), 0) FROM gg),
    -- TÁCH theo ĐƠN VỊ HIỂN THỊ — phải KHỚP nhánh by_unit của inventory_band_totals (20260821g)
    -- và dashboard_stats, không thì 2 chế độ xem của CÙNG trang Tồn kho hiện khác nhau.
    'by_unit', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('unit', u.unit, 'qty', u.qty) ORDER BY u.qty DESC)
      FROM (
        SELECT CASE WHEN entry_unit IS NOT NULL AND COALESCE(units_per_carton, 0) > 0
                    THEN entry_unit ELSE COALESCE(base_unit, 'CAR') END AS unit,
               sum(qty_entry_decimal(cartons_remaining, entry_unit, units_per_carton)) AS qty
        FROM gg GROUP BY 1
      ) u WHERE u.qty <> 0), '[]'::jsonb),
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'warehouse_id',     wh_id,
               'warehouse_name',   warehouse_name,
               'material_id',      material_id,
               'material_code',    material_code,
               'short_name',       short_name,
               'category',         category,
               'production_date',  production_date,
               'expiry_date',      expiry_date,
               'ncc_id',           ncc_id,
               'ncc_name',         ncc_name,
               'shelf_life_days',  shelf_life_days,
               'mat_shelf_life_days', mat_shelf_life_days,
               'supplier_shelf_life_overrides', supplier_shelf_life_overrides,
               'cartons_imported',  cartons_imported,
               'cartons_remaining', cartons_remaining,
               'cartons_exported',  GREATEST(0, cartons_imported - cartons_remaining),
               'pallet_count',      pallet_count,
               'base_unit',         base_unit,
               'entry_unit',        entry_unit,
               'units_per_carton',  units_per_carton) ORDER BY ord)
      FROM (
        -- Sắp giống bản JS cũ: mã hàng ↑, tên kho ↑, ngày SX MỚI NHẤT trước
        SELECT gg.*, row_number() OVER (ORDER BY material_code, warehouse_name, production_date DESC NULLS LAST) AS ord
        FROM gg ORDER BY material_code, warehouse_name, production_date DESC NULLS LAST
        OFFSET p_offset LIMIT p_limit
      ) pg), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;


COMMIT;
-- === HẾT PART 1/10 ===
