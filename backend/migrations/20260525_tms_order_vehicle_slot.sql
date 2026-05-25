-- TMS Refactor: tách DeliveryBooking → TmsOrder + TmsVehicleSlot
-- Điều vận upload đơn hàng vào TmsOrder
-- Mỗi đơn có 1..N TmsVehicleSlot (mặc định 1, thêm cho xe bốc cùng)

-- 1. Xoá dữ liệu test cũ (toàn bộ là test data)
DROP TABLE IF EXISTS "DeliveryBooking" CASCADE;

-- 2. TmsOrder — kế hoạch do điều vận tạo (1 dòng Excel = 1 row)
CREATE TABLE IF NOT EXISTS "TmsOrder" (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code      TEXT        NOT NULL UNIQUE,          -- mã đơn vd: 240526_BV_1
  date            DATE        NOT NULL,
  warehouse_id    TEXT        NOT NULL REFERENCES "Warehouse"(id),
  ncc_id          UUID        REFERENCES "TransportCompany"(id),
  npp_name        TEXT,
  vehicle_type    TEXT,                                 -- tên loại xe (denorm)
  direction       TEXT        CHECK (direction IN ('OUTBOUND','INBOUND')),
  warehouse_type  TEXT,
  planned_boxes   INTEGER,
  planned_pallets INTEGER,
  planned_tons    NUMERIC(10,3),
  gdo_refs        TEXT,
  notes           TEXT,
  status          TEXT        NOT NULL DEFAULT 'PENDING',
  created_by      TEXT,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tms_order_date_wh ON "TmsOrder"(date, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_tms_order_ncc     ON "TmsOrder"(ncc_id);

-- 3. TmsVehicleSlot — 1 xe thực tế bốc đơn (mặc định 1 per order)
CREATE TABLE IF NOT EXISTS "TmsVehicleSlot" (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID        NOT NULL REFERENCES "TmsOrder"(id) ON DELETE CASCADE,
  slot_id       UUID        REFERENCES "DeliverySlot"(id),
  license_plate TEXT,
  driver_name   TEXT,
  driver_phone  TEXT,
  status        TEXT        NOT NULL DEFAULT 'PENDING',   -- PENDING|BOOKED|ARRIVED|DONE|CANCELLED
  booked_by     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tms_vslot_order  ON "TmsVehicleSlot"(order_id);
CREATE INDEX IF NOT EXISTS idx_tms_vslot_slot   ON "TmsVehicleSlot"(slot_id);

-- 4. Permissions + RLS + Realtime
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['TmsOrder','TmsVehicleSlot'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO anon, authenticated', tbl);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    BEGIN
      EXECUTE format('CREATE POLICY anon_all ON %I FOR ALL TO anon USING (true) WITH CHECK (true)', tbl);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', tbl);
    EXCEPTION WHEN others THEN NULL;
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
