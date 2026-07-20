-- ĐỢT 3: Ưu tiên chuyến (từ cột "Ưu tiên" của KHVC) — lưu trên chuyến để sắp thứ tự soạn hàng.
-- Nullable, verbatim (số/nhãn tùy nghiệp vụ); mặc định null = không đặt ưu tiên (hành vi cũ).
ALTER TABLE public."GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS priority text;
