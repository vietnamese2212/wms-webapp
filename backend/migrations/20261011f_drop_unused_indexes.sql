-- 11/10/2026 — Bỏ chỉ mục THỪA (user duyệt đề xuất 5, rà hệ thống 11/10 tối). Staging: `pg_stat_user_indexes` chưa từng reset
-- (thống kê từ lúc tạo DB, qua mọi lượt QA full) — các chỉ mục dưới có idx_scan = 0, hoặc là BẢN TRÙNG của chỉ mục khác.
-- Mỗi lần ghi pallet / quét / chuyến, Postgres vẫn phải cập nhật chúng; GIN trên carton_scans tốn mỗi lần quét.
-- Giữ lại dù 0 lượt: idx_material_search_norm (tìm bỏ dấu — bảng còn nhỏ nên planner quét tuần tự, lớn sẽ dùng),
-- idx_weigh_plate_date (tra phiếu cân theo biển + ngày — WeighTicket production lớn hơn staging), các chỉ mục ≤ 16 kB (không đáng).
-- ⚠️ LÊN PRODUCTION: chạy TRƯỚC câu kiểm trên production —
--   SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE indexrelname IN (…danh sách dưới…);
-- chỉ DROP chỉ mục có idx_scan = 0 Ở ĐÓ (mẫu dùng khác staging); bản trùng thì bỏ được ngay.
BEGIN;

-- BẢN TRÙNG (cùng cột với chỉ mục đang dùng)
DROP INDEX IF EXISTS public.idx_weighticket_warehouse;   -- = idx_weigh_warehouse (warehouse_id)
DROP INDEX IF EXISTS public.idx_gdo_wh_date;             -- = idx_gdo_wh_deliverydate (warehouse_id, delivery_date DESC)
DROP INDEX IF EXISTS public.idx_gdo_delivery_date;       -- = idx_gdo_deliverydate (delivery_date DESC)

-- CHƯA TỪNG DÙNG (idx_scan = 0 từ lúc tạo DB), không có truy vấn nào trong code lọc theo cột đó
DROP INDEX IF EXISTS public.idx_outbound_scan_carton_scans;  -- GIN jsonb — code chỉ GHI carton_scans, không lọc
DROP INDEX IF EXISTS public.idx_outbound_item_exptype;       -- (export_type, do_id) — không có .eq('export_type')
DROP INDEX IF EXISTS public.idx_outbound_delivery_npp;       -- (distributor_name, gdo_id) — tra theo gdo_id đi idx_obd_gdo_id
DROP INDEX IF EXISTS public.idx_ie_tem_cycle;                -- biểu thức tách chu kỳ từ pallet_code — tốn mỗi lần nhập pallet
DROP INDEX IF EXISTS public.idx_ie_loc_used;                 -- (location_id) WHERE stack_layer=1 — sức chứa đi InventoryEntry_location_id_status_idx
DROP INDEX IF EXISTS public.idx_erp_so_created;              -- erp_so_lines (created_at)
DROP INDEX IF EXISTS public.idx_material_desc_norm;          -- lower(btrim(material_description)) — tìm đi search_norm

COMMIT;
