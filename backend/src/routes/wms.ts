import { Router } from 'express'
import * as inbound from '../controllers/wms/inboundController'
import { inboundEmitter } from '../lib/events'

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

export default router
