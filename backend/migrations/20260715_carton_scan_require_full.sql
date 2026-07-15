-- Quét tới THÙNG khi xuất: tùy chọn BẮT BUỘC QUÉT ĐỦ theo từng kho (user chốt 15/07).
-- false (mặc định) = không bắt buộc — quét được bao nhiêu lưu bấy nhiêu (truy vết mềm).
-- true = bắt buộc: khi Hoàn thành chuyến, mỗi pallet đã quét (thuộc Loại kho bật cờ) phải có
--        số tem thùng KHỚP mã hàng >= số thùng của pallet; thiếu → chặn 400 kèm danh sách pallet.
-- Chỉ có ý nghĩa khi carton_scan_override = true (công tắc quét thùng của kho đang bật).
ALTER TABLE public."Warehouse"
  ADD COLUMN IF NOT EXISTS carton_scan_require_full boolean NOT NULL DEFAULT false;
