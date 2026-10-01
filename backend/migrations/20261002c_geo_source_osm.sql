-- 02/10/2026 — Nguồn toạ độ thứ tư: OSM (máy định vị OpenStreetMap/Photon, miễn phí, không khoá — định vị tới PHƯỜNG/XÃ).
-- User chưa có khoá Goong và không muốn chấm tay 334 khách ⇒ máy miễn phí điền ghim cấp phường/xã (geo_accuracy_m ghi bán kính ước
-- lượng), người chấm tay / GPS vẫn thắng máy; có Goong sau thì chỉ đè các ghim máy (GOONG/OSM), không đè MANUAL/GPS.
ALTER TABLE "Customer"  DROP CONSTRAINT IF EXISTS customer_geo_source_chk;
ALTER TABLE "Customer"  ADD CONSTRAINT customer_geo_source_chk  CHECK (geo_source IS NULL OR geo_source IN ('GOONG', 'OSM', 'MANUAL', 'GPS'));
ALTER TABLE "Warehouse" DROP CONSTRAINT IF EXISTS warehouse_geo_source_chk;
ALTER TABLE "Warehouse" ADD CONSTRAINT warehouse_geo_source_chk CHECK (geo_source IS NULL OR geo_source IN ('GOONG', 'OSM', 'MANUAL', 'GPS'));
