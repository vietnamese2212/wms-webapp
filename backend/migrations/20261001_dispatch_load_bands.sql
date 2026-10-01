-- 01/10/2026 — DẢI TẢI THEO DÒNG XE CHA cho máy ghép (user: "rank theo %: container SCA 60–100 %, xe pallet 16–17 90–105 %;
-- chỉnh ngay trên bàn lúc Ghép xe / Lập lại; chọn xong hiện lên bàn; có nút tick bỏ qua %").
-- Dải của MỖI LƯỢT ghép nằm trong dispatch_plan.params.load_bands (+ load_bypass); cột này chỉ NHỚ lần chọn gần nhất của kho
-- để hộp thoại lần sau mở ra đúng số (không có form riêng — hộp thoại trên bàn chính là chỗ khai).
-- Hình dạng: {"<VehicleType.id>": {"min": 90, "max": 105}, ...}
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS dispatch_load_bands jsonb;
COMMENT ON COLUMN "Warehouse".dispatch_load_bands IS 'Điều vận: dải % tải theo dòng xe CHA (VehicleType.id → {min,max}) — lần chọn gần nhất trên bàn ghép xe, làm mặc định cho lần sau';
