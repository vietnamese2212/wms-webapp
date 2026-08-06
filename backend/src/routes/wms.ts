import { Router } from 'express'
import multer from 'multer'
import * as inbound from '../controllers/wms/inboundController'
import * as outbound from '../controllers/wms/outboundController'
import * as reconcile from '../controllers/wms/reconcileController'
import * as inventory from '../controllers/wms/inventoryController'
import * as lookup from '../controllers/wms/lookupController'
import * as zone from '../controllers/wms/zoneController'
import * as inboundPlan from '../controllers/wms/inboundPlanController'
import * as palletPrint from '../controllers/wms/palletPrintController'
import * as palletOps from '../controllers/wms/palletOpsController'
import * as weigh from '../controllers/wms/weighTicketController'
import * as controlTower from '../controllers/wms/controlTowerController'
import * as slotting from '../controllers/wms/slottingController'
import * as fill from '../controllers/wms/fillController'
import * as alerts from '../controllers/wms/alertController'
import * as forklift from '../controllers/wms/forkliftController'
import * as dashboard from '../controllers/wms/dashboardController'
import * as systemSetting from '../controllers/wms/systemSettingController'
import * as integrationKeys from '../controllers/integration/keyController'
import { inboundEmitter } from '../lib/events'
import { requirePerm, requireAnyPerm } from '../middlewares/auth'

// Chỉ nhận file Excel (chặn feed binary lạ vào XLSX.read) + 1 file + trần 10MB.
// File sai loại → req.file undefined → controller trả 400 "Không có file" (không ném lỗi thô).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /\.(xlsx|xls|xlsm)$/i.test(file.originalname)),
})

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

// Dashboard tổng quan — hở đọc có chủ đích (auth-only, cắt scope kho+loại trong controller)
router.get('/dashboard', dashboard.getDashboard)

// Cờ hệ thống (SystemSetting) — đọc hở cho user đăng nhập (in tem/quét cần cờ); ghi = quyền riêng
router.get('/settings',      systemSetting.listSettings)
router.put('/settings/:key', requirePerm('wms_settings', 'manage_system'), systemSetting.updateSetting)

// Quản lý API key tích hợp ERP — CHỈ superadmin (kiểm trong controller). Key thô hiện 1 lần lúc tạo.
router.get('/integration-keys',            integrationKeys.listKeys)
router.post('/integration-keys',           integrationKeys.createKey)
router.patch('/integration-keys/:id/revoke', integrationKeys.revokeKey)
router.delete('/integration-keys/:id',       integrationKeys.deleteKey)   // xóa hẳn (chỉ key đã thu hồi)

// Lookup values (loại xuất, v.v.)
router.get('/lookup',        lookup.listLookup)
router.post('/lookup',       requirePerm('wms_settings', 'manage_type'), lookup.addLookup)
router.put('/lookup/reorder', requirePerm('wms_settings', 'manage_type'), lookup.reorderLookup)  // ĐẶT TRƯỚC /:id
router.put('/lookup/:id',    requirePerm('wms_settings', 'manage_type'), lookup.updateLookup)
router.delete('/lookup/:id', requirePerm('wms_settings', 'manage_type'), lookup.deleteLookup)

// Đơn vị tính (unit_of_measure) — tab riêng, quyền manage_unit (type khóa cứng trong controller)
router.post('/lookup-unit',        requirePerm('wms_settings', 'manage_unit'), lookup.addUnit)
router.put('/lookup-unit/reorder', requirePerm('wms_settings', 'manage_unit'), lookup.reorderUnit)  // ĐẶT TRƯỚC /:id
router.put('/lookup-unit/:id',     requirePerm('wms_settings', 'manage_unit'), lookup.updateUnit)
router.delete('/lookup-unit/:id',  requirePerm('wms_settings', 'manage_unit'), lookup.deleteUnit)

