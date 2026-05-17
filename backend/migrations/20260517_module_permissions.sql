-- Add module_permissions to JobTitle and Employee tables
ALTER TABLE "JobTitle"  ADD COLUMN IF NOT EXISTS module_permissions JSONB DEFAULT '{}';
ALTER TABLE "Employee"  ADD COLUMN IF NOT EXISTS module_permissions JSONB DEFAULT NULL;
