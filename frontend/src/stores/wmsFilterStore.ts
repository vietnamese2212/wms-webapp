import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

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
  manufacturerId: string
  filterCycles: string[]
  filterMachines: string[]
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
export interface ScanLogDraft {
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
}
export interface ScanLogApplied {
  from_date?: string
  to_date?: string
  warehouse_ids?: string
  material_category?: string
  group_code?: string
  distributor?: string
  delivery_code?: string
  pallet_code?: string
  material?: string
  machine_codes?: string
  cycles?: string
  scanner_name?: string
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
interface DeliveriesFilters {
  search: string
  statusFilter: string
}
interface MaterialsFilters {
  search: string
  catFilter: string[]
  statusFilter: string[]
  qrFilter: string[]
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
}
interface TmsTransferFilters {
  dateFrom: string
  dateTo: string
  khoXuat: string[]
  khoNhan: string[]
}
interface WmsFilterState {
  assignment:        AssignmentFilters
  outbound:          OutboundFilters
  outboundPrepare:   OutboundPrepareFilters
  inbound:           InboundFilters
  inventory:         InventoryFilters
  loosePicking:      LoosePickingFilters
  scanLogDraft:      ScanLogDraft
  scanLogApplied:    ScanLogApplied
  stocktake:         StocktakeFilters
  stocktakeSummary:  StocktakeSummaryFilters
  locations:         LocationsFilters
  gateRegistration:  GateRegistrationFilters
  deliveries:        DeliveriesFilters
  materials:         MaterialsFilters
  inboundReport:     InboundReportFilters
  tmsBookings:       TmsBookingsFilters
  tmsTransfer:       TmsTransferFilters
  setOutbound:          (f: Partial<OutboundFilters>)          => void
  setOutboundPrepare:   (f: Partial<OutboundPrepareFilters>)   => void
  setInbound:           (f: Partial<InboundFilters>)           => void
  setInventory:         (f: Partial<InventoryFilters>)         => void
  setLoosePicking:      (f: Partial<LoosePickingFilters>)      => void
  setScanLogDraft:      (f: Partial<ScanLogDraft>)             => void
  setScanLogApplied:    (f: ScanLogApplied)                    => void
  setStocktake:         (f: Partial<StocktakeFilters>)         => void
  setStocktakeSummary:  (f: Partial<StocktakeSummaryFilters>)  => void
  setLocations:         (f: Partial<LocationsFilters>)         => void
  setGateRegistration:  (f: Partial<GateRegistrationFilters>)  => void
  setDeliveries:        (f: Partial<DeliveriesFilters>)        => void
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
}

// Giá trị mặc định cho TẤT CẢ filter — gói trong hàm để reset() lấy được `today()` mới
// và để scopedPersist reset về default khi đổi user (tránh user kế thừa filter người trước).
function initialFilters() {
  return {
    assignment: { search: '', warehouseId: '', layoutId: '', dateFrom: today().slice(0, 8) + '01' },
    outbound: {
      search: '', dateFrom: today(), dateTo: today(),
      filterTypes: [], filterDvvts: [], filterNpps: [], filterMaterials: [],
      warehouseId: '', filterWarehouseTypes: [], filterStatuses: [],
    },
    outboundPrepare: { date: today(), warehouseId: '' },
    inbound:   { ...INBOUND_DEFAULT },
    inventory: {
      search: '', warehouseIds: [], materialCategories: [],
      filterLocations: [], filterMaterialIds: [],
      qaStatusIds: [], status: '', page: 1, manufacturerId: '',
      filterCycles: [], filterMachines: [], datePctRanges: [],
    },
    loosePicking: {
      warehouseId: '', dateFrom: today(), dateTo: today(), search: '',
      filterDvvts: [], filterNpps: [], filterWarehouseTypes: [], filterTypes: [],
    },
    scanLogDraft: {
      from_date: today(), to_date: today(),
      warehouses: [], material_category: '',
      group_code: '', distributor: '', delivery_code: '',
      pallet_code: '', materials: [], machines: [], cycles: [], scanner_name: '',
    },
    scanLogApplied: { from_date: today(), to_date: today() } as ScanLogApplied,
    stocktake:        { warehouseId: '', category: '', locationId: '', requiresOnly: false },
    stocktakeSummary: { warehouseId: '', category: '', locationIds: [], requiresOnly: false, view: 'problem' as StocktakeView },
    locations:        { search: '', warehouseId: '', catFilter: '', statusFilter: [], flagFilter: false },
    gateRegistration: {
      fDate: today(), fDateTo: '', fWarehouse: '', fWarehouseType: '',
      fVehicleTypes: [], fCompany: '', fDirection: '', fStatus: '',
    },
    deliveries: { search: '', statusFilter: 'ALL' },
    materials:  { search: '', catFilter: [], statusFilter: ['active'], qrFilter: [] },
    inboundReport: {
      dateFrom: (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }) })(),
      dateTo: today(), warehouseId: '', selCategories: [],
    },
    tmsBookings: { dateFrom: today(), dateTo: today(), warehouseId: '', loaiKho: [], loaiXe: [], huong: [], dvvt: [], khungGio: [], tab: 'main' as const },
    tmsTransfer: { dateFrom: '', dateTo: '', khoXuat: [], khoNhan: [] },
  }
}

export const useWmsFilterStore = create<WmsFilterState>()(
  persist(
    (set) => ({
      ...initialFilters(),
      setOutbound:         (f) => set(s => ({ outbound:         { ...s.outbound,         ...f } })),
      setOutboundPrepare:  (f) => set(s => ({ outboundPrepare:  { ...s.outboundPrepare,  ...f } })),
      setInbound:          (f) => set(s => ({ inbound:          { ...INBOUND_DEFAULT, ...s.inbound, ...f } })),
      setInventory:        (f) => set(s => ({ inventory:        { ...s.inventory,        ...f } })),
      setLoosePicking:     (f) => set(s => ({ loosePicking:     { ...s.loosePicking,     ...f } })),
      setScanLogDraft:     (f) => set(s => ({ scanLogDraft:     { ...s.scanLogDraft,     ...f } })),
      setScanLogApplied:   (f) => set(_  => ({ scanLogApplied: f })),
      setStocktake:        (f) => set(s => ({ stocktake:        { ...s.stocktake,        ...f } })),
      setStocktakeSummary: (f) => set(s => ({ stocktakeSummary: { ...s.stocktakeSummary, ...f } })),
      setLocations:        (f) => set(s => ({ locations:        { ...s.locations,        ...f } })),
      setGateRegistration: (f) => set(s => ({ gateRegistration: { ...s.gateRegistration, ...f } })),
      setDeliveries:       (f) => set(s => ({ deliveries:       { ...s.deliveries,       ...f } })),
      setMaterials:        (f) => set(s => ({ materials:        { ...s.materials,        ...f } })),
      setInboundReport:    (f) => set(s => ({ inboundReport:    { ...s.inboundReport,    ...f } })),
      setAssignment:       (f) => set(s => ({ assignment:       { ...s.assignment,       ...f } })),
      setTmsBookings:      (f) => set(s => ({ tmsBookings:      { ...s.tmsBookings,      ...f } })),
      setTmsTransfer:      (f) => set(s => ({ tmsTransfer:      { ...s.tmsTransfer,      ...f } })),
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
