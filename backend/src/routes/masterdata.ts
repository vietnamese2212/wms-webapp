import { Router } from 'express'
import * as warehouse   from '../controllers/masterdata/warehouseController'
import * as location    from '../controllers/masterdata/locationController'
import * as manufacturer from '../controllers/masterdata/manufacturerController'
import * as material    from '../controllers/masterdata/materialController'
import * as shiftQa     from '../controllers/masterdata/shiftQaController'
import * as department  from '../controllers/masterdata/departmentController'
import * as employee    from '../controllers/masterdata/employeeController'

const router = Router()

// Warehouse
router.get('/warehouses',        warehouse.listWarehouses)
router.post('/warehouses',       warehouse.createWarehouse)
router.get('/warehouses/:id',    warehouse.getWarehouse)
router.put('/warehouses/:id',    warehouse.updateWarehouse)
router.delete('/warehouses/:id', warehouse.deleteWarehouse)

// Location (sub_code/sub_name/sub_type embedded)
router.get('/locations/sub-groups',  location.listSubGroups)   // ?warehouse_id=xxx
router.get('/locations/sub-types',   location.listSubTypes)    // distinct sub_type + label
router.get('/locations',             location.listLocations)    // ?warehouse_id=&sub_code=
router.post('/locations',            location.createLocation)
router.get('/locations/:id',         location.getLocation)
router.put('/locations/:id',         location.updateLocation)
router.delete('/locations/:id',      location.deleteLocation)

// Manufacturer
router.get('/manufacturers',         manufacturer.listManufacturers)
router.post('/manufacturers',        manufacturer.createManufacturer)
router.get('/manufacturers/:id',     manufacturer.getManufacturer)
router.put('/manufacturers/:id',     manufacturer.updateManufacturer)
router.delete('/manufacturers/:id',  manufacturer.deleteManufacturer)

// Material
router.get('/materials',         material.listMaterials)
router.post('/materials',        material.createMaterial)
router.get('/materials/:id',     material.getMaterial)
router.put('/materials/:id',     material.updateMaterial)
router.delete('/materials/:id',  material.deleteMaterial)

// ImportShift (Ca nhập)
router.get('/import-shifts',        shiftQa.listImportShifts)
router.post('/import-shifts',       shiftQa.createImportShift)
router.put('/import-shifts/:id',    shiftQa.updateImportShift)

// QAStatus (Tình trạng QA)
router.get('/qa-statuses',          shiftQa.listQAStatuses)
router.post('/qa-statuses',         shiftQa.createQAStatus)
router.put('/qa-statuses/:id',      shiftQa.updateQAStatus)

// Department + JobTitle
router.get('/departments',          department.listDepartments)
router.post('/departments',         department.createDepartment)
router.put('/departments/:id',      department.updateDepartment)
router.get('/job-titles',           department.listJobTitles)    // ?department_id=
router.post('/job-titles',          department.createJobTitle)
router.put('/job-titles/:id',       department.updateJobTitle)

// Employee (nhân sự + phân quyền)
router.get('/employees',            employee.listEmployees)      // ?department_id=&search=&is_active=
router.post('/employees',           employee.createEmployee)
router.get('/employees/:id',        employee.getEmployee)
router.patch('/employees/:id',      employee.updateEmployee)
router.put('/employees/:id/warehouses', employee.setWarehouseAccess)

export default router
