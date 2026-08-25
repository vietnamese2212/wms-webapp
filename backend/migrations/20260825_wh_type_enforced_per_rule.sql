-- 25/08/2026 — MỨC XỬ LÝ (Bắt buộc / Chỉ cảnh báo) của TỪNG LUẬT CẤT kế thừa PER-LUẬT.
--
-- Trước: `warehouse_type_configs.putaway_enforced` THAY THẾ nguyên mảng của kho ⇒ loại khai 1 luật
-- là mất hết các luật bắt buộc khác của kho. Đo thật trên staging: Kho Ba Vì bắt buộc
-- [MAX_MATERIALS, FULL] nhưng loại PM01 khai riêng [FULL] ⇒ hàng POSM lặng lẽ THOÁT luật
-- "tối đa 2 mã/vị trí" — không ai đọc form mà đoán ra được điều đó.
--
-- Nay (user chốt 25/08 "nếu không có giá trị gì thì để bao nhiêu thì để, nếu có thì cũng cho theo
-- rule"): mỗi luật có 3 trạng thái ở tầng loại, ĐỘC LẬP nhau — giống hệt các cờ boolean khác của
-- tầng này (Theo kho / Có / Không):
--   • KHÔNG khai ở cả 2 cột            → theo kho
--   • có trong `putaway_enforced`      → loại BẬT bắt buộc (dù kho không bật)
--   • có trong `putaway_enforced_off`  → loại ép về CHỈ CẢNH BÁO (dù kho đang bắt buộc)
-- Hiệu lực = (kho ∪ loại.on) \ loại.off  — xem `mergedConfig` trong backend/src/utils/putaway.ts.
--
-- KHÔNG backfill: dòng cũ giữ nguyên `putaway_enforced`, nay được hiểu là "bật thêm" thay vì
-- "thay thế". Đây CHÍNH LÀ thay đổi hành vi user yêu cầu (PM01 quay lại chấp hành luật số mã của
-- kho). Tính năng 2 tầng mới có từ 21/08 và CHƯA merge production nên chỉ staging bị ảnh hưởng.

ALTER TABLE warehouse_type_configs
  ADD COLUMN IF NOT EXISTS putaway_enforced_off text[];

COMMENT ON COLUMN warehouse_type_configs.putaway_enforced IS
  'Luật cất mà LOẠI này ép về mức BẮT BUỘC (hợp với danh sách của kho). NULL/rỗng = không bật thêm gì.';
COMMENT ON COLUMN warehouse_type_configs.putaway_enforced_off IS
  'Luật cất mà LOẠI này ép về mức CHỈ CẢNH BÁO, kể cả khi kho đang bắt buộc. NULL/rỗng = theo kho.';
