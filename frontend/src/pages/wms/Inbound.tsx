import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, PackagePlus, X, ChevronDown, User, MapPin, QrCode, Pencil, Bookmark, Rows3, AlignJustify, ArrowRight, AlertTriangle } from 'lucide-react'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { useAuthStore }        from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useWmsFilterStore }  from '@/stores/wmsFilterStore'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { TableSkeleton }       from '@/components/shared/TableSkeleton'
import { EmptyState }          from '@/components/shared/EmptyState'
import { Button }              from '@/components/ui/button'
import { Input }               from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { FormSheet } from '@/components/shared/FormSheet'
import { Label }               from '@/components/ui/label'
import {
  useInboundOrders, useCreateInboundOrder,
  useWarehouses, useMaterials, useLocationsReal, useImportShifts,
  useEmployeeRecords, useWarehouseZones,
  useActiveGateRegistrations, useInboundPlanLines,
  useUpdateInboundOrder, useCancelInboundOrder, useTransportCompanies,
} from '@/api/hooks'
import { useScopedWhTypes } from '@/hooks/useUserScope'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SavedViews } from '@/components/shared/SavedViews'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { Badge } from '@/components/ui/badge'
import { rowText, statusText, type RowStatusKey } from '@/lib/rowStatus'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { InboundScanSheetById } from '@/components/wms/InboundScanSheet'
import type { InboundOrder } from '@/types'
import { unlockAudio } from '@/utils/audio'
import { useActiveInboundStore } from '@/stores/activeInboundStore'

const TODAY = new Date().toISOString().slice(0, 10)

interface LocationWithCapacity {
  id: string
  location_code: string
  sub_code: string
  sub_type: string | null
  category: string | null
  max_pallets: number
  used_slots: number
  has_same_material?: boolean
}

const normCatFe = (c: string) => c === 'TP' ? 'Thành phẩm' : c === 'BAO_BI' ? 'Bao bì' : c


// ─── Edit row type (used by CreateOrderDialog in edit mode) ──────────────

type EditRow = {
  id: string; material_id: string; materialCode: string; matName: string
  locationCode: string; palletCount: number
  planned_cartons: number | null; notes: string; toCancel: boolean
}

// ─── Create order dialog ─────────────────────────────────────

type MatItem = { id: string; material_code: string; short_name: string | null; material_description: string; supplier_shelf_life_overrides?: { transport_company_id: string; shelf_life_days: number }[] | null }

type NccMatRow = {
  material_code: string; material_id: string
  mat_name: string; mat_unit: string
  unit_input: string; planned_qty: string
}
const emptyNccRow = (): NccMatRow => ({
  material_code: '', material_id: '', mat_name: '', mat_unit: '', unit_input: '', planned_qty: '',
})

// Dòng danh sách hàng NCC — memo hóa để gõ ô nào chỉ render lại dòng đó
// (trước đây mỗi phím gõ re-render toàn bộ N dòng → form chậm khi paste nhiều dòng)
const NccRowItem = React.memo(function NccRowItem({
  row, idx, isDup, noType, dropdownOpen, planMatIds,
  onCodeChange, onCodePaste, onQtyPaste, onField, onRemove,
  onDropdownFocus, onDropdownBlur, onSelectMat, getMatches,
}: {
  row: NccMatRow; idx: number; isDup: boolean; noType: boolean; dropdownOpen: boolean
  planMatIds: Set<string>
  onCodeChange: (idx: number, code: string) => void
  onCodePaste: (idx: number, e: React.ClipboardEvent) => void
  onQtyPaste: (idx: number, e: React.ClipboardEvent) => void
  onField: (idx: number, field: 'unit_input' | 'planned_qty', val: string) => void
  onRemove: (idx: number) => void
  onDropdownFocus: (idx: number) => void
  onDropdownBlur: (idx: number) => void
  onSelectMat: (idx: number, m: MatItem) => void
  getMatches: (code: string) => MatItem[]
}) {
  const invalid      = row.material_code !== '' && !row.material_id
  const unitMismatch = row.unit_input && row.mat_unit && row.unit_input !== row.mat_unit
  return (
    <tr className={invalid ? 'bg-red-50' : isDup ? 'bg-amber-50' : ''}>
      <td className="px-1.5 py-1">
        <div className="relative">
          <input type="text" value={row.material_code}
            onChange={e => onCodeChange(idx, e.target.value)}
            onPaste={e => onCodePaste(idx, e)}
            onFocus={() => { if (!noType) onDropdownFocus(idx) }}
            onBlur={() => onDropdownBlur(idx)}
            disabled={noType}
            placeholder={noType ? 'Chọn loại kho trước' : 'Paste hoặc tìm mã'}
            className={`w-full h-7 px-1.5 text-[10px] font-mono border rounded focus:outline-none focus:ring-1 ${
              noType ? 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-200' :
              invalid ? 'border-red-300 bg-red-50 focus:ring-red-400' : 'border-slate-200 bg-white focus:ring-blue-400'
            }`}
          />
          {dropdownOpen && !row.material_id && (() => {
            const matches = getMatches(row.material_code ?? '')
            return (
              <div className="absolute bottom-full left-0 z-[100] w-72 border rounded-md bg-white shadow-lg max-h-44 overflow-y-auto mb-1">
                {matches.length === 0
                  ? <p className="text-[10px] text-slate-400 px-2 py-2 text-center">Không tìm thấy</p>
                  : matches.map(m => (
                    <button key={m.id} type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => onSelectMat(idx, m)}
                      className="w-full text-left px-2 py-1.5 hover:bg-blue-50 flex items-center gap-2 border-b border-slate-50 last:border-0"
                    >
                      {planMatIds.has(m.id)
                        ? <span className="text-[8px] bg-green-100 text-green-700 px-1 py-0.5 rounded shrink-0">KH</span>
                        : planMatIds.size > 0
                          ? <span className="text-[8px] text-slate-300 w-5 shrink-0" />
                          : null
                      }
                      <span className="text-[10px] font-mono text-slate-700 shrink-0">{m.material_code}</span>
                      <span className="text-[10px] text-slate-500 truncate">{m.short_name}</span>
                    </button>
                  ))
                }
              </div>
            )
          })()}
        </div>
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
            onChange={e => onField(idx, 'unit_input', e.target.value)}
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
          onChange={e => onField(idx, 'planned_qty', e.target.value)}
          onPaste={e => onQtyPaste(idx, e)}
          className="w-full h-7 px-1.5 text-[10px] border border-slate-200 rounded text-right bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </td>
      <td className="px-1 py-1 text-center">
        <button type="button" onClick={() => onRemove(idx)}
          className="text-slate-300 hover:text-red-500 transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  )
})

