import { useState, useEffect, Fragment } from 'react'
import type { AxiosError } from 'axios'
import { Plus, Pencil, Trash2, Truck, Clock, Building2, Settings2, Warehouse, X, GripVertical } from 'lucide-react'
import { formatDate, formatDateTime, normalizeLicensePlate, normalizePhone } from '@/utils/formatters'
import { Button }   from '@/components/ui/button'
import { Input }    from '@/components/ui/input'
import { Label }    from '@/components/ui/label'
import { Card }     from '@/components/ui/card'
import { Badge }    from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FilterBar, type FilterDef } from '@/components/shared/FilterBar'
import { SearchInput } from '@/components/shared/SearchInput'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { toast } from '@/components/ui/use-toast'
import {
  useWarehouses, useWarehouseTypes,
  useVehicleTypes, useCreateVehicleType, useUpdateVehicleType, useReorderVehicleTypes, useDeleteVehicleType,
  useSlotTemplates, useUpdateSlotTemplate, useDeleteSlotTemplate, useBatchSlotTemplates, useSlotApplyInfo, useDeleteSlotTemplateCluster,
  useTransportCompanies, useCreateTransportCompany, useUpdateTransportCompany, useDeleteTransportCompany,
  useTmsVehicles, useCreateTmsVehicle, useUpdateTmsVehicle, useDeleteTmsVehicle,
} from '@/api/hooks'
import { can, canAccess, type ModulePermissions } from '@/config/permissions'
import { useAuthStore } from '@/stores/authStore'
import type { TmsVehicleType, SlotTemplate, TransportCompany, TmsVehicle } from '@/types'

const DOW_LABEL: Record<number, string> = { 1:'T2', 2:'T3', 3:'T4', 4:'T5', 5:'T6', 6:'T7', 0:'CN' }
const DOW_BUTTONS = [1, 2, 3, 4, 5, 6, 0]   // T2–T7 rồi CN cuối
const dowOrder = (d: number) => (d === 0 ? 7 : d)   // CN xếp cuối khi hiển thị

