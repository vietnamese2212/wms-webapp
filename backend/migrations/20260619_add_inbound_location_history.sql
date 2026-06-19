-- 2026-06-19 — Lịch sử đổi vị trí phiếu nhập + nền cho giới hạn ≤3 vị trí khác nhau.
-- location_history: mảng JSON các lần ĐỔI vị trí (chỉ ghi khi location_id thực sự đổi),
--   mỗi phần tử { location_code, by_id, by_name, at, source }  (source = 'scan' | 'detail').
-- Giới hạn ≤3 vị trí khác nhau được kiểm LIVE từ InventoryEntry (vị trí thật của pallet) +
--   vị trí đang đặt — KHÔNG phụ thuộc cột này, nên không cần backfill.

ALTER TABLE "ProductionImport"
  ADD COLUMN IF NOT EXISTS location_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Kiểm tra sau khi chạy:
--   SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_name = 'ProductionImport' AND column_name = 'location_history';
