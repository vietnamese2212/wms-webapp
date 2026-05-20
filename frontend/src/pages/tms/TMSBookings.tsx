import React, { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { can, type ModulePermissions } from '@/config/permissions'
import { useAuthStore } from '@/stores/authStore'
import {
  useWarehouses, useTransportCompanies,
  useDeliverySlots, useGenerateSlots,
  useDeliveryBookings, useCreateBooking, useUpdateBooking, useDeleteBooking,
} from '@/api/hooks'
import { formatDate } from '@/utils/formatters'
import type { DeliveryBooking, DeliverySlot } from '@/types'

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
  if (!slots.length)
    return <p className="text-xs text-slate-400 py-6 text-center">Chưa có khung giờ cho ngày này — cài đặt trong TMS Settings</p>

  return (
    <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
      {slots.map(slot => {
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

// ── Create Booking Dialog (Điều vận) ──────────────────────────────────────────

function CreateBookingDialog({ open, onClose, defaultDate, defaultWarehouseId }: {
  open: boolean; onClose: () => void; defaultDate: string; defaultWarehouseId: string
}) {
  const { data: warehouses = [] } = useWarehouses(true)
  const { data: nccs = [] } = useTransportCompanies(true)
  const createBooking = useCreateBooking()

  const [date, setDate] = useState(defaultDate)
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId)
  const [nccId, setNccId] = useState('')
  const [gdoRefs, setGdoRefs] = useState('')
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (open) {
      setDate(defaultDate); setWarehouseId(defaultWarehouseId)
      setNccId(''); setGdoRefs(''); setNotes(''); setErr('')
    }
  }, [open])

  const handleSubmit = async () => {
    if (!date || !warehouseId || !nccId) { setErr('Vui lòng điền đủ thông tin bắt buộc'); return }
    try {
      await createBooking.mutateAsync({ date, warehouse_id: warehouseId, ncc_id: nccId, gdo_refs: gdoRefs || undefined, notes: notes || undefined })
      onClose()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setErr(msg ?? 'Lỗi tạo chuyến')
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Thêm chuyến vận chuyển</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Ngày *</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs">Kho *</Label>
              <Select value={warehouseId || '__none__'} onValueChange={v => setWarehouseId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Chọn kho" /></SelectTrigger>
                <SelectContent>
                  {(warehouses as { id: string; name: string }[]).map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">ĐVVT / NCC *</Label>
            <Select value={nccId || '__none__'} onValueChange={v => setNccId(v === '__none__' ? '' : v)}>
              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Chọn ĐVVT" /></SelectTrigger>
              <SelectContent>
                {(nccs as { id: string; code: string; name: string }[]).map(n => (
                  <SelectItem key={n.id} value={n.id}>{n.code} — {n.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Mã GDO (nhiều mã cách nhau bằng dấu phẩy)</Label>
            <Input value={gdoRefs} onChange={e => setGdoRefs(e.target.value)} placeholder="GDO-001, GDO-002" className="h-8 text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs">Ghi chú</Label>
            <textarea value={notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)} rows={2} className="flex w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mt-1" />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Hủy</Button>
          <Button size="sm" onClick={handleSubmit} disabled={createBooking.isPending}>
            {createBooking.isPending ? 'Đang lưu...' : 'Thêm chuyến'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Booking Detail Dialog (ĐVVT điền slot + xe) ───────────────────────────────

function BookingDetailDialog({ booking, onClose, canBook, canManage }: {
  booking: DeliveryBooking | null; onClose: () => void; canBook: boolean; canManage: boolean
}) {
  const updateBooking = useUpdateBooking()

  const [selectedSlot, setSelectedSlot] = useState<DeliverySlot | null>(null)
  const [licensePlate, setLicensePlate] = useState('')
  const [driverName, setDriverName] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState('')
  const [err, setErr] = useState('')

  const isPending = booking?.status === 'PENDING'

  useEffect(() => {
    if (booking) {
      setSelectedSlot((booking.slot as DeliverySlot | null) ?? null)
      setLicensePlate(booking.license_plate ?? '')
      setDriverName(booking.driver_name ?? '')
      setDriverPhone(booking.driver_phone ?? '')
      setNotes(booking.notes ?? '')
      setStatus(booking.status)
      setErr('')
    }
  }, [booking?.id])

  const handleSave = async () => {
    if (!booking) return
    const updates: Parameters<typeof updateBooking.mutateAsync>[0] = { id: booking.id }

    if (canBook && isPending) {
      if (selectedSlot?.id !== booking.slot_id) updates.slot_id = selectedSlot?.id ?? null
      updates.license_plate = licensePlate || null
      updates.driver_name   = driverName || null
      updates.driver_phone  = driverPhone || null
      updates.notes         = notes || null
      if (selectedSlot && licensePlate && driverName) updates.status = 'CONFIRMED'
    }
    if (canManage && status !== booking.status) updates.status = status

    try {
      await updateBooking.mutateAsync(updates)
      onClose()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setErr(msg ?? 'Lỗi cập nhật')
    }
  }

  if (!booking) return null
  const canEdit = (canBook && isPending) || canManage

  return (
    <Dialog open={!!booking} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Chi tiết chuyến</DialogTitle>
          <div className="text-xs text-slate-500 space-y-0.5 mt-1">
            <p><span className="font-medium">ĐVVT:</span> {booking.ncc?.code} — {booking.ncc?.name}</p>
            <p><span className="font-medium">Ngày:</span> {formatDate(booking.date)}</p>
            {booking.gdo_refs && <p><span className="font-medium">GDO:</span> {booking.gdo_refs}</p>}
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Slot picker — chỉ khi PENDING + có quyền book */}
          {canBook && isPending && (
            <div>
              <Label className="text-xs font-medium mb-2 block">Chọn khung giờ *</Label>
              <SlotPicker
                warehouseId={booking.warehouse_id}
                date={booking.date}
                selectedSlotId={selectedSlot?.id ?? null}
                onSelect={setSelectedSlot}
              />
            </div>
          )}

          {/* Slot đã chọn (read-only khi confirmed+) */}
          {booking.slot && !isPending && (
            <div className="bg-slate-50 rounded px-3 py-2 text-xs flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${booking.slot.direction === 'OUTBOUND' ? 'bg-orange-100 text-orange-700' : 'bg-teal-100 text-teal-700'}`}>
                {booking.slot.direction === 'OUTBOUND' ? 'Xuất' : 'Nhập'}
              </span>
              <span className="font-mono font-semibold">{booking.slot.time_from.slice(0, 5)}–{booking.slot.time_to.slice(0, 5)}</span>
              <span className="text-slate-500">{booking.slot.cargo_type === 'ALL' ? 'Tất cả' : booking.slot.cargo_type}</span>
            </div>
          )}

          {/* Vehicle info — ĐVVT điền */}
          {canBook && isPending && (
            <div className="space-y-2">
              <div>
                <Label className="text-xs">Biển số xe *</Label>
                <Input value={licensePlate} onChange={e => setLicensePlate(e.target.value)} placeholder="51A-123.45" className="h-8 text-sm mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Tên tài xế *</Label>
                  <Input value={driverName} onChange={e => setDriverName(e.target.value)} className="h-8 text-sm mt-1" />
                </div>
                <div>
                  <Label className="text-xs">SĐT tài xế</Label>
                  <Input value={driverPhone} onChange={e => setDriverPhone(e.target.value)} className="h-8 text-sm mt-1" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Ghi chú</Label>
                <textarea value={notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)} rows={2} className="flex w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mt-1" />
              </div>
            </div>
          )}

          {/* Vehicle info read-only khi confirmed+ */}
          {!isPending && (booking.license_plate || booking.driver_name) && (
            <div className="bg-slate-50 rounded px-3 py-2 text-xs space-y-1">
              {booking.license_plate && (
                <p><span className="text-slate-500">Biển số:</span> <span className="font-mono font-semibold ml-1">{booking.license_plate}</span></p>
              )}
              {booking.driver_name && (
                <p><span className="text-slate-500">Tài xế:</span> {booking.driver_name}{booking.driver_phone && ` — ${booking.driver_phone}`}</p>
              )}
              {booking.notes && (
                <p><span className="text-slate-500">Ghi chú:</span> {booking.notes}</p>
              )}
            </div>
          )}

          {/* Status thay đổi — Điều vận */}
          {canManage && (
            <div>
              <Label className="text-xs">Trạng thái</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_CFG).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Đóng</Button>
          {canEdit && (
            <Button size="sm" onClick={handleSave} disabled={updateBooking.isPending}>
              {updateBooking.isPending ? 'Đang lưu...' : 'Lưu'}
            </Button>
          )}
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
  const [createOpen, setCreateOpen] = useState(false)
  const [detailBooking, setDetailBooking] = useState<DeliveryBooking | null>(null)
  const [deleteErr, setDeleteErr] = useState('')

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: bookings = [], isLoading } = useDeliveryBookings(
    warehouseId ? { date, warehouse_id: warehouseId } : undefined,
  )
  const deleteBooking = useDeleteBooking()

  const handleDelete = async (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    e.stopPropagation()
    setDeleteErr('')
    try {
      await deleteBooking.mutateAsync(id)
    } catch (err: unknown) {
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold">Kế hoạch vận chuyển</h1>
          {canManage && (
            <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!warehouseId}>
              <Plus className="h-4 w-4 mr-1" />Thêm chuyến
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="h-8 text-sm w-40"
          />
          <Select value={warehouseId || '__none__'} onValueChange={v => setWarehouseId(v === '__none__' ? '' : v)}>
            <SelectTrigger className="h-8 text-sm w-52"><SelectValue placeholder="— Chọn kho —" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Chọn kho —</SelectItem>
              {(warehouses as { id: string; name: string }[]).map(w => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {deleteErr && <p className="text-xs text-red-600">{deleteErr}</p>}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {!warehouseId ? (
          <div className="py-24 text-center text-sm text-slate-400">Chọn kho để xem kế hoạch</div>
        ) : isLoading ? (
          <div className="py-24 text-center text-sm text-slate-400">Đang tải...</div>
        ) : !bookings.length ? (
          <div className="py-24 text-center text-sm text-slate-400">Chưa có chuyến nào cho ngày này</div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">ĐVVT</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">GDO</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Khung giờ</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Biển số</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Tài xế / SĐT</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Trạng thái</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.map(b => (
                  <TableRow
                    key={b.id}
                    className={`cursor-pointer ${rowBg(b.status)}`}
                    onClick={() => setDetailBooking(b)}
                  >
                    <TableCell className="px-2 py-1 text-[10px]">
                      <span className="font-mono font-semibold">{b.ncc?.code ?? '—'}</span>
                      <span className="text-slate-500 ml-1">{b.ncc?.name}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-slate-500 max-w-[120px] truncate">
                      {b.gdo_refs || '—'}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">
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
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold">
                      {b.license_plate || <span className="text-slate-400 font-normal">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">
                      {b.driver_name
                        ? <>{b.driver_name}<br /><span className="text-slate-400">{b.driver_phone}</span></>
                        : <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1">
                      <StatusBadge status={b.status} />
                    </TableCell>
                    <TableCell className="px-2 py-1">
                      {canManage && b.status === 'PENDING' && (
                        <button
                          onClick={(e: React.MouseEvent<HTMLButtonElement>) => handleDelete(e, b.id)}
                          className="text-red-400 hover:text-red-600 p-1 rounded"
                          title="Xóa chuyến"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <CreateBookingDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultDate={date}
        defaultWarehouseId={warehouseId}
      />
      <BookingDetailDialog
        booking={detailBooking}
        onClose={() => setDetailBooking(null)}
        canBook={canBook}
        canManage={canManage}
      />
    </div>
  )
}
