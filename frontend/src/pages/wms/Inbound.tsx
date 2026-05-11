import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, PackagePlus, CalendarDays, X, ChevronDown, User, MapPin } from 'lucide-react'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { useAuthStore }        from '@/stores/authStore'
import { useWmsFilterStore }  from '@/stores/wmsFilterStore'
import { TableSkeleton }       from '@/components/shared/TableSkeleton'
import { EmptyState }          from '@/components/shared/EmptyState'
import { Button }              from '@/components/ui/button'
import { Input }               from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label }               from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useInboundOrders, useCreateInboundOrder,
  useWarehouses, useMaterials, useLocationsReal, useImportShifts,
  useEmployeeRecords,
} from '@/api/hooks'
import type { InboundOrder } from '@/types'

const TODAY = new Date().toISOString().slice(0, 10)

interface LocationWithCapacity {
  id: string
  location_code: string
  sub_code: string
  sub_type: string | null
  max_pallets: number
  used_slots: number
}

// Bảng cấu hình Loại kho: sub_type (Location) ↔ label ↔ Material.category
// Thêm entry mới ở đây khi có loại kho mới
const LOAI_KHO_CONFIG = [
  { sub_type: 'THANH_PHAM',    label: 'Thành phẩm', mat_category: 'TP'   },
  { sub_type: 'NGUYEN_LIEU',   label: 'NVL',         mat_category: 'NVL'  },
  { sub_type: 'POSM',          label: 'POSM',         mat_category: 'POSM' },
] as const

function subTypeLabel(st: string) {
  return LOAI_KHO_CONFIG.find(c => c.sub_type === st)?.label ?? st
}

// ─── Create order dialog ─────────────────────────────────────

type MatItem = { id: string; material_code: string; short_name: string | null; material_description: string }

function CreateOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate  = useNavigate()
  const user      = useAuthStore((s) => s.user)
  const isOWN     = user?.role === 'OWN'

  const [warehouseId, setWarehouseId] = useState('')
  const [subType,     setSubType]     = useState('')
  const [materialId,  setMaterialId]  = useState('')
  const [locationId,  setLocationId]  = useState('')
  const [shiftId,     setShiftId]     = useState('')
  const [importDate,  setImportDate]  = useState(format(new Date(), 'yyyy-MM-dd'))
  const [notes,       setNotes]       = useState('')

  // Material combobox state
  const [matSearch, setMatSearch] = useState('')
  const [matOpen,   setMatOpen]   = useState(false)
  const matRef = useRef<HTMLDivElement>(null)

  // Reset all fields each time the dialog opens
  useEffect(() => {
    if (open) {
      setWarehouseId(user?.warehouse_id ?? '')
      setSubType('')
      setMaterialId('')
      setMatSearch('')
      setMatOpen(false)
      setLocationId('')
      setShiftId('')
      setImportDate(format(new Date(), 'yyyy-MM-dd'))
      setNotes('')
    }
  }, [open, user?.warehouse_id])

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: shifts     = [] } = useImportShifts()
  const { data: locations  = [] } = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId } : undefined
  )

  const allLocs     = locations as LocationWithCapacity[]
  // Chỉ hiện loại kho nào thực sự có vị trí trong kho đã chọn
  const availSubTypes = new Set(allLocs.map(l => l.sub_type).filter(Boolean))
  const loaiKhoOpts   = LOAI_KHO_CONFIG.filter(c => availSubTypes.has(c.sub_type))
  const filteredLocs  = subType ? allLocs.filter(l => l.sub_type === subType) : allLocs

  const matCategory = LOAI_KHO_CONFIG.find(c => c.sub_type === subType)?.mat_category
  const { data: materials = [] } = useMaterials({ search: matSearch || undefined, category: matCategory })

  // Người nhập: tự động khớp theo tên user đang đăng nhập
  const { data: allEmployees = [] } = useEmployeeRecords({ is_active: 'true' })
  type EmpItem = { id: string; name: string; employee_code: string }
  const importedByEmpId = useMemo(
    () => (allEmployees as EmpItem[]).find(e => e.name.toLowerCase() === (user?.name ?? '').toLowerCase())?.id ?? '',
    [allEmployees, user?.name]
  )

  // Auto-select warehouse by name when warehouse_id not set (mock auth scenario)
  useEffect(() => {
    if (!open || warehouseId || !user?.warehouse_name || !warehouses.length) return
    const match = (warehouses as { id: string; name: string }[]).find(w => w.name === user.warehouse_name)
    if (match) setWarehouseId(match.id)
  }, [open, warehouses, user?.warehouse_name, warehouseId])

  // Close comboboxes on click outside
  useEffect(() => {
    if (!matOpen) return
    const handler = (e: MouseEvent) => {
      if (matRef.current && !matRef.current.contains(e.target as Node)) setMatOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [matOpen])

  const { mutate: createOrder, isPending, error } = useCreateInboundOrder()

  const selectedMat = (materials as MatItem[]).find(m => m.id === materialId)
  const matInputValue = matOpen
    ? matSearch
    : (selectedMat ? `${selectedMat.material_code} – ${selectedMat.short_name ?? selectedMat.material_description}` : matSearch)

  function handleSubmit() {
    if (!warehouseId || !subType || !materialId || !locationId) return
    createOrder(
      {
        warehouse_id: warehouseId,
        material_id:  materialId,
        location_id:  locationId,
        shift_id:     shiftId          || undefined,
        import_date:  importDate,
        notes:        notes            || undefined,
        imported_by:  importedByEmpId  || undefined,
      },
      {
        onSuccess: (data) => {
          onClose()
          navigate(`/wms/inbound/${data.order.id}`)
        },
      }
    )
  }

  const apiError = (error as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tạo phiếu nhập kho</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {apiError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {apiError}
            </div>
          )}

          {/* Kho – auto-fill theo user, chỉ OWN mới đổi được */}
          <div className="space-y-2">
            <Label>Kho <span className="text-red-500">*</span></Label>
            {isOWN ? (
              <Select value={warehouseId} onValueChange={v => { setWarehouseId(v); setSubType(''); setLocationId(''); setMaterialId(''); setMatSearch('') }}>
                <SelectTrigger><SelectValue placeholder="Chọn kho" /></SelectTrigger>
                <SelectContent>
                  {(warehouses as { id: string; name: string; code: string }[]).map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name} ({w.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex h-10 items-center rounded-md border bg-slate-50 px-3 text-sm text-slate-700">
                {(warehouses as { id: string; name: string }[]).find((w) => w.id === warehouseId)?.name ?? (warehouseId || '—')}
              </div>
            )}
          </div>

          {/* Loại kho – lọc cả vị trí lẫn danh sách hàng hóa theo cùng category */}
          {loaiKhoOpts.length > 0 && (
            <div className="space-y-2">
              <Label>Loại kho <span className="text-red-500">*</span></Label>
              <Select value={subType} onValueChange={v => { setSubType(v); setLocationId(''); setMaterialId(''); setMatSearch('') }} disabled={!warehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn loại kho" />
                </SelectTrigger>
                <SelectContent>
                  {loaiKhoOpts.map(c => (
                    <SelectItem key={c.sub_type} value={c.sub_type}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Vị trí – lọc theo loại kho, color-coded by capacity */}
          <div className="space-y-2">
            <Label>
              Vị trí nhập <span className="text-red-500">*</span>
              <span className="ml-2 text-xs font-normal text-slate-400">
                đầy=xanh · một phần=cam · trống=trắng
              </span>
            </Label>
            <Select value={locationId} onValueChange={setLocationId} disabled={!warehouseId}>
              <SelectTrigger>
                <SelectValue placeholder={!warehouseId ? 'Chọn kho trước' : !subType ? 'Chọn loại kho trước' : 'Chọn vị trí'} />
              </SelectTrigger>
              <SelectContent>
                {filteredLocs.map((l) => {
                  const isFull    = l.max_pallets > 0 && l.used_slots >= l.max_pallets
                  const isPartial = l.used_slots > 0 && !isFull
                  return (
                    <SelectItem key={l.id} value={l.id}>
                      <span className={isFull ? 'text-blue-700 font-semibold' : isPartial ? 'text-amber-600' : ''}>
                        {l.location_code}
                      </span>
                      <span className="ml-2 text-xs text-slate-400">
                        ({l.used_slots}/{l.max_pallets})
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Material – combobox, lọc theo mat_category của loại kho đã chọn */}
          <div className="space-y-2">
            <Label>Material <span className="text-red-500">*</span></Label>
            <div ref={matRef} className="relative">
              <Input
                placeholder={matCategory ? `Tìm hàng ${subTypeLabel(subType)}…` : 'Tìm mã hoặc tên hàng...'}
                value={matInputValue}
                onChange={(e) => { setMatSearch(e.target.value); setMaterialId(''); setMatOpen(true) }}
                onFocus={() => setMatOpen(true)}
              />
              {matOpen && (
                <div className="absolute z-[100] w-full mt-1 max-h-52 overflow-y-auto rounded-md border bg-white shadow-lg">
                  {(materials as MatItem[]).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 flex items-baseline gap-2 ${m.id === materialId ? 'bg-slate-50 font-medium' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                      onClick={() => { setMaterialId(m.id); setMatSearch(''); setMatOpen(false) }}
                    >
                      <span className="font-mono text-xs text-slate-500 shrink-0">{m.material_code}</span>
                      <span className="text-slate-800 truncate">{m.short_name ?? m.material_description}</span>
                    </button>
                  ))}
                  {(materials as MatItem[]).length === 0 && (
                    <div className="px-3 py-3 text-sm text-slate-400 text-center">Không tìm thấy hàng hóa</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Ca nhập + Ngày nhập */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Ca nhập</Label>
              <Select value={shiftId} onValueChange={setShiftId}>
                <SelectTrigger><SelectValue placeholder="Chọn ca" /></SelectTrigger>
                <SelectContent>
                  {(shifts as { id: string; name: string }[]).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Ngày nhập</Label>
              <Input
                type="date"
                value={importDate}
                onChange={(e) => setImportDate(e.target.value)}
              />
            </div>
          </div>

          {/* Người nhập – tự động theo user hiện tại */}
          <div className="space-y-2">
            <Label>Người nhập</Label>
            <div className="flex h-10 items-center rounded-md border bg-slate-50 px-3 text-sm text-slate-700 gap-2">
              <User className="h-4 w-4 text-slate-400 shrink-0" />
              <span className="truncate">{user?.name ?? '—'}</span>
              {!importedByEmpId && (
                <span className="ml-auto text-xs text-amber-500 shrink-0">chưa khớp nhân viên</span>
              )}
            </div>
          </div>

          {/* Ghi chú */}
          <div className="space-y-2">
            <Label>Ghi chú</Label>
            <Input placeholder="Tuỳ chọn" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button
            onClick={handleSubmit}
            disabled={!warehouseId || !subType || !locationId || !materialId || isPending}
          >
            {isPending ? 'Đang tạo...' : 'Tạo phiếu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Multi-select dropdown ────────────────────────────────────

interface MultiOpt { value: string; label: string }

function MultiSelectDropdown({ label, options, selected, onChange, searchable }: {
  label: string; options: MultiOpt[]; selected: string[]; onChange: (v: string[]) => void; searchable?: boolean
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

  const active = selected.length > 0
  const visible = searchable && search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(v => !v)}
        className={`h-7 px-2 text-xs border rounded flex items-center gap-1 whitespace-nowrap transition-colors
          ${active ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
        {label}{active ? ` (${selected.length})` : ''}
        <ChevronDown className="h-3 w-3 ml-0.5" />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-white border rounded-md shadow-lg min-w-[220px] max-h-64 flex flex-col">
          {searchable && (
            <div className="p-2 border-b shrink-0">
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
            {active && !search && (
              <button type="button" className="w-full text-left px-3 py-1.5 text-[10px] text-red-500 hover:bg-red-50 border-b"
                onClick={() => onChange([])}>Xóa lọc</button>
            )}
            {visible.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-400 text-center">Không tìm thấy</div>
            )}
            {visible.map(opt => (
              <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" className="h-3 w-3 shrink-0"
                  checked={selected.includes(opt.value)}
                  onChange={() => {
                    const next = selected.includes(opt.value)
                      ? selected.filter(v => v !== opt.value)
                      : [...selected, opt.value]
                    onChange(next)
                  }} />
                <span className="text-[11px] text-slate-700">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Client-side cascade filter ───────────────────────────────

function applyClientFilters(
  orders: InboundOrder[],
  mats: string[], cycles: string[], machines: string[], importer: string,
  exclude?: 'mat' | 'cycle' | 'machine' | 'importer'
) {
  return orders.filter(order => {
    const importerName = (order.imported_by_emp?.name ?? order.created_by_emp?.name ?? '').toLowerCase()
    if (exclude !== 'mat'      && mats.length     > 0 && !mats.includes(order.material_id ?? ''))                          return false
    if (exclude !== 'cycle'    && cycles.length   > 0 && !(order.cycles ?? []).some(c => cycles.includes(c)))               return false
    if (exclude !== 'machine'  && machines.length > 0 && !(order.machine_codes ?? []).some(m => machines.includes(m)))      return false
    if (exclude !== 'importer' && importer             && !importerName.includes(importer.toLowerCase()))                   return false
    return true
  })
}

// ─── Main page ───────────────────────────────────────────────

export default function Inbound() {
  const navigate  = useNavigate()
  const user      = useAuthStore(s => s.user)
  const { inbound: f, setInbound } = useWmsFilterStore()
  const [showNew,  setShowNew]  = useState(false)
  const [locOpen,  setLocOpen]  = useState(false)

  const { data: shifts     = [] } = useImportShifts()
  const { data: warehouses = [] } = useWarehouses(true)

  // Resolve effective warehouse: store override → user's warehouse
  const effectiveWarehouseId = f.warehouseId || user?.warehouse_id || undefined

  const { data: serverOrders = [], isLoading } = useInboundOrders({
    warehouse_id:      effectiveWarehouseId,
    search:            f.search           || undefined,
    date_from:         f.dateFrom         || undefined,
    date_to:           f.dateTo           || undefined,
    shift_id:          f.shiftId          || undefined,
    material_category: f.materialCategory || undefined,
  })

  // Null-safe defaults for all array/string fields (guards against stale session state)
  const filterMaterials = f.filterMaterials ?? []
  const filterCycles    = f.filterCycles    ?? []
  const filterMachines  = f.filterMachines  ?? []
  const importerSearch  = f.importerSearch  ?? ''

  // Cascade-filtered orders
  const filteredOrders = useMemo(
    () => applyClientFilters(serverOrders, filterMaterials, filterCycles, filterMachines, importerSearch),
    [serverOrders, filterMaterials, filterCycles, filterMachines, importerSearch]
  )

  // Options for each multi-select — computed from subset excluding that filter's own selection
  const materialOptions = useMemo(() => {
    const sub = applyClientFilters(serverOrders, filterMaterials, filterCycles, filterMachines, importerSearch, 'mat')
    const seen = new Map<string, string>()
    for (const o of sub)
      if (o.material_id && !seen.has(o.material_id))
        seen.set(o.material_id, o.material?.short_name ?? o.material?.material_description ?? o.material_id)
    return [...seen.entries()].map(([value, label]) => ({ value, label }))
  }, [serverOrders, filterCycles, filterMachines, importerSearch])

  const cycleOptions = useMemo(() => {
    const sub = applyClientFilters(serverOrders, filterMaterials, filterCycles, filterMachines, importerSearch, 'cycle')
    return [...new Set(sub.flatMap(o => o.cycles ?? []))].map(c => ({ value: c, label: c }))
  }, [serverOrders, filterMaterials, filterMachines, importerSearch])

  const machineOptions = useMemo(() => {
    const sub = applyClientFilters(serverOrders, filterMaterials, filterCycles, filterMachines, importerSearch, 'machine')
    return [...new Set(sub.flatMap(o => o.machine_codes ?? []))].map(m => ({ value: m, label: m }))
  }, [serverOrders, filterMaterials, filterCycles, importerSearch])

  // Totals
  const totalPallets = useMemo(() => filteredOrders.reduce((s, o) => s + o._count.inventory_entries, 0), [filteredOrders])
  const totalCartons = useMemo(() => filteredOrders.reduce((s, o) => s + (o.total_cartons ?? 0), 0), [filteredOrders])

  // Location summary
  const locationSummary = useMemo(() => {
    const map = new Map<string, { loc: string; pallets: number; cartons: number }>()
    for (const order of filteredOrders) {
      const loc = order.location
        ? `${order.location.location_code}-${order.location.sub_code}`
        : '(chưa xác định)'
      const cur = map.get(loc) ?? { loc, pallets: 0, cartons: 0 }
      cur.pallets += order._count.inventory_entries
      cur.cartons += order.total_cartons ?? 0
      map.set(loc, cur)
    }
    return [...map.values()].sort((a, b) => b.pallets - a.pallets)
  }, [filteredOrders])

  // Date label
  const hasDate = f.dateFrom || f.dateTo
  const isToday = f.dateFrom === TODAY && f.dateTo === TODAY
  let dateLabel = 'Tất cả ngày'
  if (f.dateFrom && f.dateTo) {
    dateLabel = f.dateFrom === f.dateTo
      ? format(parseISO(f.dateFrom), 'EEEE, dd/MM/yyyy', { locale: vi })
      : `${format(parseISO(f.dateFrom), 'dd/MM/yyyy')} – ${format(parseISO(f.dateTo), 'dd/MM/yyyy')}`
  } else if (f.dateFrom) {
    dateLabel = `Từ ${format(parseISO(f.dateFrom), 'dd/MM/yyyy')}`
  } else if (f.dateTo) {
    dateLabel = `Đến ${format(parseISO(f.dateTo), 'dd/MM/yyyy')}`
  }

  const hasClientFilters = filterMaterials.length > 0 || filterCycles.length > 0 || filterMachines.length > 0 || !!importerSearch

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-4 py-3 shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-slate-500" />
            Nhập kho
          </h1>
          <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> Tạo phiếu nhập
          </Button>
        </div>

        {/* Row 1: Date range + Ca + Search */}
        <div className="flex gap-2 flex-wrap items-center">
          <div className="flex items-center gap-1">
            <CalendarDays className="h-4 w-4 text-slate-400 shrink-0" />
            <Input type="date" className="h-8 text-sm w-[138px]"
              value={f.dateFrom} onChange={e => setInbound({ dateFrom: e.target.value })} />
            <span className="text-xs text-slate-400">–</span>
            <Input type="date" className="h-8 text-sm w-[138px]"
              value={f.dateTo} onChange={e => setInbound({ dateTo: e.target.value })} />
            {!isToday && (
              <button className="text-xs text-slate-400 hover:text-slate-700 underline whitespace-nowrap ml-1"
                onClick={() => setInbound({ dateFrom: TODAY, dateTo: TODAY })}>
                Hôm nay
              </button>
            )}
            {hasDate && (
              <button className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                title="Xem tất cả ngày" onClick={() => setInbound({ dateFrom: '', dateTo: '' })}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Select value={f.warehouseId || '__all__'} onValueChange={v => setInbound({ warehouseId: v === '__all__' ? '' : v, filterMaterials: [], filterCycles: [], filterMachines: [] })}>
            <SelectTrigger className="h-8 text-sm w-[120px]">
              <SelectValue placeholder="Tất cả kho" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả kho</SelectItem>
              {(warehouses as { id: string; name: string }[]).map(w => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={f.materialCategory || '__all__'} onValueChange={v => setInbound({ materialCategory: v === '__all__' ? '' : v, filterMaterials: [], filterCycles: [], filterMachines: [] })}>
            <SelectTrigger className="h-8 text-sm w-[130px]">
              <SelectValue placeholder="Loại kho" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả loại</SelectItem>
              <SelectItem value="TP">Thành phẩm</SelectItem>
              <SelectItem value="NVL">Nguyên vật liệu</SelectItem>
              <SelectItem value="POSM">POSM</SelectItem>
              <SelectItem value="BAO_BI">Bao bì</SelectItem>
            </SelectContent>
          </Select>

          <Select value={f.shiftId || '__all__'} onValueChange={v => setInbound({ shiftId: v === '__all__' ? '' : v })}>
            <SelectTrigger className="h-8 text-sm w-[100px]">
              <SelectValue placeholder="Tất cả ca" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả ca</SelectItem>
              {(shifts as { id: string; name: string }[]).map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[120px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input className="pl-8 h-8 text-sm" placeholder="Tìm mã phiếu, hàng hóa…"
              value={f.search} onChange={e => setInbound({ search: e.target.value })} />
          </div>
        </div>

        {/* Row 2: Multi-select client filters */}
        <div className="flex gap-2 flex-wrap items-center">
          <MultiSelectDropdown label="Material" options={materialOptions} searchable
            selected={filterMaterials} onChange={v => setInbound({ filterMaterials: v })} />
          <MultiSelectDropdown label="Chu kỳ" options={cycleOptions}
            selected={filterCycles} onChange={v => setInbound({ filterCycles: v })} />
          <MultiSelectDropdown label="Máy" options={machineOptions}
            selected={filterMachines} onChange={v => setInbound({ filterMachines: v })} />

          <div className="relative">
            <User className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input className="pl-6 h-7 text-xs w-[130px]" placeholder="Người nhập…"
              value={importerSearch} onChange={e => setInbound({ importerSearch: e.target.value })} />
          </div>

          {hasClientFilters && (
            <button className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-600 px-1"
              onClick={() => setInbound({ filterMaterials: [], filterCycles: [], filterMachines: [], importerSearch: '' })}>
              <X className="h-3 w-3" /> Xóa lọc
            </button>
          )}
        </div>

        {/* Summary */}
        <p className="text-xs text-slate-500 -mt-1">
          {hasDate ? (
            <>
              <span className="font-medium text-slate-700">{dateLabel}</span>
              {isToday && <span className="ml-1.5 text-blue-600 font-medium">· Hôm nay</span>}
            </>
          ) : (
            <span className="italic">Hiển thị tất cả ngày</span>
          )}
          {' '}—{' '}
          <span className="font-medium text-slate-700">{filteredOrders.length}</span> phiếu nhập
          {totalPallets > 0 && <> · <span className="font-medium text-slate-700">{totalPallets}</span> pallet</>}
          {totalCartons > 0 && <> · <span className="font-medium text-slate-700">{totalCartons.toLocaleString()}</span> thùng</>}
        </p>

        {/* Vị trí hàng nhập – collapsible trong header */}
        {!isLoading && filteredOrders.length > 0 && (
          <div className="rounded-md border border-slate-200 overflow-hidden">
            <button
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 text-left"
              onClick={() => setLocOpen(v => !v)}>
              <MapPin className="h-3.5 w-3.5 text-slate-400" />
              Vị trí hàng nhập ({locationSummary.length} vị trí) · {totalPallets} pallet · {totalCartons.toLocaleString()} thùng
              <ChevronDown className={`h-3 w-3 ml-auto transition-transform ${locOpen ? 'rotate-180' : ''}`} />
            </button>
            {locOpen && (
              <div className="px-3 py-2 overflow-x-auto border-t border-slate-200 bg-white">
                {/* Filter info */}
                {(() => {
                  const parts = [
                    hasDate ? dateLabel : null,
                    f.warehouseId ? (warehouses as { id: string; name: string }[]).find(w => w.id === f.warehouseId)?.name : null,
                    f.materialCategory ? ({ TP: 'Thành phẩm', NVL: 'NVL', POSM: 'POSM', BAO_BI: 'Bao bì' } as Record<string, string>)[f.materialCategory] : null,
                    f.shiftId ? (shifts as { id: string; name: string }[]).find(s => s.id === f.shiftId)?.name : null,
                  ].filter(Boolean)
                  return parts.length > 0 ? (
                    <p className="text-[10px] text-slate-400 mb-1.5">Lọc: {parts.join(' · ')}</p>
                  ) : null
                })()}
                <table className="text-[11px] w-full max-w-sm">
                  <thead>
                    <tr className="text-slate-400 border-b">
                      <th className="py-1 pr-6 text-left font-medium">Vị trí</th>
                      <th className="py-1 pr-6 text-right font-medium">Pallet</th>
                      <th className="py-1 text-right font-medium">Thùng nhập</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locationSummary.map(row => (
                      <tr key={row.loc} className="border-b border-slate-100">
                        <td className="py-1 pr-6 font-mono text-slate-700">{row.loc}</td>
                        <td className="py-1 pr-6 text-right tabular-nums font-semibold">{row.pallets}</td>
                        <td className="py-1 text-right tabular-nums">{row.cartons.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="text-slate-500 font-semibold border-t">
                      <td className="py-1 pr-6">Tổng</td>
                      <td className="py-1 pr-6 text-right tabular-nums">{totalPallets}</td>
                      <td className="py-1 text-right tabular-nums">{totalCartons.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={5} cols={6} /></div>
        ) : filteredOrders.length === 0 ? (
          <EmptyState
            icon={PackagePlus}
            title="Chưa có phiếu nhập"
            description={hasClientFilters ? 'Không có kết quả phù hợp với bộ lọc' : hasDate ? 'Không có phiếu nhập trong khoảng thời gian đã chọn' : 'Tạo phiếu nhập kho để bắt đầu quét hàng vào kho.'}
            action={!hasClientFilters ? (
              <Button onClick={() => setShowNew(true)}>
                <Plus className="h-4 w-4 mr-2" /> Tạo phiếu nhập
              </Button>
            ) : undefined}
          />
        ) : (
          <>
            {/* Orders table */}
            <div className="overflow-x-auto">
              <Table className="min-w-full">
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Ngày nhập</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Ca</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Material</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Pallet</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Tổng nhập</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Người nhập</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.map(order => (
                    <InboundRow key={order.id} order={order} onClick={() => navigate(`/wms/inbound/${order.id}`)} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      <CreateOrderDialog open={showNew} onClose={() => setShowNew(false)} />
    </div>
  )
}

function statusColors(order: InboundOrder) {
  const used = order.location_used_slots ?? 0
  const max  = order.location?.max_pallets ?? 0
  const full = max > 0 && used >= max
  if (full)     return { bg: 'bg-blue-50',  hover: 'hover:bg-blue-100',  text: 'text-blue-700'  }
  if (used > 0) return { bg: 'bg-amber-50', hover: 'hover:bg-amber-100', text: 'text-amber-600' }
  return               { bg: '',            hover: 'hover:bg-slate-50',  text: 'text-slate-400' }
}

function InboundRow({ order, onClick }: { order: InboundOrder; onClick: () => void }) {
  const dateFull = order.import_date ? format(parseISO(order.import_date), 'dd/MM/yy', { locale: vi }) : '—'
  const isRowToday = order.import_date?.slice(0, 10) === TODAY
  const importer = order.imported_by_emp?.name ?? order.created_by_emp?.name ?? '—'
  const matName  = order.material?.short_name ?? order.material?.material_description ?? '—'
  const matCode  = order.material?.material_code ?? ''
  const pallets  = order._count.inventory_entries
  const { bg, hover, text } = statusColors(order)

  return (
    <TableRow className={`cursor-pointer transition-colors ${bg} ${hover}`} onClick={onClick}>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-medium tabular-nums">{dateFull}</span>
        {isRowToday && <span className="ml-1 text-[9px] text-blue-600 font-medium">· Hôm nay</span>}
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {order.shift
          ? <span className="text-[10px] font-medium">{order.shift.name}</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>
      <TableCell className="px-2 py-1 max-w-[160px]">
        <div className="text-[10px] leading-tight truncate">
          <span className="font-medium">{matName}</span>
          {matCode && <span className="ml-1 text-[9px] text-slate-400 font-mono">{matCode}</span>}
        </div>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className={`text-[10px] font-semibold tabular-nums ${text}`}>{pallets}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">pl</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{order.total_cartons ?? 0}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
      </TableCell>
      <TableCell className="px-2 py-1 max-w-[90px]">
        <span className="text-[10px] text-slate-700 truncate block">{importer}</span>
      </TableCell>
    </TableRow>
  )
}
