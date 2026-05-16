-- pct_date lưu tại thời điểm quét (khóa cứng, không tính lại theo ngày)
ALTER TABLE "OutboundScanEntry"
  ADD COLUMN IF NOT EXISTS pct_date INTEGER;
