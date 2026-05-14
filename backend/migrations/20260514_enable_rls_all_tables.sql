-- ============================================================
-- Security: Enable RLS on all public tables
-- Apply: Supabase Dashboard → SQL Editor
-- ============================================================
-- Context:
--   Backend dùng service_role → bypass RLS hoàn toàn → không ảnh hưởng
--   Frontend anon key → CHỈ dùng cho Supabase Realtime (postgres_changes)
--   Anon cần SELECT để nhận realtime events; mọi write đều qua Express
-- ============================================================

-- ── 1. Bật RLS trên tất cả bảng ─────────────────────────────
ALTER TABLE "Warehouse"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Location"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Material"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Manufacturer"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Employee"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Department"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobTitle"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserWarehouseAccess"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportShift"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QAStatus"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductionImport"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryEntry"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GroupDeliveryOrder"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboundDelivery"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboundItem"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboundScanEntry"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LookupValue"           ENABLE ROW LEVEL SECURITY;

-- ── 2. Anon SELECT — cần thiết cho Supabase Realtime events ─
-- TODO khi implement auth: thay USING (true) bằng điều kiện theo user
CREATE POLICY "anon_select" ON "Warehouse"           FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "Location"            FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "Material"            FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "Manufacturer"        FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "Employee"            FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "Department"          FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "JobTitle"            FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "UserWarehouseAccess" FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "ImportShift"         FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "QAStatus"            FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "ProductionImport"    FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "InventoryEntry"      FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "GroupDeliveryOrder"  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "OutboundDelivery"    FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "OutboundItem"        FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "OutboundScanEntry"   FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select" ON "LookupValue"         FOR SELECT TO anon USING (true);

-- Không có INSERT/UPDATE/DELETE policy cho anon
-- → mọi ghi đều phải qua Express backend (service_role)

-- ── 3. Template cho bảng mới sau ngày 30/5/2026 ─────────────
-- Supabase sẽ không tự expose bảng mới vào Data API nữa.
-- Mỗi bảng mới trong public schema cần thêm 3 dòng này:
--
-- ALTER TABLE "TenBang" ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "anon_select" ON "TenBang" FOR SELECT TO anon USING (true);
-- GRANT SELECT, INSERT, UPDATE, DELETE ON "TenBang" TO service_role;
