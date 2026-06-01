-- inbound_plan_lines: Kế hoạch nhập ngoài (NCC) theo từng dòng mã hàng
-- NV SAP nhập/upload kế hoạch → hệ thống tự gom tạo TmsOrder INBOUND
-- Grouping key: date + warehouse_id + warehouse_type + vehicle_type + ncc_id

CREATE TABLE IF NOT EXISTS inbound_plan_lines (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  date            DATE        NOT NULL,
  warehouse_id    TEXT        NOT NULL REFERENCES "Warehouse"(id),
  warehouse_type  TEXT,
  vehicle_type    TEXT,
  ncc_id          UUID        REFERENCES "TransportCompany"(id),
  material_id     TEXT        REFERENCES "Material"(id) ON DELETE SET NULL,
  po_number       TEXT,
  planned_boxes   INTEGER,
  planned_pallets INTEGER,
  tms_order_id    UUID        REFERENCES "TmsOrder"(id) ON DELETE SET NULL,
  created_by      TEXT,
  updated_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_plan_line_date_wh   ON inbound_plan_lines(date, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_plan_line_ncc        ON inbound_plan_lines(ncc_id);
CREATE INDEX IF NOT EXISTS idx_plan_line_tms_order  ON inbound_plan_lines(tms_order_id);
CREATE INDEX IF NOT EXISTS idx_plan_line_material   ON inbound_plan_lines(material_id);

ALTER TABLE inbound_plan_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_bypass" ON inbound_plan_lines
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "anon_all" ON inbound_plan_lines
  FOR ALL TO anon USING (true) WITH CHECK (true);

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE inbound_plan_lines;
EXCEPTION WHEN others THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
