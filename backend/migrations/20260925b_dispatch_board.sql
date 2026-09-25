-- ĐIỀU VẬN v2 — bàn ghép xe kéo thả + pool lũy tiến + OD bị SO sửa thay (user chốt 25/09/2026).
--
-- (1) dispatch_trip_od có KHUNG CHỜ: `trip_id` NULL = OD nằm trong kế hoạch nhưng chưa lên xe nào (người kéo ra khỏi
--     xe, hoặc OD mới về sau khi đã lập). Vì trip_id có thể NULL nên dòng phải mang `plan_id` riêng.
--     Mang thêm điều kiện bảo quản + tải theo loại kho của từng OD để khi OD di chuyển, chuyến đích tính lại được
--     điều kiện bảo quản và cửa đặt lịch (booking_category) từ chính các OD của nó — bản cũ đọc lại từ `detail`
--     lúc máy lập nên chuyển OD xong hai thứ đó đứng yên.
--     `late_days` = OD tồn đọng (ngày giao trước ngày lập, chưa điều, chưa đi hàng) — user chốt gộp vào.
-- (2) dispatch_trip.locked — khoá xe để "Tối ưu lại phần chưa khoá" không đụng vào.
-- (3) erp_outbound_orders.replaced_by_od — SAP sửa SO thì bỏ OD cũ, sinh OD mới cho cùng dòng SO. File ZSD02 sau
--     đó KHÔNG còn OD cũ, mà cửa nạp để nguyên OD "vắng cả OD" (mơ hồ) ⇒ OD cũ vẫn ACTIVE ⇒ một đơn có thể lên xe
--     hai lần. Nay cửa nạp đánh dấu OBSOLETE + OD thay thế khi có bằng chứng: cùng (SO, item) có OD mới trong file.

BEGIN;

ALTER TABLE dispatch_trip_od ADD COLUMN IF NOT EXISTS plan_id uuid;
UPDATE dispatch_trip_od o SET plan_id = t.plan_id FROM dispatch_trip t WHERE t.id = o.trip_id AND o.plan_id IS NULL;
ALTER TABLE dispatch_trip_od ALTER COLUMN plan_id SET NOT NULL;
ALTER TABLE dispatch_trip_od ALTER COLUMN trip_id DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_trip_od_plan_id_fkey') THEN
    ALTER TABLE dispatch_trip_od ADD CONSTRAINT dispatch_trip_od_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES dispatch_plan(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_dispatch_trip_od_plan ON dispatch_trip_od (plan_id);

ALTER TABLE dispatch_trip_od ADD COLUMN IF NOT EXISTS conditions text[] NOT NULL DEFAULT '{}';
ALTER TABLE dispatch_trip_od ADD COLUMN IF NOT EXISTS cat_load jsonb;          -- {loại kho: pallet + kg/1e6} — nguồn booking_category
ALTER TABLE dispatch_trip_od ADD COLUMN IF NOT EXISTS region_code text;
ALTER TABLE dispatch_trip_od ADD COLUMN IF NOT EXISTS delivery_date date;
ALTER TABLE dispatch_trip_od ADD COLUMN IF NOT EXISTS late_days integer NOT NULL DEFAULT 0;

ALTER TABLE dispatch_trip ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;

ALTER TABLE erp_outbound_orders ADD COLUMN IF NOT EXISTS replaced_by_od text;
ALTER TABLE erp_outbound_orders ADD COLUMN IF NOT EXISTS replaced_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_erp_ob_so_item_active ON erp_outbound_orders (so_number, so_item) WHERE sync_status = 'ACTIVE';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM dispatch_trip_od WHERE plan_id IS NULL) THEN RAISE EXCEPTION 'dispatch_trip_od còn dòng thiếu plan_id'; END IF;
END $$;

COMMIT;
