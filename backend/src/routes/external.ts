// Dữ liệu bên ngoài (ERP/SAP) — mount tại /api/external. Mỗi tab 1 module quyền riêng.
import { Router } from 'express'
import { requirePerm, requireAnyPerm } from '../middlewares/auth'
import { validate, z } from '../middlewares/validate'
import { excelUpload, excelFromStorage } from '../middlewares/excelUpload'
import * as erp from '../controllers/external/erpOrderController'
import * as khvc from '../controllers/external/khvcController'
import * as zsd from '../controllers/external/zsd02Controller'

const router = Router()

// Tab "DO SAP" — module quyền external_do_sap
router.get('/do-sap',              requirePerm('external_do_sap', 'view'),   erp.listDoSap)
router.get('/do-sap/facets',       requirePerm('external_do_sap', 'view'),   erp.doSapFacets)
// 03/10 tối — ngày tạo cần phủ khi đổ ZSD02 (đơn chưa đi theo lịch sử app); màn upload và bàn điều vận cùng đọc
router.get('/do-sap/coverage',     requireAnyPerm(['external_do_sap', 'view'], ['dispatch', 'view']), erp.doSapCoverage)
// Nạp ZSD02 (22/09) — nguồn DO thay VL06O; cùng quyền với cửa VL06O (outbound.import hoặc external_do_sap.create)
router.post('/do-sap/upload-zsd02', requireAnyPerm(['outbound', 'import'], ['external_do_sap', 'create']),
  validate({ query: z.object({ preflight: z.enum(['1']).optional() }) }), excelUpload.single('file'), excelFromStorage, zsd.uploadZsd02)
router.post('/do-sap',             requirePerm('external_do_sap', 'create'), erp.createDoSap)
router.put('/do-sap/:id',          requirePerm('external_do_sap', 'edit'),   erp.updateDoSap)
router.delete('/do-sap/:id',       requirePerm('external_do_sap', 'delete'), erp.deleteDoSap)
router.post('/do-sap/bulk-delete', requirePerm('external_do_sap', 'delete'), erp.bulkDeleteDoSap)

// Sổ SO (dòng ZSD02 chưa có OD) — tab "Chưa có OD", đọc theo quyền xem DO SAP
router.get('/so-lines',            requirePerm('external_do_sap', 'view'),   zsd.listSoLines)

// Tab "Kế hoạch xuất" (KHVC raw) — module quyền external_khvc
router.get('/khvc',              requirePerm('external_khvc', 'view'),   khvc.listKhvc)
router.get('/khvc/facets',       requirePerm('external_khvc', 'view'),   khvc.khvcFacets)
router.post('/khvc',             requirePerm('external_khvc', 'create'), khvc.createKhvc)
router.put('/khvc/:id',          requirePerm('external_khvc', 'edit'),   khvc.updateKhvc)
router.post('/khvc/bulk-date',   requirePerm('external_khvc', 'edit'),   khvc.bulkDateKhvc)   // đổi Ngày xuất hàng loạt (theo Số xe)
router.delete('/khvc/:id',       requirePerm('external_khvc', 'delete'), khvc.deleteKhvc)
router.post('/khvc/bulk-delete', requirePerm('external_khvc', 'delete'), khvc.bulkDeleteKhvc)

export default router
