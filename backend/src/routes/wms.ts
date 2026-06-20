import { Router } from 'express'
import multer from 'multer'
import * as inbound from '../controllers/wms/inboundController'
import * as outbound from '../controllers/wms/outboundController'
import * as inventory from '../controllers/wms/inventoryController'
import * as lookup from '../controllers/wms/lookupController'
import * as zone from '../controllers/wms/zoneController'
import * as inboundPlan from '../controllers/wms/inboundPlanController'
import * as palletPrint from '../controllers/wms/palletPrintController'
import * as palletOps from '../controllers/wms/palletOpsController'
import { inboundEmitter } from '../lib/events'
import { requirePerm, requireAnyPerm } from '../middlewares/auth'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

const router = Router()

// SSE – real-time push (Railway persistent server only; Vercel serverless will close early)
router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.flushHeaders()

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000)

  const send = () => res.write('data: 1\n\n')
  inboundEmitter.on('changed', send)

  req.on('close', () => {
    clearInterval(keepAlive)
    inboundEmitter.off('changed', send)
  })
})

// Lookup values (loại xuất, v.v.)
router.get('/lookup',        lookup.listLookup)
router.post('/lookup',       requirePerm('wms_settings', 'manage_global'), lookup.addLookup)
router.put('/lookup/:id',    requirePerm('wms_settings', 'manage_global'), lookup.updateLookup)
router.delete('/lookup/:id', requirePerm('wms_settings', 'manage_global'), lookup.deleteLookup)

// In tem pallet — log truy vết (in mấy lần, ai in)
router.post('/pallet-prints', requireAnyPerm(['pallet_print', 'generate'], ['pallet_print', 'reprint']), palletPrint.logPrints)
router.get('/pallet-prints',  requirePerm('pallet_print', 'view'),  palletPrint.listPrints)

// Dồn / Tách pallet
router.get('/pallet-ops',          requirePerm('pallet_ops', 'view'),    palletOps.listOps)
router.post('/pallet-ops/merge',   requirePerm('pallet_ops', 'merge'),   palletOps.mergePallets)
router.post('/pallet-ops/ungroup', requirePerm('pallet_ops', 'ungroup'), palletOps.ungroupPallets)
router.post('/pallet-ops/split',   requirePerm('pallet_ops', 'split'),   palletOps.splitPallet)
router.post('/pallet-ops/:id/undo', requireAnyPerm(['pallet_ops', 'merge'], ['pallet_ops', 'ungroup'], ['pallet_ops', 'split']), palletOps.undoOp)

// Warehouse zones (khu vực kho)
router.get('/zones',         zone.listZones)
router.post('/zones',        requireAnyPerm(['wms_settings', 'manage_zone'], ['wms_settings', 'manage_global']), zone.createZone)
router.put('/zones/:id',     requireAnyPerm(['wms_settings', 'manage_zone'], ['wms_settings', 'manage_global']), zone.updateZone)
router.delete('/zones/:id',  requireAnyPerm(['wms_settings', 'manage_zone'], ['wms_settings', 'manage_global']), zone.deleteZone)

// Inbound plan lines (kế hoạch nhập ngoài NCC)
router.get('/inbound-plan',         requirePerm('inbound_plan', 'view'),   inboundPlan.listPlanLines)
router.post('/inbound-plan',        requirePerm('inbound_plan', 'create'), inboundPlan.createPlanLine)
router.post('/inbound-plan/bulk',           requirePerm('inbound_plan', 'create'),       inboundPlan.bulkCreatePlanLines)
router.post('/inbound-plan/bulk-for-order', requirePerm('tms_plan', 'upload_inbound'),   inboundPlan.bulkCreateForOrder)
router.patch('/inbound-plan/:id',        requirePerm('inbound_plan', 'edit'),   inboundPlan.updatePlanLine)
router.patch('/inbound-plan/:id/cancel', requirePerm('inbound_plan', 'cancel'), inboundPlan.cancelPlanLine)
router.delete('/inbound-plan/:id',       requirePerm('inbound_plan', 'delete'), inboundPlan.deletePlanLine)

