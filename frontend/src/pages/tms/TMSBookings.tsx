import React, { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import * as XLSX from 'xlsx'
import { saveWorkbook } from '@/utils/saveExcel'
import { sanitizeRows } from '@/utils/excelSafe'
import { qtyFromEntryBase, qtyEntryDecimal, qtyEntryText, unitCodeOf, type MatUnits } from '@/utils/qtyUnits'
import { Plus, Upload, Pencil, Truck, Trash2, Download, RotateCcw, Star, Eye, PlusCircle, CalendarDays, ShieldX, FileSpreadsheet, X, QrCode, CheckCircle2, Boxes, ChevronDown, Loader2, Play } from 'lucide-react'
import type { AxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { usePopoverAnchor } from '@/components/shared/usePopoverAnchor'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { FormSheet } from '@/components/shared/FormSheet'
import type { MSOpt } from '@/components/shared/MultiSelectFilter'
import { can, type ModulePermissions } from '@/config/permissions'
import { rowText, statusText, type RowStatusKey } from '@/lib/rowStatus'
import { useAuthStore } from '@/stores/authStore'
import { useScopedWhTypes, useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import {
  useWarehouses, useVehicleTypes, useVehicleTypesByWarehouse, useTransportCompanies, useTmsVehicles,
  useDeliverySlots, useGenerateSlots,
  useTmsOrders, useCreateOrder, useUpdateOrder, useDeleteOrder, useBulkCreateOrders, useBulkUpdateOrderDate,
  useAddVehicleSlot, useUpdateVehicleSlot, useReleaseVehicleSlot, useRevokeVehicleSlot, useDeleteVehicleSlot,
  usePlanLinesByOrder, usePlanVsActual, useBulkCreatePlanLinesForOrder, useMaterials,
  useBulkCreatePlanLines, useUpdatePlanLine, useDeletePlanLine,
  useTransferOrders, useConfirmTransferReceipt, useCancelTransferReceipt, useSelfCompleteTransfer, useTransferGoods,
  useActiveImportsByGdo, useCreateOneInbound,
  useCompleteInboundOrder, useScanManualPallet, useMaterialSummary,
  useCancelInboundOrder, useDeletePalletEntry,
  type TransferOrder,
} from '@/api/hooks'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { InboundScanSheetById } from '@/components/wms/InboundScanSheet'
import { formatDate, formatDateTime, normalizeLicensePlate, normalizePhone, isValidPhone } from '@/utils/formatters'
import { isQtyLike } from '@/utils/inventoryMode'
import type { TmsOrder, TmsVehicleSlot, DeliverySlot, TmsVehicleType, TmsVehicle, TransportCompany } from '@/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(str: string | null | undefined) {
  if (!str) return '—'
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    }).format(new Date(str))
  } catch { return '—' }
}

function isSlotTimePassed(slotDate: string, timeFrom: string): boolean {
  return Date.now() >= new Date(`${slotDate}T${timeFrom}+07:00`).getTime()
}

// ── Status badge ─────────────────────────────────────────────────────────────

const SLOT_STATUS_CFG = {
  PENDING:   { label: 'Chờ book',     cls: 'bg-amber-100 text-amber-700' },
  BOOKED:    { label: 'Đã đặt giờ',  cls: 'bg-green-100 text-green-700' },
  ARRIVED:   { label: 'Đã đến',      cls: 'bg-blue-100 text-blue-700' },
  DONE:      { label: 'Hoàn thành',  cls: 'bg-slate-100 text-slate-600' },
  CANCELLED: { label: 'Đã hủy',      cls: 'bg-red-100 text-red-600' },
} as const

function StatusBadge({ status }: { status: string }) {
  const cfg = SLOT_STATUS_CFG[status as keyof typeof SLOT_STATUS_CFG] ?? { label: status, cls: 'bg-gray-100 text-gray-600' }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${cfg.cls}`}>{cfg.label}</span>
}

// ── Slot Picker ───────────────────────────────────────────────────────────────

function SlotPicker({ warehouseId, date, selectedSlotId, onSelect, cargoType, vehicleType }: {
  warehouseId: string; date: string; selectedSlotId: string | null
  onSelect: (slot: DeliverySlot) => void
  cargoType?: string | null
  vehicleType?: string | null
}) {
  const [generateDone, setGenerateDone] = useState(false)
  const { mutate: generateSlots } = useGenerateSlots()
  const { data: slots = [], isLoading, isFetching } = useDeliverySlots({ date, warehouse_id: warehouseId })

  useEffect(() => {
    setGenerateDone(false)
  }, [warehouseId, date])

  // Luôn gọi generate 1 lần sau khi fetch xong — backend idempotent, chỉ tạo slot chưa có
  useEffect(() => {
    if (!isLoading && !isFetching && !generateDone) {
      generateSlots(
        { warehouse_id: warehouseId, dates: [date] },
        { onSettled: () => setGenerateDone(true) },
      )
    }
  }, [isLoading, isFetching, generateDone, warehouseId, date])

  if (slots.length === 0 && (isLoading || isFetching || !generateDone))
    return <p className="text-xs text-slate-400 py-6 text-center">Đang tải khung giờ...</p>

  const allSlots = slots as DeliverySlot[]
  if (!allSlots.length)
    return <p className="text-xs text-slate-400 py-6 text-center">Chưa có khung giờ nào được cấu hình cho ngày này.</p>

  const filtered = allSlots.filter(slot => {
    if (slot.id === selectedSlotId) return true
    if (cargoType && slot.cargo_type !== 'ALL' && slot.cargo_type !== cargoType) return false
    if (vehicleType && slot.vehicle_type?.name && slot.vehicle_type.name !== vehicleType) return false
    return true
  })

  return (
    <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
      {filtered.length === 0 && (
        <p className="text-xs text-slate-400 py-4 text-center">Không có khung giờ phù hợp với loại xe đã chọn.</p>
      )}
      {filtered.map(slot => {
        const past = isSlotTimePassed(date, slot.time_from)
        const full = slot.booked_count >= slot.max_vehicles
        const selected = slot.id === selectedSlotId
        const disabled = !selected && (past || full)
        return (
          <button
            key={slot.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(slot)}
            className={[
              'w-full text-left px-3 py-2 rounded border transition-colors',
              selected ? 'border-blue-500 bg-blue-50'
                : disabled ? 'border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed'
                : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 cursor-pointer',
            ].join(' ')}
          >
            {/* Dòng 1: giờ + số xe — thông tin quyết định, cỡ lớn dễ đọc/bấm */}
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold text-sm">{slot.time_from.slice(0, 5)}–{slot.time_to.slice(0, 5)}</span>
              <span className={`text-sm font-semibold tabular-nums shrink-0 ${full && !selected ? 'text-red-500' : past && !selected ? 'text-slate-400' : 'text-green-600'}`}>
                {slot.booked_count}/{slot.max_vehicles} xe
              </span>
            </div>
            {/* Dòng 2: loại hàng + loại xe + trạng thái — không nhồi chung dòng 1 (chật trên mobile) */}
            <div className="flex items-center flex-wrap gap-1.5 mt-1 text-[11px] text-slate-500">
              <span>{slot.cargo_type === 'ALL' ? 'Tất cả loại hàng' : slot.cargo_type}</span>
              {slot.vehicle_type?.name && (
                <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{slot.vehicle_type.name}</span>
              )}
              {full && !selected && <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">Đầy</span>}
              {past && !selected && <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Đã qua</span>}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── Combobox biển số: gợi ý từ DS xe ĐVVT nhưng cho gõ biển số lạ ───────────
// Dùng <datalist> native (popup trình duyệt) — KHÔNG bị overflow-y-auto của DialogContent cắt.
// Combobox biển số chuẩn app (kiểu NppCombobox): gõ tự do + gợi ý từ danh mục xe ĐVVT.
// Rule BE không chặn biển ngoài danh mục — danh sách chỉ là gợi ý, giá trị lạ vẫn lưu được.
function PlateCombobox({ value, onChange, plates }: {
  value: string
  onChange: (v: string) => void
  plates: string[]
}) {
  const [open, setOpen] = React.useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const anchor = usePopoverAnchor(inputRef, open)
  const uniq = React.useMemo(() => [...new Set(plates)], [plates])
  const filtered = React.useMemo(() => {
    const q = value.toUpperCase()
    return (q ? uniq.filter(p => p.toUpperCase().includes(q)) : uniq).slice(0, 10)
  }, [value, uniq])
  const inList = uniq.includes(value)
  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        onChange={e => { onChange(normalizeLicensePlate(e.target.value)); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Chọn hoặc gõ biển số…"
        className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mt-1"
      />
      {open && anchor && (filtered.length > 0 || (!!value && !inList)) && createPortal(
        <div
          className="z-[200] pointer-events-auto bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-auto"
          style={anchor.style}
        >
          {filtered.map(p => (
            <button
              key={p}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm font-mono hover:bg-blue-50 ${p === value ? 'bg-blue-50 text-blue-700 font-medium' : ''}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(p); setOpen(false) }}
            >
              {p}
            </button>
          ))}
          {!!value && !inList && (
            <p className="px-3 py-1.5 text-[10px] text-slate-400 border-t">Biển ngoài danh mục xe — vẫn dùng được “{value}”</p>
          )}
        </div>,
        anchor.target,
      )}
    </div>
  )
}

// ── ĐVVT Book Dialog (điền slot + biển số + SĐT cho 1 VehicleSlot) ──────────

function BookSlotDialog({ vslot, order, onClose, allOrders }: {
  vslot: TmsVehicleSlot | null
  order: TmsOrder | null
  onClose: () => void
  allOrders: TmsOrder[]
}) {
  const updateSlot = useUpdateVehicleSlot()
  const user = useAuthStore(s => s.user)
  const isDriver = user?.job_title_name === 'Lái xe'

  const { data: nccVehicles = [] } = useTmsVehicles(
    !isDriver && order?.ncc_id ? { ncc_id: order.ncc_id, is_active: 'true', pool_branches: 'true' } : undefined
  )

  const [selectedSlot, setSelectedSlot] = useState<DeliverySlot | null>(null)
  const [licensePlate, setLicensePlate] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [consolidationOrderIds, setConsolidationOrderIds] = useState<string[]>([])
  const [showConsolidate, setShowConsolidate] = useState(false)
  const [vtConfirmPending, setVtConfirmPending] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (vslot) {
      setSelectedSlot((vslot.slot as DeliverySlot | null) ?? null)
      setLicensePlate(isDriver ? (user?.employee_code ?? '') : (vslot.license_plate ?? ''))
      setDriverPhone(vslot.driver_phone ?? '')
      setConsolidationOrderIds([])
      setShowConsolidate(false)
      setVtConfirmPending(false)
      setErr('')
    }
  }, [vslot?.id, isDriver])

  // Đơn cùng ĐVVT, cùng ngày, xe chính PENDING, chưa trong group này
  const consolidatableOrders = useMemo(() => {
    if (isDriver || !order || !['PENDING', 'BOOKED', 'ARRIVED'].includes(vslot?.status ?? '')) return []
    const currentGroupId = vslot?.consolidation_group_id ?? null
    return allOrders.filter(o => {
      if (o.id === order.id || o.ncc_id !== order.ncc_id || o.date !== order.date) return false
      if (o.direction !== order.direction) return false  // Xuất chỉ đi với Xuất, Nhập với Nhập
      const mainSlot = o.vehicle_slots.find(vs => vs.consolidation_group_id) ?? o.vehicle_slots[0]
      if (!mainSlot) return false
      if (currentGroupId && mainSlot.consolidation_group_id === currentGroupId) return false
      return mainSlot.status === 'PENDING' && !mainSlot.consolidation_group_id
    })
  }, [allOrders, order?.id, order?.ncc_id, order?.date, vslot?.status, vslot?.consolidation_group_id, isDriver])

  const handleSave = async (skipVtCheck = false) => {
    if (!vslot || !order) return
    if (!selectedSlot) { setErr('Vui lòng chọn khung giờ'); return }
    if (!licensePlate) { setErr('Vui lòng nhập biển số xe'); return }
    if (driverPhone && !isValidPhone(driverPhone)) { setErr('SĐT lái xe phải đủ 10 chữ số'); return }

    // Nếu có đơn gom mà loại xe khác nhau → yêu cầu confirm lần đầu
    if (!skipVtCheck && consolidationOrderIds.length > 0 && order.vehicle_type) {
      const hasMismatch = consolidatableOrders.some(o =>
        consolidationOrderIds.includes(o.id) && o.vehicle_type && o.vehicle_type !== order.vehicle_type
      )
      if (hasMismatch) { setVtConfirmPending(true); return }
    }
    setVtConfirmPending(false)

    const updates: Parameters<typeof updateSlot.mutateAsync>[0] = { id: vslot.id }
    if (selectedSlot?.id !== vslot.slot_id) updates.slot_id = selectedSlot?.id ?? null
    updates.license_plate = licensePlate || null
    updates.driver_phone = driverPhone || null
    if (selectedSlot && licensePlate) updates.status = 'BOOKED'
    if (consolidationOrderIds.length > 0) updates.consolidation_order_ids = consolidationOrderIds
    try {
      await updateSlot.mutateAsync(updates)
      onClose()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setErr(msg ?? 'Lỗi cập nhật')
    }
  }

  if (!vslot || !order) return null
  return (
    <FormSheet
      open={!!vslot}
      onClose={() => onClose()}
      title={vslot.status === 'PENDING' ? 'Đặt khung giờ' : 'Sửa khung giờ'}
      description={<>{order.npp_name ?? '—'} · {formatDate(order.date)}</>}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Hủy</Button>
        <Button size="sm" onClick={() => handleSave()} disabled={updateSlot.isPending}>
          {updateSlot.isPending ? 'Đang lưu...' : 'Xác nhận'}
        </Button>
      </>}
    >
        <div className="space-y-3">
          <div>
            <Label className="text-xs font-medium mb-2 block">Chọn khung giờ *</Label>
            <SlotPicker
              warehouseId={order.warehouse_id}
              date={order.date}
              selectedSlotId={selectedSlot?.id ?? null}
              onSelect={setSelectedSlot}
              cargoType={order.warehouse_type}
              vehicleType={order.vehicle_type}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Biển số xe *</Label>
              {isDriver ? (
                <Input value={licensePlate} disabled className="h-8 text-sm mt-1 bg-slate-50 font-mono" />
              ) : (
                <PlateCombobox value={licensePlate} onChange={setLicensePlate}
                  plates={(nccVehicles as TmsVehicle[]).map(v => v.license_plate)} />
              )}
            </div>
            <div>
              <Label className="text-xs">SĐT lái xe</Label>
              <Input value={driverPhone} onChange={e => setDriverPhone(normalizePhone(e.target.value))} inputMode="numeric" placeholder="09xxxxxxxx" className="h-8 text-sm mt-1" />
            </div>
          </div>
          {consolidatableOrders.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowConsolidate(v => !v)}
                className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <span>{showConsolidate ? '▾' : '▸'}</span>
                Xe này chở thêm đơn?
                {consolidationOrderIds.length > 0 && (
                  <span className="ml-1 bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                    {consolidationOrderIds.length} đơn
                  </span>
                )}
              </button>
              {showConsolidate && (
                <div className="mt-1.5 max-h-36 overflow-y-auto border rounded p-1.5 space-y-0.5 bg-slate-50">
                  {consolidatableOrders.map(o => {
                    const vtDiff = !!order.vehicle_type && !!o.vehicle_type && o.vehicle_type !== order.vehicle_type
                    return (
                      <label key={o.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-white px-1.5 py-1 rounded">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 shrink-0"
                          checked={consolidationOrderIds.includes(o.id)}
                          onChange={e => setConsolidationOrderIds(prev =>
                            e.target.checked ? [...prev, o.id] : prev.filter(id => id !== o.id)
                          )}
                        />
                        <span className="font-mono font-semibold">{o.order_code}</span>
                        {o.npp_name && <span className="text-slate-500 truncate">{o.npp_name}</span>}
                        {o.vehicle_type && (
                          <span className={`ml-auto shrink-0 px-1 py-0.5 rounded text-[10px] font-medium ${vtDiff ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                            {o.vehicle_type}
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {vtConfirmPending && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 space-y-2">
              <p className="font-medium">⚠ Một số đơn được chọn có loại xe khác với đơn chính ({order.vehicle_type}). Tiếp tục?</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setVtConfirmPending(false)}>Xem lại</Button>
                <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700" onClick={() => handleSave(true)}>Xác nhận dù vậy</Button>
              </div>
            </div>
          )}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
    </FormSheet>
  )
}

// ── Create / Edit Order Dialog (Điều vận) ────────────────────────────────────

type OrderFormData = {
  date: string; warehouse_id: string; npp_name: string; ncc_id: string
  direction: 'OUTBOUND' | 'INBOUND' | ''
  warehouse_type: string; vehicle_type: string
  planned_boxes: string; planned_pallets: string; planned_tons: string
  gdo_refs: string; notes: string; priority: boolean
}

const EMPTY_FORM = (date: string, warehouse_id: string): OrderFormData => ({
  date, warehouse_id, npp_name: '', ncc_id: '',
  direction: 'OUTBOUND',
  warehouse_type: '', vehicle_type: '',
  planned_boxes: '', planned_pallets: '', planned_tons: '',
  gdo_refs: '', notes: '', priority: false,
})

// Phần cuối (sau ngày) không bắt buộc là số — cho phép hậu tố dạng chữ như "gộp 1"
const ORDER_CODE_RE = /^[A-Za-z0-9]+_[XN]_\d{6}_.+$/


type PlanLineRow = {
  line_id?: string // undefined = dòng mới chưa lưu
  material_code: string; material_id: string; material_name: string
  unit: string; planned_boxes: string; planned_pallets: string
}
const EMPTY_PLAN_LINE = (): PlanLineRow => ({
  material_code: '', material_id: '', material_name: '', unit: '', planned_boxes: '', planned_pallets: '',
})

// ── Material search combobox ──────────────────────────────────────────────────
type MatItem = { id: string; material_code: string; short_name?: string | null; unit?: string | null; category?: string | null } & MatUnits

function getDuplicateCodes(rows: { material_code: string }[]): Set<string> {
  const seen = new Map<string, number>()
  for (const r of rows) {
    if (r.material_code) seen.set(r.material_code, (seen.get(r.material_code) ?? 0) + 1)
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c))
}

