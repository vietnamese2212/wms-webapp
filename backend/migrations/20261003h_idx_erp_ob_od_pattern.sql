-- 03/10: chỉ mục prefix cho od_number — `od_number LIKE 'QA61%'` (dọn fixture của mọi gói QA) và tìm theo đầu số DO hiện đi
-- Seq Scan 29,5k dòng = 3,5 s trên staging NANO (đo trong giao dịch ROLLBACK), lúc máy bận vượt statement_timeout 8 s ⇒ cleanup
-- bị nuốt lỗi, fixture QA61 còn sót 7 dòng OBSOLETE ⇒ lượt sau POST trùng (od_number, od_item) ⇒ 7 phép đỏ dây chuyền (03/10).
-- btree mặc định (collation en_US) không dùng được cho LIKE tiền tố; text_pattern_ops thì được.
BEGIN;
CREATE INDEX IF NOT EXISTS idx_erp_ob_od_pattern ON public.erp_outbound_orders (od_number text_pattern_ops);
COMMIT;
