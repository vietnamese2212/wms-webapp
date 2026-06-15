-- ============================================================
-- HR: cờ JobTitle.in_chart — chức danh đã được đặt vào sơ đồ tổ chức
-- Apply: Supabase Dashboard → SQL Editor
-- ============================================================
-- Sơ đồ tổ chức chỉ hiện chức danh in_chart=true. Mặc định false → sơ đồ trắng,
-- người dùng tự thêm vị trí vào. Bỏ khỏi sơ đồ = in_chart=false (không xóa chức danh).

ALTER TABLE "JobTitle" ADD COLUMN IF NOT EXISTS in_chart BOOLEAN NOT NULL DEFAULT false;
