-- Thêm sort_order cho VehicleType để kéo-thả thứ tự ở TMS Settings (giống LookupValue.sort_order).
-- Áp dụng cho thứ tự cấp Loại xe trong cây Đăng ký cổng.
-- An toàn: code đọc đã resilient (thiếu cột vẫn chạy theo tên) nên có thể apply bất cứ lúc nào.

ALTER TABLE "VehicleType" ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Backfill theo thứ tự tên hiện tại (1..N) để có thứ tự khởi đầu ổn định
WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY name) AS rn FROM "VehicleType"
)
UPDATE "VehicleType" v SET sort_order = r.rn FROM ranked r WHERE v.id = r.id;
