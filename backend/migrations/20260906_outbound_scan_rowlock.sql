-- ══════════════════════════════════════════════════════════════════════════════════════════
-- 06/09/2026 — ĐƯỜNG QUÉT XUẤT: đổi 3 vòng CAS lạc quan (JS) sang KHOÁ DÒNG trong DB.
--
-- VÌ SAO (đo thật 06/09, mô phỏng 1 ngày vận hành 2 kho Ba Vì + Bàu Bàng):
--   Mỗi vòng `claimItemQuota` / `consumeInventoryExact` / `adjustInventoryAtomic` = ĐỌC rồi
--   UPDATE-có-điều-kiện = **2 lượt gọi PostgREST**, và khi CAS trượt thì NGỦ (jitter tới ~310ms)
--   rồi lặp lại — tối đa 15 vòng = **tới 30 lượt gọi cho MỘT lần bấm quét**.
--   Nút thắt của hệ thống KHÔNG phải máy Postgres mà là **số khe pool PostgREST**; vòng thử-lại
--   tự nhân số lượt lên ĐÚNG LÚC đông người — càng tranh chấp càng tốn khe, càng tốn khe càng
--   tranh chấp. Đo được: 1 lượt quét xuất = 19 lượt gọi; ca chiều 2 kho + người xem báo cáo →
--   quét xuất p95 25,4 giây (đỉnh 44,2s), màn Tồn kho/Giám sát/Tổng quan trả 500/503/504.
--
-- CÁCH LÀM: mỗi thao tác thành 1 hàm chạy trong MỘT câu, `SELECT … FOR UPDATE` khoá đúng 1 dòng.
--   - 2 lượt gọi → 1 (giảm nửa số khe cho 3 thao tác nóng nhất).
--   - Không còn thử lại, không còn ngủ jitter: người đến sau CHỜ TRÊN KHOÁ vài mili giây rồi đọc
--     giá trị MỚI NHẤT — mạnh hơn CAS (không thể trượt) và rẻ hơn (không nhân lượt gọi).
--   - NGỮ NGHĨA GIỮ NGUYÊN 100% so với bản JS: cùng công thức trần, cùng bậc thang trạng thái.
--
-- AN TOÀN TRIỂN KHAI: controller vẫn GIỮ đường CAS cũ làm dự phòng — RPC chưa apply (hoặc lỗi)
-- thì tự rơi về đường cũ, không vỡ gì. Apply migration này rồi mới có tác dụng.
-- ══════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. ĐẶT GẠCH hạn mức dòng hàng ─────────────────────────────────────────────────────────
-- Trả jsonb { grant, total, status }. grant = 0 nghĩa là dòng hàng ĐÃ ĐỦ (tương đương 'FULL'
-- của bản JS). Không bao giờ trả null-vì-tranh-chấp: khoá dòng thì lượt sau luôn đi tiếp được.
CREATE OR REPLACE FUNCTION public.outbound_claim_quota(
  p_item_id             text,
  p_want                numeric,
  p_ceiling             numeric,
  p_complete_when_full  boolean,
  p_now                 text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cur    numeric;
  v_grant  numeric;
  v_next   numeric;
  v_status text;
BEGIN
  SELECT COALESCE(cartons_scanned, 0) INTO v_cur
  FROM "OutboundItem" WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('missing', true);
  END IF;

  v_grant := LEAST(p_want, p_ceiling - v_cur);
  IF v_grant <= 0 THEN
    RETURN jsonb_build_object('grant', 0, 'total', v_cur);
  END IF;

  v_next   := v_cur + v_grant;
  -- Bậc thang trạng thái y hệt bản JS: nhặt lẻ / còn dòng nhặt lẻ chưa xác nhận ⇒ KHÔNG tự
  -- COMPLETE dù đủ số (caller truyền p_complete_when_full = false).
  v_status := CASE WHEN p_complete_when_full AND v_next >= p_ceiling THEN 'COMPLETED'
                   ELSE 'IN_PROGRESS' END;

  UPDATE "OutboundItem"
     SET cartons_scanned = v_next, status = v_status, updated_at = p_now::timestamp
   WHERE id = p_item_id;

  RETURN jsonb_build_object('grant', v_grant, 'total', v_next, 'status', v_status);
END $$;

-- ── 2. TRỪ TỒN CHÍNH XÁC khi xuất ─────────────────────────────────────────────────────────
-- Trả { ok:true, remaining, status } · { ok:false } khi KHÔNG ĐỦ TỒN · { missing:true }.
-- Giữ đúng luật cũ: chỉ đụng cartons_remaining, KHÔNG đụng cartons_reserved.
CREATE OR REPLACE FUNCTION public.outbound_consume_exact(
  p_entry_id text,
  p_amount   numeric,
  p_now      text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_remaining numeric;
  v_imported  numeric;
  v_new       numeric;
  v_status    text;
BEGIN
  SELECT COALESCE(cartons_remaining, cartons_imported, 0), COALESCE(cartons_imported, 0)
    INTO v_remaining, v_imported
  FROM "InventoryEntry" WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('missing', true);
  END IF;

  IF v_remaining < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'remaining', v_remaining);
  END IF;

  v_new    := v_remaining - p_amount;
  v_status := CASE WHEN v_new = 0 THEN 'EXPORTED'
                   WHEN v_new < v_imported THEN 'PARTIAL'
                   ELSE 'IN_STOCK' END;

  UPDATE "InventoryEntry"
     SET cartons_remaining = v_new, status = v_status, updated_at = p_now::timestamp
   WHERE id = p_entry_id;

  RETURN jsonb_build_object('ok', true, 'remaining', v_new, 'status', v_status);
END $$;

-- ── 3. CỘNG/TRỪ tồn + giữ chỗ (nhặt lẻ và mọi đường hoàn nguyên) ──────────────────────────
-- Trả { ok:true, remaining, reserved, status } · { missing:true }.
-- Kẹp sàn 0 hai chiều y bản JS; bậc thang trạng thái có thêm nhánh LOOSE_PICKING khi còn giữ chỗ.
CREATE OR REPLACE FUNCTION public.outbound_adjust_entry(
  p_entry_id         text,
  p_delta_remaining  numeric,
  p_delta_reserved   numeric,
  p_now              text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_remaining numeric;
  v_reserved  numeric;
  v_imported  numeric;
  v_new_rem   numeric;
  v_new_res   numeric;
  v_status    text;
BEGIN
  SELECT COALESCE(cartons_remaining, 0), COALESCE(cartons_reserved, 0), COALESCE(cartons_imported, 0)
    INTO v_remaining, v_reserved, v_imported
  FROM "InventoryEntry" WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('missing', true);
  END IF;

  v_new_rem := GREATEST(0, v_remaining + p_delta_remaining);
  v_new_res := GREATEST(0, v_reserved  + p_delta_reserved);
  v_status  := CASE WHEN v_new_res > 0 THEN 'LOOSE_PICKING'
                    WHEN v_new_rem = 0 THEN 'EXPORTED'
                    WHEN v_new_rem < v_imported THEN 'PARTIAL'
                    ELSE 'IN_STOCK' END;

  UPDATE "InventoryEntry"
     SET cartons_remaining = v_new_rem, cartons_reserved = v_new_res,
         status = v_status, updated_at = p_now::timestamp
   WHERE id = p_entry_id;

  RETURN jsonb_build_object('ok', true, 'remaining', v_new_rem, 'reserved', v_new_res, 'status', v_status);
END $$;

-- Quyền: backend đi service_role (đã có sẵn). Mặc định toàn cục đã tắt PUBLIC từ 20260902d nên
-- RPC mới TỰ ĐÓNG với anon/authenticated — không GRANT gì thêm (xem CLAUDE.md, mục realtime).
