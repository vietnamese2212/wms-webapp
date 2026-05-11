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
  warehouseId: string
  materialCategory: string
  filterMaterials: string[]
  filterCycles: string[]
  filterMachines: string[]
  importerSearch: string
}
interface InventoryFilters {
  search: string
  materialSearch: string
  locationCode: string
  qaStatusId: string
  status: string
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

const INBOUND_DEFAULT: InboundFilters = {
  search: '', dateFrom: today(), dateTo: today(), shiftId: '',
  warehouseId: '', materialCategory: '',
  filterMaterials: [], filterCycles: [], filterMachines: [], importerSearch: '',
}

export const useWmsFilterStore = create<WmsFilterState>()(
  persist(
    (set) => ({
      outbound:  { search: '', date: today(), filterType: '', filterDvvt: '', filterNpp: '' },
      inbound:   INBOUND_DEFAULT,
      inventory: { search: '', materialSearch: '', locationCode: '', qaStatusId: '', status: '', warehouseId: '', page: 1 },
      setOutbound:  (f) => set(s => ({ outbound:  { ...s.outbound,  ...f } })),
      setInbound:   (f) => set(s => ({ inbound:   { ...INBOUND_DEFAULT, ...s.inbound, ...f } })),
      setInventory: (f) => set(s => ({ inventory: { ...s.inventory, ...f } })),
    }),
    { name: 'wms-filters-v2', storage: createJSONStorage(() => sessionStorage) }
  )
)
