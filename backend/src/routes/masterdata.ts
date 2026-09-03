import { Router } from 'express'
import * as warehouse   from '../controllers/masterdata/warehouseController'
import * as location    from '../controllers/masterdata/locationController'
import * as manufacturer from '../controllers/masterdata/manufacturerController'
import * as material    from '../controllers/masterdata/materialController'
import * as shiftQa     from '../controllers/masterdata/shiftQaController'
import * as machine     from '../controllers/wms/machineController'
import * as department  from '../controllers/masterdata/departmentController'
import * as employee    from '../controllers/masterdata/employeeController'
import { requirePerm, requireAnyPerm } from '../middlewares/auth'
import multer from 'multer'

const router = Router()
// Chỉ nhận file Excel (chặn feed binary lạ vào XLSX.read) + 1 file + trần 10MB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /\.(xlsx|xls|xlsm)$/i.test(file.originalname)),
})

// Warehouse
router.get('/warehouses',        warehouse.listWarehouses)
router.post('/warehouses',       requirePerm('wms_settings', 'manage_warehouse'), warehouse.createWarehouse)
// Cờ khai riêng 3 cờ vận hành của MỌI kho (màn In tem: 1 lệnh in gồm tem của nhiều kho nên không
// hỏi được theo từng kho). Hở đọc như /machines, /wms/settings — metadata nhãn tem, người in tem
// không có quyền wms_settings. PHẢI đứng TRƯỚC '/warehouses/:id' kẻo bị hiểu là id.
router.get('/warehouses/type-flag-overrides', warehouse.listWhTypeFlagOverrides)
router.get('/warehouses/:id',    warehouse.getWarehouse)
router.put('/warehouses/:id',    requirePerm('wms_settings', 'manage_warehouse'), warehouse.updateWarehouse)
router.delete('/warehouses/:id', requirePerm('wms_settings', 'manage_warehouse'), warehouse.deleteWarehouse)
// LOẠI KHO CỦA TỪNG KHO (user chốt 21/08: loại kho thuộc về kho, không có danh mục chung để quản)
// → nhận CẢ HAI quyền: manage_warehouse (đây là cấu hình của kho) và manage_type (tab Loại kho chỉ
// mở cho quyền này — gate cứng một bên thì nút chính của tab 403 với bên kia).
router.get('/warehouses/:id/type-configs', warehouse.getWarehouseTypeConfigs)
router.put('/warehouses/:id/type-configs',
  requireAnyPerm(['wms_settings', 'manage_warehouse'], ['wms_settings', 'manage_type']),
  warehouse.putWarehouseTypeConfigs)

// Location
router.get('/locations/sub-groups',  location.listSubGroups)   // ?warehouse_id=xxx
router.get('/locations',             location.listLocations)    // ?warehouse_id=&sub_code= (thêm ?page= = 1 trang)
router.get('/locations/summary',     location.listLocationsSummary)   // 4 ô SummaryBand (phải trước /:id)
router.get('/locations/resolve',     location.resolveLocation)  // quét tem vị trí → 1 dòng (phải trước /:id)
router.post('/locations',            requirePerm('locations', 'create'), location.createLocation)
router.post('/locations/upload',     requirePerm('locations', 'import'), upload.single('file'), location.uploadExcel)  // phải trước /:id
router.patch('/locations/bulk-flag', requirePerm('locations', 'edit'), location.bulkFlagLocations)  // gắn/bỏ cờ cần-kiểm hàng loạt (phải trước /:id)
router.get('/locations/:id/contents', location.getLocationContents)   // "ô này đang chứa gì" (phải trước /:id)
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
// external_do_sap.create: editor "Sửa DO" tra quy cách mã khi thêm dòng (cross-module — thiếu thì lookup 403 câm)
router.get('/materials',            requireAnyPerm(['materials', 'view'], ['inbound', 'view'], ['inbound', 'create'], ['external_do_sap', 'create']), material.listMaterials)
router.get('/materials/categories', requireAnyPerm(['materials', 'view'], ['inbound', 'view'], ['inbound', 'create']), material.listCategories)
// Tổng SummaryBand trang danh mục Mã hàng (khai TRƯỚC '/materials/:id' để không bị nuốt)
router.get('/materials/summary',    requirePerm('materials', 'view'),   material.listMaterialsSummary)
router.post('/materials',           requirePerm('materials', 'create'), material.createMaterial)
router.post('/materials/upload',    requirePerm('materials', 'import'), upload.single('file'), material.uploadExcel)
router.get('/materials/:id',        requirePerm('materials', 'view'),   material.getMaterial)
router.put('/materials/:id',        requirePerm('materials', 'edit'),   material.updateMaterial)
router.delete('/materials/:id',     requirePerm('materials', 'delete'), material.deleteMaterial)

