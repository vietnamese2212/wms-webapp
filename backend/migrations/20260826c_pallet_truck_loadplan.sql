-- SƠ ĐỒ XẾP XE — phân biệt XE PALLET và XE THƯỜNG (user chốt 26/08).
--
-- BÀI TOÁN: xe pallet chở hàng ĐÃ LÊN PALLET (sức chứa tính bằng "16-17 pallet" = số CHỖ PALLET
-- trên sàn), còn xe xá thì xếp từng thùng bằng tay. Cùng một đơn hàng nhưng hai cách xếp khác hẳn
-- nhau, nên sơ đồ phải biết xe thuộc loại nào.
--
-- VÌ SAO KHÔNG ĐỌC TÊN: danh mục hiện có 'XE PALLET (16-17 PALLET)', 'XE 4 PALLET', 'XE XÁ' —
-- tên đã ngầm phân biệt, nhưng đọc vai trò theo TÊN TIẾNG VIỆT là luồng hỏng âm thầm khi ai đó
-- sửa tên danh mục (luật CLAUDE.md, ratchet `role_by_vietnamese_name` gác). Phải là CỜ.
--
-- PHÂN VAI (user chốt): LOẠI XE giữ CỜ pallet (quyết định CÁCH VẼ) · BIỂN SỐ giữ KÍCH THƯỚC
-- (chọn xe là có luôn D×R×C). Hai thứ ở hai bảng vì chúng trả lời hai câu hỏi khác nhau: "xe này
-- xếp kiểu gì" là thuộc tính của LOẠI, "lòng thùng bao nhiêu" là thuộc tính của CHIẾC XE.

BEGIN;

-- ── 1. LOẠI XE: cờ xe chở pallet ────────────────────────────────────────────
-- Mặc định false = xe thường = ĐÚNG hành vi hiện tại (xếp từng thùng), nên không kho nào đổi
-- hành vi cho tới khi có người tick cờ.
ALTER TABLE public."VehicleType"
  ADD COLUMN IF NOT EXISTS is_pallet_truck boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."VehicleType".is_pallet_truck IS
  'Xe chở hàng đã lên pallet (sức chứa tính bằng số chỗ pallet trên sàn). Quyết định CÁCH VẼ sơ đồ xếp xe: bật = gom hàng lên pallet rồi xếp pallet; tắt = xếp từng thùng như cũ.';

-- ── 2. BIỂN SỐ XE: kích thước lòng thùng ────────────────────────────────────
-- numeric (không integer) cho khớp kiểu 3 cột cùng nghĩa đã có ở "VehicleType".
ALTER TABLE public."Vehicle"
  ADD COLUMN IF NOT EXISTS box_length_mm numeric,
  ADD COLUMN IF NOT EXISTS box_width_mm  numeric,
  ADD COLUMN IF NOT EXISTS box_height_mm numeric;

-- Chặn số vô lý ngay ở DB (0/âm làm thuật toán xếp chia cho 0; >30m không phải xe tải).
-- NULL = chưa khai (hợp lệ — 952 xe hiện có đều chưa khai).
ALTER TABLE public."Vehicle" DROP CONSTRAINT IF EXISTS vehicle_box_dims_range;
ALTER TABLE public."Vehicle" ADD CONSTRAINT vehicle_box_dims_range CHECK (
      (box_length_mm IS NULL OR (box_length_mm > 0 AND box_length_mm <= 30000))
  AND (box_width_mm  IS NULL OR (box_width_mm  > 0 AND box_width_mm  <= 30000))
  AND (box_height_mm IS NULL OR (box_height_mm > 0 AND box_height_mm <= 30000))
);

COMMENT ON COLUMN public."Vehicle".box_length_mm IS
  'Chiều DÀI lòng thùng xe (mm) — sơ đồ xếp xe tự điền khi chọn biển số. NULL = chưa khai.';

COMMIT;
