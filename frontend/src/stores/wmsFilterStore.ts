import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

interface OutboundFilters {
  search: string
  dateFrom: string
  dateTo: string
  filterTypes: string[]
  filterDvvts: string[]
  filterNpps: string[]
  filterMaterials: string[]
  warehouseId: string
  filterWarehouseTypes: string[]
  filterStatuses: string[]
  page: number        // phân trang server (28/07) — mọi filter đổi phải reset page: 1
  pageSize: number
}
interface OutboundPrepareFilters {
  date: string
  warehouseId: string
}
interface InboundFilters {
  search: string
  dateFrom: string
  dateTo: string
  filterShiftIds: string[]
  filterSourceTypes: string[]
  warehouseId: string
  materialCategory: string
  filterMaterials: string[]
  filterCycles: string[]
  filterMachines: string[]
  importerSearch: string
  page: number        // phân trang server (27/07) — mọi filter đổi phải reset page: 1
  pageSize: number
}
interface InventoryFilters {
  search: string
  warehouseIds: string[]
  materialCategories: string[]
  filterLocations: string[]
  filterMaterialIds: string[]
  qaStatusIds: string[]
  status: string
  page: number
  pageSize: number
  manufacturerId: string
  filterCycles: string[]
  filterMachines: string[]
  filterNmsx: string[]
  nccIds: string[]
  datePctRanges: string[]
  importDateFrom: string   // lọc theo NGÀY NHẬP KHO (import_date), khác Ngày SX
  importDateTo: string
}
interface LoosePickingFilters {
  warehouseId: string
  dateFrom: string
  dateTo: string
  search: string
  filterDvvts: string[]
  filterNpps: string[]
  filterWarehouseTypes: string[]
  filterTypes: string[]
  page: number
  pageSize: number
}
export interface ScanLogFilters {
  from_date: string
  to_date: string
  warehouses: string[]
  material_category: string
  group_code: string
  distributor: string
  delivery_code: string
  pallet_code: string
  materials: string[]
  machines: string[]
  cycles: string[]
  scanner_name: string
  nmsx: string[]
  search: string   // SEARCH TỔNG (bypass Kho/Loại kho) — QR pallet/thùng, NPP, tên/mã hàng…
}
export interface ControlTowerFilters {
  warehouse_ids: string[]     // kho đang giám sát (rỗng = mọi kho trong scope)
  categories: string[]        // Loại kho (rỗng = mọi loại trong scope)
  material_codes: string[]    // soi đích danh mã hàng (2 khối hàng-theo-mã)
}
export interface WeighTicketFilters {
  from_date: string
  to_date: string
  direction: string     // '' | 'Cân Xuất' | 'Cân Nhập'
  match_state: string   // '' | 'matched' | 'unmatched' | 'pending'
  warehouse_ids: string[]  // kho của trạm cân (nhiều kho tích hợp sau này)
  search: string
}
export type FlagMode = '' | 'yes' | 'no'
interface LocationsFilters {
  search: string
  warehouseId: string
  catFilter: string
  zoneFilter: string[]      // Khu vực kho (sub_code) — đổi Kho thì reset (khu thuộc kho)
  statusFilter: string[]
  // Hai cờ vị trí, mỗi cờ 3 trạng thái: '' = không lọc · 'yes' = có cờ · 'no' = chưa có cờ.
  // (Đổi tên khỏi flagFilter/pickFaceFilter cũ kiểu boolean — tên mới để giá trị đã nhớ của
  // phiên cũ không bị đọc nhầm thành 'yes'/'no'.)
  flagMode: FlagMode        // requires_stocktake — cần check hàng ngày
  pickFaceMode: FlagMode    // is_pick_face — vị trí nhặt lẻ
  page: number
  pageSize: number
}
export type StocktakeView = 'problem' | 'flagged' | 'unchecked' | 'checked' | 'all'
interface StocktakeFilters {
  warehouseId: string
  category: string
  locationId: string
  requiresOnly: boolean
}
interface StocktakeSummaryFilters {
  warehouseId: string
  category: string
  locationIds: string[]
  requiresOnly: boolean
  view: StocktakeView
  page: number
  pageSize: number
}
interface StocktakeHistoryFilters {
  warehouseId: string
  category: string
  locationIds: string[]
  requiresOnly: boolean   // "Chỉ vị trí cần check" — giới hạn vào vị trí đã gắn cờ
  dateFrom: string   // Ngày kiểm (mặc định 7 ngày gần nhất)
  dateTo: string
  search: string
  page: number
  pageSize: number
}
interface GateRegistrationFilters {
  fDate: string
  fDateTo: string
  fWarehouse: string
  fWarehouseType: string
  fVehicleTypes: string[]
  fCompany: string
  fDirection: string
  fStatus: string
}
interface MaterialsFilters {
  search: string
  catFilter: string[]
  statusFilter: string[]
  qrFilter: string[]
  dqFilter: string[]   // chất lượng dữ liệu: 'incomplete' (thiếu thông tin) | 'dup' (trùng tên)
  page: number
  pageSize: number
}
interface InboundReportFilters {
  dateFrom: string
  dateTo: string
  warehouseId: string
  selCategories: string[]
}
interface AssignmentFilters {
  search: string
  warehouseId: string
  layoutId: string
  dateFrom: string
}
interface TmsBookingsFilters {
  search: string
  dateFrom: string
  dateTo: string
  warehouseId: string
  loaiKho: string[]
  loaiXe: string[]
  huong: string[]
  dvvt: string[]
  khungGio: string[]
  tab: 'main' | 'transfer'
  page: number
  pageSize: number
}
interface TmsTransferFilters {
  search: string
  dateFrom: string
  dateTo: string
  khoXuat: string[]
  khoNhan: string[]
}
interface UserAdminFilters {
  search: string
  warehouseId: string
  deptId: string
  jtId: string
  status: 'active' | 'hidden' | 'all'
  jtDept: string          // tab Chức danh: lọc theo phòng ban
  page: number
  pageSize: number
}
interface AttendanceTeamFilters {
  view: 'matrix' | 'raw'
  warehouseId: string
  deptId: string
  jt: string
  q: string
  status: 'all' | 'done' | 'missing'
  from: string
  to: string
  page: number
  pageSize: number
}
interface AttendanceMyFilters {
  from: string
}
interface LeaveFilters {
  warehouseId: string
  deptId: string
  jt: string
  status: string
  from: string
  to: string
  page: number
  pageSize: number
}
interface SlottingFilters {
  warehouseId: string
  categories: string[]
  days: number                    // cửa sổ phân tích ABC: 30/60/90 ngày (dùng ở mức Hard)
  level: 'EASY' | 'NORMAL' | 'HARD'      // mức độ slotting (filter — user chốt không cài trên kho)
  principle: 'FIFO' | 'FEFO' | 'LIFO'    // nguyên tắc xuất → hướng dồn theo date
  palletKind: 'FULL' | 'PARTIAL' | 'ALL' // FULL = chỉ hàng chẵn (pallet nguyên — user 18/07: "hầu hết chỉ dồn hàng chẵn")
  tab: 'analysis' | 'plans' | 'config'
}
interface DashboardFilters {
  warehouseId: string   // '' = tất cả kho trong scope
}
// Fill hàng phục vụ nhặt lẻ: đề xuất theo NGÀY XUẤT của kho, lệnh fill, kết quả theo người
interface FillFilters {
  warehouseId: string
  date: string                                   // ngày xuất đang xem (tab Đề xuất)
  tab: 'demand' | 'tasks' | 'report'
  search: string
  status: string[]                               // lọc trạng thái lệnh (tab Lệnh fill)
  mine: boolean                                  // chỉ việc được giao cho tôi
  onlyShort: boolean                             // tab Đề xuất: chỉ mã đang THIẾU
  cats: string[]                                 // tab Đề xuất: lọc Loại kho của mã
  reportFrom: string
  reportTo: string
  page: number
  pageSize: number
}
interface StocktakeCycleFilters {
  search: string
  warehouseId: string    // bắt buộc chọn kho mới tải (như Slotting)
  cats: string[]         // Loại kho
  abc: string[]          // hạng A/B/C — [] = tất cả
  dueOnly: boolean       // chỉ mã đến hạn/quá hạn (mặc định bật)
}
interface AlertFilters {
  tab: 'personal' | 'general' | 'thresholds'   // Cá nhân (mọi user) | Thông báo chung (alerts.view) | Cài đặt ngưỡng (manage_system)
  search: string
  warehouseId: string    // '' = mọi kho trong scope
  rules: string[]        // loại cảnh báo (EXPIRY/GATE_DWELL/…) — [] = tất cả
  severity: string[]     // CRITICAL/WARNING — [] = cả hai
  status: string         // open (mặc định) | acked | resolved | all
}
interface PackingFilters {
  tab: 'board' | 'log'   // Board đóng gói (pallet đang mở theo máy) | Sổ (lịch sử)
  search: string
  warehouseId: string    // '' = mọi kho trong scope (nhiều nhà máy cùng SX — tách sổ theo kho)
  machine: string        // '' = mọi máy
  status: string         // '' = tất cả | OPEN | CLOSED | CANCELLED
  dateFrom: string
  dateTo: string
  page: number
  pageSize: number
}
interface ForkliftFilters {
  tab: 'board' | 'report' | 'matrix' | 'summary' | 'detail' | 'settings'
  date: string          // ngày xem board check list (mặc định hôm nay)
  warehouseId: string   // '' = mọi kho trong scope (dùng chung các tab)
  from: string          // khoảng ngày báo cáo/ma trận/chi tiết (tối đa 92 ngày — BE chặn)
  to: string
  matrixFk: string      // xe đang soi ở tab Ma trận ('' = tự chọn xe đầu)
  vehicleId: string     // filter Xe ở tab Tổng hợp/Chi tiết ('' = tất cả xe)
}
interface DoSapFilters {
  search: string
  dateFrom: string   // Ngày nạp (created_at) — mặc định RỖNG (bắt buộc chọn mới tải)
  dateTo: string
  source: string
  plant: string
  shipto: string
  material: string
  od: string
  inPlan: string     // '' tất cả | '1' trong kế hoạch | '0' ngoài kế hoạch
  used: string       // '' tất cả | '1' còn trong chuyến Xuất | '0' không (tìm DO có KH nhưng chuyến đã xóa)
  page: number
  pageSize: number
}
interface KhvcFilters {
  search: string
  dateFrom: string   // Ngày nạp (created_at) — mặc định RỖNG (bắt buộc chọn mới tải)
  dateTo: string
  exportFrom: string // Ngày xuất (export_date — ngày xe chạy), độc lập với Ngày nạp
  exportTo: string
  warehouse: string  // warehouse_code
  vehType: string
  source: string
  syncStatus: string
  group: string      // group_code (Số xe) — text
  doNo: string       // DO — text
  inDoSap: string    // '' tất cả | '1' trong DO SAP | '0' ngoài DO SAP
  gdoIssue: string   // '' tất cả | 'missing' không còn chuyến bên Xuất | 'date_mismatch' lệch ngày xuất
  page: number
  pageSize: number
}
interface ReconcileFilters {
  search: string
  status: string     // OPEN (mặc định) | RESOLVED
  dateFrom: string
  dateTo: string
  page: number
  pageSize: number
}
interface WmsFilterState {
  dashboard:         DashboardFilters
  assignment:        AssignmentFilters
  outbound:          OutboundFilters
  outboundPrepare:   OutboundPrepareFilters
  inbound:           InboundFilters
  inventory:         InventoryFilters
  loosePicking:      LoosePickingFilters
  scanLog:           ScanLogFilters
  weighTickets:      WeighTicketFilters
  controlTower:      ControlTowerFilters
  alerts:            AlertFilters
  stocktakeCycle:    StocktakeCycleFilters
  slotting:          SlottingFilters
  fill:              FillFilters
  forklift:          ForkliftFilters
  packing:           PackingFilters
  stocktake:         StocktakeFilters
  stocktakeSummary:  StocktakeSummaryFilters
  stocktakeHistory:  StocktakeHistoryFilters
  locations:         LocationsFilters
  gateRegistration:  GateRegistrationFilters
  materials:         MaterialsFilters
  inboundReport:     InboundReportFilters
  tmsBookings:       TmsBookingsFilters
  tmsTransfer:       TmsTransferFilters
  userAdmin:         UserAdminFilters
  attendanceTeam:    AttendanceTeamFilters
  attendanceMy:      AttendanceMyFilters
  leave:             LeaveFilters
  doSap:             DoSapFilters
  khvc:              KhvcFilters
  reconcile:         ReconcileFilters
  setDoSap:             (f: Partial<DoSapFilters>)             => void
  setKhvc:              (f: Partial<KhvcFilters>)              => void
  setReconcile:         (f: Partial<ReconcileFilters>)         => void
  setDashboard:         (f: Partial<DashboardFilters>)         => void
  setUserAdmin:         (f: Partial<UserAdminFilters>)         => void
  setAttendanceTeam:    (f: Partial<AttendanceTeamFilters>)    => void
  setAttendanceMy:      (f: Partial<AttendanceMyFilters>)      => void
  setLeave:             (f: Partial<LeaveFilters>)             => void
  setOutbound:          (f: Partial<OutboundFilters>)          => void
  setOutboundPrepare:   (f: Partial<OutboundPrepareFilters>)   => void
  setInbound:           (f: Partial<InboundFilters>)           => void
  setInventory:         (f: Partial<InventoryFilters>)         => void
  setLoosePicking:      (f: Partial<LoosePickingFilters>)      => void
  setScanLog:           (f: Partial<ScanLogFilters>)          => void
  setWeighTickets:      (f: Partial<WeighTicketFilters>)      => void
  setControlTower:      (f: Partial<ControlTowerFilters>)     => void
  setAlerts:            (f: Partial<AlertFilters>)             => void
  setStocktakeCycle:    (f: Partial<StocktakeCycleFilters>)    => void
  setSlotting:          (f: Partial<SlottingFilters>)          => void
  setFill:              (f: Partial<FillFilters>)              => void
  setForklift:          (f: Partial<ForkliftFilters>)          => void
  setPacking:           (f: Partial<PackingFilters>)           => void
  setStocktake:         (f: Partial<StocktakeFilters>)         => void
  setStocktakeSummary:  (f: Partial<StocktakeSummaryFilters>)  => void
  setStocktakeHistory:  (f: Partial<StocktakeHistoryFilters>)  => void
  setLocations:         (f: Partial<LocationsFilters>)         => void
  setGateRegistration:  (f: Partial<GateRegistrationFilters>)  => void
  setMaterials:         (f: Partial<MaterialsFilters>)         => void
  setInboundReport:     (f: Partial<InboundReportFilters>)     => void
  setAssignment:        (f: Partial<AssignmentFilters>)        => void
  setTmsBookings:       (f: Partial<TmsBookingsFilters>)       => void
  setTmsTransfer:       (f: Partial<TmsTransferFilters>)       => void
  reset:                ()                                     => void
}

