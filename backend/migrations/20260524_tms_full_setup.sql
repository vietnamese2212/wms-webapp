-- ─────────────────────────────────────────────────────────────────────────────
-- TMS Full Setup — Tạo toàn bộ TMS tables từ đầu (idempotent)
-- Chạy file này nếu các bảng TMS chưa được tạo đúng
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. VehicleType
CREATE TABLE IF NOT EXISTS "VehicleType" (
  id         UUID        NOT NULL DEFAULT gen_random_uuid(),
  code       TEXT        NOT NULL UNIQUE,
  name       TEXT        NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "VehicleType_pkey" PRIMARY KEY (id)
);

INSERT INTO "VehicleType" (id, code, name) VALUES
  (gen_random_uuid(), 'PALLET',       'Xe pallet'),
  (gen_random_uuid(), 'SCA',          'Xe SCA'),
  (gen_random_uuid(), 'XA',           'Xe xá'),
  (gen_random_uuid(), 'CONTAINER',    'Xe container'),
  (gen_random_uuid(), 'CONTAINER_XK', 'Xe container XK')
ON CONFLICT (code) DO NOTHING;

-- 2. SlotTemplate
CREATE TABLE IF NOT EXISTS "SlotTemplate" (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  vehicle_type_id UUID        NOT NULL REFERENCES "VehicleType"(id),
  direction       TEXT        NOT NULL CHECK (direction IN ('OUTBOUND','INBOUND')),
  cargo_type      TEXT        NOT NULL DEFAULT 'ALL',
  day_of_week     INTEGER     NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
  time_from       TIME        NOT NULL,
  time_to         TIME        NOT NULL,
  max_vehicles    INTEGER     NOT NULL DEFAULT 1,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "SlotTemplate_pkey" PRIMARY KEY (id)
);

-- 3. DeliverySlot
CREATE TABLE IF NOT EXISTS "DeliverySlot" (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  template_id     UUID        REFERENCES "SlotTemplate"(id),
  vehicle_type_id UUID        NOT NULL REFERENCES "VehicleType"(id),
  direction       TEXT        NOT NULL CHECK (direction IN ('OUTBOUND','INBOUND')),
  cargo_type      TEXT        NOT NULL DEFAULT 'ALL',
  date            DATE        NOT NULL,
  time_from       TIME        NOT NULL,
  time_to         TIME        NOT NULL,
  max_vehicles    INTEGER     NOT NULL,
  booked_count    INTEGER     NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','FULL')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "DeliverySlot_pkey" PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS "DeliverySlot_template_date_uidx"
  ON "DeliverySlot"(template_id, date) WHERE template_id IS NOT NULL;

-- 4. TransportCompany
CREATE TABLE IF NOT EXISTS "TransportCompany" (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  code          TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  contact_name  TEXT,
  contact_phone TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "TransportCompany_pkey" PRIMARY KEY (id)
);

-- 5. Vehicle (không IF NOT EXISTS vì bảng cũ đã bị drop)
CREATE TABLE IF NOT EXISTS "Vehicle" (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  ncc_id          UUID        NOT NULL REFERENCES "TransportCompany"(id),
  license_plate   TEXT        NOT NULL UNIQUE,
  vehicle_type_id UUID        NOT NULL REFERENCES "VehicleType"(id),
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Vehicle_pkey" PRIMARY KEY (id)
);

-- 6. Employee: thêm ncc_id + is_driver nếu chưa có
ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS ncc_id    UUID REFERENCES "TransportCompany"(id),
  ADD COLUMN IF NOT EXISTS is_driver BOOLEAN NOT NULL DEFAULT FALSE;

-- 7. DeliveryBooking
CREATE TABLE IF NOT EXISTS "DeliveryBooking" (
  id            TEXT        PRIMARY KEY,
  date          DATE        NOT NULL,
  warehouse_id  TEXT        NOT NULL REFERENCES "Warehouse"(id),
  ncc_id        UUID        REFERENCES "TransportCompany"(id),
  gdo_refs      TEXT,
  slot_id       UUID        REFERENCES "DeliverySlot"(id),
  license_plate TEXT,
  driver_name   TEXT,
  driver_phone  TEXT,
  npp_name      TEXT,
  box_count     INTEGER,
  pallet_count  INTEGER,
  tonnage       NUMERIC(10,3),
  warehouse_type TEXT,
  vehicle_type  TEXT,
  vehicle_code  TEXT,
  direction     TEXT        CHECK (direction IN ('OUTBOUND','INBOUND')),
  notes         TEXT,
  status        TEXT        NOT NULL DEFAULT 'PENDING',
  created_by    TEXT,
  updated_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_booking_vehicle_code
  ON "DeliveryBooking"(vehicle_code) WHERE vehicle_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_booking_date_wh ON "DeliveryBooking"(date, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_delivery_booking_ncc     ON "DeliveryBooking"(ncc_id);
CREATE INDEX IF NOT EXISTS idx_delivery_booking_slot    ON "DeliveryBooking"(slot_id);

-- ─── Permissions ─────────────────────────────────────────────────────────────
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'VehicleType','SlotTemplate','DeliverySlot',
    'TransportCompany','Vehicle','DeliveryBooking'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO anon, authenticated', tbl);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    BEGIN
      EXECUTE format('CREATE POLICY anon_select ON %I FOR SELECT TO anon USING (true)', tbl);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', tbl);
    EXCEPTION WHEN others THEN NULL;
    END;
  END LOOP;
END $$;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
