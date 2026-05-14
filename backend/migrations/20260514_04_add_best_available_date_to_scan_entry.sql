-- Lưu production_date tốt nhất (ngắn nhất, không bị QA) có trong kho tại thời điểm quét.
-- Dùng để kiểm tra sau: người quét có bỏ qua date cũ hơn không?
ALTER TABLE "OutboundScanEntry"
  ADD COLUMN IF NOT EXISTS best_available_date TEXT;
