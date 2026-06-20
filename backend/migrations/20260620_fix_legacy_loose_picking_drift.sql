-- ─────────────────────────────────────────────────────────────────────────────
-- DỌN DỮ LIỆU (one-off, KHÔNG đổi schema)
-- 4 loose scan cũ (tháng 5/2026) tạo bởi logic CŨ "trừ thẳng tồn khi quét"
-- (trước khi có cơ chế reserve). Hệ quả: InventoryEntry.cartons_remaining ĐÃ bị
-- trừ rồi, nhưng OutboundScanEntry.loose_confirmed vẫn = false → 2 vấn đề:
--   1) Hiện là "nhặt lẻ chờ xác nhận" trong danh sách Nhặt lẻ (rác).
--   2) Nếu giờ bấm "Check nhặt lẻ" → confirmLoosePickingItem sẽ TRỪ TỒN LẦN NỮA.
--
-- Cách dọn: đánh dấu loose_confirmed = true (KHÔNG trừ tồn — tồn đã trừ từ tháng 5).
-- Đã kiểm trước: cả 4 entry đều cartons_reserved = 0 (không cần dọn reserved).
--
-- Cách apply: Supabase Dashboard → SQL Editor → chạy đoạn dưới (đã bọc transaction).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- (kiểm tra trước — không bắt buộc) phải trả về đúng 4 dòng, mỗi inventory entry reserved=0
-- SELECT se.id, se.cartons_scanned, ie.cartons_reserved, ie.cartons_remaining
-- FROM "OutboundScanEntry" se JOIN "InventoryEntry" ie ON ie.id = se.inventory_entry_id
-- WHERE se.id IN (
--   '69640e36-ac21-4e8f-9806-1fcde18c5909','4047ff2a-7903-40e7-b9ce-c496c52fc513',
--   '16248a9e-a138-4d2c-8935-46164e6d56aa','2d5a7f0a-01c2-455d-9d4c-8816ae73c39a');

UPDATE "OutboundScanEntry"
SET loose_confirmed    = true,
    loose_confirmed_at = now(),
    loose_confirmed_by = NULL,
    updated_at         = now()
WHERE id IN (
  '69640e36-ac21-4e8f-9806-1fcde18c5909',  -- 030326_510000197_11_M1_0012_B · 100 thùng
  '4047ff2a-7903-40e7-b9ce-c496c52fc513',  -- 160126_510000281_30_K_0020_D  · 17  thùng
  '16248a9e-a138-4d2c-8935-46164e6d56aa',  -- 020126_510000124_15_M5_0015_B  · 122 thùng
  '2d5a7f0a-01c2-455d-9d4c-8816ae73c39a'   -- 150226_510000385_13_K_0015_B   · 60  thùng
)
AND is_loose_picking = true
AND loose_confirmed = false;
-- Kỳ vọng: UPDATE 4

COMMIT;
