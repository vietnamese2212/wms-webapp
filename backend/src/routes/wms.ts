import { Router } from 'express'
import * as inbound from '../controllers/wms/inboundController'

const router = Router()

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
router.get('/inbound-orders/:id/location-suggestions',  inbound.getLocationSuggestions)

export default router