const INBOUND_DEFAULT: InboundFilters = {
  search: '', dateFrom: today(), dateTo: today(), filterShiftIds: [], filterSourceTypes: [],
  warehouseId: '', materialCategory: '',
  filterMaterials: [], filterCycles: [], filterMachines: [], importerSearch: '',
  page: 1, pageSize: 500,
}

// Giá trị mặc định cho TẤT CẢ filter — gói trong hàm để reset() lấy được `today()` mới
// và để scopedPersist reset về default khi đổi user (tránh user kế thừa filter người trước).
function initialFilters() {
  return {
    dashboard: { warehouseId: '' },
    assignment: { search: '', warehouseId: '', layoutId: '', dateFrom: today().slice(0, 8) + '01' },
    outbound: {
      search: '', dateFrom: today(), dateTo: today(),
      filterTypes: [], filterDvvts: [], filterNpps: [], filterMaterials: [],
      warehouseId: '', filterWarehouseTypes: [], filterStatuses: [],
      page: 1, pageSize: 200,
    },
    outboundPrepare: { date: today(), warehouseId: '' },
    inbound:   { ...INBOUND_DEFAULT },
    inventory: {
      search: '', warehouseIds: [], materialCategories: [],
      filterLocations: [], filterMaterialIds: [],
      qaStatusIds: [], status: '', page: 1, pageSize: 50, manufacturerId: '',
      filterCycles: [], filterMachines: [], filterNmsx: [], nccIds: [], datePctRanges: [],
      importDateFrom: '', importDateTo: '',
    },
    loosePicking: {
      warehouseId: '', dateFrom: today(), dateTo: today(), search: '',
      filterDvvts: [], filterNpps: [], filterWarehouseTypes: [], filterTypes: [], page: 1, pageSize: 100,
    },
    scanLog: {
      from_date: today(), to_date: today(),
      warehouses: [], material_category: '',
      group_code: '', distributor: '', delivery_code: '',
      pallet_code: '', materials: [], machines: [], cycles: [], scanner_name: '', nmsx: [],
      search: '',
    },
    weighTickets: { from_date: today(), to_date: today(), direction: '', match_state: '', warehouse_ids: [], search: '' },
    controlTower: { warehouse_ids: [], categories: [], material_codes: [] },
    slotting:     { warehouseId: '', categories: [], days: 30, level: 'NORMAL' as const, principle: 'FEFO' as const, palletKind: 'FULL' as const, tab: 'analysis' as const },
    fill:         { warehouseId: '', date: today(), tab: 'demand' as const, search: '', status: ['PENDING'], mine: false,
                    onlyShort: true, cats: [] as string[], reportFrom: today(), reportTo: today(), page: 1, pageSize: 100 },
    forklift:     { tab: 'board' as const, date: today(), warehouseId: '', from: daysAgo(7), to: today(), matrixFk: '', vehicleId: '' },
    packing:      { tab: 'board' as const, search: '', warehouseId: '', machine: '', status: '', dateFrom: daysAgo(7), dateTo: today(), page: 1, pageSize: 200 },
    alerts:       { tab: 'general' as const, search: '', warehouseId: '', rules: [], severity: [], status: 'open' },
    stocktakeCycle: { search: '', warehouseId: '', cats: [], abc: [], dueOnly: true },
    stocktake:        { warehouseId: '', category: '', locationId: '', requiresOnly: false },
    stocktakeSummary: { warehouseId: '', category: '', locationIds: [], requiresOnly: true, view: 'checked' as StocktakeView, page: 1, pageSize: 200 },
    stocktakeHistory: { warehouseId: '', category: '', locationIds: [], requiresOnly: false, dateFrom: daysAgo(7), dateTo: today(), search: '', page: 1, pageSize: 200 },
    locations:        { search: '', warehouseId: '', catFilter: '', zoneFilter: [], statusFilter: [], flagMode: '' as FlagMode, pickFaceMode: '' as FlagMode, page: 1, pageSize: 200 },
    gateRegistration: {
      fDate: today(), fDateTo: '', fWarehouse: '', fWarehouseType: '',
      fVehicleTypes: [], fCompany: '', fDirection: '', fStatus: '',
    },
    materials:  { search: '', catFilter: [], statusFilter: ['active'], qrFilter: [], dqFilter: [], page: 1, pageSize: 200 },
    inboundReport: {
      dateFrom: (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }) })(),
      dateTo: today(), warehouseId: '', selCategories: [],
    },
    tmsBookings: { search: '', dateFrom: today(), dateTo: today(), warehouseId: '', loaiKho: [], loaiXe: [], huong: [], dvvt: [], khungGio: [], tab: 'main' as const, page: 1, pageSize: 200 },
    tmsTransfer: { search: '', dateFrom: '', dateTo: '', khoXuat: [], khoNhan: [] },
    userAdmin: { search: '', warehouseId: '__all__', deptId: '__all__', jtId: '__all__', status: 'active' as const, jtDept: '__all__', page: 1, pageSize: 100 },
    attendanceTeam: { page: 1, pageSize: 100, view: 'matrix' as const, warehouseId: '', deptId: '', jt: '', q: '', status: 'all' as const, from: today().slice(0, 8) + '01', to: today() },
    attendanceMy: { from: today().slice(0, 8) + '01' },
    // Nghỉ phép mặc định = TỪ ĐẦU NĂM đến hôm nay. Trước đây để TRỐNG = kéo TOÀN BỘ lịch sử đơn
    // nghỉ mỗi lần mở trang; vài trăm nhân sự × vài năm là vượt trần 10.000 dòng → trang chết hẳn
    // (400 "thu hẹp khoảng ngày") chứ không chỉ chậm. Cần xem năm cũ thì tự nới khoảng ngày.
    leave: { warehouseId: '', deptId: '', jt: '', status: '', from: today().slice(0, 4) + '-01-01', to: today(), page: 1, pageSize: 100 },
    doSap: { search: '', dateFrom: '', dateTo: '', source: '', plant: '', shipto: '', material: '', od: '', inPlan: '', used: '', page: 1, pageSize: 50 },
    khvc: { search: '', dateFrom: '', dateTo: '', exportFrom: '', exportTo: '', warehouse: '', vehType: '', source: '', syncStatus: '', group: '', doNo: '', inDoSap: '', gdoIssue: '', page: 1, pageSize: 50 },
    reconcile: { search: '', status: 'OPEN', dateFrom: '', dateTo: '', page: 1, pageSize: 50 },
  }
}

