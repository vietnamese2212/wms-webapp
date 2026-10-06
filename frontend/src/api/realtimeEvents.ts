import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabaseClient } from '@/lib/supabase'
import { queryClient } from './queryClient'
import { apiClient } from './client'
import type { DeliverySlot, TmsOrder } from '@/types'

// Maps table name → query keys to invalidate (fallback refetch).
const TABLE_QUERY_MAP: Record<string, string[][]> = {
  ProductionImport:    [['inbound-orders'], ['inbound-orders-paged'], ['inbound-summary'], ['inbound-facets'], ['inbound-order'], ['inbound-report'], ['transfer-goods'], ['inbound-by-gdo'], ['tms-orders-transfer'], ['tms-material-summary'], ['dashboard'], ['control-tower']],
  // inbound-orders (list): cột Thực nhập/Tiến độ/pallet gộp từ InventoryEntry — thiếu key này list đứng im tới 60s khi user khác quét/xóa pallet
  // slotting-plan(s): tiến độ kế hoạch sắp xếp suy từ location_id hiện tại — pallet được chuyển phải nhảy tick ngay
  InventoryEntry:      [['inbound-order'], ['inbound-orders'], ['inbound-orders-paged'], ['inbound-summary'], ['inbound-facets'], ['inventory-entries'], ['inventory-summary'], ['inventory-facets'], ['locations-real'], ['plan-vs-actual'], ['inbound-report'], ['manual-item-stock'], ['item-inventory'], ['inventory-by-material'], ['transfer-goods'], ['inbound-by-gdo'], ['stocktake-entries'], ['stocktake-log'], ['tms-material-summary'], ['dashboard'], ['outbound-shortages'], ['slotting-plan'], ['slotting-plans'], ['fill-demand'], ['fill-tasks'], ['warehouse-map-occupancy']],
  StocktakeLog:        [['stocktake-log'], ['move-log']],
  // warehouse-map: bản vẽ Sơ đồ kho đọc toạ độ/kệ/loại ô từ Location — người khác đặt ô là bản vẽ mình đổi theo
  Location:            [['locations-real'], ['sub-groups'], ['dashboard'], ['fill-demand'], ['fill-pick-face-locations'], ['warehouse-map'], ['outbound-docks']],
  warehouse_maps:      [['warehouse-map']],
  // Fill hàng: màn danh sách lệnh + chi tiết lệnh phải sáng ngay khi người khác quét/gán/hủy
  // (không F5); fill-demand vì dòng treo được trừ vào phần "thiếu" của mã đó.
  FillTask:            [['fill-orders'], ['fill-order'], ['fill-demand'], ['fill-report'], ['work-inbox']],
  FillOrder:           [['fill-orders'], ['fill-order'], ['work-inbox']],
  // gdos/gdo: cột Tổng (QR)/(k QR) của Xuất tách theo Material.no_qr_tracking (join sống) —
  // đổi cờ QR của mã hàng phải refetch list Xuất, không thì số liệu đứng im tới khi reload.
  // materials-paged/summary: trang danh mục phân trang SERVER — key RIÊNG, không nằm dưới tiền tố
  // ['materials'] (TanStack khớp theo từng phần tử) nên thiếu 2 key này là trang đứng im sau khi sửa.
  Material:            [['materials'], ['materials-paged'], ['materials-summary'], ['materials-pallet-carriers'], ['gdos'], ['gdo']],
  Manufacturer:        [['manufacturers']],
  PalletLabelPrint:    [['pallet-prints'], ['pallet-prints-paged'], ['pallet-print-facets']],
  PalletOperation:     [['pallet-ops-log'], ['pallet-ops-paged']],
  InventoryAdjustmentLog: [['adjustment-log']],   // prefix khớp ['adjustment-log', entryId]
  Warehouse:           [['warehouses'], ['dispatch-plan-geo']],
  // Danh mục Khách hàng nuôi quy định date tự động ⇒ đổi khách là màn Quy định date phải đổi theo (11/09)
  Customer:            [['customers'], ['customer-channels'], ['customer-seed-candidates'], ['date-rule-lines'], ['customer-geo-status'], ['dispatch-plan-geo']],
  // Mức theo (khách|kênh) × loại hàng — cùng bộ màn với Customer vì nó là phần "mức" của chính khách
  date_rule_master:    [['customers'], ['customer-channels'], ['date-rule-lines']],
  WarehouseZone:       [['warehouse-zones'], ['dashboard']],
  LookupValue:         [['lookup']],            // prefix khớp ['lookup','warehouse_type'] & ['lookup',type]
  ImportShift:         [['import-shifts']],
  QAStatus:            [['qa-statuses']],
  SystemSetting:       [['system-settings'], ['warehouse-kpi'], ['warehouse-kpi-series'], ['kpi-targets'], ['kpi-meanings']],
  VehicleType:         [['tms-vehicle-types']],
  SlotTemplate:        [['tms-slot-templates'], ['tms-vehicle-types-by-warehouse']],   // by-warehouse derive từ SlotTemplate
  TransportCompany:    [['tms-transport-companies'], ['tms-vehicles']],                // vehicle embed ncc
  Vehicle:             [['tms-vehicles']],
  // transfer-goods/inbound-by-gdo/plan-vs-actual: BE cập nhật TmsOrder khi nhận chuyển kho (receiving_started_at, status DONE…) — user khác xem tiến độ nhận phải thấy ngay
  TmsOrder:            [['tms-orders-paged'], ['tms-orders-summary'], ['tms-orders-facets'], ['tms-orders-transfer'], ['transfer-goods'], ['inbound-by-gdo'], ['plan-vs-actual'], ['tms-material-summary'], ['work-inbox']],
  // booking-sequence: STT chuẩn bị theo booking (list Xuất kho + board Chuẩn bị hàng) — đặt/hủy/đổi khung giờ là số tự nhảy
  TmsVehicleSlot:      [['tms-orders-paged'], ['tms-orders-summary'], ['tms-consolidatable'], ['gate-registrations'], ['gate-suggest'], ['booking-sequence']],
  DeliverySlot:        [['tms-delivery-slots'], ['booking-sequence']],
  gate_registrations:  [['gate-registrations'], ['gate-tree'], ['gate-leaves'], ['control-tower']],
  alert_events:        [['alerts-list']],
  user_notifications:  [['notify-feed']],   // chuông Header nhảy badge ngay khi được giao việc
  inbound_plan_lines:  [['inbound-plan-lines-by-order'], ['plan-vs-actual'], ['inbound-plan-lines'], ['inbound-report'], ['tms-material-summary'], ['outbound-shortages']],
  // fill-demand: "Cần" của tab Đề xuất fill = đơn nhặt lẻ theo NGÀY XUẤT — đơn phát sinh/đổi ngày
  // phải làm số nhảy ngay với người đang mở tab (user chốt 05/08), không chờ F5.
  GroupDeliveryOrder:  [['gdos'], ['gdos-paged'], ['outbound-summary'], ['outbound-facets'], ['gdo'], ['tms-orders-transfer'], ['loosepicking'], ['dashboard'], ['outbound-shortages'], ['control-tower'], ['tms-plan-goods'], ['fill-demand'], ['outbound-docks'], ['directed-board'], ['work-inbox'], ['directed-supervision']],
  // list Xuất phân trang: tổng SummaryBand + phân bổ NPP tính từ DO/Item → đổi dòng hàng
  // phải refetch cả summary, không thì số đứng im cho tới lần poll sau.
  // Việc cần làm (1c): 3 vai nhìn 3 bảng khác nhau trên CÙNG kế hoạch — một người bấm '✓ Xong'
  // hay thủ kho quét thì hai màn còn lại phải đổi ngay, không chờ ai F5.
  // fill-demand: phần "thiếu" của Fill có TRỪ việc LOOSE_FEED đang treo (15/09) — kế hoạch được sắp
  // lại mà bảng này đứng im thì người mở trang Fill thấy số cũ và ra lệnh cho thứ đã có người lo.
  wms_tasks:           [['directed-board'], ['gdo'], ['gdos'], ['work-inbox'], ['directed-supervision'], ['fill-demand']],
  OutboundDelivery:    [['gdo'], ['gdos-paged'], ['outbound-summary'], ['outbound-facets'], ['tms-plan-goods']],
  // `directed-board` từ 13/09: bảng Việc cần làm nay đọc cả YÊU CẦU DATE và TIẾN ĐỘ DÒNG HÀNG của
  // chuyến, nên dòng đơn đổi (chốt date, quét thêm) phải làm mới bảng — không chỉ khi wms_tasks đổi.
  OutboundItem:        [['gdo'], ['gdos-paged'], ['outbound-summary'], ['outbound-facets'], ['loosepicking'], ['item-inventory'], ['inventory-by-material'], ['dashboard'], ['outbound-shortages'], ['tms-plan-goods'], ['fill-demand'], ['date-rule-lines'], ['work-inbox'], ['directed-board']],
  OutboundScanEntry:   [['gdo'], ['gdos-paged'], ['outbound-summary'], ['loosepicking'], ['item-inventory'], ['inventory-by-material'], ['outbound-shortages'], ['control-tower']],
  reconcile_tasks:     [['reconcile-tasks'], ['reconcile-open-count'], ['work-inbox'], ['dispatch-decisions']],   // hàng chờ "Cần xử lý" đối chiếu SAP — engine ghi khi up VL06O/sửa DO SAP
  // Dữ liệu bên ngoài — cross-invalidate 2 CHIỀU: DO SAP hiện cột Số xe/Ngày xuất từ khvc; Kế hoạch xuất hiện "Trong DO SAP" từ raw.
  // Đổi 1 bảng → list bảng kia phải refetch (cột/filter chéo mới đúng), + facets của chính nó.
  // bàn điều vận (sync · Xem đơn · dấu tay · chi tiết OD · hàng chờ) KHÔNG tải thẳng nữa (06/10) — `scheduleDispatchInputsCheck` hỏi dấu đầu vào của kho
  erp_outbound_orders: [['do-sap'], ['do-sap-facets'], ['khvc'], ['gdos-paged'], ['gdo'], ['gdo-events']],   // VL06O/ZSD02 về → chuyến chờ tự kích hoạt (không cần F5)
  erp_so_lines:        [['so-lines'], ['so-lines-summary']],   // sổ SO (dòng ZSD02 chưa có OD) — tab "Chưa có OD"
  vehicle_model:         [['vehicle-models']],                   // dòng xe CON mã SAP (23/09)
  warehouse_vehicle_model: [['vehicle-models']],                 // cấu hình riêng của KHO cho dòng xe (03/10) — cùng danh sách
  freight_tariff:        [['freight-tariffs']],                  // bảng cước
  freight_surcharge:     [['freight-surcharges']],               // phụ phí
  carrier_allocation:    [['freight-allocations']],              // ưu tiên ĐVVT theo khu vực
  carrier_share_target:  [['freight-allocations']],              // tỷ trọng ĐVVT
  // kế hoạch ghép chuyến nháp (24/09). ['dispatch-plan'] của ba bảng này KHÔNG tải lại thẳng nữa (06/10) — `scheduleDispatchStampCheck`
  // hỏi dấu phiên bản từng kế hoạch đang mở, khác dấu mới tải: tiếng vọng thao tác của chính mình / kế hoạch kho khác không tải 3,9 MB
  dispatch_plan:         [['dispatch-plans']],
  dispatch_trip:         [],
  // bàn ghép xe: hai người cùng kéo thả một kế hoạch thấy nhau. KHÔNG kéo theo dispatch-sync / dispatch-review (03/10, quota egress):
  // kéo thả không đổi dữ liệu SAP — hai cửa đó chỉ cần làm mới khi ZSD02 / Kế hoạch xuất / dấu hoãn đổi (erp_outbound_orders, khvc_lines…)
  dispatch_trip_od:      [],
  // Sổ dấu tay · mảng · phả hệ DO · Kế hoạch xuất là ĐẦU VÀO của bàn điều vận: người khác đánh dấu / Điều lại / lấy đơn sang mảng kia /
  // đơn vào KH xuất ⇒ bàn của KHO ĐÓ thấy ngay qua `scheduleDispatchInputsCheck` (06/10 — trước đó tải thẳng ở mọi kho). Đơn rời khung
  // chờ là ghi dispatch_trip_od (trigger) ⇒ chính kế hoạch đi đường hỏi dấu phiên bản, không cần ['dispatch-plan'] ở đây.
  dispatch_od_hold:      [],   // Hoãn / Không điều OD (27/09)
  dispatch_od_segment:   [['dispatch-plans']],   // lấy đơn sang mảng khác (03/10 tối)
  dispatch_od_outside:   [['zsd02-coverage']],   // dấu Ngoài app (03/10 tối) — đổi cả "ngày tạo cần phủ" của màn upload
  od_lineage:            [],   // phả hệ DO (thay · tách · gộp) — cờ họ hàng trên bàn
  outbound_events:     [['gdo-events']],
  khvc_lines:          [['khvc'], ['khvc-facets'], ['do-sap']],
  WeighTicket:         [['weigh-tickets'], ['weigh-ticket-warehouses'], ['control-tower']],
  SlottingPlan:        [['slotting-plans'], ['slotting-plan'], ['work-inbox']],
  SlottingPlanLine:    [['slotting-plans'], ['slotting-plan']],
  forklift_vehicles:        [['forklifts'], ['forklift-board'], ['forklift-report']],
  forklift_checklist_items: [['forklift-items']],
  forklift_daily_logs:      [['forklift-board'], ['forklift-report'], ['forklift-log'], ['forklift-logs-matrix']],
  packing_logs:             [['packing-board'], ['packing-logs'], ['packing-run-board'], ['packing-runs'], ['packing-run']],
  packing_runs:             [['packing-run-board'], ['packing-runs'], ['packing-run']],
  warehouse_machines:       [['machines']],
  // `Employee` ĐÃ GỠ KHỎI BẢN ĐỒ (04/08): bảng nhân sự CỐ Ý không nằm trong publication realtime và
  // không có policy đọc cho `authenticated` — dữ liệu HR chỉ ra ngoài qua API đã cắt scope. Giữ dòng
  // map ở đây là lời hứa suông: sự kiện KHÔNG BAO GIỜ tới, người đọc code lại tưởng đã có realtime.
  // Muốn realtime cho nhân sự thì phải quyết định mở đọc bảng này trước (quyết định về dữ liệu, không
  // phải kỹ thuật). Bất biến "bảng khai realtime phải nhận được sự kiện" ở gói QA 00 gác luật này.
  JobTitle:             [['job-titles'], ['employee-records'], ['employee-records-paged']],
  Department:           [['departments'], ['job-titles']],
  UserWarehouseAccess:  [['employee-record'], ['employee-records'], ['employee-records-paged']],
  Skill:                [['hr-skills'], ['hr-emp-skills']],
  EmployeeSkill:        [['hr-emp-skills']],
  LeaveRequest:         [['hr-leaves'], ['hr-leaves-paged']],
  WorkAssignmentSheet:  [['hr-sheets'], ['hr-sheet']],
  WorkAssignmentDemand: [['hr-sheet']],
  WorkAssignment:       [['hr-sheet']],
  WorkLayout:           [['hr-layouts'], ['hr-layout']],
  WorkLayoutSkill:      [['hr-layout']],
  WorkLayoutJobTitle:   [['hr-layout']],
  ShiftRestRule:        [['hr-shift-rules']],
  Attendance:           [['hr-attendance'], ['hr-attendance-matrix'], ['hr-att-report']],
  // Chấm sao chuyến + Chi phí kho (user chốt 31/08 "2 mục này cần realtime"): kho nhận chấm sao
  // → tab Dịch vụ + khối rating trên chuyến của người khác tự cập nhật; kế toán A chốt kỳ / sửa
  // dòng chi phí → màn của kế toán B sáng ngay (trước đây phải F5). Policy SELECT: migration
  // 20260831_realtime_costs_policy (thiếu policy = sự kiện chết CÂM).
  receipt_ratings:      [['service-level'], ['receipt-rating']],
  trace_investigations: [['trace-investigations']],
  warehouse_costs:      [['warehouse-costs']],
  warehouse_cost_locks: [['warehouse-costs']],
}

