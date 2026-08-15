-- 20260813d — DANH MỤC MÁY THEO KHO (user 13/08 tối): "Máy sẽ thuộc Kho, mỗi kho có các tên máy
-- khác nhau. Sổ đóng gói lấy validate máy ở đây; In tem validate chọn máy theo NMSX.
-- Kho nào có setup Máy thì phải chọn theo validate, không thì mới được điền tự do."
-- Quản trị ở Cài đặt WMS tab "Máy" (quyền wms_settings.manage_machine).
CREATE TABLE IF NOT EXISTS warehouse_machines (
  id           uuid PRIMARY KEY,
  warehouse_id text NOT NULL,           -- Warehouse.id (text như packing_runs.warehouse_id)
  code         text NOT NULL,           -- tên/mã máy in trên tem (A, M1, AP…) — lưu UPPERCASE
  note         text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL
);
-- 1 kho không có 2 máy trùng tên (so không phân hoa thường — BE đã uppercase, index gác nốt đường ghi lạ)
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_machine_code ON warehouse_machines (warehouse_id, upper(code));
CREATE INDEX IF NOT EXISTS idx_warehouse_machines_wh ON warehouse_machines (warehouse_id);

-- RLS: đóng anon; authenticated ĐỌC được (bắt buộc cho realtime — memory realtime-rls-silent-death:
-- RLS bật + 0 policy SELECT = client không nhận sự kiện; RLS tắt = anon đọc được qua REST).
ALTER TABLE warehouse_machines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS warehouse_machines_read ON warehouse_machines;
CREATE POLICY warehouse_machines_read ON warehouse_machines FOR SELECT TO authenticated USING (true);

-- realtime cho form đang mở (đổi danh mục máy → dropdown tự cập nhật)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE warehouse_machines;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
