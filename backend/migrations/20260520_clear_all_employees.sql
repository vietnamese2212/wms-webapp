-- Xóa toàn bộ dữ liệu nhân viên để tạo lại từ đầu.
-- Chỉ dùng khi reset môi trường test — KHÔNG dùng trên production có dữ liệu thật.
-- Chạy trong Supabase Dashboard → SQL Editor.
-- Sau khi chạy: npx ts-node src/seed-admin.ts để tạo lại admin.
TRUNCATE TABLE "Employee" CASCADE;