// Gói tin từ trigger DB `wms_notify_change` (migration 20260902b) — TỐI THIỂU có chủ đích: tên bảng +
// loại thao tác, và CHỈ 2 bảng kèm dữ liệu dòng mà FE thật sự dùng. KHÔNG BAO GIỜ có cột nghiệp vụ:
// kênh Broadcast này là thứ DUY NHẤT vai authenticated còn đọc được ở Supabase — từ 02/09 vé realtime
// không mở được bảng nào qua PostgREST nữa (trước đó 64 policy USING(true) để nuôi postgres_changes
// đã biến vé thành chìa khoá đọc trọn DB cho mọi tài khoản đăng nhập).
interface ChangeMsg {
  table: string
  op: 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE'
  row_id?: string                 // DeliverySlot · ProductionImport (trigger mức dòng)
  booked_count?: number | null    // DeliverySlot UPDATE — patch cache khung giờ tức thì, không chờ refetch
}

// Patch DeliverySlot cache trực tiếp — cập nhật booked_count trong slot list VÀ trong
// slot object embedded trong TmsOrder.vehicle_slots[].slot
function patchSlotCache(msg: ChangeMsg) {
  if (msg.op !== 'UPDATE' || !msg.row_id || typeof msg.booked_count !== 'number') return
  const id = msg.row_id, booked = msg.booked_count

  // 1. Patch tms-delivery-slots cache
  queryClient.setQueriesData<DeliverySlot[]>(
    { queryKey: ['tms-delivery-slots'] },
    (old) => {
      if (!Array.isArray(old)) return old
      return old.map(s => (s.id === id ? { ...s, booked_count: booked } : s))
    }
  )

  // 2. Patch slot embedded trong TmsOrder.vehicle_slots[].slot
  const patchOrder = (o: TmsOrder): TmsOrder => ({
    ...o,
    vehicle_slots: o.vehicle_slots.map(vs =>
      vs.slot_id === id && vs.slot
        ? { ...vs, slot: { ...vs.slot, booked_count: booked } }
        : vs
    ),
  })
  // Lưới Kế hoạch đã phân trang server → cache là { rows, total… }, không phải mảng
  queryClient.setQueriesData<{ rows: TmsOrder[] }>(
    { queryKey: ['tms-orders-paged'] },
    (old) => (old?.rows ? { ...old, rows: old.rows.map(patchOrder) } : old)
  )
}

