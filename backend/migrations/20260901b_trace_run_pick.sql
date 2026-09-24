-- TRUY XUẤT THEO THÙNG v2 (user chỉnh 01/09 chiều):
-- 1. Bắt buộc = Ngày · Giờ SX · MÁY · CHU KỲ; MÃ HÀNG thành TÙY CHỌN ("không bắt buộc, có thì tốt")
--    → material_code trên hồ sơ được phép NULL.
-- 2. Ngày tem pallet có thể lệch ±1–3 ngày so với ngày in phun trên thùng (SX vắt qua đêm) →
--    KHÔNG khớp thẳng pallet theo giờ nữa: tìm SỔ ĐÓNG GÓI (packing_runs) theo Máy + Chu kỳ
--    trong cửa sổ ±3 ngày, user XEM từng sổ và BUỘC CHỌN 1 sổ → hồ sơ ghi lại sổ đã chọn (run_id).
ALTER TABLE public.trace_investigations ALTER COLUMN material_code DROP NOT NULL;
ALTER TABLE public.trace_investigations ADD COLUMN IF NOT EXISTS run_id uuid;
