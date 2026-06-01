import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, PackagePlus, CalendarDays, X, ChevronDown, User, MapPin, Filter, QrCode } from 'lucide-react'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { useAuthStore }        from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
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
  useEmployeeRecords, useWarehouseTypes, useWarehouseZones,
  useActiveGateRegistrations, useInboundPlanLines,
} from '@/api/hooks'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import { SearchInput } from '@/components/shared/SearchInput'
import type { InboundOrder } from '@/types'
import { unlockAudio } from '@/utils/audio'

const TODAY = new Date().toISOString().slice(0, 10)

interface LocationWithCapacity {
  id: string
  location_code: string
  sub_code: string
  sub_type: string | null
  category: string | null
  max_pallets: number
  used_slots: number
}

const normCatFe = (c: string) => c === 'TP' ? 'Thành phẩm' : c === 'BAO_BI' ? 'Bao bì' : c


// ─── Create order dialog ─────────────────────────────────────

type MatItem = { id: string; material_code: string; short_name: string | null; material_description: string }

function CreateOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate  = useNavigate()
  const user      = useAuthStore((s) => s.user)
  // NATIONAL scope → can pick any warehouse; ASSIGNED with single warehouse → fixed
  const canPickWarehouse = user?.warehouse_scope === 'NATIONAL' || !user?.warehouse_id
  const dialogAllowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids)
    : null

  const [sourceType,    setSourceType]    = useState<'FACTORY' | 'NCC'>('FACTORY')
  const [warehouseId,   setWarehouseId]   = useState('')
  const [subType,       setSubType]       = useState('')
  const [materialId,    setMaterialId]    = useState('')
  const [locationId,    setLocationId]    = useState('')
  const [shiftId,       setShiftId]       = useState('')
  const [importDate,    setImportDate]    = useState(format(new Date(), 'yyyy-MM-dd'))
  const [notes,         setNotes]         = useState('')
  // NCC-specific
  const [gateRegId,     setGateRegId]     = useState('')
  const [tmsOrderId,    setTmsOrderId]    = useState('')
  const [plannedCartons,setPlannedCartons]= useState('')
  const [nccMatOpen,    setNccMatOpen]    = useState(false)
  const nccMatRef = useRef<HTMLDivElement>(null)

  // Material combobox state
  const [matSearch, setMatSearch] = useState('')
  const [matOpen,   setMatOpen]   = useState(false)
  const matRef = useRef<HTMLDivElement>(null)

  // Reset all fields each time the dialog opens
  useEffect(() => {
    if (open) {
      setSourceType('FACTORY')
      setWarehouseId(user?.warehouse_id ?? user?.warehouse_ids?.[0] ?? '')
      setSubType('')
      setMaterialId('')
      setMatSearch('')
      setMatOpen(false)
      setLocationId('')
      setShiftId('')
      setImportDate(format(new Date(), 'yyyy-MM-dd'))
      setNotes('')
      setGateRegId('')
      setTmsOrderId('')
      setPlannedCartons('')
      setNccMatOpen(false)
    }
  }, [open, user?.warehouse_id, user?.warehouse_ids])

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: shifts     = [] } = useImportShifts()

  // NCC: gate registrations đang IN (direction=INBOUND) để thủ kho chọn xe
  const { data: activeGates = [] } = useActiveGateRegistrations(
    sourceType === 'NCC' && warehouseId && importDate
      ? { date: importDate, warehouse_id: warehouseId, direction: 'INBOUND', status: 'IN' }
      : undefined
  )
  // NCC: materials từ SAP INBOUND plan — lọc theo tms_order_id của gate đã chọn
  const selectedGate = (activeGates as any[]).find(g => g.id === gateRegId)
  const gateTmsOrderId: string | undefined = selectedGate?.tms_order_id ?? undefined
  const { data: planMaterials = [] } = useInboundPlanLines(
    sourceType === 'NCC' && warehouseId && importDate
      ? { date: importDate, warehouse_id: warehouseId, ...(gateTmsOrderId ? { tms_order_id: gateTmsOrderId } : {}) }
      : undefined
  )
  const { data: locations  = [] } = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId } : undefined
  )
  const { data: zones = [] } = useWarehouseZones(warehouseId || undefined)

  const allLocs = locations as LocationWithCapacity[]

  const { data: allWhTypes = [] } = useWarehouseTypes()
  const loaiKhoOpts = allWhTypes.map(t => t.value)
  // backward compat: also match location by sub_code if zone name matches subType
  const selectedZone = zones.find(z => z.name === subType)
  const filteredLocs = subType
    ? allLocs.filter(l => l.category === subType || (selectedZone && l.sub_code === selectedZone.code))
    : allLocs

  const matCategory = subType || undefined
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
    if (!warehouseId || !subType || !materialId || !shiftId || !importDate) return
    if (sourceType === 'FACTORY' && !locationId) return
    if (sourceType === 'NCC' && !gateRegId) return
    createOrder(
      {
        warehouse_id:         warehouseId,
        material_id:          materialId,
        location_id:          locationId  || undefined,
        shift_id:             shiftId          || undefined,
        import_date:          importDate,
        notes:                notes            || undefined,
        imported_by:          importedByEmpId  || undefined,
        source_type:          sourceType,
        warehouse_type:       subType          || undefined,
        gate_registration_id: gateRegId        || undefined,
        tms_order_id:         (tmsOrderId && tmsOrderId !== '__unplanned__') ? tmsOrderId : undefined,
        planned_cartons:      plannedCartons ? Number(plannedCartons) : undefined,
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

          {/* Nguồn nhập */}
          <div className="flex rounded-lg border overflow-hidden">
            {(['FACTORY', 'NCC'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => { setSourceType(t); setGateRegId(''); setTmsOrderId(''); setMaterialId(''); setMatSearch('') }}
                className={[
                  'flex-1 py-1.5 text-xs font-medium transition-colors',
                  sourceType === t
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50',
                ].join(' ')}
              >
                {t === 'FACTORY' ? 'Nhập Sản Xuất' : 'Nhập Ngoài (NCC)'}
              </button>
            ))}
          </div>

          {/* Kho – tự do nếu user không có warehouse_id cố định */}
          <div className="space-y-2">
            <Label>Kho <span className="text-red-500">*</span></Label>
            {canPickWarehouse ? (
              <Select value={warehouseId} onValueChange={v => { setWarehouseId(v); setSubType(''); setLocationId(''); setMaterialId(''); setMatSearch('') }}>
                <SelectTrigger><SelectValue placeholder="Chọn kho" /></SelectTrigger>
                <SelectContent>
                  {(warehouses as { id: string; name: string; code: string }[])
                    .filter(w => !dialogAllowedWhIds || dialogAllowedWhIds.has(w.id))
                    .map((w) => (
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
          <div className="space-y-2">
            <Label>Loại kho <span className="text-red-500">*</span></Label>
            <Select value={subType} onValueChange={v => { setSubType(v); setLocationId(''); setMaterialId(''); setMatSearch('') }} disabled={!warehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="Chọn loại kho" />
              </SelectTrigger>
              <SelectContent>
                {loaiKhoOpts.map(v => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* NCC: Chọn xe đang vào + Material từ kế hoạch */}
          {sourceType === 'NCC' && (
            <>
              <div className="space-y-2">
                <Label>Xe đang vào cổng <span className="text-red-500">*</span></Label>
                <Select value={gateRegId} onValueChange={v => { setGateRegId(v); setTmsOrderId(''); setMaterialId('') }} disabled={!warehouseId || !importDate}>
                  <SelectTrigger>
                    <SelectValue placeholder={!warehouseId ? 'Chọn kho trước' : activeGates.length === 0 ? 'Không có xe INBOUND đang vào' : 'Chọn xe...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {(activeGates as any[]).map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        <span className="font-mono font-semibold text-slate-700">{g.license_plate ?? '—'}</span>
                        <span className="ml-2 text-xs text-slate-400">
                          Lần {g.registration_number} · {g.company_name_raw ?? '—'} · {g.driver_name ?? ''}
                        </span>
                      </SelectItem>
                    ))}
                    {activeGates.length === 0 && !warehouseId && null}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Mã hàng theo kế hoạch <span className="text-red-500">*</span></Label>
                <div ref={nccMatRef} className="relative">
                  <Select
                    value={(planMaterials as any[]).find(m => m.tms_order_id === tmsOrderId && m.material_id === materialId)?.id ?? ''}
                    onValueChange={v => {
                      const found = (planMaterials as any[]).find(m => m.id === v)
                      if (found) {
                        setTmsOrderId(found.tms_order_id ?? '')
                        setMaterialId(found.material_id ?? '')
                      }
                    }}
                    disabled={!gateRegId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={!gateRegId ? 'Chọn xe trước' : planMaterials.length === 0 ? 'Không có kế hoạch — dùng Phát sinh' : 'Chọn từ kế hoạch...'} />
                    </SelectTrigger>
                    <SelectContent>
                      {(planMaterials as any[]).map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          <span className="font-mono text-xs text-slate-500">{m.material?.material_code ?? '—'}</span>
                          <span className="ml-2">{m.material?.short_name ?? '—'}</span>
                          <span className="ml-2 text-xs text-slate-400">KH: {m.planned_boxes ?? 0} thùng</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {gateRegId && (
                    <button
                      type="button"
                      className="mt-1.5 text-xs text-amber-600 hover:text-amber-700 underline"
                      onClick={() => { setTmsOrderId('__unplanned__'); setMaterialId('') }}
                    >
                      + Thêm mã phát sinh (không có trong kế hoạch)
                    </button>
                  )}
                </div>
              </div>

              {/* Mã hàng tự chọn (chỉ khi phát sinh) */}
              {tmsOrderId === '__unplanned__' && (
                <div className="space-y-2">
                  <Label>Mã hàng (phát sinh) <span className="text-red-500">*</span></Label>
                  <div ref={matRef} className="relative">
                    <Input
                      placeholder="Tìm mã hoặc tên hàng..."
                      value={materialId ? ((materials as MatItem[]).find(m => m.id === materialId) ? `${(materials as MatItem[]).find(m => m.id === materialId)!.material_code} – ${(materials as MatItem[]).find(m => m.id === materialId)!.short_name ?? ''}` : matSearch) : matSearch}
                      onChange={(e) => { setMatSearch(e.target.value); setMaterialId(''); setMatOpen(true) }}
                      onFocus={() => setMatOpen(true)}
                    />
                    {matOpen && (
                      <div className="absolute z-[100] w-full mt-1 max-h-52 overflow-y-auto rounded-md border bg-white shadow-lg">
                        {(materials as MatItem[]).map((m) => (
                          <button key={m.id} type="button"
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 flex items-baseline gap-2 ${m.id === materialId ? 'bg-slate-50 font-medium' : ''}`}
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                            onClick={() => { setMaterialId(m.id); setMatSearch(''); setMatOpen(false) }}
                          >
                            <span className="font-mono text-xs text-slate-500 shrink-0">{m.material_code}</span>
                            <span className="text-slate-800 truncate">{m.short_name ?? m.material_description}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Số thùng dự kiến trên xe</Label>
                <Input
                  type="number" min={0} placeholder="Nhập khi mở xe ra"
                  value={plannedCartons}
                  onChange={(e) => setPlannedCartons(e.target.value)}
                />
              </div>
            </>
          )}

          {/* Vị trí – lọc theo loại kho, color-coded by capacity */}
          <div className="space-y-2">
            <Label>
              Vị trí nhập {sourceType === 'FACTORY' && <span className="text-red-500">*</span>}
              {sourceType === 'NCC' && <span className="text-xs font-normal text-slate-400 ml-1">(để trống — lái xe nâng chọn khi scan)</span>}
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

          {/* Material – combobox, chỉ dùng cho FACTORY (NCC dùng dropdown kế hoạch ở trên) */}
          {sourceType === 'FACTORY' && <div className="space-y-2">
            <Label>Material <span className="text-red-500">*</span></Label>
            <div ref={matRef} className="relative">
              <Input
                placeholder={subType ? `Tìm hàng ${subType}…` : 'Tìm mã hoặc tên hàng...'}
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
          </div>}

          {/* Ca nhập + Ngày nhập */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Ca nhập <span className="text-red-500">*</span></Label>
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
              <Label>Ngày nhập <span className="text-red-500">*</span></Label>
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
            disabled={
              !warehouseId || !subType || !materialId || isPending ||
              (sourceType === 'FACTORY' && !locationId) ||
              (sourceType === 'NCC' && !gateRegId)
            }
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
            {/* Tất cả */}
            <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer border-b border-slate-100">
              <input type="checkbox" className="h-3 w-3 shrink-0"
                checked={visible.length > 0 && visible.every(o => selected.includes(o.value))}
                onChange={() => {
                  const allSel = visible.every(o => selected.includes(o.value))
                  if (allSel) onChange([])
                  else onChange(visible.map(o => o.value))
                }} />
              <span className="text-[11px] text-slate-500 font-medium">Tất cả</span>
            </label>
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
            {active && !search && (
              <button type="button" className="w-full text-left px-3 py-1.5 text-[10px] text-red-500 hover:bg-red-50 border-t"
                onClick={() => onChange([])}>Xóa lọc</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Ca sort order: Ca 1 → Ca 2 → Ca 3 → HC → unknown last
const SHIFT_ORDER: Record<string, number> = { 'Ca 1': 0, 'Ca 2': 1, 'Ca 3': 2, 'HC': 3 }

// ─── Client-side cascade filter ───────────────────────────────

function applyClientFilters(
  orders: InboundOrder[],
  mats: string[], cycles: string[], machines: string[], importer: string, shiftIds: string[],
  exclude?: 'mat' | 'cycle' | 'machine' | 'importer' | 'shift'
) {
  return orders.filter(order => {
    const importerName = (order.imported_by_emp?.name ?? order.created_by_emp?.name ?? '').toLowerCase()
    if (exclude !== 'mat'      && mats.length     > 0 && !mats.includes(order.material_id ?? ''))                      return false
    if (exclude !== 'cycle'    && cycles.length   > 0 && !(order.cycles ?? []).some(c => cycles.includes(c)))           return false
    if (exclude !== 'machine'  && machines.length > 0 && !(order.machine_codes ?? []).some(m => machines.includes(m)))  return false
    if (exclude !== 'importer' && importer             && !importerName.includes(importer.toLowerCase()))               return false
    if (exclude !== 'shift'    && shiftIds.length > 0 && !shiftIds.includes(order.shift_id ?? ''))                      return false
    return true
  })
}

// ─── Date button: displays dd-MM-yyyy, overlays native date picker ──────────

function DateBtn({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="relative inline-flex shrink-0 cursor-pointer"
      onClick={() => inputRef.current?.showPicker()}>
      <span className={`text-xs px-2.5 py-1 rounded-md border whitespace-nowrap select-none pointer-events-none ${
        value ? 'bg-white border-blue-300 text-blue-900 font-semibold' : 'bg-white/70 border-blue-200 text-blue-400'
      }`}>
        {value ? format(parseISO(value), 'dd-MM-yyyy') : placeholder}
      </span>
      <input ref={inputRef} type="date" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
        value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────

export default function Inbound() {
  const navigate  = useNavigate()
  const user      = useAuthStore(s => s.user)
  const perms     = user?.module_permissions as ModulePermissions | null ?? null
  const { inbound: f, setInbound } = useWmsFilterStore()
  const [showNew,     setShowNew]     = useState(false)
  const [locOpen,     setLocOpen]     = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const { data: shifts     = [] } = useImportShifts()
  const { data: warehouses = [] } = useWarehouses(true)
  const { data: whTypes = [] } = useWarehouseTypes()
  const categories = whTypes.map(t => t.value)

  // Compute allowed warehouses + categories from user's scope
  const inboundAllowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids)
    : null
  const inboundAllowedCats = user?.warehouse_scope === 'NATIONAL'
    ? null
    : user?.allowed_categories?.length
      ? user.allowed_categories.map(normCatFe)
      : null

  // Resolve effective warehouse: UI filter override → user's single fixed warehouse → let backend scope handle multi-warehouse
  const effectiveWarehouseId = f.warehouseId || user?.warehouse_id || undefined

  const { data: serverOrders = [], isLoading } = useInboundOrders({
    warehouse_id:      effectiveWarehouseId,
    search:            f.search           || undefined,
    date_from:         f.dateFrom         || undefined,
    date_to:           f.dateTo           || undefined,
    material_category: f.materialCategory || undefined,
  })

  // Null-safe defaults for all array/string fields (guards against stale session state)
  const filterMaterials = f.filterMaterials ?? []
  const filterCycles    = f.filterCycles    ?? []
  const filterMachines  = f.filterMachines  ?? []
  const filterShiftIds  = f.filterShiftIds  ?? []
  const importerSearch  = f.importerSearch  ?? ''

  // Cascade-filtered orders
  const filteredOrders = useMemo(
    () => applyClientFilters(serverOrders, filterMaterials, filterCycles, filterMachines, importerSearch, filterShiftIds),
    [serverOrders, filterMaterials, filterCycles, filterMachines, importerSearch, filterShiftIds]
  )

  // Shift options for multi-select (from master data, not derived from orders)
  const shiftOptions = useMemo(() =>
    (shifts as { id: string; name: string }[]).map(s => ({ value: s.id, label: s.name })),
    [shifts]
  )

  // Sort: ngày desc → ca asc (Ca 1, Ca 2, Ca 3, HC) → giờ tạo asc
  const sortedOrders = useMemo(() =>
    [...filteredOrders].sort((a, b) => {
      const dateA = a.import_date ?? ''
      const dateB = b.import_date ?? ''
      if (dateA !== dateB) return dateB.localeCompare(dateA)
      const sA = SHIFT_ORDER[a.shift?.name ?? ''] ?? 99
      const sB = SHIFT_ORDER[b.shift?.name ?? ''] ?? 99
      if (sA !== sB) return sA - sB
      return a.created_at.localeCompare(b.created_at)
    }),
    [filteredOrders]
  )

  // Options for each multi-select — computed from subset excluding that filter's own selection
  const materialOptions = useMemo(() => {
    const sub = applyClientFilters(serverOrders, filterMaterials, filterCycles, filterMachines, importerSearch, filterShiftIds, 'mat')
    const seen = new Map<string, string>()
    for (const o of sub)
      if (o.material_id && !seen.has(o.material_id))
        seen.set(o.material_id, o.material?.short_name ?? o.material?.material_description ?? o.material_id)
    return [...seen.entries()].map(([value, label]) => ({ value, label }))
  }, [serverOrders, filterCycles, filterMachines, importerSearch, filterShiftIds])

  const cycleOptions = useMemo(() => {
    const sub = applyClientFilters(serverOrders, filterMaterials, filterCycles, filterMachines, importerSearch, filterShiftIds, 'cycle')
    return [...new Set(sub.flatMap(o => o.cycles ?? []))].map(c => ({ value: c, label: c }))
  }, [serverOrders, filterMaterials, filterMachines, importerSearch, filterShiftIds])

  const machineOptions = useMemo(() => {
    const sub = applyClientFilters(serverOrders, filterMaterials, filterCycles, filterMachines, importerSearch, filterShiftIds, 'machine')
    return [...new Set(sub.flatMap(o => o.machine_codes ?? []))].map(m => ({ value: m, label: m }))
  }, [serverOrders, filterMaterials, filterCycles, importerSearch, filterShiftIds])

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
      ? format(parseISO(f.dateFrom), 'dd-MM-yyyy', { locale: vi })
      : `${format(parseISO(f.dateFrom), 'dd-MM-yyyy')} – ${format(parseISO(f.dateTo), 'dd-MM-yyyy')}`
  } else if (f.dateFrom) {
    dateLabel = `Từ ${format(parseISO(f.dateFrom), 'dd-MM-yyyy')}`
  } else if (f.dateTo) {
    dateLabel = `Đến ${format(parseISO(f.dateTo), 'dd-MM-yyyy')}`
  }

  const hasClientFilters = filterMaterials.length > 0 || filterCycles.length > 0 || filterMachines.length > 0 || !!importerSearch || filterShiftIds.length > 0

  const activeFilterCount = [
    hasDate, !!f.warehouseId, !!f.materialCategory, filterShiftIds.length > 0,
    filterMaterials.length > 0, filterCycles.length > 0, filterMachines.length > 0, !!importerSearch,
  ].filter(Boolean).length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2">
        {/* Row 1: Title + Search + Filter toggle + Create button */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700 shrink-0">Nhập kho</span>
          <SearchInput value={f.search} onChange={v => setInbound({ search: v })} placeholder="Tìm mã phiếu, hàng hóa…" className="flex-1 min-w-[100px]" />
          <button
            className={`flex items-center gap-1 h-7 px-2 rounded-md border text-xs font-medium transition-colors shrink-0 ${
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
          {can(perms, 'inbound', 'create') && (
            <Button size="sm" className="h-7 text-xs gap-1 shrink-0" onClick={() => setShowNew(true)}>
              <Plus className="h-3.5 w-3.5" /> Tạo phiếu
            </Button>
          )}
        </div>

        {/* Collapsible filter panel */}
        {showFilters && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 space-y-2">
            {/* Hàng 1: Ngày */}
            <div className="flex items-center gap-2 flex-wrap">
              <CalendarDays className="h-3.5 w-3.5 text-blue-400 shrink-0" />
              <DateBtn value={f.dateFrom} placeholder="Từ ngày" onChange={v => setInbound({ dateFrom: v })} />
              <span className="text-blue-300 text-xs">–</span>
              <DateBtn value={f.dateTo} placeholder="Đến ngày" onChange={v => setInbound({ dateTo: v })} />
              {!isToday && (
                <button className="text-xs text-blue-500 hover:text-blue-700 underline whitespace-nowrap"
                  onClick={() => setInbound({ dateFrom: TODAY, dateTo: TODAY })}>
                  Hôm nay
                </button>
              )}
              {hasDate && (
                <button className="p-0.5 rounded hover:bg-blue-100 text-blue-300 hover:text-blue-500"
                  onClick={() => setInbound({ dateFrom: '', dateTo: '' })}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Hàng 2: Kho / Loại / Ca */}
            <div className="flex gap-2 flex-wrap items-center">
              <Select value={f.warehouseId || '__all__'} onValueChange={v => setInbound({ warehouseId: v === '__all__' ? '' : v, filterMaterials: [], filterCycles: [], filterMachines: [] })}>
                <SelectTrigger className="h-7 text-xs w-[110px] bg-white">
                  <SelectValue placeholder="Tất cả kho" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Tất cả kho</SelectItem>
                  {(warehouses as { id: string; name: string }[])
                    .filter(w => !inboundAllowedWhIds || inboundAllowedWhIds.has(w.id))
                    .map(w => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>

              {/* Loại kho — dynamic từ API */}
              <Select value={f.materialCategory || '__all__'} onValueChange={v => setInbound({ materialCategory: v === '__all__' ? '' : v, filterMaterials: [], filterCycles: [], filterMachines: [] })}>
                <SelectTrigger className="h-7 text-xs w-[120px] bg-white">
                  <SelectValue placeholder="Loại kho" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Tất cả loại</SelectItem>
                  {(categories as string[])
                    .filter(c => !inboundAllowedCats || inboundAllowedCats.includes(c))
                    .map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                </SelectContent>
              </Select>

              {/* Ca — client-side multi-select */}
              <MultiSelectFilter
                label="Ca"
                options={shiftOptions}
                selected={filterShiftIds}
                onChange={v => setInbound({ filterShiftIds: v })}
                searchable={false}
              />
            </div>

            {/* Hàng 3: Material / Chu kỳ / Máy / Người nhập */}
            <div className="flex gap-2 flex-wrap items-center">
              <MultiSelectDropdown label="Material" options={materialOptions} searchable
                selected={filterMaterials} onChange={v => setInbound({ filterMaterials: v })} />
              <MultiSelectDropdown label="Chu kỳ" options={cycleOptions}
                selected={filterCycles} onChange={v => setInbound({ filterCycles: v })} />
              <MultiSelectDropdown label="Máy" options={machineOptions}
                selected={filterMachines} onChange={v => setInbound({ filterMachines: v })} />
              <div className="relative">
                <User className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input className="pl-6 h-7 text-xs w-[120px] bg-white" placeholder="Người nhập…"
                  value={importerSearch} onChange={e => setInbound({ importerSearch: e.target.value })} />
              </div>
              {hasClientFilters && (
                <button className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-600 px-1"
                  onClick={() => setInbound({ filterMaterials: [], filterCycles: [], filterMachines: [], filterShiftIds: [], importerSearch: '' })}>
                  <X className="h-3 w-3" /> Xóa lọc
                </button>
              )}
            </div>
          </div>
        )}

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
                    f.materialCategory || null,
                    filterShiftIds.length > 0 ? `Ca: ${filterShiftIds.map(id => (shifts as { id: string; name: string }[]).find(s => s.id === id)?.name ?? id).join(', ')}` : null,
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
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={5} cols={6} /></div>
        ) : filteredOrders.length === 0 ? (
          <EmptyState
            icon={PackagePlus}
            title="Chưa có phiếu nhập"
            description={hasClientFilters ? 'Không có kết quả phù hợp với bộ lọc' : hasDate ? 'Không có phiếu nhập trong khoảng thời gian đã chọn' : 'Tạo phiếu nhập kho để bắt đầu quét hàng vào kho.'}
            action={!hasClientFilters && can(perms, 'inbound', 'create') ? (
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
                  <TableRow>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Ngày nhập</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Vị trí</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Material</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Pallet</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Tổng nhập</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Người nhập</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Ca</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Ghi chú</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedOrders.map(order => (
                    <InboundRow
                      key={order.id}
                      order={order}
                      onClick={() => navigate(`/wms/inbound/${order.id}`)}
                      onScan={order.status === 'OPEN' && !!order.location_id && can(perms, 'inbound', 'scan')
                        ? (e) => { e.stopPropagation(); unlockAudio(); navigate(`/wms/inbound/${order.id}?scan=1`) }
                        : undefined}
                    />
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

function rowText(order: InboundOrder): string {
  const used = order.location_used_slots ?? 0
  const max  = order.location?.max_pallets ?? 0
  const full = max > 0 && used >= max
  const hasEntries = (order._count?.inventory_entries ?? 0) > 0
  if (full)        return 'text-[#4A90D9] hover:bg-slate-50'
  if (hasEntries)  return 'text-[#D8891C] hover:bg-slate-50'
  return 'hover:bg-slate-50'
}

function InboundRow({ order, onClick, onScan }: { order: InboundOrder; onClick: () => void; onScan?: (e: React.MouseEvent) => void }) {
  const dateFull = order.import_date ? format(parseISO(order.import_date), 'dd-MM-yy', { locale: vi }) : '—'
  const isRowToday = order.import_date?.slice(0, 10) === TODAY
  const importer = order.imported_by_emp?.name ?? order.created_by_emp?.name ?? '—'
  const matName  = order.material?.short_name ?? order.material?.material_description ?? '—'
  const matCode  = order.material?.material_code ?? ''
  const pallets  = order._count.inventory_entries

  return (
    <TableRow className={`cursor-pointer ${rowText(order)}`} onClick={onClick}>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-medium tabular-nums">{dateFull}</span>
        {isRowToday && <span className="ml-1 text-[9px] text-blue-600 font-medium">· Hôm nay</span>}
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <div className="flex items-center justify-between gap-1.5 min-w-[80px]">
          <span className="text-[10px] font-mono">{order.location?.location_code ?? '—'}</span>
          {onScan && (
            <button
              onClick={onScan}
              className="flex items-center gap-0.5 text-[9px] font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded px-1.5 py-0.5 transition-colors shrink-0"
              title="Thêm pallet"
            >
              <QrCode className="h-2.5 w-2.5" /> Quét
            </button>
          )}
        </div>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-medium">{matName}</span>
        {matCode && <span className="ml-1 text-[9px] text-slate-400 font-mono">{matCode}</span>}
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{pallets}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">pl</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{order.total_cartons ?? 0}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
      </TableCell>
      <TableCell className="px-2 py-1 max-w-[90px]">
        <span className="text-[10px] truncate block">{importer}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {order.shift
          ? <span className="text-[10px] font-medium">{order.shift.name}</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>
      <TableCell className="px-2 py-1">
        <span className="text-[10px]">{order.notes ?? '—'}</span>
      </TableCell>
    </TableRow>
  )
}