// Hai kênh Broadcast RIÊNG TƯ (đòi vé role=authenticated — setRealtimeAuth phải chạy TRƯỚC connect):
//  • `wms-db-changes`: mọi bảng — tín hiệu chung cho cả app.
//  • `wms-user-<employee_id>`: riêng user_notifications của ĐÚNG người này — thông báo đích danh không
//    làm hàng trăm máy khác cùng refetch, và không lộ ai-được-báo cho ai.
const SHARED_TOPIC = 'wms-db-changes'
let channel: RealtimeChannel | null = null
let userChannel: RealtimeChannel | null = null
let userTopic = ''
// Đang tự đóng kênh (logout) — trạng thái CLOSED lúc đó KHÔNG phải đứt kết nối.
let closing = false
// Đã từng đứt realtime kể từ lần SUBSCRIBED gần nhất — để phân biệt "nối lần đầu"
// với "nối LẠI sau đứt" (chỉ trường hợp sau mới cần invalidate toàn bộ).
let hadRealtimeDisconnect = false

// Time-based cooldown to block late Realtime events that arrive after a mutation
// settles but before all backend DB writes have propagated. isMutating() drops to 0
// the moment the HTTP response lands, but Supabase Realtime events can arrive 100-800ms
// later — creating a window where intermediate state triggers a premature refetch.
// Mutations call suppressTmsOrdersRealtime() on start (5s) and again on settle (2.5s).
let suppressTmsOrdersUntil = 0

