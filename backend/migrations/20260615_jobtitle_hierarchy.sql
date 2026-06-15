-- ============================================================
-- HR: Phân cấp chức danh (Hierarchical) — sơ đồ tổ chức theo chức danh
-- Apply: Supabase Dashboard → SQL Editor
-- ============================================================
-- JobTitle.parent_id = chức danh cấp trên trực tiếp (VD Supervisor.parent = WH Manager).
-- Quyền duyệt nghỉ phép = chức danh cấp trên trực tiếp của người xin + CHUNG KHO.

ALTER TABLE "JobTitle" ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES "JobTitle"(id);
CREATE INDEX IF NOT EXISTS idx_jobtitle_parent ON "JobTitle"(parent_id);
