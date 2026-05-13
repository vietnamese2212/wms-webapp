import { Router } from 'express'
import multer from 'multer'
import * as inbound from '../controllers/wms/inboundController'
import * as outbound from '../controllers/wms/outboundController'
import * as inventory from '../controllers/wms/inventoryController'
import * as lookup from '../controllers/wms/lookupController'
import { inboundEmitter } from '../lib/events'

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
router.post('/inbound-orders',                          inbound.createOrder)
router.get('/inbound-orders/:id',                       inbound.getOrder)
router.patch('/inbound-orders/:id',                     inbound.updateOrder)
router.post('/inbound-orders/:id/complete',             inbound.completeOrder)
router.post('/inbound-orders/:id/cancel',               inbound.cancelOrder)
router.post('/inbound-orders/:id/scan',                 inbound.scanQR)
router.patch('/inbound-orders/:id/entries/:entryId',    inbound.updateEntry)
router.delete('/inbound-orders/:id/entries/:entryId',   inbound.removeEntry)
router.delete('/inbound-orders/:id/entries',            inbound.removeEntries)
router.get('/inbound-orders/:id/location-suggestions',  inbound.getLocationSuggestions)

// Inventory (tồn kho)
router.get('/inventory/facets',               inventory.listFacets)
router.get('/inventory',                      inventory.listInventory)
router.patch('/inventory/bulk-qa',            inventory.bulkUpdateQA)
router.patch('/inventory/bulk-location',      inventory.bulkTransferLocation)
router.patch('/inventory/bulk-material',      inventory.bulkTransferMaterial)
router.patch('/inventory/:id/adjust',         inventory.adjustInventory)

// Outbound (chuyến xe / xuất kho)
router.get('/outbound',                                       outbound.listGDOs)
router.post('/outbound',                                      outbound.createGDO)
router.post('/outbound/upload', upload.single('file'),        outbound.uploadExcel)
router.get('/outbound/employees',                             outbound.getWarehouseEmployees)
router.get('/outbound/:id',                                   outbound.getGDO)
router.put('/outbound/:id',                                   outbound.updateGDO)
router.patch('/outbound/:id',                                 outbound.patchGDO)
router.delete('/outbound/:id',                                outbound.deleteGDO)
router.post('/outbound/:id/assign',                           outbound.assignGDO)
router.post('/outbound/:id/unassign',                         outbound.unassignGDO)
router.post('/outbound/:id/start',                            outbound.startGDO)
router.patch('/outbound/:id/transport',                       outbound.updateTransport)
router.post('/outbound/:id/unstart',                          outbound.unstartGDO)
router.post('/outbound/:id/uncomplete',                       outbound.uncompleteGDO)
router.post('/outbound/:gdoId/items/:itemId/scan',                  outbound.scanItem)
router.delete('/outbound/:gdoId/items/:itemId/scans/:scanId',       outbound.deleteScanEntry)
router.post('/outbound/:gdoId/items/:itemId/manual-complete',       outbound.manualCompleteItem)
router.get('/outbound/:gdoId/items/:itemId/inventory',              outbound.getItemInventory)

export default router