export function suppressTmsOrdersRealtime(ms: number): void {
  suppressTmsOrdersUntil = Date.now() + ms
}

// Lịch sử quét (['outbound-scan-log']) chạy bằng RPC nặng + phân trang → KHÔNG map thẳng vào
// TABLE_QUERY_MAP (mỗi lần quét toàn hệ thống sẽ refetch ngay → bão request). Thay vào đó: THROTTLE
// — gộp burst quét, refetch tối đa 1 lần / 3s. invalidateQueries chỉ refetch query ĐANG mở (trang
// ScanLog), còn lại chỉ đánh dấu stale → không tốn gì khi không ai xem.
let scanLogTimer: ReturnType<typeof setTimeout> | null = null
function scheduleScanLogRefresh(): void {
  if (scanLogTimer) return
  scanLogTimer = setTimeout(() => {
    scanLogTimer = null
    queryClient.invalidateQueries({ queryKey: ['outbound-scan-log'] })
    queryClient.invalidateQueries({ queryKey: ['outbound-scan-log-search'] })
  }, 3000)
}

// COALESCE refetch theo từng query-key: gộp BURST sự kiện realtime thành tối đa 1
// refetch / cửa sổ. Trước đây mỗi event gọi invalidateQueries thẳng → 1 thao tác
// hàng loạt (upload, reset) hoặc HÀNG TRĂM user book cùng lúc sinh ra hàng trăm
// event → mỗi client refetch list 'tms-orders' (~2MB) hàng trăm lần → trình duyệt
// cạn kết nối (ERR_INSUFFICIENT_RESOURCES), UI không settle, BE bị dội.
// Giải: lịch trailing-edge — event đầu hẹn refetch sau COALESCE_MS, mọi event trong
// cửa sổ bị gộp. Bảng cập-nhật-liên-tục → refetch đều ~1 lần/cửa sổ thay vì N lần.
// (booked_count slot vẫn cập nhật TỨC THÌ qua patchSlotCache, không chờ refetch.)
const COALESCE_MS = 1000
const invalidateTimers = new Map<string, ReturnType<typeof setTimeout>>()
function coalescedInvalidate(key: string[]): void {
  const id = JSON.stringify(key)
  if (invalidateTimers.has(id)) return
  invalidateTimers.set(id, setTimeout(() => {
    invalidateTimers.delete(id)
    queryClient.invalidateQueries({ queryKey: key })
  }, COALESCE_MS))
}

