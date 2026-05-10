-- Rev 14: Customer master table (NPP / đại lý / khách hàng)
-- Apply via Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS "Customer" (
  id              TEXT        PRIMARY KEY,
  customer_code   TEXT        UNIQUE NOT NULL,
  name            TEXT        NOT NULL,
  short_name      TEXT,
  address         TEXT,
  province        TEXT,
  region          TEXT,        -- "Miền Bắc" | "Miền Trung" | "Miền Nam"
  phone           TEXT,
  notes           TEXT,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL
);
