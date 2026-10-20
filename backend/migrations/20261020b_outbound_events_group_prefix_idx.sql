-- 20/10/2026 — tab LỊCH SỬ điều vận lọc theo TIỀN TỐ Số xe (`<MãKho>_X_%`, `<MãKho>_X_<ddmmyy>%`): chỉ mục btree thường trên text (collation
-- không phải "C") KHÔNG phục vụ LIKE 'tiền tố%' ⇒ EXPLAIN đo 20/10: Seq Scan cả bảng outbound_events khi lọc ngày kế hoạch. Đổi chỉ mục
-- (group_code, created_at DESC) sang text_pattern_ops — vẫn phục vụ `=` (popup tình trạng xe, Thông tin chuyến) và `ORDER BY created_at DESC`,
-- thêm được LIKE tiền tố. Không thêm chỉ mục mới (11/10 đã dọn chỉ mục thừa vì IO staging). Idempotent. Lên production: áp bất kỳ lúc nào.
DROP INDEX IF EXISTS public.idx_oev_group;
CREATE INDEX IF NOT EXISTS idx_oev_group ON public.outbound_events USING btree (group_code text_pattern_ops, created_at DESC);