// KẾ HOẠCH ĐIỀU VẬN (06/10): tín hiệu của dispatch_plan / dispatch_trip / dispatch_trip_od chỉ mang {table, op} — trước đây mỗi lần
// ghi (kể cả của chính người vừa kéo thả) làm MỌI bàn đang mở tải lại CẢ kế hoạch (709 xe = 3,9 MB). Nay gộp burst rồi hỏi DẤU PHIÊN
// BẢN của từng kế hoạch đang mở (1 request nhỏ): trùng dấu đang giữ thì thôi, khác mới tải lại. Chính người này còn đang ghi (thao tác
// chưa về) thì hoãn — phần thay đổi về tới sẽ mang dấu mới. Hỏi dấu hỏng ⇒ tải lại (an toàn hơn đứng im).
const DISPATCH_PLAN_TABLES = new Set(['dispatch_plan', 'dispatch_trip', 'dispatch_trip_od'])
let dispatchCheckTimer: ReturnType<typeof setTimeout> | null = null
function scheduleDispatchStampCheck(delay = COALESCE_MS): void {
  if (dispatchCheckTimer) return
  dispatchCheckTimer = setTimeout(() => {
    dispatchCheckTimer = null
    if (queryClient.isMutating({ mutationKey: ['dispatch-write'] })) { scheduleDispatchStampCheck(); return }
    for (const q of queryClient.getQueryCache().findAll({ queryKey: ['dispatch-plan'], type: 'active' })) {
      const id = q.queryKey[1]
      const held = (q.state.data as { stamp?: string | null } | undefined)?.stamp
      if (typeof id !== 'string') continue
      if (!held) { void queryClient.invalidateQueries({ queryKey: q.queryKey }); continue }
      apiClient.get(`/tms/dispatch/plans/${id}/stamp`)
        .then(r => { if ((r.data?.data?.stamp ?? null) !== held) void queryClient.invalidateQueries({ queryKey: q.queryKey }) })
        .catch(() => { void queryClient.invalidateQueries({ queryKey: q.queryKey }) })
    }
  }, delay)
}

