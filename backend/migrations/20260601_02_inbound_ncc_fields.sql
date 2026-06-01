-- ProductionImport: bổ sung fields cho nhập hàng NCC (nhập ngoài)
-- source_type        : FACTORY (nhập sản xuất, mặc định) | NCC (nhập ngoài từ xe)
-- gate_registration_id: FK → gate_registrations (biển số xe đăng ký cổng)
-- tms_order_id       : FK → TmsOrder INBOUND (link về SAP plan, nullable = phát sinh)
-- planned_cartons    : số thùng dự kiến do thủ kho nhập khi mở xe

ALTER TABLE "ProductionImport"
  ADD COLUMN IF NOT EXISTS source_type          TEXT    NOT NULL DEFAULT 'FACTORY'
                            CHECK (source_type IN ('FACTORY', 'NCC')),
  ADD COLUMN IF NOT EXISTS gate_registration_id UUID    REFERENCES gate_registrations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tms_order_id         UUID    REFERENCES "TmsOrder"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS planned_cartons      INTEGER;

CREATE INDEX IF NOT EXISTS idx_import_source_type   ON "ProductionImport"(source_type);
CREATE INDEX IF NOT EXISTS idx_import_gate_reg      ON "ProductionImport"(gate_registration_id);
CREATE INDEX IF NOT EXISTS idx_import_tms_order     ON "ProductionImport"(tms_order_id);

NOTIFY pgrst, 'reload schema';
