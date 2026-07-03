import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { usePopoverAnchor } from './usePopoverAnchor'

interface Warehouse {
  id: string
  code?: string
  name: string
}

interface WarehouseSingleSelectProps {
  warehouses: Warehouse[]
  value: string            // '' = none/all
  onChange: (id: string) => void
  allLabel?: string
  placeholder?: string
  disabled?: boolean
  dropUp?: boolean         // giữ prop cho tương thích — vị trí thực do usePopoverAnchor tự tính
  triggerClassName?: string
}

export function WarehouseSingleSelect({
  warehouses, value, onChange,
  allLabel, placeholder = 'Chọn kho…',
  disabled, triggerClassName = '',
}: WarehouseSingleSelectProps) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const anchor = usePopoverAnchor(triggerRef, open)

  const filtered = warehouses.filter(w =>
    w.name.toLowerCase().includes(search.toLowerCase()) ||
    (w.code ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const selectedWh   = warehouses.find(w => w.id === value)
  const displayLabel = value === ''
    ? (allLabel ?? placeholder)
    : (selectedWh?.name ?? placeholder)

  function close() { setOpen(false); setSearch('') }

  return (
    <div className={triggerClassName}>
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => setOpen(o => !o)}
          className={`flex items-center justify-between gap-1.5 border border-slate-200 rounded-md px-2.5 text-xs w-full h-full
            bg-white hover:border-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
            ${!value ? 'text-slate-400' : 'text-slate-700'}`}
          style={{ minHeight: '28px' }}
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && anchor && createPortal(
          <>
            <div className="fixed inset-0 z-[190] pointer-events-auto" onClick={close} />
            <div
              className="fixed z-[200] pointer-events-auto bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden"
              style={{
                left: anchor.left,
                width: Math.max(anchor.width, 180),
                ...(anchor.dropUp
                  ? { bottom: window.innerHeight - anchor.top + 4 }
                  : { top: anchor.top + 4 }),
              }}
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
                {allLabel !== undefined && (
                  <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={value === ''}
                      onChange={() => { onChange(''); close() }}
                      className="h-3.5 w-3.5 rounded accent-blue-600"
                    />
                    <span className="text-[11px] text-slate-700 flex-1 truncate">{allLabel}</span>
                  </label>
                )}
                {filtered.length === 0 ? (
                  <p className="text-[11px] text-slate-400 text-center py-3">Không tìm thấy</p>
                ) : filtered.map(w => (
                  <label key={w.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={w.id === value}
                      onChange={() => { onChange(w.id); close() }}
                      className="h-3.5 w-3.5 rounded accent-blue-600"
                    />
                    <span className="text-[11px] text-slate-700 flex-1 truncate">{w.name}</span>
                    {w.code && <span className="text-[10px] text-slate-400 font-mono shrink-0">{w.code}</span>}
                  </label>
                ))}
              </div>
            </div>
          </>,
          document.body,
        )}
      </div>
    </div>
  )
}
