-- Cho phép SỐ LẺ ở cột kế hoạch Thùng/Pallet (user chốt 02/07/2026):
-- file KH thực tế có giá trị như 515.5 → cột integer từ chối "invalid input syntax for type integer".
-- Chỉ đổi bảng KẾ HOẠCH (TmsOrder + inbound_plan_lines) — số thực xuất/tồn kho thật vẫn nguyên (không đổi).
-- (Tấn/planned_tons vốn đã numeric.)

ALTER TABLE "TmsOrder"          ALTER COLUMN planned_boxes   TYPE numeric USING planned_boxes::numeric;
ALTER TABLE "TmsOrder"          ALTER COLUMN planned_pallets TYPE numeric USING planned_pallets::numeric;
ALTER TABLE inbound_plan_lines  ALTER COLUMN planned_boxes   TYPE numeric USING planned_boxes::numeric;
ALTER TABLE inbound_plan_lines  ALTER COLUMN planned_pallets TYPE numeric USING planned_pallets::numeric;
