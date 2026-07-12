-- Quét thùng khi xuất — setup TẠI TỪNG KHO (user chốt 12/07 lần 2):
-- bật công tắc kho (carton_scan_override, đã có) + CHỌN các Loại kho phải quét TẠI KHO ĐÓ.
-- vd: kho 1 quét loại [Thành phẩm, POSM] · kho 2 chỉ [Thùng] — độc lập nhau.
-- null/rỗng = không loại nào (dù công tắc bật). Bỏ cờ meta requires_carton_scan ở LookupValue (không dùng nữa).
ALTER TABLE public."Warehouse" ADD COLUMN IF NOT EXISTS carton_scan_categories text[];
