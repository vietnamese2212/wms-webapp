-- ============================================================
-- Security: Enable RLS trên các bảng còn sót (TMS / HR / misc)
-- Apply: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. Bật RLS ───────────────────────────────────────────────
ALTER TABLE "Attendance"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryOrder"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Driver"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExportHistory"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LocationTransfer"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Menu"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OvertimeRequest"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Schedule"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Setting"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shift"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vehicle"           ENABLE ROW LEVEL SECURITY;

-- _prisma_migrations: internal table, chặn hoàn toàn (không tạo anon policy)
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- ── 2. Anon SELECT ───────────────────────────────────────────
CREATE POLICY "anon_select" ON "Attendance"        FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "DeliveryOrder"     FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "Driver"            FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "ExportHistory"     FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "LocationTransfer"  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "Menu"              FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "OvertimeRequest"   FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "Schedule"          FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "Setting"           FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "Shift"             FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "Vehicle"           FOR SELECT TO anon USING (true);

-- _prisma_migrations: không tạo policy → anon không đọc được
