import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Saved Views — lưu tổ hợp filter đặt tên cho mỗi list page (kiểu Manhattan Active WMS).
 * Bền qua reload (localStorage), keyed theo module: 'inbound' | 'outbound' | …
 * `filters` lưu nguyên Partial của module filter tương ứng để apply lại qua setter của module đó.
 */

export interface SavedView {
  id: string
  name: string
  filters: Record<string, unknown>
}

interface SavedViewsState {
  views: Record<string, SavedView[]>
  addView:    (module: string, view: SavedView) => void
  removeView: (module: string, id: string) => void
  renameView: (module: string, id: string, name: string) => void
  reset:      () => void
}

export const useSavedViewsStore = create<SavedViewsState>()(
  persist(
    (set) => ({
      views: {},
      addView: (module, view) => set(s => ({
        views: { ...s.views, [module]: [...(s.views[module] ?? []), view] },
      })),
      removeView: (module, id) => set(s => ({
        views: { ...s.views, [module]: (s.views[module] ?? []).filter(v => v.id !== id) },
      })),
      renameView: (module, id, name) => set(s => ({
        views: { ...s.views, [module]: (s.views[module] ?? []).map(v => v.id === id ? { ...v, name } : v) },
      })),
      reset: () => set({ views: {} }),
    }),
    { name: 'wms-saved-views', storage: createJSONStorage(() => localStorage) }
  )
)
