import { useEffect, useRef, useState } from 'react'
import { ChevronDown, X, Plus, Check, Minus, Calendar } from 'lucide-react'
import { format, parseISO } from 'date-fns'

/**
 * FilterBar — thanh filter dạng chip kiểu Manhattan Active WMS.
 * Filter đang áp hiện thành chip có nút ✕; filter trống nằm trong menu "+ Thêm lọc".
 * Khai báo declarative qua `defs`, tái dùng cho mọi list page.
 */

export interface FBOpt { value: string; label: string }

export type FilterDef =
  | { key: string; label: string; type: 'multi';     options: FBOpt[]; selected: string[]; onChange: (v: string[]) => void; searchable?: boolean }
  | { key: string; label: string; type: 'single';    options: FBOpt[]; value: string; onChange: (v: string) => void; allLabel?: string }
  | { key: string; label: string; type: 'daterange'; from: string; to: string; onChange: (from: string, to: string) => void }
  | { key: string; label: string; type: 'text';      value: string; onChange: (v: string) => void; placeholder?: string }

const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

function isActive(def: FilterDef): boolean {
  switch (def.type) {
    case 'multi':     return def.selected.length > 0
    case 'single':    return def.value !== ''
    case 'daterange': return !!def.from || !!def.to
    case 'text':      return def.value.trim() !== ''
  }
}

function fmtDate(s: string): string {
  try { return format(parseISO(s), 'dd-MM-yyyy') } catch { return s }
}

function chipValue(def: FilterDef): string {
  switch (def.type) {
    case 'multi': {
      if (def.selected.length === 1) {
        const o = def.options.find(o => o.value === def.selected[0])
        return o?.label ?? def.selected[0]
      }
      return `${def.selected.length} mục`
    }
    case 'single': {
      const o = def.options.find(o => o.value === def.value)
      return o?.label ?? def.value
    }
    case 'daterange': {
      if (def.from && def.to) return def.from === def.to ? fmtDate(def.from) : `${fmtDate(def.from)} – ${fmtDate(def.to)}`
      if (def.from) return `Từ ${fmtDate(def.from)}`
      return `Đến ${fmtDate(def.to)}`
    }
    case 'text': return def.value
  }
}

function clearDef(def: FilterDef) {
  switch (def.type) {
    case 'multi':     def.onChange([]); break
    case 'single':    def.onChange(''); break
    case 'daterange': def.onChange('', ''); break
    case 'text':      def.onChange(''); break
  }
}