export const useWmsFilterStore = create<WmsFilterState>()(
  persist(
    (set) => ({
      ...initialFilters(),
      setDashboard:        (f) => set(s => ({ dashboard:        { ...s.dashboard,        ...f } })),
      setOutbound:         (f) => set(s => ({ outbound:         { ...s.outbound,         ...f } })),
      setOutboundPrepare:  (f) => set(s => ({ outboundPrepare:  { ...s.outboundPrepare,  ...f } })),
      setInbound:          (f) => set(s => ({ inbound:          { ...INBOUND_DEFAULT, ...s.inbound, ...f } })),
      setInventory:        (f) => set(s => ({ inventory:        { ...s.inventory,        ...f } })),
      setLoosePicking:     (f) => set(s => ({ loosePicking:     { ...s.loosePicking,     ...f } })),
      setScanLog:          (f) => set(s => ({ scanLog:          { ...s.scanLog,          ...f } })),
      setWeighTickets:     (f) => set(s => ({ weighTickets:     { ...s.weighTickets,     ...f } })),
      setControlTower:     (f) => set(s => ({ controlTower:     { ...s.controlTower,     ...f } })),
      setSlotting:         (f) => set(s => ({ slotting:         { ...s.slotting,         ...f } })),
      setFill:             (f) => set(s => ({ fill:             { ...s.fill,             ...f } })),
      setForklift:         (f) => set(s => ({ forklift:         { ...s.forklift,         ...f } })),
      setPacking:          (f) => set(s => ({ packing:          { ...s.packing,          ...f } })),
      setAlerts:           (f) => set(s => ({ alerts:           { ...s.alerts,           ...f } })),
      setStocktakeCycle:   (f) => set(s => ({ stocktakeCycle:   { ...s.stocktakeCycle,   ...f } })),
      setStocktake:        (f) => set(s => ({ stocktake:        { ...s.stocktake,        ...f } })),
      setStocktakeSummary: (f) => set(s => ({ stocktakeSummary: { ...s.stocktakeSummary, ...f } })),
      setStocktakeHistory: (f) => set(s => ({ stocktakeHistory: { ...s.stocktakeHistory, ...f } })),
      setLocations:        (f) => set(s => ({ locations:        { ...s.locations,        ...f } })),
      setGateRegistration: (f) => set(s => ({ gateRegistration: { ...s.gateRegistration, ...f } })),
      setMaterials:        (f) => set(s => ({ materials:        { ...s.materials,        ...f } })),
      setInboundReport:    (f) => set(s => ({ inboundReport:    { ...s.inboundReport,    ...f } })),
      setAssignment:       (f) => set(s => ({ assignment:       { ...s.assignment,       ...f } })),
      setTmsBookings:      (f) => set(s => ({ tmsBookings:      { ...s.tmsBookings,      ...f } })),
      setTmsTransfer:      (f) => set(s => ({ tmsTransfer:      { ...s.tmsTransfer,      ...f } })),
      setUserAdmin:        (f) => set(s => ({ userAdmin:        { ...s.userAdmin,        ...f } })),
      setAttendanceTeam:   (f) => set(s => ({ attendanceTeam:   { ...s.attendanceTeam,   ...f } })),
      setAttendanceMy:     (f) => set(s => ({ attendanceMy:     { ...s.attendanceMy,     ...f } })),
      setLeave:            (f) => set(s => ({ leave:            { ...s.leave,            ...f } })),
      setDoSap:            (f) => set(s => ({ doSap:            { ...s.doSap,            ...f } })),
      setKhvc:             (f) => set(s => ({ khvc:             { ...s.khvc,             ...f } })),
      setReconcile:        (f) => set(s => ({ reconcile:        { ...s.reconcile,        ...f } })),
      reset:               ()  => set(() => initialFilters()),
    }),
    {
      name: 'wms-filters-v10',
      storage: createJSONStorage(() => sessionStorage),
      // Deep-merge TỪNG slice qua default: dữ liệu persist shape CŨ (thiếu field mới, vd locationIds)
      // sẽ được lấp bằng default → tránh crash khi đọc field chưa có (màn trắng). Setter giữ từ current.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>
        const defaults = initialFilters() as Record<string, unknown>
        const merged: Record<string, unknown> = { ...current }
        for (const key of Object.keys(defaults)) {
          const def = defaults[key]
          const pv  = p[key]
          merged[key] =
            def && typeof def === 'object' && !Array.isArray(def) &&
            pv  && typeof pv  === 'object' && !Array.isArray(pv)
              ? { ...(def as object), ...(pv as object) }
              : (pv !== undefined ? pv : def)
        }
        return merged as unknown as WmsFilterState
      },
    }
  )
)
