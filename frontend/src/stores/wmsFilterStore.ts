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
  date: string
  shiftId: string
}
interface WmsFilterState {
  outbound: OutboundFilters
  inbound:  InboundFilters
  setOutbound: (f: Partial<OutboundFilters>) => void
  setInbound:  (f: Partial<InboundFilters>)  => void
}

export const useWmsFilterStore = create<WmsFilterState>()(
  persist(
    (set) => ({
      outbound: { search: '', date: today(), filterType: '', filterDvvt: '', filterNpp: '' },
      inbound:  { search: '', date: today(), shiftId: '' },
      setOutbound: (f) => set(s => ({ outbound: { ...s.outbound, ...f } })),
      setInbound:  (f) => set(s => ({ inbound:  { ...s.inbound,  ...f } })),
    }),
    { name: 'wms-filters', storage: createJSONStorage(() => sessionStorage) }
  )
)
