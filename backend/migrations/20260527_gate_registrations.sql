-- gate_registrations: Đăng ký xe tại cổng bảo vệ
-- Module tracking: vehicle arrival/departure with optional TmsOrder booking link

CREATE TABLE IF NOT EXISTS gate_registrations (
  id                  UUID         NOT NULL DEFAULT gen_random_uuid(),
  date                DATE         NOT NULL,
  registration_number INTEGER      NOT NULL,  -- Số thứ tự trong ngày (tự tăng per date)

  -- Thông tin lái xe (khai báo)
  driver_name         TEXT,
  phone               TEXT,

  -- ĐVVT / NCC (combobox — có thể dùng company_id hoặc gõ tự do)
  company_id          UUID,
  company_name_raw    TEXT,

  -- Xe (combobox — có thể dùng vehicle_id hoặc gõ tự do)
  vehicle_id          UUID,
  license_plate       TEXT,

  -- Hướng & Kho
  direction           TEXT         CHECK (direction IN ('OUTBOUND', 'INBOUND')),
  warehouse_id        TEXT         NOT NULL,
  warehouse_type      TEXT,
  vehicle_type        TEXT,

  -- Nội dung
  content             TEXT,
  return_pallet       BOOLEAN      NOT NULL DEFAULT false,
  seal_number         TEXT,
  notes               TEXT,

  -- Trạng thái
  status              TEXT         NOT NULL DEFAULT 'REGISTERED'
                      CHECK (status IN ('REGISTERED', 'CALLED', 'IN', 'COMPLETED')),
  priority            BOOLEAN      NOT NULL DEFAULT false,

  -- Action timestamps
  registered_at       TIMESTAMPTZ,
  registered_by       TEXT,
  called_at           TIMESTAMPTZ,
  called_by           TEXT,
  entry_at            TIMESTAMPTZ,
  entry_by            TEXT,
  exit_at             TIMESTAMPTZ,
  exit_by             TEXT,

  -- Tải trọng (điền khi xe ra sau khi cân)
  load_capacity       NUMERIC(10, 3),

  -- Link booking (nullable — xe không cần có booking)
  tms_order_id        UUID         REFERENCES "TmsOrder"(id) ON DELETE SET NULL,
  tms_vehicle_slot_id UUID         REFERENCES "TmsVehicleSlot"(id) ON DELETE SET NULL,

  -- Booking info denormalized để hiển thị nhanh (không cần join)
  booking_order_code  TEXT,
  booking_slot_from   TEXT,    -- "07:00"
  booking_slot_to     TEXT,    -- "08:00"

  -- Audit
  created_by          TEXT,
  updated_by          TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (date, registration_number)
);

CREATE INDEX IF NOT EXISTS idx_gate_reg_date         ON gate_registrations (date);
CREATE INDEX IF NOT EXISTS idx_gate_reg_warehouse    ON gate_registrations (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_gate_reg_tms_order    ON gate_registrations (tms_order_id);
CREATE INDEX IF NOT EXISTS idx_gate_reg_plate_date   ON gate_registrations (license_plate, date);

-- RLS: service role bypass (backend dùng service role)
ALTER TABLE gate_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_bypass" ON gate_registrations;
CREATE POLICY "service_role_bypass" ON gate_registrations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE gate_registrations;