function MatCombobox({
  value, onSelect, allMats, onPaste, inputClassName, filterCategory, disabled: disabledProp,
}: {
  value: string
  onSelect: (code: string, id: string, name: string, unit: string) => void
  allMats: MatItem[]
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void
  inputClassName?: string
  filterCategory?: string
  disabled?: boolean
}) {
  const [q, setQ] = React.useState(value)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => { setQ(value) }, [value])

  const matches = React.useMemo(() => {
    if (!q) return []
    const lower = q.toLowerCase()
    const sourceMats = filterCategory ? allMats.filter(m => m.category === filterCategory) : allMats
    return sourceMats
      .filter(m =>
        m.material_code.toLowerCase().includes(lower) ||
        (m.short_name ?? '').toLowerCase().includes(lower)
      )
      .slice(0, 10)
  }, [q, allMats, filterCategory])

  return (
    <div className="relative">
      <input
        value={q}
        onChange={e => { if (!disabledProp) { setQ(e.target.value); setOpen(true) } }}
        onFocus={() => { if (!disabledProp) setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onPaste={disabledProp ? undefined : onPaste}
        disabled={disabledProp}
        placeholder={disabledProp ? 'Chọn loại kho trước' : 'Mã / Tên hàng'}
        className={inputClassName ?? `h-6 w-32 rounded border border-slate-200 px-2 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 ${disabledProp ? 'opacity-50 cursor-not-allowed bg-slate-50' : ''}`}
      />
      {!disabledProp && open && matches.length > 0 && (
        <div className="absolute z-[100] top-full left-0 mt-0.5 w-72 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-auto">
          {matches.map(m => (
            <button
              key={m.id}
              type="button"
              className="w-full text-left px-2 py-1 hover:bg-blue-50 flex items-center gap-2 border-b border-slate-50 last:border-0"
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                onSelect(m.material_code, m.id, m.short_name ?? '', unitCodeOf(m))
                setQ(m.material_code)
                setOpen(false)
              }}
            >
              <span className="text-[10px] font-mono font-semibold text-slate-800 w-24 shrink-0 truncate">{m.material_code}</span>
              <span className="text-[9px] text-slate-500 flex-1 truncate">{m.short_name}</span>
              <span className="text-[9px] text-slate-400 shrink-0">{unitCodeOf(m)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Searchable select (ĐVVT) ─────────────────────────────────────────────────
function SearchableSelect({ value, onChange, options, placeholder }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}) {
  const [q, setQ] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const selectedLabel = options.find(o => o.value === value)?.label ?? ''
  const filtered = React.useMemo(() => {
    const lower = q.toLowerCase()
    return q ? options.filter(o => o.label.toLowerCase().includes(lower)) : options
  }, [q, options])
  return (
    <div className="relative mt-1">
      <button
        type="button"
        className="h-8 w-full flex items-center justify-between rounded-md border border-input bg-background px-3 text-sm text-left shadow-sm"
        onClick={() => { setOpen(v => !v); setTimeout(() => inputRef.current?.focus(), 50) }}
      >
        <span className={selectedLabel ? 'text-foreground' : 'text-muted-foreground'}>
          {selectedLabel || (placeholder ?? 'Chọn...')}
        </span>
        <svg className="h-4 w-4 opacity-50 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-[200] top-full left-0 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg">
          <div className="p-1.5 border-b">
            <input
              ref={inputRef}
              className="w-full px-2 py-1 text-xs rounded border border-slate-200 outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="Tìm kiếm..."
              value={q}
              onChange={e => setQ(e.target.value)}
              onBlur={() => setTimeout(() => setOpen(false), 120)}
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0
              ? <p className="text-xs text-slate-400 text-center py-3">Không tìm thấy</p>
              : filtered.map(o => (
                <button
                  key={o.value}
                  type="button"
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 ${o.value === value ? 'bg-blue-50 text-blue-700 font-medium' : ''}`}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { onChange(o.value); setQ(''); setOpen(false) }}
                >
                  {o.label}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── NPP combobox (free text + suggestions) ───────────────────────────────────
function NppCombobox({ value, onChange, suggestions }: {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
}) {
  const [open, setOpen] = React.useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const anchor = usePopoverAnchor(inputRef, open)
  const filtered = React.useMemo(() => {
    const lower = value.toLowerCase()
    const list = value
      ? suggestions.filter(s => s.toLowerCase().includes(lower))
      : suggestions
    return list.slice(0, 10)
  }, [value, suggestions])
  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Tên nhà phân phối"
        className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mt-1"
      />
      {open && anchor && filtered.length > 0 && createPortal(
        <div
          className="z-[200] pointer-events-auto bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-auto"
          style={anchor.style}
        >
          {filtered.map(s => (
            <button
              key={s}
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(s); setOpen(false) }}
            >
              {s}
            </button>
          ))}
        </div>,
        anchor.target,
      )}
    </div>
  )
}

function CreateEditDialog({ open, order, onClose, defaultDate, defaultWarehouseId, nppSuggestions }: {
  open: boolean; order: TmsOrder | null; onClose: () => void
  defaultDate: string; defaultWarehouseId: string
  nppSuggestions: string[]
}) {
  const { data: warehouses = [] }          = useScopedWarehouses(true)
  const { data: whTypesData = [] }         = useScopedWhTypes()
  const { data: vehicleTypes = [] }        = useVehicleTypes(true)
  const { data: transportCompanies = [] }  = useTransportCompanies(true)
  const createOrder  = useCreateOrder()
  const updateOrder  = useUpdateOrder()
  const { data: allMats = [] }             = useMaterials()
  const { mutateAsync: addPlanLines }      = useBulkCreatePlanLinesForOrder()
  const { mutateAsync: deletePlanLine }    = useDeletePlanLine()
  const { mutateAsync: updatePlanLine }    = useUpdatePlanLine()
  const isEdit = !!order
  const today  = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const { data: existingPlanLines = [] }   = usePlanLinesByOrder(isEdit ? (order?.id ?? null) : null)

  const [form, setForm]         = useState<OrderFormData>(EMPTY_FORM(defaultDate, defaultWarehouseId))
  const [planRows, setPlanRows] = useState<PlanLineRow[]>(() => Array.from({ length: 20 }, EMPTY_PLAN_LINE))
  const [planSaving, setPlanSaving] = useState(false)
  const [err, setErr] = useState('')
  const [createdCode, setCreatedCode] = useState<string | null>(null)
  const planRowsInitRef = React.useRef(false)
  const set = (k: keyof OrderFormData) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  const duplicatePlanCodes = React.useMemo(() => getDuplicateCodes(planRows), [planRows])

  const previewCode = React.useMemo(() => {
    if (isEdit) return order?.order_code ?? ''
    const whCode = (warehouses as { id: string; code?: string }[]).find(w => w.id === form.warehouse_id)?.code ?? '?'
    const dirPfx = form.direction === 'OUTBOUND' ? 'X' : form.direction === 'INBOUND' ? 'N' : '?'
    if (!form.date || dirPfx === '?') return ''
    const d = new Date(form.date)
    const ddmmyy = `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getFullYear()).slice(-2)}`
    return `${whCode}_${dirPfx}_${ddmmyy}_*`
  }, [isEdit, order, form.direction, form.warehouse_id, form.date, warehouses])

  // Lọc loại xe theo kho + loại kho — warehouse_type dùng thẳng, không map
  const { data: filteredVehicleTypes = [] } = useVehicleTypesByWarehouse(form.warehouse_id || null, form.warehouse_type || undefined)
  // Đã chọn kho: dùng list lọc (rỗng = không có loại xe nào hợp lệ cho cargo_type này)
  // Chưa chọn kho: hiện tất cả
  const availableVehicleTypes = (form.warehouse_id ? filteredVehicleTypes : vehicleTypes) as TmsVehicleType[]

  function updatePlanRow(i: number, field: keyof PlanLineRow, value: string) {
    setPlanRows(prev => {
      const rows = [...prev]
      rows[i] = { ...rows[i], [field]: value }
      if (field === 'material_code') {
        const mat = (allMats as import('@/types').Material[]).find(m => m.material_code === value.trim())
        if (mat) {
          rows[i].material_id   = mat.id
          rows[i].material_name = (mat as { short_name?: string }).short_name ?? ''
          rows[i].unit          = unitCodeOf(mat)
        } else {
          rows[i].material_id = ''; rows[i].material_name = ''; rows[i].unit = ''
        }
      }
      return rows
    })
  }

  function selectPlanMat(i: number, code: string, id: string, name: string, unit: string) {
    setPlanRows(prev => {
      const rows = [...prev]
      rows[i] = { ...rows[i], material_code: code, material_id: id, material_name: name, unit }
      return rows
    })
  }

  function handlePasteBoxesAt(startIdx: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n')) return
    e.preventDefault()
    const values = text.trim().split(/\r?\n/).filter(Boolean)
    setPlanRows(prev => {
      const rows = [...prev]
      while (rows.length < startIdx + values.length) rows.push(EMPTY_PLAN_LINE())
      values.forEach((val, offset) => {
        rows[startIdx + offset] = { ...rows[startIdx + offset], planned_boxes: val.trim().replace(/[^0-9]/g, '') }
      })
      return rows
    })
  }

  function handlePastePalletsAt(startIdx: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n')) return
    e.preventDefault()
    const values = text.trim().split(/\r?\n/).filter(Boolean)
    setPlanRows(prev => {
      const rows = [...prev]
      while (rows.length < startIdx + values.length) rows.push(EMPTY_PLAN_LINE())
      values.forEach((val, offset) => {
        rows[startIdx + offset] = { ...rows[startIdx + offset], planned_pallets: val.trim().replace(/[^0-9]/g, '') }
      })
      return rows
    })
  }

  // Paste từ Excel: tab-separated columns → Mã hàng | SL thùng | SL pallet
  function handlePasteAt(startIdx: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\t') && !text.includes('\n')) return
    e.preventDefault()
    const lines = text.trim().split(/\r?\n/).filter(Boolean)
    setPlanRows(prev => {
      const rows = [...prev]
      while (rows.length < startIdx + lines.length) rows.push(EMPTY_PLAN_LINE())
      lines.forEach((line, offset) => {
        const cols = line.split('\t')
        const code    = (cols[0] ?? '').trim()
        const boxes   = (cols[1] ?? '').trim().replace(/[^0-9]/g, '')
        const pallets = (cols[2] ?? '').trim().replace(/[^0-9]/g, '')
        const mat = (allMats as import('@/types').Material[]).find(m =>
          m.material_code === code && (!form.warehouse_type || m.category === form.warehouse_type)
        )
        rows[startIdx + offset] = {
          material_code: code,
          material_id:   mat?.id ?? '',
          material_name: (mat as { short_name?: string } | undefined)?.short_name ?? '',
          unit:          unitCodeOf(mat),
          planned_boxes: boxes,
          planned_pallets: pallets,
        }
      })
      return rows
    })
  }

  useEffect(() => {
    if (!open) { planRowsInitRef.current = false; setCreatedCode(null); return }
    if (order) {
      setForm({
        date: order.date, warehouse_id: order.warehouse_id,
        npp_name: order.npp_name ?? '', ncc_id: order.ncc_id ?? '',
        direction: (order.direction as 'OUTBOUND' | 'INBOUND') ?? 'OUTBOUND',
        warehouse_type: order.warehouse_type ?? '', vehicle_type: order.vehicle_type ?? '',
        planned_boxes: order.planned_boxes != null ? String(order.planned_boxes) : '',
        planned_pallets: order.planned_pallets != null ? String(order.planned_pallets) : '',
        planned_tons: order.planned_tons != null ? String(order.planned_tons) : '',
        gdo_refs: order.gdo_refs ?? '', notes: order.notes ?? '',
        priority: order.priority ?? false,
      })
    } else {
      setForm(EMPTY_FORM(today, defaultWarehouseId))
      setPlanRows(Array.from({ length: 20 }, EMPTY_PLAN_LINE))
      planRowsInitRef.current = true
    }
    setErr('')
  }, [open, order?.id])

  // Load existing plan lines into planRows when editing INBOUND
  useEffect(() => {
    if (!open || !isEdit || planRowsInitRef.current) return
    if ((existingPlanLines as any[]).length === 0) return
    planRowsInitRef.current = true
    const rows: PlanLineRow[] = (existingPlanLines as any[])
      .filter((l: any) => l.status !== 'CANCELLED')
      .map((l: any) => ({
        line_id: l.id,
        material_code: l.material?.material_code ?? '',
        material_id: l.material_id ?? '',
        material_name: l.material?.short_name ?? '',
        unit: l.unit ?? '',
        planned_boxes: String(l.planned_boxes != null ? qtyEntryDecimal(Number(l.planned_boxes), l.material ?? null) : ''),
        planned_pallets: String(l.planned_pallets ?? ''),
      }))
    while (rows.length < 5) rows.push(EMPTY_PLAN_LINE())
    setPlanRows(rows)
  }, [open, isEdit, existingPlanLines])

  const handleSubmit = async () => {
    if (!form.date || !form.warehouse_id) { setErr('Vui lòng chọn ngày và kho'); return }
    if (!form.direction) { setErr('Vui lòng chọn hướng vận chuyển'); return }
    if (!form.ncc_id) { setErr('Vui lòng chọn ĐVVT'); return }
    if (!form.warehouse_type) { setErr('Vui lòng chọn loại kho'); return }
    if (!form.vehicle_type) { setErr('Vui lòng chọn loại xe'); return }
    if (form.direction === 'INBOUND' && duplicatePlanCodes.size > 0) {
      setErr(`Danh sách hàng có mã trùng: ${[...duplicatePlanCodes].join(', ')}`)
      return
    }
    const payload = {
      date: form.date, warehouse_id: form.warehouse_id,
      npp_name: form.npp_name || null, ncc_id: form.ncc_id || null,
      direction: form.direction || null,
      warehouse_type: form.warehouse_type || null,
      vehicle_type: form.vehicle_type || null,
      planned_boxes: form.planned_boxes ? Number(form.planned_boxes) : null,
      planned_pallets: form.planned_pallets ? Number(form.planned_pallets) : null,
      planned_tons: form.planned_tons ? Number(form.planned_tons) : null,
      gdo_refs: form.gdo_refs || null, notes: form.notes || null,
      priority: form.priority,
    }
    try {
      if (isEdit && order) {
        await updateOrder.mutateAsync({ id: order.id, ...payload })
        if (form.direction === 'INBOUND') {
          const validRows = planRows.filter(r => r.material_id && Number(r.planned_boxes) > 0)
          const keptIds = new Set(validRows.map(r => r.line_id).filter(Boolean))
          const toDelete = (existingPlanLines as any[]).filter((l: any) => l.status !== 'CANCELLED' && !keptIds.has(l.id))
          const toAdd    = validRows.filter(r => !r.line_id)
          const toUpdate = validRows.filter(r => r.line_id)
          setPlanSaving(true)
          await Promise.all([
            ...toDelete.map((l: any) => deletePlanLine(l.id)),
            ...toUpdate.map(r => updatePlanLine({ id: r.line_id!, planned_boxes: qtyFromEntryBase(Number(r.planned_boxes), 0, allMats.find(m => m.id === r.material_id) ?? null), ...(r.planned_pallets ? { planned_pallets: Number(r.planned_pallets) } : {}) })),
          ])
          if (toAdd.length > 0) {
            await addPlanLines({
              tms_order_id: order.id,
              lines: toAdd.map(r => ({
                material_id:   r.material_id,
                planned_boxes: qtyFromEntryBase(Number(r.planned_boxes), 0, allMats.find(m => m.id === r.material_id) ?? null),
                ...(r.planned_pallets ? { planned_pallets: Number(r.planned_pallets) } : {}),
              })),
            })
          }
          setPlanSaving(false)
        }
      } else {
        const created = await createOrder.mutateAsync(payload)
        if (form.direction === 'INBOUND') {
          const validLines = planRows.filter(r => r.material_id && Number(r.planned_boxes) > 0)
          if (validLines.length > 0) {
            setPlanSaving(true)
            await addPlanLines({
              tms_order_id: (created as import('@/types').TmsOrder).id,
              lines: validLines.map(r => ({
                material_id:   r.material_id,
                planned_boxes: qtyFromEntryBase(Number(r.planned_boxes), 0, allMats.find(m => m.id === r.material_id) ?? null),
                ...(r.planned_pallets ? { planned_pallets: Number(r.planned_pallets) } : {}),
              })),
            })
            setPlanSaving(false)
          }
        }
        setCreatedCode((created as import('@/types').TmsOrder).order_code)
        return
      }
      onClose()
    } catch (e: unknown) {
      setPlanSaving(false)
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setErr(msg ?? 'Lỗi lưu dữ liệu')
    }
  }

  const isSaving = createOrder.isPending || updateOrder.isPending || planSaving

  return (
    <FormSheet
      open={open} onClose={onClose}
      title={isEdit ? 'Sửa đơn hàng' : 'Thêm đơn hàng'}
      widthClass={form.direction === 'INBOUND' ? 'sm:max-w-4xl' : 'sm:max-w-lg'}
      footer={createdCode ? (
        <Button onClick={onClose}>OK</Button>
      ) : (<>
        <Button variant="outline" size="sm" onClick={onClose}>Hủy</Button>
        <Button size="sm" onClick={handleSubmit} disabled={isSaving}>
          {isSaving ? 'Đang lưu...' : isEdit ? 'Cập nhật' : 'Thêm đơn'}
        </Button>
      </>)}
    >
        {createdCode ? (
          <div className="py-8 flex flex-col items-center gap-4">
            <div className="text-center space-y-1">
              <p className="text-sm text-slate-600">Đã tạo thành công phiếu</p>
              <p className="text-xl font-mono font-bold text-green-700">{createdCode}</p>
            </div>
          </div>
        ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Ngày *</Label>
              <Input type="date" value={form.date} min={today} onChange={e => set('date')(e.target.value)} className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs">Kho *</Label>
              <WarehouseSingleSelect
                warehouses={warehouses as { id: string; name: string }[]}
                value={form.warehouse_id}
                onChange={newId => setForm(f => ({ ...f, warehouse_id: newId, warehouse_type: '', vehicle_type: '' }))}
                placeholder="Chọn kho"
                triggerClassName="mt-1 h-8"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Hướng *</Label>
              <Select value={form.direction || '__none__'} onValueChange={v => set('direction')(v === '__none__' ? '' : v as 'OUTBOUND' | 'INBOUND')}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Xuất / Nhập" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="OUTBOUND">Xuất hàng</SelectItem>
                  <SelectItem value="INBOUND">Nhập hàng</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Mã đơn {isEdit ? '' : <span className="text-slate-400 font-normal">(tự sinh)</span>}</Label>
              <div className={`h-8 mt-1 px-2 flex items-center rounded-md border ${createdCode ? 'border-green-400 bg-green-50' : 'border-slate-200 bg-slate-50'}`}>
                {createdCode
                  ? <span className="text-sm font-mono font-semibold text-green-700">{createdCode} ✓</span>
                  : previewCode
                    ? <span className="text-sm font-mono text-slate-500">{previewCode}</span>
                    : <span className="text-sm text-slate-400 italic">Chọn hướng và ngày...</span>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tên NPP</Label>
              <NppCombobox value={form.npp_name} onChange={set('npp_name')} suggestions={nppSuggestions} />
            </div>
            <div>
              <Label className="text-xs">ĐVVT *</Label>
              <SearchableSelect
                value={form.ncc_id}
                onChange={set('ncc_id')}
                placeholder="Chọn ĐVVT"
                options={(transportCompanies as TransportCompany[]).map(c => ({ value: c.id, label: `${c.code} — ${c.name}` }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Loại kho *</Label>
              <Select value={form.warehouse_type || '__none__'} onValueChange={v => {
                const newVal = v === '__none__' ? '' : v
                setForm(f => ({ ...f, warehouse_type: newVal, vehicle_type: '' }))
              }}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Chọn loại kho" /></SelectTrigger>
                <SelectContent>
                  {whTypesData.map(t => <SelectItem key={t.id} value={t.value}>{t.value}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Loại xe *</Label>
              <Select value={form.vehicle_type || '__none__'} onValueChange={v => set('vehicle_type')(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Chọn loại xe" /></SelectTrigger>
                <SelectContent>
                  {availableVehicleTypes.map(vt => (
                    <SelectItem key={vt.id} value={vt.name}>{vt.code} — {vt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Số thùng</Label>
              <Input type="number" min="0" value={form.planned_boxes} onChange={e => set('planned_boxes')(e.target.value)} className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs">Số pallet</Label>
              <Input type="number" min="0" value={form.planned_pallets} onChange={e => set('planned_pallets')(e.target.value)} className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs">Số tấn</Label>
              <Input type="number" min="0" step="0.001" value={form.planned_tons} onChange={e => set('planned_tons')(e.target.value)} className="h-8 text-sm mt-1" />
            </div>
          </div>
          {form.direction !== 'INBOUND' && (
            <div>
              <Label className="text-xs">Mã GDO</Label>
              <Input value={form.gdo_refs} onChange={e => set('gdo_refs')(e.target.value)} placeholder="GDO-001, GDO-002" className="h-8 text-sm mt-1" />
            </div>
          )}
          {/* Bảng hàng hóa kế hoạch — hiện khi INBOUND (cả tạo mới lẫn edit) */}
          {form.direction === 'INBOUND' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs font-medium">Danh sách hàng</Label>
                <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] px-2"
                  onClick={() => setPlanRows(prev => [...prev, EMPTY_PLAN_LINE()])}>
                  + Thêm dòng
                </Button>
              </div>
              <div className="rounded border overflow-auto max-h-52">
                <table className="min-w-full">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      {['#', 'Mã hàng', 'Tên hàng', 'ĐVT', 'SL thùng', 'SL pallet', ''].map(h => (
                        <th key={h} className="px-1.5 py-1 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {planRows.map((row, i) => (
                      <tr key={i} className={`border-t border-slate-100 ${
                        row.material_code && !row.material_id ? 'bg-red-50' :
                        row.material_code && duplicatePlanCodes.has(row.material_code) ? 'bg-amber-50' : ''
                      }`}>
                        <td className="px-1.5 py-0.5 text-[9px] text-slate-400">{i + 1}</td>
                        <td className="px-1 py-0.5">
                          <MatCombobox
                            value={row.material_code}
                            allMats={allMats.filter(m => !m.is_non_stock) as MatItem[]}
                            onSelect={(code, id, name, unit) => selectPlanMat(i, code, id, name, unit)}
                            onPaste={e => handlePasteAt(i, e)}
                            filterCategory={form.warehouse_type || undefined}
                            disabled={!form.warehouse_type}
                          />
                        </td>
                        <td className="px-1.5 py-0.5 text-[10px] text-slate-600 max-w-[140px] truncate">{row.material_name || <span className="text-slate-300">—</span>}</td>
                        <td className="px-1.5 py-0.5 text-[10px] text-slate-500">{row.unit || <span className="text-slate-300">—</span>}</td>
                        <td className="px-1 py-0.5">
                          <input
                            type="number" min={1}
                            value={row.planned_boxes}
                            onChange={e => updatePlanRow(i, 'planned_boxes', e.target.value)}
                            onPaste={e => handlePasteBoxesAt(i, e)}
                            className="h-6 w-16 rounded border border-slate-200 px-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                            placeholder="Thùng"
                          />
                        </td>
                        <td className="px-1 py-0.5">
                          <input
                            type="number" min={0}
                            value={row.planned_pallets}
                            onChange={e => updatePlanRow(i, 'planned_pallets', e.target.value)}
                            onPaste={e => handlePastePalletsAt(i, e)}
                            className="h-6 w-16 rounded border border-slate-200 px-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                            placeholder="Pallet"
                          />
                        </td>
                        <td className="px-1 py-0.5">
                          <button type="button" className="text-slate-300 hover:text-red-500 text-xs px-1"
                            onClick={() => setPlanRows(prev => prev.filter((_, idx) => idx !== i))}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {planRows.some(r => r.material_code && !r.material_id) && (
                <p className="text-[10px] text-amber-600 mt-1">Một số mã hàng không tìm thấy hoặc không thuộc loại kho — các dòng này sẽ bị bỏ qua</p>
              )}
              {duplicatePlanCodes.size > 0 && (
                <p className="text-[10px] text-red-600 mt-1">Mã hàng bị trùng: {[...duplicatePlanCodes].join(', ')}</p>
              )}
            </div>
          )}
          <div>
            <Label className="text-xs">Ghi chú</Label>
            <textarea
              value={form.notes}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set('notes')(e.target.value)}
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mt-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="priority-check"
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-red-600"
              checked={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: e.target.checked }))}
            />
            <Label htmlFor="priority-check" className="text-xs cursor-pointer">
              Ưu tiên <span className="text-red-600 font-semibold">x</span>
              <span className="text-slate-400 font-normal ml-1">— đơn ưu tiên xuất hàng</span>
            </Label>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        )}
    </FormSheet>
  )
}

// ── Excel Upload Dialog ───────────────────────────────────────────────────────

type ImportRow = {
  date: string | null; warehouse_id: string | null; warehouse_name: string
  npp_name: string; direction: string; warehouse_type: string; vehicle_type: string
  ncc_code: string; ncc_id: string | null
  order_code: string
  planned_boxes: number | null; planned_pallets: number | null; planned_tons: number | null
  gdo_refs: string; notes: string; priority: boolean; valid: boolean; error: string
}

const EXCEL_COL_MAP: Record<string, string> = {
  'npp': 'npp_name', 'tên npp': 'npp_name', 'nhà phân phối': 'npp_name',
  'kho': 'warehouse_name', 'kho xuất': 'warehouse_name',
  'ngày': 'date', 'date': 'date',
  'hướng': 'direction', 'huong': 'direction', 'direction': 'direction',
  'loại kho': 'warehouse_type', 'warehouse type': 'warehouse_type',
  'loại xe': 'vehicle_type', 'vehicle type': 'vehicle_type',
  'đvvt': 'ncc_code', 'dvvt': 'ncc_code', 'đơn vị vận tải': 'ncc_code',
  'mã đơn': 'order_code', 'số xe': 'order_code', 'so xe': 'order_code',
  'thùng': 'planned_boxes', 'số thùng': 'planned_boxes', 'box': 'planned_boxes',
  'pallet': 'planned_pallets', 'số pallet': 'planned_pallets',
  'tấn': 'planned_tons', 'số tấn': 'planned_tons', 'ton': 'planned_tons',
  'gdo': 'gdo_refs', 'mã gdo': 'gdo_refs',
  'ghi chú': 'notes', 'notes': 'notes',
  'ưu tiên': 'priority', 'uu tien': 'priority', 'priority': 'priority', 'ưutiên': 'priority',
}

function parsePriority(val: unknown): boolean {
  return String(val ?? '').trim().toLowerCase() === 'x'
}

// Chuẩn số VN: dấu CHẤM = ngăn nghìn, dấu PHẨY = thập phân (1.234,56).
// Trả null nếu ô trống, NaN nếu không phải số (để báo lỗi thay vì nuốt im lặng).
function parseVnNumber(val: unknown): number | null {
  if (val == null || val === '') return null
  if (typeof val === 'number') return val
  let s = String(val).trim().replace(/\s/g, '')
  if (!s) return null
  const commas = (s.match(/,/g) ?? []).length
  const dots   = (s.match(/\./g) ?? []).length
  if (commas && dots)    s = s.replace(/\./g, '').replace(',', '.') // 1.234,56 → 1234.56
  else if (commas > 1)   s = s.replace(/,/g, '')                    // 1,234,567 (kiểu US) → 1234567
  else if (commas === 1) s = s.replace(',', '.')                    // 15,462 → 15.462
  else if (dots > 1)     s = s.replace(/\./g, '')                   // 1.234.567 (nghìn VN) → 1234567
  return Number(s)
}

function parseDirection(val: unknown): string {
  const s = String(val ?? '').trim().toLowerCase()
  if (['xuất', 'xuat', 'x', 'outbound', 'out'].includes(s)) return 'OUTBOUND'
  if (['nhập', 'nhap', 'n', 'inbound', 'in'].includes(s)) return 'INBOUND'
  return ''
}

function parseExcelDate(val: unknown): string | null {
  if (!val) return null
  // Serial Excel (đọc KHÔNG cellDates) → quy đổi bằng lịch Excel thuần (SSF), KHÔNG qua Date/giờ máy →
  // lấy ĐÚNG ngày hiển thị trên file, không suy luận timezone (cellDates từng làm 04/07 → 03/07).
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val)
    return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null
  }
  const s = String(val).trim()
  const m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return null
}

function ExcelUploadDialog({ open, onClose, warehouses, warehouseTypes, vehicleTypes, transportCompanies }: {
  open: boolean; onClose: () => void
  warehouses: { id: string; name: string }[]
  warehouseTypes: string[]
  vehicleTypes: TmsVehicleType[]
  transportCompanies: TransportCompany[]
}) {
  const bulkCreate = useBulkCreateOrders()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ inserted: number } | null>(null)
  const [err, setErr] = useState('')

  const whByName     = Object.fromEntries(warehouses.map(w => [w.name.toLowerCase().trim(), w.id]))
  const validWhTypes = new Set(warehouseTypes.map(t => t.toLowerCase().trim()))
  const validVtNames = new Set(vehicleTypes.map(vt => vt.name.toLowerCase().trim()))
  const nccByCode    = Object.fromEntries(transportCompanies.flatMap(c => [
    [c.code.toLowerCase().trim(), c.id] as [string, string],
    ...((c.alias_codes ?? []).map(a => [String(a).toLowerCase().trim(), c.id] as [string, string])),
  ]))

  const reset = () => { setRows([]); setResult(null); setErr('') }
  useEffect(() => { if (open) reset() }, [open])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = evt => {
      try {
        // KHÔNG cellDates: để ô ngày ở dạng serial → parseExcelDate quy đổi bằng lịch Excel thuần (không lệch timezone).
        const wb = XLSX.read(evt.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
        const seenCodes = new Set<string>()

        const parsed: ImportRow[] = raw.map(r => {
          const norm: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(r)) {
            const mapped = EXCEL_COL_MAP[k.trim().toLowerCase()]
            if (mapped) norm[mapped] = v
          }
          const whName      = String(norm.warehouse_name ?? '').trim()
          const whId        = whByName[whName.toLowerCase()] ?? null
          const date        = parseExcelDate(norm.date)
          const direction   = parseDirection(norm.direction)
          const whType      = String(norm.warehouse_type ?? '').trim()
          const vtName      = String(norm.vehicle_type ?? '').trim()
          const nccCode     = String(norm.ncc_code ?? '').trim()
          const nccId       = nccCode ? (nccByCode[nccCode.toLowerCase()] ?? null) : null
          const orderCode   = String(norm.order_code ?? '').trim()
          const errors: string[] = []
          if (!date) errors.push('thiếu ngày')
          if (!direction) errors.push('thiếu hướng (Xuất/Nhập)')
          else if (direction === 'INBOUND') errors.push('chỉ nhập đơn Xuất — dùng Kế hoạch nhập ngoài cho hàng Nhập')
          if (whName && !whId) errors.push(`kho "${whName}" không tìm thấy`)
          if (!whId && !whName) errors.push('thiếu kho')
          if (whType && validWhTypes.size > 0 && !validWhTypes.has(whType.toLowerCase())) errors.push(`loại kho "${whType}" không hợp lệ`)
          if (vtName && validVtNames.size > 0 && !validVtNames.has(vtName.toLowerCase())) errors.push(`loại xe "${vtName}" không hợp lệ`)
          if (nccCode && !nccId) errors.push(`ĐVVT "${nccCode}" không tìm thấy`)
          if (!orderCode) errors.push('thiếu mã đơn')
          else if (!ORDER_CODE_RE.test(orderCode)) errors.push(`mã đơn "${orderCode}" sai định dạng (vd: BV_X_260610_1)`)
          else if (seenCodes.has(orderCode.toUpperCase())) errors.push(`mã đơn "${orderCode}" bị trùng trong file`)
          else seenCodes.add(orderCode.toUpperCase())
          // Trần DB: Tấn = numeric(10,3). Vượt → Postgres "numeric field overflow" — chặn từ preview cho rõ dòng.
          const tonsNum    = parseVnNumber(norm.planned_tons)
          const boxesNum   = parseVnNumber(norm.planned_boxes)
          const palletsNum = parseVnNumber(norm.planned_pallets)
          if (tonsNum != null && isNaN(tonsNum))       errors.push(`Tấn "${norm.planned_tons}" không phải số`)
          if (boxesNum != null && isNaN(boxesNum))     errors.push(`Thùng "${norm.planned_boxes}" không phải số`)
          if (palletsNum != null && isNaN(palletsNum)) errors.push(`Pallet "${norm.planned_pallets}" không phải số`)
          if (tonsNum != null && Math.abs(tonsNum) > 9999999.999)
            errors.push(`Tấn "${norm.planned_tons}" quá lớn (tối đa 9.999.999,999)`)

          return {
            date, warehouse_id: whId, warehouse_name: whName,
            npp_name: String(norm.npp_name ?? ''), direction,
            warehouse_type: whType, vehicle_type: vtName,
            ncc_code: nccCode, ncc_id: nccId, order_code: orderCode,
            planned_boxes: boxesNum != null && !isNaN(boxesNum) ? boxesNum : null,
            planned_pallets: palletsNum != null && !isNaN(palletsNum) ? palletsNum : null,
            planned_tons: tonsNum != null && !isNaN(tonsNum) ? tonsNum : null,
            gdo_refs: String(norm.gdo_refs ?? ''), notes: String(norm.notes ?? ''),
            priority: parsePriority(norm.priority),
            valid: errors.length === 0, error: errors.join(', '),
          }
        })
        setRows(parsed); setErr('')
      } catch { setErr('Không đọc được file. Vui lòng dùng định dạng .xlsx hoặc .xls') }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  const handleImport = async () => {
    if (!rows.length) { setErr('Chưa có dữ liệu'); return }
    if (rows.some(r => !r.valid)) { setErr('File có dòng lỗi — vui lòng sửa và upload lại'); return }
    setImporting(true)
    try {
      const data = await bulkCreate.mutateAsync(rows.map(r => ({
        order_code: r.order_code, date: r.date!, warehouse_id: r.warehouse_id!,
        npp_name: r.npp_name || null, ncc_id: r.ncc_id || null,
        direction: r.direction || null, warehouse_type: r.warehouse_type || null,
        vehicle_type: r.vehicle_type || null,
        planned_boxes: r.planned_boxes, planned_pallets: r.planned_pallets, planned_tons: r.planned_tons,
        gdo_refs: r.gdo_refs || null, notes: r.notes || null,
        priority: r.priority,
      })))
      setResult({ inserted: data.inserted })
    } catch (e: unknown) {
      const resp = (e as { response?: { status?: number; data?: { error?: { message?: string } } } })?.response
      const msg = resp?.data?.error?.message
        ?? (resp?.status === 413
          ? 'File quá lớn — vui lòng tách thành nhiều file nhỏ hơn rồi upload từng file'
          : 'Lỗi import')
      const dupMatch = msg.match(/Mã đơn đã tồn tại: (.+)/)
      if (dupMatch) {
        // BE giờ kèm vị trí "(kho — ngày ...)" sau mỗi mã → lấy phần mã trước khoảng trắng/ngoặc.
        const dupCodes = new Set(dupMatch[1].split(',').map((c: string) => c.trim().split(/[\s(]/)[0].toUpperCase()).filter(Boolean))
        setRows(prev => prev.map(r =>
          r.order_code && dupCodes.has(r.order_code.toUpperCase())
            ? { ...r, valid: false, error: 'mã đơn đã tồn tại trong hệ thống' } : r
        ))
      }
      setErr(msg)
    } finally { setImporting(false) }
  }

  const downloadTemplate = () => {
    // Ngày + ddmmyy động (ngày mai) để mẫu không quá khứ; Mã đơn đúng format Mãkho_X_ddmmyy_stt; Loại kho/xe/ĐVVT hợp lệ.
    const d = new Date(); d.setDate(d.getDate() + 1)
    const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0'), yyyy = d.getFullYear()
    const ddmmyy = `${dd}${mm}${String(yyyy).slice(2)}`
    const ws = XLSX.utils.aoa_to_sheet([
      ['Mã đơn', 'NPP', 'Kho', 'Ngày', 'Hướng', 'Loại kho', 'Loại xe', 'ĐVVT', 'Thùng', 'Pallet', 'Tấn', 'GDO', 'Ghi chú', 'Ưu tiên'],
      [`20000016_X_${ddmmyy}_1`, 'Tên NPP mẫu', 'Kho Ba Vì', `${dd}/${mm}/${yyyy}`, 'Xuất', 'Thành phẩm', 'XE 4 PALLET', '3S', 100, 5, 2.5, 'GDO-001', '', ''],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Import')
    saveWorkbook(wb, 'mau_ke_hoach_vc.xlsx')
  }

  const errorCount = rows.filter(r => !r.valid).length

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Upload kế hoạch từ Excel</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          {result ? (
            <div className="bg-green-50 border border-green-200 rounded p-4 text-sm text-green-800">
              <p className="font-medium">Import thành công!</p>
              <p>Đã thêm <strong>{result.inserted}</strong> đơn hàng.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5 mr-1" />Chọn file Excel
                </Button>
                <Button variant="outline" size="sm" onClick={downloadTemplate}>
                  <Download className="h-3.5 w-3.5 mr-1" />Tải mẫu
                </Button>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
                {rows.length > 0 && (
                  <span className="text-xs text-slate-500">
                    {rows.length} dòng
                    {errorCount > 0
                      ? <> · <span className="text-red-600 font-medium">{errorCount} lỗi</span> · chỉ hiện dòng lỗi bên dưới</>
                      : <> · <span className="text-green-600 font-medium">Tất cả hợp lệ</span></>}
                  </span>
                )}
              </div>
              {rows.length > 0 && (
                <div className="max-h-64 overflow-auto rounded border">
                  <table className="min-w-full text-[10px]">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        {['#', 'Mã đơn', 'NPP', 'Kho', 'Ngày', 'Hướng', 'L.kho', 'L.xe', 'ĐVVT', 'Thùng', 'Pallet', 'Tấn', 'UT', 'Lỗi'].map(h => (
                          <th key={h} className="px-2 py-1 text-left text-[9px] text-slate-500 font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => ({ r, i })).filter(x => errorCount === 0 || !x.r.valid).map(({ r, i }) => (
                        <tr key={i} className={r.valid ? '' : 'bg-red-50'}>
                          <td className="px-2 py-0.5 text-slate-400">{i + 1}</td>
                          <td className="px-2 py-0.5 font-mono">{r.order_code || '—'}</td>
                          <td className="px-2 py-0.5 max-w-[100px] truncate">{r.npp_name || '—'}</td>
                          <td className="px-2 py-0.5">{r.warehouse_name || '—'}</td>
                          <td className="px-2 py-0.5 font-mono">{r.date || '—'}</td>
                          <td className="px-2 py-0.5">
                            {r.direction === 'OUTBOUND' ? <span className="text-orange-600">Xuất</span>
                              : r.direction === 'INBOUND' ? <span className="text-teal-600">Nhập</span>
                              : <span className="text-red-500">—</span>}
                          </td>
                          <td className="px-2 py-0.5">{r.warehouse_type || '—'}</td>
                          <td className="px-2 py-0.5">{r.vehicle_type || '—'}</td>
                          <td className="px-2 py-0.5">{r.ncc_code || '—'}</td>
                          <td className="px-2 py-0.5 tabular-nums">{r.planned_boxes ?? '—'}</td>
                          <td className="px-2 py-0.5 tabular-nums">{r.planned_pallets ?? '—'}</td>
                          <td className="px-2 py-0.5 tabular-nums">{r.planned_tons ?? '—'}</td>
                          <td className="px-2 py-0.5 text-red-600 font-semibold">{r.priority ? 'x' : ''}</td>
                          <td className="px-2 py-0.5 text-red-500">{r.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {err && <p className="text-xs text-red-600">{err}</p>}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => { reset(); onClose() }}>Đóng</Button>
          {!result && rows.length > 0 && errorCount === 0 && (
            <Button size="sm" onClick={handleImport} disabled={importing}>
              {importing && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              {importing ? 'Đang import...' : `Import ${rows.length} đơn`}
            </Button>
          )}
          {result && <Button size="sm" onClick={onClose}>Xong</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Slot Overview Dialog ──────────────────────────────────────────────────────

// Màu cho từng loại xe — đủ màu cho ~8 loại xe khác nhau, cycle nếu nhiều hơn
const VT_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-teal-100 text-teal-700',
  'bg-rose-100 text-rose-700',
  'bg-indigo-100 text-indigo-700',
  'bg-emerald-100 text-emerald-700',
  'bg-cyan-100 text-cyan-700',
  'bg-violet-100 text-violet-700',
]

function SlotOverviewDialog({ open, onClose, defaultDate, warehouseId, warehouseName }: {
  open: boolean; onClose: () => void
  defaultDate: string; warehouseId: string; warehouseName: string
}) {
  const [date, setDate] = useState(defaultDate)
  const [vtFilter, setVtFilter] = useState<string[]>([])

  useEffect(() => { if (open) { setDate(defaultDate); setVtFilter([]) } }, [open])

  const { data: slotsData = [], isLoading } = useDeliverySlots(
    open && warehouseId ? { date, warehouse_id: warehouseId } : undefined
  )
  const slots = slotsData as DeliverySlot[]

  // Map loại xe → màu cố định (theo thứ tự tên sorted)
  const vtColorMap = useMemo<Record<string, string>>(() => {
    const names = [...new Set(slots.filter(s => s.vehicle_type?.name).map(s => s.vehicle_type!.name))].sort()
    return Object.fromEntries(names.map((n, i) => [n, VT_COLORS[i % VT_COLORS.length]]))
  }, [slots])

  const vtOptions = useMemo<MSOpt[]>(() =>
    [...new Map(slots.filter(s => s.vehicle_type?.name)
      .map(s => [s.vehicle_type!.name, { value: s.vehicle_type!.name, label: s.vehicle_type!.name }])
    ).values()],
    [slots]
  )

  const filtered = useMemo(() =>
    vtFilter.length ? slots.filter(s => s.vehicle_type?.name && vtFilter.includes(s.vehicle_type.name)) : slots,
    [slots, vtFilter]
  )

  // Sort: Loại kho → Loại xe → Khung giờ
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const ca = a.cargo_type === 'ALL' ? '' : a.cargo_type
    const cb = b.cargo_type === 'ALL' ? '' : b.cargo_type
    if (ca !== cb) return ca.localeCompare(cb)
    const va = a.vehicle_type?.name ?? ''
    const vb = b.vehicle_type?.name ?? ''
    if (va !== vb) return va.localeCompare(vb)
    return a.time_from.localeCompare(b.time_from)
  }), [filtered])

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="flex flex-col w-full sm:w-1/2 h-screen max-w-none max-h-none rounded-none m-0 p-0 top-0 left-0 translate-x-0 translate-y-0 sm:left-auto sm:right-0 [&>button:last-child]:hidden">
        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b bg-white">
          <DialogTitle className="text-sm font-semibold truncate">Tình trạng khung giờ — {warehouseName}</DialogTitle>
          <Button variant="ghost" size="sm" onClick={onClose} className="ml-3 h-7 w-7 p-0 shrink-0">✕</Button>
        </div>
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b bg-white flex-wrap">
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-7 text-xs w-32 shrink-0" />
          <MultiSelectFilter label="Loại xe" options={vtOptions} selected={vtFilter} onChange={setVtFilter} />
          {!isLoading && <span className="text-[10px] text-slate-400 ml-auto">{sorted.length} khung giờ</span>}
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {isLoading ? (
            <p className="text-[10px] text-slate-400 text-center py-10">Đang tải...</p>
          ) : sorted.length === 0 ? (
            <p className="text-[10px] text-slate-400 text-center py-10">Chưa có khung giờ nào</p>
          ) : (
            <table className="min-w-max w-full">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  <th className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap">Loại kho</th>
                  <th className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap">Loại xe</th>
                  <th className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap">Khung giờ</th>
                  <th className="px-2 py-1.5 text-right text-[9px] font-medium text-slate-500 whitespace-nowrap">Đã đặt</th>
                  <th className="px-2 py-1.5 text-right text-[9px] font-medium text-slate-500 whitespace-nowrap">Tối đa</th>
                  <th className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap w-24">Lấp đầy</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(s => {
                  const pct = s.max_vehicles > 0 ? s.booked_count / s.max_vehicles : 0
                  const full = s.booked_count >= s.max_vehicles
                  const rowCls = full ? 'bg-red-50 hover:bg-red-100' : pct >= 0.7 ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-slate-50'
                  const vtColor = s.vehicle_type?.name ? (vtColorMap[s.vehicle_type.name] ?? 'bg-slate-100 text-slate-600') : ''
                  return (
                    <tr key={s.id} className={rowCls}>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${s.cargo_type === 'ALL' ? 'bg-slate-100 text-slate-600' : 'bg-orange-100 text-orange-700'}`}>
                          {s.cargo_type === 'ALL' ? 'Tất cả' : s.cargo_type}
                        </span>
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {s.vehicle_type?.name && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${vtColor}`}>{s.vehicle_type.name}</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{s.time_from.slice(0, 5)}–{s.time_to.slice(0, 5)}</td>
                      <td className="px-2 py-1 text-[10px] font-semibold tabular-nums text-right whitespace-nowrap">
                        <span className={full ? 'text-red-600' : 'text-green-600'}>{s.booked_count}</span>
                      </td>
                      <td className="px-2 py-1 text-[10px] tabular-nums text-right text-slate-500 whitespace-nowrap">{s.max_vehicles}</td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-1">
                          <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden shrink-0">
                            <div className={`h-full rounded-full ${pct >= 1 ? 'bg-red-400' : pct >= 0.7 ? 'bg-amber-400' : 'bg-green-400'}`}
                              style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                          </div>
                          <span className="text-[10px] tabular-nums text-slate-500 shrink-0">{s.max_vehicles > 0 ? Math.round(pct * 100) : 0}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Change Date Dialog (bulk) ─────────────────────────────────────────────────

function ChangeDateDialog({ open, orderIds, currentDate, onClose }: {
  open: boolean; orderIds: string[]; currentDate: string; onClose: () => void
}) {
  const bulkUpdateDate = useBulkUpdateOrderDate()
  const [newDate, setNewDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { if (open) { setNewDate(''); setErr('') } }, [open])

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

  const handleSave = async () => {
    if (!newDate) { setErr('Vui lòng chọn ngày mới'); return }
    if (newDate < today) { setErr('Không thể đổi sang ngày đã qua'); return }
    if (newDate === currentDate) { setErr('Ngày mới phải khác ngày hiện tại'); return }
    setSaving(true)
    try {
      await bulkUpdateDate.mutateAsync({ ids: orderIds, date: newDate })
      onClose()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setErr(msg ?? 'Lỗi đổi ngày')
    } finally { setSaving(false) }
  }

  return (
    <FormSheet
      open={open}
      onClose={() => onClose()}
      title="Đổi ngày"
      description={<>{orderIds.length} đơn · Ngày hiện tại: <span className="font-mono">{formatDate(currentDate)}</span></>}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Hủy</Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Đang lưu...' : `Đổi ${orderIds.length} đơn`}
        </Button>
      </>}
    >
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Ngày mới *</Label>
            <Input type="date" value={newDate} min={today} onChange={e => setNewDate(e.target.value)} className="h-8 text-sm mt-1" />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
    </FormSheet>
  )
}

// ── Inbound Plan Bulk Upload Dialog (upload Excel toàn bộ KH nhập — list page) ─

type PlanBulkRow = {
  date: string
  ncc_code: string; ncc_id: string
  kho_code: string; kho_id: string
  warehouse_type: string; vehicle_type: string
  material_code: string; material_id: string
  po_number: string; planned_boxes: number | null; planned_pallets: number | null
  _valid: boolean; _error: string
}

function InboundPlanBulkUploadDialog({ open, warehouseId, onClose }: {
  open: boolean; warehouseId: string; onClose: () => void
}) {
  const { data: transportCompanies = [] } = useTransportCompanies(true)
  const { data: materials = [] }          = useMaterials()
  const { data: warehouses = [] }         = useWarehouses(true)
  const { data: vehicleTypes = [] }       = useVehicleTypes(true)
  const bulkCreate = useBulkCreatePlanLines()

  const [preview, setPreview] = useState<PlanBulkRow[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [err, setErr]           = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Nhận CẢ mã lẫn tên (normalize trim + uppercase)
  const nccByCode = new Map(
    (transportCompanies as import('@/types').TransportCompany[])
      .filter((c) => c.type === 'NCC')
      .flatMap((c) => [
        [String(c.code ?? '').trim().toUpperCase(), c.id] as [string, string],
        [String(c.name ?? '').trim().toUpperCase(), c.id] as [string, string],
        ...((c.alias_codes ?? []).map(a => [String(a).trim().toUpperCase(), c.id] as [string, string])),
      ].filter(([k]) => k))
  )
  const whByCode  = new Map<string, string>()
  ;(warehouses as { code: string; name: string; id: string; shipto_codes?: string[] | null }[]).forEach(w => {
    whByCode.set(String(w.code).trim().toUpperCase(), w.id)
    const nameKey = String(w.name ?? '').trim().toUpperCase()
    if (nameKey) whByCode.set(nameKey, w.id)
    ;(w.shipto_codes ?? []).forEach(s => { const k = String(s).trim().toUpperCase(); if (k) whByCode.set(k, w.id) })
  })
  const vtNameSet = new Set((vehicleTypes as import('@/types').TmsVehicleType[]).map(vt => String(vt.name)))
  const matByCode = new Map(
    (materials as import('@/types').Material[]).map(m => [
      String(m.material_code).trim(),
      { id: m.id, category: m.category ?? '' },
    ])
  )

  function parseFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
        const parsed: PlanBulkRow[] = rows.map((row, i) => {
          const rowDate  = parseExcelDate(row['Ngày'] ?? row['Ngay'] ?? row['date'] ?? '')
          const khoCode  = String(row['Mã kho']    ?? row['Kho']        ?? row['kho_code']   ?? '').trim().toUpperCase()
          const nccCode  = String(row['Mã NCC']    ?? row['NCC']        ?? row['ncc_code'] ?? '').trim().toUpperCase()
          const vt       = String(row['Loại xe']   ?? row['vehicle_type']   ?? '').trim()
          const matCode  = String(row['Mã hàng']   ?? row['material_code']  ?? '').trim()
          const po       = String(row['Số PO']     ?? row['PO']             ?? row['po_number'] ?? '').trim()
          const boxes    = row['Số thùng']  ?? row['planned_boxes']   ?? null
          const pallets  = row['Số pallet'] ?? row['planned_pallets'] ?? null

          const khoId   = khoCode ? (whByCode.get(khoCode) ?? '') : warehouseId
          const nccId   = nccByCode.get(nccCode) ?? ''
          const matInfo = matByCode.get(matCode)
          const matId   = matInfo?.id ?? ''
          const whType  = matInfo?.category ?? '' // Loại kho tự suy từ Mã hàng

          let error = ''
          if (!rowDate)                               error = `Dòng ${i + 2}: thiếu/sai Ngày (dd/mm/yyyy)`
          else if (!nccCode)                          error = `Dòng ${i + 2}: thiếu Mã NCC`
          else if (!nccId)                            error = `Dòng ${i + 2}: NCC "${nccCode}" không tìm thấy (mã hoặc tên)`
          else if (khoCode && !whByCode.has(khoCode)) error = `Dòng ${i + 2}: kho "${khoCode}" không tìm thấy (mã hoặc tên)`
          else if (vt && !vtNameSet.has(vt))          error = `Dòng ${i + 2}: Loại xe "${vt}" không hợp lệ`
          else if (!matCode)                          error = `Dòng ${i + 2}: thiếu Mã hàng`
          else if (!matId)                            error = `Dòng ${i + 2}: hàng "${matCode}" không tìm thấy`

          return {
            date: rowDate ?? '',
            ncc_code: nccCode, ncc_id: nccId,
            kho_code: khoCode, kho_id: khoId,
            warehouse_type: whType, vehicle_type: vt,
            material_code: matCode, material_id: matId,
            po_number: po,
            planned_boxes:   boxes   != null && boxes   !== '' ? Number(boxes)   : null,
            planned_pallets: pallets != null && pallets !== '' ? Number(pallets) : null,
            _valid: !error, _error: error,
          }
        }).filter(r => r.date || r.ncc_code || r.material_code)
        setPreview(parsed)
        setErr('')
      } catch { setErr('Không đọc được file Excel') }
    }
    reader.readAsBinaryString(file)
  }

  async function handleConfirm() {
    if (!preview) return
    const valid = preview.filter(r => r._valid)
    if (!valid.length) { setErr('Không có dòng hợp lệ nào'); return }
    try {
      // BASE UNIT: cột "Số thùng" trong file = THÙNG NGUYÊN → quy đổi base theo hệ số mã
      const lines = valid.map(r => ({
        date:            r.date,
        warehouse_id:    r.kho_id   || warehouseId,
        warehouse_type:  r.warehouse_type  || null,
        vehicle_type:    r.vehicle_type    || null,
        ncc_id:          r.ncc_id          || null,
        material_id:     r.material_id     || null,
        po_number:       r.po_number       || null,
        planned_boxes:   r.planned_boxes != null ? qtyFromEntryBase(Number(r.planned_boxes), 0, (materials as import('@/types').Material[]).find(m => m.id === r.material_id) ?? null) : null,
        planned_pallets: r.planned_pallets,
      }))
      await bulkCreate.mutateAsync(lines)
      setPreview(null); setFileName(''); onClose()
    } catch (e) {
      const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message
      setErr(msg ?? 'Lỗi upload')
    }
  }

  function downloadTemplate() {
    const data = [
      { 'Ngày': '10/07/2026', 'Mã kho': 'KHO1', 'Mã NCC': 'FAST', 'Loại xe': 'PALLET', 'Mã hàng': '510000127', 'Số PO': 'PO-0001', 'Số thùng': 500, 'Số pallet': 10 },
    ]
    const ws = XLSX.utils.json_to_sheet(sanitizeRows(data))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'KH Nhập ngoài')
    saveWorkbook(wb, 'template_ke_hoach_nhap.xlsx')
  }

  function handleClose() { setPreview(null); setFileName(''); setErr(''); onClose() }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileSpreadsheet className="h-4 w-4" /> Upload kế hoạch nhập
          </DialogTitle>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-3 py-2 text-xs">
            <p className="text-slate-500">
              Cột bắt buộc: <strong>Ngày</strong> (dd/mm/yyyy), <strong>Mã NCC</strong> (nhận mã hoặc tên), <strong>Mã hàng</strong>, <strong>Số thùng</strong>.
              Tuỳ chọn: Mã kho (mã hoặc tên; trống = kho đang chọn), Loại xe, Số PO, Số pallet.
              Loại kho tự suy từ Mã hàng.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> Tải template
              </Button>
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Chọn file
              </Button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) { setFileName(f.name); parseFile(f) } }}
              />
            </div>
            {fileName && <p className="text-slate-500">File: {fileName}</p>}
            {err && <p className="text-red-500">{err}</p>}
          </div>
        ) : (
          <div className="space-y-2 py-1 text-xs">
            <div className="flex items-center justify-between">
              <p className="text-slate-500">{preview.filter(r => r._valid).length}/{preview.length} dòng hợp lệ</p>
              <Button variant="ghost" size="sm" onClick={() => { setPreview(null); setFileName('') }}>
                <X className="h-3.5 w-3.5 mr-1" /> Chọn lại
              </Button>
            </div>
            <div className="max-h-64 overflow-auto border rounded-md">
              <table className="min-w-full text-[10px]">
                <thead className="sticky top-0 bg-slate-50 border-b">
                  <tr>
                    {['Ngày', 'Kho', 'NCC', 'Loại kho', 'Loại xe', 'Mã hàng', 'Thùng', 'Trạng thái'].map(h => (
                      <th key={h} className="px-2 py-1 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className={r._valid ? 'hover:bg-slate-50' : 'bg-red-50'}>
                      <td className="px-2 py-1 whitespace-nowrap">{r.date ? formatDate(r.date) : '—'}</td>
                      <td className="px-2 py-1 font-mono text-[9px] text-slate-400">{r.kho_code || '(mặc định)'}</td>
                      <td className="px-2 py-1 font-mono">{r.ncc_code || '—'}</td>
                      <td className="px-2 py-1">{r.warehouse_type || '—'}</td>
                      <td className="px-2 py-1">{r.vehicle_type || '—'}</td>
                      <td className="px-2 py-1 font-mono">{r.material_code || '—'}</td>
                      <td className="px-2 py-1 tabular-nums text-right">{r.planned_boxes ?? '—'}</td>
                      <td className="px-2 py-1">
                        {r._valid
                          ? <span className="text-green-600">✓</span>
                          : <span className="text-red-500 text-[9px]">{r._error}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {err && <p className="text-red-500 text-xs">{err}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleClose}>Hủy</Button>
          {preview && (
            <Button size="sm" onClick={handleConfirm}
              disabled={bulkCreate.isPending || preview.filter(r => r._valid).length === 0}>
              {bulkCreate.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              {bulkCreate.isPending ? 'Đang lưu...' : `Lưu ${preview.filter(r => r._valid).length} dòng`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Upload Plan Lines Dialog (cho INBOUND booking) ───────────────────────────

function UploadPlanLinesDialog({ orderId, warehouseType, existingCodes, onClose }: {
  orderId: string
  warehouseType?: string
  existingCodes?: Set<string>
  onClose: () => void
}) {
  const [rows, setRows] = useState<{ material_code: string; material_id?: string; planned_boxes: number; planned_pallets?: number; err?: string }[]>([])
  const [dupError, setDupError] = useState('')
  const [saving, setSaving] = useState(false)
  const [apiError, setApiError] = useState('')
  const { mutateAsync: bulkCreate } = useBulkCreatePlanLinesForOrder()
  const { data: materials = [] } = useMaterials()

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setDupError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target?.result, { type: 'binary' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][]
      const parsed = (raw.slice(1) as unknown[][])
        .filter(r => r[0])
        .map(r => {
          const material_code = String(r[0] ?? '').trim()
          const planned_boxes = Number(r[1] ?? 0)
          const planned_pallets = r[2] != null && r[2] !== '' ? Number(r[2]) : undefined
          const mat = (materials as import('@/types').Material[]).find(m =>
            m.material_code === material_code &&
            (!warehouseType || m.category === warehouseType)
          )
          const notFound = !(materials as import('@/types').Material[]).find(m => m.material_code === material_code)
          return {
            material_code,
            material_id: mat?.id,
            planned_boxes,
            planned_pallets,
            err: notFound
              ? 'Không tìm thấy mã hàng'
              : !mat
                ? `Mã hàng không thuộc loại kho ${warehouseType}`
                : planned_boxes <= 0
                  ? 'SL thùng phải > 0'
                  : undefined,
          }
        })
      // Detect duplicates within file
      const codeCount = new Map<string, number>()
      for (const r of parsed) { codeCount.set(r.material_code, (codeCount.get(r.material_code) ?? 0) + 1) }
      const dupInFile = [...codeCount.entries()].filter(([, n]) => n > 1).map(([c]) => c)
      // Detect duplicates vs existing plan lines
      const dupVsExisting = existingCodes ? parsed.map(r => r.material_code).filter(c => existingCodes.has(c)) : []
      const allDups = [...new Set([...dupInFile, ...dupVsExisting])]
      if (allDups.length > 0) {
        setDupError(`File bị block — mã hàng trùng: ${allDups.join(', ')}`)
      }
      setRows(parsed)
    }
    reader.readAsBinaryString(f)
  }

  async function handleSave() {
    if (dupError) return
    const valid = rows.filter(r => !r.err && r.material_id)
    if (!valid.length) return
    setSaving(true)
    setApiError('')
    try {
      await bulkCreate({
        tms_order_id: orderId,
        lines: valid.map(r => ({ material_id: r.material_id!, planned_boxes: r.planned_boxes, ...(r.planned_pallets != null ? { planned_pallets: r.planned_pallets } : {}) })),
      })
      onClose()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setApiError(err.response?.data?.error?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  const validCount = dupError ? 0 : rows.filter(r => !r.err).length
  const errCount   = rows.filter(r => r.err).length

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Upload danh sách hàng</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <p className="text-slate-500">
            File Excel: cột A = <span className="font-mono">Mã hàng</span> · cột B = <span className="font-mono">SL thùng</span> · cột C = <span className="font-mono">SL pallet</span> (tùy chọn). Hàng đầu là tiêu đề, bỏ qua.
            {warehouseType && <> · Chỉ nhận hàng loại <span className="font-medium text-slate-700">{warehouseType}</span>.</>}
          </p>
          <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="text-xs" />
          {dupError && <p className="text-red-600 text-[11px] bg-red-50 border border-red-200 px-3 py-2 rounded">{dupError}</p>}
          {rows.length > 0 && (
            <>
              <div className="flex gap-3 text-[10px]">
                {!dupError && <span className="text-green-600 font-medium">{validCount} dòng hợp lệ</span>}
                {errCount > 0 && <span className="text-red-500">{errCount} dòng lỗi</span>}
              </div>
              <div className="rounded border overflow-auto max-h-52">
                <table className="min-w-full">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      {['Mã hàng', 'SL thùng', 'SL pl', 'Trạng thái'].map(h => (
                        <th key={h} className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className={`border-t border-slate-100 ${r.err ? 'bg-red-50' : ''}`}>
                        <td className="px-2 py-1 font-mono font-semibold text-[10px]">{r.material_code}</td>
                        <td className="px-2 py-1 text-[10px] tabular-nums">{r.planned_boxes}</td>
                        <td className="px-2 py-1 text-[10px] tabular-nums">{r.planned_pallets ?? '—'}</td>
                        <td className="px-2 py-1 text-[10px]">
                          {r.err ? <span className="text-red-500">{r.err}</span> : <span className="text-green-600">OK</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {apiError && <p className="text-red-500 text-xs bg-red-50 px-3 py-2 rounded">{apiError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Hủy</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || validCount === 0 || !!dupError}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            {saving ? 'Đang lưu...' : `Lưu ${validCount} dòng`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Transfer Orders Panel ─────────────────────────────────────────────────────

const TRANSFER_STATUS_CFG: Record<string, { label: string; cls: string }> = {
  PENDING_DELIVERY: { label: 'Chờ giao',        cls: 'bg-amber-100 text-amber-700' },
  IN_TRANSIT:       { label: 'Đang vận chuyển', cls: 'bg-blue-100 text-blue-700' },
  RECEIVING:        { label: 'Đang nhận',        cls: 'bg-green-100 text-green-700' },
  DELIVERED:        { label: 'Đã giao',          cls: 'bg-slate-100 text-slate-600' },
}

// Band tổng hợp theo MÃ HÀNG (KH · thực tế · chênh lệch) để tra cứu — kiểu expand "Phân bổ theo NPP" của Outbound.
// orderIds = các đơn ĐÃ lọc trên UI; có ô tìm mã hàng/tên để tra cứu nhanh. Tổng ở header tính trên dòng đã lọc.
function MaterialSummaryBand({ orderIds }: { orderIds: string[] }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const { data: rows = [], isFetching } = useMaterialSummary(orderIds, orderIds.length > 0)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(r => r.material_code.toLowerCase().includes(s) || r.material_name.toLowerCase().includes(s))
  }, [rows, q])
  const totals = useMemo(() => filtered.reduce(
    (a, r) => ({ planned: a.planned + r.planned_boxes, actual: a.actual + r.actual_boxes, diff: a.diff + r.diff }),
    { planned: 0, actual: 0, diff: 0 }), [filtered])
  const fmtDiff = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('vi-VN')}`

  if (orderIds.length === 0) return null
  return (
    <div className="border-b border-slate-200 bg-white shrink-0">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 text-left">
        <Boxes className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <span>Tổng hợp mã hàng ({rows.length} mã) · KH {totals.planned.toLocaleString('vi-VN')} · thực tế {totals.actual.toLocaleString('vi-VN')} · chênh lệch {fmtDiff(totals.diff)} thùng</span>
        {q.trim() && <span className="text-blue-600">· lọc “{q.trim()}”</span>}
        {isFetching && <span className="text-slate-400">· đang tải…</span>}
        <ChevronDown className={`h-3.5 w-3.5 ml-auto shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="max-h-64 overflow-auto">
          <div className="sticky top-0 z-10 bg-white px-3 py-1.5 border-b border-slate-100">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm mã hàng / tên hàng…"
              className="w-full max-w-xs h-7 px-2 text-xs border border-slate-200 rounded outline-none focus:border-blue-400" />
          </div>
          {rows.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">{isFetching ? 'Đang tải…' : 'Không có dòng hàng nào'}</div>
          ) : (
            <table className="w-full [&_td]:border-t [&_td]:border-slate-100">
              <thead className="sticky top-[42px] z-10 bg-slate-50">
                <tr className="text-[9px] font-medium text-slate-500">
                  <th className="px-2 py-1 text-left whitespace-nowrap">Mã hàng</th>
                  <th className="px-2 py-1 text-left whitespace-nowrap">Tên hàng</th>
                  <th className="px-2 py-1 text-left whitespace-nowrap">ĐVT</th>
                  <th className="px-2 py-1 text-right whitespace-nowrap">KH</th>
                  <th className="px-2 py-1 text-right whitespace-nowrap">Thực tế</th>
                  <th className="px-2 py-1 text-right whitespace-nowrap">CL</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const diffCls = r.diff === 0 ? 'text-green-700' : r.diff > 0 ? 'text-amber-600' : 'text-red-600'
                  return (
                    <tr key={r.material_id} className="text-[10px] hover:bg-slate-50">
                      <td className="px-2 py-1 whitespace-nowrap font-mono font-semibold">{r.material_code || <span className="text-slate-300">—</span>}</td>
                      <td className="px-2 py-1 max-w-[220px] truncate" title={r.material_name}>{r.material_name || <span className="text-slate-300">—</span>}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-slate-400">{r.unit || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-right tabular-nums">{r.planned_boxes.toLocaleString('vi-VN')}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-right tabular-nums">{r.actual_boxes.toLocaleString('vi-VN')}</td>
                      <td className={`px-2 py-1 whitespace-nowrap text-right tabular-nums font-semibold ${diffCls}`}>{fmtDiff(r.diff)}</td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-2 py-4 text-center text-xs text-slate-400">Không khớp “{q.trim()}”</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ── Transport Update Dialog (biển số + SĐT + Dự kiến giao) ──────────────────

function TransportUpdateDialog({ order, onClose }: { order: TransferOrder | null; onClose: () => void }) {
  const updateOrder = useUpdateOrder()
  const updateSlot  = useUpdateVehicleSlot()

  // Gợi ý biển số theo ĐVVT: ưu tiên ncc_id, nếu transfer order chỉ có tên (dvvt từ Outbound) thì khớp theo tên.
  const { data: allCompanies = [] } = useTransportCompanies(true)
  const dvvtName = order?.ncc?.name ?? order?.transfer_gdo?.dvvt ?? ''
  const resolvedNccId = order?.ncc?.id ?? allCompanies.find(c => c.name === dvvtName)?.id ?? null
  const { data: dvvtVehicles = [] } = useTmsVehicles(resolvedNccId ? { ncc_id: resolvedNccId, is_active: 'true', pool_branches: 'true' } : undefined)

  const [licensePlate, setPlate]    = useState('')
  const [driverPhone, setPhone]     = useState('')
  const [eta, setEta]               = useState('')
  const [notes, setNotes]           = useState('')
  const [err, setErr]               = useState('')
  const saving = updateOrder.isPending || updateSlot.isPending

  // min ETA = ngày bốc hàng (delivery_date của GDO)
  const minEta = order?.transfer_gdo?.delivery_date ? `${order.transfer_gdo.delivery_date}T00:00` : ''

  useEffect(() => {
    if (order) {
      const slot = order.vehicle_slots?.[0]
      setPlate(slot?.license_plate ?? order.transfer_gdo?.license_plate ?? '')
      setPhone(slot?.driver_phone ?? '')
      setEta(order.eta ? order.eta.slice(0, 16) : '')
      setNotes(order.notes ?? '')
      setErr('')
    }
  }, [order?.id])

  const handleSave = async () => {
    if (!order) return
    if (!licensePlate.trim() || !driverPhone.trim() || !eta) {
      setErr('Cần đủ Biển số, SĐT lái xe và Giờ xe tới để hoàn tất booking')
      return
    }
    if (!isValidPhone(driverPhone)) {
      setErr('SĐT lái xe phải đủ 10 chữ số')
      return
    }
    if (minEta && eta < minEta) {
      setErr(`Thời gian giao không được trước ngày bốc hàng (${order.transfer_gdo?.delivery_date ?? ''})`)
      return
    }
    if (new Date(eta).getTime() < Date.now()) {
      setErr('Giờ xe tới không được ở quá khứ')
      return
    }
    try {
      const isoEta = eta ? new Date(eta).toISOString() : null
      await updateOrder.mutateAsync({ id: order.id, eta: isoEta, notes: notes || null })
      const slot = order.vehicle_slots?.[0]
      if (slot) {
        await updateSlot.mutateAsync({ id: slot.id, license_plate: licensePlate || null, driver_phone: driverPhone || null })
      }
      onClose()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setErr(msg ?? 'Lỗi cập nhật')
    }
  }

  if (!order) return null
  const dvvtDisplay = order.ncc?.name ?? order.transfer_gdo?.dvvt ?? null
  return (
    <FormSheet
      open={!!order}
      onClose={() => onClose()}
      title="ĐVVT booking"
      description={<>{order.order_code} · {order.transfer_gdo?.warehouse?.name ?? '—'} → {transferDestLabel(order)}</>}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Hủy</Button>
        <Button size="sm" onClick={handleSave} disabled={saving || !licensePlate.trim() || !driverPhone.trim() || !eta}>
          {saving ? 'Đang lưu...' : 'Lưu'}
        </Button>
      </>}
    >
        <div className="space-y-3">
          <div>
            <Label className="text-xs">ĐVVT <span className="text-slate-400 font-normal">(từ Outbound)</span></Label>
            <div className="h-8 mt-1 px-3 flex items-center rounded-md border border-slate-200 bg-slate-50 text-sm text-slate-600">
              {dvvtDisplay ?? <span className="text-slate-400">—</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Biển số xe <span className="text-red-500">*</span></Label>
              <PlateCombobox value={licensePlate} onChange={setPlate}
                plates={(dvvtVehicles as TmsVehicle[]).map(v => v.license_plate)} />
            </div>
            <div>
              <Label className="text-xs">SĐT lái xe <span className="text-red-500">*</span></Label>
              <Input value={driverPhone} onChange={e => setPhone(normalizePhone(e.target.value))} inputMode="numeric" placeholder="09xxxxxxxx" className="h-8 text-sm mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">
              Giờ xe tới (dự kiến giao) <span className="text-red-500">*</span>
              {minEta && <span className="text-slate-400 font-normal ml-1">· không trước {order.transfer_gdo?.delivery_date}</span>}
            </Label>
            <Input type="datetime-local" value={eta} min={minEta} onChange={e => setEta(e.target.value)} className="h-8 text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs">Ghi chú <span className="text-slate-400 font-normal">(lái xe ghi chú cho NPP)</span></Label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Nhập ghi chú..."
              className="flex w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mt-1"
            />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
    </FormSheet>
  )
}

// ── Transfer Order Detail (slide-over dialog ~80% screen) ────────────────────

function TransferOrderDetail({ order, canEdit, canConfirmReceipt, onClose }: { order: TransferOrder | null; canEdit: boolean; canConfirmReceipt: boolean; onClose: () => void }) {
  const { data: goods = [], isLoading } = useTransferGoods(order?.id)
  const { data: activeImports = [] } = useActiveImportsByGdo(order?.transfer_gdo?.id)
  const hasActiveImports = activeImports.length > 0
  const [expandedMats, setExpandedMats] = useState<Set<string>>(new Set())
  const [showUpdate, setShowUpdate]     = useState(false)
  const [confirmErr, setConfirmErr]     = useState('')
  const { mutateAsync: confirmReceipt, isPending: confirming } = useConfirmTransferReceipt()
  const { mutateAsync: selfComplete,   isPending: selfCompleting } = useSelfCompleteTransfer()
  const { mutateAsync: cancelReceipt,  isPending: cancelling } = useCancelTransferReceipt()
  const { mutateAsync: createOneInbound, isPending: creatingInbound } = useCreateOneInbound()

  // ── Nhập hàng ngay tại panel (gọi đúng API Inbound) ──
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user  = useAuthStore(s => s.user)
  // Nhận hàng chuyển kho (quét + hoàn thành) thuộc quyền TMS "Xác nhận nhận hàng",
  // KHÔNG đòi quyền module Nhập kho (nút nằm trong tab Chuyển kho của TMS).
  const canScan     = canConfirmReceipt
  const canComplete = canConfirmReceipt
  const { mutateAsync: completeInbound } = useCompleteInboundOrder()
  const { mutateAsync: saveManual }      = useScanManualPallet()
  const { mutateAsync: cancelInbound }   = useCancelInboundOrder()
  const { mutateAsync: deleteEntry }     = useDeletePalletEntry()
  const [scanImportId, setScanImportId] = useState<string | null>(null)
  const [manualDraft,  setManualDraft]  = useState<Record<string, string>>({})
  const [nsxDraft,     setNsxDraft]     = useState<Record<string, string>>({})
  // Dialog "+ NSX": thêm dòng nhận NSX mới cho 1 mã (hàng về có NSX ngoài dữ liệu quét xuất)
  const [addNsx, setAddNsx] = useState<{ materialId: string; code: string; nsx: string; cartons: string } | null>(null)
  const [rowBusy,      setRowBusy]       = useState<string | null>(null)
  const [completeConfirm, setCompleteConfirm] = useState<{ impId: string; code: string; name: string; planned: number; actual: number } | null>(null)
  const [actionErr,    setActionErr]     = useState('')
  const [bulkConfirm,  setBulkConfirm]   = useState(false)
  const [bulkRunning,  setBulkRunning]   = useState(false)

  // material_id → CÁC phiếu nhập đang hoạt động (kho QTY_DATE: 1 phiếu / NSX → 1 mã có NHIỀU phiếu,
  // sort NSX cũ trước, phiếu không NSX cuối). Mode khác vẫn 1 phiếu/mã (imps[0]).
  const importsByMat = new Map<string, typeof activeImports>()
  for (const ai of activeImports) {
    const list = importsByMat.get(ai.material_id) ?? []
    list.push(ai)
    importsByMat.set(ai.material_id, list)
  }
  for (const list of importsByMat.values())
    list.sort((a, b) => ((a.transfer_production_date ?? '9999-99-99') < (b.transfer_production_date ?? '9999-99-99') ? -1 : 1))

  // Kho nhận theo dõi tồn SỐ LƯỢNG (QTY/QTY_DATE): nhận bằng số thùng, không quét pallet.
  // QTY_DATE: phiếu đã tách theo NSX (kế thừa tem quét xuất) → dòng NSX + nút "Nhận đủ theo xuất".
  const { data: whsForInternal = [] } = useWarehouses(true)
  const destWhFull = (whsForInternal as { id: string; parent_warehouse_id?: string | null; inventory_mode?: string | null }[]).find(w => w.id === order?.destination_warehouse_id)
  const destQtyLike = isQtyLike(destWhFull?.inventory_mode)
  const destQtyDate = destWhFull?.inventory_mode === 'QTY_DATE'
  const TODAY_VN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

  function refreshPanel() {
    qc.invalidateQueries({ queryKey: ['transfer-goods', order?.id] })
    qc.invalidateQueries({ queryKey: ['inbound-by-gdo', order?.transfer_gdo?.id] })
    qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
  }

  // Lưu số thùng 1 phiếu: ô số trống → dùng defaultVal (số theo xuất); kho QTY_DATE truyền kèm NSX
  // (phiếu đã gắn NSX thì BE tự dùng NSX phiếu, body chỉ là fallback cho phiếu không rõ NSX).
  async function handleManualConfirm(impId: string, defaultVal?: number | null, nsx?: string) {
    const v = manualDraft[impId] ?? (defaultVal != null ? String(defaultVal) : '')
    const c = Number(v)
    if (v === '' || isNaN(c) || c < 0) { setActionErr('Nhập số thùng hợp lệ'); return }
    setActionErr(''); setRowBusy(impId)
    try {
      await saveManual({ orderId: impId, cartons: c, employee_id: user?.id, ...(nsx ? { production_date: nsx } : {}) })
      setManualDraft(d => { const n = { ...d }; delete n[impId]; return n })
      refreshPanel()
    } catch (e) {
      const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message
      setActionErr(msg ?? 'Lỗi lưu số lượng')
    } finally { setRowBusy(null) }
  }

  async function handleCompleteOne(impId: string) {
    setActionErr(''); setRowBusy(impId)
    try {
      await completeInbound(impId)
      refreshPanel()
    } catch (e) {
      const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message
      setActionErr(msg ?? 'Lỗi hoàn thành phiếu')
    } finally { setRowBusy(null) }
  }

  // Xóa 1 dòng NSX (phiếu chưa lưu số) — dòng thừa so với hàng về thực tế
  async function handleCancelLine(impId: string, label: string) {
    if (!confirm(`Xóa dòng nhận ${label}?`)) return
    setActionErr(''); setRowBusy(impId)
    try { await cancelInbound(impId); refreshPanel() }
    catch (e) { setActionErr(errMsgOf(e)) } finally { setRowBusy(null) }
  }

  // Xóa số ĐÃ LƯU (chưa hoàn thành) → hoàn tồn, dòng quay về "Chờ nhận" để sửa số/NSX rồi Lưu lại
  async function handleUndoSaved(impId: string, entryId: string) {
    setActionErr(''); setRowBusy(impId)
    try { await deleteEntry({ orderId: impId, entryId, employeeId: user?.id }); refreshPanel() }
    catch (e) { setActionErr(errMsgOf(e)) } finally { setRowBusy(null) }
  }

  // ── "Nhận đủ theo xuất" (kho nhận QTY/QTY_DATE): 1 chạm lưu + hoàn thành MỌI phiếu đang mở theo
  // đúng số xuất; phiếu QTY_DATE dùng NSX đã kế thừa từ tem quét, phiếu không NSX dùng ô NSX đã hiện.
  // 409 lành tính (người khác vừa lưu/hoàn thành xong) coi như đạt mục tiêu, không báo lỗi oan.
  const errCodeOf = (e: unknown) => (e as AxiosError<{ error: { code?: string; message?: string } }>)?.response?.data?.error?.code
  const errMsgOf  = (e: unknown) => (e as AxiosError<{ error: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi'

  async function receiveAllPerPlan() {
    const targets = activeImports.filter(ai => ai.status === 'OPEN')
    if (!targets.length) { setBulkConfirm(false); return }
    setActionErr(''); setBulkRunning(true)
    const errs: string[] = []
    await Promise.all(targets.map(async ai => {
      try {
        const saved = !!ai.posm_entry_id || (ai.total_cartons ?? 0) > 0
        if (!saved && (ai.planned_cartons ?? 0) > 0) {
          // NSX người dùng đã chỉnh trong ô (draft) thắng; chưa chỉnh → NSX phiếu; không có → hôm nay
          const nsx = nsxDraft[ai.id] ?? ai.transfer_production_date ?? (destQtyDate ? TODAY_VN : undefined)
          try {
            await saveManual({ orderId: ai.id, cartons: ai.planned_cartons ?? 0, employee_id: user?.id, ...(nsx ? { production_date: nsx } : {}) })
          } catch (e) {
            if (errCodeOf(e) !== 'ALREADY_SAVED') throw e
          }
        }
        try { await completeInbound(ai.id) } catch (e) {
          if (errCodeOf(e) !== 'ALREADY_COMPLETED') throw e
        }
      } catch (e) {
        errs.push(`${ai.import_code}: ${errMsgOf(e)}`)
      }
    }))
    setBulkRunning(false); setBulkConfirm(false)
    if (errs.length) setActionErr(`Nhận chưa trọn ${errs.length}/${targets.length} phiếu — ${errs.join(' · ')}`)
    refreshPanel()
  }


  // Dòng xổ dưới mỗi mã: kho QTY_DATE = các dòng NSX (phiếu nhận); kho khác = pallet nguồn.
  // Mặc định THU GỌN (1 dòng/mã) — đơn 20-30 mã không tràn; "Nhận đủ theo xuất" nhận cả lô không cần xổ.
  const expandables = goods.filter(g => destQtyDate
    ? (importsByMat.get(g.material_id) ?? []).length > 0
    : g.pallets.length > 0)
  const hasExpandables = expandables.length > 0
  const allExpanded = hasExpandables && expandables.every(g => expandedMats.has(g.material_id))

  function toggleAllPallets() {
    if (allExpanded) {
      setExpandedMats(new Set())
    } else {
      setExpandedMats(new Set(expandables.map(g => g.material_id)))
    }
  }

  function toggleMat(matId: string) {
    setExpandedMats(prev => {
      const next = new Set(prev)
      next.has(matId) ? next.delete(matId) : next.add(matId)
      return next
    })
  }

  const slot = order?.vehicle_slots?.[0]
  // ĐVVT booking đủ = có Biển số + SĐT lái xe + Giờ xe tới (ETA). Chưa đủ → chưa cho bắt đầu nhận.
  // MIỄN booking khi kho nhận là KHO PHỤ NỘI BỘ của chính kho xuất (cùng site — xe nâng/đẩy tay, khớp BE confirmTransferReceipt).
  const isInternalDest = !!destWhFull?.parent_warehouse_id && destWhFull.parent_warehouse_id === order?.transfer_gdo?.warehouse?.id
  const hasBooking = isInternalDest || !!(slot?.license_plate?.trim() && slot?.driver_phone?.trim() && order?.eta)
  const tStatus = order?.transfer_gdo?.transfer_status
  // SELF (kho nhận NONE / khách ngoài): không có bước nhận-quét → thay "Bắt đầu nhận hàng" bằng "Hoàn thành" (tài xế tự hoàn thành)
  const isSelf = order?.delivery_mode === 'SELF'
  // Giữ trạng thái "đang bắt đầu nhận" liên tục từ lúc bấm tới khi panel chuyển sang RECEIVING
  // (tránh nút nháy về 'Bắt đầu nhận hàng' rồi mới đổi — do refetch trễ)
  const [starting, setStarting] = useState(false)
  useEffect(() => { if (tStatus && tStatus !== 'IN_TRANSIT') setStarting(false) }, [tStatus])
  // Cột Thao tác hiện khi có phiếu nhập (kể cả khi đã giao xong — để luôn mở được phiếu Inbound)
  const showActions = activeImports.length > 0
  // Chỉ cho quét/hoàn thành khi đang nhận hàng + có quyền
  const canReceiveNow = tStatus === 'RECEIVING' && canConfirmReceipt
  const missingMaterials = tStatus === 'RECEIVING'
    ? goods.filter(g => !activeImports.some((ai) => ai.material_id === g.material_id))
    : []
  const cfg = tStatus ? TRANSFER_STATUS_CFG[tStatus] : null
  // BASE UNIT: quy đổi THÙNG per-mã trước khi cộng cross-mã (khớp order.planned_boxes = thùng quy đổi)
  const totalScanned = goods.reduce((s, g) => s + qtyEntryDecimal(g.actual_boxes ?? 0, g), 0)
  // Nhận QUÁ kế hoạch (#4): cảnh báo, KHÔNG chặn — liệt kê mã hàng thực nhận > kế hoạch
  const overReceivedMats = goods.filter(g => {
    const imps = importsByMat.get(g.material_id) ?? []
    const isNoQrRow = g.no_qr_tracking === true || imps.some(i => i.material?.no_qr_tracking === true) || destQtyLike
    const impTotal = imps.reduce((s, i) => s + (i.total_cartons ?? 0), 0)
    const actual = isNoQrRow ? Math.max(g.actual_boxes ?? 0, impTotal) : (g.actual_boxes ?? 0)
    return (g.planned_boxes ?? 0) > 0 && actual > (g.planned_boxes ?? 0)
  })
  const dvvtDisplay = order?.ncc?.name ?? order?.transfer_gdo?.dvvt ?? null

  // ── Cụm action header (ActionCluster) — desktop inline, mobile nút chính + menu ⋮ ──
  const headerActions: ActionItem[] = []
  if (canConfirmReceipt && tStatus === 'IN_TRANSIT')
    headerActions.push({
      key: 'start-receipt', icon: isSelf ? CheckCircle2 : Play,
      label: isSelf ? 'Hoàn thành' : 'Nhận hàng',
      tip: srcEditing(order!)
        ? 'Kho xuất đang sửa đơn (đã bỏ hoàn thành) — chờ kho xuất hoàn thành lại'
        : !hasBooking
          ? `Cần ĐVVT booking (đủ Biển số, SĐT lái xe, Giờ xe tới) trước khi ${isSelf ? 'hoàn thành' : 'nhận hàng'}`
          : isSelf ? 'Hoàn thành giao hàng (kho nhận không quét)' : 'Bắt đầu nhận hàng chuyển kho',
      primary: true, variant: 'success',
      disabled: !hasBooking || srcEditing(order!),
      busy: confirming || starting || selfCompleting,
      onClick: async () => {
        if (!order) return
        setConfirmErr(''); setStarting(true)
        try {
          if (isSelf) await selfComplete(order.id)
          else await confirmReceipt(order.id)
        } catch (e: unknown) {
          setStarting(false)
          const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
          setConfirmErr(msg ?? (isSelf ? 'Lỗi hoàn thành giao hàng' : 'Lỗi xác nhận nhận hàng'))
        }
      },
    })
  if (canConfirmReceipt && tStatus === 'RECEIVING') {
    // Kho nhận QTY/QTY_DATE: nhận nhanh cả lô theo đúng số xuất (NSX kế thừa từ tem quét ở kho nguồn)
    const openImports = activeImports.filter(ai => ai.status === 'OPEN')
    if (destQtyLike && openImports.length > 0)
      headerActions.push({
        key: 'receive-all', icon: CheckCircle2, label: 'Nhận đủ theo xuất',
        tip: destQtyDate
          ? `Lưu + hoàn thành ${openImports.length} phiếu theo đúng số thùng & NSX đã quét xuất ở kho nguồn`
          : `Lưu + hoàn thành ${openImports.length} phiếu theo đúng số thùng đã xuất`,
        primary: true, variant: 'success', busy: bulkRunning,
        onClick: () => { setActionErr(''); setBulkConfirm(true) },
      })
    headerActions.push({
      key: 'cancel-receipt', icon: X, label: 'Hủy nhận',
      tip: hasActiveImports
        ? `Còn ${activeImports.length} phiếu nhập đang hoạt động — hủy từng phiếu ở Nhập kho trước`
        : 'Hủy nhận hàng — trạng thái sẽ về Đang vận chuyển',
      danger: true, className: 'border-red-200 text-red-600 hover:bg-red-50',
      disabled: hasActiveImports, busy: cancelling,
      onClick: async () => {
        if (!order) return
        if (!confirm('Hủy nhận hàng? Trạng thái sẽ về Đang vận chuyển.')) return
        setConfirmErr('')
        try {
          await cancelReceipt(order.id)
        } catch (e: unknown) {
          const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
          setConfirmErr(msg ?? 'Lỗi hủy nhận hàng')
        }
      },
    })
    if (missingMaterials.length > 0)
      headerActions.push({
        key: 'recreate-inbound', icon: PlusCircle, label: 'Tạo phiếu lại',
        tip: `Mã hàng ${missingMaterials.map(g => g.material_code ?? g.material_id.slice(0, 8)).join(', ')} đang không có phiếu nhập`,
        className: 'border-amber-400 text-amber-700 hover:bg-amber-50',
        busy: creatingInbound,
        onClick: async () => {
          if (!order) return
          // Bulk song song (CLAUDE.md): không for...of await tuần tự
          await Promise.all(missingMaterials.map(g =>
            createOneInbound({ tmsOrderId: order.id, material_id: g.material_id })
          ))
        },
      })
  }
  if (canEdit)
    headerActions.push({
      key: 'update-booking', icon: Truck, label: 'ĐVVT booking',
      tip: 'Cập nhật ĐVVT booking (biển số, SĐT lái xe, giờ xe tới)',
      onClick: () => setShowUpdate(true),
    })
  if (!isLoading && goods.length > 0 && hasExpandables)
    headerActions.push({
      key: 'toggle-pallets', icon: ChevronDown,
      label: allExpanded ? 'Thu gọn' : destQtyDate ? 'Dòng NSX' : 'Pallet',
      tip: allExpanded
        ? 'Thu gọn về 1 dòng mỗi mã hàng'
        : destQtyDate ? 'Mở các dòng NSX (phiếu nhận) của mọi mã hàng' : 'Mở danh sách pallet của mọi mã hàng',
      className: `text-slate-500 ${allExpanded ? '[&_svg]:rotate-180' : ''}`,
      onClick: toggleAllPallets,
    })

  return (
    <>
      <TransportUpdateDialog order={showUpdate ? order : null} onClose={() => setShowUpdate(false)} />
      {completeConfirm && (() => {
        const { impId, code, name, planned, actual } = completeConfirm
        const diff = actual - planned
        const f1 = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })   // thùng quy đổi có thể thập phân → format vi-VN
        const statusEl = planned <= 0
          ? <span className="text-slate-400 text-xs">Không có kế hoạch số thùng</span>
          : diff === 0
            ? <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Đúng kế hoạch</span>
            : diff < 0
              ? <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Thiếu {f1(Math.abs(diff))} thùng so với kế hoạch</span>
              : <span className="text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full">Thừa {f1(diff)} thùng so với kế hoạch</span>
        return (
          <Dialog open onOpenChange={v => { if (!v) setCompleteConfirm(null) }}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Xác nhận hoàn thành nhận hàng</DialogTitle>
                <p className="text-xs text-slate-500 mt-1 font-mono">{code} · {name}</p>
              </DialogHeader>
              <div className="py-2 space-y-2 text-sm">
                <div className="flex justify-between text-slate-600"><span>Kế hoạch</span><span className="font-medium">{f1(planned)} thùng</span></div>
                <div className="flex justify-between text-slate-600"><span>Thực nhận</span><span className="font-semibold">{f1(actual)} thùng</span></div>
                <div className="pt-1">{statusEl}</div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" size="sm" onClick={() => setCompleteConfirm(null)}>Hủy</Button>
                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white"
                  disabled={rowBusy === impId}
                  onClick={() => { setCompleteConfirm(null); handleCompleteOne(impId) }}>
                  {rowBusy === impId ? 'Đang lưu…' : 'Hoàn thành'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )
      })()}
      {bulkConfirm && (() => {
        const targets = activeImports.filter(ai => ai.status === 'OPEN')
        const matName = new Map(goods.map(g => [g.material_id, g.material_code ?? '—']))
        const totalCartons = targets.reduce((s, ai) => s + qtyEntryDecimal(ai.planned_cartons ?? 0, ai.material), 0)   // BASE UNIT: quy đổi thùng per-mã
        return (
          <Dialog open onOpenChange={v => { if (!v && !bulkRunning) setBulkConfirm(false) }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Nhận đủ theo xuất</DialogTitle>
                <p className="text-xs text-slate-500 mt-1">
                  Lưu số lượng + hoàn thành <b>{targets.length}</b> phiếu theo đúng số đã xuất{destQtyDate ? ' — NSX kế thừa từ tem quét ở kho nguồn' : ''}.
                </p>
              </DialogHeader>
              <div className="max-h-64 overflow-y-auto border rounded-lg">
                <table className="w-full">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      {['Mã hàng', 'NSX', 'Thùng', 'Pallet'].map(h => (
                        <th key={h} className="px-2 py-1 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {targets.map(ai => (
                      <tr key={ai.id} className="border-t border-slate-100">
                        <td className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{matName.get(ai.material_id) ?? '—'}</td>
                        <td className="px-2 py-1 text-[10px] whitespace-nowrap">
                          {(() => {
                            const edited = nsxDraft[ai.id] && nsxDraft[ai.id] !== ai.transfer_production_date
                            const d = nsxDraft[ai.id] ?? ai.transfer_production_date
                            if (d) return <span className={`font-medium ${edited ? 'text-amber-600' : 'text-indigo-700'}`}>{formatDate(d)}{edited ? ' (đã sửa)' : ''}</span>
                            return destQtyDate
                              ? <span className="text-amber-600">{formatDate(TODAY_VN)} (gõ tay)</span>
                              : <span className="text-slate-300">—</span>
                          })()}
                        </td>
                        <td className="px-2 py-1 text-[10px] font-semibold tabular-nums whitespace-nowrap">{qtyEntryText(ai.planned_cartons ?? 0, ai.material)}</td>
                        <td className="px-2 py-1 text-[10px] text-slate-400 tabular-nums whitespace-nowrap">{(ai.planned_pallets ?? 0) > 0 ? ai.planned_pallets : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-500">Tổng <b className="tabular-nums">{totalCartons.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}</b> thùng. Nếu thực nhận LỆCH số xuất — đừng dùng nút này, lưu số thực tế ở từng dòng trong bảng.</p>
              <DialogFooter className="gap-2">
                <Button variant="outline" size="sm" disabled={bulkRunning} onClick={() => setBulkConfirm(false)}>Hủy</Button>
                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={bulkRunning}
                  onClick={receiveAllPerPlan}>
                  {bulkRunning ? 'Đang nhận…' : `Nhận & hoàn thành ${targets.length} phiếu`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )
      })()}
      {addNsx && (
        <Dialog open onOpenChange={v => { if (!v) setAddNsx(null) }}>
          <DialogContent className="sm:max-w-xs">
            <DialogHeader>
              <DialogTitle>Thêm dòng NSX — <span className="font-mono">{addNsx.code}</span></DialogTitle>
              <p className="text-xs text-slate-500 mt-1">Hàng về có NSX ngoài dữ liệu quét xuất → thêm dòng nhận riêng cho NSX đó.</p>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="space-y-1">
                <p className="text-xs text-slate-500">NSX (ngày sản xuất) <span className="text-red-500">*</span></p>
                <Input type="date" value={addNsx.nsx} className="h-9"
                  onChange={e => setAddNsx(s => s ? { ...s, nsx: e.target.value } : s)} />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-slate-500">Số thùng dự kiến</p>
                <Input type="number" min={0} value={addNsx.cartons} className="h-9" placeholder="0"
                  onChange={e => setAddNsx(s => s ? { ...s, cartons: e.target.value } : s)} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddNsx(null)}>Hủy</Button>
              <Button size="sm" disabled={creatingInbound || !addNsx.nsx}
                onClick={async () => {
                  setActionErr('')
                  try {
                    await createOneInbound({ tmsOrderId: order!.id, material_id: addNsx.materialId, production_date: addNsx.nsx, planned_cartons: Number(addNsx.cartons) || 0 })
                    setExpandedMats(prev => new Set(prev).add(addNsx.materialId))
                    setAddNsx(null)
                    refreshPanel()
                  } catch (e) {
                    setActionErr(errMsgOf(e)); setAddNsx(null)
                  }
                }}>
                {creatingInbound ? 'Đang thêm…' : 'Thêm dòng'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {scanImportId && (
        <InboundScanSheetById
          importId={scanImportId}
          employeeId={user?.id}
          onClose={() => { setScanImportId(null); refreshPanel() }}
        />
      )}
      <Dialog open={!!order} onOpenChange={v => !v && onClose()}>
        <DialogContent className="w-screen max-w-[100vw] h-[100dvh] max-h-[100dvh] rounded-none flex flex-col p-0 gap-0 sm:w-[80vw] sm:max-w-[80vw] sm:h-[85vh] sm:max-h-[85vh] sm:rounded-lg"
          onInteractOutside={e => { if (scanImportId) e.preventDefault() }}
          onEscapeKeyDown={e => { if (scanImportId) e.preventDefault() }}>
          <DialogTitle className="sr-only">Chi tiết lệnh chuyển kho {order?.order_code}</DialogTitle>
          {/* Header — pr-10 để tránh nút X của shadcn */}
          <div className="px-4 pt-3 pb-2 border-b bg-white shrink-0 pr-10">
            {/* Dòng 1: Mã lệnh + trạng thái + actions (góc phải) */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-sm font-mono font-bold text-slate-800">{order?.order_code}</span>
              {cfg && <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>}
              {order && srcEditing(order) && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
                  title="Kho xuất đã bỏ hoàn thành để sửa đơn — booking giữ nguyên, chờ kho xuất hoàn thành lại">
                  Kho đang sửa
                </span>
              )}
              <ActionCluster className="ml-auto" items={headerActions} />
            </div>
            {confirmErr && <p className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded mt-1">{confirmErr}</p>}
            {actionErr && <p className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded mt-1">{actionErr}</p>}
            {overReceivedMats.length > 0 && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded mt-1">
                ⚠ Nhận VƯỢT kế hoạch ở {overReceivedMats.length} mã hàng — kiểm tra lại số lượng. Vẫn cho phép nhận.
              </p>
            )}
            {/* Dòng 2: Info grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-0.5 text-[11px]">
              <div className="flex gap-2">
                <span className="text-slate-400 w-16 shrink-0">Kho xuất</span>
                <span className="font-medium text-slate-700">{order?.transfer_gdo?.warehouse?.name ?? '—'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-slate-400 w-16 shrink-0">Kho nhận</span>
                <span className="font-medium text-blue-700">{order ? transferDestLabel(order) : '—'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-slate-400 w-16 shrink-0">Mã GDO</span>
                <span className="font-mono font-semibold text-slate-600">{order?.transfer_gdo?.group_code ?? '—'}</span>
              </div>
              {(order?.transfer_gdo?.delivery_codes?.length ?? 0) > 0 && (
                <div className="flex gap-2">
                  <span className="text-slate-400 w-16 shrink-0">Số DO</span>
                  <span className="font-mono font-semibold text-slate-700">{order!.transfer_gdo!.delivery_codes!.join(' · ')}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-slate-400 w-16 shrink-0">Ngày xuất</span>
                <span className="font-medium text-slate-700">{order?.transfer_gdo?.delivery_date ?? '—'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-slate-400 w-16 shrink-0">ĐVVT</span>
                <span className="font-medium text-slate-700">{dvvtDisplay ?? <span className="text-slate-300">—</span>}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-slate-400 w-16 shrink-0">Thùng</span>
                <span className="tabular-nums font-semibold text-slate-800">
                  {totalScanned > 0 ? `${totalScanned.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} / ` : ''}{order?.planned_boxes ?? 0} thùng
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-slate-400 w-16 shrink-0">Biển số</span>
                <span className="font-mono font-semibold text-slate-800">
                  {(slot?.license_plate ?? order?.transfer_gdo?.license_plate) ?? <span className="text-slate-300 font-normal">—</span>}
                </span>
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-slate-400 w-16 shrink-0">SĐT</span>
                {slot?.driver_phone
                  ? <a href={`tel:${slot.driver_phone}`} className="text-blue-600 hover:text-blue-800 font-medium">{slot.driver_phone}</a>
                  : <span className="text-slate-300">—</span>}
              </div>
              <div className="flex gap-2">
                <span className="text-slate-400 w-16 shrink-0">Dự kiến giao</span>
                {order?.eta
                  ? <span className="font-semibold text-green-700">{formatDateTime(order.eta)}</span>
                  : <span className="text-slate-300">—</span>}
              </div>
              <div className="flex gap-2">
                <span className="text-slate-400 w-16 shrink-0">Người tạo</span>
                <span className="text-slate-600">{order?.created_by ?? <span className="text-slate-300">—</span>}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-slate-400 w-16 shrink-0">Giờ tạo</span>
                <span className="text-slate-600 font-mono text-[10px]">{order?.created_at ? formatDateTime(order.created_at) : '—'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-slate-400 w-16 shrink-0">Người sửa</span>
                <span className="text-slate-600">{order?.updated_by ?? <span className="text-slate-300">—</span>}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-slate-400 w-16 shrink-0">Giờ sửa</span>
                <span className="text-slate-600 font-mono text-[10px]">{order?.updated_at ? formatDateTime(order.updated_at) : '—'}</span>
              </div>
              {order?.notes && (
                <div className="flex gap-2 col-span-2 sm:col-span-3">
                  <span className="text-slate-400 w-16 shrink-0">Ghi chú</span>
                  <span className="text-slate-700 break-words">{order.notes}</span>
                </div>
              )}
            </div>
          </div>

          {/* Goods table */}
          <div className="flex-1 min-h-0 overflow-auto">
            {isLoading ? (
              <div className="py-16 text-center text-sm text-slate-400">Đang tải hàng hóa...</div>
            ) : goods.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-400">Không có dữ liệu hàng hóa</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-max w-full">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr>
                      <th className="w-6 px-2 py-1.5"></th>
                      {['Mã hàng', 'Tên hàng', 'ĐVT', 'Thùng KH', 'Thùng thực', 'Chênh lệch', 'Tình trạng GN'].map(h => (
                        <th key={h} className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                      {showActions && <th className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap sticky right-0 bg-slate-50 border-l border-slate-200">Thao tác</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {goods.map(g => {
                      const isExpanded = expandedMats.has(g.material_id)
                      const imps = importsByMat.get(g.material_id) ?? []
                      const imp = imps[0]
                      // Kho QTY_DATE: 1 mã có NHIỀU phiếu (1 phiếu/NSX) → thao tác nằm ở dòng NSX bên dưới
                      const multiNsx = destQtyDate && imps.length > 0
                      const isNoQrRow = g.no_qr_tracking === true || imp?.material?.no_qr_tracking === true || destQtyLike
                      // No-QR: lấy max(transfer-goods, Σ total_cartons các phiếu) — robust nếu 1 nguồn chưa cập nhật
                      const impTotal = imps.reduce((s, i) => s + (i.total_cartons ?? 0), 0)
                      const actualCartons = isNoQrRow
                        ? Math.max(g.actual_boxes ?? 0, impTotal)
                        : (g.actual_boxes ?? 0)
                      // BASE UNIT: quy đổi THÙNG để hiển thị/so sánh (no-op với mã không entry); giữ base cho save/logic
                      const plannedEntry = qtyEntryDecimal(g.planned_boxes, g)
                      const actualEntry  = qtyEntryDecimal(actualCartons, g)
                      const diffEntry    = Math.round((actualEntry - plannedEntry) * 1000) / 1000
                      const fmt1 = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })
                      const canExpand = destQtyDate ? imps.length > 0 : g.pallets.length > 0
                      return (
                        <React.Fragment key={g.material_id}>
                          <tr
                            className={`border-t border-slate-100 ${canExpand ? 'cursor-pointer hover:bg-blue-50/40' : 'hover:bg-slate-50'}`}
                            onClick={() => canExpand && toggleMat(g.material_id)}
                          >
                            <td className="px-2 py-1 text-slate-300 text-[10px]">
                              {canExpand ? (isExpanded ? '▾' : '▸') : ''}
                            </td>
                            <td className="px-2 py-1 whitespace-nowrap">
                              <span className="text-[10px] font-mono font-semibold">{g.material_code ?? '—'}</span>
                            </td>
                            <td className="px-2 py-1 whitespace-nowrap">
                              <span className="text-[10px] text-slate-700">{g.material_name ?? '—'}</span>
                            </td>
                            <td className="px-2 py-1 whitespace-nowrap">
                              <span className="text-[10px] text-slate-400">{g.unit ?? '—'}</span>
                            </td>
                            <td className="px-2 py-1 whitespace-nowrap text-right">
                              <span className="text-[10px] font-semibold tabular-nums">{fmt1(plannedEntry)}</span>
                            </td>
                            <td className="px-2 py-1 whitespace-nowrap text-right">
                              <span className={`text-[10px] font-semibold tabular-nums ${actualCartons > 0 ? 'text-green-700' : 'text-slate-300'}`}>
                                {actualCartons > 0 ? fmt1(actualEntry) : '—'}
                              </span>
                            </td>
                            {(() => {
                              const diff = diffEntry
                              const hasData = actualCartons > 0
                              // Nhận VƯỢT kế hoạch (diff>0) = đỏ cảnh báo (#4); thiếu (đang nhận) = amber
                              const diffCls = diff === 0 ? 'text-green-700' : diff > 0 ? 'text-red-600' : 'text-amber-600'
                              const gnLabel = diff === 0 ? 'Đủ' : diff > 0 ? `Thừa +${fmt1(diff)}` : `Thiếu ${fmt1(diff)}`
                              const gnCls = diff === 0 ? 'bg-green-100 text-green-700' : diff > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                              return (<>
                                <td className="px-2 py-1 whitespace-nowrap text-right">
                                  {hasData
                                    ? <span className={`text-[10px] font-semibold tabular-nums ${diffCls}`}>{diff > 0 ? `+${fmt1(diff)}` : fmt1(diff)}</span>
                                    : <span className="text-slate-300 text-[10px]">—</span>}
                                </td>
                                <td className="px-2 py-1 whitespace-nowrap">
                                  {hasData
                                    ? <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${gnCls}`}>{gnLabel}</span>
                                    : <span className="text-slate-300 text-[10px]">—</span>}
                                </td>
                              </>)
                            })()}
                            {showActions && (() => {
                              const isNoQr = isNoQrRow
                              const busy = rowBusy === imp?.id
                              const hasQty = (imp?.total_cartons ?? 0) > 0 || !!imp?.posm_entry_id
                              return (
                                <td className="px-1.5 py-1 w-px sticky right-0 bg-white border-l border-slate-200" onClick={e => e.stopPropagation()}>
                                  {!imp ? (
                                    <span className="text-[10px] text-slate-300 whitespace-nowrap">Chưa có phiếu</span>
                                  ) : multiNsx ? (
                                    // Thao tác per NSX ở các dòng xổ dưới — ô này tóm tắt trạng thái + nút thêm dòng NSX
                                    <div className="flex items-center gap-1 whitespace-nowrap">
                                      {imps.every(i => i.status === 'COMPLETED')
                                        ? <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 text-center whitespace-nowrap">✓ Đã xong</span>
                                        : <span className="text-[10px] text-slate-400 whitespace-nowrap">{isExpanded ? '▾' : '▸'} {imps.length} NSX</span>}
                                      {canReceiveNow && canScan && (
                                        <button type="button" className="text-blue-600 hover:text-blue-800 text-[12px] leading-none font-bold px-0.5"
                                          title="Thêm dòng NSX mới cho mã này (hàng về có NSX ngoài dữ liệu xuất)"
                                          onClick={() => setAddNsx({ materialId: g.material_id, code: g.material_code ?? '', nsx: TODAY_VN, cartons: '' })}>
                                          ＋
                                        </button>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="flex flex-col items-stretch gap-1 min-w-[84px]">
                                      {imp.status === 'COMPLETED' ? (
                                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 text-center whitespace-nowrap">✓ Đã xong</span>
                                      ) : canReceiveNow ? (
                                        <>
                                          {/* Mã không QR: ô số + Lưu; mã QR: nút Quét chuẩn (QrCode) */}
                                          {isNoQr ? (
                                            !imp.posm_entry_id && canScan && (
                                              <div className="flex items-center gap-1">
                                                <input type="number" min={0}
                                                  value={manualDraft[imp.id] ?? String(imp.planned_cartons ?? '')}
                                                  onChange={e => setManualDraft(d => ({ ...d, [imp.id]: e.target.value }))}
                                                  placeholder="thùng"
                                                  className="w-14 h-6 text-[10px] text-center rounded border border-slate-300 px-1" />
                                                <Button size="sm" variant="outline" className="h-6 !min-h-0 !min-w-0 text-[10px] px-1.5 flex-1"
                                                  disabled={busy} onClick={() => handleManualConfirm(imp.id, imp.planned_cartons)}>
                                                  {busy ? '…' : 'Lưu'}
                                                </Button>
                                              </div>
                                            )
                                          ) : (
                                            canScan && (
                                              <Button size="sm" className="h-6 text-[10px] px-1.5 gap-1"
                                                onClick={() => setScanImportId(imp.id)}>
                                                <QrCode className="h-3 w-3" /> Quét
                                              </Button>
                                            )
                                          )}
                                          {canComplete && hasQty && (
                                            <Button size="sm" className="h-6 !min-h-0 !min-w-0 text-[10px] px-1.5 gap-1 bg-green-600 hover:bg-green-700"
                                              disabled={busy} onClick={() => setCompleteConfirm({ impId: imp.id, code: g.material_code ?? '—', name: g.material_name ?? '', planned: plannedEntry, actual: actualEntry })}>
                                              <CheckCircle2 className="h-3 w-3" /> {busy ? '…' : 'Hoàn thành'}
                                            </Button>
                                          )}
                                        </>
                                      ) : null}
                                      {/* Link Inbound — luôn có, kể cả khi đã hoàn thành/giao xong */}
                                      <button type="button" className="text-[10px] text-blue-600 hover:text-blue-800 text-left whitespace-nowrap"
                                        title="Mở phiếu trong Nhập kho"
                                        onClick={() => navigate(`/wms/inbound/${imp.id}`)}>
                                        Mở Inbound ↗
                                      </button>
                                    </div>
                                  )}
                                </td>
                              )
                            })()}
                          </tr>
                          {/* Dòng NSX (kho QTY_DATE, xổ khi bấm dòng mã): mỗi phiếu = 1 NSX kế thừa từ tem quét xuất.
                              1 DÒNG MỎNG (đơn 20-30 mã không tràn): nút nằm ngang + !min-h-0 phá sàn touch-target */}
                          {multiNsx && isExpanded && imps.map(ai => {
                            const saved = !!ai.posm_entry_id || (ai.total_cartons ?? 0) > 0
                            const busy = rowBusy === ai.id
                            const actual = ai.total_cartons ?? 0
                            const planned = ai.planned_cartons ?? 0
                            // BASE UNIT: giá trị hiển thị quy đổi thùng (no-op mã không entry); planned/actual base giữ cho input+save
                            const plannedE = qtyEntryDecimal(planned, ai.material)
                            const actualE  = qtyEntryDecimal(actual, ai.material)
                            const diffE    = Math.round((actualE - plannedE) * 1000) / 1000
                            const fmtE     = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })
                            const nsxLabel = ai.transfer_production_date ? formatDate(ai.transfer_production_date) : null
                            // NSX gửi khi Lưu: ô đã chỉnh (draft) THẮNG NSX phiếu (BE sẽ đồng bộ lại nhãn phiếu)
                            const effNsx = nsxDraft[ai.id] ?? ai.transfer_production_date ?? TODAY_VN
                            return (
                              <tr key={ai.id} className="bg-indigo-50/40 border-t border-indigo-100">
                                <td className="px-2 py-0.5"></td>
                                <td className="px-2 py-0.5 whitespace-nowrap">
                                  <span className="text-[9px] font-mono text-slate-400">{ai.import_code}</span>
                                </td>
                                <td className="px-2 py-0.5 whitespace-nowrap">
                                  {canReceiveNow && ai.status === 'OPEN' && !saved ? (
                                    // Chưa lưu → NSX SỬA ĐƯỢC (tem thực tế lệch dữ liệu quét): indigo = kế thừa tem, amber = gõ tay
                                    <span className="inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                      <span className={`text-[10px] font-medium ${nsxLabel ? 'text-indigo-700' : 'text-amber-600'}`}>NSX</span>
                                      <input type="date" value={nsxDraft[ai.id] ?? ai.transfer_production_date ?? TODAY_VN}
                                        onChange={e => setNsxDraft(d => ({ ...d, [ai.id]: e.target.value }))}
                                        className={`h-5 text-[10px] rounded border px-1 ${nsxLabel ? 'border-indigo-200 text-indigo-800' : 'border-amber-300'}`} />
                                    </span>
                                  ) : nsxLabel ? (
                                    <span className="text-[10px] font-semibold text-indigo-700">NSX {nsxLabel}</span>
                                  ) : (
                                    <span className="text-[10px] text-slate-400">NSX —</span>
                                  )}
                                </td>
                                <td className="px-2 py-0.5 whitespace-nowrap">
                                  <span className="text-[10px] text-slate-400 tabular-nums">{(ai.planned_pallets ?? 0) > 0 ? `${ai.planned_pallets} pl` : ''}</span>
                                </td>
                                <td className="px-2 py-0.5 whitespace-nowrap text-right">
                                  <span className="text-[10px] tabular-nums text-slate-600">{fmtE(plannedE)}</span>
                                </td>
                                <td className="px-2 py-0.5 whitespace-nowrap text-right">
                                  <span className={`text-[10px] tabular-nums font-semibold ${actual > 0 ? 'text-green-700' : 'text-slate-300'}`}>
                                    {actual > 0 ? fmtE(actualE) : '—'}
                                  </span>
                                </td>
                                <td className="px-2 py-0.5 whitespace-nowrap text-right">
                                  {actual > 0
                                    ? <span className={`text-[10px] tabular-nums font-semibold ${diffE === 0 ? 'text-green-700' : diffE > 0 ? 'text-red-600' : 'text-amber-600'}`}>{diffE > 0 ? `+${fmtE(diffE)}` : fmtE(diffE)}</span>
                                    : <span className="text-slate-300 text-[10px]">—</span>}
                                </td>
                                <td className="px-2 py-0.5 whitespace-nowrap">
                                  {ai.status === 'COMPLETED'
                                    ? <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">✓ Đã xong</span>
                                    : saved
                                      ? <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700">Đã lưu</span>
                                      : <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Chờ nhận</span>}
                                </td>
                                {showActions && (
                                  <td className="px-1.5 py-0.5 w-px sticky right-0 bg-indigo-50 border-l border-slate-200" onClick={e => e.stopPropagation()}>
                                    <div className="flex items-center gap-1 whitespace-nowrap">
                                      {ai.status !== 'COMPLETED' && canReceiveNow && !saved && canScan && (
                                        <>
                                          <input type="number" min={0}
                                            value={manualDraft[ai.id] ?? String(planned)}
                                            onChange={e => setManualDraft(d => ({ ...d, [ai.id]: e.target.value }))}
                                            placeholder="thùng"
                                            className="w-12 h-5 text-[10px] text-center rounded border border-slate-300 px-1" />
                                          <Button size="sm" variant="outline" className="h-5 !min-h-0 !min-w-0 text-[10px] px-1.5"
                                            disabled={busy} onClick={() => handleManualConfirm(ai.id, planned, effNsx)}>
                                            {busy ? '…' : 'Lưu'}
                                          </Button>
                                          <button type="button" className="text-red-500 hover:text-red-700 px-0.5 disabled:opacity-40"
                                            title="Xóa dòng nhận này (hàng về không có NSX này)"
                                            disabled={busy}
                                            onClick={() => handleCancelLine(ai.id, `${g.material_code ?? ''} · NSX ${formatDate(effNsx)}`)}>
                                            <Trash2 className="h-3 w-3" />
                                          </button>
                                        </>
                                      )}
                                      {ai.status !== 'COMPLETED' && canReceiveNow && saved && canComplete && (
                                        <>
                                          <Button size="sm" className="h-5 !min-h-0 !min-w-0 text-[10px] px-1.5 gap-1 bg-green-600 hover:bg-green-700"
                                            disabled={busy}
                                            onClick={() => setCompleteConfirm({ impId: ai.id, code: g.material_code ?? '—', name: `${g.material_name ?? ''}${nsxLabel ? ` · NSX ${nsxLabel}` : ''}`, planned: plannedE, actual: actualE })}>
                                            <CheckCircle2 className="h-3 w-3" /> {busy ? '…' : 'Hoàn thành'}
                                          </Button>
                                          <button type="button" className="text-amber-600 hover:text-amber-800 px-0.5 disabled:opacity-40"
                                            title="Xóa số đã lưu để sửa lại (số thùng / NSX)"
                                            disabled={busy || !ai.posm_entry_id}
                                            onClick={() => ai.posm_entry_id && handleUndoSaved(ai.id, ai.posm_entry_id)}>
                                            <RotateCcw className="h-3 w-3" />
                                          </button>
                                        </>
                                      )}
                                      <button type="button" className="text-[11px] leading-none text-blue-600 hover:text-blue-800 px-0.5"
                                        title="Mở phiếu trong Nhập kho"
                                        onClick={() => navigate(`/wms/inbound/${ai.id}`)}>
                                        ↗
                                      </button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                          {!destQtyDate && isExpanded && g.pallets.map(p => (
                            <tr key={p.pallet_code} className="bg-blue-50/30 border-t border-blue-100">
                              <td className="px-2 py-0.5"></td>
                              <td className="px-2 py-0.5"></td>
                              <td className="px-2 py-0.5">
                                <span className="text-[10px] font-mono font-semibold text-blue-700">{p.pallet_code}</span>
                              </td>
                              <td className="px-2 py-0.5"></td>
                              <td className="px-2 py-0.5 text-right">
                                <span className="text-[10px] tabular-nums text-slate-500">{p.cartons_outbound}</span>
                              </td>
                              <td className="px-2 py-0.5 text-right">
                                <span className={`text-[10px] tabular-nums font-semibold ${p.cartons_inbound > 0 ? 'text-green-700' : 'text-slate-300'}`}>
                                  {p.cartons_inbound > 0 ? p.cartons_inbound : '—'}
                                </span>
                              </td>
                              <td className="px-2 py-0.5" colSpan={showActions ? 3 : 2}></td>
                            </tr>
                          ))}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Cột lưới Kế hoạch (tab main) — kéo giãn từ 'Tên NPP' trở đi; checkbox + Mã đơn + cột action cố định
// (yêu cầu user 05/07). Thứ tự PHẢI khớp <td> trong tbody.
const MAIN_COLS: { label: string; cls?: string; align?: 'right'; resize?: boolean }[] = [
  { label: '', resize: false },                    // checkbox
  { label: 'Mã đơn', resize: false },
  { label: 'Tên NPP' },
  { label: 'Đặt giờ' },
  { label: 'Ngày KH' },
  { label: 'Khung giờ' },
  { label: 'Biển số' },
  { label: 'ĐVVT' },
  { label: 'UT', cls: 'text-red-500' },
  { label: 'Hướng' },
  { label: 'Loại kho' },
  { label: 'Loại xe' },
  { label: 'Thùng', align: 'right' },
  { label: 'Pallet', align: 'right' },
  { label: 'Tấn', align: 'right' },
  { label: 'SĐT' },
  { label: 'Trạng thái' },
  { label: 'Tình trạng XH' },
  { label: 'Giờ HT', cls: 'text-green-600' },
  { label: 'Giờ ĐK' },
  { label: 'Giờ vào' },
  { label: 'Giờ ra' },
  { label: 'Kho' },
  { label: '', resize: false },                    // actions
]
const MAIN_COL_DEFAULTS = [32, 148, 150, 44, 78, 88, 88, 110, 28, 56, 88, 100, 64, 56, 56, 90, 92, 96, 64, 64, 64, 64, 104, 64]

// ── TransferOrdersPanel ───────────────────────────────────────────────────────

// "Kho nhận" của lệnh chuyển: có kho đích (destination_warehouse_id) → tên kho; OTHER (khách ngoài
// hệ thống) → shipto/tên KH — KHÔNG dùng order.warehouse (với OTHER đó là KHO XUẤT gán làm scope).
function transferDestLabel(o: TransferOrder): string {
  if (o.destination_warehouse_id) return o.warehouse?.name ?? '—'
  return o.transfer_gdo?.shipto_party ?? o.transfer_gdo?.customer_label ?? '—'
}

// Kho xuất đã "Bỏ hoàn thành" để sửa đơn — lệnh + booking giữ nguyên, nhận hàng tạm khóa tới khi chốt lại
function srcEditing(o: TransferOrder): boolean {
  return !!o.transfer_gdo?.status && o.transfer_gdo.status !== 'COMPLETED'
}

// Cột bảng Chuyển kho (kéo giãn được) — label + độ rộng mặc định (px). Thứ tự PHẢI khớp <td> trong tbody.
const TRANSFER_COLS: { label: string; align?: 'right' }[] = [
  { label: 'Số DO' }, { label: 'Ngày xuất' }, { label: 'Kho xuất' }, { label: 'Kho nhận' },
  { label: 'Ngày nhận' }, { label: 'Thùng KH', align: 'right' }, { label: 'Thực nhận', align: 'right' },
  { label: 'Chênh lệch', align: 'right' }, { label: 'Tình trạng GN' }, { label: 'Dự kiến giao' },
  { label: 'ĐVVT' }, { label: 'Biển số' }, { label: 'Số điện thoại' }, { label: 'Tình trạng' },
  { label: 'Số GDO' }, { label: 'Ghi chú' }, { label: 'Mã lệnh' },
]
const TRANSFER_COL_DEFAULTS = [120, 120, 110, 110, 130, 70, 70, 80, 96, 130, 96, 96, 110, 130, 110, 170, 130]

function TransferOrdersPanel({ canEdit, canConfirmReceipt, userScope, userWarehouseId, userWarehouseIds }: {
  canEdit: boolean; canConfirmReceipt: boolean
  userScope: 'NATIONAL' | 'ASSIGNED'
  userWarehouseId: string | null
  userWarehouseIds: string[]
}) {
  // Filter tab Chuyển kho per-user qua useWmsFilterStore — KHÔNG localStorage thuần
  const ttf    = useWmsFilterStore(s => s.tmsTransfer)
  const setTtf = useWmsFilterStore(s => s.setTmsTransfer)
  const dateFrom       = ttf.dateFrom; const setDateFrom       = (v: string)   => setTtf({ dateFrom: v })
  const dateTo         = ttf.dateTo;   const setDateTo         = (v: string)   => setTtf({ dateTo: v })

  // Mặc định chỉ tải ~30 ngày gần nhất (lệnh tích lũy vô hạn — mỗi đơn xuất hoàn thành = 1 lệnh).
  // User cần xem cũ hơn thì chỉnh "Ngày xuất" trong FilterBar; xóa filter = quay về 30 ngày.
  const defaultFrom = React.useMemo(
    () => new Date(Date.now() - 30 * 86400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }), [])
  const effDateFrom = dateFrom || defaultFrom
  const { data: orders = [], isLoading } = useTransferOrders(undefined, { from: effDateFrom, to: dateTo || undefined })
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const selectedOrder = orders.find(o => o.id === selectedOrderId) ?? null
  const { widths: colW, startResize, totalWidth } = useColumnResize('tms_transfer_col_widths', TRANSFER_COL_DEFAULTS)
  const khoXuatFilter  = ttf.khoXuat;  const setKhoXuatFilter  = (v: string[]) => setTtf({ khoXuat: v })
  const khoNhanFilter  = ttf.khoNhan;  const setKhoNhanFilter  = (v: string[]) => setTtf({ khoNhan: v })

  // Set các kho user có quyền truy cập (null = không giới hạn)
  const accessibleIds = React.useMemo(() => {
    if (userScope === 'NATIONAL') return null
    const ids = new Set<string>()
    if (userWarehouseId) ids.add(userWarehouseId)
    userWarehouseIds.forEach(id => ids.add(id))
    return ids
  }, [userScope, userWarehouseId, userWarehouseIds])

  const isSingle = accessibleIds !== null && accessibleIds.size <= 1

  // Dấu * đỏ sau tên kho CỦA CHÍNH USER (kho xuất/nhận) để dễ nhìn. NATIONAL (full kho) → KHÔNG hiện.
  // inline-block để không bị gạch ngang theo hàng "Đã giao".
  const ownMark = (whId?: string | null) =>
    accessibleIds && whId && accessibleIds.has(whId)
      ? <Star className="inline-block align-middle h-3 w-3 ml-0.5 shrink-0 fill-red-500 text-red-500" aria-label="Kho của bạn" />
      : null

  // Data pool: NATIONAL xem tất, ASSIGNED lọc OR logic (kho xuất hoặc kho nhận thuộc quyền)
  const scopedOrders = React.useMemo(() => {
    if (!accessibleIds) return orders as TransferOrder[]
    return (orders as TransferOrder[]).filter(o => {
      const srcId = o.transfer_gdo?.warehouse?.id
      const dstId = (o as any).warehouse?.id
      return (srcId && accessibleIds.has(srcId)) || (dstId && accessibleIds.has(dstId))
    })
  }, [orders, accessibleIds])

  // Tên kho: seed ĐỒNG BỘ từ cache localStorage (có tên ngay frame đầu, kể cả hard reload) + cập nhật từ useWarehouses.
  // KHÔNG chờ transfer orders (~2s), không lộ UUID. Lần đầu tiên (chưa có cache) mới thoáng '…'.
  const { data: allWarehouses = [] } = useWarehouses(true)
  const cachedWhNames = React.useMemo<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('wms-wh-names') || '{}') } catch { return {} }
  }, [])
  const whNameById = React.useMemo(() => {
    const map = new Map<string, string>(Object.entries(cachedWhNames))
    for (const w of allWarehouses as { id: string; name: string }[]) map.set(w.id, w.name)
    return map
  }, [allWarehouses, cachedWhNames])
  React.useEffect(() => {
    if (!allWarehouses.length) return
    try {
      localStorage.setItem('wms-wh-names', JSON.stringify(
        Object.fromEntries((allWarehouses as { id: string; name: string }[]).map(w => [w.id, w.name]))))
    } catch { /* ignore quota */ }
  }, [allWarehouses])

  // Options = kho có trong dữ liệu transfer + LUÔN gồm giá trị ĐANG chọn (resolve tên qua kho tổng) → không flash UUID.
  const khoXuatOptions = React.useMemo<MSOpt[]>(() => {
    const ids = new Set<string>()
    for (const o of scopedOrders) { const id = o.transfer_gdo?.warehouse?.id; if (id) ids.add(id) }
    for (const id of khoXuatFilter) if (id) ids.add(id)
    // Chưa resolve được tên (kho tổng đang tải) → hiện '…', TUYỆT ĐỐI không để lộ UUID.
    return [...ids].map(id => ({ value: id, label: whNameById.get(id) ?? '…' }))
  }, [scopedOrders, khoXuatFilter, whNameById])

  const khoNhanOptions = React.useMemo<MSOpt[]>(() => {
    const ids = new Set<string>()
    // Chỉ lệnh CÓ kho đích (OTHER/khách ngoài không phải kho nhận — đừng đưa kho xuất-scope vào filter)
    for (const o of scopedOrders) { const id = o.destination_warehouse_id ? (o as any).warehouse?.id : null; if (id) ids.add(id) }
    for (const id of khoNhanFilter) if (id) ids.add(id)
    return [...ids].map(id => ({ value: id, label: whNameById.get(id) ?? '…' }))
  }, [scopedOrders, khoNhanFilter, whNameById])

  const filtered = React.useMemo(() => {
    let list = scopedOrders
    if (effDateFrom) list = list.filter(o => o.date >= effDateFrom)
    if (dateTo)   list = list.filter(o => o.date <= dateTo)
    if (khoXuatFilter.length) list = list.filter(o => o.transfer_gdo?.warehouse?.id && khoXuatFilter.includes(o.transfer_gdo.warehouse.id))
    if (khoNhanFilter.length) list = list.filter(o => o.destination_warehouse_id && (o as any).warehouse?.id && khoNhanFilter.includes((o as any).warehouse.id))
    return list
  }, [scopedOrders, effDateFrom, dateTo, khoXuatFilter, khoNhanFilter])

  // Subtotal tab Chuyển kho (SummaryBand) — tính trên dữ liệu ĐÃ filter.
  // Thùng KH = tổng kế hoạch MỌI lệnh (scope). Thực nhận = CHỈ lệnh ĐÃ GIAO (đã hoàn tất nhận).
  // Chênh lệch = Thực nhận − Thùng KH (trừ thẳng 2 ô hiển thị).
  const summary = React.useMemo(() => {
    let plannedBoxes = 0, deliveredActual = 0, delivered = 0
    for (const o of filtered) {
      plannedBoxes += o.planned_boxes ?? 0
      if (o.transfer_gdo?.transfer_status === 'DELIVERED') {
        delivered++
        deliveredActual += o.actual_received ?? 0
      }
    }
    return { count: filtered.length, plannedBoxes, actualBoxes: deliveredActual, diff: deliveredActual - plannedBoxes, delivered }
  }, [filtered])

  // Gom filter tab Chuyển kho về 1 FilterBar (daterange Ngày xuất + Kho xuất/nhận) — đồng bộ tab Kế hoạch
  const transferFilterDefs: FilterDef[] = [
    // from hiển thị effDateFrom để user THẤY cửa sổ 30 ngày mặc định đang áp (xóa filter = về mặc định, không phải "tất cả")
    { key: 'date', label: 'Ngày xuất', type: 'daterange', from: effDateFrom, to: dateTo,
      onChange: (f, t) => { setDateFrom(f); setDateTo(t) } },
    ...(!isSingle ? [
      { key: 'khoxuat', label: 'Kho xuất', type: 'multi' as const, options: khoXuatOptions, selected: khoXuatFilter, onChange: setKhoXuatFilter, searchable: true },
      { key: 'khonhan', label: 'Kho nhận', type: 'multi' as const, options: khoNhanOptions, selected: khoNhanFilter, onChange: setKhoNhanFilter, searchable: true },
    ] : []),
  ]

  return (
    <div className="flex flex-col h-full">
      <TransferOrderDetail order={selectedOrder} canEdit={canEdit} canConfirmReceipt={canConfirmReceipt} onClose={() => setSelectedOrderId(null)} />
      {/* ── Filter bar (gom 1 chỗ qua FilterBar — đồng bộ tab Kế hoạch) ── */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 sm:py-2 border-b bg-white shrink-0">
        <FilterBar defs={transferFilterDefs} />
        <FilterSheetButton defs={transferFilterDefs} className="sm:hidden" />
      </div>
      {!isLoading && filtered.length > 0 && (
        <SummaryBand compact tiles={[
          { label: 'Lệnh',       value: summary.count.toLocaleString('vi-VN') },
          { label: 'Thùng KH',   value: summary.plannedBoxes.toLocaleString('vi-VN') },
          { label: 'Thực nhận',  value: summary.actualBoxes.toLocaleString('vi-VN') },
          { label: 'Chênh lệch', value: summary.diff > 0 ? `+${summary.diff.toLocaleString('vi-VN')}` : summary.diff.toLocaleString('vi-VN'), accent: summary.diff !== 0 },
          { label: 'Đã giao',    value: `${summary.delivered}/${summary.count}`, accent: summary.delivered > 0 },
        ]} />
      )}
      {!isLoading && filtered.length > 0 && (
        <MaterialSummaryBand orderIds={filtered.map(o => o.id)} />
      )}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <div className="py-24 text-center text-sm text-slate-400">Đang tải...</div>
        ) : filtered.length === 0 ? (
          <div className="py-24 text-center text-sm text-slate-400">Không có lệnh chuyển kho nào</div>
        ) : (
          <>
            {/* ── Lệnh chuyển kho ── */}
            <>
              <div className="px-3 py-1.5 border-b bg-slate-50">
                <span className="text-[10px] font-semibold text-slate-500">Lệnh chuyển kho ({filtered.length}{filtered.length < orders.length ? `/${orders.length}` : ''})</span>
                <span className="ml-2 text-[9px] text-slate-400">Click vào dòng để xem chi tiết</span>
              </div>
                {/* KHÔNG bọc overflow-x-auto riêng (sẽ tạo scroll container mới làm hỏng sticky header).
                    Dùng overflow-auto DUY NHẤT ở container ngoài (2477) cho cả cuộn dọc + ngang.
                    Cột kéo giãn: table-fixed + colgroup + tay kéo (useColumnResize). */}
                <Table className="table-fixed [&_th]:overflow-hidden [&_td]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100" style={{ width: totalWidth, minWidth: '100%' }}>
                    <colgroup>
                      {colW.map((w, i) => <col key={i} style={{ width: w }} />)}
                    </colgroup>
                    <TableHeader>
                      <TableRow>
                        {TRANSFER_COLS.map((c, i) => (
                          <TableHead key={c.label} className={`relative h-auto normal-case px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                            {c.label}
                            {i > 0 && (
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
                      {filtered.map(o => {
                        const tStatus = o.transfer_gdo?.transfer_status
                        const cfg = tStatus ? TRANSFER_STATUS_CFG[tStatus] : null
                        const slot = o.vehicle_slots?.[0]
                        const dvvt = o.ncc?.name ?? o.transfer_gdo?.dvvt
                        // Màu HÀNG theo chuẩn rowStatus (rowText) — đồng bộ Inbound/Outbound (statusText §10).
                        // Đã giao = completed (xanh #4A90D9 + STRIKE-THROUGH); Đang nhận = inProgress (cam #D8891C); còn lại = pending (xám).
                        // STRIKE-THROUGH (gạch ngang giữa) áp lên cả TableRow → mọi cell kế thừa đồng nhất; badge GN inline-block tự thoát.
                        const rkey: RowStatusKey = tStatus === 'DELIVERED' ? 'completed' : tStatus === 'RECEIVING' ? 'inProgress' : 'pending'
                        return (
                          <TableRow key={o.id} className={`cursor-pointer ${rowText(rkey)}`}
                            onClick={() => setSelectedOrderId(o.id)}>
                            <TableCell className="px-2 py-1 truncate" title={(o.transfer_gdo?.delivery_codes?.length ?? 0) > 0 ? o.transfer_gdo!.delivery_codes!.join(', ') : undefined}>
                              {(o.transfer_gdo?.delivery_codes?.length ?? 0) > 0
                                ? <span className="text-[10px] font-mono font-semibold">{o.transfer_gdo!.delivery_codes!.join(', ')}</span>
                                : <span className="text-slate-300 text-[10px]">—</span>}
                            </TableCell>
                            <TableCell className="px-2 py-1 whitespace-nowrap">
                              <span className="text-[10px] tabular-nums">{o.created_at ? formatDateTime(o.created_at).slice(0, 16) : '—'}</span>
                            </TableCell>
                            <TableCell className="px-2 py-1 whitespace-nowrap">
                              <span className="text-[10px]">{o.transfer_gdo?.warehouse?.name ?? '—'}{ownMark(o.transfer_gdo?.warehouse?.id)}</span>
                            </TableCell>
                            <TableCell className="px-2 py-1 whitespace-nowrap">
                              <span className="text-[10px] font-semibold">{transferDestLabel(o)}{o.destination_warehouse_id ? ownMark(o.warehouse?.id) : <span className="ml-1 text-[8px] font-medium text-slate-400 border border-slate-200 rounded px-0.5">KH</span>}</span>
                            </TableCell>
                            <TableCell className="px-2 py-1 whitespace-nowrap">
                              {o.receiving_started_at
                                ? <span className="text-[10px] tabular-nums">{formatDateTime(o.receiving_started_at)}</span>
                                : <span className="text-slate-300 text-[10px]">—</span>}
                            </TableCell>
                            <TableCell className="px-2 py-1 whitespace-nowrap text-right">
                              <span className="text-[10px] font-semibold tabular-nums">{o.planned_boxes ?? 0}</span>
                            </TableCell>
                            {(() => {
                              const actual = o.actual_received ?? 0
                              const planned = o.planned_boxes ?? 0
                              const hasStarted = !!o.receiving_started_at
                              const diff = actual - planned
                              const diffCls = diff === 0 ? 'text-green-700' : diff > 0 ? 'text-amber-600' : 'text-red-600'
                              const gnLabel = diff === 0 ? 'Đủ' : diff > 0 ? `Thừa +${diff}` : `Thiếu ${diff}`
                              const gnCls = diff === 0 ? 'bg-green-100 text-green-700' : diff > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                              return (<>
                                <TableCell className="px-2 py-1 whitespace-nowrap text-right">
                                  {hasStarted
                                    ? <span className="text-[10px] font-semibold tabular-nums">{actual}</span>
                                    : <span className="text-slate-300 text-[10px]">—</span>}
                                </TableCell>
                                <TableCell className="px-2 py-1 whitespace-nowrap text-right">
                                  {hasStarted
                                    ? <span className={`text-[10px] font-semibold tabular-nums ${diffCls}`}>{diff > 0 ? `+${diff}` : diff}</span>
                                    : <span className="text-slate-300 text-[10px]">—</span>}
                                </TableCell>
                                {/* Tình trạng GN = format RIÊNG: badge tự màu (đỏ=thiếu, cam=thừa, xanh=đủ).
                                    inline-block để strike-through của hàng "Đã giao" KHÔNG xuyên qua badge (atomic inline). */}
                                <TableCell className="px-2 py-1 whitespace-nowrap">
                                  {hasStarted
                                    ? <span className={`inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full ${gnCls}`}>{gnLabel}</span>
                                    : <span className="text-slate-300 text-[10px]">—</span>}
                                </TableCell>
                              </>)
                            })()}
                            <TableCell className="px-2 py-1 whitespace-nowrap">
                              {o.eta
                                ? <span className="text-[10px] font-semibold">{formatDateTime(o.eta)}</span>
                                : <span className="text-[9px] text-slate-300">—</span>}
                            </TableCell>
                            <TableCell className="px-2 py-1 whitespace-nowrap">
                              <span className="text-[10px]">{dvvt ?? <span className="text-slate-300">—</span>}</span>
                            </TableCell>
                            <TableCell className="px-2 py-1 whitespace-nowrap">
                              <span className="text-[10px] font-mono">{(slot?.license_plate ?? o.transfer_gdo?.license_plate) ?? <span className="text-slate-300">—</span>}</span>
                            </TableCell>
                            <TableCell className="px-2 py-1 whitespace-nowrap">
                              {slot?.driver_phone
                                ? <a href={`tel:${slot.driver_phone}`} onClick={e => e.stopPropagation()} className="text-[10px] text-blue-600 hover:underline">{slot.driver_phone}</a>
                                : <span className="text-slate-300 text-[10px]">—</span>}
                            </TableCell>
                            <TableCell className="px-2 py-1 whitespace-nowrap">
                              {cfg
                                ? <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>
                                : <span className="text-slate-300">—</span>}
                              {/* Kho xuất gỡ HT để sửa — lệnh giữ nguyên (booking không mất), nhận hàng tạm khóa */}
                              {srcEditing(o) && (
                                <span className="inline-block ml-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700"
                                  title="Kho xuất đã bỏ hoàn thành để sửa đơn — booking giữ nguyên, chờ kho xuất hoàn thành lại mới nhận hàng được">
                                  Kho đang sửa
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="px-2 py-1 truncate" title={o.transfer_gdo?.group_code ?? undefined}>
                              <span className="text-[10px] font-mono">{o.transfer_gdo?.group_code ?? '—'}</span>
                            </TableCell>
                            <TableCell className="px-2 py-1 truncate" title={o.notes ?? undefined}>
                              {o.notes
                                ? <span className="text-[10px]">{o.notes}</span>
                                : <span className="text-slate-300 text-[10px]">—</span>}
                            </TableCell>
                            <TableCell className="px-2 py-1 truncate" title={o.order_code}>
                              <span className="text-[10px] font-mono font-semibold">{o.order_code}</span>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
            </>
          </>
        )}
      </div>
    </div>
  )
}

// ── Order Detail Dialog ───────────────────────────────────────────────────────

function OrderDetailDialog({ order, onClose, warehouses, canUploadInbound, canEdit, canDelete, onEditOrder, onDeleteOrder }: {
  order: TmsOrder | null
  onClose: () => void
  warehouses: { id: string; name: string }[]
  canUploadInbound: boolean
  canEdit: boolean
  canDelete: boolean
  onEditOrder: () => void
  onDeleteOrder: () => void
}) {
  const [showUpload, setShowUpload] = useState(false)
  const [addCode, setAddCode]       = useState('')
  const [addBoxes, setAddBoxes]     = useState('')
  const [addPallets, setAddPallets] = useState('')
  const [addSaving, setAddSaving]   = useState(false)
  const [addError, setAddError]     = useState('')
  const [addMatId, setAddMatId]     = useState('')
  const { data: planLines = [] }    = usePlanLinesByOrder(order?.id ?? null)
  const { data: planVsActual = [] } = usePlanVsActual(order?.id ?? null)
  const { data: allMats = [] }      = useMaterials()
  const { mutateAsync: addLines }   = useBulkCreatePlanLinesForOrder()
  const { mutate: deleteLine }      = useDeletePlanLine()

  const existingPlanCodes = useMemo(() =>
    new Set((planLines as Record<string, unknown>[])
      .map(l => ((l.material as Record<string, unknown>)?.material_code as string))
      .filter(Boolean)),
    [planLines]
  )

  const mergedRows = useMemo(() => {
    type MR = { line_id: string | null; material_code: string; material_name: string; unit: string; planned_boxes: number; actual_boxes: number; status: string | null }
    const actualMap = new Map<string, number>()
    for (const row of planVsActual as Record<string, unknown>[]) {
      actualMap.set(row.material_code as string, (row.actual_boxes as number) ?? 0)
    }
    const seen = new Set<string>()
    const rows: MR[] = []
    for (const line of planLines as Record<string, unknown>[]) {
      const mat = line.material as Record<string, unknown>
      const code = mat?.material_code as string
      if (!code || seen.has(code)) continue
      seen.add(code)
      const matFull = (allMats as import('@/types').Material[]).find(m => m.material_code === code)
      rows.push({
        line_id: line.id as string ?? null,
        material_code: code,
        material_name: mat?.short_name as string || '—',
        unit: unitCodeOf(matFull),
        // BASE UNIT: planned_boxes dòng plan = BASE → quy đổi thùng (actualMap từ plan-vs-actual đã là entry)
        planned_boxes: qtyEntryDecimal((line.planned_boxes as number) ?? 0, matFull ?? null),
        actual_boxes: actualMap.get(code) ?? 0,
        status: line.status as string | null,
      })
    }
    for (const row of planVsActual as Record<string, unknown>[]) {
      const code = row.material_code as string
      if (seen.has(code)) continue
      seen.add(code)
      const matFull = (allMats as import('@/types').Material[]).find(m => m.material_code === code)
      rows.push({
        line_id: null,
        material_code: code,
        material_name: row.material_name as string || '—',
        unit: unitCodeOf(matFull),
        planned_boxes: (row.planned_boxes as number) ?? 0,
        actual_boxes: (row.actual_boxes as number) ?? 0,
        status: null,
      })
    }
    return rows
  }, [planLines, planVsActual, allMats])

  async function handleAddLine() {
    const matId = addMatId || (allMats as import('@/types').Material[]).find(m => m.material_code === addCode.trim())?.id
    if (!matId) { setAddError('Không tìm thấy mã hàng'); return }
    const boxes = Number(addBoxes)
    if (!boxes || boxes <= 0) { setAddError('SL thùng phải > 0'); return }
    setAddSaving(true); setAddError('')
    try {
      await addLines({
        tms_order_id: order!.id,
        lines: [{ material_id: matId, planned_boxes: boxes, ...(addPallets ? { planned_pallets: Number(addPallets) } : {}) }],
      })
      setAddCode(''); setAddBoxes(''); setAddPallets(''); setAddMatId('')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setAddError(err.response?.data?.error?.message ?? String(e))
    } finally { setAddSaving(false) }
  }

  if (!order) return null
  const whName = warehouses.find(w => w.id === order.warehouse_id)?.name ?? order.warehouse_id
  const isInbound = order.direction === 'INBOUND'
  // Chỉ Sửa/Xóa khi mọi xe còn PENDING (đồng bộ với điều kiện canEditOrder ở list — tránh sửa/xóa đơn đã book).
  const allPending = order.vehicle_slots.every(vs => vs.status === 'PENDING')

  // ── Cụm action header (ActionCluster) — desktop inline, mobile nút chính + menu ⋮ ──
  const headerActions: ActionItem[] = []
  if (isInbound && canUploadInbound)
    headerActions.push({
      key: 'upload', icon: Upload, label: 'Upload', tip: 'Upload danh sách hàng kế hoạch nhập từ Excel',
      mobileHidden: true, // upload Excel không dùng trên điện thoại (giữ hành vi cũ hidden sm:inline-flex)
      onClick: () => setShowUpload(true),
    })
  if (canEdit && allPending)
    headerActions.push({
      key: 'edit', icon: Pencil, label: 'Sửa', tip: 'Sửa đơn hàng (chỉ khi mọi xe còn Chờ book)',
      primary: true,
      onClick: onEditOrder,
    })
  if (canDelete && allPending)
    headerActions.push({
      key: 'delete', icon: Trash2, label: 'Xóa', tip: 'Xóa đơn hàng (chỉ khi mọi xe còn Chờ book)',
      danger: true, className: 'text-red-600 hover:text-red-700 border-red-200 hover:border-red-300',
      onClick: onDeleteOrder,
    })

  // Info-row dùng chung khung với TransferOrderDetail (label w-16 + value kế thừa style từ children).
  const infoRow = (label: string, value: React.ReactNode, wide = false) => (
    <div className={`flex gap-2 ${wide ? 'col-span-2 sm:col-span-3' : ''}`}>
      <span className="text-slate-400 w-16 shrink-0">{label}</span>
      <span className="font-medium text-slate-700 break-words min-w-0">{value ?? <span className="text-slate-300 font-normal">—</span>}</span>
    </div>
  )

  return (
    <>
    {showUpload && <UploadPlanLinesDialog
      orderId={order.id}
      warehouseType={order.warehouse_type ?? undefined}
      existingCodes={existingPlanCodes}
      onClose={() => setShowUpload(false)}
    />}
    <Dialog open={!!order} onOpenChange={v => !v && onClose()}>
      <DialogContent className="w-screen max-w-[100vw] h-[100dvh] max-h-[100dvh] rounded-none flex flex-col p-0 gap-0 sm:w-[80vw] sm:max-w-[80vw] sm:h-[85vh] sm:max-h-[85vh] sm:rounded-lg">
        <DialogTitle className="sr-only">Chi tiết đơn {order.order_code || ''}</DialogTitle>
        {/* Header — chuẩn TransferOrderDetail: mã + badge + nút phải + info grid 3 cột (gộp audit). pr-10 tránh nút X. */}
        <div className="px-4 pt-3 pb-2 border-b bg-white shrink-0 pr-10">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-sm font-mono font-bold text-slate-800">{order.order_code || 'Chi tiết đơn'}</span>
            {order.direction === 'OUTBOUND' && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">Xuất</span>}
            {order.direction === 'INBOUND'  && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">Nhập</span>}
            {order.priority && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">Ưu tiên</span>}
            <ActionCluster className="ml-auto" items={headerActions} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-0.5 text-[11px]">
            {infoRow('NPP', order.npp_name)}
            {infoRow('Ngày', <span className="font-mono">{formatDate(order.date)}</span>)}
            {infoRow('ĐVVT', order.ncc?.name)}
            {infoRow('Kho', whName)}
            {infoRow('Loại kho', order.warehouse_type)}
            {infoRow('Loại xe', order.vehicle_type)}
            {infoRow('Thùng', order.planned_boxes != null ? `${order.planned_boxes} thùng` : null)}
            {infoRow('Pallet', order.planned_pallets != null ? `${order.planned_pallets} pl` : null)}
            {infoRow('Tấn', order.planned_tons != null ? `${order.planned_tons} t` : null)}
            {order.export_status && infoRow('Tình trạng XH', order.export_status)}
            {infoRow('Người tạo', order.created_by)}
            {infoRow('Giờ tạo', order.created_at ? <span className="font-mono text-[10px]">{formatDateTime(order.created_at)}</span> : null)}
            {infoRow('Người sửa', order.updated_by)}
            {infoRow('Giờ sửa', order.updated_at ? <span className="font-mono text-[10px]">{formatDateTime(order.updated_at)}</span> : null)}
            {order.gdo_refs && infoRow('GDO Refs', <span className="font-mono">{order.gdo_refs}</span>, true)}
            {order.notes && infoRow('Ghi chú', order.notes, true)}
          </div>
        </div>

        {/* Body cuộn — Xe đặt khung giờ + Hàng hóa */}
        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-5 text-xs">
          {/* Vehicle slots */}
          <section>
            <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Xe đặt khung giờ ({order.vehicle_slots.length})</p>
            <div className="overflow-x-auto">
              <table className="min-w-max w-full">
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr>
                    {['#', 'Khung giờ', 'Biển số', 'SĐT', 'Trạng thái', 'Đặt bởi', 'Cập nhật lúc'].map(h => (
                      <th key={h} className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {order.vehicle_slots.map((vs, i) => (
                    <tr key={vs.id} className="border-t border-slate-100">
                      <td className="px-2 py-1 text-[10px] text-slate-400 whitespace-nowrap">{i + 1}</td>
                      <td className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">
                        {vs.slot
                          ? `${vs.slot.time_from.slice(0, 5)}–${vs.slot.time_to.slice(0, 5)}`
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">
                        {vs.license_plate || <span className="text-slate-300 font-normal">—</span>}
                      </td>
                      <td className="px-2 py-1 text-[10px] whitespace-nowrap">{vs.driver_phone || <span className="text-slate-300">—</span>}</td>
                      <td className="px-2 py-1 whitespace-nowrap"><StatusBadge status={vs.status} /></td>
                      <td className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">
                        {vs.booked_by || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-1 text-[10px] font-mono text-slate-500 whitespace-nowrap">{formatDateTime(vs.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Hàng hóa nhập hàng — KH vs Thực tế (chỉ INBOUND), cùng format bảng dòng hàng với Chuyển kho */}
          {isInbound && (
            <section>
              <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Hàng hóa ({mergedRows.length})</p>
              <div className="overflow-x-auto">
                <table className="min-w-max w-full">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr>
                      {['Mã hàng', 'Tên hàng', 'ĐVT', 'Thùng KH', 'Thùng thực', 'Chênh lệch'].map((h, idx) => (
                        <th key={idx} className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mergedRows.length === 0 ? (
                      <tr><td colSpan={6} className="px-2 py-3 text-center text-xs text-slate-400">Chưa có hàng hóa</td></tr>
                    ) : mergedRows.map(row => {
                      const diff = row.actual_boxes - row.planned_boxes
                      const isCancelled = row.status === 'CANCELLED'
                      const f1 = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })   // thùng quy đổi (entry-decimal) → format vi-VN, hết "146.063" đọc nhầm
                      return (
                        <tr key={row.material_code}
                          className={`border-t border-slate-100 ${isCancelled ? 'opacity-50' : diff < 0 && row.actual_boxes > 0 ? 'bg-red-50' : diff > 0 ? 'bg-green-50' : ''}`}>
                          <td className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{row.material_code}</td>
                          <td className="px-2 py-1 text-[10px] max-w-[220px] truncate whitespace-nowrap" title={row.material_name}>{row.material_name}</td>
                          <td className="px-2 py-1 text-[10px] text-slate-400 whitespace-nowrap">{row.unit || '—'}</td>
                          <td className="px-2 py-1 text-[10px] text-right tabular-nums font-semibold whitespace-nowrap">
                            {row.planned_boxes ? f1(row.planned_boxes) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-2 py-1 text-[10px] text-right tabular-nums font-semibold whitespace-nowrap">{row.actual_boxes > 0 ? f1(row.actual_boxes) : <span className="text-slate-300">0</span>}</td>
                          <td className={`px-2 py-1 text-[10px] text-right tabular-nums font-semibold whitespace-nowrap ${diff < 0 && row.actual_boxes > 0 ? 'text-red-600' : diff > 0 ? 'text-green-600' : 'text-slate-300'}`}>
                            {row.actual_boxes > 0 ? (diff > 0 ? `+${f1(diff)}` : f1(diff)) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {/* Form thêm dòng thủ công */}
              {canUploadInbound && (
                <div className="mt-2 space-y-1">
                  <div className="flex gap-1 items-center flex-wrap">
                    <MatCombobox
                      value={addCode}
                      allMats={allMats.filter(m => !m.is_non_stock) as MatItem[]}
                      onSelect={(code, id) => { setAddCode(code); setAddMatId(id); setAddError('') }}
                      inputClassName="h-7 w-36 shrink-0 rounded border border-slate-200 px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    <Input
                      className="h-7 text-xs w-20 shrink-0" placeholder="SL thùng" type="number" min={1}
                      value={addBoxes} onChange={e => setAddBoxes(e.target.value)}
                    />
                    <Input
                      className="h-7 text-xs w-20 shrink-0" placeholder="SL pallet" type="number" min={1}
                      value={addPallets} onChange={e => setAddPallets(e.target.value)}
                    />
                    <Button size="sm" className="h-7 px-2 shrink-0" onClick={handleAddLine}
                      disabled={addSaving || !addCode || !addBoxes}>
                      {addSaving ? '...' : <Plus className="h-3 w-3" />}
                    </Button>
                  </div>
                  {addError && <p className="text-[10px] text-red-500">{addError}</p>}
                </div>
              )}
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TMSBookings() {
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canCreate          = can(perms, 'tms_plan', 'create')
  const canEdit            = can(perms, 'tms_plan', 'edit')
  const canConfirmReceipt  = can(perms, 'tms_plan', 'confirm_receipt')
  const canDelete     = can(perms, 'tms_plan', 'delete')
  const canAddVehicle = can(perms, 'tms_plan', 'add_vehicle')
  const canRelease    = can(perms, 'tms_plan', 'release')
  const canChangeDate = can(perms, 'tms_plan', 'change_date')
  const canBook       = can(perms, 'tms_plan', 'book')
  const canRevoke     = can(perms, 'tms_plan', 'revoke')
  const canView       = can(perms, 'tms_plan', 'view')
  const canUpload         = can(perms, 'tms_plan', 'upload_outbound') || can(perms, 'tms_plan', 'upload_inbound')
  const canUploadInbound  = can(perms, 'tms_plan', 'upload_inbound')
  const isNccUser = user?.department === 'Đơn vị vận tải'

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  // Filter state per-user qua useWmsFilterStore (scopedPersist) — KHÔNG localStorage thuần (sẽ dùng chung giữa user)
  const tf    = useWmsFilterStore(s => s.tmsBookings)
  const setTf = useWmsFilterStore(s => s.setTmsBookings)
  const dateFrom       = tf.dateFrom;  const dateTo            = tf.dateTo
  const warehouseId    = tf.warehouseId; const setWarehouseId  = (v: string)   => setTf({ warehouseId: v })
  const loaiKhoFilter  = tf.loaiKho;   const setLoaiKhoFilter  = (v: string[]) => setTf({ loaiKho: v })
  const loaiXeFilter   = tf.loaiXe;    const setLoaiXeFilter   = (v: string[]) => setTf({ loaiXe: v })
  const huongFilter    = tf.huong;     const setHuongFilter    = (v: string[]) => setTf({ huong: v })
  const dvvtFilter     = tf.dvvt;      const setDvvtFilter     = (v: string[]) => setTf({ dvvt: v })
  const khungGioFilter = tf.khungGio;  const setKhungGioFilter = (v: string[]) => setTf({ khungGio: v })
  const [slotOverviewOpen, setSlotOverviewOpen] = useState(false)

  // Tab Chuyển kho chỉ hiện khi có quyền confirm_receipt (#1) — ẩn hẳn nếu thiếu, ép về 'main'
  const setActiveTab = (t: 'main' | 'transfer') => setTf({ tab: t })
  const activeTab: 'main' | 'transfer' = (tf.tab === 'transfer' && !canConfirmReceipt) ? 'main' : tf.tab

  useEffect(() => { setSelectedOrderIds(new Set()) }, [dateFrom, dateTo, warehouseId])
  const [createOpen, setCreateOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [inboundPlanUploadOpen, setInboundPlanUploadOpen] = useState(false)
  const [editOrder, setEditOrder] = useState<TmsOrder | null>(null)
  const [detailOrder, setDetailOrder] = useState<TmsOrder | null>(null)
  const [bookingSlot, setBookingSlot] = useState<{ vslot: TmsVehicleSlot; order: TmsOrder } | null>(null)
  const [actionErr, setActionErr] = useState('')
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())
  const [changeDateOpen, setChangeDateOpen] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [pendingRelease, setPendingRelease] = useState<{ type: 'release' | 'revoke' | 'delete'; id: string; vslot?: TmsVehicleSlot; label: string } | null>(null)
  const { widths: mainColW, startResize: startMainResize, totalWidth: mainTotalWidth } = useColumnResize('tms_plan_col_widths', MAIN_COL_DEFAULTS)

  const { data: warehouses = [] }             = useScopedWarehouses(true)
  const { data: slotsList = [] }              = useDeliverySlots(warehouseId ? { date: dateFrom, warehouse_id: warehouseId } : undefined)
  const { data: whTypesMain = [] }            = useScopedWhTypes()
  const { data: vehicleTypesMain = [] }       = useVehicleTypes(true)
  const { data: transportCompaniesMain = [] } = useTransportCompanies(true)
  const { data: orders = [], isLoading }      = useTmsOrders(
    (warehouseId || isNccUser) ? { date_from: dateFrom, date_to: dateTo || dateFrom, warehouse_id: warehouseId || undefined } : undefined,
  )
  const nppSuggestions = useMemo(() =>
    [...new Set((orders as TmsOrder[]).map(o => o.npp_name).filter(Boolean) as string[])].sort(),
    [orders]
  )
  const deleteOrder        = useDeleteOrder()
  const addVehicleSlot     = useAddVehicleSlot()
  const releaseVehicleSlot = useReleaseVehicleSlot()
  const revokeVehicleSlot  = useRevokeVehicleSlot()
  const deleteVehicleSlot  = useDeleteVehicleSlot()

  const warehouseName = (warehouses as { id: string; name: string }[]).find(w => w.id === warehouseId)?.name ?? warehouseId

  const khungGioOptions = useMemo<MSOpt[]>(() => {
    const slotOpts: MSOpt[] = (slotsList as DeliverySlot[]).map(s => {
      const parts = [s.time_from.slice(0, 5) + '–' + s.time_to.slice(0, 5)]
      if (s.cargo_type !== 'ALL') parts.push(s.cargo_type)
      if (s.vehicle_type?.name) parts.push(s.vehicle_type.name)
      return { value: s.id, label: parts.join(' · ') }
    })
    return [{ value: '__chua_dat__', label: 'Chưa đặt' }, ...slotOpts]
  }, [slotsList])

  const huongOptions: MSOpt[] = [
    { value: 'OUTBOUND', label: 'Xuất' },
    { value: 'INBOUND',  label: 'Nhập' },
  ]
  const dvvtOptions = useMemo<MSOpt[]>(() =>
    [...new Map((orders as TmsOrder[])
      .filter(o => o.ncc_id && o.ncc?.name)
      .map(o => [o.ncc_id!, { value: o.ncc_id!, label: o.ncc!.name! }])
    ).values()], [orders]
  )
  const loaiKhoOptions = useMemo<MSOpt[]>(() =>
    [...new Set((orders as TmsOrder[]).map(o => o.warehouse_type).filter((v): v is string => !!v))]
      .map(v => ({ value: v, label: v })), [orders]
  )
  const loaiXeOptions = useMemo<MSOpt[]>(() =>
    [...new Set((orders as TmsOrder[]).map(o => o.vehicle_type).filter((v): v is string => !!v))]
      .map(v => ({ value: v, label: v })), [orders]
  )

  // Filter client-side trên orders
  const filteredOrders = useMemo(() => {
    let list = orders as TmsOrder[]
    if (huongFilter.length)    list = list.filter(o => o.direction && huongFilter.includes(o.direction))
    if (dvvtFilter.length)     list = list.filter(o => o.ncc_id && dvvtFilter.includes(o.ncc_id))
    if (loaiKhoFilter.length)  list = list.filter(o => o.warehouse_type && loaiKhoFilter.includes(o.warehouse_type))
    if (loaiXeFilter.length) {
      const directIds = new Set(list.filter(o => o.vehicle_type && loaiXeFilter.includes(o.vehicle_type)).map(o => o.id))
      const partnerGroupIds = new Set<string>()
      for (const o of list) {
        if (!directIds.has(o.id)) continue
        for (const vs of o.vehicle_slots) {
          if (vs.consolidation_group_id) partnerGroupIds.add(vs.consolidation_group_id)
        }
      }
      list = list.filter(o => {
        if (directIds.has(o.id)) return true
        return o.vehicle_slots.some(vs => vs.consolidation_group_id && partnerGroupIds.has(vs.consolidation_group_id))
      })
    }
    if (khungGioFilter.length) {
      list = list.filter(o => o.vehicle_slots.some(vs => {
        if (!vs.slot_id && khungGioFilter.includes('__chua_dat__')) return true
        if (vs.slot_id && khungGioFilter.includes(vs.slot_id)) return true
        return false
      }))
    }
    return list
  }, [orders, huongFilter, dvvtFilter, loaiKhoFilter, loaiXeFilter, khungGioFilter])

  // Tất cả filter tab Kế hoạch gom 1 chỗ qua FilterBar (ngày = daterange Từ–Đến)
  const mainFilterDefs: FilterDef[] = [
    { key: 'date', label: 'Ngày', type: 'daterange', from: dateFrom, to: dateTo,
      onChange: (f, t) => { const nf = f || today; setTf({ dateFrom: nf, dateTo: t || nf }) } },
    { key: 'huong', label: 'Hướng', type: 'single', allLabel: 'Tất cả',
      value: huongFilter.length === 1 ? huongFilter[0] : '',
      onChange: v => setHuongFilter(v ? [v] : []), options: huongOptions },
    { key: 'khunggio', label: 'Khung giờ', type: 'multi', options: khungGioOptions, selected: khungGioFilter, onChange: setKhungGioFilter },
    { key: 'dvvt',     label: 'ĐVVT',      type: 'multi', options: dvvtOptions,     selected: dvvtFilter,     onChange: setDvvtFilter },
    { key: 'loaikho',  label: 'Loại kho',  type: 'multi', options: loaiKhoOptions,  selected: loaiKhoFilter,  onChange: setLoaiKhoFilter },
    { key: 'loaixe',   label: 'Loại xe',   type: 'multi', options: loaiXeOptions,   selected: loaiXeFilter,   onChange: setLoaiXeFilter },
  ]


  // STT ổn định theo toàn kho (không nhảy khi filter) — pre-compute trên ALL orders
  const stableVehicleStt = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>()
    let stt = 0
    for (const o of (orders as TmsOrder[])) {
      const slots = o.vehicle_slots.length > 0 ? o.vehicle_slots : [null as unknown as TmsVehicleSlot]
      for (let si = 0; si < slots.length; si++) {
        const s = slots[si]
        if (s && s.consolidation_group_id && !s.is_consolidation_primary) continue
        map.set(`${o.id}/${si}`, ++stt)
      }
    }
    // Orphans (all slots are secondary)
    for (const o of (orders as TmsOrder[])) {
      if (o.vehicle_slots.some((_, si) => map.has(`${o.id}/${si}`))) continue
      map.set(`${o.id}/0`, ++stt)
    }
    return map
  }, [orders])

  // STT = 1 physical vehicle booking (primary/standalone slot). Secondary orders = sub-rows.
  type TableRow = {
    order: TmsOrder; vslot: TmsVehicleSlot
    slotIndex: number        // index of vslot in order.vehicle_slots (0 = xe chính, >0 = xe phụ)
    isPrimary: boolean       // true = vehicle group header; false = secondary order sub-row
    secIndex: number         // for !isPrimary: ordinal within vehicle group (1, 2, ...)
    stt: number | null       // stable STT from full order list
    sttRowspan: number
    vehicleGroupKey: number  // same for all rows in the same vehicle group (= primary stt)
    rowKey: string           // unique key for this row (matches <TableRow key>)
    spanRowKeys: string[]    // all row keys in this vehicle group (for merged-cell hover)
    blockKey: string         // id đơn CHỦ — gom mọi dòng cùng cụm (xe chính + xe phụ + đơn gom) thành 1 khối
    isFirstOrderRow: boolean
    groupStatus: string      // primary slot's status (for group background)
    groupParity: number      // 0 or 1 based on stable STT, for alternating booked colors
    showSlotCell: boolean
    slotCellRowspan: number
  }
  const tableRows = useMemo<TableRow[]>(() => {
    // Build map: group_id → secondary (order, slot) pairs
    const secondsByGroupId = new Map<string, { order: TmsOrder; slot: TmsVehicleSlot }[]>()
    for (const order of filteredOrders) {
      for (const slot of order.vehicle_slots) {
        if (slot.consolidation_group_id && !slot.is_consolidation_primary) {
          const arr = secondsByGroupId.get(slot.consolidation_group_id) ?? []
          arr.push({ order, slot })
          secondsByGroupId.set(slot.consolidation_group_id, arr)
        }
      }
    }

    const rows: TableRow[] = []
    const seenOrderIds = new Set<string>()

    const emptySlot = (o: TmsOrder): TmsVehicleSlot => ({
      id: '', order_id: o.id, slot_id: null, slot: null,
      license_plate: null, driver_name: null, driver_phone: null,
      status: 'PENDING', booked_by: null,
      consolidation_group_id: null, is_consolidation_primary: false,
      created_at: '', updated_at: '',
    } as TmsVehicleSlot)

    for (const order of filteredOrders) {
      const slots = order.vehicle_slots.length > 0 ? order.vehicle_slots : [emptySlot(order)]
      for (let si = 0; si < slots.length; si++) {
        const slot = slots[si]
        if (slot.consolidation_group_id && !slot.is_consolidation_primary) continue

        const stt = stableVehicleStt.get(`${order.id}/${si}`) ?? 0
        const groupParity = stt % 2
        const groupStatus = slot.status

        const secondaries = slot.consolidation_group_id
          ? (secondsByGroupId.get(slot.consolidation_group_id) ?? [])
          : []
        const totalRows = 1 + secondaries.length
        const shouldMergeSlot = !!slot.slot_id && secondaries.every(s => s.slot.slot_id === slot.slot_id)

        const isFirstOrderRow = !seenOrderIds.has(order.id)
        seenOrderIds.add(order.id)

        const primaryRowKey = `${order.id}-${slot.id}-${si}`
        const secRowKeys = secondaries.map(sec => `${sec.order.id}-${sec.slot.id}-0`)
        const spanRowKeys = [primaryRowKey, ...secRowKeys]

        rows.push({
          order, vslot: slot, slotIndex: si,
          isPrimary: true, secIndex: 0,
          stt, sttRowspan: totalRows,
          vehicleGroupKey: stt,
          rowKey: primaryRowKey, spanRowKeys, blockKey: order.id,
          isFirstOrderRow, groupStatus, groupParity,
          showSlotCell: true,
          slotCellRowspan: shouldMergeSlot ? totalRows : 1,
        })

        let secIdx = 1
        for (const sec of secondaries) {
          const isSecFirstOrderRow = !seenOrderIds.has(sec.order.id)
          seenOrderIds.add(sec.order.id)
          const secRowKey = `${sec.order.id}-${sec.slot.id}-0`
          rows.push({
            order: sec.order, vslot: sec.slot, slotIndex: 0,
            isPrimary: false, secIndex: secIdx++,
            stt: null, sttRowspan: 0,
            vehicleGroupKey: stt,
            rowKey: secRowKey, spanRowKeys, blockKey: order.id,
            isFirstOrderRow: isSecFirstOrderRow,
            groupStatus, groupParity,
            showSlotCell: !shouldMergeSlot,
            slotCellRowspan: shouldMergeSlot ? 0 : 1,
          })
        }
      }
    }

    // Orphaned secondary orders (their primary was filtered out) → standalone rows
    for (const order of filteredOrders) {
      if (seenOrderIds.has(order.id)) continue
      const slot = order.vehicle_slots[0] ?? emptySlot(order)
      const stt = stableVehicleStt.get(`${order.id}/0`) ?? 0
      const orphanRowKey = `${order.id}-${slot.id}-0`
      rows.push({
        order, vslot: slot, slotIndex: 0,
        isPrimary: true, secIndex: 0,
        stt, sttRowspan: 1,
        vehicleGroupKey: stt,
        rowKey: orphanRowKey, spanRowKeys: [orphanRowKey], blockKey: order.id,
        isFirstOrderRow: true,
        groupStatus: slot.status, groupParity: stt % 2,
        showSlotCell: true, slotCellRowspan: 1,
      })
      seenOrderIds.add(order.id)
    }

    return rows
  }, [filteredOrders])

  // Phân trang lưới Kế hoạch: render theo TRANG để không treo khi nhiều đơn/đa-ngày.
  // CẮT TẠI RANH GIỚI CỤM (blockKey) → 1 cụm xe gom/tách luôn trọn 1 trang → rowspan co dãn đúng.
  const [planPage, setPlanPage] = useState(1)
  const [planPageSize, setPlanPageSize] = useState(200)
  const planPages = useMemo<TableRow[][]>(() => {
    const out: TableRow[][] = []
    let cur: TableRow[] = []
    let i = 0
    while (i < tableRows.length) {
      const bk = tableRows[i].blockKey
      const block: TableRow[] = []
      while (i < tableRows.length && tableRows[i].blockKey === bk) { block.push(tableRows[i]); i++ }
      // đóng trang trước khi thêm cụm sẽ vượt cỡ (trang có thể >pageSize chút để trọn cụm — đúng "200 hoặc hơn")
      if (cur.length > 0 && cur.length + block.length > planPageSize) { out.push(cur); cur = [] }
      cur.push(...block)
    }
    if (cur.length) out.push(cur)
    return out
  }, [tableRows, planPageSize])
  const planPageCount = Math.max(1, planPages.length)
  const planSafePage  = Math.min(planPage, planPageCount)
  const pagedRows     = planPages[planSafePage - 1] ?? []
  // Reset về trang 1 khi đổi filter/ngày/kho/cỡ trang — KHÔNG reset khi realtime refetch (giữ trang đang xem)
  useEffect(() => { setPlanPage(1) }, [dateFrom, dateTo, warehouseId, planPageSize, huongFilter, dvvtFilter, loaiKhoFilter, loaiXeFilter, khungGioFilter])

  // Subtotal tab Kế hoạch (SummaryBand) — tính trên dữ liệu ĐÃ filter
  const mainSummary = useMemo(() => {
    let boxes = 0, pallets = 0, tons = 0
    for (const o of filteredOrders) {
      boxes   += o.planned_boxes ?? 0
      pallets += o.planned_pallets ?? 0
      tons    += o.planned_tons ?? 0
    }
    const vehicles = tableRows.filter(r => r.stt !== null).length
    const done = filteredOrders.filter(o => o.vehicle_slots.length > 0 && o.vehicle_slots.every(vs => vs.status === 'DONE')).length
    return { orders: filteredOrders.length, vehicles, boxes, pallets, tons, done }
  }, [filteredOrders, tableRows])

  // Band tổng hợp mã hàng chỉ cho phần NHẬP (Kế hoạch) — đơn INBOUND mới có inbound_plan_lines.
  const inboundOrderIds = useMemo(
    () => filteredOrders.filter(o => o.direction === 'INBOUND').map(o => o.id),
    [filteredOrders])

  const canEditOrder = (o: TmsOrder) =>
    canEdit && o.vehicle_slots.every(vs => vs.status === 'PENDING')

  const canBookSlot = (vs: TmsVehicleSlot) =>
    canBook && ['PENDING','BOOKED'].includes(vs.status) &&
    (!vs.slot || !isSlotTimePassed(vs.slot.date ?? '', vs.slot.time_from ?? ''))

  const canReleaseSlot = (vs: TmsVehicleSlot) =>
    canRelease && vs.status === 'BOOKED' &&
    (!vs.slot || !isSlotTimePassed(vs.slot.date ?? '', vs.slot.time_from ?? ''))

  // Revoke: quyền đặc biệt, bỏ qua kiểm tra giờ — chỉ hiện khi Release không khả dụng
  const canRevokeSlot = (vs: TmsVehicleSlot) =>
    canRevoke &&
    ['BOOKED', 'ARRIVED'].includes(vs.status) &&
    !canReleaseSlot(vs)

  // Đơn NHẬP cũng đổi ngày/xóa được như đơn xuất (BE dọn inbound_plan_lines + đổi date lines theo).
  // Trừ đơn chuyển kho TRANSFER (tự tạo từ Outbound — BE chặn xóa, ngày đi theo GDO).
  const checkableOrderIds = useMemo(() =>
    (canChangeDate || canDelete) ? filteredOrders.filter(o => o.source_type !== 'TRANSFER' && o.vehicle_slots.every(vs => vs.status === 'PENDING')).map(o => o.id) : [],
    [filteredOrders, canChangeDate, canDelete]
  )
  const allChecked = checkableOrderIds.length > 0 && checkableOrderIds.every(id => selectedOrderIds.has(id))
  const someChecked = !allChecked && checkableOrderIds.some(id => selectedOrderIds.has(id))
  const toggleAll = () => setSelectedOrderIds(allChecked ? new Set() : new Set(checkableOrderIds))
  const toggleOrder = (id: string) => setSelectedOrderIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const handleDeleteOrder = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); setActionErr('')
    try { await deleteOrder.mutateAsync(id) }
    catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setActionErr(msg ?? 'Lỗi xóa đơn')
    }
  }

  const handleBulkDelete = async () => {
    setActionErr('')
    const ids = [...selectedOrderIds]
    // Đóng dialog + bỏ chọn NGAY — dòng đã biến mất optimistic (useDeleteOrder.onMutate), không bắt user chờ.
    setSelectedOrderIds(new Set())
    setBulkDeleteOpen(false)
    // Xóa song song; đơn lỗi sẽ tự hiện lại (onError refetch) + banner báo số lượng.
    const results = await Promise.allSettled(ids.map(id => deleteOrder.mutateAsync(id)))
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed) setActionErr(`Đã xóa ${ids.length - failed}/${ids.length} đơn; ${failed} đơn lỗi (đơn đã đặt lịch/không xóa được)`)
  }

  const handleAddVehicleSlot = async (e: React.MouseEvent, orderId: string) => {
    e.stopPropagation(); setActionErr('')
    try { await addVehicleSlot.mutateAsync(orderId) }
    catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setActionErr(msg ?? 'Lỗi thêm xe')
    }
  }

  const handleRelease = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setPendingRelease({ type: 'release', id, label: 'Trả lại khung giờ' })
  }

  const handleRevoke = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setPendingRelease({ type: 'revoke', id, label: 'Thu hồi booking' })
  }

  const executeRelease = async () => {
    if (!pendingRelease) return
    const { type, id, label } = pendingRelease
    setPendingRelease(null)
    setActionErr('')
    try {
      if (type === 'release') await releaseVehicleSlot.mutateAsync(id)
      else if (type === 'revoke') await revokeVehicleSlot.mutateAsync(id)
      else await deleteVehicleSlot.mutateAsync(id)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setActionErr(msg ?? `Lỗi ${label.toLowerCase()}`)
    }
  }

  // Xe phụ: xóa trực tiếp — backend tự giải phóng booked_count nếu đang BOOKED
  const handleReleaseAndDeleteVslot = (e: React.MouseEvent, vslot: TmsVehicleSlot) => {
    e.stopPropagation()
    setPendingRelease({ type: 'delete', id: vslot.id, vslot, label: 'Trả lại & xóa xe phụ' })
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Header */}
      <div className="border-b bg-white px-3 py-1.5 shrink-0 sm:py-2 sm:rounded-t-xl">
        {/* flex-wrap: mobile cụm ActionCluster (w-full) xuống dòng riêng thay vì tràn */}
        <div className="flex items-center justify-between gap-x-2 gap-y-1.5 flex-wrap mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">Kế hoạch vận chuyển</span>
            {/* Toggle 2 tab chỉ hiện khi có quyền nhận hàng chuyển kho — không có quyền thì chỉ xem Kế hoạch (#1) */}
            {canConfirmReceipt && (
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
                <button
                  onClick={() => setActiveTab('main')}
                  className={`px-3 py-1 transition-colors ${activeTab === 'main' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                >Kế hoạch</button>
                <button
                  onClick={() => setActiveTab('transfer')}
                  className={`px-3 py-1 transition-colors border-l border-slate-200 ${activeTab === 'transfer' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                >Chuyển kho</button>
              </div>
            )}
          </div>
          {/* Mobile: cluster chia sẻ hàng với title+tab (PDA) — mobileInline */}
          <ActionCluster className="shrink-0" mobileInline items={[
            ...(warehouseId && canView ? [{
              key: 'slot-overview', icon: Eye, label: 'Xem booking', tip: 'Xem tình trạng khung giờ booking của kho',
              onClick: () => setSlotOverviewOpen(true),
            } satisfies ActionItem] : []),
            ...(can(perms, 'tms_plan', 'upload_outbound') ? [{
              key: 'upload-outbound', icon: Upload, label: 'Upload xuất', tip: 'Upload kế hoạch xuất từ file Excel',
              mobileHidden: true, // upload Excel không dùng trên điện thoại (giữ hành vi cũ hidden sm:inline-flex)
              onClick: () => setUploadOpen(true),
            } satisfies ActionItem] : []),
            ...(canUploadInbound ? [{
              key: 'upload-inbound', icon: FileSpreadsheet, label: 'Upload KH nhập', tip: 'Upload kế hoạch nhập từ file Excel',
              mobileHidden: true, // upload Excel không dùng trên điện thoại (giữ hành vi cũ hidden sm:inline-flex)
              onClick: () => setInboundPlanUploadOpen(true),
            } satisfies ActionItem] : []),
            ...(canCreate ? [{
              key: 'create', icon: Plus, label: 'Thêm đơn',
              tip: !warehouseId ? 'Chọn kho trước khi thêm đơn' : 'Tạo đơn kế hoạch vận chuyển mới',
              primary: true, variant: 'default', disabled: !warehouseId,
              onClick: () => setCreateOpen(true),
            } satisfies ActionItem] : []),
          ]} />
        </div>
        {activeTab === 'main' && (
          <div className="flex items-center gap-2 flex-wrap">
            <WarehouseSingleSelect
              warehouses={warehouses as { id: string; code?: string; name: string }[]}
              value={warehouseId}
              onChange={setWarehouseId}
              allLabel={isNccUser ? '— Tất cả kho —' : undefined}
              placeholder="— Chọn kho —"
              triggerClassName="h-8 w-[200px]"
            />
            {(warehouseId || isNccUser) && <FilterBar defs={mainFilterDefs} />}
            {(warehouseId || isNccUser) && <FilterSheetButton defs={mainFilterDefs} className="sm:hidden" />}
            {(canChangeDate || canDelete) && selectedOrderIds.size > 0 && (
              <div className="flex items-center gap-2 w-full py-0.5 flex-wrap">
                <span className="text-xs text-slate-600 font-medium">{selectedOrderIds.size} đơn đã chọn</span>
                <ActionCluster items={[
                  ...(canChangeDate ? [{
                    key: 'change-date', icon: CalendarDays, label: 'Đổi ngày', tip: 'Đổi ngày giao cho các đơn đã chọn',
                    primary: true,
                    onClick: () => setChangeDateOpen(true),
                  } satisfies ActionItem] : []),
                  ...(canDelete ? [{
                    key: 'bulk-delete', icon: Trash2, label: 'Xóa', tip: 'Xóa các đơn đã chọn (kèm slot xe chưa đặt lịch)',
                    danger: true, className: 'text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700',
                    onClick: () => setBulkDeleteOpen(true),
                  } satisfies ActionItem] : []),
                  {
                    key: 'clear-selection', icon: X, label: 'Bỏ chọn', tip: 'Bỏ chọn tất cả đơn đang chọn',
                    className: 'text-slate-500',
                    onClick: () => setSelectedOrderIds(new Set()),
                  } satisfies ActionItem,
                ]} />
              </div>
            )}
            {actionErr && <p className="text-xs text-red-600 w-full">{actionErr}</p>}
          </div>
        )}
      </div>

      {/* Content */}
      {activeTab === 'transfer' ? (
        // KHÔNG overflow-auto ở đây — TransferOrdersPanel tự quản scroll (tránh lồng 2 lớp làm hỏng sticky header).
        <div className="flex-1 min-h-0 flex flex-col">
          <TransferOrdersPanel
            canEdit={canEdit} canConfirmReceipt={canConfirmReceipt}
            userScope={user?.warehouse_scope ?? 'ASSIGNED'}
            userWarehouseId={user?.warehouse_id ?? null}
            userWarehouseIds={user?.warehouse_ids ?? []}
          />
        </div>
      ) : null}
      {activeTab === 'main' && (warehouseId || isNccUser) && tableRows.length > 0 && (
        <SummaryBand compact tiles={[
          { label: 'Đơn',        value: mainSummary.orders.toLocaleString('vi-VN') },
          { label: 'Xe',         value: mainSummary.vehicles.toLocaleString('vi-VN') },
          { label: 'Thùng',      value: mainSummary.boxes.toLocaleString('vi-VN') },
          { label: 'Pallet',     value: mainSummary.pallets.toLocaleString('vi-VN') },
          { label: 'Tấn',        value: mainSummary.tons.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) },
          { label: 'Hoàn thành', value: `${mainSummary.done}/${mainSummary.orders}`, accent: mainSummary.done > 0 },
        ]} />
      )}
      {activeTab === 'main' && (warehouseId || isNccUser) && (
        <MaterialSummaryBand orderIds={inboundOrderIds} />
      )}
      <div className={`flex-1 min-h-0 overflow-auto pb-20 lg:pb-4 ${activeTab !== 'main' ? 'hidden' : ''}`}>
        {!warehouseId && !isNccUser ? (
          <div className="py-24 text-center text-sm text-slate-400">Chọn kho để xem kế hoạch</div>
        ) : isLoading ? (
          <div className="py-24 text-center text-sm text-slate-400">Đang tải...</div>
        ) : !tableRows.length ? (
          <div className="py-24 text-center text-sm text-slate-400">Chưa có đơn hàng nào trong khoảng ngày này</div>
        ) : (
          <Table className="table-fixed [&_th]:overflow-hidden [&_td]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100" style={{ width: mainTotalWidth, minWidth: '100%' }}>
            <colgroup>
              {mainColW.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <TableHeader>
              <TableRow>
                {MAIN_COLS.map((c, i) => (
                  <TableHead key={i} className={`px-2 py-1.5 text-[9px] font-medium whitespace-nowrap ${c.cls ?? 'text-slate-500'} ${c.align === 'right' ? 'text-right' : ''}`}>
                    {i === 0
                      ? checkableOrderIds.length > 0 && (
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 cursor-pointer"
                            checked={allChecked}
                            ref={el => { if (el) el.indeterminate = someChecked }}
                            onChange={toggleAll}
                          />
                        )
                      : c.label}
                    {c.resize !== false && (
                      <span
                        onPointerDown={e => startMainResize(i, e)}
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
              {pagedRows.flatMap(({ order, vslot, slotIndex, isPrimary, secIndex, stt, sttRowspan, rowKey, spanRowKeys, blockKey, isFirstOrderRow, groupStatus, groupParity, showSlotCell, slotCellRowspan }, rowIndex) => {
                // Khối = mọi dòng cùng đơn chủ (xe chính + xe phụ + đơn gom). Chỉ kẻ/ngăn ở ĐẦU và CUỐI khối,
                // KHÔNG chia giữa các dòng cùng khối (tránh đứt đường nối khi 1 đơn đi nhiều xe).
                // Nhóm để TÁCH (như bong bóng chat): phần XE NHÀ (cùng đơn, KHÔNG gom) là 1 nhóm; mỗi CỤM GOM
                // (đơn chính + đơn phụ đi chung xe) là nhóm RIÊNG — nên cùng 1 đơn nhưng phần xe gom vẫn tách khỏi xe nhà.
                const sepKeyOf = (i: number) => {
                  const r = pagedRows[i]
                  return r.vslot.consolidation_group_id ? `cg-${r.vehicleGroupKey}` : `blk-${r.blockKey}`
                }
                const sepKey = sepKeyOf(rowIndex)
                const sepStart = rowIndex === 0 || sepKeyOf(rowIndex - 1) !== sepKey
                const sepEnd   = rowIndex === pagedRows.length - 1 || sepKeyOf(rowIndex + 1) !== sepKey
                const isMultiRowGroup = !(sepStart && sepEnd)
                const prevGroupMulti  = rowIndex >= 2 && sepKeyOf(rowIndex - 2) === sepKeyOf(rowIndex - 1)
                // Tách (khe trống ~bong bóng) ở RANH GIỚI có ÍT NHẤT 1 nhóm nhiều dòng (cụm xe / đơn gom).
                // Giữa 2 đơn LẺ liền nhau = KHÔNG tách (chỉ kẻ ngang thường).
                const showGap = sepStart && rowIndex > 0 && (isMultiRowGroup || prevGroupMulti)
                // Nếu connector tree (cùng 1 đơn đi nhiều xe) băng qua khe → vẽ tiếp line dọc xám để KHÔNG đứt mũi tên.
                const orderSpansGap = showGap && pagedRows[rowIndex - 1].order.id === order.id
                const grpSpacer = showGap
                  ? (
                    <tr key={`sp-${rowKey}`} aria-hidden className="pointer-events-none">
                      <td className="p-0 border-0 w-8" />
                      <td className="p-0 border-0 relative">
                        {orderSpansGap && <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-300" />}
                        <div className="h-2" />
                      </td>
                      <td colSpan={22} className="p-0 border-0 bg-transparent" />
                    </tr>
                  )
                  : null
                const isConsolidated = !!vslot.consolidation_group_id
                const isGroupHovered = spanRowKeys.includes(hoveredRow ?? '')
                const rowTextCls = (() => {
                  // Highlight CẢ ROW theo Tình trạng XH — đồng bộ màu tab Chuyển kho:
                  // Đã xuất / hoàn thành = xanh dương + gạch ngang; Đang xuất = cam; Đăng ký / chưa xuất = trung tính; Hủy = xám mờ + gạch.
                  if (order.status === 'CANCELLED') return 'text-slate-400 line-through'
                  if (vslot.gate_export_status === 'Đã xuất' || groupStatus === 'DONE') return statusText('completed')
                  if (vslot.gate_export_status === 'Đang xuất') return statusText('inProgress')
                  return ''
                })()
                const cellHoverBg = isGroupHovered ? 'bg-slate-100' : ''
                // Phân biệt nhóm CHỈ bằng NỀN (không border): cụm GOM / xe ghép (đi chung xe với đơn khác) = nền sky;
                // xe phụ thường (cùng đơn, nhiều xe) = nền slate; đơn LẺ 1 dòng = nền trắng.
                // Nền đổi màu giữa các nhóm = đã đủ tách row, KHÔNG cắt đường nối tree (mũi tên liền mạch).
                const rowBg = isConsolidated ? 'bg-sky-100' : (isMultiRowGroup ? 'bg-slate-50' : '')
                return [grpSpacer,
                <TableRow key={rowKey}
                  onMouseEnter={() => setHoveredRow(rowKey)}
                  onMouseLeave={() => setHoveredRow(null)}
                  onClick={() => setDetailOrder(order)}
                  className={[
                  'hover:bg-transparent cursor-pointer',
                  // Dòng đầu mỗi bong bóng (ngay sau khe trống) thiếu vạch trên vì spacer border-0 → thêm border-t.
                  showGap ? 'border-t' : '',
                  rowTextCls,
                  rowBg,
                ].filter(Boolean).join(' ')}>
                  <TableCell
                    className={`px-2 py-1 w-8 ${cellHoverBg}`}
                    style={(() => {
                      // CSS background gradient — không dùng position:absolute (unreliable trong td)
                      // background-position "center" = tâm cell theo chiều ngang → thẳng trục checkbox
                      const c = '#14b8a6'
                      const g = `linear-gradient(${c},${c})`
                      if (isPrimary && isConsolidated && sttRowspan > 1) {
                        // Đơn chính: đường dọc nửa dưới + hook ngang sang phải
                        return { backgroundImage: `${g},${g}`, backgroundSize: '1px 50%,50% 1px', backgroundPosition: 'center bottom,right center', backgroundRepeat: 'no-repeat' }
                      }
                      if (!isPrimary) {
                        const isLastSec = rowKey === spanRowKeys[spanRowKeys.length - 1]
                        // Secondary: đường dọc (full/nửa trên) + hook ngang
                        return { backgroundImage: `${g},${g}`, backgroundSize: `1px ${isLastSec ? '50%' : '100%'},50% 1px`, backgroundPosition: `center ${isLastSec ? 'top' : 'center'},right center`, backgroundRepeat: 'no-repeat' }
                      }
                      return undefined
                    })()}
                  >
                    {isFirstOrderRow && checkableOrderIds.includes(order.id) && (
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 cursor-pointer"
                        checked={selectedOrderIds.has(order.id)}
                        onChange={() => toggleOrder(order.id)}
                        onClick={e => e.stopPropagation()}
                      />
                    )}
                  </TableCell>
                  <TableCell className={`relative px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap ${cellHoverBg}`}>
                    {slotIndex === 0 ? (
                      <>
                        {order.vehicle_slots.length > 1 && (
                          <div className="absolute left-1/2 top-1/2 bottom-0 w-px bg-slate-300 pointer-events-none" />
                        )}
                        {order.order_code || <span className="text-slate-400 font-normal">—</span>}
                      </>
                    ) : (() => {
                      const nextRow = pagedRows[rowIndex + 1]
                      const isLast = !nextRow || nextRow.order.id !== order.id || nextRow.slotIndex === 0
                      return (
                        <>
                          {/* Đường dọc: nửa trên để nối từ xe chính xuống; tiếp tục full nếu còn xe phụ */}
                          <div className={`absolute left-1/2 w-px bg-slate-300 pointer-events-none ${isLast ? 'top-0 h-1/2' : 'top-0 bottom-0'}`} />
                          {/* Nhánh ngang + CSS triangle arrowhead — một khối duy nhất, không dùng ký tự font */}
                          <div className="absolute left-1/2 right-0 top-1/2 -translate-y-1/2 flex items-center pointer-events-none">
                            <div className="flex-1 h-px bg-slate-300" />
                            <div className="w-0 h-0 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent border-l-[4px] border-l-slate-300 shrink-0" />
                          </div>
                        </>
                      )
                    })()}
                  </TableCell>
                  <TableCell className={`px-2 py-1 text-[10px] font-semibold whitespace-nowrap ${cellHoverBg}`}>
                    {isPrimary
                      ? <>
                          {isConsolidated && sttRowspan > 1 && <span className="font-normal text-teal-600">(đơn chính): </span>}
                          {order.npp_name || <span className="text-slate-400 font-normal">—</span>}
                        </>
                      : <>
                          <span className="font-normal text-teal-600">(đơn phụ {secIndex}): </span>
                          {order.npp_name || <span className="text-slate-400 font-normal">—</span>}
                        </>
                    }
                  </TableCell>

                  {/* Đặt giờ — luôn hiện cho mỗi vehicle slot */}
                  <TableCell className={`px-2 py-1 ${cellHoverBg}`}>
                    {vslot.id && !vslot.id.startsWith('_temp_') && canBookSlot(vslot) && (
                      <button
                        onClick={e => { e.stopPropagation(); setBookingSlot({ vslot, order }) }}
                        className="text-blue-400 hover:text-blue-600 p-1 rounded"
                        title="Đặt khung giờ"
                      >
                        <Truck className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </TableCell>

                  <TableCell className={`px-2 py-1 text-[10px] font-mono whitespace-nowrap ${cellHoverBg}`}>
                    {order.date ? formatDate(order.date) : <span className="text-slate-300">—</span>}
                  </TableCell>
                  {showSlotCell && (
                    <TableCell rowSpan={slotCellRowspan > 1 ? slotCellRowspan : undefined} className={`px-2 py-1 text-[10px] whitespace-nowrap align-middle ${cellHoverBg}`}>
                      {vslot.slot && (
                        <span className="font-mono">{vslot.slot.time_from.slice(0, 5)}–{vslot.slot.time_to.slice(0, 5)}</span>
                      )}
                    </TableCell>
                  )}
                  {/* Biển số — merge qua tất cả rows cùng vehicle group */}
                  {stt !== null && (
                    <TableCell rowSpan={sttRowspan > 1 ? sttRowspan : undefined} className={`px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap align-middle ${cellHoverBg}`}>
                      {vslot.license_plate ? (
                        <span className="flex items-center gap-0.5">
                          {user?.employee_code && vslot.license_plate === user.employee_code && (
                            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400 shrink-0" />
                          )}
                          {vslot.license_plate}
                        </span>
                      ) : <span className="text-slate-400 font-normal">—</span>}
                    </TableCell>
                  )}
                  {stt !== null && (
                    <TableCell rowSpan={sttRowspan > 1 ? sttRowspan : undefined} className={`px-2 py-1 text-[10px] whitespace-nowrap max-w-[120px] truncate align-middle ${cellHoverBg}`}>
                      {order.ncc?.name || <span className="text-slate-300">—</span>}
                    </TableCell>
                  )}
                  <TableCell className={`px-2 py-1 w-6 text-center ${cellHoverBg}`}>
                    {order.priority && <span className="text-[10px] font-bold text-red-600">x</span>}
                  </TableCell>
                  {/* Hướng — merge qua tất cả rows cùng vehicle group */}
                  {stt !== null && (
                    <TableCell rowSpan={sttRowspan > 1 ? sttRowspan : undefined} className={`px-2 py-1 text-[10px] whitespace-nowrap align-middle ${cellHoverBg}`}>
                      {order.direction ? (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${order.direction === 'OUTBOUND' ? 'bg-orange-100 text-orange-700' : 'bg-teal-100 text-teal-700'}`}>
                          {order.direction === 'OUTBOUND' ? 'Xuất' : 'Nhập'}
                        </span>
                      ) : <span className="text-slate-400">—</span>}
                    </TableCell>
                  )}
                  {/* Loại kho — merge qua tất cả rows cùng vehicle group */}
                  {stt !== null && (
                    <TableCell rowSpan={sttRowspan > 1 ? sttRowspan : undefined} className={`px-2 py-1 text-[10px] whitespace-nowrap align-middle ${cellHoverBg}`}>
                      {order.warehouse_type || <span className="text-slate-400">—</span>}
                    </TableCell>
                  )}
                  <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap ${cellHoverBg}`}>
                    {order.vehicle_type || <span className="text-slate-400">—</span>}
                  </TableCell>
                  <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap tabular-nums text-right ${cellHoverBg}`}>
                    {order.planned_boxes != null
                      ? <>{order.planned_boxes}<span className="text-slate-400 text-[9px]"> thùng</span></>
                      : <span className="text-slate-400">—</span>}
                  </TableCell>
                  <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap tabular-nums text-right ${cellHoverBg}`}>
                    {order.planned_pallets != null
                      ? <>{order.planned_pallets}<span className="text-slate-400 text-[9px]"> pl</span></>
                      : <span className="text-slate-400">—</span>}
                  </TableCell>
                  <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap tabular-nums text-right ${cellHoverBg}`}>
                    {order.planned_tons != null
                      ? <>{order.planned_tons}<span className="text-slate-400 text-[9px]"> t</span></>
                      : <span className="text-slate-400">—</span>}
                  </TableCell>
                  <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap ${cellHoverBg}`}>
                    {vslot.driver_phone || <span className="text-slate-400">—</span>}
                  </TableCell>
                  {stt !== null && (
                    <TableCell rowSpan={sttRowspan > 1 ? sttRowspan : undefined} className={`px-2 py-1 whitespace-nowrap align-middle ${cellHoverBg}`}>
                      <StatusBadge status={groupStatus} />
                    </TableCell>
                  )}
                  <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap ${cellHoverBg}`}>
                    {/* Màu kế thừa từ row (đã highlight theo Tình trạng XH) — không override. */}
                    {vslot.gate_export_status || <span className="text-slate-300">—</span>}
                  </TableCell>
                  {stt !== null && (
                    <TableCell rowSpan={sttRowspan > 1 ? sttRowspan : undefined} className={`px-2 py-1 text-[10px] font-mono whitespace-nowrap align-middle ${cellHoverBg}`}>
                      {order.completed_at
                        ? <span className="text-green-700 font-semibold">{fmtTime(order.completed_at)}</span>
                        : <span className="text-slate-300">—</span>}
                    </TableCell>
                  )}
                  <TableCell className={`px-2 py-1 text-[10px] font-mono whitespace-nowrap ${cellHoverBg}`}>
                    {fmtTime(vslot.gate_registered_at)}
                  </TableCell>
                  <TableCell className={`px-2 py-1 text-[10px] font-mono whitespace-nowrap ${cellHoverBg}`}>
                    {fmtTime(vslot.gate_entry_at)}
                  </TableCell>
                  <TableCell className={`px-2 py-1 text-[10px] font-mono whitespace-nowrap ${cellHoverBg}`}>
                    {fmtTime(vslot.gate_exit_at)}
                  </TableCell>
                  <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap ${cellHoverBg}`}>
                    {isFirstOrderRow ? ((warehouses as { id: string; name: string }[]).find(w => w.id === order.warehouse_id)?.name ?? '—') : ''}
                  </TableCell>
                  <TableCell className={`px-2 py-1 ${cellHoverBg}`}>
                    <div className="flex items-center gap-0.5">
                      {/* Sửa đơn — mọi đơn (INBOUND giờ quản lý ngay tại TMS, inbound-plan đã gộp vào đây), khi mọi xe còn PENDING */}
                      {isFirstOrderRow && canEditOrder(order) && (
                        <button
                          onClick={e => { e.stopPropagation(); setEditOrder(order) }}
                          className="text-slate-400 hover:text-slate-600 p-1 rounded"
                          title="Sửa đơn hàng"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Thêm xe phụ — dòng cuối của order, chỉ điều vận, chỉ khi xe chính đã BOOKED */}
                      {isPrimary && canAddVehicle && order.vehicle_slots.length > 0 && order.vehicle_slots[order.vehicle_slots.length - 1].id === vslot.id && order.vehicle_slots[0].status !== 'PENDING' && (
                        <button
                          onClick={e => handleAddVehicleSlot(e, order.id)}
                          className="text-purple-400 hover:text-purple-600 p-1 rounded"
                          title="Thêm xe (bốc cùng đơn)"
                        >
                          <PlusCircle className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Trả lại — xe chính (slotIndex=0) và đơn phụ (!isPrimary) */}
                      {vslot.id && (slotIndex === 0 || !isPrimary) && canReleaseSlot(vslot) && (
                        <button
                          onClick={e => handleRelease(e, vslot.id)}
                          className="text-amber-400 hover:text-amber-600 p-1 rounded"
                          title="Trả lại khung giờ"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Revoke — quyền đặc biệt, bỏ qua giờ (xe chính, xe phụ, đơn chính, đơn phụ) */}
                      {vslot.id && canRevokeSlot(vslot) && (
                        <button
                          onClick={e => handleRevoke(e, vslot.id)}
                          className="text-rose-400 hover:text-rose-600 p-1 rounded"
                          title="Thu hồi booking (bỏ qua giờ)"
                        >
                          <ShieldX className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Xe phụ (slotIndex > 0): trả lại + xóa slot */}
                      {vslot.id && isPrimary && slotIndex > 0 && canAddVehicle && ['PENDING', 'BOOKED'].includes(vslot.status) && (!vslot.slot || !isSlotTimePassed(vslot.slot.date ?? '', vslot.slot.time_from ?? '')) && (
                        <button
                          onClick={e => handleReleaseAndDeleteVslot(e, vslot)}
                          className="text-amber-400 hover:text-amber-600 p-1 rounded"
                          title="Trả lại & xóa xe phụ"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Xóa đơn — mọi đơn (BE dọn inbound_plan_lines cho INBOUND), khi tất cả slots PENDING */}
                      {isFirstOrderRow && canDelete && order.vehicle_slots.every(vs => vs.status === 'PENDING') && (
                        <button
                          onClick={e => handleDeleteOrder(e, order.id)}
                          className="text-red-400 hover:text-red-600 p-1 rounded"
                          title="Xóa đơn hàng"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                ]
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Footer đếm bản ghi + phân trang */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 sm:rounded-b-xl flex items-center gap-3 flex-wrap">
        {activeTab === 'main' ? (
          <>
            <span>{(orders as TmsOrder[]).length.toLocaleString('vi-VN')} đơn · {tableRows.length.toLocaleString('vi-VN')} dòng</span>
            {planPageCount > 1 && (
              <span className="flex items-center gap-1.5">
                <button className="px-2 py-0.5 rounded border border-slate-300 disabled:opacity-40 hover:bg-slate-100" disabled={planSafePage <= 1} onClick={() => setPlanPage(p => Math.max(1, p - 1))}>‹ Trước</button>
                <span className="tabular-nums">Trang {planSafePage}/{planPageCount}</span>
                <button className="px-2 py-0.5 rounded border border-slate-300 disabled:opacity-40 hover:bg-slate-100" disabled={planSafePage >= planPageCount} onClick={() => setPlanPage(p => Math.min(planPageCount, p + 1))}>Sau ›</button>
              </span>
            )}
            <span className="flex items-center gap-1">Cỡ trang:
              {[200, 500, 1000].map(sz => (
                <button key={sz} className={`px-1.5 py-0.5 rounded border ${planPageSize === sz ? 'border-sky-500 text-sky-700 bg-sky-50' : 'border-slate-300 hover:bg-slate-100'}`} onClick={() => setPlanPageSize(sz)}>{sz}</button>
              ))}
            </span>
          </>
        ) : 'Chuyển kho'}
      </div>
     </div>

      <CreateEditDialog
        open={createOpen || !!editOrder}
        order={editOrder}
        onClose={() => { setCreateOpen(false); setEditOrder(null) }}
        defaultDate={dateFrom}
        defaultWarehouseId={warehouseId}
        nppSuggestions={nppSuggestions}
      />
      <BookSlotDialog
        vslot={bookingSlot?.vslot ?? null}
        order={bookingSlot?.order ?? null}
        onClose={() => setBookingSlot(null)}
        allOrders={orders as TmsOrder[]}
      />
      <SlotOverviewDialog
        open={slotOverviewOpen}
        onClose={() => setSlotOverviewOpen(false)}
        defaultDate={dateFrom}
        warehouseId={warehouseId}
        warehouseName={warehouseName}
      />
      <InboundPlanBulkUploadDialog
        open={inboundPlanUploadOpen}
        warehouseId={warehouseId}
        onClose={() => setInboundPlanUploadOpen(false)}
      />
      <ExcelUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        warehouses={warehouses as { id: string; name: string }[]}
        warehouseTypes={whTypesMain.map(t => t.value)}
        vehicleTypes={vehicleTypesMain as TmsVehicleType[]}
        transportCompanies={transportCompaniesMain as TransportCompany[]}
      />
      <ChangeDateDialog
        open={changeDateOpen}
        orderIds={[...selectedOrderIds]}
        currentDate={dateFrom}
        onClose={() => { setChangeDateOpen(false); setSelectedOrderIds(new Set()) }}
      />
      <Dialog open={bulkDeleteOpen} onOpenChange={o => !o && setBulkDeleteOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Xóa {selectedOrderIds.size} đơn kế hoạch?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            Xóa vĩnh viễn {selectedOrderIds.size} đơn đã chọn (kèm slot xe chưa đặt lịch). Không thể hoàn tác.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)} disabled={deleteOrder.isPending}>Hủy</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleBulkDelete} disabled={deleteOrder.isPending}>
              {deleteOrder.isPending ? 'Đang xóa…' : `Xóa ${selectedOrderIds.size} đơn`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <OrderDetailDialog
        order={detailOrder}
        onClose={() => setDetailOrder(null)}
        warehouses={warehouses as { id: string; name: string }[]}
        canUploadInbound={canUploadInbound}
        canEdit={canEdit}
        canDelete={canDelete}
        onEditOrder={() => { setEditOrder(detailOrder); setDetailOrder(null) }}
        onDeleteOrder={() => {
          if (!detailOrder) return
          if (!confirm(`Xóa đơn ${detailOrder.order_code}?`)) return
          const id = detailOrder.id
          setDetailOrder(null)
          deleteOrder.mutate(id)
        }}
      />
      <Dialog open={!!pendingRelease} onOpenChange={() => setPendingRelease(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">{pendingRelease?.label}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-600 py-1">Xác nhận thực hiện thao tác này?</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setPendingRelease(null)}>Hủy</Button>
            <Button size="sm" variant="destructive" onClick={executeRelease}>Xác nhận</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
