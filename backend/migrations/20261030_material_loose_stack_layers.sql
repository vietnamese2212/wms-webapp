-- Sơ đồ xếp xe 3D (30/10): số lớp chồng khi xếp XÁ (xe thùng rời) — có mã chồng xá cao hơn trên pallet
-- (sữa 110ml: pallet 14 lớp, xá 28 lớp). NULL = như max_stack_layers (mã cũ không đổi).
-- Xe pallet vẫn dùng max_stack_layers.

ALTER TABLE public."Material" ADD COLUMN IF NOT EXISTS loose_stack_layers integer;
