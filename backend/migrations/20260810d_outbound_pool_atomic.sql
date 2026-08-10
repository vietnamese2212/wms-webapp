-- 20260810d_outbound_pool_atomic.sql
-- BUG #6 check-app 10/08 — HOÀN TỒN KHỐNG dưới bão 504 (đo thật: pool 15 → 23, remaining 23 > imported 15,
-- adjustment 0, mọi chuyến đã xóa). Cơ chế: các đường ghi-nhận/hoàn tồn pool no-QR
-- (manualCompleteItem · quickExportGDO · quickExportExistingGDO) là CHUỖI request rời:
--   (1) applySharedPoolDelta đổi pool → (2) update OutboundItem.cartons_scanned → (3) upsert OutboundScanEntry.
-- Vercel kill function ở 60s GIỮA (1) và (2) ⇒ pool đã hoàn nhưng cartons_scanned còn giá trị cũ
-- ⇒ lượt hoàn sau tính delta từ scanned cũ → HOÀN ĐÔI (tồn tăng khống). Chiều xuôi kill giữa (1)-(2)
-- thì MẤT tồn âm thầm (đã trừ mà không có vết). Cùng họ "adjust phi-nguyên-tử" 23/07 (adjust_inventory_atomic).
--
-- Fix = RPC `outbound_pool_apply`: TRỌN chu trình trong MỘT transaction, và số lượng truyền vào là
-- SỐ TUYỆT ĐỐI (p_new_qty) chứ không phải delta — delta tính TRONG transaction từ chính
-- OutboundItem.cartons_scanned (đã khóa FOR UPDATE) ⇒ gọi lại lần 2 delta=0, hoàn đôi BẤT KHẢ THI
-- theo cấu trúc; kill giữa chừng = rollback toàn bộ, pool và scanned không bao giờ lệch nhau.
-- p_claim_only_pending thay luôn cú CAS-claim + "hoàn bù khi thua đua" của quickExportExistingGDO
-- (thua đua = CLAIM_LOST, KHÔNG đụng tồn — hết cả cửa hoàn-bù bị kill).
-- Semantics pool GIỮ NGUYÊN applySharedPoolDelta cũ: QTY/QTY_DATE thiếu → INSUFFICIENT;
-- NONE/không dòng → OK không đụng tồn; QTY_DATE trừ FEFO (NSX cũ trước, lọc theo NSX chọn tay),
-- mode khác trừ dòng còn-nhiều-trước; hoàn vào dòng còn tồn đầu tiên (QTY_DATE: NSX cũ nhất);
-- status dòng pool: 0=EXPORTED, <imported=PARTIAL, còn lại IN_STOCK.

