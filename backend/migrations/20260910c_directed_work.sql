-- ============================================================================
-- 20260910c — DIRECTED WORK đợt 1c: KẾ HOẠCH LẤY HÀNG THEO VỊ TRÍ + 3 BẢNG THEO VAI
-- (user chốt 10/09/2026 qua 6 vòng brainstorm — plan: docs/plans/DIRECTED_WORK_1C_PLAN.md)
-- ============================================================================
-- VÌ SAO: đo Ba Vì 10/09 — 5.973 pallet trong 216 ô, 62 % nằm tầng ≥ 2 (phải có xe nâng hạ),
-- mã lớn nhất rải 33 dãy · 3 khu · 10 NSX. Thủ kho hiện phải TỰ NHỚ thứ tự luân chuyển và tự chọn
-- dãy gần cửa; xe nâng hạ không có thứ tự nên xe chuyển đứng chờ. App đã có đủ nền để tính hộ:
-- bản vẽ lưới (đợt 0), cửa của chuyến (đợt 1a), luật luân chuyển (rotation.ts), BFS (warehouseGrid.ts).
--
-- MÔ HÌNH (3 vai nhìn 3 bảng, CÙNG một kế hoạch):
--   • Bắt đầu chuyến ở kho HƯỚNG DẪN ⇒ sinh `wms_tasks`: mỗi dòng = lấy bao nhiêu thùng của ĐÚNG
--     pallet nào, từ vị trí nào, đưa tới đâu, thứ tự mấy.
--   • Xe nâng HẠ xem tab "Cần hạ" (toàn kho, có thứ tự) · xe nâng CHUYỂN xem "Cần đưa ra"
--     (của mình) · thủ kho xem "Sắp quét" trên trang chuyến. Quét đủ ⇒ việc tự xong.
--   • Vai nào cũng có nút "✓ Xong" để tự đánh dấu (phòng quên) — mốc giờ, KHÔNG phải trạng thái
--     riêng: `lowered_at` (đã hạ) · `moved_at` (đã đưa ra) · `done_at` (thủ kho quét đủ).
--
-- QUY TẮC DATE (user chốt vòng 4 — điểm khó nhất): kho KHÔNG chạy FEFO toàn bộ. NPP đi ≥ 60 % nếu
-- CS không ghi chú; CS ghi chú bằng CHỮ (khi %, khi ngày) nên KHÔNG CÓ parser nào bền. Vì thế:
-- thủ kho BẮT BUỘC chốt quy tắc date cho từng dòng đơn trước khi xuất, và **FEFO là một LỰA CHỌN
-- phải bấm xác nhận**, không phải mặc định ngầm. Dòng chưa chốt ⇒ KHÔNG sinh việc (không ai
-- "tưởng mặc định rồi đi làm, sau mới update = làm sai").
--
-- KHÔNG đụng hành vi hiện có: mọi cột mới nullable hoặc có DEFAULT giữ nguyên nghĩa cũ;
-- `work_mode` mặc định 'MANUAL' = đúng cách kho đang chạy hôm nay.
-- ============================================================================

-- ── 1. Cờ CÁCH LÀM VIỆC — 2 tầng Kho + Loại kho (khuôn rotation/putaway đã có) ─────────────────
ALTER TABLE public."Warehouse"
  ADD COLUMN IF NOT EXISTS work_mode        text    NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS lower_from_level integer NOT NULL DEFAULT 2;

ALTER TABLE public."Warehouse" DROP CONSTRAINT IF EXISTS warehouse_work_mode_check;
ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_work_mode_check
  CHECK (work_mode IN ('MANUAL', 'GUIDED'));
ALTER TABLE public."Warehouse" DROP CONSTRAINT IF EXISTS warehouse_lower_from_level_range;
ALTER TABLE public."Warehouse" ADD CONSTRAINT warehouse_lower_from_level_range
  CHECK (lower_from_level >= 1 AND lower_from_level <= 50);

COMMENT ON COLUMN public."Warehouse".work_mode IS
  'MANUAL = người tự chọn hàng (mặc định, hành vi cũ) · GUIDED = hệ thống sinh việc có thứ tự khi Bắt đầu chuyến (Directed Work 1c). Bật được khi kho quản theo tem QR và đã vẽ Sơ đồ kho.';
