import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { useWarehouses, useWarehouseTypes } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDateTime } from '@/utils/formatters'
import type { GateRegistration, GateStatus, BookingSuggestion, TransportCompany, TmsVehicle, TmsVehicleType } from '@/types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  X, Plus, Pencil, Trash2, PhoneCall,
  LogIn, LogOut, Star, Package, ArrowRight, ArrowLeft,
  ChevronDown, Loader2, SlidersHorizontal, Phone, RotateCcw,
} from 'lucide-react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<GateStatus, string> = {
  REGISTERED: 'Đã đăng ký',
  CALLED:     'Đã gọi xe',
  IN:         'Đang trong',
  COMPLETED:  'Đã ra',
}

const STATUS_BADGE: Record<GateStatus, string> = {
  REGISTERED: 'bg-slate-100 text-slate-600',
  CALLED:     'bg-amber-100 text-amber-700',
  IN:         'bg-green-100 text-green-700',
  COMPLETED:  'bg-blue-100 text-blue-700',
}

const ROW_COLOR: Record<GateStatus, string> = {
  REGISTERED: 'hover:bg-slate-50',
  CALLED:     'bg-[#E85AA0]/10 hover:bg-[#E85AA0]/20',
  IN:         'bg-[#D8891C]/10 hover:bg-[#D8891C]/20',
  COMPLETED:  'bg-[#4A90D9]/10 hover:bg-[#4A90D9]/20',
}

const TODAY_VN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

function fmtDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

// Trả về "YYYY-MM-DDTHH:mm" theo giờ VN để dùng trong <input type="datetime-local">
function nowVnDatetimeLocal() {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16)
}

function fmtTime(str: string | null | undefined) {
  if (!str) return '—'
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    }).format(new Date(str))
  } catch {
    return str
  }
}

// ─── Combobox (dùng trong modal — không bị overflow clip) ────────────────────

interface ComboOption { value: string; label: string; sub?: string }

