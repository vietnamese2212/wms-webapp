-- ─── Permission System — rev 11 ───────────────────────────────────────────────
-- Tạo: Department, JobTitle, UserWarehouseAccess
-- Mở rộng: Employee thêm action_level, allowed_categories, warehouse_scope
-- Giữ nguyên: role, warehouse_id (backward compat)

-- ─── 1. Department ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Department" (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  code            TEXT UNIQUE NOT NULL,
  allowed_modules TEXT[] NOT NULL DEFAULT '{}',
  is_active       BOOL  NOT NULL DEFAULT true,
  created_at      TIMESTAMP NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP NOT NULL DEFAULT now()
);

-- Seed — dùng ID ngắn cố định để JobTitle seed tham chiếu được
INSERT INTO "Department" (id, name, code, allowed_modules) VALUES
  ('dept-kho',      'Kho',       'KHO',      ARRAY['inbound','outbound','inventory','reports']),
  ('dept-qa',       'QA',        'QA',        ARRAY['inventory','reports']),
  ('dept-dieu-van', 'Điều vận',  'DIEU_VAN',  ARRAY['outbound','reports']),
  ('dept-admin',    'Quản lý',   'QUAN_LY',   ARRAY['inbound','outbound','inventory','reports','admin'])
ON CONFLICT (id) DO NOTHING;

-- ─── 2. JobTitle (chức danh template) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "JobTitle" (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  department_id       TEXT REFERENCES "Department"(id),
  action_level        TEXT NOT NULL
    CHECK (action_level IN ('NATIONAL_MANAGER','SITE_MANAGER','SUPERVISOR','OPERATOR','STAFF','VIEWER')),
  allowed_categories  TEXT[] NOT NULL DEFAULT ARRAY['TP','NVL','POSM','BAO_BI'],
  warehouse_scope     TEXT NOT NULL DEFAULT 'ASSIGNED'
    CHECK (warehouse_scope IN ('NATIONAL','ASSIGNED')),
  is_active           BOOL NOT NULL DEFAULT true,
  created_at          TIMESTAMP NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP NOT NULL DEFAULT now()
);

-- Seed chức danh — Phòng Kho
INSERT INTO "JobTitle" (id, name, department_id, action_level, allowed_categories, warehouse_scope) VALUES
  ('jt-ql-tq',      'Quản lý kho toàn quốc', 'dept-kho', 'NATIONAL_MANAGER', ARRAY['TP','NVL','POSM','BAO_BI'], 'NATIONAL'),
  ('jt-ql-site',    'Quản lý kho site',       'dept-kho', 'SITE_MANAGER',     ARRAY['TP','NVL','POSM','BAO_BI'], 'ASSIGNED'),
  ('jt-gs-tp',      'Giám sát kho TP',        'dept-kho', 'SUPERVISOR',       ARRAY['TP'],                       'ASSIGNED'),
  ('jt-gs-nvl',     'Giám sát kho NVL',       'dept-kho', 'SUPERVISOR',       ARRAY['NVL'],                      'ASSIGNED'),
  ('jt-tk-tp',      'Thủ kho TP',             'dept-kho', 'OPERATOR',         ARRAY['TP'],                       'ASSIGNED'),
  ('jt-tk-nvl',     'Thủ kho NVL',            'dept-kho', 'OPERATOR',         ARRAY['NVL'],                      'ASSIGNED'),
  ('jt-nv-sap-tp',  'NV SAP TP',              'dept-kho', 'STAFF',            ARRAY['TP'],                       'ASSIGNED'),
  ('jt-nv-sap-nvl', 'NV SAP NVL',             'dept-kho', 'STAFF',            ARRAY['NVL'],                      'ASSIGNED'),
-- Phòng QA
  ('jt-qa-mgr',     'QA Manager',             'dept-qa',  'SUPERVISOR',       ARRAY['TP','NVL','POSM'],          'NATIONAL'),
  ('jt-qa-tp',      'Nhân viên QA TP',        'dept-qa',  'STAFF',            ARRAY['TP'],                       'ASSIGNED'),
  ('jt-qa-nvl',     'Nhân viên QA NVL',       'dept-qa',  'STAFF',            ARRAY['NVL'],                      'ASSIGNED'),
-- Điều vận
  ('jt-dv-mgr',     'Quản lý điều vận',       'dept-dieu-van', 'SUPERVISOR',  ARRAY['TP','NVL','POSM'],          'NATIONAL'),
  ('jt-dv-nv',      'Nhân viên điều vận',     'dept-dieu-van', 'STAFF',       ARRAY['TP','NVL','POSM'],          'ASSIGNED'),
-- Quản lý
  ('jt-admin',      'Admin hệ thống',         'dept-admin', 'NATIONAL_MANAGER', ARRAY['TP','NVL','POSM','BAO_BI'], 'NATIONAL')
ON CONFLICT (id) DO NOTHING;

-- ─── 3. Mở rộng Employee ───────────────────────────────────────────────────────
ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS department_id      TEXT REFERENCES "Department"(id),
  ADD COLUMN IF NOT EXISTS job_title_id       TEXT REFERENCES "JobTitle"(id),
  ADD COLUMN IF NOT EXISTS action_level       TEXT
    CHECK (action_level IN ('NATIONAL_MANAGER','SITE_MANAGER','SUPERVISOR','OPERATOR','STAFF','VIEWER')),
  ADD COLUMN IF NOT EXISTS allowed_categories TEXT[] DEFAULT ARRAY['TP','NVL','POSM','BAO_BI'],
  ADD COLUMN IF NOT EXISTS warehouse_scope    TEXT DEFAULT 'ASSIGNED'
    CHECK (warehouse_scope IN ('NATIONAL','ASSIGNED'));

-- Backfill action_level từ role cũ
UPDATE "Employee" SET
  action_level = CASE role
    WHEN 'OWN'               THEN 'NATIONAL_MANAGER'
    WHEN 'ADMIN'             THEN 'NATIONAL_MANAGER'
    WHEN 'WAREHOUSE_MANAGER' THEN 'SUPERVISOR'
    WHEN 'WAREHOUSE_STAFF'   THEN 'STAFF'
    WHEN 'DRIVER'            THEN 'VIEWER'
    WHEN 'HR_MANAGER'        THEN 'SUPERVISOR'
    ELSE 'VIEWER'
  END,
  warehouse_scope = CASE role
    WHEN 'OWN'   THEN 'NATIONAL'
    WHEN 'ADMIN' THEN 'NATIONAL'
    ELSE 'ASSIGNED'
  END
WHERE action_level IS NULL;

-- ─── 4. UserWarehouseAccess ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "UserWarehouseAccess" (
  id           TEXT PRIMARY KEY,
  employee_id  TEXT NOT NULL REFERENCES "Employee"(id)  ON DELETE CASCADE,
  warehouse_id TEXT NOT NULL REFERENCES "Warehouse"(id) ON DELETE CASCADE,
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(employee_id, warehouse_id)
);

-- Migrate warehouse_id hiện có → UserWarehouseAccess
INSERT INTO "UserWarehouseAccess" (id, employee_id, warehouse_id)
SELECT gen_random_uuid()::text, id, warehouse_id
FROM "Employee"
WHERE warehouse_id IS NOT NULL
ON CONFLICT DO NOTHING;
