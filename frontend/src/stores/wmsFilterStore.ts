import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

const today = () => new Date().toISOString().slice(0, 10)

interface OutboundFilters {
  search: string
  date: string
  filterTypes: string[]         // was filterType: string
  filterDvvts: string[]         // was filterDvvt: string
  filterNpps: string[]          // was filterNpp: string
  warehouseId: string
  filterWarehouseTypes: string[]  // was warehouseType: string
}
interface InboundFilters {
  search: string
  dateFrom: string
  dateTo: string
  filterShiftIds: string[]      // replaces shiftId: string — client-side
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
interface WmsFilterState {
  outbound:  OutboundFilters
  inbound:   InboundFilters
  inventory: InventoryFilters
  setOutbound:  (f: Partial<OutboundFilters>)  => void
  setInbound:   (f: Partial<InboundFilters>)   => void
  setInventory: (f: Partial<InventoryFilters>) => void
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
        warehouseId: '', filterWarehouseTypes: [],
      },
      inbound:   INBOUND_DEFAULT,
      inventory: {
        search: '', warehouseIds: [], materialCategories: [],
        filterLocations: [], filterMaterialIds: [],
        qaStatusIds: [], status: '', page: 1, manufacturerId: '',
        filterCycles: [], filterMachines: [], datePctRanges: [],
      },
      setOutbound:  (f) => set(s => ({ outbound:  { ...s.outbound,  ...f } })),
      setInbound:   (f) => set(s => ({ inbound:   { ...INBOUND_DEFAULT, ...s.inbound, ...f } })),
      setInventory: (f) => set(s => ({ inventory: { ...s.inventory, ...f } })),
    }),
    { name: 'wms-filters-v6', storage: createJSONStorage(() => sessionStorage) }
  )
)