// In tem pallet — log truy vết (in mấy lần, ai in)
router.post('/pallet-prints', requireAnyPerm(['pallet_print', 'generate'], ['pallet_print', 'reprint']), palletPrint.logPrints)
// list dùng cho tab Lịch sử in + Truy cứu + chọn tem In lại — anyOf theo tab
// (phải khai TRƯỚC '/pallet-prints' để không bị nuốt bởi route cùng prefix)
router.get('/pallet-prints/facets', requireAnyPerm(['pallet_print', 'view'], ['pallet_print', 'history'], ['pallet_print', 'audit'], ['pallet_print', 'reprint']), palletPrint.listPrintFacets)
router.get('/pallet-prints',  requireAnyPerm(['pallet_print', 'view'], ['pallet_print', 'history'], ['pallet_print', 'audit'], ['pallet_print', 'reprint']), palletPrint.listPrints)

// Dồn / Tách pallet
router.get('/pallet-ops',          requirePerm('pallet_ops', 'view'),    palletOps.listOps)
router.post('/pallet-ops/merge',   requirePerm('pallet_ops', 'merge'),   palletOps.mergePallets)
router.post('/pallet-ops/ungroup', requirePerm('pallet_ops', 'ungroup'), palletOps.ungroupPallets)
router.post('/pallet-ops/split',   requirePerm('pallet_ops', 'split'),   palletOps.splitPallet)
router.post('/pallet-ops/:id/undo', requireAnyPerm(['pallet_ops', 'merge'], ['pallet_ops', 'ungroup'], ['pallet_ops', 'split']), palletOps.undoOp)

// Warehouse zones (khu vực kho)
router.get('/zones',         zone.listZones)
router.post('/zones',        requirePerm('wms_settings', 'manage_zone'), zone.createZone)
router.put('/zones/:id',     requirePerm('wms_settings', 'manage_zone'), zone.updateZone)
router.delete('/zones/:id',  requirePerm('wms_settings', 'manage_zone'), zone.deleteZone)

// Inbound plan lines (kế hoạch nhập chuyển kho — sửa trong tab Kế hoạch của TMS Bookings,
// gate FE bằng tms_plan → BE dùng requireAnyPerm để KH nhập đi cùng quyền tms_plan, tránh 403 giữa chừng khi lưu)
// Sửa/xóa dòng KH nhập cũng nằm trong flow "Sửa đơn" của TMS Bookings (FE gate tms_plan.edit)
// → nhận thêm tms_plan.edit, tránh user có quyền Sửa đơn bấm lưu bị 403 giữa chừng.
// inbound_plan chỉ còn view + edit (create/delete/cancel đã bỏ — mồ côi, không UI nào cấp trải nghiệm dùng).
router.get('/inbound-plan',         requireAnyPerm(['inbound_plan', 'view'],   ['tms_plan', 'view']),           inboundPlan.listPlanLines)
router.post('/inbound-plan',        requirePerm('tms_plan', 'upload_inbound'),   inboundPlan.createPlanLine)
router.post('/inbound-plan/bulk',           requirePerm('tms_plan', 'upload_inbound'), inboundPlan.bulkCreatePlanLines)
router.post('/inbound-plan/bulk-for-order', requirePerm('tms_plan', 'upload_inbound'),   inboundPlan.bulkCreateForOrder)
router.patch('/inbound-plan/:id',        requireAnyPerm(['inbound_plan', 'edit'], ['tms_plan', 'upload_inbound'], ['tms_plan', 'edit']), inboundPlan.updatePlanLine)
router.patch('/inbound-plan/:id/cancel', requireAnyPerm(['tms_plan', 'upload_inbound'], ['tms_plan', 'edit']), inboundPlan.cancelPlanLine)
router.delete('/inbound-plan/:id',       requireAnyPerm(['tms_plan', 'upload_inbound'], ['tms_plan', 'edit']), inboundPlan.deletePlanLine)

