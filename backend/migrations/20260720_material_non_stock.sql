-- Mã PHI HÀNG HÓA (chiết khấu/dịch vụ, vd 910000060) — user chốt 20/07.
-- Tích cờ này: chỉ cần Mã + Tên; app LOẠI mã khỏi Xuất/Nhập/Tồn + mọi picker chọn hàng.
-- Vẫn lưu ở raw erp_outbound_orders để đối chiếu SAP/kế toán, chỉ KHÔNG sinh dòng cần quét.
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS is_non_stock boolean NOT NULL DEFAULT false;
