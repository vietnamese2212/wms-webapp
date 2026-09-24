-- MÀU PALLET khai theo MÃ (user chốt 26/08): sơ đồ xếp xe vẽ ĐẾ pallet đồng màu, rõ nét phân
-- biệt với hàng phía trên; tương lai có pallet dạng khác (mỗi dạng = 1 mã is_pallet_carrier riêng,
-- mỗi mã 1 màu) nên màu phải nằm trên MÃ chứ không hardcode.
-- Chỉ có nghĩa khi `is_pallet_carrier` = true; hex #rrggbb; NULL = dùng màu mặc định (xanh Loscam).
ALTER TABLE public."Material"
  ADD COLUMN IF NOT EXISTS pallet_color text;

ALTER TABLE public."Material" DROP CONSTRAINT IF EXISTS material_pallet_color_hex;
ALTER TABLE public."Material" ADD CONSTRAINT material_pallet_color_hex
  CHECK (pallet_color IS NULL OR pallet_color ~ '^#[0-9a-fA-F]{6}$');

COMMENT ON COLUMN public."Material".pallet_color IS
  'Màu vẽ pallet trên sơ đồ xếp xe 3D (#rrggbb) — chỉ dùng khi is_pallet_carrier. NULL = màu mặc định.';
