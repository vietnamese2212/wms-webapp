-- Sơ đồ xếp xe 3D (đợt 2 — luật xếp chồng theo user):
-- max_stack_layers = số lớp xếp tối đa của 1 chân hàng (null = theo chiều cao xe)
-- stack_on_top     = hàng nhẹ (túi, POSM…) được phép xếp TRÊN mã hàng khác (ưu tiên lên nóc)

ALTER TABLE public."Material" ADD COLUMN IF NOT EXISTS max_stack_layers integer;
ALTER TABLE public."Material" ADD COLUMN IF NOT EXISTS stack_on_top boolean NOT NULL DEFAULT false;
