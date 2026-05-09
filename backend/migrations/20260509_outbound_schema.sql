-- ============================================================
-- Rev 12: Outbound module schema
-- Apply: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. Alter InventoryEntry ───────────────────────────────────
ALTER TABLE "InventoryEntry"
  ALTER COLUMN cartons_imported TYPE DECIMAL USING cartons_imported::DECIMAL;

ALTER TABLE "InventoryEntry"
  ADD COLUMN IF NOT EXISTS cartons_remaining DECIMAL;

-- ── 2. GroupDeliveryOrder (Số xe / chuyến xe) ────────────────
CREATE TABLE IF NOT EXISTS "GroupDeliveryOrder" (
  id             TEXT        NOT NULL PRIMARY KEY,
  group_code     TEXT        NOT NULL UNIQUE,
  planned_date   DATE        NOT NULL,
  delivery_date  DATE        NOT NULL,
  warehouse_id   TEXT        REFERENCES "Warehouse"(id),
  dvvt           TEXT,
  status         TEXT        NOT NULL DEFAULT 'PENDING',
  created_at     TIMESTAMP   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP   NOT NULL
);

-- ── 3. OutboundDelivery (DO / Delivery từ SAP) ───────────────
-- Đặt tên OutboundDelivery để tránh xung đột với bảng DeliveryOrder của TMS
CREATE TABLE IF NOT EXISTS "OutboundDelivery" (
  id                TEXT        NOT NULL PRIMARY KEY,
  gdo_id            TEXT        NOT NULL REFERENCES "GroupDeliveryOrder"(id) ON DELETE CASCADE,
  delivery_code     TEXT        NOT NULL,
  distributor_name  TEXT,
  status            TEXT        NOT NULL DEFAULT 'PENDING',
  created_at        TIMESTAMP   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP   NOT NULL
);

-- ── 4. OutboundItem (1 dòng = 1 mã hàng) ─────────────────────
CREATE TABLE IF NOT EXISTS "OutboundItem" (
  id                  TEXT        NOT NULL PRIMARY KEY,
  do_id               TEXT        NOT NULL REFERENCES "OutboundDelivery"(id) ON DELETE CASCADE,
  material_id         TEXT        REFERENCES "Material"(id),
  material_code_raw   TEXT,
  cartons_ordered     DECIMAL     NOT NULL DEFAULT 0,
  boxes_display       DECIMAL     NOT NULL DEFAULT 0,
  weight              DECIMAL,
  loose_picking       DECIMAL     NOT NULL DEFAULT 0,
  pallets_estimated   DECIMAL     NOT NULL DEFAULT 0,
  material_type       TEXT,
  export_type         TEXT,
  header_text         TEXT,
  batch_required      TEXT,
  date_required       DATE,
  cs_responsible      TEXT,
  cartons_scanned     DECIMAL     NOT NULL DEFAULT 0,
  status              TEXT        NOT NULL DEFAULT 'PENDING',
  created_at          TIMESTAMP   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP   NOT NULL
);

-- ── 5. OutboundScanEntry (log từng lần scan QR) ───────────────
CREATE TABLE IF NOT EXISTS "OutboundScanEntry" (
  id                  TEXT        NOT NULL PRIMARY KEY,
  item_id             TEXT        NOT NULL REFERENCES "OutboundItem"(id) ON DELETE CASCADE,
  inventory_entry_id  TEXT        REFERENCES "InventoryEntry"(id),
  pallet_code         TEXT        NOT NULL,
  cartons_scanned     DECIMAL     NOT NULL,
  scanned_by          TEXT        REFERENCES "Employee"(id),
  scanned_at          TIMESTAMP   NOT NULL DEFAULT now(),
  created_at          TIMESTAMP   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP   NOT NULL
);

-- ── 6. Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_gdo_delivery_date    ON "GroupDeliveryOrder"(delivery_date);
CREATE INDEX IF NOT EXISTS idx_gdo_status           ON "GroupDeliveryOrder"(status);
CREATE INDEX IF NOT EXISTS idx_obd_gdo_id           ON "OutboundDelivery"(gdo_id);
CREATE INDEX IF NOT EXISTS idx_obi_do_id            ON "OutboundItem"(do_id);
CREATE INDEX IF NOT EXISTS idx_obi_material_id      ON "OutboundItem"(material_id);
CREATE INDEX IF NOT EXISTS idx_ose_item_id          ON "OutboundScanEntry"(item_id);
CREATE INDEX IF NOT EXISTS idx_ose_inventory_entry  ON "OutboundScanEntry"(inventory_entry_id);
