-- Seed Loại kho vào LookupValue — dùng cho WMS Settings, Locations, TMS Bookings, User permissions
INSERT INTO "LookupValue" (type, value, sort_order) VALUES
  ('warehouse_type', 'Thành phẩm', 1),
  ('warehouse_type', 'NVL',        2),
  ('warehouse_type', 'POSM',       3),
  ('warehouse_type', 'Bao bì',     4)
ON CONFLICT (type, value) DO NOTHING;
