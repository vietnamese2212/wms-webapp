-- 26/11 — "Hàng không tem theo NSX" ở kho QUẢN LÝ THEO TEM (inventory_mode = 'QR').
-- User chốt 26/11 (nghiệm thu bằng vai Phó phòng QA ở Chế biến Ba Vì): NVL không tem nhập vào kho chế biến từng KHÔNG có NSX
-- (tồn gộp 1 dòng / mã, NSX trống) ⇒ không tính được HSD, không xếp FEFO. "Bắt nhập nếu có config như vậy ở kho cb".
--
-- Bật cờ ⇒ hàng KHÔNG TEM của kho QR chạy đúng luật của kho "Tồn số lượng theo date" (QTY_DATE):
--   • Lưu thủ công (nhập) BẮT BUỘC NSX; tồn gộp tách 1 dòng / (mã, NSX);
--   • Lưu số lượng (xuất) trừ theo thứ tự luân chuyển của kho, chọn được đúng NSX;
--   • cấp NVL vào mẻ đã đi theo lô (NSX + số lô) sẵn — không đổi.
-- Hàng CÓ tem không đổi gì. Kho QTY_DATE luôn theo NSX (không cần cờ); kho QTY / NONE bỏ qua cờ.
-- Hai tầng như mọi cờ chiến thuật (memory feedback-new-strategy-flag-is-always-two-tier): Kho = mặc định,
-- Loại kho NULL = theo kho, false của loại tắt được cái kho đang bật (vd PK01 bao bì không theo NSX).
-- Ghép tầng DUY NHẤT ở `resolveNoQrDateTracking` (utils/putaway.ts) → `services/noQrPool.ts`.
-- Mặc định false = hành vi cũ. Không bật hộ kho nào trong migration — bật ở Cài đặt WMS → Kho.

BEGIN;

alter table "Warehouse"              add column if not exists noqr_date_tracking boolean not null default false;
alter table "warehouse_type_configs" add column if not exists noqr_date_tracking boolean;

comment on column "Warehouse".noqr_date_tracking is
  'Kho QR: hàng KHÔNG TEM theo dõi theo NSX (lưu thủ công bắt NSX, tồn gộp tách theo NSX, xuất trừ theo luân chuyển). Mặc định false. 26/11.';
comment on column "warehouse_type_configs".noqr_date_tracking is
  'Khai riêng cho loại kho của cờ Warehouse.noqr_date_tracking — NULL = theo kho. 26/11.';

COMMIT;
