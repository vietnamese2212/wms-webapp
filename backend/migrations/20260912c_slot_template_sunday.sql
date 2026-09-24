-- Khung giờ mẫu: MỞ CHỦ NHẬT (thứ 0).
--
-- Vì sao: giao diện tab Khung giờ (Cài đặt TMS) VỐN ĐÃ có nút "CN" kèm chú thích
-- "mặc định T2–T7; chọn CN nếu cần", nhưng cả hai cửa ghi đều từ chối thứ 0 — trước là
-- 23514 từ CHECK này, sau 07/09 là câu 400 "chỉ nhận T2..T7". Tức app MỜI người dùng
-- chọn Chủ Nhật rồi từ chối chính lựa chọn đó.
--
-- Hệ quả đo thật 12/09/2026: kho Bàu Bàng có chuyến ngày 06/09 (Chủ Nhật) — lịch đặt xe
-- ngày đó RỖNG, không phải "hết chỗ" mà là không có ô nào để chọn, và màn hình không nói
-- một lời nào. Đây là kho chạy Chủ Nhật thật (hệ số tải 0,20 nhưng vẫn có xe).
--
-- Hai chỗ sinh DeliverySlot (`generateSlotsForDates`, `reapplyFutureSlots`) vốn đã so
-- `day_of_week` với `getUTCDay()` (0 = CN) và còn ghi sẵn chú thích "CN chỉ sinh nếu có
-- template CN" — tức đường SINH đã tính tới Chủ Nhật từ đầu, chỉ có cửa VÀO là khoá.
-- Nên chỉ cần nới CHECK + nới validator, không đụng logic sinh lịch.
--
-- Quy ước giữ nguyên `getUTCDay()`: 0 = CN, 1..6 = T2..T7. KHÔNG dùng 7 cho Chủ Nhật.

ALTER TABLE public."SlotTemplate" DROP CONSTRAINT IF EXISTS "SlotTemplate_day_of_week_check";

ALTER TABLE public."SlotTemplate"
  ADD CONSTRAINT "SlotTemplate_day_of_week_check"
  CHECK (day_of_week >= 0 AND day_of_week <= 6);
