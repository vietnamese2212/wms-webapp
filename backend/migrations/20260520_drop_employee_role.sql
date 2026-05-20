-- Remove legacy `role` column from Employee table.
-- Access control is now fully handled by:
--   module_permissions (via JobTitle), warehouse_scope, warehouse_ids, allowed_categories
ALTER TABLE "Employee" DROP COLUMN "role";
