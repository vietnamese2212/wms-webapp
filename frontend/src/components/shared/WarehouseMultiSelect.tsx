import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'
import { usePopoverAnchor } from './usePopoverAnchor'

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
  dropUp?: boolean         // mở lên — dùng khi ở trong dialog overflow-y-auto
  showTags?: boolean       // hiện tags bên dưới (default true)
  triggerClassName?: string
}

export function WarehouseMultiSelect({
  warehouses, selected, onChange,
  placeholder = 'Chọn kho…',
  showTags = true, triggerClassName = '',
}: WarehouseMultiSelectProps) {
  const [open, setOpen]   = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const anchor = usePopoverAnchor(triggerRef, open)

  const filtered = warehouses.filter(w =>
    w.name.toLowerCase().includes(search.toLowerCase()) ||
    (w.code ?? '').toLowerCase().includes(search.toLowerCase())
  )

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }

  function close() { setOpen(false); setSearch('') }

  return (
    <div className={triggerClassName}>
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between bg-white border border-slate-200 rounded-md px-3 py-1.5 text-xs hover:border-slate-300 transition-colors"
          style={{ minHeight: '28px' }}
        >
          <span className={selected.length === 0 ? 'text-slate-400' : 'text-slate-700'}>
            {selected.length === 0 ? placeholder : `${selected.length} kho được chọn`}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && anchor && createPortal(
          <>
            <div className="fixed inset-0 z-[190] pointer-events-auto" onClick={close} />
            <div
              className="z-[200] pointer-events-auto min-w-[180px] bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden"
              style={anchor.style}
            >
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
            </div>
          </>,
          anchor.target,
        )}
      </div>

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
