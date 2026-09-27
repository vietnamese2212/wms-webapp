-- Bảng Xem đơn (27/09 khuya) hỏi "OD này THAY OD cũ nào" theo replaced_by_od — sổ ZSD02 lên hàng triệu dòng/năm, không có
-- index là quét cả bảng mỗi lần mở tab. Riêng phần (chỉ dòng đã bị thay) nên nhỏ.
create index if not exists idx_erp_ob_replaced_by on erp_outbound_orders (replaced_by_od) where replaced_by_od is not null;
