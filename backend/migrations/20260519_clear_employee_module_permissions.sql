-- Permissions are now sourced exclusively from JobTitle.
-- Per-employee module_permissions overrides were silently taking precedence
-- over job_title permissions with no UI to view or manage them.
-- Clear all existing values so job_title permissions apply correctly for everyone.
UPDATE "Employee"
SET module_permissions = NULL
WHERE module_permissions IS NOT NULL;
