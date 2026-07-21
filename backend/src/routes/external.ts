// Dữ liệu bên ngoài (ERP/SAP) — mount tại /api/external. Mỗi tab 1 module quyền riêng.
import { Router } from 'express'
import { requirePerm } from '../middlewares/auth'
import * as erp from '../controllers/external/erpOrderController'
import * as khvc from '../controllers/external/khvcController'

const router = Router()

// Tab "DO SAP" — module quyền external_do_sap
router.get('/do-sap',              requirePerm('external_do_sap', 'view'),   erp.listDoSap)
router.get('/do-sap/facets',       requirePerm('external_do_sap', 'view'),   erp.doSapFacets)
router.post('/do-sap',             requirePerm('external_do_sap', 'create'), erp.createDoSap)
router.put('/do-sap/:id',          requirePerm('external_do_sap', 'edit'),   erp.updateDoSap)
router.delete('/do-sap/:id',       requirePerm('external_do_sap', 'delete'), erp.deleteDoSap)
router.post('/do-sap/bulk-delete', requirePerm('external_do_sap', 'delete'), erp.bulkDeleteDoSap)

// Tab "Kế hoạch xuất" (KHVC raw) — module quyền external_khvc
router.get('/khvc',              requirePerm('external_khvc', 'view'),   khvc.listKhvc)
router.get('/khvc/facets',       requirePerm('external_khvc', 'view'),   khvc.khvcFacets)
router.post('/khvc',             requirePerm('external_khvc', 'create'), khvc.createKhvc)
router.put('/khvc/:id',          requirePerm('external_khvc', 'edit'),   khvc.updateKhvc)
router.delete('/khvc/:id',       requirePerm('external_khvc', 'delete'), khvc.deleteKhvc)
router.post('/khvc/bulk-delete', requirePerm('external_khvc', 'delete'), khvc.bulkDeleteKhvc)

export default router
