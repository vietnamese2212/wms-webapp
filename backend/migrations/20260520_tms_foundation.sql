-- ─────────────────────────────────────────────────────────────────────────────
-- TMS Phase 1 — Foundation
-- Tables: VehicleType, SlotTemplate, DeliverySlot, TransportCompany, Vehicle
-- Extend: Employee + ncc_id + is_driver
-- pg_cron: generate_slots_ahead(30) chạy hàng ngày 23:00 VN (16:00 UTC)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. VehicleType (Loại xe)
CREATE TABLE IF NOT EXISTS "VehicleType" (
  id          UUID        NOT NULL,
  code        TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "VehicleType_pkey" PRIMARY KEY (id)
);

INSERT INTO "VehicleType" (id, code, name) VALUES
  (gen_random_uuid(), 'PALLET',       'Xe pallet'),
  (gen_random_uuid(), 'SCA',          'Xe SCA'),
  (gen_random_uuid(), 'XA',           'Xe xá'),
  (gen_random_uuid(), 'CONTAINER',    'Xe container'),
  (gen_random_uuid(), 'CONTAINER_XK', 'Xe container XK')
ON CONFLICT (code) DO NOTHING;

-- 2. SlotTemplate (Template khung giờ T2→T7 theo loại xe)
CREATE TABLE IF NOT EXISTS "SlotTemplate" (
  id              UUID        NOT NULL,
  vehicle_type_id UUID        NOT NULL REFERENCES "VehicleType"(id),
  direction       TEXT        NOT NULL CHECK (direction IN ('OUTBOUND','INBOUND')),
  cargo_type      TEXT        NOT NULL DEFAULT 'ALL',  -- TP | NVL | POSM | ALL
  day_of_week     INTEGER     NOT NULL CHECK (day_of_week BETWEEN 1 AND 6), -- 1=T2 … 6=T7
  time_from       TIME        NOT NULL,
  time_to         TIME        NOT NULL,
  max_vehicles    INTEGER     NOT NULL DEFAULT 1,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "SlotTemplate_pkey" PRIMARY KEY (id)
);

-- 3. DeliverySlot (Slot thực tế theo ngày — auto-generate từ template)
CREATE TABLE IF NOT EXISTS "DeliverySlot" (
  id              UUID        NOT NULL,
  template_id     UUID        REFERENCES "SlotTemplate"(id),  -- NULL nếu tạo thủ công
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

-- Không tạo duplicate slot cùng template + ngày
CREATE UNIQUE INDEX IF NOT EXISTS "DeliverySlot_template_date_uidx"
  ON "DeliverySlot"(template_id, date)
  WHERE template_id IS NOT NULL;

-- 4. TransportCompany (ĐVVT / NCC)
CREATE TABLE IF NOT EXISTS "TransportCompany" (
  id            UUID        NOT NULL,
  code          TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  contact_name  TEXT,
  contact_phone TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "TransportCompany_pkey" PRIMARY KEY (id)
);

-- 5. Vehicle (Xe — thuộc NCC + có loại xe)
CREATE TABLE IF NOT EXISTS "Vehicle" (
  id              UUID        NOT NULL,
  ncc_id          UUID        NOT NULL REFERENCES "TransportCompany"(id),
  license_plate   TEXT        NOT NULL UNIQUE,
  vehicle_type_id UUID        NOT NULL REFERENCES "VehicleType"(id),
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Vehicle_pkey" PRIMARY KEY (id)
);

-- 6. Extend Employee
ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS ncc_id    UUID REFERENCES "TransportCompany"(id),
  ADD COLUMN IF NOT EXISTS is_driver BOOLEAN NOT NULL DEFAULT FALSE;

-- ─────────────────────────────────────────────────────────────────────────────
-- pg_cron: auto-generate DeliverySlot 30 ngày tới từ SlotTemplate
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION generate_slots_ahead(days_ahead INTEGER DEFAULT 30)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_date   DATE;
  v_dow    INTEGER;
  v_count  INTEGER := 0;
  rec      RECORD;
BEGIN
  FOR v_date IN
    SELECT d::DATE
    FROM generate_series(CURRENT_DATE, CURRENT_DATE + days_ahead, INTERVAL '1 day') d
  LOOP
    v_dow := EXTRACT(ISODOW FROM v_date); -- 1=Mon…7=Sun
    IF v_dow = 7 THEN CONTINUE; END IF;  -- bỏ Chủ nhật

    FOR rec IN
      SELECT * FROM "SlotTemplate" WHERE is_active = TRUE AND day_of_week = v_dow
    LOOP
      INSERT INTO "DeliverySlot" (
        id, template_id, vehicle_type_id, direction, cargo_type,
        date, time_from, time_to, max_vehicles, booked_count, status,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), rec.id, rec.vehicle_type_id, rec.direction, rec.cargo_type,
        v_date, rec.time_from, rec.time_to, rec.max_vehicles, 0, 'OPEN',
        NOW(), NOW()
      )
      ON CONFLICT (template_id, date) WHERE template_id IS NOT NULL DO NOTHING;
      v_count := v_count + 1;
    END LOOP;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Kích hoạt pg_cron: chạy hàng ngày lúc 23:00 VN (16:00 UTC)
-- Nếu pg_cron chưa được enable, chạy: CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'tms-generate-slots',
  '0 16 * * *',
  $$SELECT generate_slots_ahead(30)$$
);
