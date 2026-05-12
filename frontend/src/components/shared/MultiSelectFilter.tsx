import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check, Minus } from 'lucide-react'

export interface MSOpt { value: string; label: string }

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  searchable = true,
  width,
}: {
  label: string
  options: MSOpt[]
  selected: string[]
  onChange: (v: string[]) => void
  searchable?: boolean
  width?: string
}) {
  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) { setSearch(''); return }
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const active  = selected.length > 0
  const visible = searchable && search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options
  const allSelected  = visible.length > 0 && visible.every(o => selected.includes(o.value))
  const someSelected = !allSelected && visible.some(o => selected.includes(o.value))

  function toggleAll() {
    if (allSelected) {
      const visibleVals = new Set(visible.map(o => o.value))
      onChange(selected.filter(v => !visibleVals.has(v)))
    } else {
      const toAdd = visible.map(o => o.value).filter(v => !selected.includes(v))
      onChange([...selected, ...toAdd])
    }
  }

  function toggle(value: string) {
    if (selected.includes(value)) onChange(selected.filter(v => v !== value))
    else onChange([...selected, value])
  }

  const triggerLabel = active ? `${label} (${selected.length})` : label

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`h-7 px-2 text-xs border rounded flex items-center gap-1 whitespace-nowrap transition-colors ${width ?? ''}
          ${active
            ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium'
            : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'
          }`}
      >
        {triggerLabel}
        <ChevronDown className="h-3 w-3 ml-0.5 opacity-70 shrink-0" />
      </button>

      {open && (
        <div
          className="absolute z-50 top-full left-0 mt-1 bg-white border rounded-md shadow-lg min-w-[190px] max-h-64 flex flex-col"
          onMouseDown={e => e.stopPropagation()}
        >
          {searchable && (
            <div className="p-1.5 border-b shrink-0">
              <input
                autoFocus
                className="w-full text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-400"
                placeholder="Tìm…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onMouseDown={e => e.stopPropagation()}
              />
            </div>
          )}

          <div className="overflow-y-auto flex-1">
            {/* Tất cả row */}
            <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer border-b border-slate-100">
              <MSCheckbox checked={allSelected} indeterminate={someSelected} onClick={toggleAll} />
              <span className="text-[11px] text-slate-500 font-medium">Tất cả</span>
            </label>

            {visible.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400 text-center">Không tìm thấy</div>
            ) : (
              visible.map(opt => (
                <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
                  <MSCheckbox checked={selected.includes(opt.value)} onClick={() => toggle(opt.value)} />
                  <span className="text-[11px] text-slate-700">{opt.label}</span>
                </label>
              ))
            )}
          </div>

          {active && (
            <div className="border-t shrink-0">
              <button
                type="button"
                className="w-full px-3 py-1.5 text-[10px] text-red-500 hover:bg-red-50 text-left"
                onClick={() => { onChange([]); setOpen(false) }}
              >
                Xóa lọc
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MSCheckbox({ checked, indeterminate, onClick }: {
  checked: boolean; indeterminate?: boolean; onClick: () => void
}) {
  return (
    <div
      onClick={e => { e.preventDefault(); onClick() }}
      className={`w-3.5 h-3.5 border rounded shrink-0 flex items-center justify-center cursor-pointer transition-colors
        ${checked || indeterminate ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white hover:border-blue-400'}`}
    >
      {checked     && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
      {!checked && indeterminate && <Minus className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
    </div>
  )
}