// Inbound orders (phiếu nhập kho)
router.get('/inbound-orders',                           inbound.listOrders)
// summary/facets PHẢI đứng TRƯỚC '/inbound-orders/:id' (không thì bị :id nuốt).
// Hở đọc như listOrders (CLAUDE.md) — scope kho + loại vẫn cắt trong controller theo JWT.
router.get('/inbound-orders/summary',                   inbound.listOrdersSummary)
router.get('/inbound-orders/facets',                    inbound.listOrdersFacets)
router.get('/inbound-orders/facets',                    inbound.listOrdersFacets)
router.post('/inbound-orders',                          requirePerm('inbound', 'create'), inbound.createOrder)
router.get('/inbound-orders/:id',                       inbound.getOrder)
router.patch('/inbound-orders/:id',                     requirePerm('inbound', 'edit'), inbound.updateOrder)
router.patch('/inbound-orders/:id/location',            requireAnyPerm(['inbound', 'edit_pallet'], ['inbound', 'force_edit_pallet']), inbound.setOrderLocation)
router.post('/inbound-orders/:id/complete',             requireAnyPerm(['inbound', 'complete'], ['tms_plan', 'confirm_receipt']), inbound.completeOrder)
router.post('/inbound-orders/:id/uncomplete',           requirePerm('inbound', 'uncomplete'), inbound.uncompleteOrder)
// confirm_receipt: người nhận chuyển kho hủy DÒNG NSX thừa / xóa số vừa lưu ngay trên panel tab Chuyển kho
router.post('/inbound-orders/:id/cancel',               requireAnyPerm(['inbound', 'cancel'], ['tms_plan', 'confirm_receipt']), inbound.cancelOrder)
router.post('/inbound-orders/:id/check-scan',           requireAnyPerm(['inbound', 'scan'], ['tms_plan', 'confirm_receipt']), inbound.checkScanQR)
router.post('/inbound-orders/:id/scan',                 requireAnyPerm(['inbound', 'scan'], ['tms_plan', 'confirm_receipt']), inbound.scanQR)
router.post('/inbound-orders/:id/scan-manual',          requireAnyPerm(['inbound', 'scan'], ['tms_plan', 'confirm_receipt']), inbound.scanManual)
router.patch('/inbound-orders/:id/entries/:entryId',    requireAnyPerm(['inbound', 'edit_pallet'], ['inbound', 'force_edit_pallet']), inbound.updateEntry)
router.delete('/inbound-orders/:id/entries/:entryId',   requireAnyPerm(['inbound', 'delete_pallet'], ['inbound', 'force_delete_pallet'], ['tms_plan', 'confirm_receipt']), inbound.removeEntry)
router.delete('/inbound-orders/:id/entries',            requireAnyPerm(['inbound', 'delete_pallet'], ['inbound', 'force_delete_pallet']), inbound.removeEntries)
router.get('/inbound-orders/:id/location-suggestions',  inbound.getLocationSuggestions)

// Inventory (tồn kho)
router.get('/inventory/facets',                   inventory.listFacets)
router.get('/inventory/summary',                   inventory.summaryInventory)   // tổng hợp theo mã — phải trước /:id
router.get('/inventory/export',                    requirePerm('inventory', 'export'), inventory.exportInventory)  // phải trước /:id
router.get('/inventory/stocktake-entries',         requirePerm('stocktake', 'view'), inventory.stocktakeEntries)   // phải trước /:id
router.get('/inventory/stocktake-log',             requirePerm('stocktake', 'view'), inventory.stocktakeLog)       // lịch sử kiểm (phải trước /:id)
router.get('/inventory',                          inventory.listInventory)
router.get('/inventory/:id',                      inventory.getInventoryEntry)
router.post('/inventory/upload',                  requirePerm('inventory', 'import'), upload.single('file'), inventory.uploadExcel)
router.post('/inventory/stocktake-check',          requirePerm('stocktake', 'scan'), inventory.stocktakeCheck)
router.patch('/inventory/bulk-qa',                requirePerm('inventory', 'qa_update'), inventory.bulkUpdateQA)
router.patch('/inventory/bulk-ncc',               requirePerm('inventory', 'update_ncc'), inventory.bulkUpdateNcc)
router.patch('/inventory/bulk-location',          requirePerm('inventory', 'move_location'), inventory.bulkTransferLocation)
router.patch('/inventory/bulk-material',          requirePerm('inventory', 'recode'), inventory.bulkTransferMaterial)
router.patch('/inventory/bulk-production-date',   requirePerm('inventory', 'update_prod_date'), inventory.bulkUpdateProductionDate)
router.patch('/inventory/:id/adjust',             requirePerm('inventory', 'adjust'), inventory.adjustInventory)
router.get('/inventory/:id/adjustment-log',       inventory.listAdjustmentLog)
router.patch('/inventory/:id/unflag',             requirePerm('stocktake', 'complete'), inventory.unflagEntry)
router.post('/inventory/:id/stocktake',           requirePerm('stocktake', 'scan'), inventory.stocktakeEntry)

