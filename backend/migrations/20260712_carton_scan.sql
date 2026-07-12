-- Quét tem THÙNG đính kèm pallet khi Xuất (truy vết, KHÔNG tính tồn theo QR thùng).
-- 1) carton_scans: danh sách mã thùng đã quét cho MỖI dòng scan pallet (jsonb mảng
--    [{ code, match, at }] — match=false = thùng lạ mã hàng, vẫn lưu để truy vết).
--    Không đẻ bảng nghìn-dòng/pallet → an toàn quy mô.
-- 2) carton_scan_override: cờ ĐÈ theo từng Kho (null = theo Loại kho; true/false = ép bật/tắt).
--    Loại kho dùng cờ LookupValue.meta.requires_carton_scan (không cần DDL).
ALTER TABLE public."OutboundScanEntry" ADD COLUMN IF NOT EXISTS carton_scans jsonb;
ALTER TABLE public."Warehouse"        ADD COLUMN IF NOT EXISTS carton_scan_override boolean;
