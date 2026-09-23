import { Router } from 'express'
import * as vehicleType      from '../controllers/tms/vehicleTypeController'
import * as vehicleModel     from '../controllers/tms/vehicleModelController'
import * as freight          from '../controllers/tms/freightController'
import { validate, zIdParam, z } from '../middlewares/validate'
import { excelUpload } from '../middlewares/excelUpload'
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

// Danh mục Loại xe còn nuôi ô "Loại xe" của form Đăng ký cổng — vai chỉ có gate_registration (bảo vệ)
// từng nhận 403 ở cả hai cửa đọc nên form hiện ô Loại xe RỖNG (đo 21/09 bằng token vai thật). Chỉ mở
// hai cửa ĐỌC danh mục, không mở cửa ghi.
const requireTmsOrGateView = requireAnyPerm(
  ['tms_plan', 'view'],
  ['tms_vehicle_types', 'view'],
  ['tms_slots', 'view'],
  ['tms_companies', 'view'],
  ['tms_vehicles', 'view'],
  ['gate_registration', 'view'],
)

// VehicleType (Loại xe)
router.get('/vehicle-types',     requireTmsOrGateView,                         vehicleType.listVehicleTypes)
router.post('/vehicle-types',    requirePerm('tms_vehicle_types', 'create'),   vehicleType.createVehicleType)
router.put('/vehicle-types/reorder', requirePerm('tms_vehicle_types', 'edit'), vehicleType.reorderVehicleTypes)  // ĐẶT TRƯỚC /:id
router.put('/vehicle-types/:id', requirePerm('tms_vehicle_types', 'edit'),   vehicleType.updateVehicleType)
router.delete('/vehicle-types/:id', requirePerm('tms_vehicle_types', 'delete'), vehicleType.deleteVehicleType)

// vehicle_model (DÒNG XE CON mang mã SAP — 23/09; cha = VehicleType). Cùng module quyền với cha: một danh mục hai tầng.
// Cửa đọc mở như cha (điều vận + Kế hoạch xuất cần) — cửa ghi theo action riêng.
router.get('/vehicle-models',                     requireTmsOrGateView,                                 vehicleModel.listVehicleModels)
router.post('/vehicle-models',                    requirePerm('tms_vehicle_types', 'create'), validate({ body: vehicleModel.zVehicleModelCreate }), vehicleModel.createVehicleModel)
router.patch('/vehicle-models/assign-parent',     requirePerm('tms_vehicle_types', 'edit'),   validate({ body: vehicleModel.zAssignParent }),       vehicleModel.assignParent)   // TRƯỚC /:id
router.put('/vehicle-models/:id',                 requirePerm('tms_vehicle_types', 'edit'),   validate({ params: zIdParam, body: vehicleModel.zVehicleModelUpdate }), vehicleModel.updateVehicleModel)
router.delete('/vehicle-models/:id',              requirePerm('tms_vehicle_types', 'delete'), validate({ params: zIdParam }),                        vehicleModel.deleteVehicleModel)

// ── CƯỚC VẬN CHUYỂN (đợt 1 TMS điều vận, 23/09) — module quyền riêng `freight`: view · manage · export ──
// Bảng cước (kho xuất × ĐVVT × dòng xe con × phường) — phân trang server; upload 2 pha đúng cột file thật
router.get('/freight/tariffs',            requirePerm('freight', 'view'),   validate({ query: freight.zListQuery }),                          freight.listTariffs)
router.post('/freight/tariffs/upload',    requirePerm('freight', 'manage'), validate({ query: z.object({ preflight: z.enum(['1']).optional() }).passthrough() }), excelUpload.single('file'), freight.uploadTariffs)
router.post('/freight/tariffs',           requirePerm('freight', 'manage'), validate({ body: freight.zTariffCreate }),                        freight.createTariff)
router.put('/freight/tariffs/:id',        requirePerm('freight', 'manage'), validate({ params: zIdParam, body: freight.zTariffUpdate }),      freight.updateTariff)
router.delete('/freight/tariffs/:id',     requirePerm('freight', 'manage'), validate({ params: zIdParam }),                                   freight.deleteTariff)
// Phụ phí (rớt điểm · bốc xếp · chờ · khác) theo kho × ĐVVT [× dòng xe]
router.post('/freight/recompute',         requirePerm('freight', 'manage'), validate({ body: freight.zRecompute }),                           freight.recomputeFreight)   // tính lại cước dự tính cho chuyến trong khoảng ngày