function ComboField({
  value, displayValue, options, placeholder, loading,
  onSelect, onClear,
}: {
  value: string
  displayValue: string
  options: ComboOption[]
  placeholder?: string
  loading?: boolean
  onSelect: (opt: ComboOption) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 })

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase()) ||
    (o.sub ?? '').toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    if (!open) { setSearch(''); return }
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + 2, left: r.left, width: r.width })
    }
  }, [open])

  return (
    <div className="relative" ref={triggerRef}>
      <div className="flex gap-1">
        <div className="relative flex-1">
          {open ? (
            <Input
              ref={inputRef}
              autoFocus
              className="text-xs h-8"
              placeholder={`Tìm ${placeholder ?? ''}...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
            />
          ) : (
            <button
              type="button"
              className="w-full h-8 px-3 text-left text-xs border rounded-md bg-white flex items-center justify-between hover:bg-slate-50"
              onClick={() => setOpen(true)}
            >
              <span className={value ? '' : 'text-slate-400'}>{value ? displayValue : (placeholder ?? 'Chọn...')}</span>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronDown className="h-3 w-3 text-slate-400" />}
            </button>
          )}
        </div>
        {value && (
          <button type="button" onClick={onClear} className="text-slate-400 hover:text-slate-600">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div
          style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
          className="bg-white border rounded-md shadow-lg max-h-44 overflow-auto"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">Không có kết quả</div>
          ) : (
            filtered.map(o => (
              <button
                key={o.value}
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 flex flex-col"
                onMouseDown={e => { e.preventDefault(); onSelect(o); setOpen(false) }}
              >
                <span className="font-medium">{o.label}</span>
                {o.sub && <span className="text-slate-400 text-[10px]">{o.sub}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Form mặc định ────────────────────────────────────────────────────────────

type FormData = {
  date: string
  driver_name: string
  phone: string
  company_id: string
  company_name_raw: string
  vehicle_id: string
  license_plate: string
  direction: string
  warehouse_id: string
  warehouse_type: string
  vehicle_type: string
  content: string
  return_pallet: boolean
  seal_number: string
  notes: string
}

const PHASE2_DEFAULT = {
  vehicle_id: '', license_plate: '',
  driver_name: '', phone: '',
  content: '', return_pallet: false,
  seal_number: '', notes: '',
}

const FORM_DEFAULT: FormData = {
  date: TODAY_VN,
  driver_name: '', phone: '',
  company_id: '', company_name_raw: '',
  vehicle_id: '', license_plate: '',
  direction: '', warehouse_id: '', warehouse_type: '', vehicle_type: '',
  content: '', return_pallet: false, seal_number: '', notes: '',
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GateRegistration() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null

  // Kho được phép theo user scope
  const allowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids)
    : null

  // ── Filters
  const [fDate,          setFDate]          = useState(TODAY_VN)
  const [fDateTo,        setFDateTo]        = useState('')
  const [fWarehouse,     setFWarehouse]     = useState(() =>
    allowedWhIds && allowedWhIds.size === 1 ? [...allowedWhIds][0] : ''
  )
  const [fWarehouseType, setFWarehouseType] = useState('')
  const [fVehicleType,   setFVehicleType]   = useState('')
  const [fCompany,       setFCompany]       = useState('')
  const [fDirection,     setFDirection]     = useState('')
  const [fStatus,        setFStatus]        = useState('')
  const [showMoreFilters, setShowMoreFilters] = useState(false)

  // ── Selection + Modal
  const [selected,   setSelected]   = useState<GateRegistration | null>(null)
  const [modalOpen,  setModalOpen]  = useState(false)
  const [editReg,    setEditReg]    = useState<GateRegistration | null>(null)
  const [form,       setForm]       = useState<FormData>(FORM_DEFAULT)

  // ── Action dialogs
  const [callTarget,  setCallTarget]  = useState<GateRegistration | null>(null)
  const [entryTarget, setEntryTarget] = useState<GateRegistration | null>(null)
  const [exitTarget,  setExitTarget]  = useState<GateRegistration | null>(null)
  const [exitWeight,  setExitWeight]  = useState('')
  const [callTime,  setCallTime]  = useState('')
  const [entryTime, setEntryTime] = useState('')
  const [exitTime,  setExitTime]  = useState('')

  const [apiError, setApiError] = useState('')

  // ── Queries
  const params: Record<string, string> = {}
  if (fDate)          params.date           = fDate
  if (!fDate && fDateTo) params.date_to     = fDateTo
  if (fDate && fDateTo)  params.date_to     = fDateTo
  if (fWarehouse)     params.warehouse_id   = fWarehouse
  if (fWarehouseType) params.warehouse_type = fWarehouseType
  if (fVehicleType)   params.vehicle_type   = fVehicleType
  if (fCompany)       params.company_id     = fCompany
  if (fDirection)     params.direction      = fDirection
  if (fStatus)        params.status         = fStatus

  const { data: regs = [], isLoading } = useQuery<GateRegistration[]>({
    queryKey: ['gate-registrations', params],
    queryFn: () => apiClient.get('/tms/gate-registrations', { params }).then(r => r.data.data),
  })

  const { data: companies = [] } = useQuery<TransportCompany[]>({
    queryKey: ['tms-companies'],
    queryFn: () => apiClient.get('/tms/transport-companies').then(r => r.data.data),
  })

  const { data: vehicles = [] } = useQuery<TmsVehicle[]>({
    queryKey: ['tms-vehicles'],
    queryFn: () => apiClient.get('/tms/vehicles').then(r => r.data.data),
  })

  const { data: vehicleTypes = [] } = useQuery<TmsVehicleType[]>({
    queryKey: ['tms-vehicle-types'],
    queryFn: () => apiClient.get('/tms/vehicle-types').then(r => r.data.data),
  })

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: whTypes = [] } = useWarehouseTypes()

  // Phase 1 hoàn thành khi đủ 6 tiêu chí matching
  const phase1Complete = !!(
    form.date && form.warehouse_id && form.direction &&
    form.warehouse_type && form.vehicle_type && form.company_id
  )

  // Suggest chỉ trigger khi đủ cả 7 (phase1 + biển số)
  const suggestEnabled = !!(phase1Complete && form.license_plate)
  const { data: suggestions = [], isFetching: suggestLoading } = useQuery<BookingSuggestion[]>({
    queryKey: ['gate-suggest', form.date, form.license_plate, form.warehouse_id, form.direction, form.warehouse_type, form.vehicle_type, form.company_id, editReg?.id],
    queryFn: () => apiClient.get('/tms/gate-registrations/suggest-booking', {
      params: {
        date:            form.date,
        license_plate:   form.license_plate,
        warehouse_id:    form.warehouse_id,
        direction:       form.direction || undefined,
        warehouse_type:  form.warehouse_type || undefined,
        vehicle_type:    form.vehicle_type || undefined,
        company_id:      form.company_id || undefined,
        exclude_gate_id: editReg?.id,
      },
    }).then(r => r.data.data),
    enabled: suggestEnabled && modalOpen,
  })

  // ── Mutations
  function invalidate() {
    qc.invalidateQueries({ queryKey: ['gate-registrations'] })
  }

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/tms/gate-registrations', body).then(r => r.data),
    onSuccess: () => { invalidate(); closeModal() },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      setApiError(e.response?.data?.error?.message ?? 'Lỗi tạo đăng ký'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiClient.patch(`/tms/gate-registrations/${id}`, body).then(r => r.data),
    onSuccess: (d: { data: GateRegistration }) => {
      invalidate()
      setSelected(d.data)
      closeModal()
    },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      setApiError(e.response?.data?.error?.message ?? 'Lỗi cập nhật'),
  })

  const callMut = useMutation({
    mutationFn: ({ id, custom_time }: { id: string; custom_time?: string }) =>
      apiClient.patch(`/tms/gate-registrations/${id}/call`, { custom_time }).then(r => r.data),
    onSuccess: (d: { data: GateRegistration }) => { invalidate(); setSelected(d.data); setCallTarget(null) },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      alert(e.response?.data?.error?.message ?? 'Lỗi gọi xe'),
  })

  const entryMut = useMutation({
    mutationFn: ({ id, custom_time }: { id: string; custom_time?: string }) =>
      apiClient.patch(`/tms/gate-registrations/${id}/entry`, { custom_time }).then(r => r.data),
    onSuccess: (d: { data: GateRegistration }) => { invalidate(); setSelected(d.data); setEntryTarget(null) },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      alert(e.response?.data?.error?.message ?? 'Lỗi xác nhận vào'),
  })

  const exitMut = useMutation({
    mutationFn: ({ id, load_capacity, custom_time }: { id: string; load_capacity?: string; custom_time?: string }) =>
      apiClient.patch(`/tms/gate-registrations/${id}/exit`, { load_capacity: load_capacity || undefined, custom_time }).then(r => r.data),
    onSuccess: (d: { data: GateRegistration }) => {
      invalidate(); setSelected(d.data); setExitTarget(null); setExitWeight('')
    },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      alert(e.response?.data?.error?.message ?? 'Lỗi xác nhận ra'),
  })

  const revertCallMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/tms/gate-registrations/${id}/revert-call`).then(r => r.data),
    onSuccess: (d: { data: GateRegistration }) => { invalidate(); setSelected(d.data) },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      alert(e.response?.data?.error?.message ?? 'Lỗi huỷ gọi xe'),
  })

  const revertEntryMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/tms/gate-registrations/${id}/revert-entry`).then(r => r.data),
    onSuccess: (d: { data: GateRegistration }) => { invalidate(); setSelected(d.data) },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      alert(e.response?.data?.error?.message ?? 'Lỗi huỷ xác nhận vào'),
  })

  const revertExitMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/tms/gate-registrations/${id}/revert-exit`).then(r => r.data),
    onSuccess: (d: { data: GateRegistration }) => { invalidate(); setSelected(d.data) },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      alert(e.response?.data?.error?.message ?? 'Lỗi huỷ xác nhận ra'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tms/gate-registrations/${id}`).then(r => r.data),
    onSuccess: () => { invalidate(); setSelected(null) },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      alert(e.response?.data?.error?.message ?? 'Lỗi xóa'),
  })

  // ── Modal helpers
  function openCreate() {
    setEditReg(null)
    setForm({ ...FORM_DEFAULT, date: fDate || TODAY_VN, warehouse_id: fWarehouse })
    setApiError('')
    setModalOpen(true)
  }

  function openEdit(reg: GateRegistration) {
    setEditReg(reg)
    setForm({
      date:             reg.date,
      driver_name:      reg.driver_name ?? '',
      phone:            reg.phone ?? '',
      company_id:       reg.company_id ?? '',
      company_name_raw: reg.company_name_raw ?? '',
      vehicle_id:       reg.vehicle_id ?? '',
      license_plate:    reg.license_plate ?? '',
      direction:        reg.direction ?? '',
      warehouse_id:     reg.warehouse_id,
      warehouse_type:   reg.warehouse_type ?? '',
      vehicle_type:     reg.vehicle_type ?? '',
      content:          reg.content ?? '',
      return_pallet:    reg.return_pallet,
      seal_number:      reg.seal_number ?? '',
      notes:            reg.notes ?? '',
    })
    setApiError('')
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditReg(null)
  }

  function f(k: keyof FormData, v: string | boolean) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  // Dùng cho phase 1 fields — tự clear phase 2 khi phase 1 chưa hoàn thành (chỉ ở create mode)
  function fCriteria(k: keyof FormData, v: string | boolean) {
    setForm(prev => {
      const next = { ...prev, [k]: v }
      if (editReg) return next
      const complete = !!(next.date && next.warehouse_id && next.direction &&
                          next.warehouse_type && next.vehicle_type && next.company_id)
      return complete ? next : { ...next, ...PHASE2_DEFAULT }
    })
  }

  async function handleSubmit() {
    setApiError('')
    const body = {
      date:             form.date,
      driver_name:      form.driver_name || null,
      phone:            form.phone || null,
      company_id:       form.company_id || null,
      company_name_raw: form.company_name_raw || null,
      vehicle_id:       form.vehicle_id || null,
      license_plate:    form.license_plate || null,
      direction:        form.direction || null,
      warehouse_id:     form.warehouse_id,
      warehouse_type:   form.warehouse_type || null,
      vehicle_type:     form.vehicle_type || null,
      content:          form.content || null,
      return_pallet:    form.return_pallet,
      seal_number:      form.seal_number || null,
      notes:            form.notes || null,
    }
    if (editReg) {
      updateMut.mutate({ id: editReg.id, body })
    } else {
      createMut.mutate(body)
    }
  }

  // ── Display helpers
  function companyName(reg: GateRegistration) {
    if (reg.company_id) {
      return companies.find(c => c.id === reg.company_id)?.name ?? reg.company_name_raw ?? '—'
    }
    return reg.company_name_raw ?? '—'
  }

  function warehouseName(id: string) {
    return warehouses.find(w => w.id === id)?.name ?? id
  }

  // ── Action buttons (reused in row + detail)
  function ActionButtons({ reg, size = 'sm' }: { reg: GateRegistration; size?: 'sm' | 'xs' }) {
    const btnCls = size === 'xs'
      ? 'text-[10px] px-1.5 py-0.5 h-auto'
      : 'text-xs px-2 py-1 h-auto'
    return (
      <div className="flex gap-1 flex-wrap">
        {/* Gọi xe */}
        {reg.status === 'REGISTERED' && can(perms, 'gate_registration', 'call') && (
          <Button size="sm" variant="outline"
            className={`${btnCls} border-amber-300 text-amber-700 hover:bg-amber-50`}
            onClick={e => { e.stopPropagation(); setCallTarget(reg); setCallTime(nowVnDatetimeLocal()) }}
          >
            <PhoneCall className="h-3 w-3 mr-1" />Gọi xe
          </Button>
        )}
        {/* Huỷ gọi xe */}
        {reg.status === 'CALLED' && can(perms, 'gate_registration', 'call') && (
          <Button size="sm" variant="ghost"
            className={`${btnCls} text-slate-400 hover:text-red-500`}
            disabled={revertCallMut.isPending}
            title="Huỷ gọi xe"
            onClick={e => { e.stopPropagation(); revertCallMut.mutate(reg.id) }}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        )}
        {/* Xe vào */}
        {(reg.status === 'REGISTERED' || reg.status === 'CALLED') && can(perms, 'gate_registration', 'entry') && (
          <Button size="sm" variant="outline"
            className={`${btnCls} border-green-300 text-green-700 hover:bg-green-50`}
            onClick={e => { e.stopPropagation(); setEntryTarget(reg); setEntryTime(nowVnDatetimeLocal()) }}
          >
            <LogIn className="h-3 w-3 mr-1" />Vào
          </Button>
        )}
        {/* Huỷ xác nhận vào */}
        {reg.status === 'IN' && can(perms, 'gate_registration', 'entry') && (
          <Button size="sm" variant="ghost"
            className={`${btnCls} text-slate-400 hover:text-red-500`}
            disabled={revertEntryMut.isPending}
            title="Huỷ xác nhận vào"
            onClick={e => { e.stopPropagation(); revertEntryMut.mutate(reg.id) }}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        )}
        {/* Xe ra */}
        {reg.status === 'IN' && can(perms, 'gate_registration', 'exit') && (
          <Button size="sm" variant="outline"
            className={`${btnCls} border-blue-300 text-blue-700 hover:bg-blue-50`}
            onClick={e => { e.stopPropagation(); setExitTarget(reg); setExitWeight(''); setExitTime(nowVnDatetimeLocal()) }}
          >
            <LogOut className="h-3 w-3 mr-1" />Ra
          </Button>
        )}
        {/* Huỷ xác nhận ra */}
        {reg.status === 'COMPLETED' && can(perms, 'gate_registration', 'exit') && (
          <Button size="sm" variant="ghost"
            className={`${btnCls} text-slate-400 hover:text-red-500`}
            disabled={revertExitMut.isPending}
            title="Huỷ xác nhận ra"
            onClick={e => { e.stopPropagation(); revertExitMut.mutate(reg.id) }}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        )}
      </div>
    )
  }

  // ── Vehicle options filtered by company
  const vehicleOptions: ComboOption[] = vehicles
    .filter(v => !form.company_id || v.ncc_id === form.company_id)
    .map(v => ({
      value: v.id,
      label: v.license_plate,
      sub:   v.vehicle_type?.name ?? '',
    }))

  const companyOptions: ComboOption[] = companies.map(c => ({
    value: c.id,
    label: c.name,
    sub:   c.code,
  }))

  const vtOptions: ComboOption[] = vehicleTypes.map(vt => ({
    value: vt.name,   // lưu name để khớp với TmsOrder.vehicle_type
    label: vt.name,
  }))

  return (
    <div className="flex flex-col h-full">
      {/* ── Filter bar */}
      <div className="border-b bg-white px-3 py-2 shrink-0">
        {/* Primary filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 shrink-0">Đăng ký cổng</span>

          <div className="flex items-center gap-1">
            <Input
              type="date" value={fDate}
              onChange={e => setFDate(e.target.value)}
              className="text-xs h-7 w-32"
            />
            <span className="text-xs text-slate-400">→</span>
            <Input
              type="date" value={fDateTo}
              onChange={e => setFDateTo(e.target.value)}
              className="text-xs h-7 w-32"
            />
          </div>

          <Select value={fWarehouse || '__all__'} onValueChange={v => setFWarehouse(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-7 text-xs w-36">
              <SelectValue placeholder="Tất cả kho" />
            </SelectTrigger>
            <SelectContent>
              {!allowedWhIds && <SelectItem value="__all__">Tất cả kho</SelectItem>}
              {(allowedWhIds
                ? warehouses.filter((w: { id: string }) => allowedWhIds.has(w.id))
                : warehouses
              ).map((w: { id: string; name: string }) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={fWarehouseType || '__all__'} onValueChange={v => setFWarehouseType(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-7 text-xs w-32">
              <SelectValue placeholder="Loại kho" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả loại kho</SelectItem>
              {whTypes.map((t: { id: string; value: string }) => (
                <SelectItem key={t.id} value={t.value}>{t.value}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Bộ lọc thêm */}
          <Button
            variant="outline" size="sm"
            className={`h-7 text-xs gap-1 ${showMoreFilters || fVehicleType || fCompany || fDirection || fStatus ? 'border-blue-400 text-blue-700 bg-blue-50' : ''}`}
            onClick={() => setShowMoreFilters(v => !v)}
          >
            <SlidersHorizontal className="h-3 w-3" />
            Bộ lọc
            {(fVehicleType || fCompany || fDirection || fStatus) && (
              <span className="ml-0.5 bg-blue-500 text-white rounded-full text-[9px] px-1 leading-none py-0.5">
                {[fVehicleType, fCompany, fDirection, fStatus].filter(Boolean).length}
              </span>
            )}
          </Button>

          <div className="ml-auto">
            {can(perms, 'gate_registration', 'create') && (
              <Button size="sm" className="h-7 text-xs" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5 mr-1" />Thêm
              </Button>
            )}
          </div>
        </div>

        {/* Advanced filters */}
        {showMoreFilters && (
          <div className="flex items-center gap-2 flex-wrap mt-2 pt-2 border-t">
            <Select value={fVehicleType || '__all__'} onValueChange={v => setFVehicleType(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-7 text-xs w-32">
                <SelectValue placeholder="Loại xe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Tất cả loại xe</SelectItem>
                {vehicleTypes.map(vt => (
                  <SelectItem key={vt.id} value={vt.name}>{vt.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={fCompany || '__all__'} onValueChange={v => setFCompany(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-7 text-xs w-36">
                <SelectValue placeholder="ĐVVT/NCC" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Tất cả ĐVVT</SelectItem>
                {companies.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={fDirection || '__all__'} onValueChange={v => setFDirection(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-7 text-xs w-24">
                <SelectValue placeholder="Hướng" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Cả hai</SelectItem>
                <SelectItem value="OUTBOUND">Xuất</SelectItem>
                <SelectItem value="INBOUND">Nhập</SelectItem>
              </SelectContent>
            </Select>

            <Select value={fStatus || '__all__'} onValueChange={v => setFStatus(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-7 text-xs w-32">
                <SelectValue placeholder="Trạng thái" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Tất cả TT</SelectItem>
                <SelectItem value="REGISTERED">Đã đăng ký</SelectItem>
                <SelectItem value="CALLED">Đã gọi xe</SelectItem>
                <SelectItem value="IN">Đang trong</SelectItem>
                <SelectItem value="COMPLETED">Đã ra</SelectItem>
              </SelectContent>
            </Select>

            <button
              className="text-[10px] text-slate-400 hover:text-red-500 underline"
              onClick={() => { setFVehicleType(''); setFCompany(''); setFDirection(''); setFStatus('') }}
            >
              Xóa bộ lọc
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="flex gap-3 mt-1.5">
          {(['REGISTERED','CALLED','IN','COMPLETED'] as GateStatus[]).map(s => {
            const count = regs.filter(r => r.status === s).length
            return (
              <span key={s} className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_BADGE[s]}`}>
                {STATUS_LABEL[s]}: {count}
              </span>
            )
          })}
        </div>
      </div>

      {/* ── Main area: table */}
      <div className="flex flex-1 min-h-0 gap-3 p-3 overflow-hidden">

        {/* Table */}
        <Card className="flex-1 min-w-0 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />Đang tải...
            </div>
          ) : regs.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-slate-400">
              Không có dữ liệu
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 w-8 whitespace-nowrap">#</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Ngày</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Kho</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 w-14 whitespace-nowrap">Hướng</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Loại kho</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Loại xe</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Nội dung</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Booking</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">ĐVVT</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Biển số</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Lái xe</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">SĐT</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Ghi chú</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 w-14 whitespace-nowrap">Giờ ĐK</TableHead>
                    <TableHead className="text-[9px] font-medium px-2 py-1.5 w-14 whitespace-nowrap" style={{ color: '#E85AA0' }}>Giờ gọi</TableHead>
                    <TableHead className="text-[9px] font-medium px-2 py-1.5 w-14 whitespace-nowrap" style={{ color: '#D8891C' }}>Giờ vào</TableHead>
                    <TableHead className="text-[9px] font-medium px-2 py-1.5 w-14 whitespace-nowrap" style={{ color: '#4A90D9' }}>Giờ ra</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 w-20 whitespace-nowrap">TT</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-1 py-1.5 w-40"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {regs.map(reg => (
                    <TableRow
                      key={reg.id}
                      className={`cursor-pointer ${ROW_COLOR[reg.status]} ${selected?.id === reg.id ? 'ring-1 ring-inset ring-blue-400' : ''}`}
                      onClick={() => setSelected(prev => prev?.id === reg.id ? null : reg)}
                    >
                      <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold text-slate-500 whitespace-nowrap">
                        {reg.registration_number}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">{fmtDate(reg.date)}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{warehouseName(reg.warehouse_id)}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                        {reg.direction === 'OUTBOUND'
                          ? <span className="flex items-center gap-0.5 text-orange-600"><ArrowRight className="h-3 w-3" />Xuất</span>
                          : reg.direction === 'INBOUND'
                          ? <span className="flex items-center gap-0.5 text-blue-600"><ArrowLeft className="h-3 w-3" />Nhập</span>
                          : '—'}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">{reg.warehouse_type ?? '—'}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">{reg.vehicle_type ?? '—'}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          {reg.return_pallet && <Package className="h-3 w-3 text-blue-500 shrink-0" />}
                          <span>{reg.content ?? '—'}</span>
                          {reg.priority && <Star className="h-2.5 w-2.5 text-amber-500 fill-amber-500 shrink-0" />}
                        </span>
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                        {reg.booking_order_code
                          ? <div>
                              <div className="font-mono font-semibold text-slate-700">{reg.booking_order_code}</div>
                              {(reg.booking_slot_from || reg.booking_slot_to) && (
                                <div className="text-slate-400">{reg.booking_slot_from}–{reg.booking_slot_to}</div>
                              )}
                            </div>
                          : <span className="text-slate-300">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">{companyName(reg)}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{reg.license_plate ?? '—'}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{reg.driver_name ?? '—'}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{reg.phone ?? '—'}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] text-slate-400 whitespace-nowrap">{reg.notes ?? '—'}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">{fmtTime(reg.registered_at)}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-medium" style={{ color: '#E85AA0' }}>{fmtTime(reg.called_at)}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-medium" style={{ color: '#D8891C' }}>{fmtTime(reg.entry_at)}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-medium" style={{ color: '#4A90D9' }}>{fmtTime(reg.exit_at)}</TableCell>
                      <TableCell className="px-2 py-1 whitespace-nowrap">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_BADGE[reg.status]}`}>
                          {STATUS_LABEL[reg.status]}
                        </span>
                      </TableCell>
                      <TableCell className="px-1 py-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <ActionButtons reg={reg} size="xs" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

      </div>

      {/* Detail dialog — overlay, không ảnh hưởng layout bảng */}
      <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null) }}>
        <DialogContent className="max-w-sm p-0 overflow-hidden">
          <DialogTitle className="sr-only">Chi tiết đăng ký cổng</DialogTitle>
          {selected && (
            <div className="p-4 space-y-2 text-xs max-h-[80vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-semibold text-slate-700">#{selected.registration_number}</span>
                {selected.priority && <Star className="h-3 w-3 text-amber-500 fill-amber-500" />}
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_BADGE[selected.status]}`}>
                  {STATUS_LABEL[selected.status]}
                </span>
                <div className="ml-auto flex gap-2">
                  {can(perms, 'gate_registration', 'edit') && (
                    <Button size="sm" variant="outline"
                      className="h-6 px-2 text-[10px] gap-1"
                      onClick={() => { setSelected(null); openEdit(selected) }}
                    >
                      <Pencil className="h-3 w-3" />Sửa
                    </Button>
                  )}
                  {can(perms, 'gate_registration', 'delete') && (
                    <Button size="sm" variant="outline"
                      className="h-6 px-2 text-[10px] gap-1 border-red-200 text-red-600 hover:bg-red-50"
                      onClick={() => { if (confirm('Xóa đăng ký này?')) { deleteMut.mutate(selected.id); setSelected(null) } }}
                    >
                      <Trash2 className="h-3 w-3" />Xóa
                    </Button>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <ActionButtons reg={selected} size="sm" />

              <div className="border-t pt-2 space-y-1.5">
                <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Kho & Hàng</p>
                <div><span className="text-slate-400">Kho:</span> <span className="font-medium">{warehouseName(selected.warehouse_id)}</span></div>
                <div>
                  <span className="text-slate-400">Hướng:</span>
                  {selected.direction === 'OUTBOUND'
                    ? <span className="ml-1 text-orange-600 font-medium">Xuất</span>
                    : selected.direction === 'INBOUND'
                    ? <span className="ml-1 text-blue-600 font-medium">Nhập</span>
                    : ' —'}
                </div>
                {selected.warehouse_type && <div><span className="text-slate-400">Loại kho:</span> <span>{selected.warehouse_type}</span></div>}
                {selected.content && <div><span className="text-slate-400">Nội dung:</span> <span>{selected.content}</span></div>}
                {selected.seal_number && <div><span className="text-slate-400">Niêm phong:</span> <span className="font-mono">{selected.seal_number}</span></div>}
                {selected.load_capacity != null && (
                  <div><span className="text-slate-400">Tải trọng:</span> <span className="font-semibold">{selected.load_capacity} tấn</span></div>
                )}
              </div>

              <div className="border-t pt-2 space-y-1.5">
                <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Xe & Lái xe</p>
                <div><span className="text-slate-400">Loại xe:</span> <span>{selected.vehicle_type ?? '—'}</span></div>
                <div><span className="text-slate-400">ĐVVT:</span> <span className="font-medium">{companyName(selected)}</span></div>
                <div><span className="text-slate-400">Biển số:</span> <span className="font-mono font-semibold">{selected.license_plate ?? '—'}</span></div>
                <div><span className="text-slate-400">Lái xe:</span> <span className="font-medium">{selected.driver_name ?? '—'}</span></div>
                <div className="flex items-center gap-1">
                  <span className="text-slate-400">SĐT:</span>
                  {selected.phone
                    ? <a href={`tel:${selected.phone}`} className="flex items-center gap-1 text-blue-600 font-medium hover:underline">
                        <Phone className="h-3 w-3" />{selected.phone}
                      </a>
                    : <span className="text-slate-400">—</span>}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-slate-400">Trả pallet:</span>
                  {selected.return_pallet
                    ? <span className="flex items-center gap-1 text-blue-600"><Package className="h-3 w-3" />Có</span>
                    : <span className="text-slate-400">Không</span>}
                </div>
              </div>

              {selected.booking_order_code && (
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Booking</p>
                  <div><span className="text-slate-400">Mã đơn:</span> <span className="font-mono font-semibold text-[10px] break-all">{selected.booking_order_code}</span></div>
                  {(selected.booking_slot_from || selected.booking_slot_to) && (
                    <div><span className="text-slate-400">Khung giờ:</span> <span className="font-semibold">{selected.booking_slot_from}–{selected.booking_slot_to}</span></div>
                  )}
                  {selected.booking_npp_names && (
                    <div><span className="text-slate-400">NPP:</span> <span>{selected.booking_npp_names}</span></div>
                  )}
                  {selected.booking_gdo_refs && (
                    <div><span className="text-slate-400">GDO Refs:</span> <span className="font-mono text-[10px] break-all">{selected.booking_gdo_refs}</span></div>
                  )}
                  {(selected.booking_planned_boxes || selected.booking_planned_pallets) && (
                    <div className="flex gap-3">
                      {selected.booking_planned_boxes && (
                        <span><span className="text-slate-400">Thùng:</span> <span className="font-semibold">{selected.booking_planned_boxes}</span></span>
                      )}
                      {selected.booking_planned_pallets && (
                        <span><span className="text-slate-400">Pallet:</span> <span className="font-semibold">{selected.booking_planned_pallets}</span></span>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="border-t pt-2 space-y-1.5">
                <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Thời gian</p>
                {selected.registered_at && (
                  <div>
                    <div className="text-slate-400">Đăng ký:</div>
                    <div>{formatDateTime(selected.registered_at)}</div>
                    {selected.registered_by && <div className="text-slate-400">{selected.registered_by}</div>}
                  </div>
                )}
                {selected.called_at && (
                  <div>
                    <div className="text-slate-400">Gọi xe:</div>
                    <div>{formatDateTime(selected.called_at)}</div>
                    {selected.called_by && <div className="text-slate-400">{selected.called_by}</div>}
                  </div>
                )}
                {selected.entry_at && (
                  <div>
                    <div className="text-slate-400">Xe vào:</div>
                    <div>{formatDateTime(selected.entry_at)}</div>
                    {selected.entry_by && <div className="text-slate-400">{selected.entry_by}</div>}
                  </div>
                )}
                {selected.exit_at && (
                  <div>
                    <div className="text-slate-400">Xe ra:</div>
                    <div>{formatDateTime(selected.exit_at)}</div>
                    {selected.exit_by && <div className="text-slate-400">{selected.exit_by}</div>}
                  </div>
                )}
              </div>

              {selected.notes && (
                <div className="border-t pt-2">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Ghi chú</p>
                  <p className="text-slate-600">{selected.notes}</p>
                </div>
              )}

              <div className="border-t pt-2 space-y-1.5">
                <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Audit</p>
                <div><span className="text-slate-400">Người tạo:</span> <span>{selected.created_by ?? '—'}</span></div>
                <div><span className="text-slate-400">Tạo lúc:</span> <span>{formatDateTime(selected.created_at)}</span></div>
                <div><span className="text-slate-400">Người sửa:</span> <span>{selected.updated_by ?? '—'}</span></div>
                <div><span className="text-slate-400">Sửa lúc:</span> <span>{formatDateTime(selected.updated_at)}</span></div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Create / Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={v => { if (!v) closeModal() }}>
        <DialogContent className="w-[90vw] max-w-3xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-4 pt-4 pb-2 border-b shrink-0">
            <DialogTitle className="text-sm">
              {editReg ? `Sửa đăng ký #${editReg.registration_number}` : 'Thêm đăng ký xe'}
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 px-4 py-3 space-y-4">
            {apiError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded px-3 py-2">{apiError}</div>
            )}

            {/* Row 1: Ngày + Kho */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Ngày <span className="text-red-500">*</span></label>
                <Input type="date" value={form.date} onChange={e => fCriteria('date', e.target.value)} className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Kho <span className="text-red-500">*</span></label>
                <Select value={form.warehouse_id || '__none__'} onValueChange={v => fCriteria('warehouse_id', v === '__none__' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Chọn kho" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Chọn kho —</SelectItem>
                    {(allowedWhIds
                      ? warehouses.filter((w: { id: string }) => allowedWhIds.has(w.id))
                      : warehouses
                    ).map((w: { id: string; name: string }) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 2: Hướng + Loại kho */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Hướng</label>
                <Select value={form.direction || '__none__'} onValueChange={v => fCriteria('direction', v === '__none__' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Chọn hướng" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Chưa xác định</SelectItem>
                    <SelectItem value="OUTBOUND">Xuất (OUTBOUND)</SelectItem>
                    <SelectItem value="INBOUND">Nhập (INBOUND)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Loại kho</label>
                <Select value={form.warehouse_type || '__none__'} onValueChange={v => fCriteria('warehouse_type', v === '__none__' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Chọn loại kho" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Không chọn —</SelectItem>
                    {whTypes.map((t: { id: string; value: string }) => (
                      <SelectItem key={t.id} value={t.value}>{t.value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 3: Loại xe + ĐVVT */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Loại xe</label>
                <ComboField
                  value={form.vehicle_type}
                  displayValue={vtOptions.find(v => v.value === form.vehicle_type)?.label ?? form.vehicle_type}
                  options={vtOptions}
                  placeholder="Tìm loại xe"
                  onSelect={opt => fCriteria('vehicle_type', opt.value)}
                  onClear={() => fCriteria('vehicle_type', '')}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">ĐVVT / NCC</label>
                <ComboField
                  value={form.company_id}
                  displayValue={companies.find(c => c.id === form.company_id)?.name ?? form.company_name_raw}
                  options={companyOptions}
                  placeholder="Tìm ĐVVT"
                  onSelect={opt => setForm(prev => {
                    const next = { ...prev, company_id: opt.value, company_name_raw: opt.label, vehicle_id: '', license_plate: '' }
                    if (editReg) return next
                    const complete = !!(next.date && next.warehouse_id && next.direction && next.warehouse_type && next.vehicle_type && next.company_id)
                    return complete ? next : { ...next, ...PHASE2_DEFAULT }
                  })}
                  onClear={() => setForm(prev => ({
                    ...prev, company_id: '', company_name_raw: '',
                    ...(editReg ? {} : PHASE2_DEFAULT),
                  }))}
                />
                {!form.company_id && (
                  <Input
                    className="text-xs h-8 mt-1"
                    placeholder="Hoặc nhập tên ĐVVT tự do"
                    value={form.company_name_raw}
                    onChange={e => f('company_name_raw', e.target.value)}
                  />
                )}
              </div>
            </div>

            {/* Phase 2 — chỉ hiện khi phase 1 đủ 6 tiêu chí, hoặc đang edit */}
            {(phase1Complete || !!editReg) && (
              <>
                {/* Row 4: Biển số + Nội dung */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">Biển số xe <span className="text-red-500">*</span></label>
                    <ComboField
                      value={form.vehicle_id}
                      displayValue={vehicles.find(v => v.id === form.vehicle_id)?.license_plate ?? form.license_plate}
                      options={vehicleOptions}
                      placeholder="Tìm xe"
                      onSelect={opt => setForm(prev => ({ ...prev, vehicle_id: opt.value, license_plate: opt.label }))}
                      onClear={() => setForm(prev => ({ ...prev, vehicle_id: '', license_plate: '' }))}
                    />
                    {!form.vehicle_id && (
                      <Input
                        className="text-xs h-8 mt-1 font-mono"
                        placeholder="Hoặc nhập biển số tự do"
                        value={form.license_plate}
                        onChange={e => f('license_plate', e.target.value.toUpperCase())}
                      />
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">Nội dung vào ra <span className="text-red-500">*</span></label>
                    <Input className="text-xs h-8" value={form.content} onChange={e => f('content', e.target.value)} placeholder="Vào lấy hàng, giao hàng..." />
                  </div>
                </div>

                {/* Row 5: Lái xe + SĐT */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">Họ và tên lái xe <span className="text-red-500">*</span></label>
                    <Input className="text-xs h-8" value={form.driver_name} onChange={e => f('driver_name', e.target.value)} placeholder="Nguyễn Văn A" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">Số điện thoại <span className="text-red-500">*</span></label>
                    <Input type="tel" className="text-xs h-8" value={form.phone} onChange={e => f('phone', e.target.value)} placeholder="0909..." />
                  </div>
                </div>

                {/* Row 6: Niêm phong + Ghi chú */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">Số niêm phong</label>
                    <Input className="text-xs h-8 font-mono" value={form.seal_number} onChange={e => f('seal_number', e.target.value)} placeholder="SP123456" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">Ghi chú</label>
                    <Input className="text-xs h-8" value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Ghi chú thêm..." />
                  </div>
                </div>

                {/* Row 7: Trả pallet */}
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.return_pallet}
                      onChange={e => f('return_pallet', e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                    />
                    <div className="flex items-center gap-1 text-xs">
                      <Package className="h-3.5 w-3.5 text-blue-500" />
                      Trả pallet
                    </div>
                  </label>
                  {suggestions[0]?.priority && (
                    <div className="flex items-center gap-1 text-xs text-amber-600">
                      <Star className="h-3.5 w-3.5 fill-amber-500" />
                      Ưu tiên (từ Kế hoạch VC)
                    </div>
                  )}
                </div>

                {/* Booking dự kiến — chỉ đọc, do server tính theo vị trí */}
                <div className="border rounded-lg p-3 space-y-1.5 bg-slate-50">
                  <p className="text-xs font-medium text-slate-600">Booking dự kiến (tự động theo vị trí)</p>
                  {!suggestEnabled ? (
                    <p className="text-[10px] text-slate-400">Điền Biển số để xem booking dự kiến</p>
                  ) : suggestLoading ? (
                    <span className="flex items-center gap-1 text-[10px] text-slate-400">
                      <Loader2 className="h-3 w-3 animate-spin" />Đang tìm...
                    </span>
                  ) : suggestions[0] ? (
                    <div className="bg-green-50 border border-green-200 rounded px-2 py-1.5 text-xs space-y-0.5">
                      <div>
                        <span className="font-mono font-semibold text-green-700">{suggestions[0].order_code}</span>
                        {(suggestions[0].booking_slot_from || suggestions[0].booking_slot_to) && (
                          <span className="ml-2 text-green-600">{suggestions[0].booking_slot_from}–{suggestions[0].booking_slot_to}</span>
                        )}
                      </div>
                      <div className="text-slate-500 flex flex-wrap gap-x-3">
                        {suggestions[0].planned_boxes && <span>{suggestions[0].planned_boxes} thùng</span>}
                        {suggestions[0].planned_pallets && <span>{suggestions[0].planned_pallets} pallet</span>}
                        {suggestions[0].npp_names && <span>{suggestions[0].npp_names}</span>}
                        {suggestions[0].gdo_refs && <span className="font-mono">{suggestions[0].gdo_refs}</span>}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-400">Không tìm thấy booking phù hợp</p>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter className="px-4 py-3 border-t shrink-0">
            <Button variant="outline" size="sm" onClick={closeModal}>Hủy</Button>
            <Button
              size="sm"
              disabled={
                createMut.isPending || updateMut.isPending ||
                !form.date || !form.warehouse_id || !form.direction ||
                !form.warehouse_type || !form.vehicle_type || !form.company_id ||
                !form.license_plate || !form.content || !form.driver_name || !form.phone
              }
              onClick={handleSubmit}
            >
              {(createMut.isPending || updateMut.isPending)
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Đang lưu...</>
                : (editReg ? 'Cập nhật' : 'Tạo đăng ký')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Gọi xe */}
      <Dialog open={!!callTarget} onOpenChange={v => { if (!v) setCallTarget(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Gọi xe vào</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm">Xác nhận gọi xe <span className="font-mono font-semibold">{callTarget?.license_plate}</span>?</p>
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Giờ gọi xe</label>
              <Input type="datetime-local" value={callTime} onChange={e => setCallTime(e.target.value)} className="text-xs h-8" />
            </div>
            <p className="text-xs text-amber-600">Bảo vệ có thể bỏ qua bước này và bấm thẳng "Xe vào".</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCallTarget(null)}>Hủy</Button>
            <Button
              size="sm"
              className="bg-amber-500 hover:bg-amber-600"
              disabled={callMut.isPending}
              onClick={() => callTarget && callMut.mutate({
                id: callTarget.id,
                custom_time: callTime ? new Date(callTime + ':00+07:00').toISOString() : undefined,
              })}
            >
              {callMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><PhoneCall className="h-3.5 w-3.5 mr-1" />Gọi xe</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Xác nhận vào */}
      <Dialog open={!!entryTarget} onOpenChange={v => { if (!v) setEntryTarget(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Xác nhận xe vào</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm">Xe <span className="font-mono font-semibold">{entryTarget?.license_plate}</span> đã vào kho?</p>
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Giờ vào</label>
              <Input type="datetime-local" value={entryTime} onChange={e => setEntryTime(e.target.value)} className="text-xs h-8" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEntryTarget(null)}>Hủy</Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              disabled={entryMut.isPending}
              onClick={() => entryTarget && entryMut.mutate({
                id: entryTarget.id,
                custom_time: entryTime ? new Date(entryTime + ':00+07:00').toISOString() : undefined,
              })}
            >
              {entryMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><LogIn className="h-3.5 w-3.5 mr-1" />Xác nhận vào</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Xác nhận ra + Tải trọng */}
      <Dialog open={!!exitTarget} onOpenChange={v => { if (!v) { setExitTarget(null); setExitWeight('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Xác nhận xe ra</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm">Xe <span className="font-mono font-semibold">{exitTarget?.license_plate}</span> đã ra khỏi kho?</p>
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Giờ ra</label>
              <Input type="datetime-local" value={exitTime} onChange={e => setExitTime(e.target.value)} className="text-xs h-8" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Tải trọng (tấn) — tuỳ chọn</label>
              <Input
                type="number" step="0.001"
                className="text-xs h-8"
                placeholder="VD: 12.5"
                value={exitWeight}
                onChange={e => setExitWeight(e.target.value)}
              />
              <p className="text-[10px] text-slate-400">Điền theo phiếu cân của lái xe. Có thể bỏ qua và điền sau.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setExitTarget(null); setExitWeight('') }}>Hủy</Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
              disabled={exitMut.isPending}
              onClick={() => exitTarget && exitMut.mutate({
                id: exitTarget.id,
                load_capacity: exitWeight || undefined,
                custom_time: exitTime ? new Date(exitTime + ':00+07:00').toISOString() : undefined,
              })}
            >
              {exitMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><LogOut className="h-3.5 w-3.5 mr-1" />Xác nhận ra</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