CREATE OR REPLACE FUNCTION public.outbound_pool_apply(
  p_item_id text,
  p_material_code text,            -- pallet_code của pool (= mã hàng)
  p_warehouse_id text,
  p_mode text,                     -- inventory_mode kho: QTY / QTY_DATE / NONE / khác
  p_new_qty numeric,               -- SỐ BASE TUYỆT ĐỐI muốn chốt cho item
  p_item_status text,              -- trạng thái item sau ghi (COMPLETED / IN_PROGRESS)
  p_chosen_date text DEFAULT NULL, -- QTY_DATE: NSX chọn tay yyyy-mm-dd (NULL = FEFO)
  p_claim_only_pending boolean DEFAULT false,  -- true: item đã COMPLETED → CLAIM_LOST, không đụng gì
  p_touch_pool boolean DEFAULT true            -- false: mã thường không pool — chỉ update item
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE
AS $$
DECLARE
  v_now   timestamp := (now() AT TIME ZONE 'UTC');
  v_old   numeric;
  v_status text;
  v_delta numeric;
  v_rows  record;
  v_pool  RECORD;
  v_total numeric := 0;
  v_need  numeric;
  v_take  numeric;
  v_entry text := NULL;
  v_scan_id text;
  v_has_rows boolean := false;
BEGIN
  SELECT cartons_scanned, status INTO v_old, v_status
  FROM "OutboundItem" WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'NOT_FOUND'); END IF;
  IF p_claim_only_pending AND v_status = 'COMPLETED' THEN
    RETURN jsonb_build_object('outcome', 'CLAIM_LOST');
  END IF;

  v_old   := COALESCE(v_old, 0);
  v_delta := p_new_qty - v_old;

  IF p_touch_pool AND v_delta <> 0 THEN
    -- Khóa TOÀN BỘ dòng pool của (mã, kho) — vài chục dòng là nhiều (1 dòng/NSX ở QTY_DATE)
    CREATE TEMP TABLE IF NOT EXISTS _pool_rows(
      id text, remaining numeric, imported numeric, pdate text, ord int) ON COMMIT DROP;
    TRUNCATE _pool_rows;
    -- FOR UPDATE không đứng chung window function → khóa ở subquery, đánh số ở ngoài
    INSERT INTO _pool_rows
    SELECT locked.id, locked.cartons_remaining, locked.cartons_imported,
           to_char(locked.production_date, 'YYYY-MM-DD'),
           row_number() OVER (ORDER BY locked.production_date ASC NULLS LAST, locked.id)::int
    FROM (
      SELECT e.id, e.cartons_remaining, e.cartons_imported, e.production_date
      FROM "InventoryEntry" e
      WHERE e.pallet_code = p_material_code AND e.warehouse_id = p_warehouse_id::uuid
        AND (p_mode <> 'QTY_DATE' OR p_chosen_date IS NULL
             OR to_char(e.production_date, 'YYYY-MM-DD') = p_chosen_date)
      FOR UPDATE OF e
    ) locked;
    SELECT COALESCE(SUM(remaining), 0), COUNT(*) > 0 INTO v_total, v_has_rows FROM _pool_rows;

    IF v_delta > 0 THEN
      -- TRỪ TỒN
      IF NOT v_has_rows THEN
        IF p_mode IN ('QTY', 'QTY_DATE') THEN
          RETURN jsonb_build_object('outcome', 'INSUFFICIENT', 'available', 0);
        END IF;   -- NONE/khác: không theo dõi mã này — đi tiếp không đụng tồn
      ELSIF v_total < v_delta THEN
        RETURN jsonb_build_object('outcome', 'INSUFFICIENT', 'available', v_total);
      ELSE
        v_need := v_delta;
        FOR v_pool IN
          SELECT * FROM _pool_rows WHERE remaining > 0
          ORDER BY CASE WHEN p_mode = 'QTY_DATE' THEN ord ELSE NULL END ASC NULLS LAST,
                   CASE WHEN p_mode = 'QTY_DATE' THEN NULL ELSE remaining END DESC NULLS LAST
        LOOP
          EXIT WHEN v_need <= 0;
          v_take := LEAST(v_need, v_pool.remaining);
          UPDATE "InventoryEntry" SET
            cartons_remaining = cartons_remaining - v_take,
            status = CASE WHEN cartons_remaining - v_take = 0 THEN 'EXPORTED'
                          WHEN cartons_remaining - v_take < cartons_imported THEN 'PARTIAL'
                          ELSE 'IN_STOCK' END,
            updated_at = v_now
          WHERE id = v_pool.id;
          v_need := v_need - v_take;
          IF v_entry IS NULL THEN v_entry := v_pool.id; END IF;
        END LOOP;
      END IF;
    ELSE
      -- HOÀN TỒN |v_delta|: dòng còn tồn đầu tiên (QTY_DATE = NSX cũ nhất), không có thì dòng đầu
      IF v_has_rows THEN
        SELECT id INTO v_entry FROM _pool_rows
        ORDER BY (remaining > 0) DESC, ord ASC LIMIT 1;
        UPDATE "InventoryEntry" SET
          cartons_remaining = cartons_remaining - v_delta,   -- v_delta âm → cộng
          status = CASE WHEN cartons_remaining - v_delta = 0 THEN 'EXPORTED'
                        WHEN cartons_remaining - v_delta < cartons_imported THEN 'PARTIAL'
                        ELSE 'IN_STOCK' END,
          updated_at = v_now
        WHERE id = v_entry;
      END IF;   -- không dòng nào = mã không theo dõi → hoàn là noop (như cũ)
    END IF;
  END IF;

  UPDATE "OutboundItem"
  SET status = p_item_status, cartons_scanned = p_new_qty, updated_at = v_now
  WHERE id = p_item_id;

  IF p_touch_pool THEN
    SELECT id INTO v_scan_id FROM "OutboundScanEntry" WHERE item_id = p_item_id LIMIT 1;
    IF v_scan_id IS NOT NULL THEN
      UPDATE "OutboundScanEntry"
      SET cartons_scanned = p_new_qty,
          inventory_entry_id = COALESCE(v_entry, inventory_entry_id),
          updated_at = v_now
      WHERE id = v_scan_id;
    ELSE
      INSERT INTO "OutboundScanEntry"(id, item_id, inventory_entry_id, pallet_code, cartons_scanned,
        is_loose_picking, scanned_at, created_at, updated_at)
      VALUES (gen_random_uuid()::text, p_item_id, v_entry, p_material_code, p_new_qty,
        false, v_now, v_now, v_now);
    END IF;
  END IF;

  RETURN jsonb_build_object('outcome', 'OK', 'inv_entry_id', v_entry, 'available', v_total - v_delta);
END $$;
