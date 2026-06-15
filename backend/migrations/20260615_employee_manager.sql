-- ============================================================
-- HR: Quản lý trực tiếp của nhân viên (để duyệt nghỉ phép)
-- Apply: Supabase Dashboard → SQL Editor
-- ============================================================
-- Duyệt nghỉ phép = quản lý trực tiếp (team leader/supervisor) của người xin.
-- Employee.manager_id tự tham chiếu Employee.

ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS manager_id TEXT REFERENCES "Employee"(id);
CREATE INDEX IF NOT EXISTS idx_employee_manager ON "Employee"(manager_id);
