-- Index composite cho các list page nặng — theo đo tải 23/07: nhiều user GHI làm user ĐỌC bị delay
-- 3–10× (Tồn kho p95 1.3s→10.9s, Xuất 0.7s→8.5s, Nhập 0.9s→4.9s). EXPLAIN cho thấy MỖI lượt mở
-- trang Tồn kho chạy 3 query đều Seq Scan ~36k dòng (~7.4k buffer/lượt) vì thiếu index khớp shape:
--   list chính : WHERE warehouse_id ORDER BY import_date DESC NULLS LAST, id  → thiếu composite
--   tổng thùng : WHERE warehouse_id GROUP BY material_id SUM(cartons_remaining)
--   đếm pallet : WHERE warehouse_id AND cartons_remaining > 0
-- Production hàng triệu dòng/năm → bắt buộc index. (Plain CREATE INDEX — bảng hiện còn nhỏ,
-- Dashboard SQL editor chạy trong transaction nên không dùng CONCURRENTLY được.)

-- 1) Tồn kho — list chính (khớp sort DESC NULLS LAST + tie-break id, hết Sort node)
create index if not exists idx_ie_wh_importdate
  on "InventoryEntry" (warehouse_id, import_date desc nulls last, id asc);

-- 2) Tồn kho — SUM group theo mã + COUNT còn tồn (index-only scan, cartons_remaining nằm INCLUDE)
create index if not exists idx_ie_wh_mat_rem
  on "InventoryEntry" (warehouse_id, material_id) include (cartons_remaining);

-- 3) Xuất kho — list GDO lọc kho + ngày (bảng chưa có BẤT KỲ index warehouse_id nào)
create index if not exists idx_gdo_wh_date
  on "GroupDeliveryOrder" (warehouse_id, delivery_date desc);

-- 4) Nhập kho — list phiếu lọc kho + khoảng ngày (thay bitmap-AND 2 index đơn cột)
create index if not exists idx_pi_wh_importdate
  on "ProductionImport" (warehouse_id, import_date desc);

analyze "InventoryEntry";
analyze "GroupDeliveryOrder";
analyze "ProductionImport";
