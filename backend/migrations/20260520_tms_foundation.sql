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

-- Slot được generate từ backend API (POST /api/tms/slots/generate)
-- khi điều vận mở trang booking của một kế hoạch cụ thể.
-- Không dùng pg_cron.