// Loose picking (nhặt lẻ)
router.get('/loosepicking/facets',                            requirePerm('loosepicking', 'view'), outbound.getLoosePickingFacets)   // phải trước '/loosepicking'
router.get('/loosepicking',                                   requirePerm('loosepicking', 'view'), outbound.listLoosePickingItems)

// Outbound (chuyến xe / xuất kho)
router.get('/outbound',                                       requirePerm('outbound', 'view'), outbound.listGDOs)
// summary/facets của list Xuất — cùng quyền view như list (scope kho + loại cắt trong controller)
router.get('/outbound/summary',                               requirePerm('outbound', 'view'), outbound.listGDOsSummary)
router.get('/outbound/facets',                                requirePerm('outbound', 'view'), outbound.listGDOsFacets)
router.post('/outbound',                                      requirePerm('outbound', 'create'), outbound.createGDO)
router.post('/outbound/upload',                               requirePerm('outbound', 'import'), upload.single('file'), outbound.uploadExcel)
// 2 nút nạp NGUỒN đã chuyển sang trang "Dữ liệu bên ngoài" (user chốt 02/08) → nhận quyền của CHÍNH
// tab đang nạp (external_do_sap.create / external_khvc.create) HOẶC outbound.import như trước, để
// điều vận không phải xin thêm quyền Xuất kho chỉ để nạp dữ liệu nguồn.
router.post('/outbound/upload-vl06o',                         requireAnyPerm(['outbound', 'import'], ['external_do_sap', 'create']), upload.single('file'), outbound.uploadVl06o)   // raw SAP → erp_outbound_orders
router.post('/outbound/upload-khvc',                          requireAnyPerm(['outbound', 'import'], ['external_khvc', 'create']), upload.single('file'), outbound.uploadKhvc)      // KHVC join raw → GDO/DO/Item
router.post('/outbound/quick-export',                         requirePerm('outbound', 'quick_export'), outbound.quickExportGDO)   // Tạo & Xuất luôn (hàng không tem)
router.post('/outbound/:gdoId/quick-export',                  requirePerm('outbound', 'quick_export'), outbound.quickExportExistingGDO)   // Xuất luôn trên GDO đã lưu (QTY/NONE)
router.get('/outbound/employees',                             requirePerm('outbound', 'view'), outbound.getWarehouseEmployees)
// Control Tower — giám sát vận hành trong ngày (đọc-only, RPC aggregate)
router.get('/control-tower',                                  requirePerm('control_tower', 'view'), controlTower.getControlTower)
// Slotting (Tối ưu vị trí) — phân tích ABC + kế hoạch sắp xếp lại kho
router.get('/slotting',                                       requirePerm('slotting', 'view'),     slotting.getSlotting)
router.get('/slotting/plans',                                 requirePerm('slotting', 'view'),     slotting.listPlans)
router.get('/slotting/plans/:id',                             requirePerm('slotting', 'view'),     slotting.getPlan)
router.post('/slotting/plans/preview',                        requirePerm('slotting', 'plan'),     slotting.previewPlan)
router.post('/slotting/plans',                                requirePerm('slotting', 'plan'),     slotting.createPlan)
// Hoàn thành / Hủy / Mở lại = 3 quyền riêng (tách 05/08) — controller kiểm đúng quyền theo status body
router.patch('/slotting/plans/:id',                           requireAnyPerm(['slotting', 'complete'], ['slotting', 'cancel'], ['slotting', 'reopen']), slotting.updatePlan)
// Quét thực hiện lệnh kế hoạch = thao tác CHUYỂN VỊ TRÍ pallet → dùng đúng quyền inventory.move_location (cross-module)
router.post('/slotting/plans/:id/scan-move',                  requirePerm('inventory', 'move_location'), slotting.scanMovePlanPallet)
router.delete('/slotting/plans/:id',                          requirePerm('slotting', 'delete'),   slotting.deletePlan)
router.patch('/slotting/zone-config/:id',                     requirePerm('slotting', 'configure'), slotting.updateZoneConfig)

