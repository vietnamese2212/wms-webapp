import React, { useState, useEffect, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { Plus, Upload, Pencil, Truck, Trash2, Download, RotateCcw, Star, Eye, PlusCircle, Link2, CalendarDays, ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import type { MSOpt } from '@/components/shared/MultiSelectFilter'
import { can, type ModulePermissions } from '@/config/permissions'
import { useAuthStore } from '@/stores/authStore'
import {
  useWarehouses, useWarehouseTypes, useVehicleTypes, useTransportCompanies, useTmsVehicles,
  useDeliverySlots, useGenerateSlots,
  useTmsOrders, useCreateOrder, useUpdateOrder, useDeleteOrder, useBulkCreateOrders, useBulkUpdateOrderDate,
  useAddVehicleSlot, useUpdateVehicleSlot, useReleaseVehicleSlot, useRevokeVehicleSlot, useDeleteVehicleSlot,
} from '@/api/hooks'
import { formatDate } from '@/utils/formatters'
import type { TmsOrder, TmsVehicleSlot, DeliverySlot, TmsVehicleType, TmsVehicle, TransportCompany } from '@/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    generateSlots(
      { warehouse_id: warehouseId, dates: [date] },
      { onSettled: () => setGenerateDone(true) },
    )
  }, [warehouseId, date])

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
              'w-full text-left px-3 py-2 rounded border text-xs flex items-center justify-between transition-colors',
              selected ? 'border-blue-500 bg-blue-50'
                : disabled ? 'border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed'
                : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 cursor-pointer',
            ].join(' ')}
          >
            <span className="flex items-center gap-2">
              <span className="font-mono font-semibold">{slot.time_from.slice(0, 5)}–{slot.time_to.slice(0, 5)}</span>
              <span className="text-slate-500">{slot.cargo_type === 'ALL' ? 'Tất cả' : slot.cargo_type}</span>
              {slot.vehicle_type?.name && (
                <span className="text-[9px] bg-blue-100 text-blue-700 px-1 rounded">{slot.vehicle_type.name}</span>
              )}
              {past && !selected && <span className="text-[9px] text-slate-400">đã qua</span>}
            </span>
            <span className={`font-semibold tabular-nums ${full && !selected ? 'text-red-500' : past && !selected ? 'text-slate-400' : 'text-green-600'}`}>
              {slot.booked_count}/{slot.max_vehicles} xe
            </span>
          </button>
        )
      })}
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
    !isDriver && order?.ncc_id ? { ncc_id: order.ncc_id, is_active: 'true' } : undefined
  )

  const [selectedSlot, setSelectedSlot] = useState<DeliverySlot | null>(null)
  const [licensePlate, setLicensePlate] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [consolidationOrderIds, setConsolidationOrderIds] = useState<string[]>([])
  const [err, setErr] = useState('')

  useEffect(() => {
    if (vslot) {
      setSelectedSlot((vslot.slot as DeliverySlot | null) ?? null)
      setLicensePlate(isDriver ? (user?.employee_code ?? '') : (vslot.license_plate ?? ''))
      setDriverPhone(vslot.driver_phone ?? '')
      setConsolidationOrderIds([])
      setErr('')
    }
  }, [vslot?.id, isDriver])

  // Đơn cùng ĐVVT, cùng ngày, xe chính PENDING, chưa trong group nào
  const consolidatableOrders = useMemo(() => {
    if (isDriver || !order || vslot?.status !== 'PENDING') return []
    return allOrders.filter(o =>
      o.id !== order.id &&
      o.ncc_id === order.ncc_id &&
      o.date === order.date &&
      o.vehicle_slots[0]?.status === 'PENDING' &&
      !o.vehicle_slots[0]?.consolidation_group_id
    )
  }, [allOrders, order?.id, order?.ncc_id, order?.date, vslot?.status, isDriver])

  const handleSave = async () => {
    if (!vslot || !order) return
    if (!selectedSlot) { setErr('Vui lòng chọn khung giờ'); return }
    if (!licensePlate) { setErr('Vui lòng nhập biển số xe'); return }
    const updates: Parameters<typeof updateSlot.mutateAsync>[0] = { id: vslot.id }
    if (selectedSlot?.id !== vslot.slot_id) updates.slot_id = selectedSlot?.id ?? null
    updates.license_plate = licensePlate || null
    updates.driver_phone = driverPhone || null
    if (selectedSlot && licensePlate) updates.status = 'BOOKED'
    if (consolidationOrderIds.length > 0 && vslot.status === 'PENDING') {
      updates.consolidation_order_ids = consolidationOrderIds
    }
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
    <Dialog open={!!vslot} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{vslot.status === 'PENDING' ? 'Đặt khung giờ' : 'Sửa khung giờ'}</DialogTitle>
          <p className="text-xs text-slate-500 mt-1">{order.npp_name ?? '—'} · {formatDate(order.date)}</p>
        </DialogHeader>
        <div className="space-y-3 py-2">
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
                <Select value={licensePlate || '__none__'} onValueChange={v => setLicensePlate(v === '__none__' ? '' : v)}>
                  <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Chọn biển số" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Chọn xe —</SelectItem>
                    {(nccVehicles as TmsVehicle[]).map(v => (
                      <SelectItem key={v.id} value={v.license_plate}>{v.license_plate}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <Label className="text-xs">SĐT lái xe</Label>
              <Input value={driverPhone} onChange={e => setDriverPhone(e.target.value)} placeholder="0912..." className="h-8 text-sm mt-1" />
            </div>
          </div>
          {consolidatableOrders.length > 0 && (
            <div>
              <Label className="text-xs font-medium mb-1 block">
                Xe này chở thêm đơn nào?
                <span className="text-slate-400 font-normal ml-1">(1 xe – 1 slot, các đơn chọn sẽ tự nhận booking)</span>
              </Label>
              <div className="max-h-28 overflow-y-auto border rounded p-1.5 space-y-0.5 bg-slate-50">
                {consolidatableOrders.map(o => (
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
                  </label>
                ))}
              </div>
            </div>
          )}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Hủy</Button>
          <Button size="sm" onClick={handleSave} disabled={updateSlot.isPending}>
            {updateSlot.isPending ? 'Đang lưu...' : 'Xác nhận'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Create / Edit Order Dialog (Điều vận) ────────────────────────────────────

type OrderFormData = {
  date: string; warehouse_id: string; npp_name: string; ncc_id: string
  order_code: string; direction: 'OUTBOUND' | 'INBOUND' | ''
  warehouse_type: string; vehicle_type: string
  planned_boxes: string; planned_pallets: string; planned_tons: string
  gdo_refs: string; notes: string
}

const EMPTY_FORM = (date: string, warehouse_id: string): OrderFormData => ({
  date, warehouse_id, npp_name: '', ncc_id: '',
  order_code: '', direction: 'OUTBOUND',
  warehouse_type: '', vehicle_type: '',
  planned_boxes: '', planned_pallets: '', planned_tons: '',
  gdo_refs: '', notes: '',
})

const ORDER_CODE_RE = /^\d{6}_[A-Za-z0-9]+_\d+$/

function CreateEditDialog({ open, order, onClose, defaultDate, defaultWarehouseId }: {
  open: boolean; order: TmsOrder | null; onClose: () => void
  defaultDate: string; defaultWarehouseId: string
}) {
  const { data: warehouses = [] }          = useWarehouses(true)
  const { data: whTypesData = [] }         = useWarehouseTypes()
  const { data: vehicleTypes = [] }        = useVehicleTypes(true)
  const { data: transportCompanies = [] }  = useTransportCompanies(true)
  const createOrder  = useCreateOrder()
  const updateOrder  = useUpdateOrder()
  const isEdit = !!order

  const [form, setForm] = useState<OrderFormData>(EMPTY_FORM(defaultDate, defaultWarehouseId))
  const [err, setErr] = useState('')
  const set = (k: keyof OrderFormData) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!open) return
    if (order) {
      setForm({
        date: order.date, warehouse_id: order.warehouse_id,
        npp_name: order.npp_name ?? '', ncc_id: order.ncc_id ?? '',
        order_code: order.order_code,
        direction: (order.direction as 'OUTBOUND' | 'INBOUND') ?? 'OUTBOUND',
        warehouse_type: order.warehouse_type ?? '', vehicle_type: order.vehicle_type ?? '',
        planned_boxes: order.planned_boxes != null ? String(order.planned_boxes) : '',
        planned_pallets: order.planned_pallets != null ? String(order.planned_pallets) : '',
        planned_tons: order.planned_tons != null ? String(order.planned_tons) : '',
        gdo_refs: order.gdo_refs ?? '', notes: order.notes ?? '',
      })
    } else {
      setForm(EMPTY_FORM(defaultDate, defaultWarehouseId))
    }
    setErr('')
  }, [open, order?.id])

  const handleSubmit = async () => {
    if (!form.date || !form.warehouse_id) { setErr('Vui lòng chọn ngày và kho'); return }
    if (!form.order_code) { setErr('Vui lòng nhập Mã đơn'); return }
    if (!isEdit && !ORDER_CODE_RE.test(form.order_code)) { setErr('Mã đơn sai định dạng — ví dụ: 240526_BV_1'); return }
    if (!form.direction) { setErr('Vui lòng chọn hướng vận chuyển'); return }
    if (!form.ncc_id) { setErr('Vui lòng chọn ĐVVT'); return }
    const payload = {
      date: form.date, warehouse_id: form.warehouse_id,
      npp_name: form.npp_name || null, ncc_id: form.ncc_id || null,
      ...(!isEdit ? { order_code: form.order_code } : {}),
      direction: form.direction || null,
      warehouse_type: form.warehouse_type || null,
      vehicle_type: form.vehicle_type || null,
      planned_boxes: form.planned_boxes ? Number(form.planned_boxes) : null,
      planned_pallets: form.planned_pallets ? Number(form.planned_pallets) : null,
      planned_tons: form.planned_tons ? Number(form.planned_tons) : null,
      gdo_refs: form.gdo_refs || null, notes: form.notes || null,
    }
    try {
      if (isEdit && order) await updateOrder.mutateAsync({ id: order.id, ...payload })
      else await createOrder.mutateAsync(payload)
      onClose()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setErr(msg ?? 'Lỗi lưu dữ liệu')
    }
  }

  const isSaving = createOrder.isPending || updateOrder.isPending

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? 'Sửa đơn hàng' : 'Thêm đơn hàng'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Ngày *</Label>
              <Input type="date" value={form.date} onChange={e => set('date')(e.target.value)} className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs">Kho *</Label>
              <Select value={form.warehouse_id || '__none__'} onValueChange={v => set('warehouse_id')(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Chọn kho" /></SelectTrigger>
                <SelectContent>
                  {(warehouses as { id: string; name: string }[]).map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Mã đơn * <span className="text-slate-400 font-normal">(vd: 240526_BV_1)</span></Label>
              <Input value={form.order_code} onChange={e => set('order_code')(e.target.value)} placeholder="ddmmyy_Kho_STT" className="h-8 text-sm mt-1 font-mono" disabled={isEdit} />
            </div>
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
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tên NPP</Label>
              <Input value={form.npp_name} onChange={e => set('npp_name')(e.target.value)} placeholder="Tên nhà phân phối" className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs">ĐVVT *</Label>
              <Select value={form.ncc_id || '__none__'} onValueChange={v => set('ncc_id')(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Chọn ĐVVT" /></SelectTrigger>
                <SelectContent>
                  {(transportCompanies as TransportCompany[]).map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Loại kho</Label>
              <Select value={form.warehouse_type || '__none__'} onValueChange={v => set('warehouse_type')(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Chọn loại kho" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Không chọn —</SelectItem>
                  {whTypesData.map(t => <SelectItem key={t.id} value={t.value}>{t.value}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Loại xe</Label>
              <Select value={form.vehicle_type || '__none__'} onValueChange={v => set('vehicle_type')(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Chọn loại xe" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Không chọn —</SelectItem>
                  {(vehicleTypes as TmsVehicleType[]).map(vt => (
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
          <div>
            <Label className="text-xs">Mã GDO</Label>
            <Input value={form.gdo_refs} onChange={e => set('gdo_refs')(e.target.value)} placeholder="GDO-001, GDO-002" className="h-8 text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs">Ghi chú</Label>
            <textarea
              value={form.notes}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set('notes')(e.target.value)}
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mt-1"
            />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Hủy</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Đang lưu...' : isEdit ? 'Cập nhật' : 'Thêm đơn'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Excel Upload Dialog ───────────────────────────────────────────────────────

type ImportRow = {
  date: string | null; warehouse_id: string | null; warehouse_name: string
  npp_name: string; direction: string; warehouse_type: string; vehicle_type: string
  ncc_code: string; ncc_id: string | null
  order_code: string
  planned_boxes: number | null; planned_pallets: number | null; planned_tons: number | null
  gdo_refs: string; notes: string; valid: boolean; error: string
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
}

function parseDirection(val: unknown): string {
  const s = String(val ?? '').trim().toLowerCase()
  if (['xuất', 'xuat', 'x', 'outbound', 'out'].includes(s)) return 'OUTBOUND'
  if (['nhập', 'nhap', 'n', 'inbound', 'in'].includes(s)) return 'INBOUND'
  return ''
}

function parseExcelDate(val: unknown): string | null {
  if (!val) return null
  if (val instanceof Date) return val.toISOString().slice(0, 10)
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
  const nccByCode    = Object.fromEntries(transportCompanies.map(c => [c.code.toLowerCase().trim(), c.id]))

  const reset = () => { setRows([]); setResult(null); setErr('') }
  useEffect(() => { if (open) reset() }, [open])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'array', cellDates: true })
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
          if (whName && !whId) errors.push(`kho "${whName}" không tìm thấy`)
          if (!whId && !whName) errors.push('thiếu kho')
          if (whType && validWhTypes.size > 0 && !validWhTypes.has(whType.toLowerCase())) errors.push(`loại kho "${whType}" không hợp lệ`)
          if (vtName && validVtNames.size > 0 && !validVtNames.has(vtName.toLowerCase())) errors.push(`loại xe "${vtName}" không hợp lệ`)
          if (nccCode && !nccId) errors.push(`ĐVVT "${nccCode}" không tìm thấy`)
          if (!orderCode) errors.push('thiếu mã đơn')
          else if (!ORDER_CODE_RE.test(orderCode)) errors.push(`mã đơn "${orderCode}" sai định dạng (vd: 240526_BV_1)`)
          else if (seenCodes.has(orderCode.toUpperCase())) errors.push(`mã đơn "${orderCode}" bị trùng trong file`)
          else seenCodes.add(orderCode.toUpperCase())

          return {
            date, warehouse_id: whId, warehouse_name: whName,
            npp_name: String(norm.npp_name ?? ''), direction,
            warehouse_type: whType, vehicle_type: vtName,
            ncc_code: nccCode, ncc_id: nccId, order_code: orderCode,
            planned_boxes: norm.planned_boxes ? Number(norm.planned_boxes) : null,
            planned_pallets: norm.planned_pallets ? Number(norm.planned_pallets) : null,
            planned_tons: norm.planned_tons ? Number(norm.planned_tons) : null,
            gdo_refs: String(norm.gdo_refs ?? ''), notes: String(norm.notes ?? ''),
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
      })))
      setResult({ inserted: data.inserted })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Lỗi import'
      const dupMatch = msg.match(/Mã đơn đã tồn tại: (.+)/)
      if (dupMatch) {
        const dupCodes = new Set(dupMatch[1].split(',').map((c: string) => c.trim().toUpperCase()))
        setRows(prev => prev.map(r =>
          r.order_code && dupCodes.has(r.order_code.toUpperCase())
            ? { ...r, valid: false, error: 'mã đơn đã tồn tại trong hệ thống' } : r
        ))
      }
      setErr(msg)
    } finally { setImporting(false) }
  }

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Mã đơn', 'NPP', 'Kho', 'Ngày', 'Hướng', 'Loại kho', 'Loại xe', 'ĐVVT', 'Thùng', 'Pallet', 'Tấn', 'GDO', 'Ghi chú'],
      ['240526_BV_1', 'Tên NPP mẫu', 'Kho Ba Vì', '21/05/2026', 'Xuất', 'Khô', 'Xe tải 5T', 'NCC001', 100, 5, 2.5, 'GDO-001', ''],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Import')
    XLSX.writeFile(wb, 'mau_ke_hoach_vc.xlsx')
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
                      ? <> · <span className="text-red-600 font-medium">{errorCount} lỗi</span></>
                      : <> · <span className="text-green-600 font-medium">Tất cả hợp lệ</span></>}
                  </span>
                )}
              </div>
              {rows.length > 0 && (
                <div className="max-h-64 overflow-auto rounded border">
                  <table className="min-w-full text-[10px]">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        {['#', 'Mã đơn', 'NPP', 'Kho', 'Ngày', 'Hướng', 'L.kho', 'L.xe', 'ĐVVT', 'Thùng', 'Pallet', 'Tấn', 'Lỗi'].map(h => (
                          <th key={h} className="px-2 py-1 text-left text-[9px] text-slate-500 font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
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
          <span className="text-sm font-semibold truncate">Tình trạng khung giờ — {warehouseName}</span>
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

  const handleSave = async () => {
    if (!newDate) { setErr('Vui lòng chọn ngày mới'); return }
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
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Đổi ngày</DialogTitle>
          <p className="text-xs text-slate-500 mt-1">
            {orderIds.length} đơn · Ngày hiện tại: <span className="font-mono">{formatDate(currentDate)}</span>
          </p>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Ngày mới *</Label>
            <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="h-8 text-sm mt-1" />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Hủy</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Đang lưu...' : `Đổi ${orderIds.length} đơn`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TMSBookings() {
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canManage = can(perms, 'tms', 'manage_booking')
  const canBook   = can(perms, 'tms', 'book')
  const isNccUser = user?.department === 'Đơn vị vận tải'

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const [date, setDate] = useState(() => localStorage.getItem('tmsb_date') ?? today)
  const [warehouseId, setWarehouseId] = useState(() => localStorage.getItem('tmsb_wh') ?? '')
  const [loaiKhoFilter, setLoaiKhoFilter] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('tmsb_loaikho') ?? '[]') } catch { return [] }
  })
  const [loaiXeFilter, setLoaiXeFilter] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('tmsb_loaixe') ?? '[]') } catch { return [] }
  })
  const [huongFilter, setHuongFilter] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('tmsb_huong') ?? '[]') } catch { return [] }
  })
  const [dvvtFilter, setDvvtFilter] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('tmsb_dvvt') ?? '[]') } catch { return [] }
  })
  const [khungGioFilter, setKhungGioFilter] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('tmsb_khungio') ?? '[]') } catch { return [] }
  })
  const [slotOverviewOpen, setSlotOverviewOpen] = useState(false)

  useEffect(() => { localStorage.setItem('tmsb_date', date) }, [date])
  useEffect(() => { localStorage.setItem('tmsb_wh', warehouseId) }, [warehouseId])
  useEffect(() => { localStorage.setItem('tmsb_loaikho', JSON.stringify(loaiKhoFilter)) }, [loaiKhoFilter])
  useEffect(() => { localStorage.setItem('tmsb_loaixe', JSON.stringify(loaiXeFilter)) }, [loaiXeFilter])
  useEffect(() => { localStorage.setItem('tmsb_huong', JSON.stringify(huongFilter)) }, [huongFilter])
  useEffect(() => { localStorage.setItem('tmsb_dvvt', JSON.stringify(dvvtFilter)) }, [dvvtFilter])
  useEffect(() => { localStorage.setItem('tmsb_khungio', JSON.stringify(khungGioFilter)) }, [khungGioFilter])
  useEffect(() => { setSelectedOrderIds(new Set()) }, [date, warehouseId])

  const [createOpen, setCreateOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editOrder, setEditOrder] = useState<TmsOrder | null>(null)
  const [bookingSlot, setBookingSlot] = useState<{ vslot: TmsVehicleSlot; order: TmsOrder } | null>(null)
  const [actionErr, setActionErr] = useState('')
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())
  const [changeDateOpen, setChangeDateOpen] = useState(false)

  const { data: warehouses = [] }             = useWarehouses(true)
  const { data: slotsList = [] }              = useDeliverySlots(warehouseId ? { date, warehouse_id: warehouseId } : undefined)
  const { data: whTypesMain = [] }            = useWarehouseTypes()
  const { data: vehicleTypesMain = [] }       = useVehicleTypes(true)
  const { data: transportCompaniesMain = [] } = useTransportCompanies(true)
  const { data: orders = [], isLoading }      = useTmsOrders(
    (warehouseId || isNccUser) ? { date, warehouse_id: warehouseId || undefined } : undefined,
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
    if (loaiXeFilter.length)   list = list.filter(o => o.vehicle_type && loaiXeFilter.includes(o.vehicle_type))
    if (khungGioFilter.length) {
      list = list.filter(o => o.vehicle_slots.some(vs => {
        if (!vs.slot_id && khungGioFilter.includes('__chua_dat__')) return true
        if (vs.slot_id && khungGioFilter.includes(vs.slot_id)) return true
        return false
      }))
    }
    return list
  }, [orders, huongFilter, dvvtFilter, loaiKhoFilter, loaiXeFilter, khungGioFilter])

  // Sắp xếp: nhóm consolidation gần nhau (primary trước, secondaries theo sau)
  const sortedOrders = useMemo<TmsOrder[]>(() => {
    const visited = new Set<string>()
    const result: TmsOrder[] = []
    for (const order of filteredOrders) {
      if (visited.has(order.id)) continue
      const xeChinhSlot = order.vehicle_slots[0]
      if (xeChinhSlot?.consolidation_group_id && xeChinhSlot.is_consolidation_primary) {
        // Primary: thêm mình + kéo tất cả secondary cùng group
        result.push(order); visited.add(order.id)
        for (const other of filteredOrders) {
          if (visited.has(other.id)) continue
          if (other.vehicle_slots[0]?.consolidation_group_id === xeChinhSlot.consolidation_group_id) {
            result.push(other); visited.add(other.id)
          }
        }
      } else if (!xeChinhSlot?.consolidation_group_id) {
        result.push(order); visited.add(order.id)
      }
      // Secondary chưa visited sẽ bị skip (primary sẽ pull vào đúng vị trí)
    }
    // Fallback: secondary mà primary không có trong filteredOrders
    for (const order of filteredOrders) {
      if (!visited.has(order.id)) { result.push(order); visited.add(order.id) }
    }
    return result
  }, [filteredOrders])

  // Flatten orders → rows (1 row per vehicle slot, order info repeated for first slot only)
  type TableRow = { order: TmsOrder; vslot: TmsVehicleSlot; isFirstSlot: boolean; slotIndex: number }
  const tableRows = useMemo<TableRow[]>(() =>
    sortedOrders.flatMap(order =>
      order.vehicle_slots.length > 0
        ? order.vehicle_slots.map((vs, i) => ({ order, vslot: vs, isFirstSlot: i === 0, slotIndex: i }))
        : [{ order, vslot: { id: '', order_id: order.id, slot_id: null, slot: null, license_plate: null, driver_name: null, driver_phone: null, status: 'PENDING', booked_by: null, consolidation_group_id: null, is_consolidation_primary: false, created_at: '', updated_at: '' } as TmsVehicleSlot, isFirstSlot: true, slotIndex: 0 }]
    ), [sortedOrders]
  )

  const rowBg = (status: string) => {
    if (status === 'BOOKED')  return 'bg-green-50 hover:bg-green-100'
    if (status === 'ARRIVED') return 'bg-blue-50 hover:bg-blue-100'
    if (status === 'DONE')    return 'bg-slate-50 hover:bg-slate-100'
    return 'hover:bg-slate-50'
  }

  const canEditOrder = (o: TmsOrder) =>
    canManage && o.vehicle_slots.every(vs => vs.status === 'PENDING')

  const canBookSlot = (vs: TmsVehicleSlot) =>
    canBook && ['PENDING','BOOKED'].includes(vs.status) &&
    (!vs.slot || !isSlotTimePassed(vs.slot.date ?? '', vs.slot.time_from ?? ''))

  const canRelease = (vs: TmsVehicleSlot) =>
    canManage && vs.status === 'BOOKED' &&
    (!vs.slot || !isSlotTimePassed(vs.slot.date ?? '', vs.slot.time_from ?? ''))

  // Revoke: quyền đặc biệt, bỏ qua kiểm tra giờ — chỉ hiện khi Release không khả dụng
  const canRevoke = (vs: TmsVehicleSlot) =>
    can(perms, 'tms', 'revoke') &&
    ['BOOKED', 'ARRIVED'].includes(vs.status) &&
    !canRelease(vs)

  const checkableOrderIds = useMemo(() =>
    canManage ? sortedOrders.filter(o => o.vehicle_slots.every(vs => vs.status === 'PENDING')).map(o => o.id) : [],
    [sortedOrders, canManage]
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

  const handleAddVehicleSlot = async (e: React.MouseEvent, orderId: string) => {
    e.stopPropagation(); setActionErr('')
    try { await addVehicleSlot.mutateAsync(orderId) }
    catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setActionErr(msg ?? 'Lỗi thêm xe')
    }
  }

  const handleRelease = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); setActionErr('')
    try { await releaseVehicleSlot.mutateAsync(id) }
    catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setActionErr(msg ?? 'Lỗi trả lại')
    }
  }

  const handleRevoke = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); setActionErr('')
    try { await revokeVehicleSlot.mutateAsync(id) }
    catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setActionErr(msg ?? 'Lỗi thu hồi booking')
    }
  }

  // Xe phụ: trả lại = release (nếu đang BOOKED) rồi xóa luôn dòng
  const handleReleaseAndDeleteVslot = async (e: React.MouseEvent, vslot: TmsVehicleSlot) => {
    e.stopPropagation(); setActionErr('')
    try {
      if (vslot.status === 'BOOKED') await releaseVehicleSlot.mutateAsync(vslot.id)
      await deleteVehicleSlot.mutateAsync(vslot.id)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setActionErr(msg ?? 'Lỗi xóa xe phụ')
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-3 py-2 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-base font-semibold md:text-xl">Kế hoạch vận chuyển</h1>
          <div className="flex items-center gap-1.5">
            {warehouseId && (
              <Button variant="outline" size="sm" onClick={() => setSlotOverviewOpen(true)} className="h-8 px-2">
                <Eye className="h-3.5 w-3.5 shrink-0" /><span className="hidden sm:inline ml-1">Xem booking</span>
              </Button>
            )}
            {canManage && (
              <>
                <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)} className="h-8 px-2">
                  <Upload className="h-3.5 w-3.5 shrink-0" /><span className="hidden sm:inline ml-1">Upload Excel</span>
                </Button>
                <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!warehouseId} className="h-8 px-2">
                  <Plus className="h-3.5 w-3.5 shrink-0" /><span className="hidden sm:inline ml-1">Thêm đơn</span>
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-8 text-sm w-36" />
          <Select value={warehouseId || '__none__'} onValueChange={v => setWarehouseId(v === '__none__' ? '' : v)}>
            <SelectTrigger className="h-8 text-sm flex-1 min-w-[140px] max-w-[200px]"><SelectValue placeholder="— Chọn kho —" /></SelectTrigger>
            <SelectContent>
              {isNccUser && <SelectItem value="__none__">— Tất cả kho —</SelectItem>}
              {!isNccUser && <SelectItem value="__none__">— Chọn kho —</SelectItem>}
              {(warehouses as { id: string; name: string }[]).map(w => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(warehouseId || isNccUser) && (
            <>
              <MultiSelectFilter label="Khung giờ" options={khungGioOptions} selected={khungGioFilter} onChange={setKhungGioFilter} />
              <MultiSelectFilter label="Hướng" options={huongOptions} selected={huongFilter} onChange={setHuongFilter} />
              <MultiSelectFilter label="ĐVVT" options={dvvtOptions} selected={dvvtFilter} onChange={setDvvtFilter} />
              <MultiSelectFilter label="Loại kho" options={loaiKhoOptions} selected={loaiKhoFilter} onChange={setLoaiKhoFilter} />
              <MultiSelectFilter label="Loại xe" options={loaiXeOptions} selected={loaiXeFilter} onChange={setLoaiXeFilter} />
            </>
          )}
          {selectedOrderIds.size > 0 && (
            <div className="flex items-center gap-2 w-full py-0.5">
              <span className="text-xs text-slate-600 font-medium">{selectedOrderIds.size} đơn đã chọn</span>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setChangeDateOpen(true)}>
                <CalendarDays className="h-3.5 w-3.5 mr-1" />Đổi ngày
              </Button>
              <button onClick={() => setSelectedOrderIds(new Set())} className="text-xs text-slate-400 hover:text-slate-600">
                Bỏ chọn
              </button>
            </div>
          )}
          {actionErr && <p className="text-xs text-red-600 w-full">{actionErr}</p>}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {!warehouseId && !isNccUser ? (
          <div className="py-24 text-center text-sm text-slate-400">Chọn kho để xem kế hoạch</div>
        ) : isLoading ? (
          <div className="py-24 text-center text-sm text-slate-400">Đang tải...</div>
        ) : !tableRows.length ? (
          <div className="py-24 text-center text-sm text-slate-400">Chưa có đơn hàng nào cho ngày này</div>
        ) : (
          <Table className="min-w-[960px]">
            <TableHeader>
              <TableRow>
                <TableHead className="px-2 py-1.5 w-8">
                  {checkableOrderIds.length > 0 && (
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 cursor-pointer"
                      checked={allChecked}
                      ref={el => { if (el) el.indeterminate = someChecked }}
                      onChange={toggleAll}
                    />
                  )}
                </TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Mã đơn</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Tên NPP</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 w-10">Đặt giờ</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Khung giờ</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Biển số</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">ĐVVT</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Hướng</TableHead>
                {isNccUser && !warehouseId && <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Kho</TableHead>}
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Loại kho</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Loại xe</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right">Thùng</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right">Pallet</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right">Tấn</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">SĐT</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Trạng thái</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableRows.map(({ order, vslot, isFirstSlot, slotIndex }) => {
                const isConsolidated = !!vslot.consolidation_group_id
                const isCPrimary    = !!vslot.is_consolidation_primary
                return (
                <TableRow key={`${order.id}-${vslot.id}`} className={[
                  rowBg(vslot.status),
                  !isFirstSlot ? 'border-l-4 border-l-purple-300' : '',
                  isFirstSlot && isConsolidated && !isCPrimary ? 'border-l-4 border-l-teal-400' : '',
                ].filter(Boolean).join(' ')}>
                  <TableCell className="px-2 py-1 w-8">
                    {isFirstSlot && checkableOrderIds.includes(order.id) && (
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 cursor-pointer"
                        checked={selectedOrderIds.has(order.id)}
                        onChange={() => toggleOrder(order.id)}
                        onClick={e => e.stopPropagation()}
                      />
                    )}
                  </TableCell>
                  {/* Mã đơn — chỉ hiện ở dòng đầu của mỗi order, xe phụ để trống */}
                  <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">
                    {isFirstSlot ? (
                      <span className="inline-flex items-center gap-1">
                        {isConsolidated && (
                          <Link2 className={`h-3 w-3 shrink-0 ${isCPrimary ? 'text-teal-500' : 'text-teal-400'}`} />
                        )}
                        {order.order_code || <span className="text-slate-400 font-normal">—</span>}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] font-semibold max-w-[140px] truncate">
                    {isFirstSlot
                      ? (order.npp_name || <span className="text-slate-400 font-normal">—</span>)
                      : <span className="inline-flex items-center gap-1 text-[9px] text-purple-500 pl-3">
                          <span>↳</span>
                          <span className="font-medium">Xe phụ {slotIndex}</span>
                        </span>
                    }
                  </TableCell>

                  {/* Đặt giờ — luôn hiện cho mỗi vehicle slot */}
                  <TableCell className="px-2 py-1">
                    {vslot.id && canBookSlot(vslot) && (
                      <button
                        onClick={e => { e.stopPropagation(); setBookingSlot({ vslot, order }) }}
                        className="text-blue-400 hover:text-blue-600 p-1 rounded"
                        title="Đặt khung giờ"
                      >
                        <Truck className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </TableCell>

                  <TableCell className="px-2 py-1 text-[10px]">
                    {vslot.slot && (
                      <span className="font-mono">{vslot.slot.time_from.slice(0, 5)}–{vslot.slot.time_to.slice(0, 5)}</span>
                    )}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold">
                    {vslot.license_plate ? (
                      <span className="flex items-center gap-0.5">
                        {user?.employee_code && vslot.license_plate === user.employee_code && (
                          <Star className="h-3 w-3 fill-yellow-400 text-yellow-400 shrink-0" />
                        )}
                        {vslot.license_plate}
                      </span>
                    ) : <span className="text-slate-400 font-normal">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] max-w-[120px] truncate text-slate-500">
                    {isFirstSlot ? (order.ncc?.name || <span className="text-slate-300">—</span>) : null}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px]">
                    {isFirstSlot && order.direction ? (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${order.direction === 'OUTBOUND' ? 'bg-orange-100 text-orange-700' : 'bg-teal-100 text-teal-700'}`}>
                        {order.direction === 'OUTBOUND' ? 'Xuất' : 'Nhập'}
                      </span>
                    ) : isFirstSlot ? <span className="text-slate-400">—</span> : null}
                  </TableCell>
                  {isNccUser && !warehouseId && (
                    <TableCell className="px-2 py-1 text-[10px] text-slate-500">
                      {isFirstSlot ? ((warehouses as { id: string; name: string }[]).find(w => w.id === order.warehouse_id)?.name ?? '—') : null}
                    </TableCell>
                  )}
                  <TableCell className="px-2 py-1 text-[10px]">
                    {isFirstSlot ? (order.warehouse_type || <span className="text-slate-400">—</span>) : null}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px]">
                    {isFirstSlot ? (order.vehicle_type || <span className="text-slate-400">—</span>) : null}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] tabular-nums text-right">
                    {isFirstSlot && order.planned_boxes != null
                      ? <>{order.planned_boxes}<span className="text-slate-400 text-[9px]"> thùng</span></>
                      : isFirstSlot ? <span className="text-slate-400">—</span> : null}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] tabular-nums text-right">
                    {isFirstSlot && order.planned_pallets != null
                      ? <>{order.planned_pallets}<span className="text-slate-400 text-[9px]"> pl</span></>
                      : isFirstSlot ? <span className="text-slate-400">—</span> : null}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] tabular-nums text-right">
                    {isFirstSlot && order.planned_tons != null
                      ? <>{order.planned_tons}<span className="text-slate-400 text-[9px]"> t</span></>
                      : isFirstSlot ? <span className="text-slate-400">—</span> : null}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] text-slate-500">
                    {vslot.driver_phone || <span className="text-slate-400">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1">
                    <StatusBadge status={vslot.status} />
                  </TableCell>
                  <TableCell className="px-2 py-1">
                    <div className="flex items-center gap-0.5">
                      {/* Sửa đơn — chỉ dòng đầu */}
                      {isFirstSlot && canEditOrder(order) && (
                        <button
                          onClick={e => { e.stopPropagation(); setEditOrder(order) }}
                          className="text-slate-400 hover:text-slate-600 p-1 rounded"
                          title="Sửa đơn hàng"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Thêm xe — chỉ dòng cuối của order, chỉ điều vận, chỉ khi xe chính đã BOOKED */}
                      {canManage && order.vehicle_slots.length > 0 && order.vehicle_slots[order.vehicle_slots.length - 1].id === vslot.id && order.vehicle_slots[0].status !== 'PENDING' && (
                        <button
                          onClick={e => handleAddVehicleSlot(e, order.id)}
                          className="text-purple-400 hover:text-purple-600 p-1 rounded"
                          title="Thêm xe (bốc cùng đơn)"
                        >
                          <PlusCircle className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Dòng chính: trả lại = chỉ reset thông tin, giữ dòng */}
                      {vslot.id && isFirstSlot && canRelease(vslot) && (
                        <button
                          onClick={e => handleRelease(e, vslot.id)}
                          className="text-amber-400 hover:text-amber-600 p-1 rounded"
                          title="Trả lại khung giờ"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Revoke — quyền đặc biệt, bỏ qua giờ */}
                      {vslot.id && isFirstSlot && canRevoke(vslot) && (
                        <button
                          onClick={e => handleRevoke(e, vslot.id)}
                          className="text-rose-400 hover:text-rose-600 p-1 rounded"
                          title="Thu hồi booking (bỏ qua giờ)"
                        >
                          <ShieldX className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Xe phụ: trả lại = release (nếu BOOKED) + xóa luôn dòng */}
                      {vslot.id && !isFirstSlot && canManage && ['PENDING', 'BOOKED'].includes(vslot.status) && (!vslot.slot || !isSlotTimePassed(vslot.slot.date ?? '', vslot.slot.time_from ?? '')) && (
                        <button
                          onClick={e => handleReleaseAndDeleteVslot(e, vslot)}
                          className="text-amber-400 hover:text-amber-600 p-1 rounded"
                          title="Trả lại & xóa xe phụ"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Xóa đơn — chỉ dòng đầu, chỉ khi tất cả slots PENDING */}
                      {isFirstSlot && canManage && order.vehicle_slots.every(vs => vs.status === 'PENDING') && (
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
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <CreateEditDialog
        open={createOpen || !!editOrder}
        order={editOrder}
        onClose={() => { setCreateOpen(false); setEditOrder(null) }}
        defaultDate={date}
        defaultWarehouseId={warehouseId}
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
        defaultDate={date}
        warehouseId={warehouseId}
        warehouseName={warehouseName}
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
        currentDate={date}
        onClose={() => { setChangeDateOpen(false); setSelectedOrderIds(new Set()) }}
      />
    </div>
  )
}
