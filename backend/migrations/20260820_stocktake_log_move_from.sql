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
