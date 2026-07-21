-- ĐỢT 1 reconcile SAP↔WMS — delivery_code (chuỗi gộp mã DO) trở thành THAM KHẢO, không còn bắt buộc.
-- Liên kết OD↔dòng chuyển sang OutboundItem.od_refs (chính xác per-OD-line). delivery_code vẫn được ghi
-- cho tương thích/hiển thị, nhưng cho phép NULL để tương lai tạo delivery không cần gộp mã.
ALTER TABLE public."OutboundDelivery" ALTER COLUMN delivery_code DROP NOT NULL;
