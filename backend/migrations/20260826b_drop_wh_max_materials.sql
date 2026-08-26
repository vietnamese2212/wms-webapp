-- DỌN trục cũ của "số mã tối đa / vị trí" — chạy SAU khi bản code 26/08 đã LIVE.
--
-- Trần số mã nay khai trên `Location.max_materials` (migration 20260826). Hai cột dưới đây là tàn
-- dư của trục cũ (Kho → Loại kho) và KHÔNG còn ai đọc.
--
-- ⚠️ THỨ TỰ BẮT BUỘC — đừng gộp vào migration trước:
--   1. deploy code mới (đã gỡ 2 cột khỏi PUTAWAY_WH_COLS + WH_TYPE_CFG_COLS)
--   2. xác nhận bản mới đang chạy (GET /api/version khớp commit)
--   3. MỚI chạy file này
-- Drop trước bước 2 thì code CŨ vẫn đang `select putaway_max_materials` → PostgREST trả 42703 →
-- 500 hàng loạt ở mọi lượt quét nhập. Đây đúng khuôn "migration additive trước, DROP sau khi code
-- live" trong CLAUDE.md.
--
-- Dữ liệu mất đi: Kho Ba Vì đang khai 2. Đã báo user và user chốt KHÔNG chuyển sang vị trí
-- ("mặc định bỏ trống") — kho khai lại bằng nút khai hàng loạt trên trang Vị trí kho.
-- Giá trị cũ được chụp lại vào bảng sao lưu trước khi drop, phòng khi muốn dò lại con số cũ.

BEGIN;

CREATE TABLE IF NOT EXISTS public.x_bak_20260826_max_materials AS
SELECT 'Warehouse'::text AS nguon, w.id::text AS ban_ghi, w.name AS ten,
       w.putaway_max_materials AS gia_tri_cu
  FROM public."Warehouse" w
 WHERE w.putaway_max_materials IS NOT NULL;

INSERT INTO public.x_bak_20260826_max_materials (nguon, ban_ghi, ten, gia_tri_cu)
SELECT 'warehouse_type_configs', c.warehouse_id::text || '|' || c.type_code, c.type_code,
       c.putaway_max_materials
  FROM public.warehouse_type_configs c
 WHERE c.putaway_max_materials IS NOT NULL;

ALTER TABLE public."Warehouse"              DROP COLUMN IF EXISTS putaway_max_materials;
ALTER TABLE public.warehouse_type_configs   DROP COLUMN IF EXISTS putaway_max_materials;

COMMIT;