export function FilterBar({ defs, className }: { defs: FilterDef[]; className?: string }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openKey && !addOpen) return
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenKey(null); setAddOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openKey, addOpen])

  const activeDefs   = defs.filter(isActive)
  const visibleDefs  = defs.filter(d => isActive(d) || d.key === openKey)
  const inactiveDefs = defs.filter(d => !isActive(d))

  return (
    <div ref={barRef} className={`flex items-center gap-1.5 flex-wrap ${className ?? ''}`}>
      {/* "+ Thêm lọc" */}
      <div className="relative">
        <button
          type="button"
          onClick={() => { setAddOpen(v => !v); setOpenKey(null) }}
          className="h-7 px-2 inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 text-xs font-medium text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Thêm lọc
        </button>
        {addOpen && (
          <div className="absolute z-50 top-full left-0 mt-1 bg-white border rounded-md shadow-lg min-w-[160px] py-1"
            onMouseDown={e => e.stopPropagation()}>
            {inactiveDefs.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400 text-center">Đã thêm hết</div>
            ) : inactiveDefs.map(d => (
              <button key={d.key} type="button"
                className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                onClick={() => { setAddOpen(false); setOpenKey(d.key) }}>
                {d.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chips */}
      {visibleDefs.map(def => (
        <FilterChip
          key={def.key}
          def={def}
          open={openKey === def.key}
          onToggle={() => setOpenKey(k => (k === def.key ? null : def.key))}
          onClose={() => setOpenKey(null)}
        />
      ))}

      {/* Xóa tất cả */}
      {activeDefs.length > 0 && (
        <button
          type="button"
          onClick={() => { activeDefs.forEach(clearDef); setOpenKey(null) }}
          className="h-7 px-1.5 inline-flex items-center gap-0.5 text-[11px] text-red-400 hover:text-red-600 transition-colors"
        >
          <X className="h-3 w-3" /> Xóa tất cả
        </button>
      )}
    </div>
  )
}

function FilterChip({ def, open, onToggle, onClose }: {
  def: FilterDef; open: boolean; onToggle: () => void; onClose: () => void
}) {
  const active = isActive(def)
  return (
    <div className="relative">
      <div className={`h-7 inline-flex items-center rounded-full border text-xs transition-colors ${
        active ? 'border-blue-300 bg-blue-50' : 'border-slate-300 bg-white'
      }`}>
        <button type="button" onClick={onToggle} className="h-full pl-2.5 pr-1.5 inline-flex items-center gap-1">
          <span className="text-slate-500">{def.label}</span>
          {active && <span className="font-medium text-slate-800 max-w-[160px] truncate">{chipValue(def)}</span>}
          <ChevronDown className="h-3 w-3 text-slate-400 shrink-0" />
        </button>
        {active && (
          <button type="button" onClick={() => { clearDef(def); onClose() }}
            className="h-full pr-2 pl-0.5 text-slate-400 hover:text-red-500 transition-colors" title="Bỏ lọc">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1" onMouseDown={e => e.stopPropagation()}>
          <FilterPopover def={def} onClose={onClose} />
        </div>
      )}
    </div>
  )
}

function FilterPopover({ def, onClose }: { def: FilterDef; onClose: () => void }) {
  if (def.type === 'text') {
    return (
      <div className="bg-white border rounded-md shadow-lg p-2 w-[200px]">
        <input
          autoFocus
          className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 outline-none focus:border-blue-400"
          placeholder={def.placeholder ?? 'Nhập…'}
          value={def.value}
          onChange={e => def.onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onClose() }}
        />
      </div>
    )
  }

  if (def.type === 'daterange') {
    return (
      <div className="bg-white border rounded-md shadow-lg p-2.5 w-[220px] space-y-2">
        <div className="space-y-1">
          <label className="text-[10px] text-slate-500">Từ ngày</label>
          <div className="relative">
            <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <input type="date" value={def.from}
              onChange={e => def.onChange(e.target.value, def.to)}
              className="w-full h-8 pl-7 pr-2 text-xs border border-slate-200 rounded outline-none focus:border-blue-400" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-500">Đến ngày</label>
          <div className="relative">
            <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <input type="date" value={def.to}
              onChange={e => def.onChange(def.from, e.target.value)}
              className="w-full h-8 pl-7 pr-2 text-xs border border-slate-200 rounded outline-none focus:border-blue-400" />
          </div>
        </div>
        <div className="flex items-center justify-between pt-0.5">
          <button type="button" className="text-[11px] text-blue-600 hover:text-blue-800"
            onClick={() => def.onChange(todayVN(), todayVN())}>Hôm nay</button>
          <button type="button" className="text-[11px] text-red-400 hover:text-red-600"
            onClick={() => { def.onChange('', ''); onClose() }}>Xóa</button>
        </div>
      </div>
    )
  }

  // multi | single
  return def.type === 'single'
    ? <SingleList def={def} onClose={onClose} />
    : <MultiList def={def} onClose={onClose} />
}

function SingleList({ def, onClose }: { def: Extract<FilterDef, { type: 'single' }>; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const visible = search
    ? def.options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : def.options
  return (
    <div className="bg-white border rounded-md shadow-lg min-w-[190px] max-h-64 flex flex-col">
      <div className="p-1.5 border-b shrink-0">
        <input autoFocus className="w-full text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-400"
          placeholder="Tìm…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="overflow-y-auto flex-1 py-0.5">
        <button type="button" onClick={() => { def.onChange(''); onClose() }}
          className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-slate-50 ${def.value === '' ? 'text-blue-700 font-medium' : 'text-slate-500'}`}>
          {def.allLabel ?? 'Tất cả'}
        </button>
        {visible.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-400 text-center">Không tìm thấy</div>
        ) : visible.map(o => (
          <button key={o.value} type="button" onClick={() => { def.onChange(o.value); onClose() }}
            className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-slate-50 ${def.value === o.value ? 'text-blue-700 font-medium' : 'text-slate-700'}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function MultiList({ def, onClose }: { def: Extract<FilterDef, { type: 'multi' }>; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const searchable = def.searchable ?? true
  const visible = searchable && search
    ? def.options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : def.options
  const allSelected  = visible.length > 0 && visible.every(o => def.selected.includes(o.value))
  const someSelected = !allSelected && visible.some(o => def.selected.includes(o.value))
  function toggleAll() {
    if (allSelected) {
      const vis = new Set(visible.map(o => o.value))
      def.onChange(def.selected.filter(v => !vis.has(v)))
    } else {
      def.onChange([...def.selected, ...visible.map(o => o.value).filter(v => !def.selected.includes(v))])
    }
  }
  function toggle(v: string) {
    def.onChange(def.selected.includes(v) ? def.selected.filter(x => x !== v) : [...def.selected, v])
  }

  return (
    <div className="bg-white border rounded-md shadow-lg min-w-[190px] max-h-64 flex flex-col">
      {searchable && (
        <div className="p-1.5 border-b shrink-0">
          <input autoFocus className="w-full text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-400"
            placeholder="Tìm…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      )}
      <div className="overflow-y-auto flex-1">
        <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer border-b border-slate-100">
          <Cbx checked={allSelected} indeterminate={someSelected} onClick={toggleAll} />
          <span className="text-[11px] text-slate-500 font-medium">Tất cả</span>
        </label>
        {visible.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-400 text-center">Không tìm thấy</div>
        ) : visible.map(o => (
          <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
            <Cbx checked={def.selected.includes(o.value)} onClick={() => toggle(o.value)} />
            <span className="text-[11px] text-slate-700">{o.label}</span>
          </label>
        ))}
      </div>
      {def.selected.length > 0 && (
        <div className="border-t shrink-0">
          <button type="button" className="w-full px-3 py-1.5 text-[10px] text-red-500 hover:bg-red-50 text-left"
            onClick={() => { def.onChange([]); onClose() }}>Xóa lọc</button>
        </div>
      )}
    </div>
  )
}

function Cbx({ checked, indeterminate, onClick }: { checked: boolean; indeterminate?: boolean; onClick: () => void }) {
  return (
    <div onClick={e => { e.preventDefault(); onClick() }}
      className={`w-3.5 h-3.5 border rounded shrink-0 flex items-center justify-center cursor-pointer transition-colors
        ${checked || indeterminate ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white hover:border-blue-400'}`}>
      {checked && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
      {!checked && indeterminate && <Minus className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
    </div>
  )
}
