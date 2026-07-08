import { Router } from 'express'
import * as vehicleType      from '../controllers/tms/vehicleTypeController'
import * as slotTemplate     from '../controllers/tms/slotTemplateController'
import * as slot             from '../controllers/tms/slotController'
import * as order            from '../controllers/tms/orderController'
import * as vehicleSlot      from '../controllers/tms/vehicleSlotController'
import * as transportCompany from '../controllers/tms/transportCompanyController'
import * as vehicle          from '../controllers/tms/vehicleController'
import * as gateReg          from '../controllers/tms/gateRegistrationController'
import { requirePerm, requireAnyPerm } from '../middlewares/auth'

const router = Router()

// Helper: view bất kỳ module TMS — dùng cho GET masterdata được dùng chung nhiều tab
const requireTmsView = requireAnyPerm(
  ['tms_plan', 'view'],
  ['tms_vehicle_types', 'view'],
  ['tms_slots', 'view'],
  ['tms_companies', 'view'],
  ['tms_vehicles', 'view'],
)

// VehicleType (Loại xe)
router.get('/vehicle-types',     requireTmsView,                               vehicleType.listVehicleTypes)
router.post('/vehicle-types',    requirePerm('tms_vehicle_types', 'create'),   vehicleType.createVehicleType)
router.put('/vehicle-types/reorder', requirePerm('tms_vehicle_types', 'edit'), vehicleType.reorderVehicleTypes)  // ĐẶT TRƯỚC /:id
router.put('/vehicle-types/:id', requirePerm('tms_vehicle_types', 'edit'),   vehicleType.updateVehicleType)
router.delete('/vehicle-types/:id', requirePerm('tms_vehicle_types', 'delete'), vehicleType.deleteVehicleType)

// DeliverySlot
router.get('/slots',           requirePerm('tms_plan', 'view'),                slot.listSlots)
router.post('/slots/generate', requireAnyPerm(['tms_plan', 'book'], ['tms_plan', 'create']), slot.generateSlotsForDates)

// TmsOrder (Kế hoạch vận chuyển — điều vận tạo)
router.get('/orders',                    requirePerm('tms_plan', 'view'),                                                    order.listOrders)
router.post('/orders',                   requirePerm('tms_plan', 'create'),                                                  order.createOrder)
router.post('/orders/bulk',              requireAnyPerm(['tms_plan', 'upload_outbound'], ['tms_plan', 'upload_inbound']),     order.bulkCreateOrders)
router.patch('/orders/bulk-date',              requirePerm('tms_plan', 'change_date'),                                      order.bulkUpdateOrderDate)
router.get('/orders/:id/transfer-goods',       requirePerm('tms_plan', 'view'),          order.getTransferGoods)
router.post('/orders/:id/confirm-receipt',      requirePerm('tms_plan', 'confirm_receipt'), order.confirmTransferReceipt)
router.post('/orders/:id/cancel-receipt',       requirePerm('tms_plan', 'confirm_receipt'), order.cancelTransferReceipt)
router.post('/orders/:id/create-one-inbound',   requirePerm('tms_plan', 'confirm_receipt'), order.createOneInbound)
router.post('/orders/:id/self-complete',        requirePerm('tms_plan', 'confirm_receipt'), order.selfCompleteTransfer)
router.get('/orders/:orderId/plan-vs-actual',  requirePerm('tms_plan', 'view'),   order.getPlanVsActual)
router.post('/orders/material-summary',        requirePerm('tms_plan', 'view'),   order.getMaterialSummary)
router.get('/reports/inbound',                 requirePerm('tms_plan', 'view'),   order.getInboundReport)
router.patch('/orders/:id',              requirePerm('tms_plan', 'edit'),                                                    order.updateOrder)
router.delete('/orders/:id',             requirePerm('tms_plan', 'delete'),                                                  order.deleteOrder)

