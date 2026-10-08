-- 20261008b — THỨ TỰ GIAO của xe (user chốt 08/10, xe tuyến liên tỉnh: "Có, in thứ tự giao" — để kho xếp hàng ngược, điểm cuối lên xe
-- trước). Máy ghép tính thứ tự kho → các điểm (gần trước, km Goong / ước lượng) vào `dispatch_trip.detail.route`; lúc Xác nhận ghi
-- số điểm của từng DO vào Kế hoạch xuất, đường dội Kế hoạch xuất → chuyến Xuất kho mang sang đơn của chuyến (1 đơn = 1 NPP = 1 điểm).
-- NULL = không đo được (thiếu ghim) hoặc dòng nạp tay / file — KHÔNG đoán.
-- Không dùng lại `khvc_lines.priority`: đó là cột "Ưu tiên" của file Kế hoạch xuất người dùng nạp, nghĩa khác.
ALTER TABLE public.khvc_lines ADD COLUMN IF NOT EXISTS stop_seq integer;
ALTER TABLE public."OutboundDelivery" ADD COLUMN IF NOT EXISTS stop_seq integer;
COMMENT ON COLUMN public.khvc_lines.stop_seq IS 'Thứ tự giao của DO trên xe (1 = điểm đầu) — máy ghép điều vận ghi lúc Xác nhận; NULL = không đo được / nạp tay';
COMMENT ON COLUMN public."OutboundDelivery".stop_seq IS 'Thứ tự giao của đơn (NPP) trên chuyến — dội từ khvc_lines.stop_seq (số nhỏ nhất của các DO thuộc NPP)';
