-- Bật lại PostgREST aggregate functions (mặc định PostgREST v12 = TẮT).
-- Lý do: listInventory/listFacets phải KÉO ~4000 dòng về Node để cộng/distinct (list ~5.2s, facets ~4.9s)
-- vì không dùng được sum()/count phía DB. Bật aggregate → dùng .select('cartons_remaining.sum()')
-- tái dùng NGUYÊN applyInventoryFilters (tổng khớp tuyệt đối list) — 1 query thay vì phân trang 4000 dòng.
-- An toàn dữ liệu: RLS đã có policy anon_select (qual=true) trên InventoryEntry/Material/Location →
-- anon vốn đọc được toàn bộ; bật aggregate KHÔNG mở thêm dữ liệu, chỉ thêm khả năng gom phía DB.
-- Cấu hình in-database của PostgREST (per-role trên authenticator) + reload không downtime.
ALTER ROLE authenticator SET pgrst.db_aggregates_enabled = 'true';
NOTIFY pgrst, 'reload config';