// Inbound orders (phiếu nhập kho)
router.get('/inbound-orders',                           inbound.listOrders)
router.post('/inbound-orders',                          requirePerm('inbound', 'create'), inbound.createOrder)
router.get('/inbound-orders/:id',                       inbound.getOrder)
router.patch('/inbound-orders/:id',                     requirePerm('inbound', 'edit'), inbound.updateOrder)
router.patch('/inbound-orders/:id/location',            requireAnyPerm(['inbound', 'edit_pallet'], ['inbound', 'force_edit_pallet']), inbound.setOrderLocation)
router.post('/inbound-orders/:id/complete',             requireAnyPerm(['inbound', 'complete'], ['tms_plan', 'confirm_receipt']), inbound.completeOrder)
router.post('/inbound-orders/:id/uncomplete',           requirePerm('inbound', 'uncomplete'), inbound.uncompleteOrder)
router.post('/inbound-orders/:id/cancel',               requirePerm('inbound', 'cancel'), inbound.cancelOrder)
router.post('/inbound-orders/:id/check-scan',           inbound.checkScanQR)
router.post('/inbound-orders/:id/scan',                 requireAnyPerm(['inbound', 'scan'], ['tms_plan', 'confirm_receipt']), inbound.scanQR)
router.post('/inbound-orders/:id/scan-manual',          requireAnyPerm(['inbound', 'scan'], ['tms_plan', 'confirm_receipt']), inbound.scanManual)
router.patch('/inbound-orders/:id/entries/:entryId',    requireAnyPerm(['inbound', 'edit_pallet'], ['inbound', 'force_edit_pallet']), inbound.updateEntry)
router.delete('/inbound-orders/:id/entries/:entryId',   requireAnyPerm(['inbound', 'delete_pallet'], ['inbound', 'force_delete_pallet']), inbound.removeEntry)
router.delete('/inbound-orders/:id/entries',            requireAnyPerm(['inbound', 'delete_pallet'], ['inbound', 'force_delete_pallet']), inbound.removeEntries)
router.get('/inbound-orders/:id/location-suggestions',  inbound.getLocationSuggestions)

// Inventory (tồn kho)
router.get('/inventory/facets',                   inventory.listFacets)
router.get('/inventory/summary',                   inventory.summaryInventory)   // tổng hợp theo mã — phải trước /:id
router.get('/inventory/export',                    requirePerm('inventory', 'export'), inventory.exportInventory)  // phải trước /:id
router.get('/inventory/stocktake-summary',         inventory.stocktakeSummary)   // phải trước /:id
router.get('/inventory/stocktake-entries',         inventory.stocktakeEntries)   // phải trước /:id
router.get('/inventory',                          inventory.listInventory)
router.get('/inventory/:id',                      inventory.getInventoryEntry)
router.post('/inventory/stocktake-check',          requirePerm('stocktake', 'scan'), inventory.stocktakeCheck)
router.patch('/inventory/bulk-qa',                requirePerm('inventory', 'qa_update'), inventory.bulkUpdateQA)
router.patch('/inventory/bulk-location',          requirePerm('inventory', 'move_location'), inventory.bulkTransferLocation)
router.patch('/inventory/bulk-material',          requirePerm('inventory', 'recode'), inventory.bulkTransferMaterial)
router.patch('/inventory/bulk-production-date',   requirePerm('inventory', 'update_prod_date'), inventory.bulkUpdateProductionDate)
router.patch('/inventory/:id/adjust',             requirePerm('inventory', 'adjust'), inventory.adjustInventory)
router.get('/inventory/:id/adjustment-log',       inventory.listAdjustmentLog)
router.patch('/inventory/:id/unflag',             requirePerm('stocktake', 'complete'), inventory.unflagEntry)
router.post('/inventory/:id/stocktake',           requirePerm('stocktake', 'scan'), inventory.stocktakeEntry)

