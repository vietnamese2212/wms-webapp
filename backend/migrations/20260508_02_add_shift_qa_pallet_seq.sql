-- Migration: Add ImportShift, QAStatus, pallet_sequence_no, qa_status_id, shift_id
-- Date: 2026-05-08

-- 1. Ca nhập (Import Shift) master data
CREATE TABLE "ImportShift" (
  "id"            TEXT        NOT NULL PRIMARY KEY,
  "code"          TEXT        NOT NULL UNIQUE,
  "name"          TEXT        NOT NULL,
  "display_order" INTEGER     NOT NULL DEFAULT 0,
  "is_active"     BOOLEAN     NOT NULL DEFAULT true,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Tình trạng QA master data
CREATE TABLE "QAStatus" (
  "id"            TEXT        NOT NULL PRIMARY KEY,
  "code"          TEXT        NOT NULL UNIQUE,
  "name"          TEXT        NOT NULL,
  "display_order" INTEGER     NOT NULL DEFAULT 0,
  "is_active"     BOOLEAN     NOT NULL DEFAULT true,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Add new columns to InventoryEntry
ALTER TABLE "InventoryEntry"
  ADD COLUMN "pallet_sequence_no" INTEGER,
  ADD COLUMN "qa_status_id"       TEXT REFERENCES "QAStatus"("id") ON DELETE SET NULL;

-- 4. Add shift to ProductionImport
ALTER TABLE "ProductionImport"
  ADD COLUMN "shift_id" TEXT REFERENCES "ImportShift"("id") ON DELETE SET NULL;

-- 5. Seed ImportShift
INSERT INTO "ImportShift" ("id", "code", "name", "display_order", "updated_at") VALUES
  (gen_random_uuid()::TEXT, 'CA1', 'Ca 1', 1, now()),
  (gen_random_uuid()::TEXT, 'CA2', 'Ca 2', 2, now()),
  (gen_random_uuid()::TEXT, 'CA3', 'Ca 3', 3, now()),
  (gen_random_uuid()::TEXT, 'HC',  'HC',   4, now());

-- 6. Seed QAStatus
INSERT INTO "QAStatus" ("id", "code", "name", "display_order", "updated_at") VALUES
  (gen_random_uuid()::TEXT, 'X',   'X',          1, now()),
  (gen_random_uuid()::TEXT, 'XCQ', 'X cảm quan', 2, now()),
  (gen_random_uuid()::TEXT, 'X7',  'X 7',        3, now()),
  (gen_random_uuid()::TEXT, 'OK',  'OK',          4, now());

-- 7. Update employee Nguyễn Văn Quản Lý -> Kho BV
UPDATE "Employee"
SET "warehouse_id" = (SELECT "id" FROM "Warehouse" WHERE "code" = 'BV' LIMIT 1),
    "updated_at"   = now()
WHERE "name" = 'Nguyễn Văn Quản Lý';

-- 8. Enable Realtime for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE "ImportShift";
ALTER PUBLICATION supabase_realtime ADD TABLE "QAStatus";
