-- 03/10/2026 tối — chỉ số duy nhất "một kế hoạch MỞ mỗi kho × ngày" (20260924b) phải thêm MẢNG: hai mảng Trung chuyển / Bán hàng là hai
-- kế hoạch mở cùng kho × ngày (20261003k). Gói 61 [19a] bắt ngay lượt đầu: POST kế hoạch Trung chuyển → 23505 "Giá trị này đã tồn tại".
BEGIN;
DROP INDEX IF EXISTS public.uq_dispatch_plan_open;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispatch_plan_open ON public.dispatch_plan (warehouse_id, plan_date, segment) WHERE status IN ('DRAFT', 'TENDERED');
COMMIT;
