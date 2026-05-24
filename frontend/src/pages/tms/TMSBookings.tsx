import React, { useState, useEffect, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { Plus, Upload, Pencil, Truck, Trash2, Download, RotateCcw, Star, Eye } from 'lucide-react'
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
  useDeliveryBookings, useCreateBooking, useUpdateBooking, useDeleteBooking, useBulkCreateBookings,
} from '@/api/hooks'
import { formatDate } from '@/utils/formatters'
import type { DeliveryBooking, DeliverySlot, TmsVehicleType, TmsVehicle, TransportCompany } from '@/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function isSlotTimePassed(slotDate: string, timeFrom: string): boolean {
  return Date.now() >= new Date(`${slotDate}T${timeFrom}+07:00`).getTime()
}

// ── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CFG = {
  PENDING:   { label: 'Chờ ĐVVT',    cls: 'bg-amber-100 text-amber-700' },
  CONFIRMED: { label: 'Đã xác nhận', cls: 'bg-green-100 text-green-700' },
  ARRIVED:   { label: 'Đã đến',      cls: 'bg-blue-100 text-blue-700' },
  DONE:      { label: 'Hoàn thành',  cls: 'bg-slate-100 text-slate-600' },
  CANCELLED: { label: 'Đã hủy',      cls: 'bg-red-100 text-red-600' },
} as const

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status as keyof typeof STATUS_CFG] ?? { label: status, cls: 'bg-gray-100 text-gray-600' }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${cfg.cls}`}>{cfg.label}</span>
}

// ── Slot Picker ───────────────────────────────────────────────────────────────

function SlotPicker({ warehouseId, date, selectedSlotId, onSelect, cargoType }: {
  warehouseId: string; date: string; selectedSlotId: string | null
  onSelect: (slot: DeliverySlot) => void
  cargoType?: string | null
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

  // filter theo cargo_type — loại xe không khóa slot
  const filtered = allSlots.filter(slot => {
    if (slot.id === selectedSlotId) return true
    if (cargoType && slot.cargo_type !== 'ALL' && slot.cargo_type !== cargoType) return false
    return true
  })

  return (
    <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
      {filtered.length === 0 && (
        <p className="text-xs text-slate-400 py-4 text-center">Không có khung giờ phù hợp với loại kho đã chọn.</p>
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
              selected
                ? 'border-blue-500 bg-blue-50'
                : disabled
                  ? 'border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed'
                  : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 cursor-pointer',
            ].join(' ')}
          >
            <span className="flex items-center gap-2">
              <span className="font-mono font-semibold">{slot.time_from.slice(0, 5)}–{slot.time_to.slice(0, 5)}</span>
              <span className="text-slate-500">{slot.cargo_type === 'ALL' ? 'Tất cả' : slot.cargo_type}</span>
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

// ── ĐVVT Fill Dialog (điền slot + biển số + SĐT) ─────────────────────────────

function DVVTFillDialog({ booking, onClose }: { booking: DeliveryBooking | null; onClose: () => void }) {
  const updateBooking = useUpdateBooking()
  const user = useAuthStore(s => s.user)
  const isDriver = user?.job_title_name === 'Lái xe'

  const { data: nccVehicles = [] } = useTmsVehicles(
    !isDriver && booking?.ncc_id ? { ncc_id: booking.ncc_id, is_active: 'true' } : undefined
  )

  const [selectedSlot, setSelectedSlot] = useState<DeliverySlot | null>(null)
  const [licensePlate, setLicensePlate] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (booking) {
      setSelectedSlot((booking.slot as DeliverySlot | null) ?? null)
      setLicensePlate(isDriver ? (user?.employee_code ?? '') : (booking.license_plate ?? ''))
      setDriverPhone(booking.driver_phone ?? '')
      setErr('')
    }
  }, [booking?.id, isDriver])

  const handleSave = async () => {
    if (!booking) return
    const updates: Parameters<typeof updateBooking.mutateAsync>[0] = { id: booking.id }
    if (selectedSlot?.id !== booking.slot_id) updates.slot_id = selectedSlot?.id ?? null
    updates.license_plate = licensePlate || null
    updates.driver_phone = driverPhone || null
    if (selectedSlot && licensePlate) updates.status = 'CONFIRMED'
    try {
      await updateBooking.mutateAsync(updates)
      onClose()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setErr(msg ?? 'Lỗi cập nhật')
    }
  }

  if (!booking) return null
  return (
    <Dialog open={!!booking} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{booking.status === 'PENDING' ? 'Đăng ký xe' : 'Sửa khung giờ'}</DialogTitle>
          <p className="text-xs text-slate-500 mt-1">{booking.npp_name ?? '—'} · {formatDate(booking.date)}</p>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs font-medium mb-2 block">Chọn khung giờ *</Label>
            <SlotPicker
              warehouseId={booking.warehouse_id}
              date={booking.date}
              selectedSlotId={selectedSlot?.id ?? null}
              onSelect={setSelectedSlot}
              cargoType={booking.warehouse_type}
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
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Hủy</Button>
          <Button size="sm" onClick={handleSave} disabled={updateBooking.isPending}>
            {updateBooking.isPending ? 'Đang lưu...' : 'Xác nhận'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Create / Edit Dialog (Điều vận) ──────────────────────────────────────────

type BookingFormData = {
  date: string; warehouse_id: string; npp_name: string; ncc_id: string
  vehicle_code: string; direction: 'OUTBOUND' | 'INBOUND' | ''
  warehouse_type: string; vehicle_type: string
  box_count: string; pallet_count: string; tonnage: string
  gdo_refs: string; notes: string
}

const EMPTY_FORM = (date: string, warehouse_id: string): BookingFormData => ({
  date, warehouse_id, npp_name: '', ncc_id: '',
  vehicle_code: '', direction: 'OUTBOUND',
  warehouse_type: '', vehicle_type: '',
  box_count: '', pallet_count: '', tonnage: '',
  gdo_refs: '', notes: '',
})

function CreateEditDialog({ open, booking, onClose, defaultDate, defaultWarehouseId }: {
  open: boolean; booking: DeliveryBooking | null; onClose: () => void
  defaultDate: string; defaultWarehouseId: string
}) {
  const { data: warehouses = [] } = useWarehouses(true)
  const { data: whTypesData = [] } = useWarehouseTypes()
  const { data: vehicleTypes = [] } = useVehicleTypes(true)
  const { data: transportCompanies = [] } = useTransportCompanies(true)
  const createBooking = useCreateBooking()
  const updateBooking = useUpdateBooking()
  const isEdit = !!booking

  const [form, setForm] = useState<BookingFormData>(EMPTY_FORM(defaultDate, defaultWarehouseId))
  const [err, setErr] = useState('')

  const set = (k: keyof BookingFormData) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!open) return
    if (booking) {
      setForm({
        date: booking.date,
        warehouse_id: booking.warehouse_id,
        npp_name: booking.npp_name ?? '',
        ncc_id: booking.ncc_id ?? '',
        vehicle_code: booking.vehicle_code ?? '',
        direction: (booking.direction as 'OUTBOUND' | 'INBOUND') ?? 'OUTBOUND',
        warehouse_type: booking.warehouse_type ?? '',
        vehicle_type: booking.vehicle_type ?? '',
        box_count: booking.box_count != null ? String(booking.box_count) : '',
        pallet_count: booking.pallet_count != null ? String(booking.pallet_count) : '',
        tonnage: booking.tonnage != null ? String(booking.tonnage) : '',
        gdo_refs: booking.gdo_refs ?? '',
        notes: booking.notes ?? '',
      })
    } else {
      setForm(EMPTY_FORM(defaultDate, defaultWarehouseId))
    }
    setErr('')
  }, [open, booking?.id])

  const VEHICLE_CODE_RE = /^\d{6}_[A-Za-z0-9]+_\d+$/
  const handleSubmit = async () => {
    if (!form.date || !form.warehouse_id) { setErr('Vui lòng chọn ngày và kho'); return }
    if (!form.vehicle_code) { setErr('Vui lòng nhập Số xe'); return }
    if (!VEHICLE_CODE_RE.test(form.vehicle_code)) { setErr('Số xe sai định dạng — ví dụ: 240526_BV_1'); return }
    if (!form.direction) { setErr('Vui lòng chọn hướng vận chuyển (Xuất/Nhập)'); return }
    if (!form.ncc_id) { setErr('Vui lòng chọn đơn vị vận tải (ĐVVT)'); return }
    const payload = {
      date: form.date,
      warehouse_id: form.warehouse_id,
      npp_name: form.npp_name || undefined,
      ncc_id: form.ncc_id || undefined,
      ...(isEdit ? {} : { vehicle_code: form.vehicle_code }),
      direction: form.direction || undefined,
      warehouse_type: form.warehouse_type || undefined,
      vehicle_type: form.vehicle_type || undefined,
      box_count: form.box_count ? Number(form.box_count) : null,
      pallet_count: form.pallet_count ? Number(form.pallet_count) : null,
      tonnage: form.tonnage ? Number(form.tonnage) : null,
      gdo_refs: form.gdo_refs || undefined,
      notes: form.notes || undefined,
    }
    try {
      if (isEdit && booking) {
        await updateBooking.mutateAsync({ id: booking.id, ...payload })
      } else {
        await createBooking.mutateAsync(payload)
      }
      onClose()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setErr(msg ?? 'Lỗi lưu dữ liệu')
    }
  }

  const isSaving = createBooking.isPending || updateBooking.isPending

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? 'Sửa chuyến vận chuyển' : 'Thêm chuyến vận chuyển'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Ngày *</Label>
              <Input type="date" value={form.date} onChange={e => set('date')(e.target.value)} className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs">Kho xuất *</Label>
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
              <Label className="text-xs">Số xe * <span className="text-slate-400 font-normal">(vd: 240526_BV_1)</span></Label>
              <Input value={form.vehicle_code} onChange={e => set('vehicle_code')(e.target.value)} placeholder="ddmmyy_Kho_STT" className="h-8 text-sm mt-1 font-mono" disabled={isEdit} />
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
              <Label className="text-xs">ĐVVT</Label>
              <Select value={form.ncc_id || '__none__'} onValueChange={v => set('ncc_id')(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Chọn ĐVVT *" /></SelectTrigger>
                <SelectContent>
                  {(transportCompanies as import('@/types').TransportCompany[]).map(c => (
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
                  {(vehicleTypes as import('@/types').TmsVehicleType[]).map(vt => (
                    <SelectItem key={vt.id} value={vt.name}>{vt.code} — {vt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Số thùng</Label>
              <Input type="number" min="0" value={form.box_count} onChange={e => set('box_count')(e.target.value)} className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs">Số pallet</Label>
              <Input type="number" min="0" value={form.pallet_count} onChange={e => set('pallet_count')(e.target.value)} className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs">Số tấn</Label>
              <Input type="number" min="0" step="0.001" value={form.tonnage} onChange={e => set('tonnage')(e.target.value)} className="h-8 text-sm mt-1" />
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
            {isSaving ? 'Đang lưu...' : isEdit ? 'Cập nhật' : 'Thêm chuyến'}
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
  vehicle_code: string
  box_count: number | null; pallet_count: number | null; tonnage: number | null
  gdo_refs: string; notes: string; valid: boolean; error: string
}

const EXCEL_COL_MAP: Record<string, string> = {
  'npp': 'npp_name', 'tên npp': 'npp_name', 'nhà phân phối': 'npp_name',
  'kho': 'warehouse_name', 'kho xuất': 'warehouse_name',
  'ngày': 'date', 'date': 'date',
  'hướng': 'direction', 'huong': 'direction', 'loại hướng': 'direction', 'direction': 'direction',
  'loại kho': 'warehouse_type', 'warehouse type': 'warehouse_type',
  'loại xe': 'vehicle_type', 'vehicle type': 'vehicle_type',
  'đvvt': 'ncc_code', 'dvvt': 'ncc_code', 'đơn vị vận tải': 'ncc_code', 'transport company': 'ncc_code',
  'số xe': 'vehicle_code', 'so xe': 'vehicle_code', 'mã xe': 'vehicle_code',
  'thùng': 'box_count', 'số thùng': 'box_count', 'box': 'box_count',
  'pallet': 'pallet_count', 'số pallet': 'pallet_count',
  'tấn': 'tonnage', 'số tấn': 'tonnage', 'ton': 'tonnage',
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
  const bulkCreate = useBulkCreateBookings()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null)
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

        const VEHICLE_CODE_RE = /^\d{6}_[A-Za-z0-9]+_\d+$/
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
          const vehicleCode = String(norm.vehicle_code ?? '').trim()
          const errors: string[] = []
          if (!date) errors.push('thiếu ngày')
          if (!direction) errors.push('thiếu hướng (Xuất/Nhập)')
          if (whName && !whId) errors.push(`kho "${whName}" không tìm thấy`)
          if (!whId && !whName) errors.push('thiếu kho')
          if (whType && validWhTypes.size > 0 && !validWhTypes.has(whType.toLowerCase())) errors.push(`loại kho "${whType}" không hợp lệ`)
          if (vtName && validVtNames.size > 0 && !validVtNames.has(vtName.toLowerCase())) errors.push(`loại xe "${vtName}" không hợp lệ`)
          if (nccCode && !nccId) errors.push(`ĐVVT "${nccCode}" không tìm thấy`)
          if (vehicleCode) {
            if (!VEHICLE_CODE_RE.test(vehicleCode)) errors.push(`số xe "${vehicleCode}" sai định dạng (vd: 240526_BV_1)`)
            else if (seenCodes.has(vehicleCode.toUpperCase())) errors.push(`số xe "${vehicleCode}" bị trùng trong file`)
            else seenCodes.add(vehicleCode.toUpperCase())
          }

          return {
            date, warehouse_id: whId, warehouse_name: whName,
            npp_name: String(norm.npp_name ?? ''),
            direction,
            warehouse_type: whType,
            vehicle_type: vtName,
            ncc_code: nccCode, ncc_id: nccId,
            vehicle_code: vehicleCode,
            box_count: norm.box_count ? Number(norm.box_count) : null,
            pallet_count: norm.pallet_count ? Number(norm.pallet_count) : null,
            tonnage: norm.tonnage ? Number(norm.tonnage) : null,
            gdo_refs: String(norm.gdo_refs ?? ''),
            notes: String(norm.notes ?? ''),
            valid: errors.length === 0,
            error: errors.join(', '),
          }
        })

        setRows(parsed)
        setErr('')
      } catch {
        setErr('Không đọc được file. Vui lòng dùng định dạng .xlsx hoặc .xls')
      }
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
        date: r.date!, warehouse_id: r.warehouse_id!,
        npp_name: r.npp_name || undefined,
        ncc_id: r.ncc_id || undefined,
        direction: r.direction || undefined,
        warehouse_type: r.warehouse_type || undefined,
        vehicle_type: r.vehicle_type || undefined,
        vehicle_code: r.vehicle_code || undefined,
        box_count: r.box_count, pallet_count: r.pallet_count, tonnage: r.tonnage,
        gdo_refs: r.gdo_refs || undefined,
        notes: r.notes || undefined,
      })))
      setResult({ inserted: data.inserted, skipped: 0 })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Lỗi import'
      // Đánh dấu đúng dòng bị lỗi trùng số xe với DB
      const dupMatch = msg.match(/Số xe đã tồn tại trong hệ thống: (.+)/)
      if (dupMatch) {
        const dupCodes = new Set(dupMatch[1].split(',').map((c: string) => c.trim().toUpperCase()))
        setRows(prev => prev.map(r =>
          r.vehicle_code && dupCodes.has(r.vehicle_code.toUpperCase())
            ? { ...r, valid: false, error: 'số xe đã tồn tại trong hệ thống' }
            : r
        ))
      }
      setErr(msg)
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Số xe', 'NPP', 'Kho', 'Ngày', 'Hướng', 'Loại kho', 'Loại xe', 'ĐVVT', 'Thùng', 'Pallet', 'Tấn', 'GDO', 'Ghi chú'],
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
              <p>Đã thêm <strong>{result.inserted}</strong> chuyến.{result.skipped > 0 && ` Bỏ qua ${result.skipped} dòng lỗi.`}</p>
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
                      ? <> · <span className="text-red-600 font-medium">{errorCount} lỗi — cần sửa trước khi import</span></>
                      : <> · <span className="text-green-600 font-medium">Tất cả hợp lệ</span></>
                    }
                  </span>
                )}
              </div>

              {rows.length > 0 && (
                <div className="max-h-64 overflow-auto rounded border">
                  <table className="min-w-full text-[10px]">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        {['#', 'Số xe', 'NPP', 'Kho', 'Ngày', 'Hướng', 'L.kho', 'L.xe', 'ĐVVT', 'Thùng', 'Pallet', 'Tấn', 'Lỗi'].map(h => (
                          <th key={h} className="px-2 py-1 text-left text-[9px] text-slate-500 font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className={r.valid ? '' : 'bg-red-50'}>
                          <td className="px-2 py-0.5 text-slate-400">{i + 1}</td>
                          <td className="px-2 py-0.5 font-mono">{r.vehicle_code || '—'}</td>
                          <td className="px-2 py-0.5 max-w-[100px] truncate">{r.npp_name || '—'}</td>
                          <td className="px-2 py-0.5">{r.warehouse_name || '—'}</td>
                          <td className="px-2 py-0.5 font-mono">{r.date || '—'}</td>
                          <td className="px-2 py-0.5">
                            {r.direction === 'OUTBOUND' ? <span className="text-orange-600">Xuất</span> : r.direction === 'INBOUND' ? <span className="text-teal-600">Nhập</span> : <span className="text-red-500">—</span>}
                          </td>
                          <td className="px-2 py-0.5">{r.warehouse_type || '—'}</td>
                          <td className="px-2 py-0.5">{r.vehicle_type || '—'}</td>
                          <td className="px-2 py-0.5">{r.ncc_code || '—'}</td>
                          <td className="px-2 py-0.5 tabular-nums">{r.box_count ?? '—'}</td>
                          <td className="px-2 py-0.5 tabular-nums">{r.pallet_count ?? '—'}</td>
                          <td className="px-2 py-0.5 tabular-nums">{r.tonnage ?? '—'}</td>
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
              {importing ? 'Đang import...' : `Import ${rows.length} chuyến`}
            </Button>
          )}
          {result && <Button size="sm" onClick={onClose}>Xong</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Slot Overview Dialog ──────────────────────────────────────────────────────

function SlotOverviewDialog({ open, onClose, date, warehouseName, slots }: {
  open: boolean; onClose: () => void
  date: string; warehouseName: string; slots: DeliverySlot[]
}) {
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tình trạng khung giờ</DialogTitle>
          <p className="text-xs text-slate-500 mt-0.5">{warehouseName} · {formatDate(date)}</p>
        </DialogHeader>
        <div className="space-y-1.5 py-1 max-h-80 overflow-y-auto">
          {slots.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">Chưa có khung giờ nào</p>
          ) : slots.map(s => {
            const pct = s.max_vehicles > 0 ? s.booked_count / s.max_vehicles : 0
            const full = s.booked_count >= s.max_vehicles
            return (
              <div key={s.id} className="flex items-center gap-2 border rounded px-3 py-2">
                <span className="font-mono font-semibold text-sm w-24 shrink-0">
                  {s.time_from.slice(0, 5)}–{s.time_to.slice(0, 5)}
                </span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                  s.cargo_type === 'ALL' ? 'bg-slate-100 text-slate-600' : 'bg-blue-100 text-blue-700'
                }`}>
                  {s.cargo_type === 'ALL' ? 'Tất cả' : s.cargo_type}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-semibold tabular-nums ${full ? 'text-red-600' : 'text-green-600'}`}>
                      {s.booked_count}/{s.max_vehicles} xe
                    </span>
                    {full && <span className="text-[9px] text-red-500 font-medium">Đầy</span>}
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${pct >= 1 ? 'bg-red-400' : pct >= 0.7 ? 'bg-amber-400' : 'bg-green-400'}`}
                      style={{ width: `${Math.min(pct * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Đóng</Button>
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
  const [createOpen, setCreateOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editBooking, setEditBooking] = useState<DeliveryBooking | null>(null)
  const [dvvtBooking, setDvvtBooking] = useState<DeliveryBooking | null>(null)
  const [deleteErr, setDeleteErr] = useState('')

  const { data: warehouses = [] }          = useWarehouses(true)
  const { data: slotsList = [] }           = useDeliverySlots(warehouseId ? { date, warehouse_id: warehouseId } : undefined)
  const { data: whTypesMain = [] }         = useWarehouseTypes()
  const { data: vehicleTypesMain = [] }    = useVehicleTypes(true)
  const { data: transportCompaniesMain = [] } = useTransportCompanies(true)
  const { data: bookings = [], isLoading } = useDeliveryBookings(
    (warehouseId || isNccUser) ? { date, warehouse_id: warehouseId || undefined } : undefined,
  )
  const deleteBooking  = useDeleteBooking()
  const updateBooking  = useUpdateBooking()

  const warehouseName = (warehouses as { id: string; name: string }[]).find(w => w.id === warehouseId)?.name ?? warehouseId

  // Options cho filter từ data thực
  const khungGioOptions = useMemo<MSOpt[]>(() => {
    const slotOpts: MSOpt[] = (slotsList as DeliverySlot[]).map(s => ({
      value: s.id,
      label: `${s.time_from.slice(0, 5)}–${s.time_to.slice(0, 5)}${s.cargo_type !== 'ALL' ? ` (${s.cargo_type})` : ''}`,
    }))
    return [{ value: '__chua_dat__', label: 'Chưa đặt' }, ...slotOpts]
  }, [slotsList])
  const huongOptions: MSOpt[] = [
    { value: 'OUTBOUND', label: 'Xuất' },
    { value: 'INBOUND', label: 'Nhập' },
  ]
  const dvvtOptions = useMemo<MSOpt[]>(() =>
    [...new Map((bookings as DeliveryBooking[])
      .filter(b => b.ncc_id && b.ncc?.name)
      .map(b => [b.ncc_id!, { value: b.ncc_id!, label: b.ncc!.name! }])
    ).values()],
    [bookings]
  )
  const loaiKhoOptions = useMemo<MSOpt[]>(() =>
    [...new Set((bookings as DeliveryBooking[]).map(b => b.warehouse_type).filter((v): v is string => !!v))]
      .map(v => ({ value: v, label: v })),
    [bookings]
  )
  const loaiXeOptions = useMemo<MSOpt[]>(() =>
    [...new Set((bookings as DeliveryBooking[]).map(b => b.vehicle_type).filter((v): v is string => !!v))]
      .map(v => ({ value: v, label: v })),
    [bookings]
  )

  // Client-side filter
  const filtered = useMemo(() => {
    let list = bookings as DeliveryBooking[]
    if (khungGioFilter.length) list = list.filter(b => {
      if (!b.slot_id && khungGioFilter.includes('__chua_dat__')) return true
      if (b.slot_id && khungGioFilter.includes(b.slot_id)) return true
      return false
    })
    if (huongFilter.length) list = list.filter(b => b.direction && huongFilter.includes(b.direction))
    if (dvvtFilter.length) list = list.filter(b => b.ncc_id && dvvtFilter.includes(b.ncc_id))
    if (loaiKhoFilter.length) list = list.filter(b => b.warehouse_type && loaiKhoFilter.includes(b.warehouse_type))
    if (loaiXeFilter.length) list = list.filter(b => b.vehicle_type && loaiXeFilter.includes(b.vehicle_type))
    return list
  }, [bookings, khungGioFilter, huongFilter, dvvtFilter, loaiKhoFilter, loaiXeFilter])

  const handleDelete = async (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    e.stopPropagation()
    setDeleteErr('')
    try { await deleteBooking.mutateAsync(id) } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setDeleteErr(msg ?? 'Lỗi xóa chuyến')
    }
  }

  const handleRelease = async (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    e.stopPropagation()
    setDeleteErr('')
    try {
      await updateBooking.mutateAsync({
        id,
        slot_id: null,
        ncc_id: null,
        license_plate: null,
        driver_phone: null,
        status: 'PENDING',
      })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setDeleteErr(msg ?? 'Lỗi trả lại chuyến')
    }
  }

  const rowBg = (status: string) => {
    if (status === 'CONFIRMED') return 'bg-green-50 hover:bg-green-100'
    if (status === 'ARRIVED')   return 'bg-blue-50 hover:bg-blue-100'
    if (status === 'DONE')      return 'bg-slate-50 hover:bg-slate-100'
    return 'hover:bg-slate-50'
  }

  // Điều vận được sửa khi slot chưa bắt đầu (hoặc chưa có slot)
  const canEditBooking = (b: DeliveryBooking) =>
    canManage &&
    ['PENDING', 'CONFIRMED'].includes(b.status) &&
    (!b.slot || !isSlotTimePassed(b.date, b.slot.time_from))

  // ĐVVT được điền/sửa xe khi PENDING, hoặc CONFIRMED nhưng slot chưa bắt đầu
  const canFillTransport = (b: DeliveryBooking) =>
    canBook && (
      b.status === 'PENDING' ||
      (b.status === 'CONFIRMED' && !!b.slot && !isSlotTimePassed(b.date, b.slot.time_from))
    )

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
                  <Plus className="h-3.5 w-3.5 shrink-0" /><span className="hidden sm:inline ml-1">Thêm chuyến</span>
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
              <MultiSelectFilter
                label="Khung giờ"
                options={khungGioOptions}
                selected={khungGioFilter}
                onChange={setKhungGioFilter}
              />
              <MultiSelectFilter
                label="Hướng"
                options={huongOptions}
                selected={huongFilter}
                onChange={setHuongFilter}
              />
              <MultiSelectFilter
                label="ĐVVT"
                options={dvvtOptions}
                selected={dvvtFilter}
                onChange={setDvvtFilter}
              />
              <MultiSelectFilter
                label="Loại kho"
                options={loaiKhoOptions}
                selected={loaiKhoFilter}
                onChange={setLoaiKhoFilter}
              />
              <MultiSelectFilter
                label="Loại xe"
                options={loaiXeOptions}
                selected={loaiXeFilter}
                onChange={setLoaiXeFilter}
              />
            </>
          )}
          {deleteErr && <p className="text-xs text-red-600 w-full">{deleteErr}</p>}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {!warehouseId && !isNccUser ? (
          <div className="py-24 text-center text-sm text-slate-400">Chọn kho để xem kế hoạch</div>
        ) : isLoading ? (
          <div className="py-24 text-center text-sm text-slate-400">Đang tải...</div>
        ) : !filtered.length ? (
          <div className="py-24 text-center text-sm text-slate-400">Chưa có chuyến nào cho ngày này</div>
        ) : (
            <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Số xe</TableHead>
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
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">SĐT lái xe</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Trạng thái</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 w-14"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(b => (
                    <TableRow key={b.id} className={rowBg(b.status)}>
                      <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">
                        {b.vehicle_code || <span className="text-slate-400 font-normal">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] font-semibold max-w-[140px] truncate">
                        {b.npp_name || <span className="text-slate-400 font-normal">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1">
                        {canFillTransport(b) && (
                          <button
                            onClick={e => { e.stopPropagation(); setDvvtBooking(b) }}
                            className="text-blue-400 hover:text-blue-600 p-1 rounded"
                            title={b.status === 'PENDING' ? 'Đăng ký xe' : 'Sửa khung giờ'}
                          >
                            <Truck className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px]">
                        {b.slot && (
                          <span className="font-mono">{b.slot.time_from.slice(0, 5)}–{b.slot.time_to.slice(0, 5)}</span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold">
                        {b.license_plate ? (
                          <span className="flex items-center gap-0.5">
                            {user?.employee_code && b.license_plate === user.employee_code && (
                              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400 shrink-0" />
                            )}
                            {b.license_plate}
                          </span>
                        ) : <span className="text-slate-400 font-normal">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] max-w-[120px] truncate text-slate-500">
                        {b.ncc?.name || <span className="text-slate-300">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px]">
                        {b.direction ? (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${b.direction === 'OUTBOUND' ? 'bg-orange-100 text-orange-700' : 'bg-teal-100 text-teal-700'}`}>
                            {b.direction === 'OUTBOUND' ? 'Xuất' : 'Nhập'}
                          </span>
                        ) : <span className="text-slate-400">—</span>}
                      </TableCell>
                      {isNccUser && !warehouseId && (
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500">
                          {(warehouses as { id: string; name: string }[]).find(w => w.id === b.warehouse_id)?.name ?? '—'}
                        </TableCell>
                      )}
                      <TableCell className="px-2 py-1 text-[10px]">
                        {b.warehouse_type || <span className="text-slate-400">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px]">
                        {b.vehicle_type || <span className="text-slate-400">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] tabular-nums text-right">
                        {b.box_count != null ? <>{b.box_count}<span className="text-slate-400 text-[9px]"> thùng</span></> : <span className="text-slate-400">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] tabular-nums text-right">
                        {b.pallet_count != null ? <>{b.pallet_count}<span className="text-slate-400 text-[9px]"> pl</span></> : <span className="text-slate-400">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] tabular-nums text-right">
                        {b.tonnage != null ? <>{b.tonnage}<span className="text-slate-400 text-[9px]"> t</span></> : <span className="text-slate-400">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] text-slate-500">
                        {b.driver_phone || <span className="text-slate-400">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1">
                        <StatusBadge status={b.status} />
                      </TableCell>
                      <TableCell className="px-2 py-1">
                        <div className="flex items-center gap-0.5">
                          {canEditBooking(b) && (
                            <button
                              onClick={e => { e.stopPropagation(); setEditBooking(b) }}
                              className="text-slate-400 hover:text-slate-600 p-1 rounded"
                              title="Sửa thông tin chuyến"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canManage && b.status === 'CONFIRMED' && (
                            <button
                              onClick={(e: React.MouseEvent<HTMLButtonElement>) => handleRelease(e, b.id)}
                              className="text-amber-400 hover:text-amber-600 p-1 rounded"
                              title="Trả lại (hủy đăng ký ĐVVT)"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canManage && b.status === 'PENDING' && (
                            <button
                              onClick={(e: React.MouseEvent<HTMLButtonElement>) => handleDelete(e, b.id)}
                              className="text-red-400 hover:text-red-600 p-1 rounded"
                              title="Xóa chuyến"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
        )}
      </div>

      <CreateEditDialog
        open={createOpen || !!editBooking}
        booking={editBooking}
        onClose={() => { setCreateOpen(false); setEditBooking(null) }}
        defaultDate={date}
        defaultWarehouseId={warehouseId}
      />
      <DVVTFillDialog
        booking={dvvtBooking}
        onClose={() => setDvvtBooking(null)}
      />
      <SlotOverviewDialog
        open={slotOverviewOpen}
        onClose={() => setSlotOverviewOpen(false)}
        date={date}
        warehouseName={warehouseName}
        slots={slotsList as DeliverySlot[]}
      />
      <ExcelUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        warehouses={warehouses as { id: string; name: string }[]}
        warehouseTypes={whTypesMain.map(t => t.value)}
        vehicleTypes={vehicleTypesMain as TmsVehicleType[]}
        transportCompanies={transportCompaniesMain as TransportCompany[]}
      />
    </div>
  )
}
