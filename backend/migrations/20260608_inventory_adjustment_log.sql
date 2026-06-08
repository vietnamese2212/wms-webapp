-- Audit log cho mỗi lần điều chỉnh tồn kho (tăng/giảm thủ công)
CREATE TABLE "InventoryAdjustmentLog" (
  id             UUID PRIMARY KEY,
  entry_id       UUID NOT NULL REFERENCES "InventoryEntry"(id) ON DELETE CASCADE,
  delta          INTEGER NOT NULL,          -- dương = thêm, âm = bớt
  cartons_before INTEGER NOT NULL,
  cartons_after  INTEGER NOT NULL,
  note           TEXT,                      -- lý do điều chỉnh
  actor_name     TEXT,                      -- tên người thực hiện
  actor_id       UUID REFERENCES "Employee"(id) ON DELETE SET NULL,
  adjusted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON "InventoryAdjustmentLog"(entry_id);

-- RLS: service role full access, anon read-only
ALTER TABLE "InventoryAdjustmentLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all"  ON "InventoryAdjustmentLog" TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_select"  ON "InventoryAdjustmentLog" FOR SELECT TO anon USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE "InventoryAdjustmentLog";
