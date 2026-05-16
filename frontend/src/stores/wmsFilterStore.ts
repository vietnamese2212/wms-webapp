import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

interface OutboundFilters {
  search: string
  date: string
  filterTypes: string[]
  filterDvvts: string[]
  filterNpps: string[]
  warehouseId: string
  filterWarehouseTypes: string[]
  filterStatuses: string[]
}
interface InboundFilters {
  search: string
  dateFrom: string
  dateTo: string
  filterShiftIds: string[]
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
  date: string
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
interface WmsFilterState {
  outbound:       OutboundFilters
  inbound:        InboundFilters
  inventory:      InventoryFilters
  loosePicking:   LoosePickingFilters
  scanLogDraft:   ScanLogDraft
  scanLogApplied: ScanLogApplied
  setOutbound:       (f: Partial<OutboundFilters>)       => void
  setInbound:        (f: Partial<InboundFilters>)        => void
  setInventory:      (f: Partial<InventoryFilters>)      => void
  setLoosePicking:   (f: Partial<LoosePickingFilters>)   => void
  setScanLogDraft:   (f: Partial<ScanLogDraft>)          => void
  setScanLogApplied: (f: ScanLogApplied)                 => void
}

const INBOUND_DEFAULT: InboundFilters = {
  search: '', dateFrom: today(), dateTo: today(), filterShiftIds: [],
  warehouseId: '', materialCategory: '',
  filterMaterials: [], filterCycles: [], filterMachines: [], importerSearch: '',
}

export const useWmsFilterStore = create<WmsFilterState>()(
  persist(
    (set) => ({
      outbound: {
        search: '', date: today(),
        filterTypes: [], filterDvvts: [], filterNpps: [],
        warehouseId: '', filterWarehouseTypes: [], filterStatuses: [],
      },
      inbound:   INBOUND_DEFAULT,
      inventory: {
        search: '', warehouseIds: [], materialCategories: [],
        filterLocations: [], filterMaterialIds: [],
        qaStatusIds: [], status: '', page: 1, manufacturerId: '',
        filterCycles: [], filterMachines: [], datePctRanges: [],
      },
      loosePicking: {
        warehouseId: '', date: today(), search: '',
        filterDvvts: [], filterNpps: [], filterWarehouseTypes: [], filterTypes: [],
      },
      scanLogDraft: {
        from_date: today(), to_date: today(),
        warehouses: [], material_category: '',
        group_code: '', distributor: '', delivery_code: '',
        pallet_code: '', materials: [], machines: [], cycles: [], scanner_name: '',
      },
      scanLogApplied: { from_date: today(), to_date: today() },
      setOutbound:       (f) => set(s => ({ outbound:       { ...s.outbound,       ...f } })),
      setInbound:        (f) => set(s => ({ inbound:        { ...INBOUND_DEFAULT, ...s.inbound, ...f } })),
      setInventory:      (f) => set(s => ({ inventory:      { ...s.inventory,      ...f } })),
      setLoosePicking:   (f) => set(s => ({ loosePicking:   { ...s.loosePicking,   ...f } })),
      setScanLogDraft:   (f) => set(s => ({ scanLogDraft:   { ...s.scanLogDraft,   ...f } })),
      setScanLogApplied: (f) => set(_  => ({ scanLogApplied: f })),
    }),
    { name: 'wms-filters-v7', storage: createJSONStorage(() => sessionStorage) }
  )
)
