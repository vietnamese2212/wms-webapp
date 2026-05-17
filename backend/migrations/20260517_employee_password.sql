-- Add password_hash column to Employee table for real authentication
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Index for fast email lookup during login
CREATE INDEX IF NOT EXISTS idx_employee_email
  ON "Employee"(lower(email))
  WHERE email IS NOT NULL;
