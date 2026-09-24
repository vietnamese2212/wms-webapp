-- SỐ MÃ TỐI ĐA / VỊ TRÍ — chuyển từ cấu hình theo KHO + LOẠI KHO sang theo TỪNG VỊ TRÍ (26/08).
--
-- VÌ SAO ĐỔI TRỤC (user chốt): "Ngoài đường", "Mặt đất", "Kho lẻ" là nơi CHỨA CHUNG, nhưng chúng
-- nằm CÙNG KHU và CÙNG LOẠI HÀNG với kệ thường — đo staging: B_TP1_NGOÀI ĐƯỜNG SCA giữ 29 mã và
-- B_TP2_MẶT ĐẤT giữ 28 mã, cả hai đều thuộc khu TP1/TP2 hàng thành phẩm y như các kệ 1-2 mã bên
-- cạnh. Loại kho = loại HÀNG nên không có cách nào tách chúng ⇒ trục cũ sai từ gốc. "Chứa chung"
-- là thuộc tính VẬT LÝ của cái ô, phải khai trên cái ô.
--
-- NGỮ NGHĨA (user chốt 26/08) — cố ý CHỈ 2 trạng thái, không kế thừa tầng nào:
--   NULL  = KHÔNG GIỚI HẠN  (mặc định của mọi vị trí, kể cả vị trí mới tạo)
--   N ≥ 1 = ô này tối đa N mã
-- Nhìn vào ô là biết luật của ô — không phải tra ngược lên kho rồi lên loại kho mới suy ra được.
-- Đây là lý do KHÔNG dùng quy ước "0 = không giới hạn" của `max_pallets`: ở đây trạng thái mặc
-- định phải là ô TRỐNG, và trống thì không được mang nghĩa "giới hạn 0 mã" (= cấm mọi thứ).
--
-- KHÔNG backfill (user chốt "mặc định bỏ trống"): sau migration mọi vị trí = không giới hạn.
-- Kho Ba Vì đang khai 2 mã ở TẦNG KHO sẽ MẤT giới hạn đó cho tới khi khai lại bằng nút khai hàng
-- loạt trên trang Vị trí kho. Đây là thay đổi hành vi CÓ CHỦ ĐÍCH, đã báo trước.
--
-- Hai cột của trục cũ (`Warehouse.putaway_max_materials`, `warehouse_type_configs.putaway_max_materials`)
-- KHÔNG drop ở đây: code đang chạy trên production vẫn SELECT chúng, drop trước khi deploy = 500
-- hàng loạt. Dọn ở migration `20260826b_drop_wh_max_materials.sql`, chạy SAU khi bản mới đã live.

ALTER TABLE public."Location"
  ADD COLUMN IF NOT EXISTS max_materials integer;

-- Trần 1000 cùng lý do với tầng kho cũ: cột `integer`, số quá lớn (1e12) làm Postgres tràn kiểu →
-- 500 thay vì lỗi nhập liệu 4xx (fuzz 15/08 bắt được). Ô lớn nhất đo thật mới 111 mã.
ALTER TABLE public."Location"
  DROP CONSTRAINT IF EXISTS location_max_materials_range;
ALTER TABLE public."Location"
  ADD CONSTRAINT location_max_materials_range
  CHECK (max_materials IS NULL OR (max_materials >= 1 AND max_materials <= 1000));

COMMENT ON COLUMN public."Location".max_materials IS
  'Số mã tối đa được để chung trong vị trí này. NULL = không giới hạn (mặc định). Khai theo TỪNG vị trí — không kế thừa từ Kho/Loại kho (đổi trục 26/08).';
