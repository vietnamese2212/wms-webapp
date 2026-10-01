-- 02/10/2026 — Điều vận trên bản đồ, đợt 2 phần 1: TOẠ ĐỘ KHO + SỔ KHOẢNG CÁCH.
-- (1) Kho có ghim như khách (chấm tay / GPS / máy định vị) — mọi phép đo km xuất phát từ kho, không có ghim kho thì không có km.
-- (2) geo_distance = ma trận km ĐÃ ĐO, của mình: khoá là cặp điểm (loại + mã), nguồn GOONG (đường bộ, xe tải) hay HAVERSINE
--     (đường chim bay × 1,3 — ước lượng khi chưa có nhà cung cấp). Nhà cung cấp sập thì bảng này vẫn còn; đo lại khi điểm dời ghim
--     (lưu toạ độ lúc đo để biết cặp nào đã cũ).
ALTER TABLE "Warehouse"
  ADD COLUMN IF NOT EXISTS geo_lat        numeric(9,6),
  ADD COLUMN IF NOT EXISTS geo_lng        numeric(9,6),
  ADD COLUMN IF NOT EXISTS geo_source     text,
  ADD COLUMN IF NOT EXISTS geo_accuracy_m numeric(8,1),
  ADD COLUMN IF NOT EXISTS geo_at         timestamptz,
  ADD COLUMN IF NOT EXISTS geo_by         text;
ALTER TABLE "Warehouse" DROP CONSTRAINT IF EXISTS warehouse_geo_source_chk;
ALTER TABLE "Warehouse" ADD CONSTRAINT warehouse_geo_source_chk CHECK (geo_source IS NULL OR geo_source IN ('GOONG', 'MANUAL', 'GPS'));
ALTER TABLE "Warehouse" DROP CONSTRAINT IF EXISTS warehouse_geo_range_chk;
ALTER TABLE "Warehouse" ADD CONSTRAINT warehouse_geo_range_chk CHECK (
  (geo_lat IS NULL AND geo_lng IS NULL) OR (geo_lat BETWEEN -90 AND 90 AND geo_lng BETWEEN -180 AND 180));
COMMENT ON COLUMN "Warehouse".geo_lat IS 'Vĩ độ kho (WGS84) — điểm xuất phát mọi phép đo km của điều vận; nguồn ở geo_source';

CREATE TABLE IF NOT EXISTS geo_distance (
  id          uuid PRIMARY KEY,
  from_key    text NOT NULL,            -- 'WH:<Warehouse.id>' | 'CU:<ship_to_code>'
  to_key      text NOT NULL,
  from_lat    numeric(9,6) NOT NULL, from_lng numeric(9,6) NOT NULL,   -- toạ độ LÚC ĐO — ghim dời ⇒ cặp này cũ
  to_lat      numeric(9,6) NOT NULL, to_lng   numeric(9,6) NOT NULL,
  km          numeric(8,2) NOT NULL,
  minutes     numeric(8,1),
  source      text NOT NULL CHECK (source IN ('GOONG', 'HAVERSINE')),
  measured_at timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_key, to_key)
);
CREATE INDEX IF NOT EXISTS geo_distance_from_idx ON geo_distance (from_key);
COMMENT ON TABLE geo_distance IS 'Điều vận trên bản đồ: km đường bộ ĐÃ ĐO giữa kho ↔ khách và khách ↔ khách (của mình; nhà cung cấp chỉ là máy đo)';