function CreateOrderDialog({ open, onClose, editGroup }: { open: boolean; onClose: () => void; editGroup?: InboundOrder[] | null }) {
  const navigate  = useNavigate()
  const user      = useAuthStore((s) => s.user)
  const canPickWarehouse = user?.warehouse_scope === 'NATIONAL' || !user?.warehouse_id
  const dialogAllowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids) : null

  const [sourceType,   setSourceType]   = useState<'FACTORY' | 'NCC'>('FACTORY')
  const [nccId,        setNccId]        = useState('')       // NCC chọn (bắt buộc khi Nhập NCC)
  const [showFactoryNcc, setShowFactoryNcc] = useState(false) // Nhập SX: bật chọn NCC (tùy chọn)
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
  const [gateSpecial,      setGateSpecial]      = useState(false)   // mặc định CHỈ xe đang trong cổng; tích để xem cả xe đã ra (3 ngày)
  const [showGateDialog,   setShowGateDialog]   = useState(false)
  const [gateSearch,       setGateSearch]       = useState('')      // tìm xe trong dialog chọn xe cổng

  useEffect(() => {
    if (open) {
      if (editGroup?.length) {
        const first = editGroup[0]
        setSourceType('NCC')
        setWarehouseId((first as any).warehouse_id ?? user?.warehouse_id ?? user?.warehouse_ids?.[0] ?? '')
        setSubType(first.warehouse_type ?? '')
        setGateRegId((first as any).gate_registration_id ?? '')
        setImportDate(((first as any).import_date ?? '').slice(0, 10) || format(new Date(), 'yyyy-MM-dd'))
        setShiftId((first as any).shift_id ?? '')
        setMaterialId(''); setMatSearch(''); setMatOpen(false); setLocationId('')
        setNotes('')
        setNccId((first as any).ncc_id ?? ''); setShowFactoryNcc(false)
        setNccRows([emptyNccRow()]); setNccSaving(false); setNccErr(''); setNccDropdownIdx(null)
        setGateSpecial(false)
        setEditRows(editGroup.map(o => ({
          id:              o.id,
          material_id:     o.material_id ?? '',
          materialCode:    o.material?.material_code ?? '',
          matName:         o.material?.short_name ?? '',
          locationCode:    (o as any).location?.location_code ?? '',
          palletCount:     o._count.inventory_entries,
          planned_cartons: (o as any).planned_cartons != null ? Number((o as any).planned_cartons) : null,
          notes:           (o as any).notes ?? '',
          toCancel:        false,
        })))
      } else {
        setSourceType('FACTORY')
        setWarehouseId(user?.warehouse_id ?? user?.warehouse_ids?.[0] ?? '')
        setSubType(''); setMaterialId(''); setMatSearch(''); setMatOpen(false)
        setLocationId(''); setShiftId('')
        setImportDate(format(new Date(), 'yyyy-MM-dd'))
        setNotes(''); setGateRegId('')
        setNccId(''); setShowFactoryNcc(false)
        setNccRows([emptyNccRow()]); setNccSaving(false); setNccErr(''); setNccDropdownIdx(null)
        setGateSpecial(false)
        setEditRows([])
      }
    }
  }, [open, user?.warehouse_id, user?.warehouse_ids]) // eslint-disable-line

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: shifts     = [] } = useImportShifts()
  const { data: allCompanies = [] } = useTransportCompanies(true)
  const nccList = (allCompanies as { id: string; name: string; type?: string }[]).filter(c => c.type === 'NCC')

  // Theo rule giống Xuất: luôn lấy gate INBOUND trong 3 ngày (không lọc status ở server),
  // lọc client: mặc định CHỈ xe đang trong cổng (status='IN', chưa ra); tích "Trường hợp đặc biệt" → hiện cả xe đã ra.
  const gateFrom3 = importDate
    ? (() => { const d = new Date(importDate); d.setDate(d.getDate() - 3); return d.toISOString().slice(0, 10) })()
    : undefined
  const { data: activeGates = [] } = useActiveGateRegistrations(
    sourceType === 'NCC' && warehouseId && importDate
      ? { date_from: gateFrom3, date_to: importDate, warehouse_id: warehouseId, warehouse_type: subType || undefined, direction: 'INBOUND' }
      : undefined
  )
  const selectedGate    = (activeGates as any[]).find(g => g.id === gateRegId)
  const editModeGateInfo = editGroup?.length && gateRegId
    ? (editGroup[0] as any).gate_registration
    : null
  const displayGate = selectedGate ?? (editModeGateInfo?.id === gateRegId ? editModeGateInfo : null)
  const gateQ = gateSearch.trim().toLowerCase()
  const sortedGates = [...(activeGates as any[])]
    .filter(g => g.entry_at)                                              // chỉ xe đã vào cổng
    .filter(g => gateSpecial ? true : g.status === 'IN')                  // mặc định: chưa ra
    .filter(g => !gateQ || [g.license_plate, g.company_name_raw, g.driver_name, g.content]
      .some(v => (v ?? '').toLowerCase().includes(gateQ)))                // tìm biển số / ĐVVT / tài xế / nội dung
    .sort((a, b) => b.date.localeCompare(a.date) || a.registration_number - b.registration_number)
  // Lần = lượt thứ mấy của CÙNG (kho · loại xe · ngày · biển số) — cùng một xe vào nhiều lượt thì Lần 1,2,3…
  // Tính trên TẤT CẢ chuyến đã vào cổng (không lọc theo "đặc biệt") để Lần ổn định, không nhảy số.
  const gateLane: Map<string, number> = (() => {
    const cnt = new Map<string, number>()
    const m = new Map<string, number>()
    const keyOf = (g: any) => `${g.date}|${g.warehouse_id ?? ''}|${g.vehicle_type ?? ''}|${g.license_plate ?? ''}`
    const all = (activeGates as any[]).filter(g => g.entry_at)
      .sort((a, b) => a.date.localeCompare(b.date) || a.registration_number - b.registration_number)
    for (const g of all) {
      const c = (cnt.get(keyOf(g)) ?? 0) + 1
      cnt.set(keyOf(g), c)
      m.set(g.id, c)
    }
    return m
  })()
  // Phát hiện gate đã bị chiếm bởi phiếu nhập khác
  const sevenDaysAgo = importDate
    ? (() => { const d = new Date(importDate); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10) })()
    : undefined
  const { data: recentOrders = [] } = useInboundOrders(
    sourceType === 'NCC' && warehouseId && importDate
      ? { warehouse_id: warehouseId, date_from: sevenDaysAgo, date_to: importDate }
      : undefined
  )
  const takenGateMap = new Map<string, string>()
  for (const o of recentOrders as any[]) {
    if (o.gate_registration_id) takenGateMap.set(o.gate_registration_id, o.import_code ?? '?')
  }

  const gateTmsOrderId: string | undefined = displayGate?.tms_order_id ?? undefined
  const { data: planMaterials = [] } = useInboundPlanLines(
    sourceType === 'NCC'
      ? gateTmsOrderId
        ? { tms_order_id: gateTmsOrderId }
        : warehouseId && importDate
          ? { date: importDate, warehouse_id: warehouseId }
          : undefined
      : undefined
  )
  const activePlanLines = useMemo(() =>
    (planMaterials as any[]).filter((m: any) =>
      m.status !== 'CANCELLED' && (!subType || !m.warehouse_type || m.warehouse_type === subType)
    ), [planMaterials, subType])
  const planMatIds = useMemo(() =>
    new Set(activePlanLines.map((m: any) => m.material_id).filter(Boolean) as string[]),
    [activePlanLines]
  )

  const { data: locations = [] } = useLocationsReal(warehouseId ? { warehouse_id: warehouseId, material_id: materialId || undefined } : undefined)
  const { data: zones     = [] } = useWarehouseZones(warehouseId || undefined)
  const allLocs = locations as LocationWithCapacity[]

  const { data: allWhTypes = [] } = useScopedWhTypes()
  const loaiKhoOpts = allWhTypes.map(t => t.value)
  const selectedZone = zones.find(z => z.name === subType)
  // Khuyến nghị vị trí (sau khi chọn Mã hàng): CHỈ vị trí còn chỗ + đang để dở đúng loại
  // hàng (gom pallet) → đánh dấu ★ + đẩy lên đầu. Còn trống / loại khác giữ thứ tự bình thường.
  const isRecommended = (l: LocationWithCapacity) =>
    materialId !== '' && !!l.has_same_material && !(l.max_pallets > 0 && l.used_slots >= l.max_pallets)
  const filteredLocs = useMemo(() => {
    const base = subType
      ? allLocs.filter(l => l.category === subType || (selectedZone && l.sub_code === selectedZone.code))
      : allLocs
    if (!materialId) return base
    // sort ổn định: vị trí khuyến nghị lên đầu, phần còn lại giữ nguyên thứ tự gốc
    return [...base].sort((a, b) => (isRecommended(b) ? 1 : 0) - (isRecommended(a) ? 1 : 0))
  }, [allLocs, subType, selectedZone, materialId])

  const { data: materials    = [] } = useMaterials({ search: matSearch || undefined, category: subType || undefined })
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
  const { mutateAsync: updateOrderAsync } = useUpdateInboundOrder()
  const { mutateAsync: cancelOrderAsync }  = useCancelInboundOrder()

  const [editRows, setEditRows] = useState<EditRow[]>([])

  // NCC helpers
  const nccMatByCode = useMemo(() =>
    new Map((allMaterials as any[]).map(m => [String(m.material_code).trim().toUpperCase(), m])),
    [allMaterials]
  )

  const filteredNccMats = useMemo(() =>
    (allMaterials as any[]).filter(m => !subType || m.category === subType),
    [allMaterials, subType]
  )

  const nccDuplicateCodes = useMemo(() => {
    const seen = new Map<string, number>()
    // Sửa nhóm: tính cả mã đang có trong nhóm (editRows chưa hủy) → thêm dòng mới trùng mã cũ cũng bị bắt
    for (const er of editRows) {
      if (!er.toCancel && er.materialCode) seen.set(er.materialCode, (seen.get(er.materialCode) ?? 0) + 1)
    }
    for (const r of nccRows) {
      if (r.material_code) seen.set(r.material_code, (seen.get(r.material_code) ?? 0) + 1)
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c))
  }, [nccRows, editRows])

  const lookupNccRow = useCallback((code: string): NccMatRow => {
    const found = nccMatByCode.get(code.trim().toUpperCase())
    const valid = found && (!subType || found.category === subType) ? found : null
    return { material_code: code, material_id: valid?.id ?? '', mat_name: valid?.short_name ?? '', mat_unit: valid?.unit ?? '', unit_input: valid?.unit ?? '', planned_qty: '' }
  }, [nccMatByCode, subType])

  const handleNccMatCodeChange = useCallback((idx: number, code: string) => {
    const found = nccMatByCode.get(code.trim().toUpperCase())
    const valid = found && (!subType || found.category === subType) ? found : null
    setNccRows(prev => prev.map((r, i) => i !== idx ? r : {
      ...r, material_code: code,
      material_id: valid?.id ?? '', mat_name: valid?.short_name ?? '',
      mat_unit: valid?.unit ?? '', unit_input: valid ? (valid.unit ?? '') : r.unit_input,
    }))
  }, [nccMatByCode, subType])

  const handleNccMatCodePaste = useCallback((idx: number, e: React.ClipboardEvent) => {
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
  }, [lookupNccRow])

  const selectNccMatFromDropdown = useCallback((idx: number, m: any) => {
    setNccRows(prev => prev.map((r, i) => i !== idx ? r : {
      ...r, material_code: m.material_code, material_id: m.id,
      mat_name: m.short_name ?? '', mat_unit: m.unit ?? '', unit_input: m.unit ?? '',
    }))
    setNccDropdownIdx(null)
  }, [])

  const getNccDropdownMatches = useCallback((code: string) => {
    const list = filteredNccMats
    let filtered: any[]
    if (!code) {
      filtered = list.slice(0, 12)
    } else {
      const q = code.toUpperCase()
      filtered = list.filter(m =>
        String(m.material_code).toUpperCase().includes(q) ||
        String(m.short_name ?? '').toUpperCase().includes(q)
      ).slice(0, 10)
    }
    if (planMatIds.size === 0) return filtered
    return [...filtered].sort((a, b) => (planMatIds.has(b.id) ? 1 : 0) - (planMatIds.has(a.id) ? 1 : 0))
  }, [filteredNccMats, planMatIds])

  // Paste cột SL dự kiến từ Excel: điền lần lượt xuống các dòng bắt đầu từ dòng đang dán
  // (mirror handleNccMatCodePaste — dán cột mã trước, dán cột SL sau)
  const handleNccQtyPaste = useCallback((idx: number, e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text')
    const lines = text.split(/[\n\r]+/).map(s => s.trim().replace(/\s/g, '').replace(',', '.')).filter(Boolean)
    if (lines.length <= 1) return
    e.preventDefault()
    setNccRows(prev => prev.map((r, i) =>
      i >= idx && i - idx < lines.length ? { ...r, planned_qty: lines[i - idx] } : r
    ))
  }, [])

  const handleNccDropdownFocus = useCallback((idx: number) => setNccDropdownIdx(idx), [])
  const handleNccDropdownBlur  = useCallback((idx: number) => {
    setTimeout(() => setNccDropdownIdx(prev => prev === idx ? null : prev), 150)
  }, [])

  const setNccRowField = useCallback((idx: number, field: 'unit_input' | 'planned_qty', val: string) => {
    setNccRows(prev => prev.map((r, i) => i !== idx ? r : { ...r, [field]: val }))
  }, [])

  function addNccRow()    { setNccRows(prev => [...prev, emptyNccRow()]) }
  const removeNccRow = useCallback((idx: number) => {
    setNccRows(prev => prev.length === 1 ? [emptyNccRow()] : prev.filter((_, i) => i !== idx))
  }, [])
  function loadFromPlan() {
    const existingIds = editGroup?.length
      ? new Set(editRows.map(r => r.material_id).filter(Boolean))
      : new Set<string>()
    setNccRows(activePlanLines
      .filter((m: any) => m.material_id && (!editGroup?.length || !existingIds.has(m.material_id)))
      .map((m: any) => {
        const fullMat = nccMatByCode.get((m.material?.material_code ?? '').trim().toUpperCase())
        const unit = fullMat?.unit ?? m.material?.unit ?? ''
        return {
          material_code: m.material?.material_code ?? '',
          material_id:   m.material_id ?? '',
          mat_name:      m.material?.short_name ?? '',
          mat_unit:      unit,
          unit_input:    unit,
          planned_qty:   m.planned_boxes != null ? String(m.planned_boxes) : '',
        }
      })
    )
  }

  async function handleNccSubmit() {
    if (editGroup?.length) {
      if (!warehouseId) { setNccErr('Vui lòng chọn Kho'); return }
      if (!shiftId)     { setNccErr('Vui lòng chọn Ca nhập'); return }
      if (!importDate)  { setNccErr('Vui lòng chọn Ngày nhập'); return }
      if (nccDuplicateCodes.size > 0) { setNccErr(`Mã hàng bị trùng (đã có trong nhóm): ${[...nccDuplicateCodes].join(', ')}`); return }
      setNccSaving(true); setNccErr('')
      try {
        await Promise.all(
          editRows.filter(r => !r.toCancel).map(r =>
            updateOrderAsync({ id: r.id, import_date: importDate, shift_id: shiftId,
              notes: r.notes, planned_cartons: r.planned_cartons ?? undefined })
          )
        )
        await Promise.all(
          editRows.filter(r => r.toCancel && r.palletCount === 0).map(r => cancelOrderAsync(r.id))
        )
        const validNew = nccRows.filter(r => r.material_id)
        if (validNew.length) {
          await Promise.all(validNew.map(r => createOrderAsync({
            warehouse_id: warehouseId, material_id: r.material_id,
            shift_id: shiftId || undefined, import_date: importDate,
            notes: notes || undefined, imported_by: importedByEmpId || undefined,
            source_type: 'NCC', warehouse_type: subType || undefined,
            gate_registration_id: gateRegId || undefined,
            planned_cartons: r.planned_qty ? Number(r.planned_qty) : undefined,
            ncc_id: nccId || undefined,
          })))
        }
        onClose()
      } catch (e) {
        const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message
        setNccErr(msg ?? 'Lỗi lưu nhóm phiếu')
      } finally {
        setNccSaving(false)
      }
      return
    }
    if (!warehouseId) { setNccErr('Vui lòng chọn Kho'); return }
    if (!subType)     { setNccErr('Vui lòng chọn Loại kho'); return }
    if (!gateRegId)   { setNccErr('Vui lòng chọn Xe đang vào cổng'); return }
    if (!shiftId)     { setNccErr('Vui lòng chọn Ca nhập'); return }
    if (!importDate)  { setNccErr('Vui lòng chọn Ngày nhập'); return }
    if (!nccId)       { setNccErr('Vui lòng chọn Nhà cung cấp (NCC)'); return }
    const validRows = nccRows.filter(r => r.material_id)
    if (!validRows.length) { setNccErr('Vui lòng nhập ít nhất 1 mã hàng hợp lệ'); return }
    const dupCodes = new Set<string>()
    const seenCodes = new Set<string>()
    for (const r of validRows) {
      if (seenCodes.has(r.material_code)) dupCodes.add(r.material_code)
      seenCodes.add(r.material_code)
    }
    if (dupCodes.size > 0) { setNccErr(`Mã hàng bị trùng: ${[...dupCodes].join(', ')}`); return }
    setNccSaving(true); setNccErr('')
    try {
      await Promise.all(validRows.map(r => createOrderAsync({
        warehouse_id: warehouseId, material_id: r.material_id,
        shift_id: shiftId || undefined, import_date: importDate,
        notes: notes || undefined, imported_by: importedByEmpId || undefined,
        source_type: 'NCC', warehouse_type: subType || undefined,
        gate_registration_id: gateRegId || undefined,
        planned_cartons: r.planned_qty ? Number(r.planned_qty) : undefined,
        ncc_id: nccId || undefined,
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
        imported_by: importedByEmpId || undefined, source_type: 'FACTORY', warehouse_type: subType || undefined,
        ncc_id: (showFactoryNcc && nccId) ? nccId : undefined },
      { onSuccess: (data) => { onClose(); navigate(`/wms/inbound/${data.order.id}`) } }
    )
  }

  const apiError      = (error as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message
  const nccValidCount = nccRows.filter(r => r.material_id).length

  return (
    <FormSheet
      open={open} onClose={onClose}
      title={editGroup?.length ? 'Sửa nhóm phiếu NCC' : 'Tạo phiếu nhập kho'}
      widthClass={sourceType === 'FACTORY' ? 'sm:max-w-lg' : 'sm:max-w-4xl'}
      footer={<>
        <Button variant="outline" onClick={onClose}>Huỷ</Button>
        {sourceType === 'FACTORY' ? (
          <Button onClick={handleFactorySubmit}
            disabled={!warehouseId || !subType || !materialId || !locationId || isPending}>
            {isPending ? 'Đang tạo...' : 'Tạo phiếu'}
          </Button>
        ) : editGroup?.length ? (
          <Button onClick={handleNccSubmit} disabled={nccSaving || nccDuplicateCodes.size > 0}>
            {nccSaving ? 'Đang lưu…' : 'Lưu nhóm'}
          </Button>
        ) : (
          <Button onClick={handleNccSubmit} disabled={nccSaving || nccValidCount === 0 || nccDuplicateCodes.size > 0}>
            {nccSaving ? 'Đang tạo...' : nccValidCount > 0 ? `Tạo ${nccValidCount} phiếu nhập` : 'Tạo phiếu'}
          </Button>
        )}
      </>}
    >

        <div className="space-y-3">
          {/* Tab toggle */}
          {!editGroup?.length && (
            <div className="flex rounded-lg border overflow-hidden">
              {(['FACTORY', 'NCC'] as const).map(t => (
                <button key={t} type="button"
                  onClick={() => { setSourceType(t); setGateRegId(''); setMaterialId(''); setMatSearch(''); setNccRows([emptyNccRow()]); setNccErr('') }}
                  className={['flex-1 py-1.5 text-xs font-medium transition-colors',
                    sourceType === t ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'].join(' ')}>
                  {t === 'FACTORY' ? 'Nhập SX' : 'Nhập NCC'}
                </button>
              ))}
            </div>
          )}

          {/* ─── FACTORY ─── */}
          {sourceType === 'FACTORY' && (<>
            {apiError && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{apiError}</div>}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Kho <span className="text-red-500">*</span></Label>
                {canPickWarehouse ? (
                  <WarehouseSingleSelect
                    warehouses={(warehouses as { id: string; code: string; name: string }[]).filter(w => !dialogAllowedWhIds || dialogAllowedWhIds.has(w.id))}
                    value={warehouseId}
                    onChange={v => { setWarehouseId(v); setSubType(''); setLocationId(''); setMaterialId(''); setMatSearch('') }}
                    placeholder="Chọn kho"
                    triggerClassName="h-8 mt-0.5"
                  />
                ) : (
                  <div className="flex h-8 items-center rounded-md border bg-white px-2 text-xs text-slate-700 mt-0.5">
                    {(warehouses as { id: string; name: string }[]).find(w => w.id === warehouseId)?.name ?? (warehouseId || '—')}
                  </div>
                )}
              </div>

              <div>
                <Label className="text-xs">Loại kho <span className="text-red-500">*</span></Label>
                <SingleSelect
                  options={loaiKhoOpts.map(v => ({ value: v, label: v }))}
                  value={subType}
                  onChange={v => { setSubType(v); setLocationId(''); setMaterialId(''); setMatSearch('') }}
                  placeholder="Chọn loại kho"
                  searchable={false}
                  disabled={!warehouseId}
                  triggerClassName="h-8 mt-0.5"
                />
              </div>

              {/* Chọn Mã hàng TRƯỚC → từ đó gợi ý vị trí phù hợp (full-width: search + tên dài) */}
              <div className="col-span-2">
                <Label className="text-xs">Material <span className="text-red-500">*</span></Label>
                <div ref={matRef} className="relative">
                  <Input placeholder={!subType ? 'Chọn loại kho trước' : `Tìm hàng ${subType}…`}
                    value={matInputValue}
                    disabled={!subType}
                    className="h-8 text-xs mt-0.5"
                    onChange={e => { setMatSearch(e.target.value); setMaterialId(''); setLocationId(''); setMatOpen(true) }}
                    onFocus={() => { if (subType) setMatOpen(true) }}
                  />
                  {matOpen && (
                    <div className="absolute z-[100] w-full mt-1 max-h-52 overflow-y-auto rounded-md border bg-white shadow-lg">
                      {(materials as any[]).filter(m => !m.no_qr_tracking).map(m => (
                        <button key={m.id} type="button"
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 flex items-baseline gap-2 ${m.id === materialId ? 'bg-slate-50 font-medium' : ''}`}
                          onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
                          onClick={() => { setMaterialId(m.id); setMatSearch(''); setMatOpen(false); setLocationId('') }}>
                          <span className="font-mono text-xs text-slate-500 shrink-0">{m.material_code}</span>
                          <span className="text-slate-800 truncate">{m.short_name ?? m.material_description}</span>
                        </button>
                      ))}
                      {(materials as any[]).filter(m => !m.no_qr_tracking).length === 0 && (
                        <div className="px-3 py-3 text-sm text-slate-400 text-center">Không tìm thấy hàng hóa</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="col-span-2">
                <Label className="text-xs">Vị trí nhập <span className="text-red-500">*</span>
                  <span className="ml-2 text-[10px] font-normal text-slate-400">★ = còn chỗ · đang để dở cùng loại hàng</span>
                </Label>
                <SingleSelect
                  value={locationId}
                  onChange={setLocationId}
                  disabled={!subType || !materialId}
                  searchPlaceholder="Tìm vị trí…"
                  triggerClassName="h-8 mt-0.5"
                  placeholder={!warehouseId ? 'Chọn kho trước' : !subType ? 'Chọn loại kho trước' : !materialId ? 'Chọn Mã hàng trước' : 'Chọn vị trí'}
                  options={filteredLocs.map(l => {
                    const isFull = l.max_pallets > 0 && l.used_slots >= l.max_pallets
                    const isPartial = l.used_slots > 0 && !isFull
                    const rec = isRecommended(l)
                    return {
                      value: l.id,
                      label: l.location_code,
                      node: (
                        <span className="flex-1 truncate text-[11px]">
                          {rec && <span className="text-amber-500 font-bold mr-1">★</span>}
                          <span className={isFull ? 'text-blue-700 font-semibold' : isPartial ? 'text-amber-600' : 'text-slate-700'}>{l.location_code}</span>
                          <span className="ml-2 text-[10px] text-slate-400">({l.used_slots}/{l.max_pallets}{l.has_same_material ? ' · đang để' : ''})</span>
                        </span>
                      ),
                    }
                  })}
                />
              </div>

              <div>
                <Label className="text-xs">Ca nhập <span className="text-red-500">*</span></Label>
                <SingleSelect
                  options={(shifts as { id: string; name: string }[]).map(s => ({ value: s.id, label: s.name }))}
                  value={shiftId}
                  onChange={setShiftId}
                  placeholder="Chọn ca"
                  searchable={false}
                  triggerClassName="h-8 mt-0.5"
                />
              </div>

              <div>
                <Label className="text-xs">Ngày nhập <span className="text-red-500">*</span></Label>
                <Input type="date" value={importDate} min={TODAY} className="h-8 text-xs mt-0.5" onChange={e => setImportDate(e.target.value)} />
              </div>

              <div>
                <Label className="text-xs">Người nhập</Label>
                <div className="flex h-8 items-center rounded-md border bg-white px-2 text-xs text-slate-600 gap-1.5 mt-0.5">
                  <User className="h-3 w-3 text-slate-400 shrink-0" />
                  <span className="truncate">{user?.name ?? '—'}</span>
                </div>
              </div>

              <div>
                <Label className="text-xs">Ghi chú</Label>
                <Input placeholder="Tuỳ chọn" value={notes} onChange={e => setNotes(e.target.value)} className="h-8 text-xs mt-0.5" />
              </div>

              {/* NCC tùy chọn — chỉ khi cần khai HSD ngoại lệ theo NCC cho hàng SX */}
              <div className="col-span-2">
                {!showFactoryNcc ? (
                  <button type="button" onClick={() => setShowFactoryNcc(true)}
                    className="text-[11px] text-sky-600 hover:text-sky-700 hover:underline">
                    + Thêm NCC (tùy chọn)
                  </button>
                ) : (
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Nhà cung cấp (NCC)</Label>
                      <button type="button" onClick={() => { setShowFactoryNcc(false); setNccId('') }}
                        className="text-[10px] text-red-400 hover:text-red-600">Bỏ</button>
                    </div>
                    <SingleSelect
                      options={nccList.map(c => {
                        const ms = selectedMat?.supplier_shelf_life_overrides?.filter(o => o.transport_company_id === c.id) ?? []
                        // 1 shelflife → hiện luôn; nhiều shelflife → chọn lô khi quét, ở đây chỉ chọn NCC
                        return { value: c.id, label: ms.length === 1 ? `${c.name} (${ms[0].shelf_life_days} ngày)` : c.name }
                      })}
                      value={nccId}
                      onChange={setNccId}
                      placeholder={nccList.length ? 'Chọn NCC' : 'Chưa có NCC — tạo ở Cài đặt TMS'}
                      searchable={nccList.length > 5}
                      disabled={nccList.length === 0}
                      triggerClassName="h-8 mt-0.5"
                    />
                  </div>
                )}
              </div>
            </div>
          </>)}

          {/* ─── NCC ─── */}
          {sourceType === 'NCC' && (<>
            {/* Section 1: Thông tin chuyến xe */}
            <div className="border rounded-lg bg-slate-50 px-3 py-2.5 space-y-2">
              <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">Thông tin chuyến xe</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Kho *</Label>
                  {canPickWarehouse ? (
                    <WarehouseSingleSelect
                      warehouses={(warehouses as any[]).filter(w => !dialogAllowedWhIds || dialogAllowedWhIds.has(w.id))}
                      value={warehouseId}
                      onChange={v => { setWarehouseId(v); setSubType(''); setGateRegId(''); setNccRows([emptyNccRow()]) }}
                      placeholder="Chọn kho"
                      triggerClassName="h-8 mt-0.5"
                    />
                  ) : (
                    <div className="h-8 flex items-center text-xs text-slate-700 border rounded-md bg-white px-2 mt-0.5">
                      {(warehouses as any[]).find(w => w.id === warehouseId)?.name ?? '—'}
                    </div>
                  )}
                </div>
                <div>
                  <Label className="text-xs">Loại kho *</Label>
                  <SingleSelect
                    options={loaiKhoOpts.map(v => ({ value: v, label: v }))}
                    value={subType}
                    onChange={v => { setSubType(v); setGateRegId(''); setNccRows([emptyNccRow()]) }}
                    placeholder="Chọn loại kho"
                    searchable={false}
                    disabled={!warehouseId}
                    triggerClassName="h-8 mt-0.5"
                  />
                </div>
                <div>
                  <Label className="text-xs">Xe đang vào cổng *</Label>
                  <button
                    type="button"
                    disabled={!warehouseId || !subType}
                    onClick={() => setShowGateDialog(true)}
                    className="mt-0.5 w-full h-8 flex items-center justify-between px-2 rounded-md border border-input bg-white text-xs hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {displayGate ? (
                      <span className="truncate">
                        <span className="font-mono font-semibold">{displayGate.license_plate ?? '—'}</span>
                        <span className="ml-1.5 text-slate-500">{displayGate.company_name_raw ?? ''}</span>
                        {gateLane.get(displayGate.id) && <span className="ml-1.5 text-slate-400">· Lần {gateLane.get(displayGate.id)}</span>}
                        {displayGate.date && displayGate.date !== importDate && <span className="ml-1 text-amber-500">(đk {displayGate.date?.slice(8)}/{displayGate.date?.slice(5, 7)})</span>}
                      </span>
                    ) : (
                      <span className="text-slate-400">
                        {!warehouseId ? 'Chọn kho trước' : !subType ? 'Chọn loại kho' : activeGates.length === 0 ? 'Không có xe INBOUND' : 'Chọn xe...'}
                      </span>
                    )}
                    <ChevronDown className="h-3 w-3 text-slate-400 shrink-0 ml-1" />
                  </button>

                  {/* Dialog chọn xe cổng */}
                  <Dialog open={showGateDialog} onOpenChange={v => { setShowGateDialog(v); if (v) setGateSearch('') }}>
                    <DialogContent className="max-w-md">
                      <DialogHeader className="pb-1">
                        <div className="flex items-center justify-between">
                          <DialogTitle className="text-sm">Chọn xe vào cổng</DialogTitle>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] text-slate-400">{sortedGates.length} xe</span>
                            <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer select-none">
                              <input type="checkbox" checked={gateSpecial}
                                onChange={e => setGateSpecial(e.target.checked)}
                                className="h-3 w-3 rounded accent-blue-600" />
                              <span>Trường hợp đặc biệt (xe đã ra · 3 ngày)</span>
                            </label>
                          </div>
                        </div>
                      </DialogHeader>
                      <Input autoFocus value={gateSearch} onChange={e => setGateSearch(e.target.value)}
                        placeholder="Tìm biển số, ĐVVT, tài xế…" className="h-8 text-xs" />
                      <div className="space-y-1 max-h-[64vh] overflow-y-auto pr-0.5">
                        {sortedGates.length === 0 ? (
                          <div className="text-center text-xs text-slate-400 py-4">
                            {gateQ ? 'Không có xe khớp từ khóa' : gateSpecial ? 'Không có xe INBOUND trong 3 ngày' : 'Không có xe INBOUND đang vào cổng — tích "Trường hợp đặc biệt" để xem xe đã ra'}
                          </div>
                        ) : (
                          sortedGates.map(g => {
                            const isTaken      = takenGateMap.has(g.id)
                            const takenCode    = takenGateMap.get(g.id)
                            const isDateBefore = importDate && g.date > importDate
                            const isDisabled   = !!isDateBefore || isTaken
                            return (
                            <button
                              key={g.id}
                              type="button"
                              disabled={isDisabled}
                              onClick={() => { setGateRegId(g.id); setShowGateDialog(false) }}
                              className={`w-full text-left rounded border px-2 py-1 transition-colors disabled:cursor-not-allowed ${
                                isDisabled
                                  ? 'border-slate-200 bg-slate-50 opacity-60'
                                  : gateRegId === g.id
                                    ? 'border-blue-400 bg-blue-50'
                                    : g.date !== importDate
                                      ? 'border-amber-200 bg-amber-50 hover:border-amber-300'
                                      : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/40'
                              }`}
                            >
                              <div className="flex items-center gap-1.5">
                                <span className={`font-mono font-semibold text-[11px] ${isDisabled ? 'text-slate-400' : 'text-slate-800'}`}>
                                  {g.license_plate ?? '—'}
                                </span>
                                {g.company_name_raw && <span className="text-[10px] text-slate-500 truncate">{g.company_name_raw}</span>}
                                {g.status !== 'IN' && <span className="text-[8px] px-1 py-0.5 rounded bg-slate-200 text-slate-500 shrink-0">đã ra</span>}
                                <span className="ml-auto text-[9px] text-slate-400 shrink-0">
                                  {g.date?.slice(8)}/{g.date?.slice(5, 7)} · Lần {gateLane.get(g.id)}
                                  {g.date !== importDate && !isDateBefore && <span className="ml-1 text-amber-500">(trước)</span>}
                                </span>
                              </div>
                              {isTaken && (
                                <div className="text-[9px] text-red-500 mt-0.5">Đã có phiếu nhập {takenCode} — lượt vào này không thể dùng lại</div>
                              )}
                              {isDateBefore && (
                                <div className="text-[9px] text-amber-600 mt-0.5">Đăng ký ({g.date}) sau ngày nhập — đổi ngày nhập trước</div>
                              )}
                              {!isDisabled && (g.driver_name || g.content) && (
                                <div className="text-[9px] text-slate-400 truncate mt-0.5">
                                  {[g.driver_name, g.content].filter(Boolean).join(' · ')}
                                </div>
                              )}
                            </button>
                            )
                          })
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
              <div>
                <Label className="text-xs">Nhà cung cấp (NCC) <span className="text-red-500">*</span></Label>
                <SingleSelect
                  options={nccList.map(c => ({ value: c.id, label: c.name }))}
                  value={nccId}
                  onChange={setNccId}
                  placeholder={nccList.length ? 'Chọn NCC' : 'Chưa có NCC — tạo ở Cài đặt TMS'}
                  searchable={nccList.length > 5}
                  disabled={nccList.length === 0}
                  triggerClassName="h-8 mt-0.5"
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Ngày nhập *</Label>
                  <Input type="date" value={importDate} min={editGroup?.length ? undefined : TODAY} onChange={e => {
                    setImportDate(e.target.value)
                    if (selectedGate && e.target.value < selectedGate.date) setGateRegId('')
                  }} className="h-8 text-xs mt-0.5" />
                </div>
                <div>
                  <Label className="text-xs">Ca nhập *</Label>
                  <SingleSelect
                    options={(shifts as { id: string; name: string }[]).map(s => ({ value: s.id, label: s.name }))}
                    value={shiftId}
                    onChange={setShiftId}
                    placeholder="Chọn ca"
                    searchable={false}
                    triggerClassName="h-8 mt-0.5"
                  />
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

            {/* Phiếu hiện có (edit mode) */}
            {editGroup?.length && editRows.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">
                  Phiếu hiện có ({editRows.length})
                </p>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="min-w-max text-[10px]">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500">Mã hàng</th>
                        <th className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500">Tên hàng</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-medium text-slate-500 w-14">Vị trí</th>
                        <th className="px-2 py-1.5 text-center text-[9px] font-medium text-slate-500 w-8">PL</th>
                        <th className="px-2 py-1.5 text-right text-[9px] font-medium text-slate-500 w-20">SL dự kiến</th>
                        <th className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500">Ghi chú</th>
                        <th className="w-6"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {editRows.map((row, idx) => (
                        <tr key={row.id} className={row.toCancel ? 'bg-red-50 opacity-60' : ''}>
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-1">
                              {planMatIds.has(row.material_id) && (
                                <span className="text-[8px] bg-green-100 text-green-700 px-1 py-0.5 rounded shrink-0">KH</span>
                              )}
                              <span className="font-mono font-semibold">{row.materialCode}</span>
                            </div>
                          </td>
                          <td className="px-2 py-1 text-slate-600 whitespace-nowrap">{row.matName || '—'}</td>
                          <td className="px-2 py-1 text-center font-mono text-slate-500">{row.locationCode || '—'}</td>
                          <td className="px-2 py-1 text-center tabular-nums font-semibold">{row.palletCount}</td>
                          <td className="px-1.5 py-1">
                            {!row.toCancel && (
                              <input type="number" min="0"
                                value={row.planned_cartons ?? ''}
                                onChange={e => setEditRows(prev => prev.map((r, i) => i !== idx ? r : {
                                  ...r, planned_cartons: e.target.value === '' ? null : Number(e.target.value)
                                }))}
                                className="w-full h-6 px-1.5 text-[10px] border border-slate-200 rounded text-right bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                                placeholder="—"
                              />
                            )}
                          </td>
                          <td className="px-1.5 py-1">
                            {row.toCancel
                              ? <span className="text-[9px] text-red-500 italic">Sẽ hủy</span>
                              : <input type="text" value={row.notes}
                                  onChange={e => setEditRows(prev => prev.map((r, i) => i !== idx ? r : { ...r, notes: e.target.value }))}
                                  className="w-full h-6 px-1.5 text-[10px] border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                                  placeholder="—" />}
                          </td>
                          <td className="px-1 py-1 text-center">
                            {row.palletCount === 0 ? (
                              <button type="button"
                                onClick={() => setEditRows(prev => prev.map((r, i) => i !== idx ? r : { ...r, toCancel: !r.toCancel }))}
                                className={row.toCancel ? 'text-slate-400 hover:text-slate-600' : 'text-slate-300 hover:text-red-500'}
                                title={row.toCancel ? 'Bỏ hủy' : 'Hủy dòng'}>
                                <X className="h-3.5 w-3.5" />
                              </button>
                            ) : <span className="block w-3.5" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Section 2: Danh sách hàng */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">{editGroup?.length ? 'Thêm hàng mới vào nhóm' : 'Danh sách hàng'}</p>
                {gateRegId && activePlanLines.length > 0 && (
                  <button type="button" onClick={loadFromPlan}
                    className="text-[10px] text-blue-600 hover:text-blue-700 underline">
                    Nạp từ kế hoạch ({activePlanLines.length} hàng)
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
                    {nccRows.map((row, idx) => (
                      <NccRowItem
                        key={idx}
                        row={row}
                        idx={idx}
                        isDup={row.material_code !== '' && nccDuplicateCodes.has(row.material_code)}
                        noType={!subType && !editGroup?.length}
                        dropdownOpen={nccDropdownIdx === idx}
                        planMatIds={planMatIds}
                        onCodeChange={handleNccMatCodeChange}
                        onCodePaste={handleNccMatCodePaste}
                        onQtyPaste={handleNccQtyPaste}
                        onField={setNccRowField}
                        onRemove={removeNccRow}
                        onDropdownFocus={handleNccDropdownFocus}
                        onDropdownBlur={handleNccDropdownBlur}
                        onSelectMat={selectNccMatFromDropdown}
                        getMatches={getNccDropdownMatches}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={addNccRow}
                className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors">
                <Plus className="h-3 w-3" /> Thêm dòng hàng
              </button>
              {nccDuplicateCodes.size > 0 && (
                <p className="text-[10px] text-red-600">Mã hàng bị trùng: {[...nccDuplicateCodes].join(', ')}</p>
              )}
            </div>

            {nccErr && <p className="text-xs text-red-500">{nccErr}</p>}

          </>)}
        </div>
    </FormSheet>
  )
}

// Ca sort order: Ca 1 → Ca 2 → Ca 3 → HC → unknown last
const SHIFT_ORDER: Record<string, number> = { 'Ca 1': 0, 'Ca 2': 1, 'Ca 3': 2, 'HC': 3 }

type BracketPos = 'first' | 'middle' | 'last' | 'only' | 'none'

// Khóa nhóm "cùng chuyến" để vẽ bracket nối phiếu: theo lệnh TMS (chuyển kho) HOẶC biển số xe (gate) cho NCC nhiều mã cùng chuyến.
export function inboundGroupKey(o: InboundOrder): string | null {
  const tms = (o as { tms_order?: { order_code?: string } }).tms_order?.order_code
  if (tms) return `tms:${tms}`
  const gate = (o as { gate_registration_id?: string | null }).gate_registration_id
  if (o.source_type === 'NCC' && gate) return `gate:${gate}`
  return null
}

// ─── Client-side cascade filter ───────────────────────────────

function applyClientFilters(
  orders: InboundOrder[],
  mats: string[], cycles: string[], machines: string[], importer: string, shiftIds: string[], sourceTypes: string[],
  exclude?: 'mat' | 'cycle' | 'machine' | 'importer' | 'shift' | 'source'
) {
  return orders.filter(order => {
    // TRANSFER không có ca/máy/cycle — skip các filter này để không bị ẩn nhầm
    const isTransfer = order.source_type === 'TRANSFER'
    const importerName = (order.imported_by_emp?.name ?? order.created_by_emp?.name ?? '').toLowerCase()
    if (exclude !== 'source'   && sourceTypes.length > 0 && !sourceTypes.includes(order.source_type ?? ''))                  return false
    if (exclude !== 'mat'      && mats.length     > 0 && !mats.includes(order.material_id ?? ''))                            return false
    if (!isTransfer && exclude !== 'cycle'   && cycles.length   > 0 && !(order.cycles ?? []).some(c => cycles.includes(c)))  return false
    if (!isTransfer && exclude !== 'machine' && machines.length > 0 && !(order.machine_codes ?? []).some(m => machines.includes(m))) return false
    if (exclude !== 'importer' && importer             && !importerName.includes(importer.toLowerCase()))                     return false
    if (!isTransfer && exclude !== 'shift'   && shiftIds.length > 0 && !shiftIds.includes(order.shift_id ?? ''))              return false
    return true
  })
}

// Cấu hình cột Inbound (thứ tự khớp với các <TableCell> trong InboundRow)
const INBOUND_COLS: { id: string; label: string; w: number; align?: 'right'; resize?: false }[] = [
  { id: 'pin',      label: '',            w: 34,  resize: false },
  { id: 'date',     label: 'Ngày nhập',   w: 104 },
  { id: 'loc',      label: 'Vị trí',      w: 84 },
  { id: 'ncc',      label: 'NCC',         w: 130 },
  { id: 'matcode',  label: 'Mã hàng',     w: 110 },
  { id: 'matname',  label: 'Tên hàng',    w: 150 },
  { id: 'actual',   label: 'Thực nhập',   w: 84,  align: 'right' },
  { id: 'plan',     label: 'Thùng KH',    w: 84,  align: 'right' },
  { id: 'progress', label: 'Tiến độ',     w: 78,  align: 'right' },
  { id: 'plate',    label: 'Biển số xe',  w: 110 },
  { id: 'do',       label: 'Số DO',       w: 110 },
  { id: 'code',     label: 'Mã phiếu',    w: 120 },
  { id: 'tms',      label: 'Mã lệnh',     w: 120 },
  { id: 'pallet',   label: 'Pallet',      w: 64,  align: 'right' },
  { id: 'imp',      label: 'Người nhập',  w: 104 },
  { id: 'shift',    label: 'Ca',          w: 64 },
  { id: 'note',     label: 'Ghi chú',     w: 120 },
  { id: 'status',   label: 'Trạng thái',  w: 92 },
]
const INBOUND_COL_DEFAULTS = INBOUND_COLS.map(c => c.w)

// Phát hiện desktop (lg+) để quyết định click row = chọn (hiện pane) hay điều hướng
function useIsDesktop() {
  const [d, setD] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const h = () => setD(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return d
}

// ─── Pane phải + Live Tiles (Manhattan Insight) ───
function InboundPane({ order, onClose, canScan }: { order: InboundOrder; onClose: () => void; canScan: boolean }) {
  const navigate = useNavigate()
  const matName = order.material?.short_name ?? order.material?.material_description ?? '—'
  const matCode = order.material?.material_code ?? ''
  const pallets = order._count.inventory_entries
  const cartons = order.total_cartons ?? 0
  const st = inboundStatus(order)
  return (
    <aside className="hidden lg:flex flex-col w-56 shrink-0 border-l border-slate-200 bg-slate-50">
      <div className="px-3 py-2 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between">
          <Badge variant={st.variant} className="px-1.5 py-0 text-[9px] font-medium">{st.label}</Badge>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" title="Đóng"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className={`mt-1 text-sm font-semibold leading-tight ${statusText(inboundKey(order))}`}>{matName}</div>
        {matCode && <div className="text-[11px] font-mono text-slate-400">{matCode}</div>}
        <div className="text-[11px] text-slate-500 mt-1">Vị trí: <span className="font-mono font-semibold text-slate-700">{order.location?.location_code ?? '—'}</span></div>
        {order.import_code && <div className="text-[11px] text-slate-500">Phiếu: <span className="font-mono font-semibold text-slate-700">{order.import_code}</span></div>}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-sky-600 text-white px-2 py-2.5 text-center">
            <div className="text-xl font-bold leading-none">{pallets}</div>
            <div className="text-[9px] mt-1 text-sky-100 uppercase tracking-wide">Pallet</div>
          </div>
          <div className="rounded-lg bg-sky-700 text-white px-2 py-2.5 text-center">
            <div className="text-xl font-bold leading-none tabular-nums">{cartons.toLocaleString()}</div>
            <div className="text-[9px] mt-1 text-sky-100 uppercase tracking-wide">Thực nhập</div>
          </div>
        </div>

        <button onClick={() => navigate(`/wms/inbound/${order.id}`)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-blue-300 hover:text-blue-600 transition-colors flex items-center justify-between">
          Mở chi tiết <ArrowRight className="h-3.5 w-3.5" />
        </button>

        {canScan && order.status === 'OPEN' && !!order.location_id && (
          <button onClick={() => { unlockAudio(); navigate(`/wms/inbound/${order.id}?scan=1`) }}
            className="w-full rounded-lg bg-blue-600 text-white px-3 py-2 text-xs font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-1.5">
            <QrCode className="h-3.5 w-3.5" /> Quét thêm pallet
          </button>
        )}
      </div>
    </aside>
  )
}

// ─── Main page ───────────────────────────────────────────────

export default function Inbound() {
  const navigate  = useNavigate()
  const user      = useAuthStore(s => s.user)
  const perms     = user?.module_permissions as ModulePermissions | null ?? null
  const { inbound: f, setInbound } = useWmsFilterStore()
  const { pin, unpin, isPinned } = useActiveInboundStore()
  const [showNew,      setShowNew]      = useState(false)
  const [locOpen,      setLocOpen]      = useState(false)
  const [dense,        setDense]        = useState(() => localStorage.getItem('inbound_density') !== 'comfortable')
  const [editNccGroup, setEditNccGroup] = useState<InboundOrder[] | null>(null)
  const [selectedId,   setSelectedId]   = useState<string | null>(null)
  const [scanOrderId,  setScanOrderId]  = useState<string | null>(null)
  const isDesktop = useIsDesktop()
  const { widths: colW, startResize, totalWidth } = useColumnResize('inbound_col_widths', INBOUND_COL_DEFAULTS)

  function toggleDensity() {
    setDense(d => { localStorage.setItem('inbound_density', d ? 'comfortable' : 'compact'); return !d })
  }

  const { data: shifts     = [] } = useImportShifts()
  const { data: warehouses = [] } = useWarehouses(true)
  const { data: whTypes = [] } = useScopedWhTypes()
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
  const filterSourceTypes = f.filterSourceTypes ?? []
  const importerSearch  = f.importerSearch  ?? ''

  // Cascade-filtered orders
  const filteredOrders = useMemo(
    () => applyClientFilters(serverOrders, filterMaterials, filterCycles, filterMachines, importerSearch, filterShiftIds, filterSourceTypes),
    [serverOrders, filterMaterials, filterCycles, filterMachines, importerSearch, filterShiftIds, filterSourceTypes]
  )

  // Shift options for multi-select (from master data, not derived from orders)
  const shiftOptions = useMemo(() =>
    (shifts as { id: string; name: string }[]).map(s => ({ value: s.id, label: s.name })),
    [shifts]
  )

  // Sort: ngày desc → nhóm theo chuyến (lệnh TMS hoặc xe NCC) → ca asc → giờ tạo asc
  const sortedOrders = useMemo(() =>
    [...filteredOrders].sort((a, b) => {
      const dateA = a.import_date ?? ''
      const dateB = b.import_date ?? ''
      if (dateA !== dateB) return dateB.localeCompare(dateA)
      // Nhóm theo chuyến trong cùng ngày (phiếu có nhóm xếp trước, sắp theo khóa nhóm)
      const keyA = inboundGroupKey(a) ?? ''
      const keyB = inboundGroupKey(b) ?? ''
      if (keyA !== keyB) {
        if (!keyA && keyB) return 1
        if (keyA && !keyB) return -1
        return keyA.localeCompare(keyB)
      }
      const sA = SHIFT_ORDER[a.shift?.name ?? ''] ?? 99
      const sB = SHIFT_ORDER[b.shift?.name ?? ''] ?? 99
      if (sA !== sB) return sA - sB
      return a.created_at.localeCompare(b.created_at)
    }),
    [filteredOrders]
  )

  // Tính vị trí bracket cho mỗi row trong nhóm "cùng chuyến" (lệnh TMS hoặc xe NCC)
  const bracketPositions = useMemo(() => {
    const pos = new Map<string, BracketPos>()
    const n = sortedOrders.length
    for (let i = 0; i < n; i++) {
      const o = sortedOrders[i]
      const key = inboundGroupKey(o)
      if (!key) { pos.set(o.id, 'none'); continue }
      const prevOk = i > 0 && sortedOrders[i - 1].import_date === o.import_date && inboundGroupKey(sortedOrders[i - 1]) === key
      const nextOk = i < n - 1 && sortedOrders[i + 1].import_date === o.import_date && inboundGroupKey(sortedOrders[i + 1]) === key
      if (!prevOk && !nextOk) pos.set(o.id, 'only')
      else if (!prevOk) pos.set(o.id, 'first')
      else if (!nextOk) pos.set(o.id, 'last')
      else pos.set(o.id, 'middle')
    }
    return pos
  }, [sortedOrders])

  function openEditNccGroup(order: InboundOrder) {
    // Nhóm sửa PHẢI khớp đúng nhóm bracket hiển thị (cùng inboundGroupKey = cùng chuyến/cổng).
    // Phiếu NCC chưa gắn xe → key null → chỉ chính nó, KHÔNG gom theo ngày+kho (tránh kéo nhầm phiếu khác chuyến vào).
    const key = inboundGroupKey(order)
    const group = key
      ? sortedOrders.filter(o => o.source_type === 'NCC' && inboundGroupKey(o) === key)
      : [order]
    setEditNccGroup(group.length > 0 ? group : [order])
  }

  // Options for each multi-select — computed from subset excluding that filter's own selection
  const materialOptions = useMemo(() => {
    const sub = applyClientFilters(serverOrders, filterMaterials, filterCycles, filterMachines, importerSearch, filterShiftIds, filterSourceTypes, 'mat')
    const seen = new Map<string, string>()
    for (const o of sub)
      if (o.material_id && !seen.has(o.material_id))
        seen.set(o.material_id, o.material?.short_name ?? o.material?.material_description ?? o.material_id)
    return [...seen.entries()].map(([value, label]) => ({ value, label }))
  }, [serverOrders, filterCycles, filterMachines, importerSearch, filterShiftIds, filterSourceTypes])

  const cycleOptions = useMemo(() => {
    const sub = applyClientFilters(serverOrders, filterMaterials, filterCycles, filterMachines, importerSearch, filterShiftIds, filterSourceTypes, 'cycle')
    return [...new Set(sub.flatMap(o => o.cycles ?? []))].map(c => ({ value: c, label: c }))
  }, [serverOrders, filterMaterials, filterMachines, importerSearch, filterShiftIds, filterSourceTypes])

  const machineOptions = useMemo(() => {
    const sub = applyClientFilters(serverOrders, filterMaterials, filterCycles, filterMachines, importerSearch, filterShiftIds, filterSourceTypes, 'machine')
    return [...new Set(sub.flatMap(o => o.machine_codes ?? []))].map(m => ({ value: m, label: m }))
  }, [serverOrders, filterMaterials, filterCycles, importerSearch, filterShiftIds, filterSourceTypes])

  // Totals
  const totalPallets = useMemo(() => filteredOrders.reduce((s, o) => s + o._count.inventory_entries, 0), [filteredOrders])
  const totalCartons = useMemo(() => filteredOrders.reduce((s, o) => s + (o.total_cartons ?? 0), 0), [filteredOrders])
  const srcCounts = useMemo(() => {
    let sx = 0, ncc = 0, tf = 0
    for (const o of filteredOrders) {
      if (o.source_type === 'NCC') ncc++
      else if (o.source_type === 'TRANSFER') tf++
      else sx++
    }
    return { sx, ncc, tf }
  }, [filteredOrders])

  // Location summary — aggregate theo vị trí thực tế của từng pallet (entries_by_location)
  // không dùng order.location vì user có thể đổi vị trí phiếu sau khi đã quét
  const locationSummary = useMemo(() => {
    const map = new Map<string, { loc: string; pallets: number; cartons: number }>()
    for (const order of filteredOrders) {
      const byLoc = order.entries_by_location
      if (byLoc && byLoc.length > 0) {
        for (const { loc, pallets, cartons } of byLoc) {
          const cur = map.get(loc) ?? { loc, pallets: 0, cartons: 0 }
          cur.pallets += pallets
          cur.cartons += cartons
          map.set(loc, cur)
        }
      } else if (order._count.inventory_entries > 0) {
        // Fallback khi entries_by_location chưa có (dữ liệu cũ)
        const loc = order.location
          ? `${order.location.location_code}-${order.location.sub_code}`
          : '(chưa xác định)'
        const cur = map.get(loc) ?? { loc, pallets: 0, cartons: 0 }
        cur.pallets += order._count.inventory_entries
        cur.cartons += order.total_cartons ?? 0
        map.set(loc, cur)
      }
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

  const hasClientFilters = filterMaterials.length > 0 || filterCycles.length > 0 || filterMachines.length > 0 || !!importerSearch || filterShiftIds.length > 0 || filterSourceTypes.length > 0

  // ─── Filter chip bar (kiểu Manhattan Active WMS) ───
  const warehouseOptions = useMemo(() =>
    (warehouses as { id: string; name: string }[])
      .filter(w => !inboundAllowedWhIds || inboundAllowedWhIds.has(w.id))
      .map(w => ({ value: w.id, label: w.name })),
    [warehouses, inboundAllowedWhIds])
  const categoryOptions = (categories as string[])
    .filter(c => !inboundAllowedCats || inboundAllowedCats.includes(c))
    .map(c => ({ value: c, label: c }))

  const filterDefs: FilterDef[] = [
    { key: 'date',     label: 'Ngày',       type: 'daterange', from: f.dateFrom, to: f.dateTo,
      onChange: (from, to) => setInbound({ dateFrom: from, dateTo: to }) },
    { key: 'warehouse', label: 'Kho',       type: 'single', options: warehouseOptions, value: f.warehouseId || '', allLabel: 'Tất cả kho',
      onChange: v => setInbound({ warehouseId: v, filterMaterials: [], filterCycles: [], filterMachines: [] }) },
    { key: 'category', label: 'Loại kho',   type: 'single', options: categoryOptions, value: f.materialCategory || '', allLabel: 'Tất cả loại',
      onChange: v => setInbound({ materialCategory: v, filterMaterials: [], filterCycles: [], filterMachines: [] }) },
    { key: 'source',   label: 'Nguồn gốc',  type: 'multi', searchable: false, selected: filterSourceTypes,
      options: [{ value: 'FACTORY', label: 'SX' }, { value: 'NCC', label: 'NCC' }, { value: 'TRANSFER', label: 'TF' }],
      onChange: v => setInbound({ filterSourceTypes: v }) },
    { key: 'shift',    label: 'Ca',         type: 'multi', options: shiftOptions,    selected: filterShiftIds, searchable: false,
      onChange: v => setInbound({ filterShiftIds: v }) },
    { key: 'material', label: 'Material',   type: 'multi', options: materialOptions, selected: filterMaterials, searchable: true,
      onChange: v => setInbound({ filterMaterials: v }) },
    { key: 'cycle',    label: 'Chu kỳ',     type: 'multi', options: cycleOptions,    selected: filterCycles,
      onChange: v => setInbound({ filterCycles: v }) },
    { key: 'machine',  label: 'Máy',        type: 'multi', options: machineOptions,  selected: filterMachines,
      onChange: v => setInbound({ filterMachines: v }) },
    { key: 'importer', label: 'Người nhập', type: 'text',  value: importerSearch, placeholder: 'Tên người nhập…',
      onChange: v => setInbound({ importerSearch: v }) },
  ]

  // ─── Saved Views ───
  const viewSnapshot = {
    search: f.search, dateFrom: f.dateFrom, dateTo: f.dateTo, filterShiftIds, filterSourceTypes,
    warehouseId: f.warehouseId, materialCategory: f.materialCategory,
    filterMaterials, filterCycles, filterMachines, importerSearch,
  }
  const savedViews = useSavedViewsStore(s => s.views['inbound'] ?? [])
  const activeViewId = useMemo(() => {
    const cur = JSON.stringify(viewSnapshot)
    return savedViews.find(v => JSON.stringify(v.filters) === cur)?.id ?? null
  }, [savedViews, viewSnapshot])

  const selectedOrder = selectedId ? (sortedOrders.find(o => o.id === selectedId) ?? null) : null

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Header */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2 sm:rounded-t-xl">
        {/* Row 1: Title + Search + Views + Density + Create */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 shrink-0">Nhập kho</span>
          <SearchInput value={f.search} onChange={v => setInbound({ search: v })} placeholder="Tìm mã phiếu, hàng hóa…" className="flex-1 min-w-[140px]" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          <SavedViews
            module="inbound"
            currentFilters={viewSnapshot}
            activeId={activeViewId}
            onApply={(filters) => setInbound(filters as Partial<typeof f>)}
          />
          <button type="button" onClick={toggleDensity}
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
            title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
            {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
          {can(perms, 'inbound', 'create') && (
            <Button size="sm" className="h-7 text-xs gap-1 shrink-0" onClick={() => setShowNew(true)}>
              <Plus className="h-3.5 w-3.5" /> Tạo phiếu
            </Button>
          )}
        </div>

        {/* Row 2: Filter chip bar (desktop) — mobile dùng nút Lọc ở hàng trên */}
        <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
          <FilterBar defs={filterDefs} />
          {!isToday && (
            <button className="inline-flex h-7 px-2 text-[11px] text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap"
              onClick={() => setInbound({ dateFrom: TODAY, dateTo: TODAY })}>
              Hôm nay
            </button>
          )}
        </div>

        {/* Bối cảnh ngày (số liệu tổng đã đưa vào SummaryBand bên dưới) */}
        <p className="text-xs text-slate-500 -mt-1">
          {hasDate ? (
            <>
              <span className="font-medium text-slate-700">{dateLabel}</span>
              {isToday && <span className="ml-1.5 text-blue-600 font-medium">· Hôm nay</span>}
            </>
          ) : (
            <span className="italic">Hiển thị tất cả ngày</span>
          )}
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

      {/* Dải tile tổng hợp (Manhattan Insight) */}
      <SummaryBand tiles={[
        { label: 'Phiếu nhập', value: filteredOrders.length },
        { label: 'SX',         value: srcCounts.sx },
        { label: 'NCC',        value: srcCounts.ncc },
        { label: 'TF',         value: srcCounts.tf },
        { label: 'Pallet',     value: totalPallets },
        { label: 'Thực nhập',  value: totalCartons.toLocaleString() },
        { label: 'Hoàn thành', value: filteredOrders.filter(o => o.status === 'COMPLETED').length },
      ]} />

      {/* Scrollable content + Pane (Manhattan Insight) */}
      <div className="flex flex-1 min-h-0">
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
            {/* Orders table — cột kéo giãn được (colgroup + table-fixed), scroll ngang ở đáy */}
            <Table className="table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100" style={{ width: totalWidth, minWidth: '100%' }}>
                <colgroup>
                  {colW.map((w, i) => <col key={i} style={{ width: w }} />)}
                </colgroup>
                <TableHeader>
                  <TableRow>
                    {INBOUND_COLS.map((c, i) => (
                      <TableHead key={c.id}
                        className={`text-[9px] font-medium text-slate-500 py-1.5 whitespace-nowrap ${i === 0 ? 'px-0' : 'px-2'} ${c.align === 'right' ? 'text-right' : ''} ${c.id === 'date' ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                        {c.label}
                        {c.resize !== false && i > 0 && (
                          <span
                            onPointerDown={e => startResize(i, e)}
                            onClick={e => e.stopPropagation()}
                            className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70"
                            title="Kéo để chỉnh độ rộng cột"
                          />
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedOrders.flatMap((order, i) => {
                    const bpos     = bracketPositions.get(order.id) ?? 'none'
                    const prevBpos = i > 0 ? (bracketPositions.get(sortedOrders[i - 1].id) ?? 'none') : 'none'
                    // Hàng trống ~10px ngăn cách giữa các nhóm (không border, không nền) — như margin giữa 2 card
                    const spacerBefore = bpos === 'first' && i > 0 && prevBpos !== 'last'
                    const spacerAfter  = bpos === 'last'
                    const nodes: React.ReactNode[] = []
                    if (spacerBefore) nodes.push(<tr key={`sp-b-${order.id}`} aria-hidden><td colSpan={INBOUND_COLS.length} className="p-0 border-0 bg-transparent"><div className="h-2.5" /></td></tr>)
                    nodes.push(
                      <InboundRow
                        key={order.id}
                        order={order}
                        dense={dense}
                        selected={order.id === selectedId}
                        onClick={() => { if (isDesktop) setSelectedId(order.id); else navigate(`/wms/inbound/${order.id}`) }}
                        onDoubleClick={() => navigate(`/wms/inbound/${order.id}`)}
                        onScan={order.status === 'OPEN' && !!order.location_id && can(perms, 'inbound', 'scan')
                          ? (e) => { e.stopPropagation(); unlockAudio(); setScanOrderId(order.id) }
                          : undefined}
                        onEditGroup={order.source_type === 'NCC' && order.status === 'OPEN' && can(perms, 'inbound', 'edit')
                          ? (e) => { e.stopPropagation(); openEditNccGroup(order) }
                          : undefined}
                        pinned={isPinned(order.id)}
                        onPin={(e) => {
                          e.stopPropagation()
                          isPinned(order.id)
                            ? unpin(order.id)
                            : pin({ id: order.id, import_code: order.import_code ?? order.id.slice(0, 8), status: order.status, location_code: order.location?.location_code, mat_code: order.material?.material_code })
                        }}
                        bracketPos={bpos}
                      />
                    )
                    if (spacerAfter) nodes.push(<tr key={`sp-a-${order.id}`} aria-hidden><td colSpan={INBOUND_COLS.length} className="p-0 border-0 bg-transparent"><div className="h-2.5" /></td></tr>)
                    return nodes
                  })}
                </TableBody>
              </Table>
          </>
        )}
       </div>
       {selectedOrder && (
         <InboundPane order={selectedOrder} onClose={() => setSelectedId(null)} canScan={can(perms, 'inbound', 'scan')} />
       )}
      </div>

      {/* Footer đếm bản ghi (Manhattan) */}
      {!isLoading && filteredOrders.length > 0 && (
        <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 flex items-center justify-between">
          <span>1–{filteredOrders.length} / {filteredOrders.length} phiếu</span>
          <span className="text-slate-400">{totalPallets} pallet · {totalCartons.toLocaleString()} thùng</span>
        </div>
      )}
     </div>

      <CreateOrderDialog open={showNew || !!editNccGroup} onClose={() => { setShowNew(false); setEditNccGroup(null) }} editGroup={editNccGroup} />

      {/* Quét QR ngay trên trang danh sách (không rời sang chi tiết) */}
      {scanOrderId && (
        <InboundScanSheetById importId={scanOrderId} employeeId={user?.id} onClose={() => setScanOrderId(null)} />
      )}

    </div>
  )
}

// Trạng thái dòng nhập → key dùng chung (màu chữ + gạch ngang, không fill nền)
export function inboundKey(order: InboundOrder): RowStatusKey {
  if (order.status === 'COMPLETED') return 'completed'
  const used = order.location_used_slots ?? 0
  const max  = order.location?.max_pallets ?? 0
  if (max > 0 && used >= max) return 'full'
  if ((order._count?.inventory_entries ?? 0) > 0) return 'inProgress'
  return 'pending'
}

type StatusInfo = { label: string; variant: 'success' | 'info' | 'warning' | 'slate' }
const INBOUND_BADGE: Record<RowStatusKey, StatusInfo> = {
  completed:  { label: 'Hoàn thành', variant: 'success' },
  full:       { label: 'Đầy vị trí', variant: 'info' },
  inProgress: { label: 'Đang nhập',  variant: 'warning' },
  pending:    { label: 'Chưa nhập',  variant: 'slate' },
  scanDone:   { label: 'Đang nhập',  variant: 'warning' },
  assigned:   { label: 'Đang nhập',  variant: 'warning' },
  paused:     { label: 'Đang nhập',  variant: 'warning' },
}
function inboundStatus(order: InboundOrder): StatusInfo {
  return INBOUND_BADGE[inboundKey(order)]
}

function InboundRow({ order, onClick, onDoubleClick, onScan, onEditGroup, onPin, pinned, bracketPos = 'none', dense = true, selected = false }: {
  order: InboundOrder; onClick: () => void
  onDoubleClick?: () => void
  onScan?: (e: React.MouseEvent) => void
  onEditGroup?: (e: React.MouseEvent) => void
  onPin?: (e: React.MouseEvent) => void
  pinned?: boolean
  bracketPos?: BracketPos
  dense?: boolean
  selected?: boolean
}) {
  const dateFull = order.import_date ? format(parseISO(order.import_date), 'dd-MM-yy', { locale: vi }) : '—'
  const isRowToday = order.import_date?.slice(0, 10) === TODAY
  const importer = order.imported_by_emp?.name ?? order.created_by_emp?.name ?? '—'
  const matName  = order.material?.short_name ?? order.material?.material_description ?? '—'
  const matCode  = order.material?.material_code ?? ''
  const pallets  = order._count.inventory_entries
  const doCodes  = order.source_type === 'TRANSFER' ? (order as any).from_gdo_delivery_codes as string[] | undefined : undefined
  const tmsCode  = (order as any).tms_order?.order_code ?? null
  const isTransfer = order.source_type === 'TRANSFER'
  // Biển số xe: NCC → từ đăng ký cổng; TF → từ GDO nguồn; SX → trống (không cổng, không GDO nguồn)
  const plateNo  = (isTransfer ? (order as any).from_gdo?.license_plate : (order as any).gate_registration?.license_plate) || null
  // Số DO: chỉ chuyển kho (TF) mới có (mã DO của GDO nguồn)
  const doText   = isTransfer && doCodes?.length ? doCodes.join(', ') : null

  // Mô hình "1 phiếu = 1 vị trí": ô Vị trí hiện vị trí HIỆN TẠI của phiếu (order.location, =vị trí
  // chọn cuối). Nếu có pallet đang nằm ở vị trí KHÁC (lệch) → CẢNH BÁO (không tự dời dữ liệu).
  const curLocCode = order.location?.location_code ?? null
  const palletLocs = [...new Set(
    (((order as any).entries_by_location ?? []) as { loc: string }[])
      .map(e => e.loc.split('-')[0])
      .filter(c => c && c !== '(chưa xác định)')
  )]
  const offLocs   = palletLocs.filter(c => c !== curLocCode)
  const locText   = curLocCode ?? (palletLocs[0] ?? '—')
  const locMismatch = offLocs.length > 0
  const locTitle  = locMismatch ? `⚠ Pallet đang ở vị trí khác: ${offLocs.join(', ')}` : undefined

  const showBracket = bracketPos !== 'none' && bracketPos !== 'only'
  const st = inboundStatus(order)

  return (
    <TableRow className={`cursor-pointer ${rowText(inboundKey(order))} ${dense ? '' : '[&_td]:py-2.5'} ${selected ? 'bg-sky-50' : showBracket ? 'bg-slate-50' : ''} ${showBracket && bracketPos === 'first' ? '[&_td]:border-t [&_td]:!border-t-slate-300' : ''} ${showBracket && bracketPos === 'last' ? '[&_td]:!border-b-slate-300' : ''}`} onClick={onClick} onDoubleClick={onDoubleClick}>
      {/* Col 1: Pin + bracket connector */}
      <TableCell className="w-8 px-0 py-0 relative">
        {showBracket && (
          <div className="absolute pointer-events-none" style={{
            right: 0,
            width: '10px',
            top: bracketPos === 'first' ? '50%' : 0,
            bottom: bracketPos === 'last' ? '50%' : 0,
            borderLeft: '2px solid #0f172a',
            ...(bracketPos === 'first' ? { borderTop: '2px solid #0f172a', borderTopLeftRadius: '3px' } : {}),
            ...(bracketPos === 'last'  ? { borderBottom: '2px solid #0f172a', borderBottomLeftRadius: '3px' } : {}),
          }} />
        )}
        <div className="flex items-center justify-center py-1 pl-1 pr-3 h-full">
          {onPin && (
            <button
              onClick={onPin}
              title={pinned ? 'Bỏ đánh dấu' : 'Đánh dấu đang làm'}
              className="p-0.5 rounded hover:bg-slate-100 transition-colors"
            >
              <Bookmark className={`h-3.5 w-3.5 transition-colors ${pinned ? 'fill-amber-400 text-amber-500' : 'text-slate-300 hover:text-slate-500'}`} />
            </button>
          )}
        </div>
      </TableCell>

      {/* Col 2: Ngày nhập (sticky-left để giữ context khi scroll ngang) */}
      <TableCell className={`px-2 py-1 whitespace-nowrap sticky left-0 z-10 ${selected ? 'bg-sky-50' : showBracket ? 'bg-slate-50' : 'bg-white'}`}>
        <div className="flex items-center gap-0.5">
          <span className="text-[10px] font-medium tabular-nums">{dateFull}</span>
          {isRowToday && <span className="text-[9px] text-blue-600 font-medium ml-0.5">HN</span>}
          <span className={`text-[8px] px-1 py-0.5 rounded font-medium ml-0.5 ${
            order.source_type === 'NCC'      ? 'bg-amber-100 text-amber-700'
            : order.source_type === 'TRANSFER' ? 'bg-purple-100 text-purple-700'
            : 'bg-blue-100 text-blue-600'
          }`}>{order.source_type === 'NCC' ? 'NCC' : order.source_type === 'TRANSFER' ? 'TF' : 'SX'}</span>
          {onEditGroup && (
            <button onClick={onEditGroup} title="Sửa nhóm"
              className="text-slate-300 hover:text-blue-500 transition-colors ml-1">
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
      </TableCell>

      {/* Col 3: Vị trí */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <div className="flex items-center justify-between gap-1 w-full">
          <span className="flex items-center gap-0.5 min-w-0">
            <span className="text-[10px] font-mono font-semibold truncate" title={locTitle}>{locText}</span>
            {locMismatch && <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />}
          </span>
          {onScan && (
            <button
              onClick={onScan}
              className="flex items-center gap-0.5 text-[9px] font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded px-1.5 py-1 transition-colors"
              title="Thêm pallet"
            >
              <QrCode className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </TableCell>

      {/* Col 4: NCC (nhà cung cấp) */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {(order as any).ncc?.name
          ? <span className="text-[10px] truncate block" title={(order as any).ncc.name}>{(order as any).ncc.name}</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>

      {/* Col 5: Mã hàng */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {matCode
          ? <span className="text-[9px] text-slate-500 font-mono truncate block" title={matCode}>{matCode}</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>

      {/* Col 6: Tên hàng */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-medium truncate block" title={matName}>{matName}</span>
      </TableCell>

      {/* Col 7: Thực nhập */}
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{order.total_cartons ?? 0}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
      </TableCell>

      {/* Col 8: Thùng KH */}
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {order.planned_cartons != null ? (
          <>
            <span className={`text-[10px] font-semibold tabular-nums ${(order.total_cartons ?? 0) < order.planned_cartons ? 'text-red-600' : ''}`}>
              {order.planned_cartons}
            </span>
            <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
          </>
        ) : (
          <span className="text-[10px] text-slate-300">—</span>
        )}
      </TableCell>

      {/* Col 9: Tiến độ (Thực nhập / Thùng KH) */}
      <TableCell className="px-2 py-1 whitespace-nowrap text-right">
        {order.planned_cartons != null && order.planned_cartons > 0 ? (() => {
          const pct  = Math.round(((order.total_cartons ?? 0) / order.planned_cartons) * 100)
          const done = pct >= 100
          return (
            <div className="flex flex-col items-end gap-0.5">
              <span className={`text-[10px] font-semibold tabular-nums ${done ? 'text-green-600' : 'text-amber-600'}`}>{pct}%</span>
              <div className="h-1 w-12 rounded-full bg-slate-200 overflow-hidden">
                <div className={`h-full ${done ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            </div>
          )
        })() : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>

      {/* Col 10: Biển số xe */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {plateNo
          ? <span className={`text-[10px] font-mono truncate block ${isTransfer ? 'text-purple-600' : 'text-slate-600'}`} title={plateNo}>{plateNo}</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>

      {/* Col 11: Số DO (chỉ TF) */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {doText
          ? <span className="text-[10px] font-mono text-purple-600 truncate block" title={doText}>{doText}</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>

      {/* Col 12: Mã phiếu */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {order.import_code
          ? <span className="text-[10px] font-mono font-semibold truncate block" title={order.import_code}>{order.import_code}</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>

      {/* Col 13: Mã lệnh (TMS) */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {tmsCode
          ? <span className="text-[9px] font-mono truncate block opacity-80" title={tmsCode}>{tmsCode}</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>

      {/* Col 14: Pallet */}
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{pallets}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">pl</span>
      </TableCell>

      {/* Col 15: Người nhập */}
      <TableCell className="px-2 py-1">
        <div className="text-[10px] max-w-[90px] truncate" title={importer}>{importer}</div>
      </TableCell>

      {/* Col 10: Ca */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {order.shift
          ? <span className="text-[10px] font-medium">{order.shift.name}</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>

      {/* Col 11: Ghi chú */}
      <TableCell className="px-2 py-1">
        <div className="text-[10px] truncate" title={order.notes ?? undefined}>{order.notes ?? '—'}</div>
      </TableCell>

      {/* Col cuối: Trạng thái */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <Badge variant={st.variant} className="px-1.5 py-0 text-[9px] font-medium">{st.label}</Badge>
      </TableCell>

    </TableRow>
  )
}