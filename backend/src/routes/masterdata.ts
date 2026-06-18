import { Router } from 'express'
import * as warehouse   from '../controllers/masterdata/warehouseController'
import * as location    from '../controllers/masterdata/locationController'
import * as manufacturer from '../controllers/masterdata/manufacturerController'
import * as material    from '../controllers/masterdata/materialController'
import * as shiftQa     from '../controllers/masterdata/shiftQaController'
import * as department  from '../controllers/masterdata/departmentController'
import * as employee    from '../controllers/masterdata/employeeController'
import { requirePerm, requireAnyPerm } from '../middlewares/auth'

const router = Router()

// Warehouse
router.get('/warehouses',        warehouse.listWarehouses)
router.post('/warehouses',       requirePerm('wms_settings', 'manage_global'), warehouse.createWarehouse)
router.get('/warehouses/:id',    warehouse.getWarehouse)
router.put('/warehouses/:id',    requirePerm('wms_settings', 'manage_global'), warehouse.updateWarehouse)
router.delete('/warehouses/:id', requirePerm('wms_settings', 'manage_global'), warehouse.deleteWarehouse)

// Location
router.get('/locations/sub-groups',  location.listSubGroups)   // ?warehouse_id=xxx
router.get('/locations',             location.listLocations)    // ?warehouse_id=&sub_code=
router.post('/locations',            requirePerm('locations', 'create'), location.createLocation)
router.get('/locations/:id',         location.getLocation)
router.put('/locations/:id',         requirePerm('locations', 'edit'), location.updateLocation)
router.delete('/locations/:id',      requirePerm('locations', 'delete'), location.deleteLocation)

// Manufacturer
router.get('/manufacturers',         manufacturer.listManufacturers)
router.post('/manufacturers',        requirePerm('materials', 'create'), manufacturer.createManufacturer)
router.get('/manufacturers/:id',     manufacturer.getManufacturer)
router.put('/manufacturers/:id',     requirePerm('materials', 'edit'),   manufacturer.updateManufacturer)
router.delete('/manufacturers/:id',  requirePerm('materials', 'delete'), manufacturer.deleteManufacturer)

// Material
router.get('/materials',            requireAnyPerm(['materials', 'view'], ['inbound', 'view'], ['inbound', 'create']), material.listMaterials)
router.get('/materials/categories', requireAnyPerm(['materials', 'view'], ['inbound', 'view'], ['inbound', 'create']), material.listCategories)
router.post('/materials',           requirePerm('materials', 'create'), material.createMaterial)
router.get('/materials/:id',        requirePerm('materials', 'view'),   material.getMaterial)
router.put('/materials/:id',        requirePerm('materials', 'edit'),   material.updateMaterial)
router.delete('/materials/:id',     requirePerm('materials', 'delete'), material.deleteMaterial)

// ImportShift (Ca nhập)
router.get('/import-shifts',        shiftQa.listImportShifts)
router.post('/import-shifts',       requirePerm('wms_settings', 'manage_global'), shiftQa.createImportShift)
router.put('/import-shifts/:id',    requirePerm('wms_settings', 'manage_global'), shiftQa.updateImportShift)

// QAStatus (Tình trạng QA)
router.get('/qa-statuses',          shiftQa.listQAStatuses)
router.post('/qa-statuses',         requirePerm('wms_settings', 'manage_global'), shiftQa.createQAStatus)
router.put('/qa-statuses/:id',      requirePerm('wms_settings', 'manage_global'), shiftQa.updateQAStatus)

// Department + JobTitle (cấu trúc tổ chức + phân quyền chức danh)
router.get('/departments',          department.listDepartments)
router.post('/departments',         requirePerm('user_admin', 'manage_roles'), department.createDepartment)
router.put('/departments/:id',      requirePerm('user_admin', 'manage_roles'), department.updateDepartment)
router.get('/job-titles',           department.listJobTitles)    // ?department_id=
router.post('/job-titles',          requirePerm('user_admin', 'manage_roles'), department.createJobTitle)
router.put('/job-titles/:id',       requirePerm('user_admin', 'manage_roles'), department.updateJobTitle)
router.patch('/job-titles/:id/parent', requirePerm('user_admin', 'manage_roles'), department.setJobTitleParent)

// Employee (nhân sự + phân quyền)
router.get('/employees',            requireAnyPerm(['employees', 'view'], ['user_admin', 'view']), employee.listEmployees)
router.post('/employees',           requirePerm('employees', 'create'), employee.createEmployee)
router.get('/employees/:id',        requireAnyPerm(['employees', 'view'], ['user_admin', 'view']), employee.getEmployee)
router.patch('/employees/:id',              requirePerm('employees', 'edit'), employee.updateEmployee)
router.patch('/employees/:id/set-password', requirePerm('employees', 'set_password'), employee.setPassword)
router.put('/employees/:id/warehouses',     requirePerm('employees', 'edit'), employee.setWarehouseAccess)
router.patch('/employees/:id/manager',      requirePerm('employees', 'edit'), employee.setManager)
router.delete('/employees/:id',             requirePerm('employees', 'delete'), employee.deleteEmployee)
router.post('/employees/:id/restore',       requirePerm('employees', 'delete'), employee.restoreEmployee)

export default router
