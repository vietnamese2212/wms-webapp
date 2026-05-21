import React, { useState, useEffect, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { Plus, Upload, Pencil, Truck, Trash2, Download } from 'lucide-react'
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
  useWarehouses, useMaterialCategories, useVehicleTypes, useTransportCompanies,
  useDeliverySlots, useGenerateSlots,
  useDeliveryBookings, useCreateBooking, useUpdateBooking, useDeleteBooking, useBulkCreateBookings,
} from '@/api/hooks'
import { formatDate } from '@/utils/formatters'
import type { DeliveryBooking, DeliverySlot } from '@/types'

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

function SlotPicker({ warehouseId, date, selectedSlotId, onSelect }: {
  warehouseId: string; date: string; selectedSlotId: string | null
  onSelect: (slot: DeliverySlot) => void
}) {
  const [ready, setReady] = useState(false)
  const { mutate: generateSlots, isPending: isGenerating } = useGenerateSlots()
  const { data: slots = [], isLoading } = useDeliverySlots(ready ? { date, warehouse_id: warehouseId } : undefined)

  useEffect(() => {
    setReady(false)
    generateSlots(
      { warehouse_id: warehouseId, dates: [date] },
      { onSettled: () => setReady(true) },
    )
  }, [warehouseId, date])

  if (!ready || isGenerating || isLoading)
    return <p className="text-xs text-slate-400 py-6 text-center">Đang tải khung giờ...</p>

  // Ẩn các slot đã qua giờ (trừ slot đang được chọn)
  const availableSlots = (slots as DeliverySlot[]).filter(
    s => s.id === selectedSlotId || !isSlotTimePassed(date, s.time_from)
  )

  if (!availableSlots.length)
    return <p className="text-xs text-slate-400 py-6 text-center">Không còn khung giờ hợp lệ cho ngày này</p>

  return (
    <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
      {availableSlots.map(slot => {
        const full = slot.booked_count >= slot.max_vehicles
        const selected = slot.id === selectedSlotId
        return (
          <button
            key={slot.id}
            type="button"
            disabled={full && !selected}
            onClick={() => onSelect(slot)}
            className={[
              'w-full text-left px-3 py-2 rounded border text-xs flex items-center justify-between transition-colors',
              selected
                ? 'border-blue-500 bg-blue-50'
                : full
                  ? 'border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed'
                  : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 cursor-pointer',
            ].join(' ')}
          >
            <span className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${slot.direction === 'OUTBOUND' ? 'bg-orange-100 text-orange-700' : 'bg-teal-100 text-teal-700'}`}>
                {slot.direction === 'OUTBOUND' ? 'Xuất' : 'Nhập'}
              </span>
              <span className="font-mono font-semibold">{slot.time_from.slice(0, 5)}–{slot.time_to.slice(0, 5)}</span>
              <span className="text-slate-500">{slot.cargo_type === 'ALL' ? 'Tất cả' : slot.cargo_type}</span>
            </span>
            <span className={`font-semibold tabular-nums ${full ? 'text-red-500' : 'text-green-600'}`}>
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
  const [selectedSlot, setSelectedSlot] = useState<DeliverySlot | null>(null)
  const [licensePlate, setLicensePlate] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (booking) {
      setSelectedSlot((booking.slot as DeliverySlot | null) ?? null)
      setLicensePlate(booking.license_plate ?? '')
      setDriverPhone(booking.driver_phone ?? '')
      setErr('')
    }
  }, [booking?.id])

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
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Biển số xe *</Label>
              <Input value={licensePlate} onChange={e => setLicensePlate(e.target.value)} placeholder="51A-123.45" className="h-8 text-sm mt-1" />
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
  warehouse_type: string; vehicle_type: string
  box_count: string; pallet_count: string; tonnage: string
  gdo_refs: string; notes: string
}

const EMPTY_FORM = (date: string, warehouse_id: string): BookingFormData => ({
  date, warehouse_id, npp_name: '', ncc_id: '',
  warehouse_type: '', vehicle_type: '',
  box_count: '', pallet_count: '', tonnage: '',
  gdo_refs: '', notes: '',
})

function CreateEditDialog({ open, booking, onClose, defaultDate, defaultWarehouseId }: {
  open: boolean; booking: DeliveryBooking | null; onClose: () => void
  defaultDate: string; defaultWarehouseId: string
}) {
  const { data: warehouses = [] } = useWarehouses(true)
  const { data: categories = [] } = useMaterialCategories()
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

  const handleSubmit = async () => {
    if (!form.date || !form.warehouse_id) { setErr('Vui lòng chọn ngày và kho'); return }
    if (!form.ncc_id) { setErr('Vui lòng chọn đơn vị vận tải (ĐVVT)'); return }
    const payload = {
      date: form.date,
      warehouse_id: form.warehouse_id,
      npp_name: form.npp_name || undefined,
      ncc_id: form.ncc_id || undefined,
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
                  {(categories as string[]).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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
  npp_name: string; warehouse_type: string; vehicle_type: string
  box_count: number | null; pallet_count: number | null; tonnage: number | null
  gdo_refs: string; notes: string; valid: boolean; error: string
}

const EXCEL_COL_MAP: Record<string, string> = {
  'npp': 'npp_name', 'tên npp': 'npp_name', 'nhà phân phối': 'npp_name',
  'kho': 'warehouse_name', 'kho xuất': 'warehouse_name',
  'ngày': 'date', 'date': 'date',
  'loại kho': 'warehouse_type', 'warehouse type': 'warehouse_type',
  'loại xe': 'vehicle_type', 'vehicle type': 'vehicle_type',
  'thùng': 'box_count', 'số thùng': 'box_count', 'box': 'box_count',
  'pallet': 'pallet_count', 'số pallet': 'pallet_count',
  'tấn': 'tonnage', 'số tấn': 'tonnage', 'ton': 'tonnage',
  'gdo': 'gdo_refs', 'mã gdo': 'gdo_refs',
  'ghi chú': 'notes', 'notes': 'notes',
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

function ExcelUploadDialog({ open, onClose, warehouses }: {
  open: boolean; onClose: () => void
  warehouses: { id: string; name: string }[]
}) {
  const bulkCreate = useBulkCreateBookings()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null)
  const [err, setErr] = useState('')

  const whByName = Object.fromEntries(warehouses.map(w => [w.name.toLowerCase().trim(), w.id]))

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

        const parsed: ImportRow[] = raw.map(r => {
          const norm: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(r)) {
            const mapped = EXCEL_COL_MAP[k.trim().toLowerCase()]
            if (mapped) norm[mapped] = v
          }

          const whName = String(norm.warehouse_name ?? '').trim()
          const whId = whByName[whName.toLowerCase()] ?? null
          const date = parseExcelDate(norm.date)
          const errors: string[] = []
          if (!date) errors.push('thiếu ngày')
          if (whName && !whId) errors.push(`kho "${whName}" không tìm thấy`)
          if (!whId && !whName) errors.push('thiếu kho')

          return {
            date, warehouse_id: whId, warehouse_name: whName,
            npp_name: String(norm.npp_name ?? ''),
            warehouse_type: String(norm.warehouse_type ?? ''),
            vehicle_type: String(norm.vehicle_type ?? ''),
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
    const valid = rows.filter(r => r.valid)
    if (!valid.length) { setErr('Không có dòng hợp lệ'); return }
    setImporting(true)
    try {
      const data = await bulkCreate.mutateAsync(valid.map(r => ({
        date: r.date!, warehouse_id: r.warehouse_id!,
        npp_name: r.npp_name || undefined,
        warehouse_type: r.warehouse_type || undefined,
        vehicle_type: r.vehicle_type || undefined,
        box_count: r.box_count, pallet_count: r.pallet_count, tonnage: r.tonnage,
        gdo_refs: r.gdo_refs || undefined,
        notes: r.notes || undefined,
      })))
      setResult({ inserted: data.inserted, skipped: rows.length - valid.length })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setErr(msg ?? 'Lỗi import')
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['NPP', 'Kho', 'Ngày', 'Loại kho', 'Loại xe', 'Thùng', 'Pallet', 'Tấn', 'GDO', 'Ghi chú'],
      ['Tên NPP mẫu', 'Kho Ba Vì', '21/05/2026', 'Khô', 'Pallet', 100, 5, 2.5, 'GDO-001', ''],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Import')
    XLSX.writeFile(wb, 'mau_ke_hoach_vc.xlsx')
  }

  const validCount = rows.filter(r => r.valid).length

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
                    {rows.length} dòng · <span className="text-green-600 font-medium">{validCount} hợp lệ</span>
                    {rows.length - validCount > 0 && <> · <span className="text-red-600 font-medium">{rows.length - validCount} lỗi</span></>}
                  </span>
                )}
              </div>

              {rows.length > 0 && (
                <div className="max-h-64 overflow-auto rounded border">
                  <table className="min-w-full text-[10px]">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        {['#', 'NPP', 'Kho', 'Ngày', 'L.kho', 'L.xe', 'Thùng', 'Pallet', 'Tấn', 'Lỗi'].map(h => (
                          <th key={h} className="px-2 py-1 text-left text-[9px] text-slate-500 font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className={r.valid ? '' : 'bg-red-50'}>
                          <td className="px-2 py-0.5 text-slate-400">{i + 1}</td>
                          <td className="px-2 py-0.5 max-w-[100px] truncate">{r.npp_name || '—'}</td>
                          <td className="px-2 py-0.5">{r.warehouse_name || '—'}</td>
                          <td className="px-2 py-0.5 font-mono">{r.date || '—'}</td>
                          <td className="px-2 py-0.5">{r.warehouse_type || '—'}</td>
                          <td className="px-2 py-0.5">{r.vehicle_type || '—'}</td>
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
          {!result && validCount > 0 && (
            <Button size="sm" onClick={handleImport} disabled={importing}>
              {importing ? 'Đang import...' : `Import ${validCount} chuyến`}
            </Button>
          )}
          {result && <Button size="sm" onClick={onClose}>Xong</Button>}
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

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const [date, setDate] = useState(today)
  const [warehouseId, setWarehouseId] = useState('')
  const [loaiKhoFilter, setLoaiKhoFilter] = useState<string[]>([])
  const [loaiXeFilter, setLoaiXeFilter]   = useState<string[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editBooking, setEditBooking] = useState<DeliveryBooking | null>(null)
  const [dvvtBooking, setDvvtBooking] = useState<DeliveryBooking | null>(null)
  const [deleteErr, setDeleteErr] = useState('')

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: bookings = [], isLoading } = useDeliveryBookings(
    warehouseId ? { date, warehouse_id: warehouseId } : undefined,
  )
  const deleteBooking = useDeleteBooking()

  // Options cho filter từ data thực
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
    if (loaiKhoFilter.length) list = list.filter(b => b.warehouse_type && loaiKhoFilter.includes(b.warehouse_type))
    if (loaiXeFilter.length) list = list.filter(b => b.vehicle_type && loaiXeFilter.includes(b.vehicle_type))
    return list
  }, [bookings, loaiKhoFilter, loaiXeFilter])

  const handleDelete = async (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    e.stopPropagation()
    setDeleteErr('')
    try { await deleteBooking.mutateAsync(id) } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setDeleteErr(msg ?? 'Lỗi xóa chuyến')
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
      <div className="border-b bg-white px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold">Kế hoạch vận chuyển</h1>
          <div className="flex items-center gap-2">
            {canManage && (
              <>
                <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
                  <Upload className="h-4 w-4 mr-1" />Upload Excel
                </Button>
                <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!warehouseId}>
                  <Plus className="h-4 w-4 mr-1" />Thêm chuyến
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-8 text-sm w-40" />
          <Select value={warehouseId || '__none__'} onValueChange={v => setWarehouseId(v === '__none__' ? '' : v)}>
            <SelectTrigger className="h-8 text-sm w-52"><SelectValue placeholder="— Chọn kho —" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Chọn kho —</SelectItem>
              {(warehouses as { id: string; name: string }[]).map(w => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {warehouseId && (
            <>
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
          {deleteErr && <p className="text-xs text-red-600">{deleteErr}</p>}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {!warehouseId ? (
          <div className="py-24 text-center text-sm text-slate-400">Chọn kho để xem kế hoạch</div>
        ) : isLoading ? (
          <div className="py-24 text-center text-sm text-slate-400">Đang tải...</div>
        ) : !filtered.length ? (
          <div className="py-24 text-center text-sm text-slate-400">Chưa có chuyến nào cho ngày này</div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Tên NPP</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">ĐVVT</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Loại kho</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Loại xe</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right">Thùng</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right">Pallet</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right">Tấn</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Khung giờ</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Biển số</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">SĐT lái xe</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Trạng thái</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 w-14"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(b => (
                  <TableRow key={b.id} className={rowBg(b.status)}>
                    {/* Tên NPP */}
                    <TableCell className="px-2 py-1 text-[10px] font-semibold max-w-[140px] truncate">
                      {b.npp_name || <span className="text-slate-400 font-normal">—</span>}
                    </TableCell>

                    {/* ĐVVT */}
                    <TableCell className="px-2 py-1 text-[10px] max-w-[120px] truncate text-slate-500">
                      {b.ncc?.name || <span className="text-slate-300">—</span>}
                    </TableCell>

                    {/* Loại kho */}
                    <TableCell className="px-2 py-1 text-[10px]">
                      {b.warehouse_type || <span className="text-slate-400">—</span>}
                    </TableCell>

                    {/* Loại xe */}
                    <TableCell className="px-2 py-1 text-[10px]">
                      {b.vehicle_type || <span className="text-slate-400">—</span>}
                    </TableCell>

                    {/* Thùng */}
                    <TableCell className="px-2 py-1 text-[10px] tabular-nums text-right">
                      {b.box_count != null
                        ? <>{b.box_count}<span className="text-slate-400 text-[9px]"> thùng</span></>
                        : <span className="text-slate-400">—</span>}
                    </TableCell>

                    {/* Pallet */}
                    <TableCell className="px-2 py-1 text-[10px] tabular-nums text-right">
                      {b.pallet_count != null
                        ? <>{b.pallet_count}<span className="text-slate-400 text-[9px]"> pl</span></>
                        : <span className="text-slate-400">—</span>}
                    </TableCell>

                    {/* Tấn */}
                    <TableCell className="px-2 py-1 text-[10px] tabular-nums text-right">
                      {b.tonnage != null
                        ? <>{b.tonnage}<span className="text-slate-400 text-[9px]"> t</span></>
                        : <span className="text-slate-400">—</span>}
                    </TableCell>

                    {/* Khung giờ + nút ĐVVT inline */}
                    <TableCell className="px-2 py-1 text-[10px]">
                      <div className="flex items-center gap-1">
                        {b.slot ? (
                          <span className="flex items-center gap-1">
                            <span className={`px-1 rounded text-[9px] font-medium ${b.slot.direction === 'OUTBOUND' ? 'bg-orange-100 text-orange-700' : 'bg-teal-100 text-teal-700'}`}>
                              {b.slot.direction === 'OUTBOUND' ? 'X' : 'N'}
                            </span>
                            <span className="font-mono">{b.slot.time_from.slice(0, 5)}–{b.slot.time_to.slice(0, 5)}</span>
                          </span>
                        ) : (
                          <span className="text-amber-500">Chưa đặt</span>
                        )}
                        {canFillTransport(b) && (
                          <button
                            onClick={e => { e.stopPropagation(); setDvvtBooking(b) }}
                            className="text-blue-400 hover:text-blue-600 p-0.5 rounded ml-1 shrink-0"
                            title={b.status === 'PENDING' ? 'Đăng ký xe' : 'Sửa khung giờ'}
                          >
                            <Truck className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </TableCell>

                    {/* Biển số */}
                    <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold">
                      {b.license_plate || <span className="text-slate-400 font-normal">—</span>}
                    </TableCell>

                    {/* SĐT */}
                    <TableCell className="px-2 py-1 text-[10px] text-slate-500">
                      {b.driver_phone || <span className="text-slate-400">—</span>}
                    </TableCell>

                    {/* Trạng thái */}
                    <TableCell className="px-2 py-1">
                      <StatusBadge status={b.status} />
                    </TableCell>

                    {/* Actions: Pencil + Trash (Truck đã chuyển vào cột Khung giờ) */}
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
          </div>
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
      <ExcelUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        warehouses={warehouses as { id: string; name: string }[]}
      />
    </div>
  )
}