COMMENT ON COLUMN public."Warehouse".lower_from_level IS
  'Từ tầng này trở lên thì pallet phải qua XE NÂNG HẠ (mặc định 2 = T1 và sàn xe chuyển lấy trực tiếp). Đặt 1 nếu kho muốn mọi pallet trên kệ đều do xe hạ lấy.';

ALTER TABLE public.warehouse_type_configs
  ADD COLUMN IF NOT EXISTS work_mode        text,
  ADD COLUMN IF NOT EXISTS lower_from_level integer;

ALTER TABLE public.warehouse_type_configs DROP CONSTRAINT IF EXISTS whtc_work_mode_check;
ALTER TABLE public.warehouse_type_configs ADD CONSTRAINT whtc_work_mode_check
  CHECK (work_mode IS NULL OR work_mode IN ('MANUAL', 'GUIDED'));
ALTER TABLE public.warehouse_type_configs DROP CONSTRAINT IF EXISTS whtc_lower_from_level_range;
ALTER TABLE public.warehouse_type_configs ADD CONSTRAINT whtc_lower_from_level_range
  CHECK (lower_from_level IS NULL OR (lower_from_level >= 1 AND lower_from_level <= 50));

COMMENT ON COLUMN public.warehouse_type_configs.work_mode        IS 'Ghi đè cách làm việc cho LOẠI KHO này. NULL = theo kho.';
COMMENT ON COLUMN public.warehouse_type_configs.lower_from_level IS 'Ghi đè ngưỡng tầng cần xe hạ cho LOẠI KHO này. NULL = theo kho.';

