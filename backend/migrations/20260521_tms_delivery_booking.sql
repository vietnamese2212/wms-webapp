-- TMS Phase 2 — Bảng kế hoạch vận chuyển
-- Điều vận tạo dòng, ĐVVT chọn slot + điền xe

CREATE TABLE IF NOT EXISTS "DeliveryBooking" (
  id              TEXT PRIMARY KEY,
  date            DATE NOT NULL,
  warehouse_id    TEXT NOT NULL REFERENCES "Warehouse"(id),
  ncc_id          UUID NOT NULL REFERENCES "TransportCompany"(id),
  gdo_refs        TEXT,
  slot_id         UUID REFERENCES "DeliverySlot"(id),
  license_plate   TEXT,
  driver_name     TEXT,
  driver_phone    TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING',
  created_by      TEXT,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_delivery_booking_date_wh  ON "DeliveryBooking"(date, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_delivery_booking_ncc      ON "DeliveryBooking"(ncc_id);
CREATE INDEX IF NOT EXISTS idx_delivery_booking_slot     ON "DeliveryBooking"(slot_id);