// ImportShift (Ca nhập)
router.get('/import-shifts',        shiftQa.listImportShifts)
router.post('/import-shifts',       requirePerm('wms_settings', 'manage_shift'), shiftQa.createImportShift)
router.put('/import-shifts/:id',    requirePerm('wms_settings', 'manage_shift'), shiftQa.updateImportShift)

// Máy theo Kho (danh mục — Sổ đóng gói + In tem validate máy ở đây, user 13/08)
// GET hở đọc user đăng nhập (form trang sổ / sinh tem cần); write = wms_settings.manage_machine
router.get('/machines',             machine.listMachines)   // ?warehouse_id=
router.post('/machines',            requirePerm('wms_settings', 'manage_machine'), machine.createMachine)
router.put('/machines/:id',         requirePerm('wms_settings', 'manage_machine'), machine.updateMachine)
router.delete('/machines/:id',      requirePerm('wms_settings', 'manage_machine'), machine.deleteMachine)

// QAStatus (Tình trạng QA)
router.get('/qa-statuses',          shiftQa.listQAStatuses)
router.post('/qa-statuses',         requirePerm('wms_settings', 'manage_qa'), shiftQa.createQAStatus)
router.put('/qa-statuses/:id',      requirePerm('wms_settings', 'manage_qa'), shiftQa.updateQAStatus)

// Department + JobTitle (cấu trúc tổ chức + phân quyền chức danh)
router.get('/departments',          department.listDepartments)
router.post('/departments',         requirePerm('user_admin', 'manage_roles'), department.createDepartment)
router.put('/departments/:id',      requirePerm('user_admin', 'manage_roles'), department.updateDepartment)
router.get('/job-titles',           department.listJobTitles)    // ?department_id=
router.post('/job-titles',          requirePerm('user_admin', 'manage_roles'), department.createJobTitle)
router.put('/job-titles/:id',       requirePerm('user_admin', 'manage_roles'), department.updateJobTitle)
router.patch('/job-titles/:id/parent', requirePerm('user_admin', 'manage_roles'), department.setJobTitleParent)

// Employee (tài khoản người dùng + phân quyền)
// Nhật ký quản trị — đặt TRƯỚC /employees/:id để không bị nuốt làm id
router.get('/admin-audit',          requirePerm('user_admin', 'audit_log'), employee.listAdminAudit)
router.get('/employees',            requireAnyPerm(['employees', 'view'], ['user_admin', 'view']), employee.listEmployees)
router.post('/employees',           requirePerm('user_admin', 'create'), employee.createEmployee)
router.get('/employees/:id',        requireAnyPerm(['employees', 'view'], ['user_admin', 'view']), employee.getEmployee)
router.patch('/employees/:id',              requirePerm('user_admin', 'edit'), employee.updateEmployee)
router.patch('/employees/:id/set-password', requirePerm('user_admin', 'set_password'), employee.setPassword)
router.delete('/employees/:id/lock',        requirePerm('user_admin', 'unlock'),       employee.unlockAccount)
router.put('/employees/:id/warehouses',     requirePerm('user_admin', 'edit'), employee.setWarehouseAccess)
router.patch('/employees/:id/manager',      requirePerm('user_admin', 'manage_roles'), employee.setManager)
router.delete('/employees/:id',             requirePerm('user_admin', 'delete'), employee.deleteEmployee)
router.post('/employees/:id/restore',       requirePerm('user_admin', 'delete'), employee.restoreEmployee)

export default router
