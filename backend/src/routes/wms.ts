import { Router } from 'express'
import multer from 'multer'
import * as inbound from '../controllers/wms/inboundController'
import * as outbound from '../controllers/wms/outboundController'
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

// Outbound (chuyến xe / xuất kho)
router.get('/outbound',                                       outbound.listGDOs)
router.post('/outbound',                                      outbound.createGDO)
router.post('/outbound/upload', upload.single('file'),        outbound.uploadExcel)
router.get('/outbound/employees',                             outbound.getWarehouseEmployees)
router.get('/outbound/:id',                                   outbound.getGDO)
router.patch('/outbound/:id',                                 outbound.patchGDO)
router.post('/outbound/:id/assign',                           outbound.assignGDO)
router.post('/outbound/:id/start',                            outbound.startGDO)
router.post('/outbound/:gdoId/items/:itemId/scan',            outbound.scanItem)
router.post('/outbound/:gdoId/items/:itemId/manual-complete', outbound.manualCompleteItem)
router.get('/outbound/:gdoId/items/:itemId/inventory',        outbound.getItemInventory)

export default router
