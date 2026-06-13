import { useEffect, useRef, useState } from 'react'
import { ChevronDown, X, Plus, Check, Minus, Calendar, SlidersHorizontal, ChevronRight } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

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
    <>
    {/* Mobile: gom thành 1 nút "Lọc (n)" mở sheet — không trải chip ngang chiếm chỗ */}
    <div className="sm:hidden w-full">
      <MobileFilterSheet defs={defs} activeCount={activeDefs.length} onClearAll={() => activeDefs.forEach(clearDef)} />
    </div>

    {/* Desktop/tablet: chip bar inline */}
    <div ref={barRef} className={`hidden sm:flex items-center gap-1.5 flex-wrap ${className ?? ''}`}>
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
    </>
  )
}

// ─── Mobile: sheet chứa toàn bộ filter dạng accordion ───
function MobileFilterSheet({ defs, activeCount, onClearAll }: {
  defs: FilterDef[]; activeCount: number; onClearAll: () => void
}) {
  const [open, setOpen]         = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={`h-8 w-full inline-flex items-center justify-center gap-1.5 rounded-md border text-xs font-medium transition-colors ${
          activeCount > 0 ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 bg-white'
        }`}>
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Lọc
        {activeCount > 0 && (
          <span className="bg-blue-600 text-white text-[10px] rounded-full min-w-4 h-4 px-1 inline-flex items-center justify-center leading-none">
            {activeCount}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[100vw] w-screen h-[100dvh] sm:h-auto sm:max-w-md sm:w-full rounded-none sm:rounded-lg p-0 gap-0 flex flex-col">
          <DialogHeader className="px-4 py-3 border-b shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base">Bộ lọc</DialogTitle>
              {activeCount > 0 && (
                <button type="button" onClick={() => { onClearAll(); setExpanded(null) }}
                  className="text-xs text-red-500 hover:text-red-700">Xóa tất cả</button>
              )}
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
            {defs.map(def => {
              const active = isActive(def)
              const isOpen = expanded === def.key
              return (
                <div key={def.key}>
                  <button type="button" onClick={() => setExpanded(isOpen ? null : def.key)}
                    className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left">
                    <span className="text-sm text-slate-700">{def.label}</span>
                    <span className="flex items-center gap-1 min-w-0">
                      <span className={`text-xs truncate max-w-[160px] ${active ? 'font-medium text-blue-700' : 'text-slate-400'}`}>
                        {active ? chipValue(def) : 'Tất cả'}
                      </span>
                      <ChevronRight className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3">
                      <FilterPopover def={def} onClose={() => setExpanded(null)} fullWidth />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="px-4 py-3 border-t shrink-0">
            <button type="button" onClick={() => setOpen(false)}
              className="w-full h-10 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors">
              Xem kết quả
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
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

function FilterPopover({ def, onClose, fullWidth = false }: { def: FilterDef; onClose: () => void; fullWidth?: boolean }) {
  const shell = fullWidth ? 'w-full' : 'bg-white border rounded-md shadow-lg'
  const inputH = fullWidth ? 'h-10 text-sm' : 'h-8 text-xs'

  if (def.type === 'text') {
    return (
      <div className={`${shell} ${fullWidth ? '' : 'p-2 w-[200px]'}`}>
        <input
          autoFocus
          className={`w-full border border-slate-200 rounded px-2 outline-none focus:border-blue-400 ${inputH}`}
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
      <div className={`${shell} space-y-2 ${fullWidth ? '' : 'p-2.5 w-[220px]'}`}>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-500">Từ ngày</label>
          <div className="relative">
            <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <input type="date" value={def.from}
              onChange={e => def.onChange(e.target.value, def.to)}
              className={`w-full pl-7 pr-2 border border-slate-200 rounded outline-none focus:border-blue-400 ${inputH}`} />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-500">Đến ngày</label>
          <div className="relative">
            <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <input type="date" value={def.to}
              onChange={e => def.onChange(def.from, e.target.value)}
              className={`w-full pl-7 pr-2 border border-slate-200 rounded outline-none focus:border-blue-400 ${inputH}`} />
          </div>
        </div>
        <div className="flex items-center justify-between pt-0.5">
          <button type="button" className="text-xs text-blue-600 hover:text-blue-800"
            onClick={() => def.onChange(todayVN(), todayVN())}>Hôm nay</button>
          <button type="button" className="text-xs text-red-400 hover:text-red-600"
            onClick={() => { def.onChange('', ''); onClose() }}>Xóa</button>
        </div>
      </div>
    )
  }

  // multi | single
  return def.type === 'single'
    ? <SingleList def={def} onClose={onClose} fullWidth={fullWidth} />
    : <MultiList def={def} onClose={onClose} fullWidth={fullWidth} />
}

function SingleList({ def, onClose, fullWidth = false }: { def: Extract<FilterDef, { type: 'single' }>; onClose: () => void; fullWidth?: boolean }) {
  const [search, setSearch] = useState('')
  const visible = search
    ? def.options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : def.options
  const shell = fullWidth ? 'w-full max-h-72 border rounded-md' : 'shadow-lg min-w-[190px] max-h-64'
  const row   = fullWidth ? 'py-2.5 text-sm' : 'py-1.5 text-[11px]'
  return (
    <div className={`bg-white border rounded-md flex flex-col ${shell}`}>
      <div className="p-1.5 border-b shrink-0">
        <input autoFocus className={`w-full border border-slate-200 rounded px-2 outline-none focus:border-blue-400 ${fullWidth ? 'h-9 text-sm' : 'py-1 text-xs'}`}
          placeholder="Tìm…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="overflow-y-auto flex-1 py-0.5">
        <button type="button" onClick={() => { def.onChange(''); onClose() }}
          className={`w-full text-left px-3 hover:bg-slate-50 ${row} ${def.value === '' ? 'text-blue-700 font-medium' : 'text-slate-500'}`}>
          {def.allLabel ?? 'Tất cả'}
        </button>
        {visible.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-400 text-center">Không tìm thấy</div>
        ) : visible.map(o => (
          <button key={o.value} type="button" onClick={() => { def.onChange(o.value); onClose() }}
            className={`w-full text-left px-3 hover:bg-slate-50 ${row} ${def.value === o.value ? 'text-blue-700 font-medium' : 'text-slate-700'}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function MultiList({ def, onClose, fullWidth = false }: { def: Extract<FilterDef, { type: 'multi' }>; onClose: () => void; fullWidth?: boolean }) {
  const [search, setSearch] = useState('')
  const searchable = def.searchable ?? true
  const visible = searchable && search
    ? def.options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : def.options
  const allSelected  = visible.length > 0 && visible.every(o => def.selected.includes(o.value))
  const someSelected = !allSelected && visible.some(o => def.selected.includes(o.value))
  const shell = fullWidth ? 'w-full max-h-72 border rounded-md' : 'shadow-lg min-w-[190px] max-h-64'
  const row   = fullWidth ? 'py-2.5 text-sm' : 'py-1.5 text-[11px]'
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
    <div className={`bg-white border rounded-md flex flex-col ${shell}`}>
      {searchable && (
        <div className="p-1.5 border-b shrink-0">
          <input autoFocus className={`w-full border border-slate-200 rounded px-2 outline-none focus:border-blue-400 ${fullWidth ? 'h-9 text-sm' : 'py-1 text-xs'}`}
            placeholder="Tìm…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      )}
      <div className="overflow-y-auto flex-1">
        <label className={`flex items-center gap-2 px-3 hover:bg-slate-50 cursor-pointer border-b border-slate-100 ${row}`}>
          <Cbx checked={allSelected} indeterminate={someSelected} onClick={toggleAll} />
          <span className={`text-slate-500 font-medium ${fullWidth ? 'text-sm' : 'text-[11px]'}`}>Tất cả</span>
        </label>
        {visible.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-400 text-center">Không tìm thấy</div>
        ) : visible.map(o => (
          <label key={o.value} className={`flex items-center gap-2 px-3 hover:bg-slate-50 cursor-pointer ${row}`}>
            <Cbx checked={def.selected.includes(o.value)} onClick={() => toggle(o.value)} />
            <span className={`text-slate-700 ${fullWidth ? 'text-sm' : 'text-[11px]'}`}>{o.label}</span>
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
