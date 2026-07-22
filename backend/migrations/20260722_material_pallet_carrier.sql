-- Cờ "Mã là PALLET MANG HÀNG" (Pallet Loscam…) — user 22/07: dòng pallet Loscam trong đơn xuất
-- chính là pallet chứa hàng bên trên → cộng nó vào ĐẾM PALLET của chuyến là double.
-- Hành vi theo THUỘC TÍNH per-mã (không if theo tên/loại): is_pallet_carrier = true
-- → loại khỏi đếm Pallet (listGDOs palletsOf); vẫn giữ ở Tổng (k QR) để giao nhận đếm số tấm.
alter table public."Material" add column if not exists is_pallet_carrier boolean not null default false;

-- Backfill mã Pallet Loscam hiện có (đơn vị 1) — mã khác user tự tick trong form Mã hàng
update public."Material" set is_pallet_carrier = true where short_name ilike '%pallet loscam%';