// ─── FILL HÀNG phục vụ nhặt lẻ (04/08; v3 gom lệnh theo DATE 05/08) ─────────
// Quét thực hiện GHI location_id, nhưng phạm vi bị chặn cứng ở BE: đúng mã + đúng DATE của dòng
// lệnh, đích phải là vị trí nhặt lẻ nhận đúng Loại kho. Cùng tiền lệ `leftover_location_id` bên
// Xuất kho — người đi hạ hàng phải làm được việc của mình (kể cả đổi vị trí đến ngay màn quét);
// đổi vị trí pallet BẤT KỲ ngoài lệnh vẫn phải `inventory.move_location`.
// Trung tâm cảnh báo (Đợt 2 roadmap 06/08) — mỗi nút 1 quyền: view=xem, ack=đánh dấu đã biết
router.get('/alerts',                                         requirePerm('alerts', 'view'),  alerts.listAlerts)
router.post('/alerts/:id/ack',                                requirePerm('alerts', 'ack'),   alerts.ackAlert)
router.delete('/alerts/:id/ack',                              requirePerm('alerts', 'ack'),   alerts.unackAlert)

router.get('/fill/demand',                                    requirePerm('fill', 'view'),    fill.getFillDemand)
router.get('/fill/candidates',                                requirePerm('fill', 'view'),    fill.getFillCandidates)
router.get('/fill/orders',                                    requirePerm('fill', 'view'),    fill.listFillOrders)
router.get('/fill/orders/:id',                                requirePerm('fill', 'view'),    fill.getFillOrder)
router.get('/fill/report',                                    requirePerm('fill', 'view'),    fill.getFillReport)
router.get('/fill/pick-face-locations',                       requirePerm('fill', 'view'),    fill.listPickFaceLocations)
// Ô chọn người nhận lệnh — dùng lại controller danh sách nhân sự theo kho (read-only) của Xuất kho
router.get('/fill/employees',                                 requirePerm('fill', 'assign'),  outbound.getWarehouseEmployees)
router.post('/fill/orders',                                   requirePerm('fill', 'plan'),    fill.createFillOrder)
router.post('/fill/scan',                                     requirePerm('fill', 'execute'), fill.scanFill)
// Gán người (assign) và đổi vị trí đích (plan) đi chung 1 route → controller tự kiểm TỪNG quyền
// Gán người ≠ đổi vị trí đến ≠ hủy = 3 quyền riêng (tách 05/08 — controller kiểm đúng field)
router.patch('/fill/tasks/:id',                               requireAnyPerm(['fill', 'assign'], ['fill', 'change_dest']), fill.updateFillTask)
router.delete('/fill/tasks/:id',                              requirePerm('fill', 'cancel'),  fill.cancelFillTask)
router.delete('/fill/orders/:id',                             requirePerm('fill', 'cancel'),  fill.cancelFillOrder)

