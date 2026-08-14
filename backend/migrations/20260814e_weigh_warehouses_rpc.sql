-- Kho THỰC CÓ phiếu cân — 1 lời gọi thay vì 1 truy vấn / 1 KHO (14/08/2026)
--
-- Trước: listWeighWarehouses hỏi "kho này có phiếu cân không?" cho TỪNG kho. Đo staging: 153 kho
-- đang hoạt động ⇒ 153 request PostgREST mỗi lần mở bộ lọc trang Phiếu cân, trong khi pool chỉ
-- ~10 khe. Cùng họ lỗi với gợi ý vị trí nhập (1.517 request) đã gỡ cùng ngày.
--
-- DISTINCT trên bảng phiếu cân KHÔNG bị cap-1000 vì chạy trong DB (cap là của PostgREST, không
-- phải của SQL) — số dòng TRẢ VỀ bị chặn bởi số KHO có phiếu, không phải số phiếu.

CREATE OR REPLACE FUNCTION public.weigh_ticket_warehouses()
RETURNS TABLE(warehouse_id text)
LANGUAGE sql
STABLE
AS $function$
  SELECT DISTINCT wt.warehouse_id
  FROM "WeighTicket" wt
  WHERE wt.warehouse_id IS NOT NULL
$function$;

CREATE INDEX IF NOT EXISTS idx_weighticket_warehouse ON "WeighTicket" (warehouse_id);

NOTIFY pgrst, 'reload schema';
