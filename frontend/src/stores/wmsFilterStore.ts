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
interface LocationsFilters {
  search: string
  warehouseId: string
  catFilter: string
  statusFilter: string[]
  flagFilter: boolean
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
}
interface StocktakeHistoryFilters {
  warehouseId: string
  category: string
  locationIds: string[]
  requiresOnly: boolean   // "Chỉ vị trí cần check" — giới hạn vào vị trí đã gắn cờ
  dateFrom: string   // Ngày kiểm (mặc định 7 ngày gần nhất)
  dateTo: string
  search: string
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
  slotting:          SlottingFilters
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
  setSlotting:          (f: Partial<SlottingFilters>)          => void
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
    },
    loosePicking: {
      warehouseId: '', dateFrom: today(), dateTo: today(), search: '',
      filterDvvts: [], filterNpps: [], filterWarehouseTypes: [], filterTypes: [],
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
    stocktake:        { warehouseId: '', category: '', locationId: '', requiresOnly: false },
    stocktakeSummary: { warehouseId: '', category: '', locationIds: [], requiresOnly: true, view: 'checked' as StocktakeView },
    stocktakeHistory: { warehouseId: '', category: '', locationIds: [], requiresOnly: false, dateFrom: daysAgo(7), dateTo: today(), search: '' },
    locations:        { search: '', warehouseId: '', catFilter: '', statusFilter: [], flagFilter: false },
    gateRegistration: {
      fDate: today(), fDateTo: '', fWarehouse: '', fWarehouseType: '',
      fVehicleTypes: [], fCompany: '', fDirection: '', fStatus: '',
    },
    materials:  { search: '', catFilter: [], statusFilter: ['active'], qrFilter: [], dqFilter: [] },
    inboundReport: {
      dateFrom: (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }) })(),
      dateTo: today(), warehouseId: '', selCategories: [],
    },
    tmsBookings: { dateFrom: today(), dateTo: today(), warehouseId: '', loaiKho: [], loaiXe: [], huong: [], dvvt: [], khungGio: [], tab: 'main' as const, page: 1, pageSize: 200 },
    tmsTransfer: { dateFrom: '', dateTo: '', khoXuat: [], khoNhan: [] },
    userAdmin: { search: '', warehouseId: '__all__', deptId: '__all__', jtId: '__all__', status: 'active' as const, jtDept: '__all__' },
    attendanceTeam: { view: 'matrix' as const, warehouseId: '', deptId: '', jt: '', q: '', status: 'all' as const, from: today().slice(0, 8) + '01', to: today() },
    attendanceMy: { from: today().slice(0, 8) + '01' },
    leave: { warehouseId: '', deptId: '', jt: '', status: '', from: '', to: '' },
    doSap: { search: '', dateFrom: '', dateTo: '', source: '', plant: '', shipto: '', material: '', od: '', inPlan: '', used: '', page: 1, pageSize: 50 },
    khvc: { search: '', dateFrom: '', dateTo: '', warehouse: '', vehType: '', source: '', syncStatus: '', group: '', doNo: '', inDoSap: '', gdoIssue: '', page: 1, pageSize: 50 },
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
