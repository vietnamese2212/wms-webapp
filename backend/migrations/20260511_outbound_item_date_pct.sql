-- %Date_Yêu cầu là % shelf life yêu cầu (số, ví dụ 90 = 90%), không phải ngày
-- Đổi từ kiểu DATE/TEXT sang NUMERIC; dữ liệu cũ sai hết (parseExcelDate(90) = 1900-03-31)
ALTER TABLE "OutboundItem" DROP COLUMN IF EXISTS date_required;
ALTER TABLE "OutboundItem" ADD COLUMN date_required NUMERIC;
