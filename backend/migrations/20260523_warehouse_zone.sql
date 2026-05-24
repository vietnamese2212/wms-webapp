-- Create WarehouseZone table for managing physical zones within a warehouse
CREATE TABLE IF NOT EXISTS "WarehouseZone" (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id TEXT         NOT NULL REFERENCES "Warehouse"(id) ON DELETE CASCADE,
  code         VARCHAR(20)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  sort_order   INT          NOT NULL DEFAULT 0,
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(warehouse_id, code)
);

ALTER TABLE "WarehouseZone" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select" ON "WarehouseZone";
CREATE POLICY "anon_select" ON "WarehouseZone" FOR SELECT TO anon USING (true);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'WarehouseZone'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "WarehouseZone";
  END IF;
END $$;