router.get('/freight/surcharges',         requirePerm('freight', 'view'),   validate({ query: freight.zListQuery }),                          freight.listSurcharges)
router.post('/freight/surcharges',        requirePerm('freight', 'manage'), validate({ body: freight.zSurchargeCreate }),                     freight.createSurcharge)
router.put('/freight/surcharges/:id',     requirePerm('freight', 'manage'), validate({ params: zIdParam, body: freight.zSurchargeUpdate }),   freight.updateSurcharge)
router.delete('/freight/surcharges/:id',  requirePerm('freight', 'manage'), validate({ params: zIdParam }),                                   freight.deleteSurcharge)
// Phân tuyến ĐVVT: ưu tiên theo khu vực + tỷ trọng theo kỳ
router.get('/freight/allocations',        requirePerm('freight', 'view'),   validate({ query: freight.zListQuery }),                          freight.listAllocations)
router.post('/freight/allocations',       requirePerm('freight', 'manage'), validate({ body: freight.zAllocationCreate }),                    freight.createAllocation)
router.put('/freight/allocations/:id',    requirePerm('freight', 'manage'), validate({ params: zIdParam, body: freight.zAllocationUpdate }),  freight.updateAllocation)
router.delete('/freight/allocations/:id', requirePerm('freight', 'manage'), validate({ params: zIdParam }),                                   freight.deleteAllocation)
router.post('/freight/shares',            requirePerm('freight', 'manage'), validate({ body: freight.zShareCreate }),                         freight.createShare)
router.put('/freight/shares/:id',         requirePerm('freight', 'manage'), validate({ params: zIdParam, body: freight.zShareUpdate }),       freight.updateShare)
router.delete('/freight/shares/:id',      requirePerm('freight', 'manage'), validate({ params: zIdParam }),                                   freight.deleteShare)

// DeliverySlot
router.get('/slots',           requirePerm('tms_plan', 'view'),                slot.listSlots)
router.post('/slots/generate', requireAnyPerm(['tms_plan', 'book'], ['tms_plan', 'create']), slot.generateSlotsForDates)

