-- 03/10/2026 — Cấu hình riêng của kho cho dòng xe = RIÊNG THEO TỪNG Ô (user: "khi thay đổi 1 điểm tại kho riêng thì tất cả mọi
-- setting của kho chung không còn với tới kho riêng nữa — chưa hợp lý"). Bản đầu (20261003a) chụp cả bốn giá trị khi kho chỉnh một ô.
-- Nay NULL ở ô nào = ô đó theo bản Chung; kho chỉ giữ ô đã chỉnh. is_active vì thế phải nullable (NULL = theo Chung).
-- Dòng mà cả bốn ô đều NULL = không còn cấu hình riêng ⇒ controller xoá dòng. Staging lúc áp: 0 dòng.
ALTER TABLE warehouse_vehicle_model ALTER COLUMN is_active DROP NOT NULL;
ALTER TABLE warehouse_vehicle_model ALTER COLUMN is_active DROP DEFAULT;
COMMENT ON TABLE warehouse_vehicle_model IS 'Cấu hình riêng của KHO cho một dòng xe con — RIÊNG THEO TỪNG Ô: NULL = ô đó theo bản Chung (vehicle_model). Không có dòng / cả bốn ô NULL = theo Chung hoàn toàn.';
