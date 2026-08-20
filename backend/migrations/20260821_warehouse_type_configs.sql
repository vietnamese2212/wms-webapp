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

BEGIN;

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

COMMIT;

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