// ─── Xe nâng: check list an toàn hàng ngày + đồng hồ giờ vận hành ───────────
router.get('/forklifts',            requirePerm('forklift', 'view'),           forklift.listForklifts)
router.post('/forklifts',           requirePerm('forklift', 'manage_vehicle'), forklift.createForklift)
router.patch('/forklifts/:id',      requirePerm('forklift', 'manage_vehicle'), forklift.updateForklift)
router.delete('/forklifts/:id',     requirePerm('forklift', 'manage_vehicle'), forklift.deleteForklift)
router.get('/forklift-items',       requirePerm('forklift', 'view'),           forklift.listChecklistItems)
router.post('/forklift-items',      requirePerm('forklift', 'manage_item'),    forklift.createChecklistItem)
router.patch('/forklift-items/:id', requirePerm('forklift', 'manage_item'),    forklift.updateChecklistItem)
router.delete('/forklift-items/:id',requirePerm('forklift', 'manage_item'),    forklift.deleteChecklistItem)
router.get('/forklift-board',       requirePerm('forklift', 'view'),           forklift.getBoard)
router.post('/forklift-logs',       requirePerm('forklift', 'check'),          forklift.saveLog)
router.get('/forklift-logs',        requirePerm('forklift', 'view'),           forklift.listLogs)   // ma trận 1 xe (ĐẶT TRƯỚC /:id)
router.get('/forklift-logs/:id',    requirePerm('forklift', 'view'),           forklift.getLog)
router.delete('/forklift-logs/:id', requirePerm('forklift', 'delete_check'),   forklift.deleteLog)
router.get('/forklift-report',      requirePerm('forklift', 'view'),           forklift.getReport)
router.put('/slotting/location-config',                       requirePerm('slotting', 'configure'), slotting.updateLocationConfig)
// Phiếu cân trạm cân (ingest nằm ở /api/integration — đây là API cho UI)
router.get('/weigh-tickets',                                  requirePerm('weigh_station', 'view'),  weigh.listWeighTickets)
router.get('/weigh-tickets/warehouses',                       requirePerm('weigh_station', 'view'),  weigh.listWeighWarehouses)
router.patch('/weigh-tickets/:id/match',                      requirePerm('weigh_station', 'match'), weigh.matchWeighTicket)

