import { Router } from 'express'
import multer from 'multer'
import * as inbound from '../controllers/wms/inboundController'
import * as outbound from '../controllers/wms/outboundController'
import * as inventory from '../controllers/wms/inventoryController'
import * as lookup from '../controllers/wms/lookupController'
import { inboundEmitter } from '../lib/events'
import { requirePerm } from '../middlewares/auth'

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
router.post('/lookup',       lookup.addLookup)
router.delete('/lookup/:id', lookup.deleteLookup)

// Inbound orders (phiếu nhập kho)
router.get('/inbound-orders',                           inbound.listOrders)
router.post('/inbound-orders',                          requirePerm('inbound', 'create'), inbound.createOrder)
router.get('/inbound-orders/:id',                       inbound.getOrder)
router.patch('/inbound-orders/:id',                     inbound.updateOrder)
router.post('/inbound-orders/:id/complete',             inbound.completeOrder)
router.post('/inbound-orders/:id/cancel',               requirePerm('inbound', 'cancel'), inbound.cancelOrder)
router.post('/inbound-orders/:id/check-scan',           inbound.checkScanQR)
router.post('/inbound-orders/:id/scan',                 requirePerm('inbound', 'scan'), inbound.scanQR)
router.patch('/inbound-orders/:id/entries/:entryId',    requirePerm('inbound', 'edit_pallet'), inbound.updateEntry)
router.delete('/inbound-orders/:id/entries/:entryId',   requirePerm('inbound', 'delete_pallet'), inbound.removeEntry)
router.delete('/inbound-orders/:id/entries',            requirePerm('inbound', 'delete_pallet'), inbound.removeEntries)
router.get('/inbound-orders/:id/location-suggestions',  inbound.getLocationSuggestions)

// Inventory (tồn kho)
router.get('/inventory/facets',                   inventory.listFacets)
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
router.patch('/inventory/:id/unflag',             inventory.unflagEntry)
router.post('/inventory/:id/stocktake',           requirePerm('stocktake', 'scan'), inventory.stocktakeEntry)

// Loose picking (nhặt lẻ)
router.get('/loosepicking', outbound.listLoosePickingItems)

// Outbound (chuyến xe / xuất kho)
router.get('/outbound',                                       outbound.listGDOs)
router.post('/outbound',                                      requirePerm('outbound', 'create'), outbound.createGDO)
router.post('/outbound/upload',                               requirePerm('outbound', 'create'), upload.single('file'), outbound.uploadExcel)
router.get('/outbound/employees',                             outbound.getWarehouseEmployees)
router.get('/outbound/scan-log/facets',                       outbound.getScanLogFacets)
router.get('/outbound/scan-log',                              outbound.getScanLog)
router.get('/outbound/:id',                                   outbound.getGDO)
router.put('/outbound/:id',                                   requirePerm('outbound', 'edit'), outbound.updateGDO)
router.patch('/outbound/:id',                                 outbound.patchGDO)
router.delete('/outbound/:id',                                requirePerm('outbound', 'cancel'), outbound.deleteGDO)
router.post('/outbound/:id/assign',                           requirePerm('outbound', 'assign'), outbound.assignGDO)
router.post('/outbound/:id/unassign',                         requirePerm('outbound', 'assign'), outbound.unassignGDO)
router.post('/outbound/:id/start',                            requirePerm('outbound', 'start'), outbound.startGDO)
router.patch('/outbound/:id/transport',                       requirePerm('outbound', 'edit'), outbound.updateTransport)
router.post('/outbound/:id/unstart',                          requirePerm('outbound', 'start'), outbound.unstartGDO)
router.post('/outbound/:id/uncomplete',                       requirePerm('outbound', 'complete'), outbound.uncompleteGDO)
router.post('/outbound/:gdoId/items/:itemId/check-scan',      outbound.checkScanItem)
router.post('/outbound/:gdoId/items/:itemId/scan',            requirePerm('outbound', 'scan'), outbound.scanItem)
router.delete('/outbound/:gdoId/items/:itemId/scans/:scanId', requirePerm('outbound', 'scan'), outbound.deleteScanEntry)
router.post('/outbound/:gdoId/items/:itemId/manual-complete', requirePerm('outbound', 'complete'), outbound.manualCompleteItem)
router.post('/outbound/:gdoId/items/:itemId/confirm-loose',   requirePerm('outbound', 'complete'), outbound.confirmLoosePickingItem)
router.get('/outbound/:gdoId/items/:itemId/inventory',        outbound.getItemInventory)

export default router
