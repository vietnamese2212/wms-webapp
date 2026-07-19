-- Pallet tối đa KHAI BÁO TAY tại Khu vực kho (user chốt 19/07: không cộng tự động từ Σ Location.max_pallets)
-- Dùng cho card "Sức chứa khu vực kho" trên Dashboard: so pallet tồn vs pallet tối đa.
-- NULL = chưa khai → card hiện "Chưa khai pallet tối đa".
ALTER TABLE "WarehouseZone" ADD COLUMN IF NOT EXISTS max_pallets integer;
