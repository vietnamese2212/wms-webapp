-- 02/10/2026 — Điều vận trên bản đồ, đợt 2 phần 2: NGƯỠNG ĐƯỜNG VÒNG cho phép gộp xe Non tải KHÁC TỈNH.
-- Máy gộp hai xe khác tỉnh khi quãng đường kho → các điểm giao (thứ tự gần trước) không dài hơn đường thẳng tới điểm xa nhất quá
-- N %. NULL = tắt = hành vi cũ (chỉ gộp cùng tỉnh). Cần kho + khách có ghim; km lấy từ sổ geo_distance (đo Goong) hoặc ước lượng.
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS dispatch_detour_pct numeric(5,1);
COMMENT ON COLUMN "Warehouse".dispatch_detour_pct IS 'Điều vận: gộp xe Non tải khác tỉnh khi đường vòng ≤ N % so với đi thẳng tới điểm xa nhất; NULL = tắt';
