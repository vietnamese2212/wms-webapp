import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface ActiveLoosePickingVehicle {
  id: string
  group_code: string
  status: string
}

interface ActiveLoosePickingState {
  vehicles: ActiveLoosePickingVehicle[]
  pin:      (v: ActiveLoosePickingVehicle) => void
  unpin:    (id: string) => void
  update:   (id: string, status: string) => void
  isPinned: (id: string) => boolean
}

export const useActiveLoosePickingStore = create<ActiveLoosePickingState>()(
  persist(
    (set, get) => ({
      vehicles: [],
      pin: (v) => set(s => ({
        vehicles: s.vehicles.some(x => x.id === v.id)
          ? s.vehicles.map(x => x.id === v.id ? v : x)
          : [...s.vehicles, v],
      })),
      unpin:  (id) => set(s => ({ vehicles: s.vehicles.filter(x => x.id !== id) })),
      update: (id, status) => set(s => ({
        vehicles: s.vehicles.map(x => x.id === id ? { ...x, status } : x),
      })),
      isPinned: (id) => get().vehicles.some(x => x.id === id),
    }),
    { name: 'wms-active-loosepicking', storage: createJSONStorage(() => sessionStorage) }
  )
)
