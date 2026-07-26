-- 20260726 — SIẾT UPLOAD VL06O THEO KHO (user chốt 26/07).
--
-- Vấn đề (check-app 26/07): `uploadVl06o` không kiểm scope kho — ai có `outbound.import` (5 chức danh)
-- up được file VL06O của MỌI nhà máy; engine reconcile chạy theo dòng thay đổi nên có thể sửa/giảm
-- đơn xuất của kho khác.
--
-- Vì sao cần cột map: dòng VL06O mang mã SAP `plant` (vd '1102') + `storage_location` (FG01/FG02/PM01),
-- KHÔNG khớp `Warehouse.code` của app (vd '20000016'). Nên phải khai map per kho:
--   · `sap_plant`              — mã nhà máy SAP của kho
--   · `sap_storage_locations`  — danh sách Storage Location SAP thuộc kho (rỗng = khớp theo plant)
-- Khớp theo cặp (plant, storage_location) trước, không thấy thì khớp theo plant.
--
-- HÀNH VI KHI CHƯA KHAI (fail-open có chủ đích): dòng không map được kho nào → KHÔNG chặn (chỉ đếm
-- + cảnh báo trong kết quả upload). Nếu fail-closed thì ngày mai không ai upload được cho tới khi
-- khai đủ map = chặn vận hành. Khai xong tới đâu, siết tới đó.

ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS sap_plant text;
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS sap_storage_locations text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN "Warehouse".sap_plant IS
  'Mã nhà máy SAP (VL06O cột Plant) của kho — dùng để chặn upload VL06O của kho ngoài phạm vi. NULL = chưa khai (dòng SAP thuộc plant này không bị chặn).';
COMMENT ON COLUMN "Warehouse".sap_storage_locations IS
  'Các Storage Location SAP (VL06O cột Storage Location, vd FG01/FG02/PM01) thuộc kho này. Rỗng = mọi sloc của sap_plant đều thuộc kho.';

-- Tra map nhanh khi upload (số kho nhỏ nên index đơn giản là đủ)
CREATE INDEX IF NOT EXISTS idx_warehouse_sap_plant ON "Warehouse" (sap_plant) WHERE sap_plant IS NOT NULL;
