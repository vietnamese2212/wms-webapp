import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface ActiveInbound {
  id: string
  import_code: string
  status: string
}

interface ActiveInboundState {
  orders: ActiveInbound[]
  pin:      (v: ActiveInbound) => void
  unpin:    (id: string) => void
  update:   (id: string, status: string) => void
  isPinned: (id: string) => boolean
}

export const useActiveInboundStore = create<ActiveInboundState>()(
  persist(
    (set, get) => ({
      orders: [],
      pin: (v) => set(s => ({
        orders: s.orders.some(x => x.id === v.id)
          ? s.orders.map(x => x.id === v.id ? v : x)
          : [...s.orders, v],
      })),
      unpin:  (id) => set(s => ({ orders: s.orders.filter(x => x.id !== id) })),
      update: (id, status) => set(s => ({
        orders: s.orders.map(x => x.id === id ? { ...x, status } : x),
      })),
      isPinned: (id) => get().orders.some(x => x.id === id),
    }),
    { name: 'wms-active-inbound', storage: createJSONStorage(() => sessionStorage) }
  )
)