// ĐẦU VÀO CỦA BÀN ĐIỀU VẬN (06/10): ZSD02 · Kế hoạch xuất · sổ dấu tay · mảng · phả hệ DO — tín hiệu không mang kho, nên trước đây ghi ở
// kho NÀO cũng làm MỌI bàn đang mở tải lại sync · Xem đơn · dấu tay · chi tiết OD · hàng chờ. Đo 06/10 (log Vercel 10 phút, gói QA 61 ở
// kho QA61): một bàn Ba Vì 3.529 đơn đang mở tải lại review 36 · decisions 42 · marks 38 lần ⇒ PostgREST kín 10 khe, lập nháp ở kho kia
// quá 8 s ⇒ 503. Nay gộp burst rồi hỏi DẤU ĐẦU VÀO của từng kho đang xem (1 câu nhẹ, RPC dispatch_inputs_stamp): trùng dấu đã giữ thì
// thôi, khác mới tải các khoá nặng của ĐÚNG kho đó. Lần hỏi đầu chưa có dấu để so ⇒ tải (thà thừa một lần còn hơn bỏ sót).
const DISPATCH_INPUT_TABLES = new Set(['erp_outbound_orders', 'khvc_lines', 'dispatch_od_hold', 'dispatch_od_outside', 'dispatch_od_segment', 'od_lineage'])
const DISPATCH_INPUT_KEYS = ['dispatch-sync', 'dispatch-review', 'dispatch-marks', 'dispatch-od']   // theo id kế hoạch
const dispatchInputsHeld = new Map<string, string>()   // kho → dấu đầu vào lúc tải gần nhất
let dispatchInputsTimer: ReturnType<typeof setTimeout> | null = null
function scheduleDispatchInputsCheck(): void {
  if (dispatchInputsTimer) return
  dispatchInputsTimer = setTimeout(() => {
    dispatchInputsTimer = null
    const plansOf = new Map<string, string[]>()   // kho → kế hoạch đang mở của kho đó
    for (const q of queryClient.getQueryCache().findAll({ queryKey: ['dispatch-plan'], type: 'active' })) {
      const id = q.queryKey[1], wh = (q.state.data as { warehouse_id?: string } | undefined)?.warehouse_id
      if (typeof id === 'string' && wh) plansOf.set(wh, [...(plansOf.get(wh) ?? []), id])
    }
    for (const q of queryClient.getQueryCache().findAll({ queryKey: ['dispatch-decisions'], type: 'active' })) {
      const wh = q.queryKey[1]
      if (typeof wh === 'string' && wh && !plansOf.has(wh)) plansOf.set(wh, [])
    }
    for (const [wh, ids] of plansOf) {
      apiClient.get('/tms/dispatch/inputs-stamp', { params: { warehouse_id: wh } })
        .then(r => (r.data?.data?.stamp ?? null) as string | null, () => null)
        .then(s => {
          if (s && dispatchInputsHeld.get(wh) === s) return
          if (s) dispatchInputsHeld.set(wh, s)
          for (const id of ids) for (const k of DISPATCH_INPUT_KEYS) void queryClient.invalidateQueries({ queryKey: [k, id] })
          void queryClient.invalidateQueries({ queryKey: ['dispatch-decisions', wh] })
        })
    }
  }, COALESCE_MS)
}

