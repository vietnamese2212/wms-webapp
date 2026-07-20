-- ĐỢT 3: Ghi chú ĐIỀU VẬN (cột "Note" của KHVC) — ghi chú RIÊNG cấp chuyến của bộ phận điều vận,
-- tách khỏi ghi chú hàng hoá/hoá đơn (header_text từ VL06O). Nullable, mặc định null (hành vi cũ).
ALTER TABLE public."GroupDeliveryOrder" ADD COLUMN IF NOT EXISTS transport_note text;
