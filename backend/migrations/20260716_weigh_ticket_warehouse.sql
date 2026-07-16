-- Phiếu cân gắn KHO (user 16/07: tương lai tích hợp dữ liệu cân của nhiều kho → cần filter Kho).
-- Agent mỗi trạm khai warehouse_id trong CONFIG → gửi kèm mỗi lô; dòng cũ chưa có kho = NULL
-- (list cắt scope null-inclusive nên vẫn hiện). Gán kho cho phiếu cũ của 1 trạm:
--   UPDATE public."WeighTicket" SET warehouse_id = '<id kho>' WHERE station_code = 'KB01' AND warehouse_id IS NULL;
ALTER TABLE public."WeighTicket" ADD COLUMN IF NOT EXISTS warehouse_id text;
CREATE INDEX IF NOT EXISTS idx_weigh_warehouse ON public."WeighTicket" (warehouse_id);
