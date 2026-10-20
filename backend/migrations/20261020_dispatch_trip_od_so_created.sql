-- 20/10/2026 — SO TẠO SAU NGÀY ĐI HÀNG không tự vào kế hoạch (user: "khoá tự động đưa vào kế hoạch những SO có ngày tạo sau ngày đi hàng,
-- chỉ đưa vào khi user đưa bằng tay — đơn bù; có dấu hiệu nhận biết trên kế hoạch").
-- Bản chụp ngày tạo SO (ngày VN của erp_outbound_orders.so_created_at) trên từng dòng OD của kế hoạch điều vận: so với plan_date ⇒
-- "SO sau ngày đi" — Sửa (refresh-pool review_all) và Tối ưu lại (review_all) bỏ qua, chỉ tick / kéo tay mới lên xe; bàn + Xem đơn in chip.
-- Idempotent. Lên production: áp bất kỳ lúc nào TRƯỚC khi code mới chạy (code ghi cột này khi nạp OD).
ALTER TABLE public.dispatch_trip_od ADD COLUMN IF NOT EXISTS so_created_date date;
COMMENT ON COLUMN public.dispatch_trip_od.so_created_date IS 'Ngày tạo SO (VN) chụp từ ZSD02 lúc nạp OD — > plan_date = SO tạo sau ngày đi hàng (đơn bù): không tự vào kế hoạch, người đưa tay (20/10/2026)';
