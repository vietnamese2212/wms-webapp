import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'

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
  dropUp?: boolean         // mở lên — dùng khi ở trong dialog overflow-y-auto
  triggerClassName?: string
}

export function WarehouseSingleSelect({
  warehouses, value, onChange,
  allLabel, placeholder = 'Chọn kho…',
  disabled, dropUp, triggerClassName = '',
}: WarehouseSingleSelectProps) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)

  const filtered = warehouses.filter(w =>
    w.name.toLowerCase().includes(search.toLowerCase()) ||
    (w.code ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const selectedWh   = warehouses.find(w => w.id === value)
  const displayLabel = value === ''
    ? (allLabel ?? placeholder)
    : (selectedWh?.name ?? placeholder)

  function close() { setOpen(false); setSearch('') }

  // Click-outside handler — same pattern as material dropdown
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open]) // eslint-disable-line

  return (
    <div ref={wrapperRef} className={`relative ${triggerClassName}`}>
      <button
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

      {open && (
        <div className={`absolute z-[200] w-full min-w-[160px] bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden
          ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
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
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(''); close() }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] hover:bg-slate-50 transition-colors
                  ${value === '' ? 'text-blue-600 font-medium' : 'text-slate-500'}`}
              >
                <span>{allLabel}</span>
                {value === '' && <Check className="h-3 w-3 shrink-0" />}
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="text-[11px] text-slate-400 text-center py-3">Không tìm thấy</p>
            ) : filtered.map(w => (
              <button
                key={w.id}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(w.id); close() }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] hover:bg-slate-50 transition-colors
                  ${w.id === value ? 'text-blue-600 font-medium bg-blue-50/50' : 'text-slate-700'}`}
              >
                <span className="flex-1 text-left truncate">
                  {w.name}{w.code ? <span className="ml-1 text-slate-400">({w.code})</span> : null}
                </span>
                {w.id === value && <Check className="h-3 w-3 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
