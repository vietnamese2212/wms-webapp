-- 24/08/2026 — SETTING NHẶT LẺ THEO KHO + THEO LOẠI KHO (user chốt cùng ngày, 2 tầng như chiến thuật 21/08)
-- Trước nay luật tự sinh nhặt lẻ là HARDCODE một công thức (phần dư dưới 1 pallet nguyên) —
-- user cần: kho tắt hẳn nhặt lẻ · POSM lấy TOÀN BỘ SL vào nhặt lẻ · trần thùng (phần lẻ quá lớn
-- thì bốc nguyên pallet nhanh hơn nhặt tay).
--
--   loose_mode:        'REMAINDER' = phần lẻ dưới pallet (hành vi cũ) · 'ALL' = toàn bộ SL · 'OFF' = không nhặt lẻ
--   loose_max_cartons: trần THÙNG cho chế độ REMAINDER — phần lẻ quy thùng VƯỢT trần thì không đưa
--                      vào nhặt lẻ (đi luồng quét pallet + khai chỗ đặt phần dư). ALL/OFF bỏ qua trần.
--                      Mã không khai quy cách thùng: REMAINDER luôn = 0 (như cũ), trần không đụng tới.
--
-- Tầng kho (Warehouse): NULL = 'REMAINDER' (hành vi cũ — migration không đổi kho nào).
-- Tầng loại (warehouse_type_configs): NULL = theo mặc định kho.
-- OFF ép 0 MỌI ĐƯỜNG kể cả cột "Nhặt lẻ" ghi tay trong file upload kiểu cũ (user chốt 24/08).

ALTER TABLE "Warehouse"
  ADD COLUMN IF NOT EXISTS loose_mode        text,
  ADD COLUMN IF NOT EXISTS loose_max_cartons numeric;
ALTER TABLE "Warehouse" DROP CONSTRAINT IF EXISTS wh_loose_mode_valid;
ALTER TABLE "Warehouse" ADD CONSTRAINT wh_loose_mode_valid
  CHECK (loose_mode IS NULL OR loose_mode IN ('REMAINDER', 'ALL', 'OFF'));
ALTER TABLE "Warehouse" DROP CONSTRAINT IF EXISTS wh_loose_max_valid;
ALTER TABLE "Warehouse" ADD CONSTRAINT wh_loose_max_valid
  CHECK (loose_max_cartons IS NULL OR (loose_max_cartons >= 1 AND loose_max_cartons <= 100000));

ALTER TABLE warehouse_type_configs
  ADD COLUMN IF NOT EXISTS loose_mode        text,
  ADD COLUMN IF NOT EXISTS loose_max_cartons numeric;
ALTER TABLE warehouse_type_configs DROP CONSTRAINT IF EXISTS wtc_loose_mode_valid;
ALTER TABLE warehouse_type_configs ADD CONSTRAINT wtc_loose_mode_valid
  CHECK (loose_mode IS NULL OR loose_mode IN ('REMAINDER', 'ALL', 'OFF'));
ALTER TABLE warehouse_type_configs DROP CONSTRAINT IF EXISTS wtc_loose_max_valid;
ALTER TABLE warehouse_type_configs ADD CONSTRAINT wtc_loose_max_valid
  CHECK (loose_max_cartons IS NULL OR (loose_max_cartons >= 1 AND loose_max_cartons <= 100000));

COMMENT ON COLUMN "Warehouse".loose_mode IS 'Tự sinh nhặt lẻ: REMAINDER=phần lẻ dưới pallet (NULL=vậy, hành vi cũ) · ALL=toàn bộ SL · OFF=không nhặt lẻ (ép 0 cả số tay upload cũ)';
COMMENT ON COLUMN "Warehouse".loose_max_cartons IS 'Trần THÙNG cho chế độ REMAINDER — phần lẻ vượt trần thì không nhặt lẻ. NULL = không chặn';
COMMENT ON COLUMN warehouse_type_configs.loose_mode IS 'Override nhặt lẻ theo LOẠI KHO của mã hàng. NULL = theo mặc định kho';
COMMENT ON COLUMN warehouse_type_configs.loose_max_cartons IS 'Override trần thùng nhặt lẻ theo loại. NULL = theo mặc định kho';