-- ── 2. LOẠI KHO PHỤC VỤ của cửa / điểm đầu dãy (user 10/09: "cửa nhập cửa xuất đầu dãy cũng cần
--      phân loại nó là Loại kho nào") — bằng chứng: Ba Vì đặt tên cửa "Cửa FG01", "Cửa sca" ─────────
ALTER TABLE public."Location" ADD COLUMN IF NOT EXISTS serve_categories text[];
COMMENT ON COLUMN public."Location".serve_categories IS
  'Loại kho mà cửa / điểm đầu dãy này phục vụ (chỉ có nghĩa với kind <> STORAGE). NULL hoặc rỗng = phục vụ MỌI loại (mặc định — bản vẽ cũ không đổi hành vi). Khớp theo GIAO ≥ 1 như luật chuyến chở lẫn.';

-- ── 3. QUY TẮC DATE trên từng dòng đơn ─────────────────────────────────────────────────────────
-- `date_rule` = {kind: 'FEFO'|'MIN_PCT'|'EXACT', value, set_by, set_at}. NULL = CHƯA CHỐT ⇒ không sinh việc.
-- `date_required` (cột cũ, %) vẫn là luật CHẶN lúc quét — đọc tương thích: > 0 mà chưa có date_rule
-- thì coi như đã chốt MIN_PCT (dữ liệu cũ đã có % nghĩa là đã có người quyết).
ALTER TABLE public."OutboundItem"
  ADD COLUMN IF NOT EXISTS date_rule      jsonb,
  ADD COLUMN IF NOT EXISTS pinned_pallets text[];

ALTER TABLE public."OutboundItem" DROP CONSTRAINT IF EXISTS outbounditem_date_rule_kind;
ALTER TABLE public."OutboundItem" ADD CONSTRAINT outbounditem_date_rule_kind
  CHECK (date_rule IS NULL OR (date_rule->>'kind') IN ('FEFO', 'MIN_PCT', 'EXACT'));

COMMENT ON COLUMN public."OutboundItem".date_rule IS
  'Quy tắc lấy hàng theo date do THỦ KHO chốt: {kind FEFO|MIN_PCT|EXACT, value, set_by, set_at}. NULL = chưa chốt ⇒ dòng KHÔNG lên "Việc cần làm" (user chốt 10/09: FEFO phải bấm xác nhận, không mặc định ngầm).';
COMMENT ON COLUMN public."OutboundItem".pinned_pallets IS
  'Tem pallet ghim tay cho dòng này (dạng EXACT theo tem). Rỗng = không ghim.';

-- ── 4. XE NÂNG CHUYỂN — nhiều người, bổ sung/bớt được (user 10/09 vòng 6) ──────────────────────
-- Giữ nguyên `forklift_driver_id` / `forklift_driver_names` cũ (bundle PWA cũ + báo cáo cũ đọc chúng);
-- controller ghi CẢ HAI: id = người đầu danh sách, names = tên nối ", ".
ALTER TABLE public."GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS forklift_driver_ids text[];
COMMENT ON COLUMN public."GroupDeliveryOrder".forklift_driver_ids IS
  'Danh sách nhân sự lái xe nâng CHUYỂN của chuyến (kho HƯỚNG DẪN bắt buộc ≥ 1 lúc Bắt đầu). Cột cũ forklift_driver_id/names giữ đồng bộ để bundle cũ không vỡ.';

-- ── 5. BẢNG VIỆC ──────────────────────────────────────────────────────────────────────────────
-- MỘT dòng = lấy `qty_base` thùng của ĐÚNG pallet `entry_id` từ `from_location_id` đưa tới `to_location_id`.
-- Trạng thái chỉ 4 giá trị; GIAI ĐOẠN là MỐC GIỜ (lowered_at/moved_at/done_at) — user chốt "một nút
-- ✓ Xong", nên không đẻ thêm status cho từng chặng (status càng nhiều càng dễ có đường ghi lệch).
CREATE TABLE IF NOT EXISTS public.wms_tasks (
  id                 text PRIMARY KEY,
  warehouse_id       text NOT NULL REFERENCES public."Warehouse"(id),
  gdo_id             text NOT NULL REFERENCES public."GroupDeliveryOrder"(id) ON DELETE CASCADE,
  item_id            text NOT NULL REFERENCES public."OutboundItem"(id) ON DELETE CASCADE,
  entry_id           text REFERENCES public."InventoryEntry"(id) ON DELETE SET NULL,
  pallet_code        text NOT NULL,
  material_id        text,
  material_code      text,
  qty_base           numeric NOT NULL CHECK (qty_base > 0),
  is_partial         boolean NOT NULL DEFAULT false,
  -- PICK = nguyên pallet ra cửa · LOOSE_FEED = đưa pallet về VỊ TRÍ NHẶT LẺ để thủ kho lấy thùng lẻ
  kind               text NOT NULL DEFAULT 'PICK',
  from_location_id   text REFERENCES public."Location"(id),
  from_location_code text,
  level_no           integer,
  needs_lower        boolean NOT NULL DEFAULT false,
  drop_location_id   text REFERENCES public."Location"(id) ON DELETE SET NULL,
  to_location_id     text REFERENCES public."Location"(id) ON DELETE SET NULL,
  to_kind            text,
  dist_cells         integer,
  seq                integer NOT NULL,
  status             text NOT NULL DEFAULT 'PENDING',
  lowered_at         timestamptz,
  lowered_by         text,
  moved_at           timestamptz,
  moved_by           text,
  confirm_source     text,
  done_at            timestamptz,
  done_by            text,
  scan_entry_id      text,
  skip_reason        text,
  plan_version       integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL
);

ALTER TABLE public.wms_tasks DROP CONSTRAINT IF EXISTS wms_tasks_kind_check;
ALTER TABLE public.wms_tasks ADD CONSTRAINT wms_tasks_kind_check
  CHECK (kind IN ('PICK', 'LOOSE_FEED'));
ALTER TABLE public.wms_tasks DROP CONSTRAINT IF EXISTS wms_tasks_status_check;
ALTER TABLE public.wms_tasks ADD CONSTRAINT wms_tasks_status_check
  CHECK (status IN ('PENDING', 'DONE', 'SKIPPED', 'CANCELLED'));
ALTER TABLE public.wms_tasks DROP CONSTRAINT IF EXISTS wms_tasks_to_kind_check;
ALTER TABLE public.wms_tasks ADD CONSTRAINT wms_tasks_to_kind_check
  CHECK (to_kind IS NULL OR to_kind IN ('DOCK', 'PICK_FACE'));
ALTER TABLE public.wms_tasks DROP CONSTRAINT IF EXISTS wms_tasks_confirm_source_check;
ALTER TABLE public.wms_tasks ADD CONSTRAINT wms_tasks_confirm_source_check
  CHECK (confirm_source IS NULL OR confirm_source IN ('MANUAL', 'SCAN'));

COMMENT ON TABLE  public.wms_tasks IS 'Việc lấy hàng sinh khi Bắt đầu chuyến ở kho HƯỚNG DẪN (Directed Work 1c). Mọi thay đổi trạng thái đi qua backend/src/services/directedTasks.ts — ratchet task_status_written_outside_service gác.';
COMMENT ON COLUMN public.wms_tasks.kind        IS 'PICK = nguyên pallet ra cửa · LOOSE_FEED = đưa pallet về vị trí nhặt lẻ (thủ kho lấy thùng lẻ tại đó; ✓ Xong sẽ CHUYỂN pallet trong tồn).';
COMMENT ON COLUMN public.wms_tasks.needs_lower IS 'Cần XE NÂNG HẠ. PICK: level_no >= ngưỡng kho. LOOSE_FEED: mọi ô KỆ kể cả T1 (user 10/09: "xe nâng chuyển không tự lấy trên kệ").';
COMMENT ON COLUMN public.wms_tasks.dist_cells  IS 'Số ô lưới từ cửa của chuyến tới ô này (BFS trên Sơ đồ kho). NULL = ô chưa đặt lên bản vẽ hoặc không có đường — xếp cuối, bảng ghi rõ, KHÔNG để việc biến mất âm thầm.';
COMMENT ON COLUMN public.wms_tasks.seq         IS 'Thứ tự đi (1 = làm trước) — vòng đi ngắn nhất từ cửa; cùng vị trí thì tầng cao trước.';
COMMENT ON COLUMN public.wms_tasks.lowered_at  IS 'Xe nâng hạ bấm ✓ Xong (hoặc suy ra khi thủ kho quét đủ).';
COMMENT ON COLUMN public.wms_tasks.moved_at    IS 'Xe nâng chuyển bấm ✓ Xong (hoặc suy ra khi thủ kho quét đủ).';
COMMENT ON COLUMN public.wms_tasks.done_at     IS 'Thủ kho đã quét đủ pallet này — việc hoàn tất.';

CREATE INDEX IF NOT EXISTS idx_wms_tasks_wh_pending  ON public.wms_tasks (warehouse_id, status) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_wms_tasks_gdo         ON public.wms_tasks (gdo_id, status);
CREATE INDEX IF NOT EXISTS idx_wms_tasks_entry_open  ON public.wms_tasks (entry_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_wms_tasks_item        ON public.wms_tasks (item_id, status);

-- Một chuyến KHÔNG lập hai việc còn treo trên cùng một pallet (bộ sinh bắt 23505 → bỏ pallet đó, thử tiếp)
CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_tasks_gdo_entry_open
  ON public.wms_tasks (gdo_id, entry_id) WHERE status = 'PENDING' AND entry_id IS NOT NULL;

-- ── 6. SỔ SỰ KIỆN VIỆC ────────────────────────────────────────────────────────────────────────
-- Nguồn "giờ công theo việc" cho KPI sau (memory kpi-master-list-gaps, mảnh 4).
CREATE TABLE IF NOT EXISTS public.wms_task_events (
  id      text PRIMARY KEY,
  task_id text NOT NULL REFERENCES public.wms_tasks(id) ON DELETE CASCADE,
  event   text NOT NULL,
  actor   text,
  at      timestamptz NOT NULL,
  note    text
);
CREATE INDEX IF NOT EXISTS idx_wms_task_events_task ON public.wms_task_events (task_id, at);
COMMENT ON TABLE public.wms_task_events IS 'Nhật ký việc (PLANNED/LOWERED/MOVED/DONE/SKIPPED/CANCELLED/REPLANNED). Bảng NỘI BỘ: KHÔNG bắn tín hiệu realtime (trigger bị gỡ dưới đây) — màn hình đọc wms_tasks, sổ này để truy vết + tính giờ công.';

-- Bảng log nội bộ: gỡ trigger phát tín hiệu realtime do event trigger tự gắn lúc CREATE TABLE
-- (skill security-hardening: bảng nội bộ đừng bắn tín hiệu vô nghĩa cho mọi client).
DROP TRIGGER IF EXISTS trg_wms_notify ON public.wms_task_events;

-- ── 7. RPC nuôi 3 bảng theo vai — MỘT round-trip ──────────────────────────────────────────────
-- p_mode: 'LOWER' (xe nâng hạ, TOÀN KHO) · 'MOVE' (xe nâng chuyển) · 'SCAN' (thủ kho, theo chuyến).
--
-- LOWER/MOVE gom theo VỊ TRÍ (một dòng = "vị trí X · hạ 4 pallet → điểm đặt dãy Y") vì xe nâng
-- KHÔNG quét tem; SCAN trả từng pallet vì thủ kho quét theo tem.
-- Việc đã xong VẪN TRẢ VỀ (gạch ngang ở FE) tới khi chuyến kết thúc — user chốt "phòng tình huống
-- bị quên", biến mất là mất đối chiếu.
CREATE OR REPLACE FUNCTION public.directed_board(
  p_warehouse_id text,
  p_mode         text,
  p_gdo_id       text DEFAULT NULL,
  p_driver_id    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_rows   jsonb;
  v_tot    jsonb;
  v_alerts jsonb;
BEGIN
  -- Tập việc đang xét: chuyến còn hoạt động (đã Bắt đầu, chưa kết thúc) của kho này.
  WITH base AS (
    SELECT t.*,
           g.group_code, g.license_plate, g.status AS gdo_status, g.started_at,
           g.forklift_driver_ids, g.dock_location_id AS gdo_dock_id,
           fl.location_code AS from_code,
           dl.location_code AS drop_code, dl.row AS drop_name,
           tl.location_code AS to_code,   tl.row AS to_name,
           dk.row           AS dock_name,
           m.short_name     AS material_name,
           -- Vị trí HIỆN TẠI của pallet (user 10/09: "cần xem được vị trí hiện tại của pallet cần
           -- lấy, kể cả nó đang ở trên rack"): chưa hạ → ô gốc; đã hạ PICK → điểm đặt dãy;
           -- LOOSE_FEED đã hạ → vị trí nhặt lẻ (tồn đã chuyển thật).
           CASE
             WHEN t.lowered_at IS NULL           THEN fl.location_code
             WHEN t.kind = 'LOOSE_FEED'          THEN tl.location_code
             ELSE COALESCE(dl.location_code, fl.location_code)
           END AS current_code,
           -- Chờ xe hạ: dòng hiện mờ ở bảng xe chuyển, không bấm được
           (t.needs_lower AND t.lowered_at IS NULL AND t.status = 'PENDING') AS waiting_lower
      FROM public.wms_tasks t
      JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
      LEFT JOIN public."Location" fl ON fl.id = t.from_location_id
      LEFT JOIN public."Location" dl ON dl.id = t.drop_location_id
      LEFT JOIN public."Location" tl ON tl.id = t.to_location_id
      LEFT JOIN public."Location" dk ON dk.id = g.dock_location_id
      LEFT JOIN public."Material"  m  ON m.id  = t.material_id
     WHERE t.warehouse_id = p_warehouse_id
       AND t.status IN ('PENDING', 'DONE')
       AND g.status IN ('IN_PROGRESS', 'PAUSED')
       AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id)
  ),
  -- Xe đứng bãi chỉ còn chờ hạ = chuyến KHÔNG còn việc nào sẵn sàng chuyển ⇒ ưu tiên hạ trước
  gdo_flag AS (
    SELECT gdo_id,
           bool_and(NOT (status = 'PENDING' AND NOT waiting_lower)) AS truck_idle
      FROM base GROUP BY gdo_id
  ),
  filtered AS (
    SELECT b.*, COALESCE(f.truck_idle, false) AS truck_idle
      FROM base b LEFT JOIN gdo_flag f ON f.gdo_id = b.gdo_id
     WHERE CASE p_mode
             -- Xe nâng hạ: mọi việc cần hạ (đã hạ rồi vẫn hiện, gạch ngang)
             WHEN 'LOWER' THEN b.needs_lower
             -- Xe nâng chuyển: mọi việc TRỪ loose-feed trên kệ (đó là việc của xe hạ, hạ thẳng
             -- xuống vị trí nhặt lẻ là xong). Dòng chưa hạ vẫn hiện (mờ) để thấy pallet đang ở đâu.
             WHEN 'MOVE'  THEN NOT (b.kind = 'LOOSE_FEED' AND b.needs_lower)
             ELSE true
           END
       AND (p_driver_id IS NULL OR p_driver_id = ANY (COALESCE(b.forklift_driver_ids, ARRAY[]::text[])))
  ),
  -- LOWER/MOVE: gom theo (chuyến, vị trí hiện tại, đích). SCAN: mỗi pallet một dòng.
  grouped AS (
    SELECT
      CASE WHEN p_mode = 'SCAN' THEN t.id
           ELSE t.gdo_id || '|' || COALESCE(t.current_code, '?') || '|' || COALESCE(t.to_code, '?') || '|' || t.kind
      END                                        AS group_key,
      min(t.seq)                                 AS seq,
      jsonb_agg(t.id ORDER BY t.seq)             AS task_ids,
      count(*)                                   AS n_pallets,
      sum(t.qty_base)                            AS qty_base,
      min(t.gdo_id)                              AS gdo_id,
      min(t.group_code)                          AS group_code,
      min(t.license_plate)                       AS license_plate,
      min(t.started_at)                          AS started_at,
      min(t.dock_name)                           AS dock_name,
      min(t.kind)                                AS kind,
      min(t.current_code)                        AS current_code,
      min(t.from_code)                           AS from_code,
      max(t.level_no)                            AS level_no,
      min(t.to_code)                             AS to_code,
      min(t.to_name)                             AS to_name,
      min(t.drop_name)                           AS drop_name,
      min(t.dist_cells)                          AS dist_cells,
      bool_or(t.needs_lower)                     AS needs_lower,
      bool_or(t.waiting_lower)                   AS waiting_lower,
      bool_or(t.truck_idle)                      AS truck_idle,
      -- Xong Ở CHẶNG NÀY: LOWER nhìn lowered_at, MOVE nhìn moved_at; quét đủ (DONE) là xong mọi chặng
      bool_and(t.status = 'DONE' OR CASE p_mode WHEN 'LOWER' THEN t.lowered_at IS NOT NULL
                                                WHEN 'MOVE'  THEN t.moved_at   IS NOT NULL
                                                ELSE t.done_at IS NOT NULL END) AS stage_done,
      bool_and(t.status = 'DONE')                AS all_scanned,
      max(COALESCE(t.done_at, t.moved_at, t.lowered_at)) AS last_at,
      min(t.lowered_by)                          AS lowered_by,
      min(t.moved_by)                            AS moved_by,
      jsonb_agg(DISTINCT t.material_code)        AS material_codes,
      min(t.material_name)                       AS material_name,
      jsonb_agg(DISTINCT t.pallet_code)          AS pallet_codes
      FROM filtered t
     GROUP BY 1
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'group_key',      g.group_key,
      'task_ids',       g.task_ids,
      'seq',            g.seq,
      'gdo_id',         g.gdo_id,
      'group_code',     g.group_code,
      'license_plate',  g.license_plate,
      'started_at',     g.started_at,
      'dock_name',      g.dock_name,
      'kind',           g.kind,
      'current_code',   g.current_code,
      'from_code',      g.from_code,
      'level_no',       g.level_no,
      'to_code',        g.to_code,
      'to_name',        g.to_name,
      'drop_name',      g.drop_name,
      'dist_cells',     g.dist_cells,
      'n_pallets',      g.n_pallets,
      'qty_base',       g.qty_base,
      'material_codes', g.material_codes,
      'material_name',  g.material_name,
      'pallet_codes',   g.pallet_codes,
      'needs_lower',    g.needs_lower,
      'waiting_lower',  g.waiting_lower,
      'stage_done',     g.stage_done,
      'all_scanned',    g.all_scanned,
      'last_at',        g.last_at,
      'done_by_name',   COALESCE(g.moved_by, g.lowered_by),
      'can_confirm',    (NOT g.stage_done) AND (p_mode = 'SCAN' OR NOT g.waiting_lower)
    ) ORDER BY
        -- Chưa xong lên trước (việc đã xong vẫn giữ trong bảng nhưng nằm dưới)
        g.stage_done,
        CASE WHEN p_mode = 'LOWER' THEN (NOT g.truck_idle)::int ELSE 0 END,
        g.started_at,
        CASE WHEN p_mode = 'LOWER' THEN g.dist_cells END NULLS LAST,
        CASE WHEN p_mode = 'LOWER' THEN -g.level_no END,
        g.seq
    ), '[]'::jsonb)
    INTO v_rows
    FROM grouped g;

  -- Ô tổng + cảnh báo: dòng đơn CHƯA CHỐT quy tắc date (không sinh việc) và phần còn thiếu
  SELECT jsonb_build_object(
           'pending',   count(*) FILTER (WHERE t.status = 'PENDING'),
           'done',      count(*) FILTER (WHERE t.status = 'DONE'),
           'to_lower',  count(*) FILTER (WHERE t.status = 'PENDING' AND t.needs_lower AND t.lowered_at IS NULL),
           'to_move',   count(*) FILTER (WHERE t.status = 'PENDING' AND t.moved_at IS NULL
                                           AND (NOT t.needs_lower OR t.lowered_at IS NOT NULL)),
           'trips',     count(DISTINCT t.gdo_id)
         )
    INTO v_tot
    FROM public.wms_tasks t
    JOIN public."GroupDeliveryOrder" g ON g.id = t.gdo_id
   WHERE t.warehouse_id = p_warehouse_id AND t.status IN ('PENDING', 'DONE')
     AND g.status IN ('IN_PROGRESS', 'PAUSED')
     AND (p_gdo_id IS NULL OR t.gdo_id = p_gdo_id);

  -- Dòng hàng chưa chốt %Date của các chuyến đang chạy: KHÔNG có việc nào, phải nói ra
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'gdo_id', x.gdo_id, 'group_code', x.group_code, 'item_id', x.item_id,
           'material_code', x.material_code_raw, 'remaining', x.remaining, 'note', x.header_text
         ) ORDER BY x.group_code, x.material_code_raw), '[]'::jsonb)
    INTO v_alerts
    FROM (
      SELECT g.id AS gdo_id, g.group_code, i.id AS item_id, i.material_code_raw, i.header_text,
             (COALESCE(i.cartons_ordered, 0) - COALESCE(i.cartons_scanned, 0)) AS remaining
        FROM public."GroupDeliveryOrder" g
        JOIN public."OutboundDelivery"   d ON d.gdo_id = g.id
        JOIN public."OutboundItem"       i ON i.do_id  = d.id
       WHERE g.warehouse_id = p_warehouse_id
         AND g.status IN ('IN_PROGRESS', 'PAUSED')
         AND (p_gdo_id IS NULL OR g.id = p_gdo_id)
         AND i.date_rule IS NULL
         AND COALESCE(i.date_required, 0) <= 0
         AND COALESCE(i.cartons_ordered, 0) > COALESCE(i.cartons_scanned, 0)
    ) x;

  RETURN jsonb_build_object('rows', v_rows, 'totals', v_tot, 'unset_items', v_alerts);
END;
$$;

COMMENT ON FUNCTION public.directed_board(text, text, text, text) IS
  'Nuôi 3 bảng Việc cần làm (LOWER/MOVE/SCAN) trong MỘT round-trip. Gom theo vị trí cho xe nâng, theo pallet cho thủ kho; việc đã xong vẫn trả về để FE gạch ngang.';
