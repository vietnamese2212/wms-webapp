import { useEffect, useMemo, useState } from 'react'
import { Package, Search, X, SlidersHorizontal, ChevronRight, Filter, ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
  DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import {
  useInventoryEntries, useWarehouses, useQAStatuses, useAdjustInventory,
  useLocationsReal, useMaterials, useLocationSubTypes,
  useBulkUpdateInventoryQA, useBulkTransferLocation, useBulkTransferMaterial,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import type { InventoryEntry } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────

function formatLoc(loc: { location_code: string; sub_code: string } | null): string {
  if (!loc) return '—'
  const tang = loc.sub_code?.split('-')[0] ?? ''
  return tang ? `${loc.location_code}_${tang}` : loc.location_code
}

function calcDatePct(prodDate: string | null, shelfDays: number | null): number | null {
  if (!prodDate || !shelfDays || shelfDays <= 0) return null
  const prod = new Date(prodDate)
  if (isNaN(prod.getTime())) return null
  const totalMs = shelfDays * 86_400_000
  const remaining = prod.getTime() + totalMs - Date.now()
  return Math.max(0, Math.round((remaining / totalMs) * 100))
}

function datePctCls(pct: number): string {
  if (pct >= 70) return 'text-green-600 font-semibold'
  if (pct >= 40) return 'text-amber-600 font-semibold'
  return 'text-red-600 font-semibold'
}

function entryRowBg(e: InventoryEntry, selected: boolean, checked: boolean): string {
  if (checked)   return 'bg-green-50 hover:bg-green-100'
  if (selected)  return 'bg-blue-100'
  if (e.status === 'PARTIAL')    return 'bg-amber-50 hover:bg-amber-100'
  if (e.status === 'QUARANTINE') return 'bg-red-50 hover:bg-red-100'
  if (e.status === 'EXPORTED' || e.status === 'TRANSFERRED') return 'bg-blue-50 hover:bg-blue-100'
  return 'hover:bg-slate-50'
}

const STATUS_LABEL: Record<string, string> = {
  IN_STOCK: 'Còn hàng', PARTIAL: 'Xuất 1 phần', EXPORTED: 'Đã xuất',
  TRANSFERRED: 'Đã chuyển', QUARANTINE: 'Cách ly', CANCELLED: 'Đã hủy',
}
const STATUS_CLS: Record<string, string> = {
  IN_STOCK: 'bg-green-100 text-green-700', PARTIAL: 'bg-amber-100 text-amber-700',
  EXPORTED: 'bg-blue-100 text-blue-700', TRANSFERRED: 'bg-slate-100 text-slate-600',
  QUARANTINE: 'bg-red-100 text-red-700', CANCELLED: 'bg-gray-100 text-gray-500',
}

const LIMIT = 50
const DATE_PCT_OPTIONS = [
  { value: '80', label: '> 80%' },
  { value: '60', label: '> 60%' },
  { value: '30', label: '> 30%' },
]

// ─── QA multi-select dropdown ────────────────────────────────

function QAFilterDropdown({ qaStatuses, selected, onChange }: {
  qaStatuses: { id: string; code: string; name: string }[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  // Exclude OK status from filter options (blank = OK)
  const options = qaStatuses.filter(q => q.code.toUpperCase() !== 'OK')
  const label = selected.length === 0 ? 'QA Status' : `QA (${selected.length})`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={`h-7 text-xs px-2.5 rounded border bg-white flex items-center gap-1 whitespace-nowrap ${
          selected.length > 0 ? 'border-blue-300 text-blue-700 font-medium' : 'border-slate-200 text-slate-600'
        }`}>
          {label}
          <ChevronDown className="h-3 w-3 opacity-60 ml-0.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[190px]">
        {options.map(q => (
          <DropdownMenuCheckboxItem
            key={q.id}
            className="text-xs"
            checked={selected.includes(q.id)}
            onCheckedChange={checked => {
              if (checked) onChange([...selected, q.id])
              else onChange(selected.filter(id => id !== q.id))
            }}
          >
            {q.code} – {q.name}
          </DropdownMenuCheckboxItem>
        ))}
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel
              className="text-[10px] text-slate-400 cursor-pointer hover:text-slate-700 py-1.5 font-normal"
              onClick={() => onChange([])}
            >
              Xóa lọc QA
            </DropdownMenuLabel>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Action modals ────────────────────────────────────────────

function QAModal({ open, ids, qaStatuses, onClose }: {
  open: boolean
  ids: string[]
  qaStatuses: { id: string; code: string; name: string }[]
  onClose: () => void
}) {
  const [qaId, setQaId]     = useState('')
  const [error, setError]   = useState('')
  const { mutate, isPending } = useBulkUpdateInventoryQA()

  // Only show non-OK QA statuses in the action modal
  const options = qaStatuses.filter(q => q.code.toUpperCase() !== 'OK')

  function handleSubmit() {
    setError('')
    mutate(
      { ids, qa_status_id: qaId === '__clear__' ? null : qaId },
      {
        onSuccess: () => { setQaId(''); onClose() },
        onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Lỗi không xác định'),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { setQaId(''); setError(''); onClose() } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cập nhật QA Status</DialogTitle>
          <p className="text-xs text-slate-500">{ids.length} pallet đã chọn</p>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">QA Status mới</Label>
            <Select value={qaId} onValueChange={setQaId}>
              <SelectTrigger><SelectValue placeholder="Chọn QA status…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__clear__">— Xóa QA (trả về OK) —</SelectItem>
                {options.map(q => (
                  <SelectItem key={q.id} value={q.id}>{q.code} – {q.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button disabled={!qaId || isPending} onClick={handleSubmit}>
            {isPending ? '…' : 'Cập nhật'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LocationModal({ open, ids, warehouseId, onClose }: {
  open: boolean; ids: string[]; warehouseId?: string; onClose: () => void
}) {
  const [search, setSearch]   = useState('')
  const [locId, setLocId]     = useState('')
  const [error, setError]     = useState('')
  const { mutate, isPending }  = useBulkTransferLocation()
  const { data: allLocs = [] } = useLocationsReal(warehouseId ? { warehouse_id: warehouseId } : undefined)

  const filtered = useMemo(() => {
    if (!search) return []
    const s = search.toLowerCase()
    return (allLocs as any[]).filter((l: any) =>
      l.location_code?.toLowerCase().includes(s) || l.sub_code?.toLowerCase().includes(s)
    ).slice(0, 20)
  }, [allLocs, search])

  const selectedLoc = useMemo(() =>
    (allLocs as any[]).find((l: any) => l.id === locId), [allLocs, locId]
  )

  function reset() { setLocId(''); setSearch(''); setError('') }

  function handleSubmit() {
    if (!locId) { setError('Chọn vị trí trước'); return }
    setError('')
    mutate(
      { ids, location_id: locId },
      {
        onSuccess: () => { reset(); onClose() },
        onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Lỗi không xác định'),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Chuyển vị trí</DialogTitle>
          <p className="text-xs text-slate-500">{ids.length} pallet đã chọn</p>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Vị trí mới</Label>
            {selectedLoc ? (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded px-3 py-1.5">
                <span className="text-sm font-mono font-semibold text-blue-800">{formatLoc(selectedLoc)}</span>
                <span className="text-xs text-blue-500 ml-1">({selectedLoc.used_slots ?? 0}/{selectedLoc.max_pallets})</span>
                <button className="ml-auto text-blue-400 hover:text-blue-600" onClick={reset}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <>
                <Input placeholder="Tìm vị trí…" value={search} autoFocus
                  onChange={e => setSearch(e.target.value)} className="h-8 text-sm" />
                {search && (
                  <div className="border rounded max-h-44 overflow-y-auto">
                    {filtered.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-slate-400 text-center">Không tìm thấy</div>
                    ) : (
                      filtered.map((l: any) => {
                        const isFull = l.max_pallets > 0 && (l.used_slots ?? 0) >= l.max_pallets
                        return (
                          <button key={l.id}
                            disabled={isFull}
                            className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${
                              isFull ? 'opacity-50 cursor-not-allowed bg-slate-50' : 'hover:bg-slate-50'
                            }`}
                            onClick={() => { if (!isFull) { setLocId(l.id); setSearch('') } }}>
                            <span className="font-mono font-semibold">{formatLoc(l)}</span>
                            <span className={`ml-auto ${isFull ? 'text-red-400 font-medium' : 'text-slate-400'}`}>
                              {l.used_slots ?? 0}/{l.max_pallets}{isFull ? ' (đầy)' : ''}
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose() }}>Huỷ</Button>
          <Button disabled={!locId || isPending} onClick={handleSubmit}>
            {isPending ? '…' : 'Chuyển'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MaterialModal({ open, ids, onClose }: {
  open: boolean; ids: string[]; onClose: () => void
}) {
  const [search, setSearch]   = useState('')
  const [matId, setMatId]     = useState('')
  const [error, setError]     = useState('')
  const { mutate, isPending }  = useBulkTransferMaterial()
  const { data: materials = [] } = useMaterials({ search: search || undefined })

  const selectedMat = useMemo(() =>
    (materials as any[]).find((m: any) => m.id === matId), [materials, matId]
  )

  function reset() { setMatId(''); setSearch(''); setError('') }

  function handleSubmit() {
    if (!matId) { setError('Chọn hàng hóa trước'); return }
    setError('')
    mutate(
      { ids, material_id: matId },
      {
        onSuccess: () => { reset(); onClose() },
        onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Lỗi không xác định'),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Chuyển mã hàng</DialogTitle>
          <p className="text-xs text-slate-500">{ids.length} pallet đã chọn</p>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Hàng hóa mới</Label>
            {matId && selectedMat ? (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded px-3 py-1.5">
                <div className="min-w-0">
                  <span className="text-xs font-mono font-semibold text-blue-800">{selectedMat.material_code}</span>
                  <span className="text-xs text-blue-600 ml-1.5 truncate">{selectedMat.short_name ?? ''}</span>
                </div>
                <button className="ml-auto text-blue-400 hover:text-blue-600 shrink-0" onClick={reset}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <>
                <Input placeholder="Tìm mã hoặc tên hàng…" value={search} autoFocus
                  onChange={e => { setSearch(e.target.value); setMatId('') }} className="h-8 text-sm" />
                {search && (
                  <div className="border rounded max-h-44 overflow-y-auto">
                    {(materials as any[]).length === 0 ? (
                      <div className="px-3 py-2 text-xs text-slate-400 text-center">Không tìm thấy</div>
                    ) : (
                      (materials as any[]).map((m: any) => (
                        <button key={m.id}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-baseline gap-2"
                          onClick={() => { setMatId(m.id); setSearch('') }}>
                          <span className="font-mono text-slate-500 shrink-0">{m.material_code}</span>
                          <span className="text-slate-700 truncate">{m.short_name ?? m.material_description}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose() }}>Huỷ</Button>
          <Button disabled={!matId || isPending} onClick={handleSubmit}>
            {isPending ? '…' : 'Chuyển'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main component ───────────────────────────────────────────

export default function Inventory() {
  const user = useAuthStore(s => s.user)
  const { inventory: f, setInventory } = useWmsFilterStore()

  const [selected,     setSelected]     = useState<InventoryEntry | null>(null)
  const [checkedIds,   setCheckedIds]   = useState<Set<string>>(new Set())
  const [showFilters,  setShowFilters]  = useState(false)
  const [actionModal,  setActionModal]  = useState<'qa' | 'location' | 'material' | null>(null)

  const { data: warehouses    = [] } = useWarehouses(true)
  const { data: qaStatuses    = [] } = useQAStatuses()
  const { data: subTypes      = [] } = useLocationSubTypes()

  // Auto-set warehouse from auth
  useEffect(() => {
    if (!f.warehouseId && user?.warehouse_id) {
      setInventory({ warehouseId: user.warehouse_id })
    }
  }, [user?.warehouse_id]) // eslint-disable-line

  const { data, isLoading } = useInventoryEntries({
    warehouse_id:    f.warehouseId      || undefined,
    sub_type:        f.warehouseType    || undefined,
    location_code:   f.locationCode     || undefined,
    material_search: f.materialSearch   || undefined,
    qa_status_ids:   f.qaStatusIds.length > 0 ? f.qaStatusIds : undefined,
    status:          f.status           || undefined,
    search:          f.search           || undefined,
    manufacturer_id: f.manufacturerId   || undefined,
    cycle:           f.cycle            || undefined,
    machine_code:    f.machineCode      || undefined,
    page:            f.page,
    limit:           LIMIT,
  })

  const entries           = data?.entries               ?? []
  const total             = data?.total                 ?? 0
  const totalCartons      = data?.total_cartons_remaining ?? 0
  const totalPages        = Math.max(1, Math.ceil(total / LIMIT))
  const checkedCount      = checkedIds.size
  const checkedIdArr      = useMemo(() => [...checkedIds], [checkedIds])

  // Client-side % date filter applied on current page
  const displayEntries = useMemo(() => {
    if (!f.datePctMin) return entries
    const minPct = parseInt(f.datePctMin)
    return entries.filter(e => {
      const pct = calcDatePct(e.production_date, e.material?.shelf_life_days ?? null)
      return pct !== null && pct >= minPct
    })
  }, [entries, f.datePctMin])

  // Keep selected entry in sync when list refreshes
  useEffect(() => {
    if (!selected) return
    const refreshed = entries.find(e => e.id === selected.id)
    if (refreshed) setSelected(refreshed)
  }, [entries]) // eslint-disable-line

  // Clear checked IDs that are no longer in the current page
  useEffect(() => {
    if (checkedIds.size === 0) return
    const pageIds = new Set(entries.map(e => e.id))
    const stale = [...checkedIds].filter(id => !pageIds.has(id))
    if (stale.length > 0) {
      setCheckedIds(prev => { const next = new Set(prev); stale.forEach(id => next.delete(id)); return next })
    }
  }, [entries]) // eslint-disable-line

  function resetFilters() {
    setInventory({
      search: '', materialSearch: '', locationCode: '', qaStatusIds: [], status: '',
      warehouseType: '', manufacturerId: '', cycle: '', machineCode: '', datePctMin: '', page: 1,
    })
  }

  function toggleCheck(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setCheckedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  function toggleAll() {
    if (checkedIds.size === displayEntries.length && displayEntries.length > 0) setCheckedIds(new Set())
    else setCheckedIds(new Set(displayEntries.map(e => e.id)))
  }

  const hasFilters = !!(f.search || f.materialSearch || f.locationCode || f.qaStatusIds.length > 0
    || f.status || f.warehouseType || f.manufacturerId || f.cycle || f.machineCode || f.datePctMin)

  const activeFilterCount = [
    !!f.locationCode, !!f.materialSearch, f.qaStatusIds.length > 0, !!f.status,
    !!f.warehouseType, !!f.cycle, !!f.machineCode, !!f.datePctMin,
  ].filter(Boolean).length

  function closeActionModal() {
    setActionModal(null)
    setCheckedIds(new Set())
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Filter header ── */}
      <div className="border-b bg-white px-4 py-2 shrink-0 space-y-1.5">
        {/* Row 1: Title + Kho + Search + Filter toggle */}
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold flex items-center gap-2 shrink-0">
            <Package className="h-5 w-5 text-slate-500" />
            Tồn kho
          </h1>

          {/* Kho */}
          <Select
            value={f.warehouseId || '__all__'}
            onValueChange={v => setInventory({ warehouseId: v === '__all__' ? '' : v, page: 1 })}
          >
            <SelectTrigger className="h-8 text-xs w-[130px] shrink-0">
              <SelectValue placeholder="Tất cả kho" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả kho</SelectItem>
              {(warehouses as any[]).map((w: any) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Pallet search */}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input className="pl-8 h-8 text-sm" placeholder="Tìm mã pallet…"
              value={f.search}
              onChange={e => setInventory({ search: e.target.value, page: 1 })} />
          </div>

          {/* Filter toggle */}
          <button
            className={`flex items-center gap-1 h-8 px-2.5 rounded-md border text-xs font-medium transition-colors shrink-0 ${
              showFilters || activeFilterCount > 0
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
            onClick={() => setShowFilters(v => !v)}
          >
            <Filter className="h-3.5 w-3.5" />
            Lọc
            {activeFilterCount > 0 && (
              <span className="bg-blue-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Collapsible filter panel */}
        {showFilters && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
            <div className="flex gap-2 flex-wrap items-center">
              {/* Tình trạng tồn kho */}
              <Select value={f.status || '__active__'}
                onValueChange={v => setInventory({ status: v === '__active__' ? '' : v, page: 1 })}>
                <SelectTrigger className="h-7 text-xs w-[120px] bg-white">
                  <SelectValue placeholder="Tình trạng" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__active__">Còn tồn</SelectItem>
                  <SelectItem value="ALL">Tất cả</SelectItem>
                  <SelectItem value="IN_STOCK">Còn hàng</SelectItem>
                  <SelectItem value="PARTIAL">Xuất 1 phần</SelectItem>
                  <SelectItem value="QUARANTINE">Cách ly</SelectItem>
                  <SelectItem value="EXPORTED">Đã xuất</SelectItem>
                  <SelectItem value="TRANSFERRED">Đã chuyển</SelectItem>
                </SelectContent>
              </Select>

              {/* Loại kho (Location.sub_type) */}
              <Select value={f.warehouseType || '__all__'}
                onValueChange={v => setInventory({ warehouseType: v === '__all__' ? '' : v, page: 1 })}>
                <SelectTrigger className="h-7 text-xs w-[120px] bg-white">
                  <SelectValue placeholder="Loại kho" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Tất cả loại</SelectItem>
                  {(subTypes as { sub_type: string; label: string }[]).map(t => (
                    <SelectItem key={t.sub_type} value={t.sub_type}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Tên hàng / Short name */}
              <Input className="h-7 text-xs w-[140px] bg-white" placeholder="Tên hàng / short…"
                value={f.materialSearch}
                onChange={e => setInventory({ materialSearch: e.target.value, page: 1 })} />

              {/* Vị trí */}
              <Input className="h-7 text-xs w-[100px] bg-white" placeholder="Vị trí…"
                value={f.locationCode}
                onChange={e => setInventory({ locationCode: e.target.value, page: 1 })} />

              {/* QA multi-select */}
              <QAFilterDropdown
                qaStatuses={qaStatuses as { id: string; code: string; name: string }[]}
                selected={f.qaStatusIds}
                onChange={ids => setInventory({ qaStatusIds: ids, page: 1 })}
              />

              {/* Chu kỳ */}
              <Input className="h-7 text-xs w-[75px] bg-white" placeholder="Chu kỳ…"
                value={f.cycle}
                onChange={e => setInventory({ cycle: e.target.value, page: 1 })} />

              {/* Máy */}
              <Input className="h-7 text-xs w-[75px] bg-white" placeholder="Máy…"
                value={f.machineCode}
                onChange={e => setInventory({ machineCode: e.target.value, page: 1 })} />

              {/* % Date */}
              <Select value={f.datePctMin || '__all__'}
                onValueChange={v => setInventory({ datePctMin: v === '__all__' ? '' : v })}>
                <SelectTrigger className="h-7 text-xs w-[90px] bg-white">
                  <SelectValue placeholder="% Date" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Tất cả</SelectItem>
                  {DATE_PCT_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {hasFilters && (
                <button onClick={resetFilters}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 whitespace-nowrap">
                  <X className="h-3.5 w-3.5" />Xóa lọc
                </button>
              )}
            </div>
          </div>
        )}

        {/* Totals bar */}
        <p className="text-xs text-slate-500">
          {isLoading ? 'Đang tải…' : (
            <>
              <span className="font-medium text-slate-700">{total.toLocaleString()}</span>
              <span className="text-slate-400"> pallet</span>
              {totalCartons > 0 && (
                <>
                  <span className="mx-1.5 text-slate-300">·</span>
                  <span className="font-medium text-slate-700">{totalCartons.toLocaleString()}</span>
                  <span className="text-slate-400"> thùng tồn</span>
                </>
              )}
              {totalPages > 1 && (
                <span className="ml-1.5 text-slate-400">— trang {f.page}/{totalPages}</span>
              )}
              {checkedCount > 0 && (
                <span className="ml-2 text-green-600 font-medium">· {checkedCount} đang chọn</span>
              )}
              {selected && checkedCount === 0 && (
                <span className="ml-2 text-blue-600">· 1 đang xem</span>
              )}
              {f.datePctMin && (
                <span className="ml-2 text-amber-600 text-[10px]">(% date: trang hiện tại)</span>
              )}
            </>
          )}
        </p>
      </div>

      {/* ── Content: table + detail drawer ── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Table */}
        <div className="flex-1 overflow-auto pb-20 lg:pb-4">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-9 rounded bg-slate-100 animate-pulse" />)}
            </div>
          ) : displayEntries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
              <Package className="h-10 w-10 opacity-30" />
              <p className="text-sm">Không tìm thấy pallet nào</p>
              {hasFilters && (
                <button onClick={resetFilters} className="text-xs text-blue-500 underline">Xóa bộ lọc</button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table className="min-w-full">
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      {/* Checkbox select-all */}
                      <TableHead className="px-2 py-1.5 w-7">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 cursor-pointer"
                          checked={checkedIds.size === displayEntries.length && displayEntries.length > 0}
                          onChange={toggleAll}
                        />
                      </TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Kho</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Loại kho</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Mã hàng</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Tên hàng</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Mã pallet</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Vị trí</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Nhập</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Xuất</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Tồn</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Date</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">%Date</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">QA</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Đ.chỉnh</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 w-5" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayEntries.map(e => (
                      <EntryRow
                        key={e.id}
                        entry={e}
                        isSelected={selected?.id === e.id}
                        isChecked={checkedIds.has(e.id)}
                        onCheck={ev => toggleCheck(e.id, ev)}
                        onClick={() => setSelected(prev => prev?.id === e.id ? null : e)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 py-3 border-t bg-white">
                  <button
                    disabled={f.page <= 1}
                    onClick={() => setInventory({ page: f.page - 1 })}
                    className="px-3 py-1 text-xs rounded border disabled:opacity-40 hover:bg-slate-50">
                    ← Trước
                  </button>
                  <span className="text-xs text-slate-500">{f.page} / {totalPages}</span>
                  <button
                    disabled={f.page >= totalPages}
                    onClick={() => setInventory({ page: f.page + 1 })}
                    className="px-3 py-1 text-xs rounded border disabled:opacity-40 hover:bg-slate-50">
                    Sau →
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Detail drawer */}
        {selected && (
          <DetailPanel
            entry={selected}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      {/* ── Floating action bar (when items checked) ── */}
      {checkedCount > 0 && (
        <div className="fixed bottom-16 lg:bottom-6 left-1/2 -translate-x-1/2 z-50
          bg-slate-800 text-white rounded-full shadow-2xl px-4 py-2
          flex items-center gap-3 text-sm whitespace-nowrap">
          <span className="text-slate-300 text-xs font-medium">{checkedCount} pallet</span>
          <div className="w-px h-4 bg-slate-600" />
          <button
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-700 hover:bg-slate-600 transition-colors"
            onClick={() => setActionModal('qa')}>
            QA Status
          </button>
          <button
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-700 hover:bg-slate-600 transition-colors"
            onClick={() => setActionModal('location')}>
            Vị trí
          </button>
          <button
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-700 hover:bg-slate-600 transition-colors"
            onClick={() => setActionModal('material')}>
            Mã hàng
          </button>
          <div className="w-px h-4 bg-slate-600" />
          <button
            className="text-slate-400 hover:text-white transition-colors"
            onClick={() => setCheckedIds(new Set())}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Action modals ── */}
      <QAModal
        open={actionModal === 'qa'}
        ids={checkedIdArr}
        qaStatuses={qaStatuses as { id: string; code: string; name: string }[]}
        onClose={closeActionModal}
      />
      <LocationModal
        open={actionModal === 'location'}
        ids={checkedIdArr}
        warehouseId={f.warehouseId || user?.warehouse_id || undefined}
        onClose={closeActionModal}
      />
      <MaterialModal
        open={actionModal === 'material'}
        ids={checkedIdArr}
        onClose={closeActionModal}
      />
    </div>
  )
}

// ─── EntryRow ─────────────────────────────────────────────────

function EntryRow({ entry: e, isSelected, isChecked, onCheck, onClick }: {
  entry: InventoryEntry
  isSelected: boolean
  isChecked: boolean
  onCheck: (ev: React.MouseEvent) => void
  onClick: () => void
}) {
  const loc           = formatLoc(e.location)
  const matCode       = e.material?.material_code ?? '—'
  const matName       = e.material?.short_name ?? '—'
  const qa            = e.qa_status?.code ?? '—'
  const remaining     = e.cartons_remaining ?? e.cartons_imported
  const exported      = Math.max(0, Number(e.cartons_imported) - Number(remaining))
  const pct           = calcDatePct(e.production_date, e.material?.shelf_life_days ?? null)
  const prodDateStr   = e.production_date ? formatTimestampDate(e.production_date, true) : '—'
  const adjQty        = e.adjustment_qty ?? 0
  const warehouseNm   = e.location?.warehouse?.name ?? '—'
  const loaiKho       = e.location?.sub_name ?? e.location?.sub_type ?? '—'

  return (
    <TableRow
      className={`transition-colors cursor-pointer ${entryRowBg(e, isSelected, isChecked)}`}
      onClick={onClick}
    >
      {/* Checkbox */}
      <TableCell className="px-2 py-1" onClick={onCheck}>
        <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer"
          checked={isChecked} onChange={() => {}} />
      </TableCell>
      {/* Kho */}
      <TableCell className="px-2 py-1 whitespace-nowrap max-w-[90px]">
        <span className="text-[10px] text-slate-600 truncate block" title={warehouseNm}>{warehouseNm}</span>
      </TableCell>
      {/* Loại kho */}
      <TableCell className="px-2 py-1 whitespace-nowrap max-w-[80px]">
        <span className="text-[10px] text-slate-500 truncate block" title={loaiKho}>{loaiKho}</span>
      </TableCell>
      {/* Mã hàng */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono font-semibold text-slate-700">{matCode}</span>
      </TableCell>
      {/* Tên hàng */}
      <TableCell className="px-2 py-1 max-w-[110px]">
        <span className="text-[10px] text-slate-700 truncate block" title={matName}>{matName}</span>
      </TableCell>
      {/* Mã pallet */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono font-semibold">{e.pallet_code}</span>
      </TableCell>
      {/* Vị trí */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono text-slate-700">{loc}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-500">{e.cartons_imported}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-500">{exported > 0 ? exported : '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{remaining}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-600">{prodDateStr}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {pct !== null ? (
          <span className={`text-[10px] tabular-nums ${datePctCls(pct)}`}>{pct}%</span>
        ) : (
          <span className="text-[10px] text-slate-300">—</span>
        )}
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${STATUS_CLS[e.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {qa}
        </span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {adjQty !== 0 ? (
          <span className={`text-[10px] tabular-nums font-semibold ${adjQty > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {adjQty > 0 ? '+' : ''}{adjQty}
          </span>
        ) : (
          <span className="text-[10px] text-slate-300">—</span>
        )}
      </TableCell>
      <TableCell className="px-1 py-1">
        <ChevronRight className={`h-3 w-3 text-slate-300 transition-transform ${isSelected ? 'rotate-90 text-blue-500' : ''}`} />
      </TableCell>
    </TableRow>
  )
}

// ─── Detail panel ─────────────────────────────────────────────

function DetailPanel({ entry: e, onClose }: { entry: InventoryEntry; onClose: () => void }) {
  const [adjInput, setAdjInput]       = useState('')
  const [showAdj, setShowAdj]         = useState(false)
  const [adjError, setAdjError]       = useState('')
  const { mutate: adjust, isPending } = useAdjustInventory()

  const loc       = formatLoc(e.location)
  const remaining = e.cartons_remaining ?? e.cartons_imported
  const exported  = Math.max(0, Number(e.cartons_imported) - Number(remaining))
  const pct       = calcDatePct(e.production_date, e.material?.shelf_life_days ?? null)

  function handleAdjust() {
    const val = parseFloat(adjInput)
    if (isNaN(val) || val === 0) { setAdjError('Nhập số khác 0'); return }
    setAdjError('')
    adjust(
      { id: e.id, adjustment: val },
      {
        onSuccess: () => { setAdjInput(''); setShowAdj(false) },
        onError: (err: any) => {
          setAdjError(err?.response?.data?.error?.message ?? 'Lỗi không xác định')
        },
      }
    )
  }

  const warehouseNm = e.location?.warehouse?.name ?? '—'
  const loaiKho     = e.location?.sub_name ?? e.location?.sub_type ?? '—'

  return (
    <div className="w-72 shrink-0 border-l bg-white overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
        <p className="text-xs font-semibold text-slate-700 font-mono truncate">{e.pallet_code}</p>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 ml-2">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-3 space-y-3 text-xs flex-1">
        {/* Status badge */}
        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_CLS[e.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {STATUS_LABEL[e.status] ?? e.status}
        </span>

        {/* Core info */}
        <Section title="Thông tin hàng">
          <Row label="Kho"      value={warehouseNm} />
          <Row label="Loại kho" value={loaiKho} />
          <Row label="Mã hàng"  value={e.material?.material_code ?? '—'} mono />
          <Row label="Tên hàng" value={e.material?.short_name ?? '—'} />
          <Row label="Vị trí"   value={loc} mono />
          <Row label="QA"       value={e.qa_status ? `${e.qa_status.code} – ${e.qa_status.name}` : '—'} />
        </Section>

        {/* Quantities */}
        <Section title="Số lượng">
          <Row label="Nhập"       value={`${e.cartons_imported} thùng`} />
          <Row label="Xuất"       value={exported > 0 ? `${exported} thùng` : '—'} />
          <Row label="Tồn"        value={`${remaining} thùng`} bold />
          <Row label="Điều chỉnh" value={e.adjustment_qty ? `${Number(e.adjustment_qty) > 0 ? '+' : ''}${e.adjustment_qty}` : '—'}
            cls={e.adjustment_qty ? (Number(e.adjustment_qty) > 0 ? 'text-green-600' : 'text-red-600') : ''} />
        </Section>

        {/* Date info */}
        <Section title="Ngày / Hạn dùng">
          <Row label="Ngày SX"
            value={e.production_date ? formatTimestampDate(e.production_date, false) : '—'} />
          <Row label="HSD (ngày)"
            value={e.material?.shelf_life_days ? `${e.material.shelf_life_days} ngày` : '—'} />
          {pct !== null && (
            <Row label="% Date còn" value={`${pct}%`} cls={datePctCls(pct)} bold />
          )}
        </Section>

        {/* Production */}
        <Section title="Sản xuất">
          <Row label="NMSX"    value={e.manufacturer?.name ?? e.manufacturer?.code ?? '—'} />
          <Row label="Chu kỳ" value={e.cycle ?? '—'} mono />
          <Row label="Máy"    value={e.machine_code ?? '—'} mono />
        </Section>

        {/* Import */}
        <Section title="Nhập kho">
          <Row label="Ngày nhập"  value={e.import_date ? formatTimestampDate(e.import_date) : '—'} />
          <Row label="Giờ nhập"   value={e.created_at ? formatTimestampTime(e.created_at) : '—'} />
          <Row label="Người nhập" value={e.created_by_emp?.name ?? '—'} />
        </Section>

        {/* Update */}
        <Section title="Cập nhật">
          <Row label="Ngày sửa"  value={e.update_date ? formatTimestampDate(e.update_date) : '—'} />
          <Row label="Giờ sửa"   value={e.updated_at ? formatTimestampTime(e.updated_at) : '—'} />
          <Row label="Người sửa" value={e.updated_by_emp?.name ?? '—'} />
        </Section>

        {/* Stocktaking */}
        <Section title="Kiểm kê">
          <Row label="Người KK"  value={e.stocktake_by_emp?.name ?? '—'} />
          <Row label="Ngày KK"   value={e.stocktake_at ? formatTimestampDate(e.stocktake_at) : '—'} />
          <Row label="Giờ KK"    value={e.stocktake_at ? formatTimestampTime(e.stocktake_at) : '—'} />
        </Section>

        {/* Adjust block */}
        <div className="border-t pt-3">
          {!showAdj ? (
            <Button size="sm" variant="outline" className="w-full gap-1.5"
              onClick={() => setShowAdj(true)}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Điều chỉnh tồn kho
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] text-slate-500">
                Tồn hiện tại: <strong>{remaining}</strong> thùng. Nhập số điều chỉnh (+ hoặc −).
              </p>
              <Input
                type="number"
                placeholder="Vd: -2 hoặc +5"
                value={adjInput}
                onChange={e => { setAdjInput(e.target.value); setAdjError('') }}
                className="h-8 text-sm text-center"
              />
              {adjInput && !isNaN(parseFloat(adjInput)) && (
                <p className="text-[10px] text-slate-500 text-center">
                  Tồn mới: <strong>{Number(remaining) + parseFloat(adjInput)}</strong> thùng
                </p>
              )}
              {adjError && <p className="text-[10px] text-red-500">{adjError}</p>}
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={handleAdjust} disabled={isPending || !adjInput}>
                  {isPending ? '…' : 'Xác nhận'}
                </Button>
                <Button size="sm" variant="outline"
                  onClick={() => { setShowAdj(false); setAdjInput(''); setAdjError('') }}>
                  Hủy
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Small helpers ────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function Row({ label, value, mono, bold, cls }: {
  label: string; value: string; mono?: boolean; bold?: boolean; cls?: string
}) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className={`text-right truncate ${mono ? 'font-mono' : ''} ${bold ? 'font-semibold' : ''} ${cls ?? 'text-slate-700'}`}>
        {value}
      </span>
    </div>
  )
}
