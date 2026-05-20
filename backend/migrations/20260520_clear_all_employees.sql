-- Xóa toàn bộ dữ liệu nhân viên để tạo lại từ đầu.
-- Chạy trong Supabase Dashboard → SQL Editor.
-- Sau khi chạy: npx ts-node src/seed-admin.ts để tạo lại admin.
DELETE FROM "UserWarehouseAccess";
DELETE FROM "Employee";
