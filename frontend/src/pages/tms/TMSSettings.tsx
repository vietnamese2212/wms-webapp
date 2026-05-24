import { useState } from 'react'
import type { AxiosError } from 'axios'
import { Plus, Pencil, Trash2, Truck, Clock, Building2, Settings2, Warehouse } from 'lucide-react'
import { Button }   from '@/components/ui/button'
import { Input }    from '@/components/ui/input'
import { Label }    from '@/components/ui/label'
import { Card }     from '@/components/ui/card'
import { Badge }    from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useWarehouses, useWarehouseTypes,
  useVehicleTypes, useCreateVehicleType, useUpdateVehicleType,
  useSlotTemplates, useCreateSlotTemplate, useUpdateSlotTemplate, useDeleteSlotTemplate,
  useTransportCompanies, useCreateTransportCompany, useUpdateTransportCompany,
  useTmsVehicles, useCreateTmsVehicle, useUpdateTmsVehicle,
} from '@/api/hooks'
import { can, type ModulePermissions } from '@/config/permissions'
import { useAuthStore } from '@/stores/authStore'
import type { TmsVehicleType, SlotTemplate, TransportCompany, TmsVehicle } from '@/types'

const DOW_LABEL: Record<number, string> = { 1:'T2', 2:'T3', 3:'T4', 4:'T5', 5:'T6', 6:'T7' }

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
      update({ id: vt.id, code, is_active: isActive }, { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
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
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="PALLET, SCA, XA…" /></div>
          <div className="space-y-1"><Label className="text-xs">Tên *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Xe pallet, Xe SCA…"
              disabled={isEdit} className={isEdit ? 'bg-slate-50 cursor-not-allowed' : ''} /></div>
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

// ─── SlotTemplate form ───────────────────────────────────────────────────────

function SlotTemplateDialog({ st, open, onClose, vehicleTypes, warehouseId, cargoOptions }: {
  st: SlotTemplate | null; open: boolean; onClose: () => void
  vehicleTypes: TmsVehicleType[]; warehouseId: string; cargoOptions: string[]
}) {
  const isEdit = !!st
  const [vtId,        setVtId]        = useState(st?.vehicle_type_id ?? '')
  const [direction,   setDirection]   = useState(st?.direction ?? 'OUTBOUND')
  const [cargoType,   setCargoType]   = useState(st?.cargo_type ?? 'ALL')
  const [daysOfWeek,  setDaysOfWeek]  = useState<number[]>(isEdit ? [st.day_of_week] : [1,2,3,4,5,6])
  const [timeFrom,    setTimeFrom]    = useState(st?.time_from?.slice(0,5) ?? '')
  const [timeTo,      setTimeTo]      = useState(st?.time_to?.slice(0,5) ?? '')
  const [maxVehicles, setMaxVehicles] = useState(String(st?.max_vehicles ?? '1'))
  const [isActive,    setIsActive]    = useState(st?.is_active ?? true)
  const [err, setErr] = useState('')

  const { mutate: create, isPending: creating } = useCreateSlotTemplate()
  const { mutate: update, isPending: updating } = useUpdateSlotTemplate()
  const isPending = creating || updating

  function toggleDay(d: number) {
    setDaysOfWeek(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())
  }

  function handleSubmit() {
    setErr('')
    if (!vtId || !timeFrom || !timeTo || !maxVehicles) { setErr('Vui lòng điền đủ thông tin'); return }
    if (!isEdit && daysOfWeek.length === 0) { setErr('Chọn ít nhất 1 thứ'); return }
    if (isEdit) {
      update({ id: st.id, time_from: timeFrom, time_to: timeTo, max_vehicles: Number(maxVehicles), cargo_type: cargoType, is_active: isActive },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    } else {
      create({ warehouse_id: warehouseId, vehicle_type_id: vtId, direction, cargo_type: cargoType, days_of_week: daysOfWeek, time_from: timeFrom, time_to: timeTo, max_vehicles: Number(maxVehicles) },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{isEdit ? 'Sửa khung giờ' : 'Thêm khung giờ'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}

          {!isEdit && <>
            <div className="space-y-1"><Label className="text-xs">Loại xe *</Label>
              <Select value={vtId || '__none__'} onValueChange={v => setVtId(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Chọn loại xe" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Chọn loại xe —</SelectItem>
                  {vehicleTypes.filter(v => v.is_active).map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Hướng *</Label>
              <Select value={direction} onValueChange={v => setDirection(v as 'OUTBOUND'|'INBOUND')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="OUTBOUND">Xuất hàng</SelectItem>
                  <SelectItem value="INBOUND">Nhập hàng</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Áp dụng thứ *</Label>
              <div className="flex gap-1.5">
                {[1,2,3,4,5,6].map(d => (
                  <button key={d} type="button" onClick={() => toggleDay(d)}
                    className={`w-9 h-9 rounded-lg text-xs font-semibold border transition-all
                      ${daysOfWeek.includes(d) ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
                    {DOW_LABEL[d]}
                  </button>
                ))}
              </div>
            </div>
          </>}

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
            <Input type="number" min="1" value={maxVehicles} onChange={e => setMaxVehicles(e.target.value)} /></div>

          {isEdit && <div className="flex items-center gap-2">
            <input id="st-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
            <Label htmlFor="st-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
          </div>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── TransportCompany form ───────────────────────────────────────────────────

function TransportCompanyDialog({ co, open, onClose }: { co: TransportCompany | null; open: boolean; onClose: () => void }) {
  const isEdit = !!co
  const [code,    setCode]    = useState(co?.code    ?? '')
  const [name,    setName]    = useState(co?.name    ?? '')
  const [contact, setContact] = useState(co?.contact_name  ?? '')
  const [phone,   setPhone]   = useState(co?.contact_phone ?? '')
  const [isActive, setIsActive] = useState(co?.is_active ?? true)
  const [err, setErr] = useState('')

  const { mutate: create, isPending: creating } = useCreateTransportCompany()
  const { mutate: update, isPending: updating } = useUpdateTransportCompany()
  const isPending = creating || updating

  function handleSubmit() {
    setErr('')
    if (!code || !name) { setErr('Mã và tên là bắt buộc'); return }
    if (isEdit) {
      update({ id: co.id, name, contact_name: contact || undefined, contact_phone: phone || undefined, is_active: isActive },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    } else {
      create({ code, name, contact_name: contact || undefined, contact_phone: phone || undefined },
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
            <div className="space-y-1"><Label className="text-xs">Tên ĐVVT *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Công ty vận tải A…" /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Người liên hệ</Label>
            <Input value={contact} onChange={e => setContact(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">SĐT liên hệ</Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} /></div>
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

function VehicleDialog({ v, open, onClose, companies, vehicleTypes }: {
  v: TmsVehicle | null; open: boolean; onClose: () => void
  companies: TransportCompany[]; vehicleTypes: TmsVehicleType[]
}) {
  const isEdit = !!v
  const [nccId,    setNccId]    = useState(v?.ncc_id          ?? '')
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
            <Select value={nccId || '__none__'} onValueChange={val => setNccId(val === '__none__' ? '' : val)}>
              <SelectTrigger><SelectValue placeholder="Chọn ĐVVT" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Chọn ĐVVT —</SelectItem>
                {companies.filter(c => c.is_active).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Biển số xe *</Label>
            <Input value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} placeholder="51F-12345"
              disabled={isEdit} className={isEdit ? 'bg-slate-50 cursor-not-allowed' : ''} /></div>
          <div className="space-y-1"><Label className="text-xs">Loại xe *</Label>
            <Select value={vtId || '__none__'} onValueChange={val => setVtId(val === '__none__' ? '' : val)}>
              <SelectTrigger><SelectValue placeholder="Chọn loại xe" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Chọn loại xe —</SelectItem>
                {vehicleTypes.filter(vt => vt.is_active).map(vt => <SelectItem key={vt.id} value={vt.id}>{vt.name}</SelectItem>)}
              </SelectContent>
            </Select>
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
  const canSlots     = can(perms, 'tms', 'manage_slots')
  const canCompanies = can(perms, 'tms', 'manage_companies')

  // Warehouse selector — context cho tab Khung giờ
  const { data: warehouses = [] } = useWarehouses(true)
  const [warehouseId, setWarehouseId] = useState('')

  // Cargo options từ LookupValue(warehouse_type) — master data tập trung
  const { data: whTypes = [] } = useWarehouseTypes()
  const cargoOptions = whTypes.map(t => t.value)

  // VehicleType
  const { data: vehicleTypes = [], isLoading: loadingVT } = useVehicleTypes()
  const [editingVT, setEditingVT] = useState<TmsVehicleType | null>(null)
  const [showVTDlg, setShowVTDlg] = useState(false)

  // SlotTemplate — chỉ load khi đã chọn kho
  const [filterVTId, setFilterVTId] = useState('__all__')
  const [filterDir,  setFilterDir]  = useState('__all__')
  const { data: templates = [], isLoading: loadingST } = useSlotTemplates({
    warehouse_id:    warehouseId || undefined,
    vehicle_type_id: filterVTId === '__all__' ? undefined : filterVTId,
    direction:       filterDir  === '__all__' ? undefined : filterDir,
  })
  const { mutate: deleteST, isPending: deletingST } = useDeleteSlotTemplate()
  const [editingST, setEditingST] = useState<SlotTemplate | null>(null)
  const [showSTDlg, setShowSTDlg] = useState(false)

  // TransportCompany
  const { data: companies = [], isLoading: loadingCo } = useTransportCompanies()
  const [editingCo, setEditingCo] = useState<TransportCompany | null>(null)
  const [showCoDlg, setShowCoDlg] = useState(false)

  // Vehicle
  const [filterNcc, setFilterNcc] = useState('__all__')
  const { data: vehicles = [], isLoading: loadingV } = useTmsVehicles({
    ncc_id: filterNcc === '__all__' ? undefined : filterNcc,
  })
  const [editingV, setEditingV] = useState<TmsVehicle | null>(null)
  const [showVDlg, setShowVDlg] = useState(false)

  const selectedWarehouse = warehouses.find((w: any) => w.id === warehouseId)

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-slate-500" />
            Cài đặt TMS
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Loại xe, khung giờ booking, ĐVVT và phương tiện</p>
        </div>

        {/* Warehouse selector — áp dụng cho tab Khung giờ */}
        <div className="flex items-center gap-2 shrink-0">
          <Warehouse className="h-4 w-4 text-slate-400" />
          <Select value={warehouseId || '__none__'} onValueChange={v => setWarehouseId(v === '__none__' ? '' : v)}>
            <SelectTrigger className="h-8 text-sm w-[200px]">
              <SelectValue placeholder="Chọn kho…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Chọn kho —</SelectItem>
              {warehouses.map((w: any) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="vehicle-types">
        <TabsList className="mb-2">
          <TabsTrigger value="vehicle-types"  className="gap-1.5"><Truck className="h-3.5 w-3.5" /> Loại xe</TabsTrigger>
          <TabsTrigger value="slot-templates" className="gap-1.5"><Clock className="h-3.5 w-3.5" /> Khung giờ</TabsTrigger>
          <TabsTrigger value="companies"      className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> ĐVVT / NCC</TabsTrigger>
          <TabsTrigger value="vehicles"       className="gap-1.5"><Truck className="h-3.5 w-3.5" /> Xe</TabsTrigger>
        </TabsList>

        {/* ── Tab: Loại xe ── */}
        <TabsContent value="vehicle-types" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">{vehicleTypes.length} loại xe</p>
            {canSlots && (
              <Button size="sm" className="gap-1.5" onClick={() => { setEditingVT(null); setShowVTDlg(true) }}>
                <Plus className="h-4 w-4" /> Thêm loại xe
              </Button>
            )}
          </div>
          <Card>
            {loadingVT ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-3 py-2 text-xs">Mã</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Tên loại xe</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Trạng thái</TableHead>
                      {canSlots && <TableHead className="px-3 py-2 w-12" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vehicleTypes.map(vt => (
                      <TableRow key={vt.id} className="text-sm">
                        <TableCell className="px-3 py-2 font-mono font-semibold text-[11px] text-slate-600">{vt.code}</TableCell>
                        <TableCell className="px-3 py-2 font-medium text-slate-800">{vt.name}</TableCell>
                        <TableCell className="px-3 py-2">
                          <Badge variant={vt.is_active ? 'default' : 'secondary'} className="text-xs">
                            {vt.is_active ? 'Hoạt động' : 'Tạm dừng'}
                          </Badge>
                        </TableCell>
                        {canSlots && (
                          <TableCell className="px-2 py-2">
                            <button className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                              onClick={() => { setEditingVT(vt); setShowVTDlg(true) }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ── Tab: Khung giờ ── */}
        <TabsContent value="slot-templates" className="space-y-3">
          {!warehouseId ? (
            <div className="py-16 text-center text-slate-400 space-y-2">
              <Warehouse className="h-10 w-10 mx-auto opacity-30" />
              <p className="text-sm font-medium">Chọn kho để xem và cài đặt khung giờ</p>
              <p className="text-xs">Mỗi kho có khung giờ và số xe tối đa riêng</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{selectedWarehouse?.name}</span>
                  {' '}· {templates.length} template
                </p>
                {canSlots && (
                  <Button size="sm" className="gap-1.5" onClick={() => { setEditingST(null); setShowSTDlg(true) }}>
                    <Plus className="h-4 w-4" /> Thêm khung giờ
                  </Button>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Select value={filterVTId} onValueChange={setFilterVTId}>
                  <SelectTrigger className="h-8 text-sm w-[180px]">
                    <SelectValue placeholder="Tất cả loại xe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Tất cả loại xe</SelectItem>
                    {vehicleTypes.map(vt => <SelectItem key={vt.id} value={vt.id}>{vt.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filterDir} onValueChange={setFilterDir}>
                  <SelectTrigger className="h-8 text-sm w-[150px]"><SelectValue placeholder="Tất cả hướng" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Tất cả hướng</SelectItem>
                    <SelectItem value="OUTBOUND">Xuất hàng</SelectItem>
                    <SelectItem value="INBOUND">Nhập hàng</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Card>
                {loadingST ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> : templates.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 space-y-2">
                    <Clock className="h-10 w-10 mx-auto opacity-30" />
                    <p className="text-sm">Chưa có khung giờ nào cho kho này</p>
                    {canSlots && <Button size="sm" variant="outline" onClick={() => { setEditingST(null); setShowSTDlg(true) }}>
                      <Plus className="h-4 w-4 mr-1" /> Thêm khung giờ đầu tiên
                    </Button>}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="px-3 py-2 text-xs">Loại xe</TableHead>
                          <TableHead className="px-3 py-2 text-xs">Hướng</TableHead>
                          <TableHead className="px-3 py-2 text-xs">Loại hàng</TableHead>
                          <TableHead className="px-3 py-2 text-xs">Thứ</TableHead>
                          <TableHead className="px-3 py-2 text-xs">Khung giờ</TableHead>
                          <TableHead className="px-3 py-2 text-xs text-right">Max xe</TableHead>
                          <TableHead className="px-3 py-2 text-xs">Trạng thái</TableHead>
                          {canSlots && <TableHead className="px-3 py-2 w-16" />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {templates.map(st => (
                          <TableRow key={st.id} className={`text-sm ${!st.is_active ? 'opacity-50' : ''}`}>
                            <TableCell className="px-3 py-1.5 font-medium text-slate-700">{st.vehicle_type?.name ?? '—'}</TableCell>
                            <TableCell className="px-3 py-1.5">
                              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${st.direction === 'OUTBOUND' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}`}>
                                {st.direction === 'OUTBOUND' ? 'Xuất' : 'Nhập'}
                              </span>
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-xs text-slate-500">{st.cargo_type === 'ALL' ? 'Tất cả' : st.cargo_type}</TableCell>
                            <TableCell className="px-3 py-1.5 font-semibold text-xs text-slate-700">{DOW_LABEL[st.day_of_week] ?? st.day_of_week}</TableCell>
                            <TableCell className="px-3 py-1.5 font-mono text-xs text-slate-700">
                              {st.time_from?.slice(0,5)} – {st.time_to?.slice(0,5)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-right font-semibold tabular-nums">{st.max_vehicles}</TableCell>
                            <TableCell className="px-3 py-1.5">
                              <Badge variant={st.is_active ? 'default' : 'secondary'} className="text-xs">
                                {st.is_active ? 'Hoạt động' : 'Tạm dừng'}
                              </Badge>
                            </TableCell>
                            {canSlots && (
                              <TableCell className="px-2 py-1.5">
                                <div className="flex items-center gap-0.5">
                                  <button className="text-slate-400 hover:text-blue-500 p-1"
                                    onClick={() => { setEditingST(st); setShowSTDlg(true) }}>
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button className="text-slate-400 hover:text-red-500 p-1"
                                    disabled={deletingST}
                                    onClick={() => { if (confirm('Xóa template này?')) deleteST(st.id) }}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
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
            </>
          )}
        </TabsContent>

        {/* ── Tab: ĐVVT / NCC ── */}
        <TabsContent value="companies" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">{companies.length} ĐVVT / NCC</p>
            {canCompanies && (
              <Button size="sm" className="gap-1.5" onClick={() => { setEditingCo(null); setShowCoDlg(true) }}>
                <Plus className="h-4 w-4" /> Thêm ĐVVT
              </Button>
            )}
          </div>
          <Card>
            {loadingCo ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> : companies.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <Building2 className="h-10 w-10 mx-auto opacity-30" />
                <p className="text-sm">Chưa có ĐVVT nào</p>
                {canCompanies && <Button size="sm" variant="outline" onClick={() => { setEditingCo(null); setShowCoDlg(true) }}>
                  <Plus className="h-4 w-4 mr-1" /> Thêm ĐVVT đầu tiên
                </Button>}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-3 py-2 text-xs">Mã</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Tên ĐVVT / NCC</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Người liên hệ</TableHead>
                      <TableHead className="px-3 py-2 text-xs">SĐT</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Trạng thái</TableHead>
                      {canCompanies && <TableHead className="px-3 py-2 w-12" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {companies.map(co => (
                      <TableRow key={co.id} className="text-sm">
                        <TableCell className="px-3 py-2 font-mono font-semibold text-[11px] text-slate-600">{co.code}</TableCell>
                        <TableCell className="px-3 py-2 font-medium text-slate-800">{co.name}</TableCell>
                        <TableCell className="px-3 py-2 text-slate-600">{co.contact_name ?? '—'}</TableCell>
                        <TableCell className="px-3 py-2 text-slate-600">{co.contact_phone ?? '—'}</TableCell>
                        <TableCell className="px-3 py-2">
                          <Badge variant={co.is_active ? 'default' : 'secondary'} className="text-xs">
                            {co.is_active ? 'Hoạt động' : 'Tạm dừng'}
                          </Badge>
                        </TableCell>
                        {canCompanies && (
                          <TableCell className="px-2 py-2">
                            <button className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                              onClick={() => { setEditingCo(co); setShowCoDlg(true) }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ── Tab: Xe ── */}
        <TabsContent value="vehicles" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">{vehicles.length} xe</p>
            {canCompanies && (
              <Button size="sm" className="gap-1.5" onClick={() => { setEditingV(null); setShowVDlg(true) }}>
                <Plus className="h-4 w-4" /> Thêm xe
              </Button>
            )}
          </div>
          <Select value={filterNcc} onValueChange={setFilterNcc}>
            <SelectTrigger className="h-8 text-sm w-[220px]">
              <Building2 className="h-3.5 w-3.5 mr-1.5 text-slate-400 shrink-0" />
              <SelectValue placeholder="Tất cả ĐVVT" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả ĐVVT</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Card>
            {loadingV ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> : vehicles.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <Truck className="h-10 w-10 mx-auto opacity-30" />
                <p className="text-sm">Chưa có xe nào</p>
                {canCompanies && <Button size="sm" variant="outline" onClick={() => { setEditingV(null); setShowVDlg(true) }}>
                  <Plus className="h-4 w-4 mr-1" /> Thêm xe đầu tiên
                </Button>}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-3 py-2 text-xs">Biển số</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Loại xe</TableHead>
                      <TableHead className="px-3 py-2 text-xs">ĐVVT / NCC</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Trạng thái</TableHead>
                      {canCompanies && <TableHead className="px-3 py-2 w-12" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vehicles.map(v => (
                      <TableRow key={v.id} className={`text-sm ${!v.is_active ? 'opacity-50' : ''}`}>
                        <TableCell className="px-3 py-2 font-mono font-semibold text-slate-800">{v.license_plate}</TableCell>
                        <TableCell className="px-3 py-2 text-slate-700">{v.vehicle_type?.name ?? '—'}</TableCell>
                        <TableCell className="px-3 py-2 text-slate-600">{v.ncc?.name ?? '—'}</TableCell>
                        <TableCell className="px-3 py-2">
                          <Badge variant={v.is_active ? 'default' : 'secondary'} className="text-xs">
                            {v.is_active ? 'Hoạt động' : 'Tạm dừng'}
                          </Badge>
                        </TableCell>
                        {canCompanies && (
                          <TableCell className="px-2 py-2">
                            <button className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                              onClick={() => { setEditingV(v); setShowVDlg(true) }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {showVTDlg && <VehicleTypeDialog vt={editingVT} open={showVTDlg} onClose={() => setShowVTDlg(false)} />}
      {showSTDlg && warehouseId && <SlotTemplateDialog st={editingST} open={showSTDlg} onClose={() => setShowSTDlg(false)} vehicleTypes={vehicleTypes} warehouseId={warehouseId} cargoOptions={cargoOptions} />}
      {showCoDlg && <TransportCompanyDialog co={editingCo} open={showCoDlg} onClose={() => setShowCoDlg(false)} />}
      {showVDlg  && <VehicleDialog v={editingV} open={showVDlg} onClose={() => setShowVDlg(false)} companies={companies} vehicleTypes={vehicleTypes} />}
    </div>
  )
}
