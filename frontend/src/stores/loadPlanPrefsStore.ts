// Cách LÊN XE của từng Loại hàng trên sơ đồ xếp xe 3D — nhớ theo (KHO × USER), user chốt 26/08:
// "lưu setting kho rồi lưu theo user" — kho A cho POSM lên nóc, kho B bắt pallet riêng; chọn 1 lần
// ngay trong màn 3D, mọi chuyến sau của kho đó tự áp. localStorage bền, scope theo user qua
// scopedPersist (đổi user → reset rồi nạp bản riêng của user đó).
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LoadPlacement = 'MIX' | 'OWN_PALLET' | 'ON_TOP'
export const LOADPLAN_PREFS_BASE = 'wms-loadplan-prefs'

interface LoadPlanPrefsState {
  placements: Record<string, LoadPlacement>   // key `${warehouseId}|${category}` — thiếu = MIX
  setPlacement: (whId: string, category: string, p: LoadPlacement) => void
  reset: () => void
}

export const useLoadPlanPrefsStore = create<LoadPlanPrefsState>()(
  persist(
    (set) => ({
      placements: {},
      setPlacement: (whId, category, p) =>
        set(s => ({ placements: { ...s.placements, [`${whId}|${category}`]: p } })),
      reset: () => set({ placements: {} }),
    }),
    { name: LOADPLAN_PREFS_BASE },
  ),
)