// TmsVehicleSlot (xe thực tế bốc đơn — ĐVVT book)
router.post('/orders/:orderId/vehicle-slots',    requirePerm('tms_plan', 'add_vehicle'), vehicleSlot.addVehicleSlot)
router.patch('/vehicle-slots/:id',               requirePerm('tms_plan', 'book'),        vehicleSlot.updateVehicleSlot)
router.patch('/vehicle-slots/:id/release',       requirePerm('tms_plan', 'release'),     vehicleSlot.releaseVehicleSlot)
router.patch('/vehicle-slots/:id/revoke',        requirePerm('tms_plan', 'revoke'),      vehicleSlot.revokeVehicleSlot)
router.delete('/vehicle-slots/:id',              requirePerm('tms_plan', 'add_vehicle'), vehicleSlot.deleteVehicleSlot)

// SlotTemplate (Khung giờ)
router.get('/slot-templates/vehicle-types', requireTmsView,                    slotTemplate.getVehicleTypesByWarehouse)
router.get('/slot-templates/apply-info', requirePerm('tms_slots', 'view'),     slotTemplate.getSlotApplyInfo)
router.get('/slot-templates',        requirePerm('tms_slots', 'view'),         slotTemplate.listSlotTemplates)
router.post('/slot-templates/batch', requirePerm('tms_slots', 'create'),       slotTemplate.batchUpsertSlotTemplates)
router.delete('/slot-templates/cluster', requirePerm('tms_slots', 'delete'),   slotTemplate.deleteSlotTemplateCluster)
router.post('/slot-templates',       requirePerm('tms_slots', 'create'),       slotTemplate.createSlotTemplate)
router.put('/slot-templates/:id',    requirePerm('tms_slots', 'edit'),         slotTemplate.updateSlotTemplate)
router.delete('/slot-templates/:id', requirePerm('tms_slots', 'delete'),       slotTemplate.deleteSlotTemplate)

// TransportCompany (ĐVVT / NCC)
router.get('/transport-companies',        requireAnyPerm(['tms_plan', 'view'], ['tms_companies', 'view'], ['tms_vehicles', 'view']), transportCompany.listTransportCompanies)
router.post('/transport-companies',       requirePerm('tms_companies', 'create'),  transportCompany.createTransportCompany)
router.put('/transport-companies/:id',    requirePerm('tms_companies', 'edit'),    transportCompany.updateTransportCompany)
router.delete('/transport-companies/:id', requirePerm('tms_companies', 'delete'),  transportCompany.deleteTransportCompany)

// Vehicle (Xe)
router.get('/vehicles',        requireAnyPerm(['tms_plan', 'view'], ['tms_vehicles', 'view']), vehicle.listVehicles)
router.post('/vehicles',       requirePerm('tms_vehicles', 'create'), vehicle.createVehicle)
router.put('/vehicles/:id',    requirePerm('tms_vehicles', 'edit'),   vehicle.updateVehicle)
router.delete('/vehicles/:id', requirePerm('tms_vehicles', 'delete'), vehicle.deleteVehicle)

// Gate Registration (Đăng ký cổng Bảo vệ)
router.get('/gate-registrations',                    requirePerm('gate_registration', 'view'),   gateReg.listGateRegistrations)
router.get('/gate-registrations/suggest-booking',    requirePerm('gate_registration', 'view'),   gateReg.suggestBooking)
router.post('/gate-registrations',                   requirePerm('gate_registration', 'create'), gateReg.createGateRegistration)
router.patch('/gate-registrations/:id',              requirePerm('gate_registration', 'edit'),   gateReg.updateGateRegistration)
router.patch('/gate-registrations/:id/call',         requirePerm('gate_registration', 'call'),   gateReg.doCall)
router.patch('/gate-registrations/:id/entry',        requirePerm('gate_registration', 'entry'),  gateReg.doEntry)
router.patch('/gate-registrations/:id/exit',         requirePerm('gate_registration', 'exit'),   gateReg.doExit)
router.patch('/gate-registrations/:id/revert-call',  requirePerm('gate_registration', 'call'),   gateReg.doRevertCall)
router.patch('/gate-registrations/:id/revert-entry', requirePerm('gate_registration', 'entry'),  gateReg.doRevertEntry)
router.patch('/gate-registrations/:id/revert-exit',  requirePerm('gate_registration', 'exit'),   gateReg.doRevertExit)
router.delete('/gate-registrations/:id',             requirePerm('gate_registration', 'delete'), gateReg.deleteGateRegistration)

export default router
