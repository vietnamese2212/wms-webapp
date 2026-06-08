import { createPortal } from 'react-dom'
import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X } from 'lucide-react'

interface Warehouse {
  id: string
  code?: string
  name: string
}

interface WarehouseMultiSelectProps {
  warehouses: Warehouse[]
  selected: string[]
  onChange: (ids: string[]) => void
  placeholder?: string
  dropUp?: boolean         // kept for compat — auto-detects direction now
  showTags?: boolean
  triggerClassName?: string
}

type DropPos = { top?: number; bottom?: number; left: number; width: number }

export function WarehouseMultiSelect({
  warehouses, selected, onChange,
  placeholder = 'Chọn kho…',
  showTags = true, triggerClassName = '',
}: WarehouseMultiSelectProps) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const [pos, setPos]       = useState<DropPos | null>(null)
  const triggerRef  = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const filtered = warehouses.filter(w =>
    w.name.toLowerCase().includes(search.toLowerCase()) ||
    (w.code ?? '').toLowerCase().includes(search.toLowerCase())
  )

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }

  function close() { setOpen(false); setSearch('') }

  function handleToggle() {
    if (open) { close(); return }
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
      setPos({ bottom: window.innerHeight - rect.top + 2, left: rect.left, width: Math.max(rect.width, 180) })
    } else {
      setPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 180) })
    }
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const inTrigger  = triggerRef.current?.contains(e.target as Node)
      const inDropdown = dropdownRef.current?.contains(e.target as Node)
      if (!inTrigger && !inDropdown) close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open]) // eslint-disable-line

  const dropStyle: React.CSSProperties = pos ? {
    position: 'fixed',
    zIndex:   9999,
    left:     pos.left,
    width:    pos.width,
    ...(pos.bottom !== undefined ? { bottom: pos.bottom } : { top: pos.top }),
  } : {}

  return (
    <div className={triggerClassName}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center justify-between bg-white border border-slate-200 rounded-md px-3 py-1.5 text-xs hover:border-slate-300 transition-colors"
        style={{ minHeight: '28px' }}
      >
        <span className={selected.length === 0 ? 'text-slate-400' : 'text-slate-700'}>
          {selected.length === 0 ? placeholder : `${selected.length} kho được chọn`}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && pos && createPortal(
        <div ref={dropdownRef} style={dropStyle} className="bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm tên hoặc mã kho…"
              className="w-full text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-400"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-[11px] text-slate-400 text-center py-3">Không tìm thấy</p>
            ) : filtered.map(w => (
              <label key={w.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(w.id)}
                  onChange={() => toggle(w.id)}
                  className="h-3.5 w-3.5 rounded accent-blue-600"
                />
                <span className="text-[11px] text-slate-700 flex-1 truncate">{w.name}</span>
                {w.code && <span className="text-[10px] text-slate-400 font-mono shrink-0">{w.code}</span>}
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-slate-100 px-3 py-1.5 flex items-center justify-between">
              <span className="text-[10px] text-slate-500">{selected.length} đã chọn</span>
              <button type="button" onClick={() => onChange([])} className="text-[10px] text-red-500 hover:text-red-700">
                Bỏ chọn tất cả
              </button>
            </div>
          )}
        </div>,
        document.body
      )}

      {showTags && selected.length > 0 && (
        <div className="flex gap-1 flex-wrap pt-1">
          {selected.map(wid => {
            const w = warehouses.find(x => x.id === wid)
            return w ? (
              <span key={wid} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 text-[10px]">
                {w.name}
                <button type="button" onClick={() => onChange(selected.filter(x => x !== wid))} className="hover:text-blue-900">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ) : null
          })}
        </div>
      )}
    </div>
  )
}
