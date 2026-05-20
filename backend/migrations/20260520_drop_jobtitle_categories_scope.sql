-- Remove allowed_categories and warehouse_scope from JobTitle.
-- These fields are now managed exclusively on the Employee record.
-- JobTitle only stores module_permissions (what you can DO).
ALTER TABLE "JobTitle"
  DROP COLUMN IF EXISTS "allowed_categories",
  DROP COLUMN IF EXISTS "warehouse_scope";
