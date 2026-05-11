import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

const today = () => new Date().toISOString().slice(0, 10)

interface OutboundFilters {
  search: string
  date: string
  filterType: string
  filterDvvt: string
  filterNpp: string
}
interface InboundFilters {
  search: string
  dateFrom: string
  dateTo: string
  shiftId: string
  filterMaterials: string[]
  filterCycles: string[]
  filterMachines: string[]
  importerSearch: string
}
interface InventoryFilters {
  search: string        // pallet_code search
  materialSearch: string
  locationCode: string
  qaStatusId: string
  status: string        // '' = IN_STOCK+PARTIAL (default), 'ALL', or specific status
  warehouseId: string
  page: number
}
interface WmsFilterState {
  outbound:  OutboundFilters
  inbound:   InboundFilters
  inventory: InventoryFilters
  setOutbound:  (f: Partial<OutboundFilters>)  => void
  setInbound:   (f: Partial<InboundFilters>)   => void
  setInventory: (f: Partial<InventoryFilters>) => void
}

export const useWmsFilterStore = create<WmsFilterState>()(
  persist(
    (set) => ({
      outbound:  { search: '', date: today(), filterType: '', filterDvvt: '', filterNpp: '' },
      inbound:   { search: '', dateFrom: today(), dateTo: today(), shiftId: '', filterMaterials: [], filterCycles: [], filterMachines: [], importerSearch: '' },
      inventory: { search: '', materialSearch: '', locationCode: '', qaStatusId: '', status: '', warehouseId: '', page: 1 },
      setOutbound:  (f) => set(s => ({ outbound:  { ...s.outbound,  ...f } })),
      setInbound:   (f) => set(s => ({ inbound:   { ...s.inbound,   ...f } })),
      setInventory: (f) => set(s => ({ inventory: { ...s.inventory, ...f } })),
    }),
    { name: 'wms-filters', storage: createJSONStorage(() => sessionStorage) }
  )
)
