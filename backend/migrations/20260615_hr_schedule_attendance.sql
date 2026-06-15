-- ============================================================
-- HR: Lịch làm việc (Phân công) + Chấm công + Skill + Nghỉ phép
-- Apply: Supabase Dashboard → SQL Editor
-- ============================================================
-- Bối cảnh:
--   - Skill (Vị trí phân công / kỹ năng) theo phòng ban
--   - EmployeeSkill: bộ skill của NV, có ưu tiên (1 = sở trường chính)
--   - LeaveRequest: nghỉ phép (loại khỏi auto-assign khi APPROVED)
--   - WorkAssignmentSheet/Demand/Assignment: phiếu phân công 1 ngày/1 phòng
--   - Attendance: NV tự khai chấm công (tách rời phân công)
--   - Department.requires_scheduling: phòng có dùng phân công hay không
--   Event trigger auto_realtime_new_tables tự thêm bảng mới vào publication.
--   Cần RLS + anon SELECT để Realtime gửi event tới frontend (anon key).
-- ============================================================

-- ── 0. Department: cờ dùng phân công ────────────────────────
ALTER TABLE "Department"
  ADD COLUMN IF NOT EXISTS requires_scheduling BOOLEAN NOT NULL DEFAULT false;

-- ── 1. Skill (Vị trí phân công / kỹ năng) ───────────────────
CREATE TABLE IF NOT EXISTS "Skill" (
  id            TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES "Department"(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                 -- "Pallet", "SCA", "SX", "Cont 1"
  shift_tag     TEXT,                           -- 'CA1' | 'CA2' | 'CA3' | 'HC' | NULL
  sort_order    INT  NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT,
  updated_by    TEXT
);
CREATE INDEX IF NOT EXISTS idx_skill_dept ON "Skill"(department_id);

-- ── 2. EmployeeSkill (bộ skill NV, có ưu tiên) ──────────────
CREATE TABLE IF NOT EXISTS "EmployeeSkill" (
  id          TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES "Employee"(id) ON DELETE CASCADE,
  skill_id    TEXT NOT NULL REFERENCES "Skill"(id) ON DELETE CASCADE,
  priority    INT  NOT NULL DEFAULT 1,          -- 1 = sở trường chính
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_empskill_emp   ON "EmployeeSkill"(employee_id);
CREATE INDEX IF NOT EXISTS idx_empskill_skill ON "EmployeeSkill"(skill_id);

-- ── 3. LeaveRequest (nghỉ phép) ─────────────────────────────
CREATE TABLE IF NOT EXISTS "LeaveRequest" (
  id          TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES "Employee"(id) ON DELETE CASCADE,
  date_from   DATE NOT NULL,
  date_to     DATE NOT NULL,
  leave_type  TEXT NOT NULL DEFAULT 'ANNUAL',   -- ANNUAL | SICK | UNPAID | OTHER
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | REJECTED
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  updated_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_leave_emp  ON "LeaveRequest"(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_date ON "LeaveRequest"(date_from, date_to);

-- ── 4. WorkAssignmentSheet (phiếu phân công 1 ngày / 1 phòng) ─
CREATE TABLE IF NOT EXISTS "WorkAssignmentSheet" (
  id            TEXT PRIMARY KEY,
  work_date     DATE NOT NULL,
  department_id TEXT NOT NULL REFERENCES "Department"(id),
  status        TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT | PUBLISHED
  note          TEXT,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT,
  updated_by    TEXT,
  UNIQUE(work_date, department_id)
);

-- ── 5. WorkAssignmentDemand (dòng yêu cầu trong phiếu) ──────
CREATE TABLE IF NOT EXISTS "WorkAssignmentDemand" (
  id             TEXT PRIMARY KEY,
  sheet_id       TEXT NOT NULL REFERENCES "WorkAssignmentSheet"(id) ON DELETE CASCADE,
  skill_id       TEXT NOT NULL REFERENCES "Skill"(id),
  required_count INT  NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_demand_sheet ON "WorkAssignmentDemand"(sheet_id);

-- ── 6. WorkAssignment (kết quả xếp người) ───────────────────
CREATE TABLE IF NOT EXISTS "WorkAssignment" (
  id          TEXT PRIMARY KEY,
  sheet_id    TEXT NOT NULL REFERENCES "WorkAssignmentSheet"(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES "Employee"(id),
  skill_id    TEXT REFERENCES "Skill"(id),       -- NULL = nghỉ phép / chưa phân
  status      TEXT NOT NULL DEFAULT 'ASSIGNED',  -- ASSIGNED | LEAVE | UNASSIGNED
  is_manual   BOOLEAN NOT NULL DEFAULT false,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assignment_sheet ON "WorkAssignment"(sheet_id);

-- ── 7. Attendance (NV tự khai chấm công) ────────────────────
CREATE TABLE IF NOT EXISTS "Attendance" (
  id                TEXT PRIMARY KEY,
  employee_id       TEXT NOT NULL REFERENCES "Employee"(id) ON DELETE CASCADE,
  work_date         DATE NOT NULL,
  kind              TEXT NOT NULL,               -- CA1 | CA2 | CA3 | HC | LEAVE
  ot_hours          NUMERIC(4,1) NOT NULL DEFAULT 0,
  early_leave_hours NUMERIC(4,1) NOT NULL DEFAULT 0,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_emp  ON "Attendance"(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON "Attendance"(work_date);

-- ── 7b. Scope theo Kho (warehouse_id) — phân biệt Kho mọi module ─
-- Skill = vị trí làm việc của 1 Kho + phòng ban (khu vực vật lý theo plant)
ALTER TABLE "Skill"               ADD COLUMN IF NOT EXISTS warehouse_id TEXT REFERENCES "Warehouse"(id) ON DELETE CASCADE;
-- Phiếu phân công = 1 Kho + phòng + ngày
ALTER TABLE "WorkAssignmentSheet" ADD COLUMN IF NOT EXISTS warehouse_id TEXT REFERENCES "Warehouse"(id);
ALTER TABLE "LeaveRequest"        ADD COLUMN IF NOT EXISTS warehouse_id TEXT REFERENCES "Warehouse"(id);
ALTER TABLE "Attendance"          ADD COLUMN IF NOT EXISTS warehouse_id TEXT REFERENCES "Warehouse"(id);
CREATE INDEX IF NOT EXISTS idx_skill_wh      ON "Skill"(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_sheet_wh      ON "WorkAssignmentSheet"(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_attendance_wh ON "Attendance"(warehouse_id);
-- Phiếu phân công duy nhất theo (ngày, kho, phòng)
ALTER TABLE "WorkAssignmentSheet" DROP CONSTRAINT IF EXISTS "WorkAssignmentSheet_work_date_department_id_key";
DO $$ BEGIN
  ALTER TABLE "WorkAssignmentSheet" ADD CONSTRAINT uq_sheet_date_wh_dept UNIQUE (work_date, warehouse_id, department_id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

-- ── 8. RLS + anon SELECT (cho Realtime) ─────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Skill','EmployeeSkill','LeaveRequest',
    'WorkAssignmentSheet','WorkAssignmentDemand','WorkAssignment','Attendance'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('CREATE POLICY "anon_select" ON %I FOR SELECT TO anon USING (true)', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;