function apiMsg(err: unknown) {
  return (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? String(err)
}

// ─── VehicleType form ────────────────────────────────────────────────────────

function VehicleTypeDialog({ vt, open, onClose }: { vt: TmsVehicleType | null; open: boolean; onClose: () => void }) {
  const isEdit = !!vt
  const [code, setCode] = useState(vt?.code ?? '')
  const [name, setName] = useState(vt?.name ?? '')
  const [isActive, setIsActive] = useState(vt?.is_active ?? true)
  const [err, setErr] = useState('')

  const { mutate: create, isPending: creating } = useCreateVehicleType()
  const { mutate: update, isPending: updating } = useUpdateVehicleType()
  const isPending = creating || updating

  function handleSubmit() {
    setErr('')
    if (!code || !name) { setErr('Mã và tên là bắt buộc'); return }
    if (isEdit) {
      update({ id: vt.id, name, is_active: isActive }, { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    } else {
      create({ code, name }, { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? 'Sửa loại xe' : 'Thêm loại xe'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="space-y-1"><Label className="text-xs">Mã *</Label>
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="PALLET, SCA, XA…"
              disabled={isEdit} className={isEdit ? 'bg-slate-50 cursor-not-allowed' : ''} />
            {isEdit && <p className="text-[10px] text-slate-400">Mã là định danh cố định, không sửa được.</p>}</div>
          <div className="space-y-1"><Label className="text-xs">Tên *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Xe pallet, Xe SCA…" /></div>
          {isEdit && <div className="flex items-center gap-2">
            <input id="vt-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
            <Label htmlFor="vt-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
          </div>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !code || !name}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── SlotTemplate: form gộp (tạo + sửa cả cụm) ───────────────────────────────
// Form đại diện SETUP khung giờ của 1 (loại xe × loại hàng): tick thứ + BẢNG khung giờ (giờ từ/đến/max).
// Lưu → BE upsert lưới (thứ × khung giờ) rồi áp xuống các ngày tương lai chưa booking.

type SlotRowDraft = { time_from: string; time_to: string; max_vehicles: string }

function SlotBatchDialog({ open, onClose, preset, warehouseId, warehouseName, vehicleTypes, cargoOptions, allTemplates }: {
  open: boolean; onClose: () => void
  preset: { vtId: string; cargoType: string } | null   // null = thêm mới
  warehouseId: string; warehouseName: string
  vehicleTypes: TmsVehicleType[]; cargoOptions: string[]; allTemplates: SlotTemplate[]
}) {
  const [vtId,      setVtId]      = useState(preset?.vtId ?? '')
  const [cargoType, setCargoType] = useState(preset?.cargoType ?? '')
  const [days,      setDays]      = useState<number[]>([1,2,3,4,5,6])
  const [slots,     setSlots]     = useState<SlotRowDraft[]>([{ time_from:'', time_to:'', max_vehicles:'1' }])
  const [loadedKey, setLoadedKey] = useState('')
  const [err, setErr] = useState('')

  const { mutate: batch, isPending } = useBatchSlotTemplates()
  const { data: applyInfo } = useSlotApplyInfo({ warehouse_id: warehouseId || undefined, vehicle_type_id: vtId || undefined })

  const groupKey = vtId ? `${vtId}|${cargoType}` : ''
  const existingRows = allTemplates.filter(t => t.vehicle_type_id === vtId && t.cargo_type === cargoType)

  // Khi chọn (loại xe, loại hàng) → nạp cấu hình hiện có (nếu có) để sửa cả cụm; không có → khởi tạo trống
  useEffect(() => {
    if (!vtId || loadedKey === groupKey) return
    setLoadedKey(groupKey)
    const rows = allTemplates.filter(t => t.vehicle_type_id === vtId && t.cargo_type === cargoType)
    if (rows.length) {
      setDays([...new Set(rows.map(r => r.day_of_week))].sort((a,b) => a-b))
      const byTime = new Map<string, string>()
      for (const r of rows) { const k = `${r.time_from.slice(0,5)}|${r.time_to.slice(0,5)}`; if (!byTime.has(k)) byTime.set(k, String(r.max_vehicles)) }
      setSlots([...byTime.entries()].map(([k, max]) => { const [f,t] = k.split('|'); return { time_from:f, time_to:t, max_vehicles:max } }))
    } else {
      setDays([1,2,3,4,5,6]); setSlots([{ time_from:'', time_to:'', max_vehicles:'1' }])
    }
  }, [groupKey, vtId, cargoType, loadedKey, allTemplates])

  function toggleDay(d: number) { setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a,b) => a-b)) }
  function setSlot(i: number, patch: Partial<SlotRowDraft>) { setSlots(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s)) }

  function handleSubmit() {
    setErr('')
    if (!vtId) { setErr('Vui lòng chọn loại xe'); return }
    if (!cargoType) { setErr('Vui lòng chọn loại kho'); return }
    if (!days.length) { setErr('Chọn ít nhất 1 thứ'); return }
    const seen = new Set<string>()
    for (const s of slots) {
      const mv = Number(s.max_vehicles)
      if (!s.time_from || !s.time_to) { setErr('Mỗi khung giờ cần giờ bắt đầu và kết thúc'); return }
      if (s.max_vehicles === '' || !Number.isInteger(mv) || mv < 0) { setErr('Số xe tối đa phải là số ≥ 0 (đặt 0 để khóa khung giờ)'); return }
      if (s.time_from >= s.time_to) { setErr(`Giờ kết thúc phải sau giờ bắt đầu (${s.time_from}–${s.time_to})`); return }
      const k = `${s.time_from}-${s.time_to}`; if (seen.has(k)) { setErr(`Khung giờ ${s.time_from}–${s.time_to} bị lặp`); return } seen.add(k)
    }
    const clean = slots.map(s => ({ time_from: s.time_from, time_to: s.time_to, max_vehicles: Number(s.max_vehicles) }))
    batch({ warehouse_id: warehouseId, vehicle_type_id: vtId, cargo_type: cargoType, days_of_week: days, time_slots: clean },
      { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
  }

  const hasExisting = existingRows.length > 0
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="!flex flex-col w-[80vw] max-w-[80vw] h-[80dvh] sm:rounded-xl">
        <DialogHeader className="shrink-0"><DialogTitle>{preset ? 'Sửa cả cụm khung giờ' : 'Thêm khung giờ'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1 flex-1 min-h-0 overflow-y-auto pr-1">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}

          <div className="text-[11px] text-slate-500">Kho: <span className="font-medium text-slate-700">{warehouseName}</span></div>

          {/* 2 dòng info khi cấu hình đã tồn tại */}
          {hasExisting && applyInfo && (
            <div className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 space-y-1 text-[11px]">
              <div className="text-sky-800">Áp dụng được từ ngày: <span className="font-semibold">{applyInfo.applicable_from ? formatDate(applyInfo.applicable_from) : '—'}</span></div>
              {applyInfo.nearest_blocked
                ? <div className="text-amber-700">Ngày gần nhất còn dữ liệu cũ: <span className="font-semibold">{formatDate(applyInfo.nearest_blocked.date)}</span> — {applyInfo.nearest_blocked.booked} xe đã booking. <span className="text-amber-600">Gỡ booking ngày này rồi lưu lại để cập nhật.</span></div>
                : <div className="text-slate-500">Chưa ngày nào bị booking chặn — thay đổi áp cho mọi ngày tương lai.</div>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Loại xe *</Label>
              <Select value={vtId || '__none__'} onValueChange={v => setVtId(v === '__none__' ? '' : v)} disabled={!!preset}>
                <SelectTrigger className={preset ? 'bg-slate-50' : ''}><SelectValue placeholder="Chọn loại xe" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Chọn loại xe —</SelectItem>
                  {vehicleTypes.filter(v => v.is_active).map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Loại kho *</Label>
              <Select value={cargoType || '__none__'} onValueChange={v => setCargoType(v === '__none__' ? '' : v)} disabled={!!preset}>
                <SelectTrigger className={preset ? 'bg-slate-50' : ''}><SelectValue placeholder="— Chọn loại kho —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Chọn loại kho —</SelectItem>
                  {cargoType && cargoType !== '__none__' && !cargoOptions.includes(cargoType) && (
                    <SelectItem value={cargoType}>{cargoType === 'ALL' ? 'Tất cả loại kho' : cargoType}</SelectItem>
                  )}
                  {cargoOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Áp dụng thứ * <span className="font-normal text-slate-400">(mặc định T2–T7; chọn CN nếu cần)</span></Label>
            <div className="flex gap-1.5 flex-wrap">
              {DOW_BUTTONS.map(d => (
                <button key={d} type="button" onClick={() => toggleDay(d)}
                  className={`w-9 h-9 rounded-lg text-xs font-semibold border transition-all
                    ${days.includes(d) ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
                  {DOW_LABEL[d]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Khung giờ *</Label>
              <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1" onClick={() => setSlots(prev => [...prev, { time_from:'', time_to:'', max_vehicles:'1' }])}>
                <Plus className="h-3 w-3" /> Thêm khung
              </Button>
            </div>
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 px-2 py-1.5 bg-slate-50 text-[9px] font-medium text-slate-500 uppercase">
                <span>Giờ bắt đầu</span><span>Giờ kết thúc</span><span className="text-right w-16">Max xe</span><span className="w-6" />
              </div>
              {slots.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 px-2 py-1.5 items-center">
                  <Input type="time" value={s.time_from} onChange={e => setSlot(i, { time_from: e.target.value })} className="h-8" />
                  <Input type="time" value={s.time_to} onChange={e => setSlot(i, { time_to: e.target.value })} className="h-8" />
                  <Input type="number" min="0" value={s.max_vehicles} onChange={e => setSlot(i, { max_vehicles: e.target.value })} className="h-8 w-16 text-right" />
                  <button type="button" disabled={slots.length <= 1} onClick={() => setSlots(prev => prev.filter((_, idx) => idx !== i))}
                    className="text-slate-400 hover:text-red-500 disabled:opacity-30 disabled:hover:text-slate-400 p-1" title="Xóa khung giờ này">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400">Lưu sẽ tạo khung giờ cho từng thứ đã chọn × từng dòng khung giờ.</p>
          </div>
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── SlotTemplate: sửa lẻ 1 dòng (tùy biến giờ/số xe của riêng 1 thứ) ─────────

function SlotRowEditDialog({ st, open, onClose, cargoOptions }: {
  st: SlotTemplate; open: boolean; onClose: () => void; cargoOptions: string[]
}) {
  const [cargoType,   setCargoType]   = useState(st.cargo_type)
  const [timeFrom,    setTimeFrom]    = useState(st.time_from.slice(0,5))
  const [timeTo,      setTimeTo]      = useState(st.time_to.slice(0,5))
  const [maxVehicles, setMaxVehicles] = useState(String(st.max_vehicles))
  const [isActive,    setIsActive]    = useState(st.is_active)
  const [err, setErr] = useState('')

  const { mutate: update, isPending } = useUpdateSlotTemplate()

  function handleSubmit() {
    setErr('')
    const mv = Number(maxVehicles)
    if (!timeFrom || !timeTo || maxVehicles === '' || !Number.isInteger(mv) || mv < 0) { setErr('Vui lòng điền đủ thông tin (số xe tối đa ≥ 0)'); return }
    if (timeFrom >= timeTo) { setErr('Giờ kết thúc phải sau giờ bắt đầu'); return }
    update({ id: st.id, time_from: timeFrom, time_to: timeTo, max_vehicles: Number(maxVehicles), cargo_type: cargoType, is_active: isActive },
      { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Sửa khung giờ · {DOW_LABEL[st.day_of_week] ?? st.day_of_week}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <p className="text-[11px] text-slate-500">Sửa riêng dòng <span className="font-medium text-slate-700">{st.vehicle_type?.name ?? '—'} · {DOW_LABEL[st.day_of_week] ?? st.day_of_week}</span>. Thay đổi áp xuống các ngày tương lai chưa booking.</p>
          <div className="space-y-1"><Label className="text-xs">Loại hàng</Label>
            <Select value={cargoType} onValueChange={setCargoType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tất cả loại hàng</SelectItem>
                {cargoOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Giờ bắt đầu *</Label>
              <Input type="time" value={timeFrom} onChange={e => setTimeFrom(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Giờ kết thúc *</Label>
              <Input type="time" value={timeTo} onChange={e => setTimeTo(e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Số xe tối đa *</Label>
            <Input type="number" min="0" value={maxVehicles} onChange={e => setMaxVehicles(e.target.value)} /></div>
          <div className="flex items-center gap-2">
            <input id="st-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
            <Label htmlFor="st-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── TransportCompany form ───────────────────────────────────────────────────

function TransportCompanyDialog({ co, open, onClose }: { co: TransportCompany | null; open: boolean; onClose: () => void }) {
  const isEdit = !!co
  const [code,     setCode]     = useState(co?.code         ?? '')
  const [name,     setName]     = useState(co?.name         ?? '')
  const [type,     setType]     = useState<'ĐVVT' | 'NCC'>(co?.type ?? 'ĐVVT')
  const [aliasCodes, setAliasCodes] = useState((co?.alias_codes ?? []).join(', '))
  const [contact,  setContact]  = useState(co?.contact_name  ?? '')
  const [phone,    setPhone]    = useState(co?.contact_phone ?? '')
  const [isActive, setIsActive] = useState(co?.is_active ?? true)
  const [err, setErr] = useState('')

  const { mutate: create, isPending: creating } = useCreateTransportCompany()
  const { mutate: update, isPending: updating } = useUpdateTransportCompany()
  const isPending = creating || updating

  function handleSubmit() {
    setErr('')
    if (!code || !name) { setErr('Mã và tên là bắt buộc'); return }
    if (isEdit) {
      update({ id: co.id, name, type, contact_name: contact || undefined, contact_phone: phone || undefined, is_active: isActive, alias_codes: aliasCodes },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    } else {
      create({ code, name, type, contact_name: contact || undefined, contact_phone: phone || undefined, alias_codes: aliasCodes },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? 'Sửa ĐVVT/NCC' : 'Thêm ĐVVT/NCC'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Mã *</Label>
              <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="DVVT01…"
                disabled={isEdit} className={isEdit ? 'bg-slate-50 cursor-not-allowed' : ''} /></div>
            <div className="space-y-1"><Label className="text-xs">Tên *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Công ty vận tải A…" /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Loại *</Label>
            <Select value={type} onValueChange={v => setType(v as 'ĐVVT' | 'NCC')}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ĐVVT" className="text-xs">ĐVVT – Đơn vị vận tải</SelectItem>
                <SelectItem value="NCC"  className="text-xs">NCC – Nhà cung cấp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Mã phụ</Label>
            <Input value={aliasCodes} onChange={e => setAliasCodes(e.target.value.toUpperCase())} placeholder="vd: 10009281, 10009290" />
            <p className="text-[10px] text-slate-400">Mã ERP khác của CÙNG nhà cung cấp (cách nhau dấu phẩy). Upload theo mã nào cũng về NCC này; HSD/báo cáo gộp chung.</p>
          </div>
          <div className="space-y-1"><Label className="text-xs">Người liên hệ</Label>
            <Input value={contact} onChange={e => setContact(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">SĐT liên hệ</Label>
            <Input value={phone} onChange={e => setPhone(normalizePhone(e.target.value))} inputMode="numeric" placeholder="09xxxxxxxx" /></div>
          {isEdit && <div className="flex items-center gap-2">
            <input id="co-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
            <Label htmlFor="co-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
          </div>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !code || !name}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Vehicle form ─────────────────────────────────────────────────────────────

function VehicleDialog({ v, open, onClose, companies, vehicleTypes, lockedNccId }: {
  v: TmsVehicle | null; open: boolean; onClose: () => void
  companies: TransportCompany[]; vehicleTypes: TmsVehicleType[]
  lockedNccId?: string | null
}) {
  const isEdit = !!v
  const [nccId,    setNccId]    = useState(v?.ncc_id ?? lockedNccId ?? '')
  const [plate,    setPlate]    = useState(v?.license_plate    ?? '')
  const [vtId,     setVtId]     = useState(v?.vehicle_type_id  ?? '')
  const [isActive, setIsActive] = useState(v?.is_active ?? true)
  const [err, setErr] = useState('')

  const { mutate: create, isPending: creating } = useCreateTmsVehicle()
  const { mutate: update, isPending: updating } = useUpdateTmsVehicle()
  const isPending = creating || updating

  function handleSubmit() {
    setErr('')
    if (!nccId || !plate || !vtId) { setErr('Vui lòng điền đủ thông tin'); return }
    if (isEdit) {
      update({ id: v.id, ncc_id: nccId, vehicle_type_id: vtId, is_active: isActive },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    } else {
      create({ ncc_id: nccId, license_plate: plate, vehicle_type_id: vtId },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? 'Sửa xe' : 'Thêm xe'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="space-y-1"><Label className="text-xs">ĐVVT / NCC *</Label>
            {lockedNccId ? (
              <Input value={companies.find(c => c.id === lockedNccId)?.name ?? lockedNccId} disabled className="bg-slate-50 cursor-not-allowed" />
            ) : (
              <SingleSelect
                options={companies.filter(c => c.is_active).map(c => ({ value: c.id, label: c.name, sub: c.code }))}
                value={nccId} onChange={setNccId}
                placeholder="Chọn ĐVVT" searchPlaceholder="Tìm tên hoặc mã ĐVVT…"
                triggerClassName="w-full h-9" />
            )}
          </div>
          <div className="space-y-1"><Label className="text-xs">Biển số xe *</Label>
            <Input value={plate} onChange={e => setPlate(normalizeLicensePlate(e.target.value))} placeholder="30H1234"
              disabled={isEdit} className={isEdit ? 'bg-slate-50 cursor-not-allowed' : ''} /></div>
          <div className="space-y-1"><Label className="text-xs">Loại xe *</Label>
            <SingleSelect
              options={vehicleTypes.filter(vt => vt.is_active).map(vt => ({ value: vt.id, label: vt.name, sub: vt.code }))}
              value={vtId} onChange={setVtId}
              placeholder="Chọn loại xe" searchPlaceholder="Tìm tên hoặc mã loại xe…"
              triggerClassName="w-full h-9" />
          </div>
          {isEdit && <div className="flex items-center gap-2">
            <input id="v-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
            <Label htmlFor="v-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
          </div>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !nccId || !plate || !vtId}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Thêm xe'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TMSSettings() {
  const user = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const userNccId = user?.ncc_id ?? null   // non-null = ĐVVT user

  // Quyền write từng tab — mịn theo capability (create / edit / delete)
  const vtCreate = can(perms, 'tms_vehicle_types', 'create')
  const vtEdit   = can(perms, 'tms_vehicle_types', 'edit')      // sửa + kéo-thả thứ tự
  const vtDelete = can(perms, 'tms_vehicle_types', 'delete')
  const vtWrite  = vtCreate || vtEdit || vtDelete               // hiện cột thao tác

  const slotCreate = can(perms, 'tms_slots', 'create')
  const slotEdit   = can(perms, 'tms_slots', 'edit')
  const slotDelete = can(perms, 'tms_slots', 'delete')
  const slotWrite  = slotEdit || slotDelete

  const coCreate = can(perms, 'tms_companies', 'create')
  const coEdit   = can(perms, 'tms_companies', 'edit')
  const coDelete = can(perms, 'tms_companies', 'delete')
  const coWrite  = coEdit || coDelete

  const vCreate = can(perms, 'tms_vehicles', 'create')
  const vEdit   = can(perms, 'tms_vehicles', 'edit')
  const vDelete = can(perms, 'tms_vehicles', 'delete')
  const vWrite  = vEdit || vDelete

  // Tab visibility theo quyền view
  const showVtTab        = canAccess(perms, 'tms_vehicle_types')
  const showSlotsTab     = canAccess(perms, 'tms_slots')
  const showCompaniesTab = canAccess(perms, 'tms_companies')
  const showVehiclesTab  = canAccess(perms, 'tms_vehicles')
  const defaultTab = showVtTab ? 'vehicle-types'
    : showSlotsTab     ? 'slot-templates'
    : showCompaniesTab ? 'companies'
    : 'vehicles'

  // Warehouse selector — context cho tab Khung giờ
  const { data: warehouses = [] } = useWarehouses(true)
  const [warehouseId, setWarehouseId] = useState('')

  // Cargo options từ LookupValue(warehouse_type)
  const { data: whTypes = [] } = useWarehouseTypes()
  const cargoOptions = whTypes.map(t => t.value)

  // VehicleType
  const { data: vehicleTypes = [], isLoading: loadingVT } = useVehicleTypes()
  const [editingVT, setEditingVT] = useState<TmsVehicleType | null>(null)
  const [showVTDlg, setShowVTDlg] = useState(false)
  const { mutate: deleteVT } = useDeleteVehicleType()

  // Kéo-thả sắp thứ tự loại xe (kiểu AppSheet: grip + chỉ báo trên/dưới theo nửa dòng)
  const reorderVT = useReorderVehicleTypes()
  const [orderedVT, setOrderedVT] = useState<TmsVehicleType[]>([])
  const [dragVTIdx, setDragVTIdx] = useState<number | null>(null)
  const [overVT, setOverVT] = useState<{ idx: number; below: boolean } | null>(null)
  const vtKey = vehicleTypes.map(v => `${v.id}:${v.code}:${v.name}:${v.is_active}`).join(',')   // gồm nội dung → sửa tên/trạng thái cũng re-sync (tránh loop do fallback [] đổi ref)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (dragVTIdx === null) setOrderedVT(vehicleTypes) }, [vtKey, dragVTIdx])
  function dropVT() {
    const from = dragVTIdx, ov = overVT
    setDragVTIdx(null); setOverVT(null)
    if (from === null || !ov) return
    let toIdx = ov.below ? ov.idx + 1 : ov.idx
    if (from < toIdx) toIdx--
    if (toIdx === from) return
    const next = [...orderedVT]
    const [moved] = next.splice(from, 1)
    next.splice(toIdx, 0, moved)
    setOrderedVT(next)
    reorderVT.mutate(next.map(v => v.id), {
      onError: e => { toast({ variant: 'destructive', title: 'Không lưu được thứ tự', description: apiMsg(e) }); setOrderedVT(vehicleTypes) },
    })
  }

  // Filter tab Loại xe — search + trạng thái. Kéo-thả tắt khi đang lọc (index không khớp).
  const [vtSearch, setVtSearch] = useState('')
  const [vtStatus, setVtStatus] = useState('')   // '' | active | inactive
  const vtFiltering = !!(vtSearch.trim() || vtStatus)
  const shownVT = orderedVT.filter(vt => {
    if (vtStatus && (vtStatus === 'active') !== vt.is_active) return false
    const q = vtSearch.trim().toLowerCase()
    if (q && !`${vt.code} ${vt.name}`.toLowerCase().includes(q)) return false
    return true
  })

  // SlotTemplate — chỉ load khi đã chọn kho, filter client-side
  const [filterVTIds, setFilterVTIds] = useState<string[]>([])
  const [filterCargos, setFilterCargos] = useState<string[]>([])
  const [stSearch, setStSearch] = useState('')
  const [stStatus, setStStatus] = useState('')   // '' | active | inactive
  const { data: templates = [], isLoading: loadingST } = useSlotTemplates({
    warehouse_id: warehouseId || undefined,
  })
  const filteredTemplates = templates.filter(st => {
    if (filterVTIds.length && !filterVTIds.includes(st.vehicle_type_id)) return false
    if (filterCargos.length && !filterCargos.includes(st.cargo_type)) return false
    if (stStatus && (stStatus === 'active') !== st.is_active) return false
    const q = stSearch.trim().toLowerCase()
    if (q && !`${st.vehicle_type?.name ?? ''} ${st.cargo_type ?? ''}`.toLowerCase().includes(q)) return false
    return true
  })
  const { mutate: deleteST, isPending: deletingST } = useDeleteSlotTemplate()
  const { mutate: deleteCluster, isPending: deletingCluster } = useDeleteSlotTemplateCluster()
  const [editingST, setEditingST] = useState<SlotTemplate | null>(null)
  const [showSTDlg, setShowSTDlg] = useState(false)
  const [showBatchDlg, setShowBatchDlg] = useState(false)
  const [batchPreset, setBatchPreset]   = useState<{ vtId: string; cargoType: string } | null>(null)
  // Gom template theo (loại xe × loại hàng) để hiển thị + "Sửa cả cụm"
  const stGroupsMap = new Map<string, { vtId: string; vtName: string; cargo: string; rows: SlotTemplate[] }>()
  for (const st of filteredTemplates) {
    const k = `${st.vehicle_type_id}|${st.cargo_type}`
    if (!stGroupsMap.has(k)) stGroupsMap.set(k, { vtId: st.vehicle_type_id, vtName: st.vehicle_type?.name ?? '—', cargo: st.cargo_type, rows: [] })
    stGroupsMap.get(k)!.rows.push(st)
  }
  const stGroups = [...stGroupsMap.values()]
  // CN (day 0) hiển thị cuối cụm, sau đó theo giờ
  stGroups.forEach(g => g.rows.sort((a, b) => dowOrder(a.day_of_week) - dowOrder(b.day_of_week) || (a.time_from || '').localeCompare(b.time_from || '')))

  // TransportCompany
  const { data: companies = [], isLoading: loadingCo } = useTransportCompanies()
  const { mutate: deleteCo, isPending: deletingCo } = useDeleteTransportCompany()
  const [editingCo, setEditingCo] = useState<TransportCompany | null>(null)
  const [showCoDlg, setShowCoDlg] = useState(false)
  const [coSearch, setCoSearch] = useState('')
  const [coType,   setCoType]   = useState('')   // '' | NCC | ĐVVT
  const [coStatus, setCoStatus] = useState('')   // '' | active | inactive
  const coRank = (t?: string | null) => (t === 'NCC' ? 0 : 1)   // NCC trước, ĐVVT sau
  const filteredCompanies = (companies as TransportCompany[]).filter(co => {
    if (coType && (co.type ?? 'ĐVVT') !== coType) return false
    if (coStatus && (coStatus === 'active') !== co.is_active) return false
    const q = coSearch.trim().toLowerCase()
    if (q && !`${co.code} ${co.name} ${co.contact_name ?? ''} ${co.contact_phone ?? ''}`.toLowerCase().includes(q)) return false
    return true
  }).sort((a, b) => {
    if (coRank(a.type) !== coRank(b.type)) return coRank(a.type) - coRank(b.type)
    return (a.name ?? '').localeCompare(b.name ?? '', 'vi')
  })

  // Vehicle — load tất cả, filter client-side
  const [filterNccs, setFilterNccs] = useState<string[]>([])
  const [vSearch, setVSearch] = useState('')
  const [vVtIds,  setVVtIds]  = useState<string[]>([])
  const [vStatus, setVStatus] = useState('')   // '' | active | inactive
  const { data: vehicles = [], isLoading: loadingV } = useTmsVehicles({})
  const filteredVehicles = (vehicles as TmsVehicle[]).filter(v => {
    if (filterNccs.length && !filterNccs.includes(v.ncc_id)) return false
    if (vVtIds.length && !vVtIds.includes(v.vehicle_type_id)) return false
    if (vStatus && (vStatus === 'active') !== v.is_active) return false
    const q = vSearch.trim().toLowerCase()
    if (q && !`${v.license_plate} ${v.vehicle_type?.name ?? ''} ${v.ncc?.name ?? ''}`.toLowerCase().includes(q)) return false
    return true
  })
  const { mutate: deleteV, isPending: deletingV } = useDeleteTmsVehicle()
  const [editingV, setEditingV] = useState<TmsVehicle | null>(null)
  const [showVDlg, setShowVDlg] = useState(false)

  const selectedWarehouse = (warehouses as { id: string; name: string }[]).find(w => w.id === warehouseId)

  // Detail panel state
  const [detailVT, setDetailVT] = useState<TmsVehicleType | null>(null)
  const [detailST, setDetailST] = useState<SlotTemplate | null>(null)
  const [detailCo, setDetailCo] = useState<TransportCompany | null>(null)
  const [detailV,  setDetailV]  = useState<TmsVehicle | null>(null)

  const STATUS_OPTS = [{ value: 'active', label: 'Hoạt động' }, { value: 'inactive', label: 'Tạm dừng' }]
  const vtFilterDefs: FilterDef[] = [
    { key: 'vtst', label: 'Trạng thái', type: 'single', value: vtStatus, onChange: setVtStatus, allLabel: 'Tất cả', options: STATUS_OPTS },
  ]
  const stFilterDefs: FilterDef[] = [
    { key: 'stcargo', label: 'Loại kho', type: 'multi', selected: filterCargos, onChange: setFilterCargos, options: cargoOptions.map(c => ({ value: c, label: c })) },
    { key: 'stvt', label: 'Loại xe', type: 'multi', selected: filterVTIds, onChange: setFilterVTIds, options: vehicleTypes.map(vt => ({ value: vt.id, label: vt.name })) },
    { key: 'stst', label: 'Trạng thái', type: 'single', value: stStatus, onChange: setStStatus, allLabel: 'Tất cả', options: STATUS_OPTS },
  ]
  const coFilterDefs: FilterDef[] = [
    { key: 'cotype', label: 'Loại', type: 'single', value: coType, onChange: setCoType, allLabel: 'Tất cả', options: [{ value: 'NCC', label: 'NCC' }, { value: 'ĐVVT', label: 'ĐVVT' }] },
    { key: 'cost', label: 'Trạng thái', type: 'single', value: coStatus, onChange: setCoStatus, allLabel: 'Tất cả', options: STATUS_OPTS },
  ]
  const vFilterDefs: FilterDef[] = [
    { key: 'vvt', label: 'Loại xe', type: 'multi', selected: vVtIds, onChange: setVVtIds, options: vehicleTypes.map(vt => ({ value: vt.id, label: vt.name })) },
    { key: 'vst', label: 'Trạng thái', type: 'single', value: vStatus, onChange: setVStatus, allLabel: 'Tất cả', options: STATUS_OPTS },
  ]
  if (!userNccId) vFilterDefs.splice(1, 0, { key: 'vncc', label: 'ĐVVT / NCC', type: 'multi', selected: filterNccs, onChange: setFilterNccs, options: companies.map(c => ({ value: c.id, label: c.name })) })

  return (
    <div className="h-full overflow-auto sm:p-3">
     <div className="max-w-7xl mx-auto bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm p-4 space-y-4">
      <div>
        <h1 className="text-base font-semibold text-slate-800 flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-slate-500" />
          Cài đặt TMS
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">Loại xe, khung giờ booking, ĐVVT và phương tiện</p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <div className="overflow-x-auto mb-2">
          <TabsList className="w-max">
            {showVtTab        && <TabsTrigger value="vehicle-types"  className="gap-1.5"><Truck className="h-3.5 w-3.5" /> Loại xe</TabsTrigger>}
            {showSlotsTab     && <TabsTrigger value="slot-templates" className="gap-1.5"><Clock className="h-3.5 w-3.5" /> Khung giờ</TabsTrigger>}
            {showCompaniesTab && <TabsTrigger value="companies"      className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> ĐVVT / NCC</TabsTrigger>}
            {showVehiclesTab  && <TabsTrigger value="vehicles"       className="gap-1.5"><Truck className="h-3.5 w-3.5" /> Xe</TabsTrigger>}
          </TabsList>
        </div>

        {/* ── Tab: Loại xe ── */}
        <TabsContent value="vehicle-types" className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-slate-500">{shownVT.length}/{vehicleTypes.length} loại xe</p>
            {vtCreate && (
              <Button size="sm" className="gap-1.5" onClick={() => { setEditingVT(null); setShowVTDlg(true) }}>
                <Plus className="h-4 w-4" /> Thêm loại xe
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <SearchInput value={vtSearch} onChange={setVtSearch} placeholder="Tìm mã, tên loại xe…" className="flex-1 min-w-[200px]" />
            <FilterBar defs={vtFilterDefs} />
          </div>
          <div className="flex gap-3 items-start">
            <Card className="flex-1 min-w-0">
              {loadingVT ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> :
                shownVT.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 text-sm">{vehicleTypes.length === 0 ? 'Chưa có loại xe nào' : 'Không có loại xe khớp bộ lọc'}</div>
                ) : (
                <div className="overflow-auto max-h-[60vh]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {vtEdit && <TableHead className="px-2 py-1.5 w-7" />}
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Mã</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Tên loại xe</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Trạng thái</TableHead>
                        {vtWrite && <TableHead className="px-2 py-1.5 w-16" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shownVT.map((vt, idx) => {
                        const canDrag = vtEdit && !vtFiltering
                        const isOver = overVT?.idx === idx && dragVTIdx !== null && dragVTIdx !== idx
                        return (
                        <TableRow key={vt.id}
                          draggable={canDrag}
                          onDragStart={() => setDragVTIdx(idx)}
                          onDragOver={canDrag ? (e => {
                            e.preventDefault()
                            const r = e.currentTarget.getBoundingClientRect()
                            const below = (e.clientY - r.top) > r.height / 2
                            if (overVT?.idx !== idx || overVT?.below !== below) setOverVT({ idx, below })
                          }) : undefined}
                          onDrop={canDrag ? (e => { e.preventDefault(); dropVT() }) : undefined}
                          onDragEnd={() => { setDragVTIdx(null); setOverVT(null) }}
                          className={`cursor-pointer ${detailVT?.id === vt.id ? 'bg-slate-100' : 'hover:bg-slate-50'} ${dragVTIdx === idx ? 'opacity-40' : ''} ${isOver && !overVT?.below ? '[&>td]:border-t-2 [&>td]:border-t-sky-500' : ''} ${isOver && overVT?.below ? '[&>td]:border-b-2 [&>td]:border-b-sky-500' : ''}`}
                          onClick={() => setDetailVT(prev => prev?.id === vt.id ? null : vt)}>
                          {vtEdit && (
                            <TableCell className="px-2 py-1 w-7 text-slate-300 cursor-grab active:cursor-grabbing" onClick={e => e.stopPropagation()} title={vtFiltering ? 'Xóa bộ lọc để sắp thứ tự' : 'Kéo để đổi thứ tự'}>
                              {!vtFiltering && <GripVertical className="h-3.5 w-3.5" />}
                            </TableCell>
                          )}
                          <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-600">{vt.code}</TableCell>
                          <TableCell className="px-2 py-1 text-[10px] font-medium text-slate-800">{vt.name}</TableCell>
                          <TableCell className="px-2 py-1">
                            <Badge variant={vt.is_active ? 'default' : 'secondary'} className="text-[10px]">
                              {vt.is_active ? 'Hoạt động' : 'Tạm dừng'}
                            </Badge>
                          </TableCell>
                          {vtWrite && (
                            <TableCell className="px-2 py-1">
                              <div className="flex items-center gap-0.5">
                                {vtEdit && (
                                  <button className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                                    onClick={e => { e.stopPropagation(); setEditingVT(vt); setShowVTDlg(true) }}>
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {vtDelete && (
                                  <button className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                    onClick={e => { e.stopPropagation(); if (confirm(`Xóa loại xe "${vt.name}"?`)) deleteVT(vt.id, { onError: e2 => toast({ variant: 'destructive', title: 'Không xóa được loại xe', description: apiMsg(e2) }) }) }}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
            {detailVT && (
              <Card className="w-56 shrink-0 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{detailVT.code} — {detailVT.name}</span>
                  <button onClick={() => setDetailVT(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div><span className="text-slate-400">Trạng thái:</span> <span className="font-medium">{detailVT.is_active ? 'Hoạt động' : 'Tạm dừng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Tạo / Sửa</p>
                  <div><span className="text-slate-400">Người tạo:</span> <span className="font-medium">{detailVT.created_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ tạo:</span> <span className="font-medium">{detailVT.created_at ? formatDateTime(detailVT.created_at) : '—'}</span></div>
                  <div><span className="text-slate-400">Người sửa:</span> <span className="font-medium">{detailVT.updated_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ sửa:</span> <span className="font-medium">{detailVT.updated_at ? formatDateTime(detailVT.updated_at) : '—'}</span></div>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ── Tab: Khung giờ ── */}
        <TabsContent value="slot-templates" className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-slate-500">
              {selectedWarehouse
                ? <><span className="font-medium text-slate-700">{selectedWarehouse.name}</span>{' '}· {filteredTemplates.length} template</>
                : 'Chọn kho để xem và cài đặt khung giờ'}
            </p>
            {slotCreate && warehouseId && (
              <Button size="sm" className="gap-1.5" onClick={() => { setBatchPreset(null); setShowBatchDlg(true) }}>
                <Plus className="h-4 w-4" /> Thêm khung giờ
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 shrink-0">
              <Warehouse className="h-4 w-4 text-slate-400" />
              <WarehouseSingleSelect warehouses={warehouses as { id: string; code?: string; name: string }[]} value={warehouseId} onChange={setWarehouseId} placeholder="Chọn kho…" triggerClassName="w-52" />
            </div>
            <SearchInput value={stSearch} onChange={setStSearch} placeholder="Tìm loại xe, loại hàng…" className="flex-1 min-w-[200px]" />
            <FilterBar defs={stFilterDefs} />
          </div>
          {!warehouseId ? (
            <div className="py-16 text-center text-slate-400 space-y-2">
              <Warehouse className="h-10 w-10 mx-auto opacity-30" />
              <p className="text-sm font-medium">Chọn kho để xem và cài đặt khung giờ</p>
              <p className="text-xs">Mỗi kho có khung giờ và số xe tối đa riêng</p>
            </div>
          ) : (
            <div className="flex gap-3 items-start">
                <Card className="flex-1 min-w-0">
                  {loadingST ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> : filteredTemplates.length === 0 ? (
                    <div className="p-12 text-center text-slate-400 space-y-2">
                      <Clock className="h-10 w-10 mx-auto opacity-30" />
                      <p className="text-sm">Chưa có khung giờ nào cho kho này</p>
                      {slotCreate && <Button size="sm" variant="outline" onClick={() => { setBatchPreset(null); setShowBatchDlg(true) }}>
                        <Plus className="h-4 w-4 mr-1" /> Thêm khung giờ đầu tiên
                      </Button>}
                    </div>
                  ) : (
                    <div className="overflow-auto max-h-[60vh]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Thứ</TableHead>
                            <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Khung giờ</TableHead>
                            <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-right">Max xe</TableHead>
                            <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Trạng thái</TableHead>
                            {slotWrite && <TableHead className="px-2 py-1.5 w-16" />}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {stGroups.map(g => (
                            <Fragment key={`${g.vtId}|${g.cargo}`}>
                              <TableRow className="bg-slate-50 hover:bg-slate-50">
                                <TableCell colSpan={slotWrite ? 5 : 4} className="px-2 py-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-[11px] font-semibold text-slate-700">
                                      {g.vtName}
                                      <span className="font-normal text-slate-400"> · {g.cargo === 'ALL' ? 'Tất cả loại kho' : g.cargo} · {g.rows.length} khung</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      {slotCreate && (
                                        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1"
                                          onClick={() => { setBatchPreset({ vtId: g.vtId, cargoType: g.cargo }); setShowBatchDlg(true) }}>
                                          <Settings2 className="h-3 w-3" /> Sửa cả cụm
                                        </Button>
                                      )}
                                      {slotDelete && (
                                        <Button size="sm" variant="outline" disabled={deletingCluster}
                                          className="h-6 px-2 text-[10px] gap-1 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                                          onClick={() => { if (confirm(`Xóa cả cụm khung giờ "${g.vtName} · ${g.cargo === 'ALL' ? 'Tất cả loại kho' : g.cargo}"?\nCác ngày tương lai chưa có xe booking sẽ không còn khung giờ này.`)) deleteCluster({ warehouse_id: warehouseId, vehicle_type_id: g.vtId, cargo_type: g.cargo }, { onError: e2 => toast({ variant: 'destructive', title: 'Không xóa được cụm khung giờ', description: apiMsg(e2) }) }) }}>
                                          <Trash2 className="h-3 w-3" /> Xóa cả cụm
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                              {g.rows.map(st => (
                                <TableRow key={st.id}
                                  className={`cursor-pointer ${!st.is_active ? 'opacity-50' : ''} ${detailST?.id === st.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                                  onClick={() => setDetailST(prev => prev?.id === st.id ? null : st)}>
                                  <TableCell className="px-2 py-1 pl-4 font-semibold text-[10px] text-slate-700">{DOW_LABEL[st.day_of_week] ?? st.day_of_week}</TableCell>
                                  <TableCell className="px-2 py-1 font-mono text-[10px] text-slate-700">
                                    {st.time_from?.slice(0,5)} – {st.time_to?.slice(0,5)}
                                  </TableCell>
                                  <TableCell className="px-2 py-1 text-right font-semibold tabular-nums text-[10px]">{st.max_vehicles}</TableCell>
                                  <TableCell className="px-2 py-1">
                                    <Badge variant={st.is_active ? 'default' : 'secondary'} className="text-[10px]">
                                      {st.is_active ? 'Hoạt động' : 'Tạm dừng'}
                                    </Badge>
                                  </TableCell>
                                  {slotWrite && (
                                    <TableCell className="px-2 py-1">
                                      <div className="flex items-center gap-0.5">
                                        {slotEdit && <button className="text-slate-400 hover:text-blue-500 p-1"
                                          onClick={e => { e.stopPropagation(); setEditingST(st); setShowSTDlg(true) }} title="Sửa riêng dòng này">
                                          <Pencil className="h-3.5 w-3.5" />
                                        </button>}
                                        {slotDelete && <button className="text-slate-400 hover:text-red-500 p-1"
                                          disabled={deletingST}
                                          onClick={e => { e.stopPropagation(); if (confirm('Xóa khung giờ này?')) deleteST(st.id, { onError: e2 => toast({ variant: 'destructive', title: 'Không xóa được khung giờ', description: apiMsg(e2) }) }) }}>
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>}
                                      </div>
                                    </TableCell>
                                  )}
                                </TableRow>
                              ))}
                            </Fragment>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Card>
                {detailST && (
                  <Card className="w-56 shrink-0 p-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-700">{detailST.vehicle_type?.name ?? '—'}</span>
                      <button onClick={() => setDetailST(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                    </div>
                    <div><span className="text-slate-400">Loại hàng:</span> <span className="font-medium">{detailST.cargo_type === 'ALL' ? 'Tất cả' : detailST.cargo_type}</span></div>
                    <div><span className="text-slate-400">Thứ:</span> <span className="font-medium">{DOW_LABEL[detailST.day_of_week] ?? detailST.day_of_week}</span></div>
                    <div><span className="text-slate-400">Giờ:</span> <span className="font-mono font-medium">{detailST.time_from?.slice(0,5)} – {detailST.time_to?.slice(0,5)}</span></div>
                    <div><span className="text-slate-400">Max xe:</span> <span className="font-medium">{detailST.max_vehicles}</span></div>
                    <div><span className="text-slate-400">Trạng thái:</span> <span className="font-medium">{detailST.is_active ? 'Hoạt động' : 'Tạm dừng'}</span></div>
                    <div className="border-t pt-2 space-y-1.5">
                      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Tạo / Sửa</p>
                      <div><span className="text-slate-400">Người tạo:</span> <span className="font-medium">{detailST.created_by ?? '—'}</span></div>
                      <div><span className="text-slate-400">Ngày giờ tạo:</span> <span className="font-medium">{detailST.created_at ? formatDateTime(detailST.created_at) : '—'}</span></div>
                      <div><span className="text-slate-400">Người sửa:</span> <span className="font-medium">{detailST.updated_by ?? '—'}</span></div>
                      <div><span className="text-slate-400">Ngày giờ sửa:</span> <span className="font-medium">{detailST.updated_at ? formatDateTime(detailST.updated_at) : '—'}</span></div>
                    </div>
                  </Card>
                )}
            </div>
          )}
        </TabsContent>

        {/* ── Tab: ĐVVT / NCC ── */}
        <TabsContent value="companies" className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-slate-500">{filteredCompanies.length}/{companies.length} ĐVVT / NCC</p>
            {coCreate && (
              <Button size="sm" className="gap-1.5" onClick={() => { setEditingCo(null); setShowCoDlg(true) }}>
                <Plus className="h-4 w-4" /> Thêm ĐVVT
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <SearchInput value={coSearch} onChange={setCoSearch} placeholder="Tìm mã, tên, người LH, SĐT…" className="flex-1 min-w-[200px]" />
            <FilterBar defs={coFilterDefs} />
          </div>
          <div className="flex gap-3 items-start">
            <Card className="flex-1 min-w-0">
              {loadingCo ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> : companies.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <Building2 className="h-10 w-10 mx-auto opacity-30" />
                  <p className="text-sm">Chưa có ĐVVT nào</p>
                  {coCreate && <Button size="sm" variant="outline" onClick={() => { setEditingCo(null); setShowCoDlg(true) }}>
                    <Plus className="h-4 w-4 mr-1" /> Thêm ĐVVT đầu tiên
                  </Button>}
                </div>
              ) : filteredCompanies.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-sm">Không có ĐVVT / NCC khớp bộ lọc</div>
              ) : (
                <div className="overflow-auto max-h-[60vh]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Mã</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Mã phụ</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Loại</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Tên ĐVVT / NCC</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Người liên hệ</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">SĐT</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Trạng thái</TableHead>
                        {coWrite && <TableHead className="px-2 py-1.5 w-16" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCompanies.map(co => (
                        <TableRow key={co.id}
                          className={`cursor-pointer ${detailCo?.id === co.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                          onClick={() => setDetailCo(prev => prev?.id === co.id ? null : co)}>
                          <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-600">{co.code}</TableCell>
                          <TableCell className="px-2 py-1 font-mono text-[10px] text-slate-500 whitespace-nowrap">{co.alias_codes?.length ? co.alias_codes.join(', ') : <span className="text-slate-300">—</span>}</TableCell>
                          <TableCell className="px-2 py-1 whitespace-nowrap">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${co.type === 'NCC' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                              {co.type ?? 'ĐVVT'}
                            </span>
                          </TableCell>
                          <TableCell className="px-2 py-1 text-[10px] font-medium text-slate-800">{co.name}</TableCell>
                          <TableCell className="px-2 py-1 text-[10px] text-slate-600">{co.contact_name ?? '—'}</TableCell>
                          <TableCell className="px-2 py-1 text-[10px] text-slate-600">{co.contact_phone ?? '—'}</TableCell>
                          <TableCell className="px-2 py-1">
                            <Badge variant={co.is_active ? 'default' : 'secondary'} className="text-[10px]">
                              {co.is_active ? 'Hoạt động' : 'Tạm dừng'}
                            </Badge>
                          </TableCell>
                          {coWrite && (
                            <TableCell className="px-2 py-1">
                              <div className="flex items-center gap-0.5">
                                {coEdit && <button className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                                  onClick={e => { e.stopPropagation(); setEditingCo(co); setShowCoDlg(true) }}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>}
                                {coDelete && !userNccId && (
                                  <button className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                    disabled={deletingCo}
                                    onClick={e => { e.stopPropagation(); if (confirm(`Xóa ĐVVT "${co.name}"?\nTất cả xe và tài khoản lái xe liên kết sẽ bị xóa vĩnh viễn.`)) deleteCo(co.id, { onError: e2 => toast({ variant: 'destructive', title: 'Không xóa được ĐVVT', description: apiMsg(e2) }) }) }}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
            {detailCo && (
              <Card className="w-56 shrink-0 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{detailCo.code}</span>
                  <button onClick={() => setDetailCo(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div><span className="text-slate-400">Loại:</span> <span className={`ml-1 text-[9px] px-1.5 py-0.5 rounded-full font-medium ${detailCo.type === 'NCC' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{detailCo.type ?? 'ĐVVT'}</span></div>
                <div><span className="text-slate-400">Tên:</span> <span className="font-medium">{detailCo.name}</span></div>
                <div><span className="text-slate-400">Mã phụ:</span> <span className="font-mono font-medium">{detailCo.alias_codes?.length ? detailCo.alias_codes.join(', ') : '—'}</span></div>
                <div><span className="text-slate-400">Người LH:</span> <span className="font-medium">{detailCo.contact_name ?? '—'}</span></div>
                <div><span className="text-slate-400">SĐT:</span> <span className="font-medium">{detailCo.contact_phone ?? '—'}</span></div>
                <div><span className="text-slate-400">Trạng thái:</span> <span className="font-medium">{detailCo.is_active ? 'Hoạt động' : 'Tạm dừng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Tạo / Sửa</p>
                  <div><span className="text-slate-400">Người tạo:</span> <span className="font-medium">{detailCo.created_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ tạo:</span> <span className="font-medium">{detailCo.created_at ? formatDateTime(detailCo.created_at) : '—'}</span></div>
                  <div><span className="text-slate-400">Người sửa:</span> <span className="font-medium">{detailCo.updated_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ sửa:</span> <span className="font-medium">{detailCo.updated_at ? formatDateTime(detailCo.updated_at) : '—'}</span></div>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ── Tab: Xe ── */}
        <TabsContent value="vehicles" className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-slate-500">{filteredVehicles.length}/{(vehicles as TmsVehicle[]).length} xe</p>
            {vCreate && (
              <Button size="sm" className="gap-1.5" onClick={() => { setEditingV(null); setShowVDlg(true) }}>
                <Plus className="h-4 w-4" /> Thêm xe
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <SearchInput value={vSearch} onChange={setVSearch} placeholder="Tìm biển số, loại xe, ĐVVT…" className="flex-1 min-w-[200px]" />
            <FilterBar defs={vFilterDefs} />
          </div>
          <div className="flex gap-3 items-start">
            <Card className="flex-1 min-w-0">
              {loadingV ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> : (vehicles as TmsVehicle[]).length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <Truck className="h-10 w-10 mx-auto opacity-30" />
                  <p className="text-sm">Chưa có xe nào</p>
                  {vCreate && <Button size="sm" variant="outline" onClick={() => { setEditingV(null); setShowVDlg(true) }}>
                    <Plus className="h-4 w-4 mr-1" /> Thêm xe đầu tiên
                  </Button>}
                </div>
              ) : filteredVehicles.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-sm">Không có xe khớp bộ lọc</div>
              ) : (
                <div className="overflow-auto max-h-[60vh]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Biển số</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Loại xe</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">ĐVVT / NCC</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Trạng thái</TableHead>
                        {vWrite && <TableHead className="px-2 py-1.5 w-16" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredVehicles.map(v => (
                        <TableRow key={v.id}
                          className={`cursor-pointer ${!v.is_active ? 'opacity-50' : ''} ${detailV?.id === v.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                          onClick={() => setDetailV(prev => prev?.id === v.id ? null : v)}>
                          <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-800">{v.license_plate}</TableCell>
                          <TableCell className="px-2 py-1 text-[10px] text-slate-700">{v.vehicle_type?.name ?? '—'}</TableCell>
                          <TableCell className="px-2 py-1 text-[10px] text-slate-600">{v.ncc?.name ?? '—'}</TableCell>
                          <TableCell className="px-2 py-1">
                            <Badge variant={v.is_active ? 'default' : 'secondary'} className="text-[10px]">
                              {v.is_active ? 'Hoạt động' : 'Tạm dừng'}
                            </Badge>
                          </TableCell>
                          {vWrite && (
                            <TableCell className="px-2 py-1">
                              <div className="flex items-center gap-0.5">
                                {vEdit && <button className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                                  onClick={e => { e.stopPropagation(); setEditingV(v); setShowVDlg(true) }}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>}
                                {vDelete && <button className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                  disabled={deletingV}
                                  onClick={e => { e.stopPropagation(); if (confirm(`Xóa xe "${v.license_plate}"?\nTài khoản lái xe liên kết (nếu có) sẽ bị xóa vĩnh viễn.`)) deleteV(v.id, { onError: e2 => toast({ variant: 'destructive', title: 'Không xóa được xe', description: apiMsg(e2) }) }) }}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>}
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
            {detailV && (
              <Card className="w-56 shrink-0 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700 font-mono">{detailV.license_plate}</span>
                  <button onClick={() => setDetailV(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div><span className="text-slate-400">Loại xe:</span> <span className="font-medium">{detailV.vehicle_type?.name ?? '—'}</span></div>
                <div><span className="text-slate-400">ĐVVT:</span> <span className="font-medium">{detailV.ncc?.name ?? '—'}</span></div>
                <div><span className="text-slate-400">Trạng thái:</span> <span className="font-medium">{detailV.is_active ? 'Hoạt động' : 'Tạm dừng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Tạo / Sửa</p>
                  <div><span className="text-slate-400">Người tạo:</span> <span className="font-medium">{detailV.created_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ tạo:</span> <span className="font-medium">{detailV.created_at ? formatDateTime(detailV.created_at) : '—'}</span></div>
                  <div><span className="text-slate-400">Người sửa:</span> <span className="font-medium">{detailV.updated_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ sửa:</span> <span className="font-medium">{detailV.updated_at ? formatDateTime(detailV.updated_at) : '—'}</span></div>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {showVTDlg && <VehicleTypeDialog vt={editingVT} open={showVTDlg} onClose={() => setShowVTDlg(false)} />}
      {showBatchDlg && <SlotBatchDialog open={showBatchDlg} onClose={() => { setShowBatchDlg(false); setBatchPreset(null) }} preset={batchPreset} warehouseId={warehouseId} warehouseName={selectedWarehouse?.name ?? ''} vehicleTypes={vehicleTypes} cargoOptions={cargoOptions} allTemplates={templates} />}
      {showSTDlg && editingST && <SlotRowEditDialog st={editingST} open={showSTDlg} onClose={() => setShowSTDlg(false)} cargoOptions={cargoOptions} />}
      {showCoDlg && <TransportCompanyDialog co={editingCo} open={showCoDlg} onClose={() => setShowCoDlg(false)} />}
      {showVDlg  && <VehicleDialog v={editingV} open={showVDlg} onClose={() => setShowVDlg(false)} companies={companies} vehicleTypes={vehicleTypes} lockedNccId={userNccId} />}
     </div>
    </div>
  )
}