router.get('/outbound/scan-log/facets',                       requirePerm('scanlog', 'view'), outbound.getScanLogFacets)
router.get('/outbound/scan-log/search',                       requirePerm('scanlog', 'view'), outbound.searchScanLog)
router.get('/outbound/scan-log',                              requirePerm('scanlog', 'view'), outbound.getScanLog)
// Đối chiếu SAP — hàng chờ "Cần xử lý" (đăng ký TRƯỚC /outbound/:id để không bị :id nuốt)
router.get('/outbound/reconcile-tasks/count',                 requirePerm('outbound', 'reconcile'), reconcile.reconcileOpenCount)
router.get('/outbound/reconcile-tasks',                       requirePerm('outbound', 'reconcile'), reconcile.listReconcileTasks)
router.post('/outbound/reconcile-tasks/:id/resolve',          requirePerm('outbound', 'reconcile'), reconcile.resolveReconcileTask)
router.get('/outbound/prepare',                               requirePerm('outbound', 'prepare'), outbound.getPrepareBoard)
router.get('/outbound/inventory-by-material',                 requirePerm('outbound', 'prepare'), outbound.getInventoryByMaterial)
router.get('/outbound/pallet-lookup',                         requirePerm('outbound', 'view'), outbound.lookupPalletGdos)
// Cảnh báo thiếu tồn theo (kho, ngày giao) — dùng ở cả Xuất kho lẫn Nhặt lẻ (read-only)
router.get('/outbound/shortages',                             requireAnyPerm(['outbound', 'view'], ['loosepicking', 'view']), outbound.getOutboundShortages)
router.get('/outbound/:id/events',                            requireAnyPerm(['outbound', 'view'], ['loosepicking', 'view']), reconcile.listOutboundEvents)   // nút "Thông tin" — lịch sử thay đổi của chuyến
router.get('/outbound/:id/pick-suggestions',                  requireAnyPerm(['outbound', 'view'], ['loosepicking', 'view']), outbound.getGdoPickSuggestions)   // cột "Vị trí lấy" (FEFO) trang chi tiết
router.get('/outbound/:id',                                   requireAnyPerm(['outbound', 'view'], ['loosepicking', 'view']), outbound.getGDO)
router.put('/outbound/:id',                                   requirePerm('outbound', 'edit'), outbound.updateGDO)
// PATCH nhận cả edit lẫn complete — controller kiểm chi tiết: đổi status=COMPLETED cần
// outbound.complete; các thay đổi khác (ngày giao, pause/resume) cần outbound.edit.
router.patch('/outbound/:id',                                 requireAnyPerm(['outbound', 'edit'], ['outbound', 'complete']), outbound.patchGDO)
router.delete('/outbound/:id',                                requirePerm('outbound', 'cancel'), outbound.deleteGDO)
router.post('/outbound/:id/assign',                           requirePerm('outbound', 'assign'), outbound.assignGDO)
router.post('/outbound/:id/unassign',                         requirePerm('outbound', 'unassign'), outbound.unassignGDO)
router.post('/outbound/:id/start',                            requirePerm('outbound', 'start'), outbound.startGDO)
router.patch('/outbound/:id/transport',                       requirePerm('outbound', 'edit'), outbound.updateTransport)
router.post('/outbound/:id/unstart',                          requirePerm('outbound', 'unstart'), outbound.unstartGDO)
// Duyệt bỏ qua TỪNG RULE Bắt đầu (2 tình huống 2 action riêng — user chốt 01/08): mỗi rule 1 quyền, không đi ké start/edit
router.post('/outbound/:gdoId/weigh-waive',                   requirePerm('outbound', 'weigh_waive'), outbound.waiveWeighGDO)   // rule 2 — cân
router.delete('/outbound/:gdoId/weigh-waive',                 requirePerm('outbound', 'weigh_waive'), outbound.unwaiveWeighGDO)
router.post('/outbound/:gdoId/gate-waive',                    requirePerm('outbound', 'gate_waive'), outbound.waiveGateGDO)     // rule 1 — đăng ký cổng
router.delete('/outbound/:gdoId/gate-waive',                  requirePerm('outbound', 'gate_waive'), outbound.unwaiveGateGDO)
router.post('/outbound/:id/uncomplete',                       requirePerm('outbound', 'uncomplete'), outbound.uncompleteGDO)
router.post('/outbound/:gdoId/items/:itemId/check-scan',      requireAnyPerm(['outbound', 'scan'], ['loosepicking', 'scan']), outbound.checkScanItem)
// Scan/xóa-scan dùng chung cho trang Xuất kho VÀ Nhặt lẻ → chấp nhận quyền của cả 2 module
router.post('/outbound/:gdoId/items/:itemId/scan',            requireAnyPerm(['outbound', 'scan'], ['loosepicking', 'scan']), outbound.scanItem)
router.delete('/outbound/:gdoId/items/:itemId/scans/:scanId', requireAnyPerm(['outbound', 'scan'], ['loosepicking', 'scan']), outbound.deleteScanEntry)
router.patch('/outbound/scan-entries/:scanId/cartons',        requireAnyPerm(['outbound', 'scan'], ['loosepicking', 'scan']), outbound.attachCartonScans)   // đính mã thùng (truy vết)
// "Lưu thủ công" = ghi nhận xuất cho hàng không QR (trừ tồn + tạo scan entry) → là capability QUÉT, không phải complete
router.post('/outbound/:gdoId/items/:itemId/manual-complete', requirePerm('outbound', 'scan'), outbound.manualCompleteItem)
router.post('/outbound/:gdoId/items/:itemId/confirm-loose',   requireAnyPerm(['outbound', 'complete'], ['loosepicking', 'complete']), outbound.confirmLoosePickingItem)
// "Lưu thủ công nhặt lẻ" = ghi số thùng lẻ tay cho hàng không QR (reserve, trừ khi Check) → capability QUÉT
router.post('/outbound/:gdoId/items/:itemId/manual-loose',    requireAnyPerm(['outbound', 'scan'], ['loosepicking', 'scan']), outbound.manualLooseItem)
router.get('/outbound/:gdoId/items/:itemId/inventory',        requireAnyPerm(['outbound', 'view'], ['loosepicking', 'view']), outbound.getItemInventory)
router.get('/outbound/:gdoId/items/:itemId/manual-stock',     requirePerm('outbound', 'view'), outbound.getManualItemStock)

export default router