function onChange(msg: ChangeMsg): void {
  if (!msg?.table) return
  if (msg.table === 'DeliverySlot') patchSlotCache(msg)
  if (DISPATCH_PLAN_TABLES.has(msg.table)) scheduleDispatchStampCheck()
  if (DISPATCH_INPUT_TABLES.has(msg.table)) scheduleDispatchInputsCheck()

  // Lịch sử quét: refetch throttle khi có quét xuất/nhặt lẻ thay đổi
  if (msg.table === 'OutboundScanEntry') scheduleScanLogRefresh()

  // Khi ProductionImport thay đổi (kể cả SQL-level delete), xóa localStorage
  // list cache để tránh ghost record flash khi component mount lại.
  if (msg.table === 'ProductionImport') {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('wms:io:'))
        .forEach(k => localStorage.removeItem(k))
      if (msg.op === 'DELETE' && msg.row_id) localStorage.removeItem(`wms:io-detail:${msg.row_id}`)
    } catch {}
  }

  // Invalidate để eventual consistency (background refetch sau patch)
  const keys = TABLE_QUERY_MAP[msg.table]
  if (!keys) return

  // Trong window suppressTmsOrdersUntil (set bởi booking mutations), bỏ qua
  // invalidation tms-orders — tránh intermediate state từ sequential DB writes.
  // isMutating() bị loại khỏi check vì nó block cả gate mutations (same SPA).
  const suppress = Date.now() < suppressTmsOrdersUntil
  keys.forEach((k) => {
    if (suppress && (k[0] === 'tms-orders-paged' || k[0] === 'tms-orders-summary')) return
    coalescedInvalidate(k)
  })
}