// TmsOrder (Kế hoạch vận chuyển — điều vận tạo)
router.get('/orders',                    requirePerm('tms_plan', 'view'),                                                    order.listOrders)
// Phân trang SERVER lưới Kế hoạch — 3 endpoint cùng bộ lọc (khai TRƯỚC '/orders/:id' để không bị nuốt)
router.get('/orders/summary',            requirePerm('tms_plan', 'view'),   order.listOrdersSummary)
router.get('/orders/facets',             requirePerm('tms_plan', 'view'),   order.listOrdersFacets)
router.get('/orders/consolidatable',     requirePerm('tms_plan', 'view'),   order.listConsolidatable)
router.post('/orders',                   requirePerm('tms_plan', 'create'),                                                  order.createOrder)
router.post('/orders/bulk',              requireAnyPerm(['tms_plan', 'upload_outbound'], ['tms_plan', 'upload_inbound']),     order.bulkCreateOrders)
router.patch('/orders/bulk-date',              requirePerm('tms_plan', 'change_date'),                                      order.bulkUpdateOrderDate)
router.get('/orders/:id/transfer-goods',       requirePerm('tms_plan', 'view'),          order.getTransferGoods)
router.get('/orders/:id/plan-goods',           requirePerm('tms_plan', 'view'),          order.getPlanGoods)     // dòng hàng lệnh xuất (KH xuất + VL06O) — read-only cho booking
router.post('/orders/:id/confirm-receipt',      requirePerm('tms_plan', 'confirm_receipt'), order.confirmTransferReceipt)
// Chấm sao chuyến giao: ai xác nhận nhận hàng thì người đó chấm — không đẻ quyền mới
router.get ('/orders/:id/receipt-rating',       requirePerm('tms_plan', 'confirm_receipt'), order.getReceiptRating)
router.post('/orders/:id/receipt-rating',       requirePerm('tms_plan', 'confirm_receipt'), order.rateTransferReceipt)
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
router.get('/slot-templates/vehicle-types', requireTmsOrGateView,              slotTemplate.getVehicleTypesByWarehouse)
router.get('/slot-templates/apply-info', requirePerm('tms_slots', 'view'),     slotTemplate.getSlotApplyInfo)
router.get('/slot-templates',        requirePerm('tms_slots', 'view'),         slotTemplate.listSlotTemplates)
router.post('/slot-templates/batch', requirePerm('tms_slots', 'create'),       slotTemplate.batchUpsertSlotTemplates)
router.delete('/slot-templates/cluster', requirePerm('tms_slots', 'delete'),   slotTemplate.deleteSlotTemplateCluster)
router.post('/slot-templates',       requirePerm('tms_slots', 'create'),       slotTemplate.createSlotTemplate)
router.put('/slot-templates/:id',    requirePerm('tms_slots', 'edit'),         slotTemplate.updateSlotTemplate)
router.delete('/slot-templates/:id', requirePerm('tms_slots', 'delete'),       slotTemplate.deleteSlotTemplate)

// TransportCompany (ĐVVT / NCC)
// GET hở đọc có chủ đích (chỉ cần đăng nhập — verifyToken tầng app): danh mục NCC/ĐVVT được đọc chéo
// ở khắp WMS (Inventory Sửa NCC + filter, Outbound chọn ĐVVT, Inbound scan resolve NCC, Materials
// shelflife theo NCC, In tem NCC) — gate quyền TMS làm vai kho thuần bị 403 âm thầm → combobox rỗng.
router.get('/transport-companies',        transportCompany.listTransportCompanies)
router.post('/transport-companies',       requirePerm('tms_companies', 'create'),  transportCompany.createTransportCompany)
router.put('/transport-companies/:id',    requirePerm('tms_companies', 'edit'),    transportCompany.updateTransportCompany)
router.delete('/transport-companies/:id', requirePerm('tms_companies', 'delete'),  transportCompany.deleteTransportCompany)

// Vehicle (Xe)
// GET hở đọc có chủ đích như /transport-companies: biển số xe cần cho Outbound Bắt đầu/Xuất luôn,
// gate, TMS — gate quyền TMS làm vai kho thuần 403 âm thầm (từng phải vá lẻ outbound.quick_export).
router.get('/vehicles',        vehicle.listVehicles)
router.post('/vehicles',       requirePerm('tms_vehicles', 'create'), vehicle.createVehicle)
router.put('/vehicles/:id',    requirePerm('tms_vehicles', 'edit'),   vehicle.updateVehicle)
router.delete('/vehicles/:id', requirePerm('tms_vehicles', 'delete'), vehicle.deleteVehicle)

// Gate Registration (Đăng ký cổng Bảo vệ)
router.get('/gate-registrations',                    requirePerm('gate_registration', 'view'),   gateReg.listGateRegistrations)
router.get('/gate-registrations/suggest-booking',    requirePerm('gate_registration', 'view'),   gateReg.suggestBooking)
// Cây LƯỜI: thống kê nhóm + dòng chi tiết tải dần theo thứ tự cây (khai TRƯỚC route ':id')
router.get('/gate-registrations/tree',               requirePerm('gate_registration', 'view'),   gateReg.getGateTree)
router.get('/gate-registrations/leaves',             requirePerm('gate_registration', 'view'),   gateReg.getGateLeaves)
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