// Loose picking (nhặt lẻ)
router.get('/loosepicking', outbound.listLoosePickingItems)

// Outbound (chuyến xe / xuất kho)
router.get('/outbound',                                       requirePerm('outbound', 'view'), outbound.listGDOs)
router.post('/outbound',                                      requirePerm('outbound', 'create'), outbound.createGDO)
router.post('/outbound/upload',                               requirePerm('outbound', 'create'), upload.single('file'), outbound.uploadExcel)
router.get('/outbound/employees',                             requirePerm('outbound', 'view'), outbound.getWarehouseEmployees)
router.get('/outbound/scan-log/facets',                       requirePerm('scanlog', 'view'), outbound.getScanLogFacets)
router.get('/outbound/scan-log',                              requirePerm('scanlog', 'view'), outbound.getScanLog)
router.get('/outbound/prepare',                               requirePerm('outbound', 'view'), outbound.getPrepareBoard)
router.get('/outbound/inventory-by-material',                 requirePerm('outbound', 'view'), outbound.getInventoryByMaterial)
router.get('/outbound/:id',                                   requireAnyPerm(['outbound', 'view'], ['loosepicking', 'view']), outbound.getGDO)
router.put('/outbound/:id',                                   requirePerm('outbound', 'edit'), outbound.updateGDO)
router.patch('/outbound/:id',                                 requirePerm('outbound', 'edit'), outbound.patchGDO)
router.delete('/outbound/:id',                                requirePerm('outbound', 'cancel'), outbound.deleteGDO)
router.post('/outbound/:id/assign',                           requirePerm('outbound', 'assign'), outbound.assignGDO)
router.post('/outbound/:id/unassign',                         requirePerm('outbound', 'unassign'), outbound.unassignGDO)
router.post('/outbound/:id/start',                            requirePerm('outbound', 'start'), outbound.startGDO)
router.patch('/outbound/:id/transport',                       requirePerm('outbound', 'edit'), outbound.updateTransport)
router.post('/outbound/:id/unstart',                          requirePerm('outbound', 'unstart'), outbound.unstartGDO)
router.post('/outbound/:id/uncomplete',                       requirePerm('outbound', 'uncomplete'), outbound.uncompleteGDO)
router.post('/outbound/:gdoId/items/:itemId/check-scan',      requireAnyPerm(['outbound', 'scan'], ['loosepicking', 'scan']), outbound.checkScanItem)
// Scan/xóa-scan dùng chung cho trang Xuất kho VÀ Nhặt lẻ → chấp nhận quyền của cả 2 module
router.post('/outbound/:gdoId/items/:itemId/scan',            requireAnyPerm(['outbound', 'scan'], ['loosepicking', 'scan']), outbound.scanItem)
router.delete('/outbound/:gdoId/items/:itemId/scans/:scanId', requireAnyPerm(['outbound', 'scan'], ['loosepicking', 'scan']), outbound.deleteScanEntry)
// "Lưu thủ công" = ghi nhận xuất cho hàng không QR (trừ tồn + tạo scan entry) → là capability QUÉT, không phải complete
router.post('/outbound/:gdoId/items/:itemId/manual-complete', requirePerm('outbound', 'scan'), outbound.manualCompleteItem)
router.post('/outbound/:gdoId/items/:itemId/confirm-loose',   requireAnyPerm(['outbound', 'complete'], ['loosepicking', 'complete']), outbound.confirmLoosePickingItem)
router.get('/outbound/:gdoId/pick-suggestions',              requirePerm('outbound', 'view'), outbound.getGDOPickSuggestions)
router.get('/outbound/:gdoId/items/:itemId/inventory',        requireAnyPerm(['outbound', 'view'], ['loosepicking', 'view']), outbound.getItemInventory)
router.get('/outbound/:gdoId/items/:itemId/manual-stock',     requirePerm('outbound', 'view'), outbound.getManualItemStock)

export default router