function onStatus(label: string) {
  return (status: string, err?: Error) => {
    if (status === 'SUBSCRIBED') {
      // Nối LẠI sau khi đứt (không phải lần subscribe đầu): mọi event trong lúc đứt
      // đã mất vĩnh viễn → invalidate toàn bộ để list refetch, xóa dữ liệu stale.
      if (hadRealtimeDisconnect) {
        hadRealtimeDisconnect = false
        console.info(`[realtime] ${label} reconnected — invalidating all queries (missed events)`)
        queryClient.invalidateQueries()
      } else {
        console.info(`[realtime] ${label} connected`)
      }
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || (status === 'CLOSED' && !closing)) {
      hadRealtimeDisconnect = true
      // "Unauthorized" ở đây = thiếu vé (chưa setRealtimeAuth / SUPABASE_JWT_SECRET chưa cấu hình)
      console.warn(`[realtime] ${label} disconnected, retrying:`, status, err?.message ?? '')
    }
  }
}

export function connectRealtimeEvents(employeeId?: string | null): void {
  if (!supabaseClient) return
  closing = false

  if (!channel) {
    channel = supabaseClient
      .channel(SHARED_TOPIC, { config: { private: true } })
      .on('broadcast', { event: 'db_change' }, ({ payload }) => onChange(payload as ChangeMsg))
      .subscribe(onStatus('kênh chung'))
  }

  // Kênh cá nhân đi theo NGƯỜI ĐANG ĐĂNG NHẬP: đổi tài khoản trong cùng tab SPA → đổi kênh.
  const topic = employeeId ? `wms-user-${employeeId}` : ''
  if (userChannel && userTopic !== topic) {
    supabaseClient.removeChannel(userChannel)
    userChannel = null
    userTopic = ''
  }
  if (topic && !userChannel) {
    userTopic = topic
    userChannel = supabaseClient
      .channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'db_change' }, ({ payload }) => onChange(payload as ChangeMsg))
      .subscribe(onStatus('kênh cá nhân'))
  }
}

export function disconnectRealtimeEvents(): void {
  if (!supabaseClient) return
  closing = true
  if (channel) { supabaseClient.removeChannel(channel); channel = null }
  if (userChannel) { supabaseClient.removeChannel(userChannel); userChannel = null; userTopic = '' }
}
