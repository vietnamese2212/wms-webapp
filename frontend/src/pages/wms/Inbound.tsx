import React, { useEffect, useMemo, useRef, useState } from 'react'
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

type NccMatRow = {
  material_code: string; material_id: string
  mat_name: string; mat_unit: string
  unit_input: string; planned_qty: string
}
const emptyNccRow = (): NccMatRow => ({
  material_code: '', material_id: '', mat_name: '', mat_unit: '', unit_input: '', planned_qty: '',
})

function CreateOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate  = useNavigate()
  const user      = useAuthStore((s) => s.user)
  const canPickWarehouse = user?.warehouse_scope === 'NATIONAL' || !user?.warehouse_id
  const dialogAllowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids) : null

  const [sourceType,   setSourceType]   = useState<'FACTORY' | 'NCC'>('FACTORY')
  const [warehouseId,  setWarehouseId]  = useState('')
  const [subType,      setSubType]      = useState('')
  const [materialId,   setMaterialId]   = useState('')
  const [locationId,   setLocationId]   = useState('')
  const [shiftId,      setShiftId]      = useState('')
  const [importDate,   setImportDate]   = useState(format(new Date(), 'yyyy-MM-dd'))
  const [notes,        setNotes]        = useState('')
  const [gateRegId,    setGateRegId]    = useState('')
  // FACTORY combobox
  const [matSearch, setMatSearch] = useState('')
  const [matOpen,   setMatOpen]   = useState(false)
  const matRef = useRef<HTMLDivElement>(null)
  // NCC table
  const [nccRows,        setNccRows]        = useState<NccMatRow[]>([emptyNccRow()])
  const [nccSaving,      setNccSaving]      = useState(false)
  const [nccErr,         setNccErr]         = useState('')
  const [nccDropdownIdx, setNccDropdownIdx] = useState<number | null>(null)
  const [showMoreGates,  setShowMoreGates]  = useState(false)
  const [showGateDialog, setShowGateDialog] = useState(false)

  useEffect(() => {
    if (open) {
      setSourceType('FACTORY')
      setWarehouseId(user?.warehouse_id ?? user?.warehouse_ids?.[0] ?? '')
      setSubType(''); setMaterialId(''); setMatSearch(''); setMatOpen(false)
      setLocationId(''); setShiftId('')
      setImportDate(format(new Date(), 'yyyy-MM-dd'))
      setNotes(''); setGateRegId('')
      setNccRows([emptyNccRow()]); setNccSaving(false); setNccErr(''); setNccDropdownIdx(null)
      setShowMoreGates(false)
    }
  }, [open, user?.warehouse_id, user?.warehouse_ids])

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: shifts     = [] } = useImportShifts()

  const prevDay2 = importDate
    ? (() => { const d = new Date(importDate); d.setDate(d.getDate() - 2); return d.toISOString().slice(0, 10) })()
    : undefined
  const { data: activeGates = [] } = useActiveGateRegistrations(
    sourceType === 'NCC' && warehouseId && importDate
      ? showMoreGates
        ? { date_from: prevDay2, date_to: importDate, warehouse_id: warehouseId, warehouse_type: subType || undefined, direction: 'INBOUND', status: 'IN' }
        : { date: importDate, warehouse_id: warehouseId, warehouse_type: subType || undefined, direction: 'INBOUND', status: 'IN' }
      : undefined
  )
  const selectedGate    = (activeGates as any[]).find(g => g.id === gateRegId)
  const sortedGates = [...(activeGates as any[])].sort(
    (a, b) => a.date.localeCompare(b.date) || a.registration_number - b.registration_number
  )
  // Lần = vị trí trong ngày (reset mỗi ngày, không bị ảnh hưởng bởi bản ghi đã xóa)
  const gateLane: Map<string, number> = (() => {
    const dayCount = new Map<string, number>()
    const m = new Map<string, number>()
    for (const g of sortedGates) {
      const cnt = (dayCount.get(g.date) ?? 0) + 1
      dayCount.set(g.date, cnt)
      m.set(g.id, cnt)
    }
    return m
  })()
  const gateTmsOrderId: string | undefined = selectedGate?.tms_order_id ?? undefined
  const { data: planMaterials = [] } = useInboundPlanLines(
    sourceType === 'NCC' && warehouseId && importDate
      ? { date: importDate, warehouse_id: warehouseId, ...(gateTmsOrderId ? { tms_order_id: gateTmsOrderId } : {}) }
      : undefined
  )
  const { data: locations = [] } = useLocationsReal(warehouseId ? { warehouse_id: warehouseId } : undefined)
  const { data: zones     = [] } = useWarehouseZones(warehouseId || undefined)
  const allLocs = locations as LocationWithCapacity[]

  const { data: allWhTypes = [] } = useWarehouseTypes()
  const loaiKhoOpts = allWhTypes.map(t => t.value)
  const selectedZone = zones.find(z => z.name === subType)
  const filteredLocs = subType
    ? allLocs.filter(l => l.category === subType || (selectedZone && l.sub_code === selectedZone.code))
    : allLocs

  const matCategory = subType || undefined
  const { data: materials    = [] } = useMaterials({ search: matSearch || undefined, category: matCategory })
  const { data: allMaterials = [] } = useMaterials(undefined, sourceType === 'NCC')

  const { data: allEmployees = [] } = useEmployeeRecords({ is_active: 'true' })
  type EmpItem = { id: string; name: string; employee_code: string }
  const importedByEmpId = useMemo(
    () => (allEmployees as EmpItem[]).find(e => e.name.toLowerCase() === (user?.name ?? '').toLowerCase())?.id ?? '',
    [allEmployees, user?.name]
  )

  useEffect(() => {
    if (!open || warehouseId || !user?.warehouse_name || !warehouses.length) return
    const match = (warehouses as { id: string; name: string }[]).find(w => w.name === user.warehouse_name)
    if (match) setWarehouseId(match.id)
  }, [open, warehouses, user?.warehouse_name, warehouseId])

  useEffect(() => {
    if (!matOpen) return
    const handler = (e: MouseEvent) => {
      if (matRef.current && !matRef.current.contains(e.target as Node)) setMatOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [matOpen])

  const { mutate: createOrder, mutateAsync: createOrderAsync, isPending, error } = useCreateInboundOrder()

  // NCC helpers
  const nccMatByCode = useMemo(() =>
    new Map((allMaterials as any[]).map(m => [String(m.material_code).trim().toUpperCase(), m])),
    [allMaterials]
  )

  function lookupNccRow(code: string): NccMatRow {
    const found = nccMatByCode.get(code.trim().toUpperCase())
    return { material_code: code, material_id: found?.id ?? '', mat_name: found?.short_name ?? '', mat_unit: found?.unit ?? '', unit_input: found?.unit ?? '', planned_qty: '' }
  }

  function handleNccMatCodeChange(idx: number, code: string) {
    const found = nccMatByCode.get(code.trim().toUpperCase())
    setNccRows(prev => prev.map((r, i) => i !== idx ? r : {
      ...r, material_code: code,
      material_id: found?.id ?? '', mat_name: found?.short_name ?? '',
      mat_unit: found?.unit ?? '', unit_input: found ? (found.unit ?? '') : r.unit_input,
    }))
  }

  function handleNccMatCodePaste(idx: number, e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text')
    const lines = text.split(/[\n\r]+/).map(s => s.trim()).filter(Boolean)
    if (lines.length <= 1) return
    e.preventDefault()
    const newRows = lines.map(c => lookupNccRow(c))
    setNccRows(prev => {
      const before = prev.slice(0, idx)
      const after  = prev.slice(idx + 1).filter(r => r.material_code !== '')
      return [...before, ...newRows, ...after]
    })
    setNccDropdownIdx(null)
  }

  function selectNccMatFromDropdown(idx: number, m: any) {
    setNccRows(prev => prev.map((r, i) => i !== idx ? r : {
      ...r, material_code: m.material_code, material_id: m.id,
      mat_name: m.short_name ?? '', mat_unit: m.unit ?? '', unit_input: m.unit ?? '',
    }))
    setNccDropdownIdx(null)
  }

  function getNccDropdownMatches(code: string) {
    const list = allMaterials as any[]
    if (!code) return list.slice(0, 8)
    const q = code.toUpperCase()
    return list.filter(m =>
      String(m.material_code).toUpperCase().includes(q) ||
      String(m.short_name ?? '').toUpperCase().includes(q)
    ).slice(0, 8)
  }

  function setNccRowField(idx: number, field: 'unit_input' | 'planned_qty', val: string) {
    setNccRows(prev => prev.map((r, i) => i !== idx ? r : { ...r, [field]: val }))
  }

  function addNccRow()    { setNccRows(prev => [...prev, emptyNccRow()]) }
  function removeNccRow(idx: number) {
    setNccRows(prev => prev.length === 1 ? [emptyNccRow()] : prev.filter((_, i) => i !== idx))
  }
  function loadFromPlan() {
    setNccRows((planMaterials as any[]).map(m => ({
      material_code: m.material?.material_code ?? '', material_id: m.material_id ?? '',
      mat_name: m.material?.short_name ?? '', mat_unit: m.material?.unit ?? '',
      unit_input: m.material?.unit ?? '',
      planned_qty: m.planned_boxes != null ? String(m.planned_boxes) : '',
    })))
  }

  async function handleNccSubmit() {
    if (!warehouseId) { setNccErr('Vui lòng chọn Kho'); return }
    if (!subType)     { setNccErr('Vui lòng chọn Loại kho'); return }
    if (!gateRegId)   { setNccErr('Vui lòng chọn Xe đang vào cổng'); return }
    if (!shiftId)     { setNccErr('Vui lòng chọn Ca nhập'); return }
    if (!importDate)  { setNccErr('Vui lòng chọn Ngày nhập'); return }
    const validRows = nccRows.filter(r => r.material_id)
    if (!validRows.length) { setNccErr('Vui lòng nhập ít nhất 1 mã hàng hợp lệ'); return }
    setNccSaving(true); setNccErr('')
    try {
      await Promise.all(validRows.map(r => createOrderAsync({
        warehouse_id: warehouseId, material_id: r.material_id,
        shift_id: shiftId || undefined, import_date: importDate,
        notes: notes || undefined, imported_by: importedByEmpId || undefined,
        source_type: 'NCC', warehouse_type: subType || undefined,
        gate_registration_id: gateRegId || undefined,
        planned_cartons: r.planned_qty ? Number(r.planned_qty) : undefined,
      })))
      onClose()
    } catch (e) {
      const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message
      setNccErr(msg ?? 'Lỗi tạo phiếu')
    } finally {
      setNccSaving(false)
    }
  }

  const selectedMat   = (materials as MatItem[]).find(m => m.id === materialId)
  const matInputValue = matOpen
    ? matSearch
    : (selectedMat ? `${selectedMat.material_code} – ${selectedMat.short_name ?? selectedMat.material_description}` : matSearch)

  function handleFactorySubmit() {
    if (!warehouseId || !subType || !materialId || !locationId || !shiftId || !importDate) return
    createOrder(
      { warehouse_id: warehouseId, material_id: materialId, location_id: locationId || undefined,
        shift_id: shiftId || undefined, import_date: importDate, notes: notes || undefined,
        imported_by: importedByEmpId || undefined, source_type: 'FACTORY', warehouse_type: subType || undefined },
      { onSuccess: (data) => { onClose(); navigate(`/wms/inbound/${data.order.id}`) } }
    )
  }

  const apiError      = (error as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message
  const nccValidCount = nccRows.filter(r => r.material_id).length

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className={sourceType === 'NCC' ? 'max-w-2xl' : 'sm:max-w-lg'}>
        <DialogHeader>
          <DialogTitle>Tạo phiếu nhập kho</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1 max-h-[80vh] overflow-y-auto pr-0.5">
          {/* Tab toggle */}
          <div className="flex rounded-lg border overflow-hidden">
            {(['FACTORY', 'NCC'] as const).map(t => (
              <button key={t} type="button"
                onClick={() => { setSourceType(t); setGateRegId(''); setMaterialId(''); setMatSearch(''); setNccRows([emptyNccRow()]); setNccErr('') }}
                className={['flex-1 py-1.5 text-xs font-medium transition-colors',
                  sourceType === t ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'].join(' ')}>
                {t === 'FACTORY' ? 'Nhập Sản Xuất' : 'Nhập Ngoài (NCC)'}
              </button>
            ))}
          </div>

          {/* ─── FACTORY ─── */}
          {sourceType === 'FACTORY' && (<>
            {apiError && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{apiError}</div>}

            <div className="space-y-2">
              <Label>Kho <span className="text-red-500">*</span></Label>
              {canPickWarehouse ? (
                <Select value={warehouseId} onValueChange={v => { setWarehouseId(v); setSubType(''); setLocationId(''); setMaterialId(''); setMatSearch('') }}>
                  <SelectTrigger><SelectValue placeholder="Chọn kho" /></SelectTrigger>
                  <SelectContent>
                    {(warehouses as { id: string; name: string; code: string }[])
                      .filter(w => !dialogAllowedWhIds || dialogAllowedWhIds.has(w.id))
                      .map(w => <SelectItem key={w.id} value={w.id}>{w.name} ({w.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex h-10 items-center rounded-md border bg-slate-50 px-3 text-sm text-slate-700">
                  {(warehouses as { id: string; name: string }[]).find(w => w.id === warehouseId)?.name ?? (warehouseId || '—')}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Loại kho <span className="text-red-500">*</span></Label>
              <Select value={subType} onValueChange={v => { setSubType(v); setLocationId(''); setMaterialId(''); setMatSearch('') }} disabled={!warehouseId}>
                <SelectTrigger><SelectValue placeholder="Chọn loại kho" /></SelectTrigger>
                <SelectContent>{loaiKhoOpts.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Vị trí nhập <span className="text-red-500">*</span>
                <span className="ml-2 text-xs font-normal text-slate-400">đầy=xanh · một phần=cam</span>
              </Label>
              <Select value={locationId} onValueChange={setLocationId} disabled={!warehouseId}>
                <SelectTrigger><SelectValue placeholder={!warehouseId ? 'Chọn kho trước' : !subType ? 'Chọn loại kho trước' : 'Chọn vị trí'} /></SelectTrigger>
                <SelectContent>
                  {filteredLocs.map(l => {
                    const isFull = l.max_pallets > 0 && l.used_slots >= l.max_pallets
                    const isPartial = l.used_slots > 0 && !isFull
                    return (
                      <SelectItem key={l.id} value={l.id}>
                        <span className={isFull ? 'text-blue-700 font-semibold' : isPartial ? 'text-amber-600' : ''}>{l.location_code}</span>
                        <span className="ml-2 text-xs text-slate-400">({l.used_slots}/{l.max_pallets})</span>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Material <span className="text-red-500">*</span></Label>
              <div ref={matRef} className="relative">
                <Input placeholder={subType ? `Tìm hàng ${subType}…` : 'Tìm mã hoặc tên hàng...'}
                  value={matInputValue}
                  onChange={e => { setMatSearch(e.target.value); setMaterialId(''); setMatOpen(true) }}
                  onFocus={() => setMatOpen(true)}
                />
                {matOpen && (
                  <div className="absolute z-[100] w-full mt-1 max-h-52 overflow-y-auto rounded-md border bg-white shadow-lg">
                    {(materials as MatItem[]).map(m => (
                      <button key={m.id} type="button"
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 flex items-baseline gap-2 ${m.id === materialId ? 'bg-slate-50 font-medium' : ''}`}
                        onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
                        onClick={() => { setMaterialId(m.id); setMatSearch(''); setMatOpen(false) }}>
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Ca nhập <span className="text-red-500">*</span></Label>
                <Select value={shiftId} onValueChange={setShiftId}>
                  <SelectTrigger><SelectValue placeholder="Chọn ca" /></SelectTrigger>
                  <SelectContent>{(shifts as { id: string; name: string }[]).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Ngày nhập <span className="text-red-500">*</span></Label>
                <Input type="date" value={importDate} onChange={e => setImportDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Người nhập</Label>
              <div className="flex h-10 items-center rounded-md border bg-slate-50 px-3 text-sm text-slate-700 gap-2">
                <User className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="truncate">{user?.name ?? '—'}</span>
                {!importedByEmpId && <span className="ml-auto text-xs text-amber-500 shrink-0">chưa khớp nhân viên</span>}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Ghi chú</Label>
              <Input placeholder="Tuỳ chọn" value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          </>)}

          {/* ─── NCC ─── */}
          {sourceType === 'NCC' && (<>
            {/* Section 1: Thông tin chuyến xe */}
            <div className="border rounded-lg bg-slate-50 px-3 py-2.5 space-y-2">
              <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">Thông tin chuyến xe</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Kho *</Label>
                  {canPickWarehouse ? (
                    <Select value={warehouseId} onValueChange={v => { setWarehouseId(v); setSubType(''); setGateRegId(''); setNccRows([emptyNccRow()]) }}>
                      <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Chọn kho" /></SelectTrigger>
                      <SelectContent>
                        {(warehouses as any[]).filter(w => !dialogAllowedWhIds || dialogAllowedWhIds.has(w.id))
                          .map(w => <SelectItem key={w.id} value={w.id}>{w.code} – {w.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="h-8 flex items-center text-xs text-slate-700 border rounded-md bg-white px-2 mt-0.5">
                      {(warehouses as any[]).find(w => w.id === warehouseId)?.name ?? '—'}
                    </div>
                  )}
                </div>
                <div>
                  <Label className="text-xs">Loại kho *</Label>
                  <Select value={subType} onValueChange={v => { setSubType(v); setGateRegId(''); setNccRows([emptyNccRow()]) }} disabled={!warehouseId}>
                    <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Chọn loại kho" /></SelectTrigger>
                    <SelectContent>{loaiKhoOpts.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Xe đang vào cổng *</Label>
                  <button
                    type="button"
                    disabled={!warehouseId || !subType}
                    onClick={() => setShowGateDialog(true)}
                    className="mt-0.5 w-full h-8 flex items-center justify-between px-2 rounded-md border border-input bg-white text-xs hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {selectedGate ? (
                      <span className="truncate">
                        <span className="font-mono font-semibold">{selectedGate.license_plate ?? '—'}</span>
                        <span className="ml-1.5 text-slate-500">{selectedGate.company_name_raw ?? ''}</span>
                        <span className="ml-1.5 text-slate-400">· Lần {gateLane.get(selectedGate.id)}</span>
                        {selectedGate.date !== importDate && <span className="ml-1 text-amber-500">(đk {selectedGate.date?.slice(8)}/{selectedGate.date?.slice(5, 7)})</span>}
                      </span>
                    ) : (
                      <span className="text-slate-400">
                        {!warehouseId ? 'Chọn kho trước' : !subType ? 'Chọn loại kho' : activeGates.length === 0 ? 'Không có xe INBOUND' : 'Chọn xe...'}
                      </span>
                    )}
                    <ChevronDown className="h-3 w-3 text-slate-400 shrink-0 ml-1" />
                  </button>

                  {/* Dialog chọn xe cổng */}
                  <Dialog open={showGateDialog} onOpenChange={setShowGateDialog}>
                    <DialogContent className="max-w-md">
                      <DialogHeader className="pb-1">
                        <div className="flex items-center justify-between">
                          <DialogTitle className="text-sm">Chọn xe vào cổng</DialogTitle>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] text-slate-400">{sortedGates.length} xe</span>
                            <button type="button" onClick={() => setShowMoreGates(v => !v)}
                              className="text-[10px] text-slate-400 hover:text-blue-500 underline-offset-2 hover:underline">
                              {showMoreGates ? 'Chỉ hôm nay' : '+ 2 ngày trước'}
                            </button>
                          </div>
                        </div>
                      </DialogHeader>
                      <div className="space-y-1 max-h-[72vh] overflow-y-auto pr-0.5">
                        {sortedGates.length === 0 ? (
                          <div className="text-center text-xs text-slate-400 py-4">Không có xe INBOUND đang vào cổng</div>
                        ) : (
                          sortedGates.map(g => (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => { setGateRegId(g.id); setShowGateDialog(false) }}
                              className={`w-full text-left rounded border px-2 py-1 transition-colors ${
                                gateRegId === g.id
                                  ? 'border-blue-400 bg-blue-50'
                                  : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/40'
                              }`}
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-semibold text-[11px] text-slate-800">{g.license_plate ?? '—'}</span>
                                {g.company_name_raw && <span className="text-[10px] text-slate-500 truncate">{g.company_name_raw}</span>}
                                <span className="ml-auto text-[9px] text-slate-400 shrink-0">
                                  {g.date?.slice(8)}/{g.date?.slice(5, 7)} · Lần {gateLane.get(g.id)}
                                  {g.date !== importDate && <span className="ml-1 text-amber-500">(trước)</span>}
                                </span>
                              </div>
                              {(g.driver_name || g.content) && (
                                <div className="text-[9px] text-slate-400 truncate mt-0.5">
                                  {[g.driver_name, g.content].filter(Boolean).join(' · ')}
                                </div>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                      {gateRegId && (
                        <div className="pt-1 border-t">
                          <button type="button" onClick={() => { setGateRegId(''); setShowGateDialog(false) }}
                            className="text-[10px] text-red-400 hover:text-red-600">
                            Bỏ chọn xe
                          </button>
                        </div>
                      )}
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Ngày nhập *</Label>
                  <Input type="date" value={importDate} onChange={e => setImportDate(e.target.value)} className="h-8 text-xs mt-0.5" />
                </div>
                <div>
                  <Label className="text-xs">Ca nhập *</Label>
                  <Select value={shiftId} onValueChange={setShiftId}>
                    <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Chọn ca" /></SelectTrigger>
                    <SelectContent>{(shifts as { id: string; name: string }[]).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Người nhập</Label>
                  <div className="h-8 flex items-center text-xs text-slate-600 border rounded-md bg-white px-2 mt-0.5 gap-1.5">
                    <User className="h-3 w-3 text-slate-400 shrink-0" />
                    <span className="truncate">{user?.name ?? '—'}</span>
                  </div>
                </div>
              </div>
              <div>
                <Label className="text-xs">Ghi chú</Label>
                <Input placeholder="Tuỳ chọn" value={notes} onChange={e => setNotes(e.target.value)} className="h-8 text-xs mt-0.5" />
              </div>
            </div>

            {/* Section 2: Danh sách hàng hóa */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">Danh sách hàng hóa</p>
                {gateRegId && planMaterials.length > 0 && (
                  <button type="button" onClick={loadFromPlan}
                    className="text-[10px] text-blue-600 hover:text-blue-700 underline">
                    Nạp từ kế hoạch ({planMaterials.length} hàng)
                  </button>
                )}
              </div>
              <div className="border rounded-lg">
                <table className="min-w-full text-[10px]">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500 w-32">Mã hàng</th>
                      <th className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500">Tên hàng</th>
                      <th className="px-2 py-1.5 text-center text-[9px] font-medium text-slate-500 w-16">ĐVT</th>
                      <th className="px-2 py-1.5 text-right text-[9px] font-medium text-slate-500 w-20">SL dự kiến</th>
                      <th className="w-6"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {nccRows.map((row, idx) => {
                      const invalid     = row.material_code !== '' && !row.material_id
                      const unitMismatch = row.unit_input && row.mat_unit && row.unit_input !== row.mat_unit
                      const dropMatches = getNccDropdownMatches(row.material_code)
                      return (
                        <tr key={idx} className={invalid ? 'bg-red-50' : ''}>
                          <td className="px-1.5 py-1 relative">
                            <input type="text" value={row.material_code}
                              onChange={e => handleNccMatCodeChange(idx, e.target.value)}
                              onPaste={e => handleNccMatCodePaste(idx, e)}
                              onFocus={() => setNccDropdownIdx(idx)}
                              onBlur={() => setTimeout(() => setNccDropdownIdx(prev => prev === idx ? null : prev), 150)}
                              placeholder="Paste hoặc tìm mã"
                              className={`w-full h-7 px-1.5 text-[10px] font-mono border rounded focus:outline-none focus:ring-1 ${
                                invalid ? 'border-red-300 bg-red-50 focus:ring-red-400' : 'border-slate-200 bg-white focus:ring-blue-400'
                              }`}
                            />
                            {nccDropdownIdx === idx && !row.material_id && (
                              <div className="absolute left-0 top-full z-50 w-72 mt-0.5 border rounded-md bg-white shadow-lg max-h-40 overflow-y-auto">
                                {dropMatches.length === 0
                                  ? <p className="text-[10px] text-slate-400 px-2 py-2 text-center">Không tìm thấy</p>
                                  : dropMatches.map((m: any) => (
                                    <button key={m.id} type="button"
                                      onMouseDown={e => e.preventDefault()}
                                      onClick={() => selectNccMatFromDropdown(idx, m)}
                                      className="w-full text-left px-2 py-1.5 hover:bg-blue-50 flex items-center gap-2 border-b border-slate-50 last:border-0">
                                      <span className="text-[10px] font-mono text-slate-700 shrink-0">{m.material_code}</span>
                                      <span className="text-[10px] text-slate-500 truncate">{m.short_name}</span>
                                    </button>
                                  ))
                                }
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1">
                            {row.mat_name
                              ? <span className="text-[10px] text-slate-700">{row.mat_name}</span>
                              : invalid ? <span className="text-[9px] text-red-400">Không tìm thấy</span>
                              : <span className="text-[9px] text-slate-300">—</span>}
                          </td>
                          <td className="px-1.5 py-1">
                            <div className="relative">
                              <input type="text" value={row.unit_input}
                                onChange={e => setNccRowField(idx, 'unit_input', e.target.value)}
                                placeholder={row.mat_unit || '—'}
                                className={`w-full h-7 px-1.5 text-[10px] border rounded text-center focus:outline-none focus:ring-1 ${
                                  unitMismatch ? 'border-amber-300 bg-amber-50 focus:ring-amber-400' : 'border-slate-200 bg-white focus:ring-blue-400'
                                }`}
                              />
                              {unitMismatch && <span className="absolute -top-4 left-0 text-[8px] text-amber-500 whitespace-nowrap">KH: {row.mat_unit}</span>}
                            </div>
                          </td>
                          <td className="px-1.5 py-1">
                            <input type="number" min="0" value={row.planned_qty}
                              onChange={e => setNccRowField(idx, 'planned_qty', e.target.value)}
                              className="w-full h-7 px-1.5 text-[10px] border border-slate-200 rounded text-right bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          </td>
                          <td className="px-1 py-1 text-center">
                            <button type="button" onClick={() => removeNccRow(idx)}
                              className="text-slate-300 hover:text-red-500 transition-colors">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={addNccRow}
                className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors">
                <Plus className="h-3 w-3" /> Thêm dòng hàng
              </button>
            </div>

            {nccErr && <p className="text-xs text-red-500">{nccErr}</p>}
          </>)}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          {sourceType === 'FACTORY' ? (
            <Button onClick={handleFactorySubmit}
              disabled={!warehouseId || !subType || !materialId || !locationId || isPending}>
              {isPending ? 'Đang tạo...' : 'Tạo phiếu'}
            </Button>
          ) : (
            <Button onClick={handleNccSubmit} disabled={nccSaving || nccValidCount === 0}>
              {nccSaving ? 'Đang tạo...' : nccValidCount > 0 ? `Tạo ${nccValidCount} phiếu nhập` : 'Tạo phiếu'}
            </Button>
          )}
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
