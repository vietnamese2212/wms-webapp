-- 03/10/2026 — DÒNG XE THEO KHO (user 02/10: "cũng là các dòng xe đã khai, nhưng mỗi kho sẽ có setting khác nhau: Bàu Bàng có
-- xe 1,9 tấn, Ba Vì không" · "thêm dòng xe thì bắt buộc thêm ở Chung, không cho master data dòng xe khác nhau ở các kho").
-- Master data (mã SAP · tên · cha · điều kiện bảo quản · thước đo · cách tính cước) CHỈ ở vehicle_model (bản Chung).
-- Bảng này = cấu hình RIÊNG của một kho cho một dòng xe: dùng hay không + các con số. Kho chưa có dòng = chạy theo Chung.
-- Đã cấu hình riêng = BẢN CHỤP đầy đủ (user: "config riêng rồi thì không lấy theo chung nữa"): đổi số ở Chung không lan sang kho đó;
-- muốn theo lại Chung thì xoá dòng (nút "Về theo chung").
CREATE TABLE IF NOT EXISTS warehouse_vehicle_model (
  id               uuid PRIMARY KEY,
  warehouse_id     text NOT NULL REFERENCES "Warehouse"(id) ON DELETE CASCADE,
  vehicle_model_id uuid NOT NULL REFERENCES vehicle_model(id) ON DELETE CASCADE,
  is_active        boolean NOT NULL DEFAULT true,                                   -- kho này có dùng dòng xe không
  max_pallets      integer NULL CHECK (max_pallets IS NULL OR max_pallets > 0),     -- sức chứa tại kho (theo thước đo của bản Chung)
  max_tons         numeric NULL CHECK (max_tons IS NULL OR max_tons > 0),
  max_drops        integer NULL CHECK (max_drops IS NULL OR max_drops > 0),         -- điểm giao tối đa tại kho; NULL = chưa khai = 1
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL,
  created_by       text NULL,
  updated_by       text NULL,
  UNIQUE (warehouse_id, vehicle_model_id)
);
CREATE INDEX IF NOT EXISTS warehouse_vehicle_model_wh_idx ON warehouse_vehicle_model (warehouse_id);
COMMENT ON TABLE warehouse_vehicle_model IS 'Cấu hình riêng của KHO cho một dòng xe con (bật/tắt + sức chứa + điểm giao). Không có dòng = theo bản Chung (vehicle_model).';
