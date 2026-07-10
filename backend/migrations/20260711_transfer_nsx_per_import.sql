-- Nhận chuyển kho vào kho QTY_DATE: tách 1 phiếu nhập / (mã hàng × NSX).
-- NSX kế thừa từ tem pallet đã quét xuất ở kho nguồn (OutboundScanEntry.production_date)
-- → người nhận KHÔNG phải nhìn tem gõ tay; 1 lần 1 mã nhận được NHIỀU date.
-- NULL = phiếu không gắn NSX (kho nhận không phải QTY_DATE, hoặc hàng no-QR không rõ NSX từ nguồn).
ALTER TABLE "ProductionImport" ADD COLUMN IF NOT EXISTS transfer_production_date date;
COMMENT ON COLUMN "ProductionImport".transfer_production_date IS
  'NSX của dòng nhận chuyển kho (kho đích QTY_DATE) — kế thừa từ pallet quét xuất ở kho nguồn; scanManual dùng làm production_date của pool, người nhận không cần gõ tay';
