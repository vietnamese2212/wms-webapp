-- ============================================================
-- Rev 12: Outbound module schema
-- Apply: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. Alter InventoryEntry ───────────────────────────────────
-- cartons_imported: INT → DECIMAL (đơn vị thùng là decimal)
-- Add cartons_remaining: track pallet xuất lẻ (NULL = còn nguyên)

ALTER TABLE "InventoryEntry"
  ALTER COLUMN cartons_imported TYPE DECIMAL USING cartons_imported::DECIMAL;

ALTER TABLE "InventoryEntry"
  ADD COLUMN IF NOT EXISTS cartons_remaining DECIMAL;

-- ── 2. GroupDeliveryOrder (Số xe / chuyến xe) ────────────────
CREATE TABLE IF NOT EXISTS "GroupDeliveryOrder" (
  id             TEXT        NOT NULL PRIMARY KEY,
  group_code     TEXT        NOT NULL UNIQUE,  -- "090526_19"
  planned_date   DATE        NOT NULL,          -- parse từ prefix ddmmyy, cố định
  delivery_date  DATE        NOT NULL,          -- ngày xuất thực tế, có thể chỉnh
  warehouse_id   TEXT        REFERENCES "Warehouse"(id),
  dvvt           TEXT,                          -- "HA" (text tạm, sau link FK)
  status         TEXT        NOT NULL DEFAULT 'PENDING',
  -- PENDING | IN_PROGRESS | COMPLETED | CANCELLED
  created_at     TIMESTAMP   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP   NOT NULL
);

-- ── 3. DeliveryOrder (DO / Delivery từ SAP) ──────────────────
CREATE TABLE IF NOT EXISTS "DeliveryOrder" (
  id                TEXT        NOT NULL PRIMARY KEY,
  gdo_id            TEXT        NOT NULL REFERENCES "GroupDeliveryOrder"(id) ON DELETE CASCADE,
  delivery_code     TEXT        NOT NULL,        -- SAP Delivery "3000229833"
  distributor_name  TEXT,                         -- Tên NPP (text tạm)
  status            TEXT        NOT NULL DEFAULT 'PENDING',
  created_at        TIMESTAMP   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP   NOT NULL
);

-- ── 4. DeliveryOrderItem (1 dòng = 1 mã hàng) ────────────────
CREATE TABLE IF NOT EXISTS "DeliveryOrderItem" (
  id                  TEXT        NOT NULL PRIMARY KEY,
  do_id               TEXT        NOT NULL REFERENCES "DeliveryOrder"(id) ON DELETE CASCADE,
  material_id         TEXT        REFERENCES "Material"(id),
  material_code_raw   TEXT,                       -- fallback nếu chưa match được material_id
  cartons_ordered     DECIMAL     NOT NULL DEFAULT 0,
  boxes_display       DECIMAL     NOT NULL DEFAULT 0,   -- Hộp, hiển thị thôi
  weight              DECIMAL,
  loose_picking       DECIMAL     NOT NULL DEFAULT 0,
  pallets_estimated   DECIMAL     NOT NULL DEFAULT 0,
  material_type       TEXT,                       -- "Thành phẩm" | "POSM" | "Pallet Loscam"
  export_type         TEXT,                       -- "Xe Pallet"
  header_text         TEXT,
  batch_required      TEXT,
  date_required       DATE,
  cs_responsible      TEXT,
  cartons_scanned     DECIMAL     NOT NULL DEFAULT 0,   -- tịnh tiến
  status              TEXT        NOT NULL DEFAULT 'PENDING',
  -- PENDING | IN_PROGRESS | COMPLETED
  created_at          TIMESTAMP   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP   NOT NULL
);

-- ── 5. OutboundScanEntry (log từng lần scan QR) ───────────────
CREATE TABLE IF NOT EXISTS "OutboundScanEntry" (
  id                  TEXT        NOT NULL PRIMARY KEY,
  item_id             TEXT        NOT NULL REFERENCES "DeliveryOrderItem"(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_do_gdo_id            ON "DeliveryOrder"(gdo_id);
CREATE INDEX IF NOT EXISTS idx_doi_do_id            ON "DeliveryOrderItem"(do_id);
CREATE INDEX IF NOT EXISTS idx_doi_material_id      ON "DeliveryOrderItem"(material_id);
CREATE INDEX IF NOT EXISTS idx_ose_item_id          ON "OutboundScanEntry"(item_id);
CREATE INDEX IF NOT EXISTS idx_ose_inventory_entry  ON "OutboundScanEntry"(inventory_entry_id);
