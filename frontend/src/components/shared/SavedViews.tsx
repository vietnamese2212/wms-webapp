import { useEffect, useRef, useState } from 'react'
import { Bookmark, ChevronDown, Plus, Trash2, Check } from 'lucide-react'
import { useSavedViewsStore } from '@/stores/savedViewsStore'

/**
 * SavedViews — lưu/áp tổ hợp filter đặt tên (kiểu Manhattan Active WMS).
 * `currentFilters`: snapshot filter hiện tại để lưu thành view mới.
 * `onApply`: gọi khi user chọn 1 view (truyền filters của view đó).
 */
export function SavedViews({ module, currentFilters, onApply, activeId }: {
  module: string
  currentFilters: Record<string, unknown>
  onApply: (filters: Record<string, unknown>) => void
  activeId?: string | null
}) {
  const views = useSavedViewsStore(s => s.views[module] ?? [])
  const addView = useSavedViewsStore(s => s.addView)
  const removeView = useSavedViewsStore(s => s.removeView)

  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) { setNaming(false); setName(''); return }
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    addView(module, { id: crypto.randomUUID(), name: trimmed, filters: currentFilters })
    setNaming(false); setName(''); setOpen(false)
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setOpen(v => !v)}
        className={`h-7 px-2 inline-flex items-center gap-1 rounded-md border text-xs font-medium transition-colors ${
          activeId ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}>
        <Bookmark className={`h-3.5 w-3.5 ${activeId ? 'fill-blue-500 text-blue-500' : ''}`} />
        <span className="hidden sm:inline">{activeId ? (views.find(v => v.id === activeId)?.name ?? 'Views') : 'Views'}</span>
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>

      {open && (
        <div className="absolute z-50 top-full right-0 mt-1 bg-white border rounded-md shadow-lg w-[220px] py-1 animate-in fade-in zoom-in-95 duration-100 origin-top-right"
          onMouseDown={e => e.stopPropagation()}>
          {views.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-slate-400 text-center">Chưa có view nào</div>
          ) : views.map(v => (
            <div key={v.id} className={`group flex items-center gap-1 px-2 py-1.5 hover:bg-slate-50 ${v.id === activeId ? 'bg-blue-50' : ''}`}>
              <button type="button" onClick={() => { onApply(v.filters); setOpen(false) }}
                className="flex-1 text-left text-[11px] text-slate-700 inline-flex items-center gap-1.5 min-w-0">
                {v.id === activeId
                  ? <Check className="h-3 w-3 text-blue-600 shrink-0" />
                  : <Bookmark className="h-3 w-3 text-slate-300 shrink-0" />}
                <span className="truncate">{v.name}</span>
              </button>
              <button type="button" onClick={() => removeView(module, v.id)}
                className="text-slate-300 hover:text-red-500 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                title="Xóa view">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          <div className="border-t mt-1 pt-1">
            {naming ? (
              <div className="px-2 py-1 flex items-center gap-1">
                <input autoFocus value={name} onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setNaming(false) }}
                  placeholder="Tên view…"
                  className="flex-1 min-w-0 text-[11px] border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-400" />
                <button type="button" onClick={save} disabled={!name.trim()}
                  className="text-[11px] font-medium text-blue-600 disabled:text-slate-300 px-1">Lưu</button>
              </div>
            ) : (
              <button type="button" onClick={() => setNaming(true)}
                className="w-full text-left px-3 py-1.5 text-[11px] text-blue-600 hover:bg-blue-50 inline-flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Lưu bộ lọc hiện tại
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
