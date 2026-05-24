-- Bảng Vehicle cũ có schema khác (plate_number, type, capacity_tons...)
-- Drop và tạo lại đúng schema TMS

DROP TABLE IF EXISTS "Vehicle" CASCADE;

CREATE TABLE "Vehicle" (
  id              UUID        NOT NULL,
  ncc_id          UUID        NOT NULL REFERENCES "TransportCompany"(id),
  license_plate   TEXT        NOT NULL UNIQUE,
  vehicle_type_id UUID        NOT NULL REFERENCES "VehicleType"(id),
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Vehicle_pkey" PRIMARY KEY (id)
);

-- Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON "Vehicle" TO anon, authenticated;

-- RLS
ALTER TABLE "Vehicle" ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_select ON "Vehicle" FOR SELECT TO anon USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE "Vehicle";

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
