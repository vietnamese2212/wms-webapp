// Dữ liệu bên ngoài (ERP/SAP) — mount tại /api/external. Mỗi tab 1 module quyền riêng.
import { Router } from 'express'
import { requirePerm } from '../middlewares/auth'
import * as erp from '../controllers/external/erpOrderController'

const router = Router()

// Tab "DO SAP" — module quyền external_do_sap
router.get('/do-sap',              requirePerm('external_do_sap', 'view'),   erp.listDoSap)
router.get('/do-sap/facets',       requirePerm('external_do_sap', 'view'),   erp.doSapFacets)
router.post('/do-sap',             requirePerm('external_do_sap', 'create'), erp.createDoSap)
router.put('/do-sap/:id',          requirePerm('external_do_sap', 'edit'),   erp.updateDoSap)
router.delete('/do-sap/:id',       requirePerm('external_do_sap', 'delete'), erp.deleteDoSap)
router.post('/do-sap/bulk-delete', requirePerm('external_do_sap', 'delete'), erp.bulkDeleteDoSap)

export default router
