-- Drop action_level column from Employee and JobTitle
-- Replaced by module_permissions (per job title) which is the new permission system

ALTER TABLE "Employee" DROP COLUMN IF EXISTS action_level;
ALTER TABLE "JobTitle"  DROP COLUMN IF EXISTS action_level;
