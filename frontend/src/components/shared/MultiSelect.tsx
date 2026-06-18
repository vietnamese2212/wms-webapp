import { useState, type ReactNode } from 'react'
import { ChevronDown, X } from 'lucide-react'

export interface MultiSelectOption {
  id: string
  label: string
  sub?: string        // phụ đề bên phải (mã, phòng ban…)
}

interface MultiSelectProps {
  options: MultiSelectOption[]
  selected: string[]
  onChange: (ids: string[]) => void
  placeholder?: string       // khi chưa chọn gì
  searchPlaceholder?: string
  unit?: string              // "N <unit> đã chọn"
  icon?: ReactNode           // icon trái (đồng bộ với SelectTrigger)
  dropUp?: boolean
  showTags?: boolean         // hiện tags bên dưới (default true)
  className?: string         // wrapper (vd w-[180px])
}

// Dropdown multi-select chuẩn: search + checkbox + tags + bỏ chọn tất cả.
export function MultiSelect({
  options, selected, onChange,
  placeholder = 'Chọn…',
  searchPlaceholder = 'Tìm…',
  unit = 'mục',
  icon,
  dropUp, showTags = true, className = '',
}: MultiSelectProps) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')

  const q = search.toLowerCase()
  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(q) || (o.sub ?? '').toLowerCase().includes(q)
  )

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }
  function close() { setOpen(false); setSearch('') }

  return (
    <div className={className}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="w-full flex h-8 items-center justify-between rounded-md border border-input bg-background px-3 text-sm hover:border-slate-300 transition-colors"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            {icon}
            <span className={`truncate ${selected.length === 0 ? 'text-slate-400' : 'text-slate-700'}`}>
              {selected.length === 0 ? placeholder : `${selected.length} ${unit} đã chọn`}
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 opacity-50 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={close} />
            <div className={`absolute z-50 w-full min-w-[200px] bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden
              ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
              <div className="p-2 border-b border-slate-100">
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-400"
                  autoFocus
                />
              </div>
              <div className="max-h-48 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="text-[11px] text-slate-400 text-center py-3">Không tìm thấy</p>
                ) : filtered.map(o => (
                  <label key={o.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.includes(o.id)}
                      onChange={() => toggle(o.id)}
                      className="h-3.5 w-3.5 rounded accent-blue-600"
                    />
                    <span className="text-[11px] text-slate-700 flex-1 truncate">{o.label}</span>
                    {o.sub && <span className="text-[10px] text-slate-400 shrink-0">{o.sub}</span>}
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
          </>
        )}
      </div>

      {showTags && selected.length > 0 && (
        <div className="flex gap-1 flex-wrap pt-1">
          {selected.map(id => {
            const o = options.find(x => x.id === id)
            return o ? (
              <span key={id} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 text-[10px]">
                {o.label}
                <button type="button" onClick={() => onChange(selected.filter(x => x !== id))} className="hover:text-blue-900">
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
