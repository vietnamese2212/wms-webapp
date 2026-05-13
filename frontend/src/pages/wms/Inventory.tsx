import { useEffect, useMemo, useState } from 'react'
import { Package, Search, X, SlidersHorizontal, ChevronRight, Filter, Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Label } from '@/components/ui/label'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import {
  useInventoryEntries, useInventoryFacets, useWarehouses, useQAStatuses, useAdjustInventory,
  useLocationsReal, useMaterials, useMaterialCategories,
  useBulkUpdateInventoryQA, useBulkTransferLocation, useBulkTransferMaterial,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import type { InventoryEntry } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────

function formatLoc(loc: { location_code: string } | null): string {
  if (!loc) return '—'
  return loc.location_code
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
  { value: '80',   label: '> 80%'  },
  { value: '60',   label: '60–80%' },
  { value: '30',   label: '30–60%' },
  { value: 'le30', label: '≤ 30%'  },
]


// ─── Action modals ────────────────────────────────────────────

function QAPanel({ ids, qaStatuses, onClose }: {
  ids: string[]
  qaStatuses: { id: string; code: string; name: string }[]
  onClose: () => void
}) {
  const user = useAuthStore(s => s.user)
  const [qaId, setQaId]     = useState('')
  const [error, setError]   = useState('')
  const { mutate, isPending } = useBulkUpdateInventoryQA()

  const nonOk  = qaStatuses.filter(q => q.code.toUpperCase() !== 'OK')
  const hasOk  = qaStatuses.some(q => q.code.toUpperCase() === 'OK')
  const qaOptions: { id: string; label: string }[] = [
    ...nonOk.map(q => ({ id: q.id, label: `${q.code} – ${q.name}` })),
    ...(hasOk ? [{ id: '__ok__', label: 'OK' }] : []),
  ]

  function handleSubmit() {
    setError('')
    mutate(
      { ids, qa_status_id: qaId === '__ok__' ? null : qaId, employee_id: user?.id },
      {
        onSuccess: () => { setQaId(''); onClose() },
        onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Lỗi không xác định'),
      }
    )
  }

  return (
    <div className="w-72 shrink-0 border-l bg-white overflow-y-auto flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
        <p className="text-xs font-semibold text-slate-700">Cập nhật QA Status</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">{ids.length} pallet</span>
          <button onClick={() => { setQaId(''); setError(''); onClose() }} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="p-3 space-y-3 text-xs flex-1">
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">QA Status mới</Label>
          <div className="border rounded-md overflow-hidden">
            {qaOptions.map(opt => (
              <label key={opt.id}
                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer border-b last:border-b-0 transition-colors ${
                  qaId === opt.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
                onClick={() => setQaId(prev => prev === opt.id ? '' : opt.id)}
              >
                <div className={`w-3.5 h-3.5 border rounded shrink-0 flex items-center justify-center transition-colors ${
                  qaId === opt.id ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'
                }`}>
                  {qaId === opt.id && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                </div>
                <span className={`text-xs ${opt.id === '__ok__' ? 'text-green-700 font-medium' : 'text-slate-700'}`}>
                  {opt.label}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={() => { setQaId(''); setError(''); onClose() }}>Huỷ</Button>
          <Button className="flex-1" disabled={!qaId || isPending} onClick={handleSubmit}>
            {isPending ? '…' : 'Cập nhật'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function LocationPanel({ ids, warehouseId, category, onClose }: {
  ids: string[]; warehouseId?: string; category?: string; onClose: () => void
}) {
  const user = useAuthStore(s => s.user)
  const [search, setSearch]   = useState('')
  const [locId, setLocId]     = useState('')
  const [error, setError]     = useState('')
  const { mutate, isPending }  = useBulkTransferLocation()
  const { data: allLocs = [] } = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId, category: category || undefined } : undefined
  )

  const filtered = useMemo(() => {
    const s = search.toLowerCase()
    return (allLocs as any[]).filter((l: any) =>
      !s || l.location_code?.toLowerCase().includes(s) || l.sub_code?.toLowerCase().includes(s)
    )
  }, [allLocs, search])

  const selectedLoc = useMemo(() =>
    (allLocs as any[]).find((l: any) => l.id === locId), [allLocs, locId]
  )

  function reset() { setLocId(''); setSearch(''); setError('') }

  function handleSubmit() {
    if (!locId) { setError('Chọn vị trí trước'); return }
    setError('')
    mutate(
      { ids, location_id: locId, employee_id: user?.id },
      {
        onSuccess: () => { reset(); onClose() },
        onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Lỗi không xác định'),
      }
    )
  }

  return (
    <div className="w-72 shrink-0 border-l bg-white overflow-y-auto flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
        <p className="text-xs font-semibold text-slate-700">Chuyển vị trí</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">{ids.length} pallet</span>
          <button onClick={() => { reset(); onClose() }} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="p-3 space-y-3 text-xs flex-1">
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">Vị trí mới</Label>
          <Input placeholder="Tìm vị trí…" value={search} autoFocus
            onChange={e => setSearch(e.target.value)} className="h-8 text-sm" />
          <div className="border rounded max-h-[calc(100vh-280px)] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400 text-center">Không tìm thấy</div>
            ) : (
              filtered.map((l: any) => {
                const isFull = l.max_pallets > 0 && (l.used_slots ?? 0) >= l.max_pallets
                const isSelected = locId === l.id
                return (
                  <label key={l.id}
                    className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer border-b last:border-b-0 transition-colors ${
                      isSelected ? 'bg-blue-50' : isFull ? 'opacity-50 bg-slate-50 cursor-not-allowed' : 'hover:bg-slate-50'
                    }`}
                    onClick={() => { if (!isFull) setLocId(prev => prev === l.id ? '' : l.id) }}
                  >
                    <div className={`w-3.5 h-3.5 border rounded shrink-0 flex items-center justify-center transition-colors ${
                      isSelected ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'
                    }`}>
                      {isSelected && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                    </div>
                    <span className="text-xs font-mono font-semibold">{formatLoc(l)}</span>
                    <span className={`ml-auto text-[10px] ${isFull ? 'text-red-400 font-medium' : 'text-slate-400'}`}>
                      {l.used_slots ?? 0}/{l.max_pallets}{isFull ? ' (đầy)' : ''}
                    </span>
                  </label>
                )
              })
            )}
          </div>
          {selectedLoc && (
            <p className="text-[10px] text-blue-600">
              Đã chọn: <strong className="font-mono">{formatLoc(selectedLoc)}</strong>
              <button className="ml-2 text-slate-400 hover:text-red-500" onClick={reset}>✕ bỏ chọn</button>
            </p>
          )}
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={() => { reset(); onClose() }}>Huỷ</Button>
          <Button className="flex-1" disabled={!locId || isPending} onClick={handleSubmit}>
            {isPending ? '…' : 'Chuyển'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function MaterialPanel({ ids, category, onClose }: {
  ids: string[]; category?: string; onClose: () => void
}) {
  const user = useAuthStore(s => s.user)
  const [search, setSearch]     = useState('')
  const [matId, setMatId]       = useState('')
  const [error, setError]       = useState('')
  const [confirming, setConfirming] = useState(false)
  const { mutate, isPending }   = useBulkTransferMaterial()
  const { data: materials = [] } = useMaterials({ search: search || undefined, category: category || undefined })

  const selectedMat = useMemo(() =>
    (materials as any[]).find((m: any) => m.id === matId), [materials, matId]
  )

  function reset() { setMatId(''); setSearch(''); setError(''); setConfirming(false) }

  function handleSubmit() {
    setError('')
    mutate(
      { ids, material_id: matId, employee_id: user?.id },
      {
        onSuccess: () => { reset(); onClose() },
        onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Lỗi không xác định'),
      }
    )
  }

  return (
    <div className="w-72 shrink-0 border-l bg-white overflow-y-auto flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
        <p className="text-xs font-semibold text-slate-700">Chuyển mã hàng</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">{ids.length} pallet</span>
          <button onClick={() => { reset(); onClose() }} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="p-3 space-y-3 text-xs flex-1">
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
        )}

        {confirming ? (
          /* ── Confirm step ── */
          <div className="space-y-3">
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-800">Xác nhận chuyển mã?</p>
              <div className="text-[10px] text-amber-700 space-y-0.5">
                <p><span className="text-slate-500">Số pallet:</span> <strong>{ids.length}</strong></p>
                <p><span className="text-slate-500">Mã mới:</span> <strong className="font-mono">{selectedMat?.material_code}</strong></p>
                {selectedMat?.short_name && (
                  <p><span className="text-slate-500">Tên:</span> {selectedMat.short_name}</p>
                )}
              </div>
              <p className="text-[10px] text-amber-600">Thao tác này sẽ đổi mã hàng của tất cả pallet đã chọn.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>Quay lại</Button>
              <Button className="flex-1 bg-amber-600 hover:bg-amber-700" disabled={isPending} onClick={handleSubmit}>
                {isPending ? '…' : 'Xác nhận chuyển'}
              </Button>
            </div>
          </div>
        ) : (
          /* ── Select step ── */
          <div className="space-y-1.5">
            <Label className="text-xs">Hàng hóa mới</Label>
            {category && (
              <p className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 rounded px-2 py-1">
                Chỉ hiện mã cùng loại: <strong>{category}</strong>
              </p>
            )}
            <Input placeholder="Tìm mã hoặc tên hàng…" value={search} autoFocus
              onChange={e => { setSearch(e.target.value); setMatId('') }} className="h-8 text-sm" />
            {(search || category) && (
              <div className="border rounded max-h-[calc(100vh-320px)] overflow-y-auto">
                {(materials as any[]).length === 0 ? (
                  <div className="px-3 py-2 text-xs text-slate-400 text-center">Không tìm thấy</div>
                ) : (
                  (materials as any[]).map((m: any) => {
                    const isSelected = matId === m.id
                    return (
                      <label key={m.id}
                        className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer border-b last:border-b-0 transition-colors ${
                          isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                        }`}
                        onClick={() => setMatId(prev => prev === m.id ? '' : m.id)}
                      >
                        <div className={`w-3.5 h-3.5 border rounded shrink-0 flex items-center justify-center transition-colors ${
                          isSelected ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'
                        }`}>
                          {isSelected && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                        </div>
                        <span className="text-[10px] font-mono text-slate-500 shrink-0">{m.material_code}</span>
                        <span className="text-xs text-slate-700 truncate">{m.short_name ?? m.material_description}</span>
                      </label>
                    )
                  })
                )}
              </div>
            )}
            {selectedMat && (
              <p className="text-[10px] text-blue-600">
                Đã chọn: <strong className="font-mono">{selectedMat.material_code}</strong> – {selectedMat.short_name ?? ''}
                <button className="ml-2 text-slate-400 hover:text-red-500" onClick={reset}>✕ bỏ chọn</button>
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => { reset(); onClose() }}>Huỷ</Button>
              <Button className="flex-1" disabled={!matId} onClick={() => setConfirming(true)}>
                Chuyển
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
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

  const { data: warehouses   = [] } = useWarehouses(true)
  const { data: qaStatuses   = [] } = useQAStatuses()
  const { data: categories   = [] } = useMaterialCategories()
  const { data: facets } = useInventoryFacets({
    warehouse_ids: f.warehouseIds.length > 0 ? f.warehouseIds : undefined,
    categories:    f.materialCategories.length > 0 ? f.materialCategories : undefined,
  })

  // Auto-set warehouse from auth
  useEffect(() => {
    if (f.warehouseIds.length === 0 && user?.warehouse_id) {
      setInventory({ warehouseIds: [user.warehouse_id] })
    }
  }, [user?.warehouse_id]) // eslint-disable-line

  const { data, isLoading } = useInventoryEntries({
    warehouse_ids:      f.warehouseIds.length > 0 ? f.warehouseIds : undefined,
    categories:         f.materialCategories.length > 0 ? f.materialCategories : undefined,
    filter_locations:   f.filterLocations.length > 0 ? f.filterLocations : undefined,
    filter_material_ids:f.filterMaterialIds.length > 0 ? f.filterMaterialIds : undefined,
    qa_status_ids:      f.qaStatusIds.length > 0 ? f.qaStatusIds : undefined,
    status:             f.status     || undefined,
    search:             f.search     || undefined,
    manufacturer_id:    f.manufacturerId || undefined,
    filter_cycles:      f.filterCycles.length > 0 ? f.filterCycles : undefined,
    filter_machines:    f.filterMachines.length > 0 ? f.filterMachines : undefined,
    date_pct_ranges:    f.datePctRanges.length > 0 ? f.datePctRanges : undefined,
    page:               f.page,
    limit:              LIMIT,
  })

  const displayEntries    = data?.entries               ?? []
  const total             = data?.total                 ?? 0
  const totalCartons      = data?.total_cartons_remaining ?? 0
  const totalPages        = Math.max(1, Math.ceil(total / LIMIT))
  const checkedCount      = checkedIds.size
  const checkedIdArr      = useMemo(() => [...checkedIds], [checkedIds])

  // Derive pallet context for action modals (from first checked entry on current page)
  const firstCheckedEntry = useMemo(() =>
    displayEntries.find(e => checkedIds.has(e.id)), [displayEntries, checkedIds]
  )
  const actionWarehouseId = firstCheckedEntry?.location?.warehouse?.id
  const actionCategory    = firstCheckedEntry?.material?.category ?? undefined

  // Keep selected entry in sync when list refreshes
  useEffect(() => {
    if (!selected) return
    const refreshed = displayEntries.find(e => e.id === selected.id)
    if (refreshed) setSelected(refreshed)
  }, [displayEntries]) // eslint-disable-line

  // Clear checked IDs that are no longer in the current page
  useEffect(() => {
    if (checkedIds.size === 0) return
    const pageIds = new Set(displayEntries.map(e => e.id))
    const stale = [...checkedIds].filter(id => !pageIds.has(id))
    if (stale.length > 0) {
      setCheckedIds(prev => { const next = new Set(prev); stale.forEach(id => next.delete(id)); return next })
    }
  }, [displayEntries]) // eslint-disable-line

  function resetFilters() {
    setInventory({
      search: '', filterLocations: [], filterMaterialIds: [], qaStatusIds: [], status: '',
      materialCategories: [], manufacturerId: '', filterCycles: [], filterMachines: [], datePctRanges: [], page: 1,
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

  const hasFilters = !!(f.search || f.filterLocations.length > 0 || f.filterMaterialIds.length > 0
    || f.qaStatusIds.length > 0 || f.status || f.materialCategories.length > 0
    || f.manufacturerId || f.filterCycles.length > 0 || f.filterMachines.length > 0 || f.datePctRanges.length > 0)

  const activeFilterCount = [
    f.filterLocations.length > 0, f.filterMaterialIds.length > 0, f.qaStatusIds.length > 0,
    !!f.status, f.filterCycles.length > 0, f.filterMachines.length > 0, f.datePctRanges.length > 0,
  ].filter(Boolean).length

  // MultiSelectFilter option lists
  const warehouseOpts  = (warehouses as any[]).map((w: any) => ({ value: w.id, label: w.name }))
  const categoryOpts   = (categories as string[]).map(c => ({ value: c, label: c }))
  const qaOpts         = (qaStatuses as any[]).map((q: any) => ({ value: q.id, label: `${q.code} – ${q.name}` }))
  const locationOpts   = (facets?.locations ?? []).map(l => ({ value: l.code, label: l.code }))
  const materialOpts   = (facets?.materials ?? []).map(m => ({ value: m.id, label: m.name ? `${m.code} – ${m.name}` : m.code }))
  const cycleOpts      = (facets?.cycles ?? []).map(c => ({ value: c, label: c }))
  const machineOpts    = (facets?.machines ?? []).map(m => ({ value: m, label: m }))
  const datePctOpts    = DATE_PCT_OPTIONS

  function closeActionModal() {
    setActionModal(null)
    setCheckedIds(new Set())
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Filter header ── */}
      <div className="border-b bg-white px-4 py-2 shrink-0 space-y-1.5">
        {/* Row 1: Title + Kho + Loại kho + Search + Filter toggle */}
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold flex items-center gap-2 shrink-0">
            <Package className="h-5 w-5 text-slate-500" />
            Tồn kho
          </h1>

          {/* Kho */}
          <MultiSelectFilter
            label="Kho"
            options={warehouseOpts}
            selected={f.warehouseIds}
            onChange={v => setInventory({ warehouseIds: v, page: 1 })}
            searchable={warehouseOpts.length > 5}
            width="min-w-[100px]"
          />

          {/* Loại kho */}
          <MultiSelectFilter
            label="Loại kho"
            options={categoryOpts}
            selected={f.materialCategories}
            onChange={v => setInventory({ materialCategories: v, page: 1 })}
            searchable={false}
            width="min-w-[90px]"
          />

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
              {/* Tình trạng tồn kho — 2 option */}
              <Select value={f.status || '__active__'}
                onValueChange={v => setInventory({ status: v === '__active__' ? '' : v, page: 1 })}>
                <SelectTrigger className="h-7 text-xs w-[110px] bg-white">
                  <SelectValue placeholder="Còn tồn" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__active__">Còn tồn</SelectItem>
                  <SelectItem value="ALL">Tất cả</SelectItem>
                </SelectContent>
              </Select>

              {/* Tên hàng — multi-select từ facets */}
              <MultiSelectFilter
                label="Tên hàng"
                options={materialOpts}
                selected={f.filterMaterialIds}
                onChange={v => setInventory({ filterMaterialIds: v, page: 1 })}
                width="min-w-[120px]"
              />

              {/* Vị trí — multi-select từ facets */}
              <MultiSelectFilter
                label="Vị trí"
                options={locationOpts}
                selected={f.filterLocations}
                onChange={v => setInventory({ filterLocations: v, page: 1 })}
                width="min-w-[90px]"
              />

              {/* QA Status — multi-select */}
              <MultiSelectFilter
                label="QA Status"
                options={qaOpts}
                selected={f.qaStatusIds}
                onChange={v => setInventory({ qaStatusIds: v, page: 1 })}
                width="min-w-[100px]"
              />

              {/* Chu kỳ — multi-select từ facets */}
              <MultiSelectFilter
                label="Chu kỳ"
                options={cycleOpts}
                selected={f.filterCycles}
                onChange={v => setInventory({ filterCycles: v, page: 1 })}
                searchable={cycleOpts.length > 5}
                width="min-w-[80px]"
              />

              {/* Máy — multi-select từ facets */}
              <MultiSelectFilter
                label="Máy"
                options={machineOpts}
                selected={f.filterMachines}
                onChange={v => setInventory({ filterMachines: v, page: 1 })}
                searchable={machineOpts.length > 5}
                width="min-w-[70px]"
              />

              {/* % Date — multi-select, OR logic */}
              <MultiSelectFilter
                label="% Date"
                options={datePctOpts}
                selected={f.datePctRanges}
                onChange={v => setInventory({ datePctRanges: v, page: 1 })}
                searchable={false}
                width="min-w-[80px]"
              />

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
              <Table className="min-w-[900px]">
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

        {/* Detail / Action side panel */}
        {actionModal === 'qa' ? (
          <QAPanel ids={checkedIdArr} qaStatuses={qaStatuses as { id: string; code: string; name: string }[]} onClose={closeActionModal} />
        ) : actionModal === 'location' ? (
          <LocationPanel ids={checkedIdArr} warehouseId={actionWarehouseId} category={actionCategory} onClose={closeActionModal} />
        ) : actionModal === 'material' ? (
          <MaterialPanel ids={checkedIdArr} category={actionCategory} onClose={closeActionModal} />
        ) : selected ? (
          <DetailPanel entry={selected} onClose={() => setSelected(null)} />
        ) : null}
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
  const loaiKho       = e.material?.category ?? '—'

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
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] text-slate-700">{matName}</span>
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
  const user = useAuthStore(s => s.user)
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
      { id: e.id, adjustment: val, employee_id: user?.id },
      {
        onSuccess: () => { setAdjInput(''); setShowAdj(false) },
        onError: (err: any) => {
          setAdjError(err?.response?.data?.error?.message ?? 'Lỗi không xác định')
        },
      }
    )
  }

  const warehouseNm = e.location?.warehouse?.name ?? '—'
  const loaiKho     = e.material?.category ?? '—'

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
          <Row label="Tên hàng" value={e.material?.short_name ?? '—'} wrap />
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
          <Row label="NMSX"    value={e.manufacturer?.code ?? '—'} mono />
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

function Row({ label, value, mono, bold, cls, wrap }: {
  label: string; value: string; mono?: boolean; bold?: boolean; cls?: string; wrap?: boolean
}) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className={`text-right ${wrap ? 'break-words min-w-0' : 'truncate'} ${mono ? 'font-mono' : ''} ${bold ? 'font-semibold' : ''} ${cls ?? 'text-slate-700'}`}>
        {value}
      </span>
    </div>
  )
}
