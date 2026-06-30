-- ============================================================================
-- Repurpose cột chết ea_per_pallet (EA/Pallet, 0 dữ liệu, không logic nào dùng)
--   → pallet_per_ea: "1 EA tương ứng bao nhiêu pallet" (vd 0.00005), số thập phân.
-- Dùng cho kho NVL: quy tồn tính bằng EA → pallet quy đổi để so với max_pallets (dashboard sau).
-- ea_per_pallet không có dữ liệu nên rename + đổi kiểu là an toàn (không mất gì).
-- LƯU Ý THỨ TỰ: apply migration NÀY TRƯỚC khi deploy code mới (code mới tham chiếu pallet_per_ea;
--   nếu cột chưa đổi tên → tạo/sửa mã hàng lỗi cả loạt).
-- ============================================================================
ALTER TABLE "Material" RENAME COLUMN "ea_per_pallet" TO "pallet_per_ea";
ALTER TABLE "Material" ALTER COLUMN "pallet_per_ea" TYPE numeric USING NULL;
