import { createPortal } from 'react-dom'
import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

interface Warehouse {
  id: string
  code?: string
  name: string
}

interface WarehouseSingleSelectProps {
  warehouses: Warehouse[]
  value: string            // '' = none/all
  onChange: (id: string) => void
  allLabel?: string        // nếu có, hiện option "tất cả" với value ''
  placeholder?: string
  disabled?: boolean
  dropUp?: boolean         // kept for compat — auto-detects direction now
  triggerClassName?: string
}

type DropPos = { top?: number; bottom?: number; left: number; width: number }

export function WarehouseSingleSelect({
  warehouses, value, onChange,
  allLabel, placeholder = 'Chọn kho…',
  disabled, triggerClassName = '',
}: WarehouseSingleSelectProps) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const [pos, setPos]       = useState<DropPos | null>(null)
  const triggerRef  = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const filtered = warehouses.filter(w =>
    w.name.toLowerCase().includes(search.toLowerCase()) ||
    (w.code ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const selectedWh   = warehouses.find(w => w.id === value)
  const displayLabel = value === ''
    ? (allLabel ?? placeholder)
    : (selectedWh?.name ?? placeholder)

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
        disabled={disabled}
        onClick={handleToggle}
        className={`flex items-center justify-between gap-1.5 border border-slate-200 rounded-md px-2.5 text-xs w-full h-full
          bg-white hover:border-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
          ${!value ? 'text-slate-400' : 'text-slate-700'}`}
        style={{ minHeight: '28px' }}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && pos && createPortal(
        <div ref={dropdownRef} data-wh-portal="" style={dropStyle}
          className="bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm tên hoặc mã kho…"
              className="w-full text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-400"
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
        </div>,
        document.body
      )}
    </div>
  )
}
