-- 01/10/2026 — TOẠ ĐỘ KHÁCH HÀNG (đợt 1 "điều vận trên bản đồ", user chốt dùng Goong + chấm tay + GPS điện thoại).
-- Một ô dữ liệu cho cả ba nguồn: máy định vị từ địa chỉ (GOONG) · người chấm trên bản đồ (MANUAL) · người bấm GPS tại chỗ (GPS).
-- Nguồn do NGƯỜI (MANUAL/GPS) thắng máy: máy chỉ điền khi ô còn trống. Toạ độ là CỦA MÌNH — nhà cung cấp nào cũng chỉ là máy đo.
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS geo_lat        numeric(9,6),
  ADD COLUMN IF NOT EXISTS geo_lng        numeric(9,6),
  ADD COLUMN IF NOT EXISTS geo_source     text,          -- GOONG | MANUAL | GPS
  ADD COLUMN IF NOT EXISTS geo_accuracy_m numeric(8,1),  -- sai số (m): GPS lấy từ điện thoại; máy định vị để trống
  ADD COLUMN IF NOT EXISTS geo_address    text,          -- địa chỉ đã dùng khi máy định vị (đổi địa chỉ ⇒ biết ghim cũ)
  ADD COLUMN IF NOT EXISTS geo_at         timestamptz,
  ADD COLUMN IF NOT EXISTS geo_by         text;
ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS customer_geo_source_chk;
ALTER TABLE "Customer" ADD CONSTRAINT customer_geo_source_chk CHECK (geo_source IS NULL OR geo_source IN ('GOONG', 'MANUAL', 'GPS'));
ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS customer_geo_range_chk;
ALTER TABLE "Customer" ADD CONSTRAINT customer_geo_range_chk CHECK (
  (geo_lat IS NULL AND geo_lng IS NULL) OR (geo_lat BETWEEN -90 AND 90 AND geo_lng BETWEEN -180 AND 180));
COMMENT ON COLUMN "Customer".geo_lat IS 'Vĩ độ điểm giao (WGS84). Nguồn ở geo_source; MANUAL/GPS do người ghi, máy không đè';
COMMENT ON COLUMN "Customer".geo_source IS 'GOONG = máy định vị từ địa chỉ · MANUAL = chấm trên bản đồ · GPS = định vị điện thoại tại chỗ';
