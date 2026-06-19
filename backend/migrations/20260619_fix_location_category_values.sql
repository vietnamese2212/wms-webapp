-- 2026-06-19 — Dọn dữ liệu Location.category về đúng tập loại kho chuẩn (LookupValue.type='warehouse_type')
-- Tập chuẩn: Giấy | Thùng | Thành phẩm | Raw | POSM
-- Vấn đề: một số vị trí mang category lệch chuẩn → bị ẩn khỏi bộ chọn vị trí (FE lọc theo category===warehouse_type)
--   - "NVL"        (8 vị trí, hàng nguyên vật liệu)  → "Raw"        (nhãn chuẩn cho NVL, user chốt 19/06)
--   - "Thành phẩm1"(1 vị trí test, gõ sai)           → "Thành phẩm"
-- "Raw" (2) và "Thùng" (1) GIỮ NGUYÊN — đã là giá trị hợp lệ trong lookup.
-- Sau khi áp: bộ chọn vị trí + chốt backend LOCATION_CATEGORY_MISMATCH sẽ khớp đúng.

UPDATE "Location"
SET category = 'Raw', updated_at = NOW()
WHERE category = 'NVL';

UPDATE "Location"
SET category = 'Thành phẩm', updated_at = NOW()
WHERE category = 'Thành phẩm1';

-- Kiểm tra sau khi chạy (kỳ vọng: chỉ còn Giấy/Thùng/Thành phẩm/Raw/POSM hoặc NULL):
--   SELECT category, COUNT(*) FROM "Location" GROUP BY category ORDER BY 2 DESC;
