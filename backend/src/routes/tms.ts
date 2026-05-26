import { Router } from 'express'
import * as vehicleType      from '../controllers/tms/vehicleTypeController'
import * as slotTemplate     from '../controllers/tms/slotTemplateController'
import * as slot             from '../controllers/tms/slotController'
import * as order            from '../controllers/tms/orderController'
import * as vehicleSlot      from '../controllers/tms/vehicleSlotController'
import * as transportCompany from '../controllers/tms/transportCompanyController'
import * as vehicle          from '../controllers/tms/vehicleController'
import { requirePerm } from '../middlewares/auth'

const router = Router()

// VehicleType (Loại xe)
router.get('/vehicle-types',     requirePerm('tms', 'view'),          vehicleType.listVehicleTypes)
router.post('/vehicle-types',    requirePerm('tms', 'manage_slots'),  vehicleType.createVehicleType)
router.put('/vehicle-types/:id', requirePerm('tms', 'manage_slots'),  vehicleType.updateVehicleType)

// DeliverySlot
router.get('/slots',           requirePerm('tms', 'view'),            slot.listSlots)
router.post('/slots/generate', requirePerm('tms', 'manage_booking'),  slot.generateSlotsForDates)

// TmsOrder (Kế hoạch vận chuyển — điều vận tạo)
router.get('/orders',              requirePerm('tms', 'view'),            order.listOrders)
router.post('/orders',             requirePerm('tms', 'manage_booking'),  order.createOrder)
router.post('/orders/bulk',        requirePerm('tms', 'manage_booking'),  order.bulkCreateOrders)
router.patch('/orders/:id',        requirePerm('tms', 'manage_booking'),  order.updateOrder)
router.delete('/orders/:id',       requirePerm('tms', 'manage_booking'),  order.deleteOrder)

// TmsVehicleSlot (xe thực tế bốc đơn — ĐVVT book)
router.post('/orders/:orderId/vehicle-slots',    requirePerm('tms', 'manage_booking'), vehicleSlot.addVehicleSlot)
router.patch('/vehicle-slots/:id',               requirePerm('tms', 'book'),           vehicleSlot.updateVehicleSlot)
router.patch('/vehicle-slots/:id/release',       requirePerm('tms', 'manage_booking'), vehicleSlot.releaseVehicleSlot)
router.patch('/vehicle-slots/:id/revoke',        requirePerm('tms', 'revoke'),         vehicleSlot.revokeVehicleSlot)
router.delete('/vehicle-slots/:id',              requirePerm('tms', 'manage_booking'), vehicleSlot.deleteVehicleSlot)

// SlotTemplate (Khung giờ)
router.get('/slot-templates',        requirePerm('tms', 'view'),         slotTemplate.listSlotTemplates)
router.post('/slot-templates',       requirePerm('tms', 'manage_slots'), slotTemplate.createSlotTemplate)
router.put('/slot-templates/:id',    requirePerm('tms', 'manage_slots'), slotTemplate.updateSlotTemplate)
router.delete('/slot-templates/:id', requirePerm('tms', 'manage_slots'), slotTemplate.deleteSlotTemplate)

// TransportCompany (ĐVVT / NCC)
router.get('/transport-companies',        requirePerm('tms', 'view'),              transportCompany.listTransportCompanies)
router.post('/transport-companies',       requirePerm('tms', 'manage_companies'),  transportCompany.createTransportCompany)
router.put('/transport-companies/:id',    requirePerm('tms', 'manage_companies'),  transportCompany.updateTransportCompany)
router.delete('/transport-companies/:id', requirePerm('tms', 'manage_companies'),  transportCompany.deleteTransportCompany)

// Vehicle (Xe)
router.get('/vehicles',        requirePerm('tms', 'view'),             vehicle.listVehicles)
router.post('/vehicles',       requirePerm('tms', 'manage_companies'), vehicle.createVehicle)
router.put('/vehicles/:id',    requirePerm('tms', 'manage_companies'), vehicle.updateVehicle)
router.delete('/vehicles/:id', requirePerm('tms', 'manage_companies'), vehicle.deleteVehicle)

export default router
