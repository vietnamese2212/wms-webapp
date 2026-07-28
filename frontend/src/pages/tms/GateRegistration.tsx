import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { useWarehouses, useWarehouseTypes, useVehicleTypesByWarehouse } from '@/api/hooks'
import { useScopedWhTypes } from '@/hooks/useUserScope'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDateTime, normalizeLicensePlate, normalizePhone } from '@/utils/formatters'
import type { GateRegistration, GateStatus, BookingSuggestion, TransportCompany, TmsVehicle, TmsVehicleType } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { FormSheet } from '@/components/shared/FormSheet'
import { usePopoverAnchor } from '@/components/shared/usePopoverAnchor'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/use-toast'
import {
  X, Plus, Pencil, Trash2, PhoneCall,
  LogIn, LogOut, Star, Package, ArrowRight, ArrowLeft,
  ChevronDown, ChevronRight, Loader2, Phone, RotateCcw,
  HelpCircle, XCircle, ChevronsDownUp, ChevronsUpDown,
} from 'lucide-react'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { SavedViews } from '@/components/shared/SavedViews'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { ListErrorBanner } from '@/components/shared/ListErrorBanner'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { Rows3, AlignJustify } from 'lucide-react'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Render field có thể chứa '\n' (multi-order) thành nhiều dòng riêng biệt
function renderOrderField(value: string | null | undefined, mono = false) {
  if (!value) return <span className="text-slate-300">—</span>
  const parts = value.split('\n')
  if (parts.length <= 1) return <span className={`block truncate ${mono ? 'font-mono font-semibold' : ''}`} title={value}>{value || <span className="text-slate-300">—</span>}</span>
  return (
    <div className={`divide-y divide-slate-100 ${mono ? 'font-mono font-semibold' : ''}`} title={parts.join(', ')}>
      {parts.map((p, i) => (
        <div key={i} className={`truncate ${i > 0 ? 'pt-0.5' : ''}`}>
          {p || <span className="text-slate-300 font-normal">—</span>}
        </div>
      ))}
    </div>
  )
}

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

const ROW_TEXT: Record<GateStatus, string> = {
  REGISTERED: 'hover:bg-slate-50',
  CALLED:     'text-[#E85AA0] hover:bg-slate-50',
  IN:         'text-[#D8891C] hover:bg-slate-50',
  COMPLETED:  'text-[#4A90D9] line-through hover:bg-slate-50',
}

const TODAY_VN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

// Loại xe đặc biệt — KHÔNG gắn booking (không có TmsOrder nào mang loại xe này nên
// suggest/relink tự lọc ra rỗng). Luôn xếp CUỐI trong cây.
const SPECIAL_VTYPES = ['Chỉ trả pallet', 'Khác']

// Nhãn nhóm khi thiếu loại kho/loại xe — dùng CHUNG cho buildRenderList + allGroupKeys (key phải khớp)
const WT_FALLBACK = '— Chưa rõ loại kho —'
const VT_FALLBACK = '— Chưa rõ loại xe —'

// Cột bảng đăng ký cổng — số phần tử PHẢI khớp số <TableCell> mỗi dòng (22 cột)
const GATE_COLS: { id: string; label: string; w: number; align?: 'right' }[] = [
  { id: 'num',     label: '#',         w: 40 },
  { id: 'date',    label: 'Ngày',      w: 90 },
  { id: 'dir',     label: 'Hướng',     w: 64 },
  { id: 'vtype',   label: 'Loại xe',   w: 90 },
  { id: 'content', label: 'Nội dung',  w: 120 },
  { id: 'booking', label: 'Booking',   w: 110 },
  { id: 'order',   label: 'Mã đơn',    w: 120 },
  { id: 'npp',     label: 'NPP',       w: 140 },
  { id: 'gdo',     label: 'GDO',       w: 110 },
  { id: 'company', label: 'ĐVVT',      w: 120 },
  { id: 'plate',   label: 'Biển số',   w: 100 },
  { id: 'driver',  label: 'Lái xe',    w: 110 },
  { id: 'phone',   label: 'SĐT',       w: 100 },
  { id: 'notes',   label: 'Ghi chú',   w: 120 },
  { id: 'tReg',    label: 'Giờ ĐK',    w: 60 },
  { id: 'tCall',   label: 'Giờ gọi',   w: 60 },
  { id: 'tIn',     label: 'Giờ vào',   w: 60 },
  { id: 'tOut',    label: 'Giờ ra',    w: 60 },
  { id: 'wh',      label: 'Kho',       w: 120 },
  { id: 'whType',  label: 'Loại kho',  w: 100 },
  { id: 'status',  label: 'TT',        w: 90 },
  { id: 'actions', label: '',          w: 160 },
]


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

// Icon trạng thái booking: ? nếu đang trong giờ chưa vào, X đỏ nếu đã qua giờ chưa vào
function bookingIcon(reg: GateRegistration) {
  if (!reg.booking_slot_from || ['IN', 'COMPLETED'].includes(reg.status)) return null
  const now = Date.now()
  const slotFrom = new Date(`${reg.date}T${reg.booking_slot_from}+07:00`).getTime()
  const slotTo   = reg.booking_slot_to
    ? new Date(`${reg.date}T${reg.booking_slot_to}+07:00`).getTime()
    : slotFrom + 3600_000
  if (now > slotTo)    return <XCircle   className="h-3 w-3 text-red-500 shrink-0 inline-block" />
  if (now >= slotFrom) return <HelpCircle className="h-3 w-3 text-red-500 shrink-0 inline-block" />
  return null
}

// ─── Combobox (dùng trong modal — không bị overflow clip) ────────────────────

interface ComboOption { value: string; label: string; sub?: string }

function ComboField({
  value, displayValue, options, placeholder, loading,
  onSelect, onClear,
  freetextMode, freeTextValue, onFreeText,
}: {
  value: string
  displayValue: string
  options: ComboOption[]
  placeholder?: string
  loading?: boolean
  onSelect: (opt: ComboOption) => void
  onClear: () => void
  freetextMode?: boolean
  freeTextValue?: string
  onFreeText?: (text: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLDivElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  const didOpenRef = useRef(false)
  const anchor = usePopoverAnchor(triggerRef, open, 200)

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase()) ||
    (o.sub ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // Text hiển thị khi dropdown đóng (freetext mode)
  const closedText = value ? displayValue : (freeTextValue ?? '')

  useEffect(() => {
    if (!open) {
      // Chỉ commit khi dropdown đã được mở rồi đóng — không chạy lúc initial mount
      if (didOpenRef.current && freetextMode && !value && onFreeText) onFreeText(search)
      didOpenRef.current = false
      setSearch('')
      return
    }
    didOpenRef.current = true
    const handleMouseDown = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        portalRef.current?.contains(e.target as Node)
      ) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open])

  return (
    <div className="relative" ref={triggerRef}>
      <div className="flex gap-1">
        <div className="relative flex-1">
          {freetextMode ? (
            <Input
              className="text-xs h-8"
              placeholder={placeholder ?? 'Tìm hoặc nhập...'}
              value={open ? search : closedText}
              onChange={e => { setSearch(e.target.value); if (!open) setOpen(true) }}
              onFocus={() => { setSearch(closedText); setOpen(true) }}
              // Enter/Tab/blur đều đóng dropdown → effect open→false commit free-text (trước đây chỉ click ra ngoài mới commit)
              onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); setOpen(false) } }}
              onBlur={() => setOpen(false)}
            />
          ) : open ? (
            <Input
              autoFocus
              className="text-xs h-8"
              placeholder={`Tìm ${placeholder ?? ''}...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
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
        {(value || (freetextMode && freeTextValue)) && (
          <button type="button" onClick={onClear} className="text-slate-400 hover:text-slate-600">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && anchor && createPortal(
        <div
          ref={portalRef}
          data-combofield-portal=""
          style={{ ...anchor.style, zIndex: 9999, pointerEvents: 'auto' }}
          className="bg-white border rounded-md shadow-lg max-h-44 overflow-auto"
          onWheel={e => e.stopPropagation()}
          onTouchMove={e => e.stopPropagation()}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">
              {freetextMode ? 'Không có kết quả — nhập tự do sẽ được lưu' : 'Không có kết quả'}
            </div>
          ) : (
            filtered.map(o => (
              <button
                key={o.value}
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 flex flex-col"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onSelect(o); setOpen(false) }}
              >
                <span className="font-medium">{o.label}</span>
                {o.sub && <span className="text-slate-400 text-[10px]">{o.sub}</span>}
              </button>
            ))
          )}
        </div>,
        anchor.target
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

// Chân thứ 2 (Xuất) của xe "kết hợp" — chỉ dùng khi Hướng = 'BOTH' (sentinel form, KHÔNG lưu DB).
// Trường dùng chung (ngày/kho/Loại kho/biển số/lái xe/SĐT) lấy từ `form`; chỉ các trường này khác chân.
type LegData = {
  vehicle_type: string; company_id: string; company_name_raw: string
  content: string; return_pallet: boolean; seal_number: string; notes: string
}
const LEG_DEFAULT: LegData = {
  vehicle_type: '', company_id: '', company_name_raw: '',
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

  // ── Filters (persisted via wmsFilterStore)
  const { gateRegistration: grf, setGateRegistration } = useWmsFilterStore()
  const fDate          = grf.fDate          || TODAY_VN
  const fDateTo        = grf.fDateTo        || TODAY_VN
  const fWarehouse     = grf.fWarehouse
  const fWarehouseType = grf.fWarehouseType
  const fVehicleTypes  = grf.fVehicleTypes
  const fCompany       = grf.fCompany
  const fDirection     = grf.fDirection
  const fStatus        = grf.fStatus
  const setFDate          = (v: string)   => setGateRegistration({ fDate: v })
  const setFDateTo        = (v: string)   => setGateRegistration({ fDateTo: v })
  const setFWarehouse     = (v: string)   => setGateRegistration({ fWarehouse: v })
  const setFWarehouseType = (v: string)   => setGateRegistration({ fWarehouseType: v })
  const setFVehicleTypes  = (v: string[]) => setGateRegistration({ fVehicleTypes: v })
  const setFCompany       = (v: string)   => setGateRegistration({ fCompany: v })
  const setFDirection     = (v: string)   => setGateRegistration({ fDirection: v })
  const setFStatus        = (v: string)   => setGateRegistration({ fStatus: v })
  const [dense, setDense] = useState(() => localStorage.getItem('gate_density') !== 'comfortable')
  function toggleDensity() {
    setDense(d => { localStorage.setItem('gate_density', d ? 'comfortable' : 'compact'); return !d })
  }

  // Trạng thái gập/mở nhóm cây (Kho → Loại kho → Loại xe) — nhớ riêng từng user
  const collapseKey = `gate_tree_collapsed:${user?.id ?? 'anon'}`
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { const raw = localStorage.getItem(collapseKey); return raw ? new Set<string>(JSON.parse(raw)) : new Set() }
    catch { return new Set() }
  })
  function toggleGroup(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      try { localStorage.setItem(collapseKey, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  // Auto-set warehouse for single-warehouse users on first visit
  useEffect(() => {
    if (!grf.fWarehouse && allowedWhIds && allowedWhIds.size === 1) {
      setGateRegistration({ fWarehouse: [...allowedWhIds][0] })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Selection + Modal
  const [selected,   setSelected]   = useState<GateRegistration | null>(null)
  const [modalOpen,  setModalOpen]  = useState(false)
  const [editReg,    setEditReg]    = useState<GateRegistration | null>(null)
  const [form,       setForm]       = useState<FormData>(FORM_DEFAULT)
  const [outLeg,     setOutLeg]     = useState<LegData>(LEG_DEFAULT)   // chân Xuất khi đăng ký kết hợp

  // ── Action dialogs
  const [callTarget,  setCallTarget]  = useState<GateRegistration | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GateRegistration | null>(null)
  const [entryTarget, setEntryTarget] = useState<GateRegistration | null>(null)
  const [exitTarget,  setExitTarget]  = useState<GateRegistration | null>(null)
  const [exitWeight,  setExitWeight]  = useState('')
  const [callTime,  setCallTime]  = useState('')
  const [entryTime, setEntryTime] = useState('')
  const [exitTime,  setExitTime]  = useState('')

  const [apiError, setApiError] = useState('')

  // ── Queries
  const params: Record<string, string> = {}
  if (fDate && !fDateTo)  params.date      = fDate
  if (fDate && fDateTo)   params.date_from = fDate
  if (fDateTo)            params.date_to   = fDateTo
  if (fWarehouse)     params.warehouse_id   = fWarehouse
  if (fWarehouseType) params.warehouse_type = fWarehouseType
  if (fCompany)       params.company_id     = fCompany
  if (fDirection)     params.direction      = fDirection
  if (fStatus)        params.status         = fStatus

  // gửi MẢNG (axios → vehicle_types[]=…): tên loại xe có thể chứa dấu phẩy nên không nối CSV
  const treeParams: Record<string, string | string[]> = { ...params }
  if (fVehicleTypes.length) treeParams.vehicle_types = fVehicleTypes

  // ── CÂY LƯỜI (user chốt 28/07): thống kê nhóm tải trước (nhẹ), DÒNG chi tiết cuộn tới đâu tải
  // tới đó. Trước đây tải HẾT mọi lượt đăng ký rồi mới dựng cây ở máy — kéo rộng khoảng ngày là
  // hàng chục nghìn dòng (trang chết hẳn ở trần 10.000).
  type TreeNode = { wh: string; wt: string | null; vt: string | null; total: number; done: number; inside: number; waiting: number }
  const { data: tree, isLoading: treeLoading, error: listErr } = useQuery<{ nodes: TreeNode[]; totals: { total: number; done: number; inside: number; waiting: number } }>({
    queryKey: ['gate-tree', treeParams],
    queryFn: () => apiClient.get('/tms/gate-registrations/tree', { params: treeParams }).then(r => r.data.data),
  })
  const treeNodes = useMemo(() => tree?.nodes ?? [], [tree])
  const totals = tree?.totals ?? { total: 0, done: 0, inside: 0, waiting: 0 }
  const expandAll  = () => { setCollapsed(new Set()); try { localStorage.setItem(collapseKey, '[]') } catch { /* ignore */ } }
  const collapseAll = () => { const all = new Set(allGroupKeys); setCollapsed(all); try { localStorage.setItem(collapseKey, JSON.stringify([...all])) } catch { /* ignore */ } }
  // Cây phân cấp: Kho → Loại kho → Loại xe; dòng lá sort booking ↑ (null cuối) → giờ ĐK ↑
  type RenderItem =
    | { kind: 'group'; level: 1 | 2 | 3; key: string; label: string; total: number; done: number; inside: number; waiting: number; collapsed: boolean }
    | { kind: 'leaf'; reg: GateRegistration }

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
  const { data: allWhTypes = [] } = useWarehouseTypes()   // đủ loại — chỉ dùng sắp thứ tự hiển thị
  const { data: whTypes = [] } = useScopedWhTypes()       // option filter + form theo scope user

  // ── Thứ tự cây do FE quyết (kho theo TÊN · loại kho theo Cài đặt WMS · loại xe theo Cài đặt TMS,
  // "Chỉ trả pallet"/"Khác" xuống cuối). Gửi 3 mảng thứ tự này xuống server để server trả DÒNG
  // đúng thứ tự cây — KHÔNG chép quy tắc sắp xếp vào SQL (đổi cài đặt là lệch nhau ngay).
  const whNameOf = (wid: string) => (warehouses as { id: string; name: string }[]).find(w => w.id === wid)?.name ?? wid
  const treeOrder = useMemo(() => {
    const wtRank = new Map<string, number>((allWhTypes as { value: string }[]).map((t, i) => [t.value, i]))
    const vtRank = new Map<string, number>((vehicleTypes as { name: string }[]).map((t, i) => [t.name, i]))
    const whs = [...new Set(treeNodes.map(n => n.wh))]
      .sort((a, b) => whNameOf(a).localeCompare(whNameOf(b), 'vi'))
    const wts = [...new Set(treeNodes.map(n => n.wt ?? WT_FALLBACK))].sort((a, b) => {
      const oa = wtRank.get(a) ?? 9999, ob = wtRank.get(b) ?? 9999
      return oa !== ob ? oa - ob : a.localeCompare(b, 'vi')
    })
    const vts = [...new Set(treeNodes.map(n => n.vt ?? VT_FALLBACK))].sort((a, b) => {
      const sa = SPECIAL_VTYPES.includes(a) ? 1 : 0, sb = SPECIAL_VTYPES.includes(b) ? 1 : 0
      if (sa !== sb) return sa - sb
      const oa = vtRank.get(a) ?? 9999, ob = vtRank.get(b) ?? 9999
      return oa !== ob ? oa - ob : a.localeCompare(b, 'vi')
    })
    return { whs, wts, vts }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeNodes, warehouses, allWhTypes, vehicleTypes])

  // Nhóm ĐANG GẬP → server bỏ qua dòng của nhóm đó (không thì trang tải toàn dòng đang bị ẩn)
  const collapsedArrays = useMemo(() => {
    const wh: string[] = [], wt: string[] = [], vt: string[] = []
    for (const k of collapsed) {
      const m3 = k.match(/^W::(.*)::T::(.*)::V::(.*)$/)
      if (m3) { vt.push(`${m3[1]}|${m3[2]}|${m3[3]}`); continue }
      const m2 = k.match(/^W::(.*)::T::(.*)$/)
      if (m2) { wt.push(`${m2[1]}|${m2[2]}`); continue }
      const m1 = k.match(/^W::(.*)$/)
      if (m1) wh.push(m1[1])
    }
    return { wh, wt, vt }
  }, [collapsed])

  // Dòng chi tiết: cuộn tới đâu tải tới đó (mỗi lượt 200 dòng theo đúng thứ tự cây)
  const LEAF_PAGE = 200
  const leafParams = useMemo(() => ({
    ...treeParams,
    order_wh: treeOrder.whs, order_wt: treeOrder.wts, order_vt: treeOrder.vts,
    wt_null: WT_FALLBACK, vt_null: VT_FALLBACK,
    collapsed_wh: collapsedArrays.wh, collapsed_wt: collapsedArrays.wt, collapsed_vt: collapsedArrays.vt,
    limit: LEAF_PAGE,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [JSON.stringify(treeParams), treeOrder, collapsedArrays])
  const leavesQ = useInfiniteQuery({
    queryKey: ['gate-leaves', leafParams],
    enabled: treeNodes.length > 0,
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => apiClient
      .get('/tms/gate-registrations/leaves', { params: { ...leafParams, offset: pageParam } })
      .then(r => r.data.data as { rows: GateRegistration[]; total: number }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((s, p) => s + p.rows.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
  const displayRegs = useMemo(
    () => leavesQ.data?.pages.flatMap(p => p.rows) ?? [], [leavesQ.data])
  const leavesTotal = leavesQ.data?.pages[0]?.total ?? 0

  // Cuộn chạm đáy → tải lượt tiếp theo
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = leavesQ
  useEffect(() => {
    const el = loadMoreRef.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, displayRegs.length])

  // Tất cả key nhóm (mọi cấp) để Mở/Gom tất cả — lấy từ CÂY (không phải từ dòng đã tải)
  const allGroupKeys = useMemo(() => {
    const s = new Set<string>()
    for (const n of treeNodes) {
      const whKey = `W::${n.wh}`
      const wtKey = `${whKey}::T::${n.wt ?? WT_FALLBACK}`
      s.add(whKey); s.add(wtKey); s.add(`${wtKey}::V::${n.vt ?? VT_FALLBACK}`)
    }
    return s
  }, [treeNodes])
  const whKeys = useMemo(() => [...new Set(treeNodes.map(n => `W::${n.wh}`))], [treeNodes])
  const allCollapsed = whKeys.length > 0 && whKeys.every(k => collapsed.has(k))

  const renderList = useMemo<RenderItem[]>(() => {
    // Thống kê nhóm lấy từ CÂY (đúng trên toàn bộ bộ lọc), dòng lấy từ phần ĐÃ TẢI
    const nodeByKey = new Map<string, { total: number; done: number; inside: number; waiting: number }>()
    const roll = (k: string, n: { total: number; done: number; inside: number; waiting: number }) => {
      const cur = nodeByKey.get(k) ?? { total: 0, done: 0, inside: 0, waiting: 0 }
      nodeByKey.set(k, { total: cur.total + n.total, done: cur.done + n.done, inside: cur.inside + n.inside, waiting: cur.waiting + n.waiting })
    }
    const wtsOf = new Map<string, Set<string>>(), vtsOf = new Map<string, Set<string>>()
    for (const n of treeNodes) {
      const wt = n.wt ?? WT_FALLBACK, vt = n.vt ?? VT_FALLBACK
      const whKey = `W::${n.wh}`, wtKey = `${whKey}::T::${wt}`, vtKey = `${wtKey}::V::${vt}`
      roll(whKey, n); roll(wtKey, n); roll(vtKey, n)
      if (!wtsOf.has(whKey)) wtsOf.set(whKey, new Set())
      wtsOf.get(whKey)!.add(wt)
      if (!vtsOf.has(wtKey)) vtsOf.set(wtKey, new Set())
      vtsOf.get(wtKey)!.add(vt)
    }
    const leavesByKey = new Map<string, GateRegistration[]>()
    for (const r of displayRegs) {
      const k = `W::${r.warehouse_id ?? ''}::T::${r.warehouse_type ?? WT_FALLBACK}::V::${r.vehicle_type ?? VT_FALLBACK}`
      if (!leavesByKey.has(k)) leavesByKey.set(k, [])
      leavesByKey.get(k)!.push(r)
    }
    const items: RenderItem[] = []
    for (const wid of treeOrder.whs) {
      const whKey = `W::${wid}`
      const whStats = nodeByKey.get(whKey)
      if (!whStats) continue
      const whCol = collapsed.has(whKey)
      items.push({ kind: 'group', level: 1, key: whKey, label: whNameOf(wid), ...whStats, collapsed: whCol })
      if (whCol) continue
      for (const wt of treeOrder.wts) {
        if (!wtsOf.get(whKey)?.has(wt)) continue
        const wtKey = `${whKey}::T::${wt}`
        const wtCol = collapsed.has(wtKey)
        items.push({ kind: 'group', level: 2, key: wtKey, label: wt, ...nodeByKey.get(wtKey)!, collapsed: wtCol })
        if (wtCol) continue
        for (const vt of treeOrder.vts) {
          if (!vtsOf.get(wtKey)?.has(vt)) continue
          const vtKey = `${wtKey}::V::${vt}`
          const vtCol = collapsed.has(vtKey)
          items.push({ kind: 'group', level: 3, key: vtKey, label: vt, ...nodeByKey.get(vtKey)!, collapsed: vtCol })
          if (vtCol) continue
          for (const reg of leavesByKey.get(vtKey) ?? []) items.push({ kind: 'leaf', reg })
        }
      }
    }
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeNodes, displayRegs, collapsed, treeOrder, warehouses])

  // Loại xe = DANH MỤC độc lập (user chốt 04/07: "Loại xe khác mà khung giờ khác") —
  // không còn chặn theo khung giờ kho; chỉ ƯU TIÊN loại có khung giờ tại kho lên đầu cho dễ chọn.
  const _gateCargoType = (form.warehouse_type && form.warehouse_type !== 'Khác') ? form.warehouse_type : undefined
  const { data: filteredGateVehicleTypes = [] } = useVehicleTypesByWarehouse(form.warehouse_id || null, _gateCargoType)
  const _activeVts = (vehicleTypes as TmsVehicleType[]).filter(vt => vt.is_active !== false)
  const _inWhVtNames = new Set((filteredGateVehicleTypes as TmsVehicleType[]).map(vt => vt.name))
  const availableVehicleTypes = _inWhVtNames.size
    ? [..._activeVts].sort((a, b) => Number(_inWhVtNames.has(b.name)) - Number(_inWhVtNames.has(a.name)))
    : _activeVts

  // Xe "kết hợp" (chỉ ở chế độ tạo mới): Hướng = 'BOTH' (sentinel form). Chân chính = NHẬP, chân phụ = XUẤT.
  const isCombined = !editReg && form.direction === 'BOTH'
  const mainDirection = form.direction === 'BOTH' ? 'INBOUND' : form.direction

  // Phase 1 hoàn thành khi đủ 6 tiêu chí matching (company_name_raw chấp nhận thay company_id cho NCC vãng lai)
  const phase1Complete = !!(
    form.date && form.warehouse_id && form.direction &&
    form.warehouse_type && form.vehicle_type && (form.company_id || form.company_name_raw)
  )

  // Suggest chỉ trigger khi đủ cả 7 (phase1 + biển số)
  const suggestEnabled = !!(phase1Complete && form.license_plate)
  const { data: suggestions = [], isFetching: suggestLoading } = useQuery<BookingSuggestion[]>({
    queryKey: ['gate-suggest', form.date, form.license_plate, form.warehouse_id, mainDirection, form.warehouse_type, form.vehicle_type, form.company_id, editReg?.id],
    queryFn: () => apiClient.get('/tms/gate-registrations/suggest-booking', {
      params: {
        date:            form.date,
        license_plate:   form.license_plate,
        warehouse_id:    form.warehouse_id,
        direction:       mainDirection || undefined,
        warehouse_type:  form.warehouse_type || undefined,
        vehicle_type:    form.vehicle_type || undefined,
        company_id:      form.company_id || undefined,
        exclude_gate_id: editReg?.id,
      },
    }).then(r => r.data.data),
    enabled: suggestEnabled && modalOpen,
  })

  // Booking dự kiến cho CHÂN XUẤT (chỉ khi đăng ký kết hợp)
  const outSuggestEnabled = !!(isCombined && form.license_plate && form.warehouse_type && outLeg.vehicle_type && (outLeg.company_id || outLeg.company_name_raw))
  const { data: outSuggestions = [], isFetching: outSuggestLoading } = useQuery<BookingSuggestion[]>({
    queryKey: ['gate-suggest', form.date, form.license_plate, form.warehouse_id, 'OUTBOUND', form.warehouse_type, outLeg.vehicle_type, outLeg.company_id],
    queryFn: () => apiClient.get('/tms/gate-registrations/suggest-booking', {
      params: {
        date:            form.date,
        license_plate:   form.license_plate,
        warehouse_id:    form.warehouse_id,
        direction:       'OUTBOUND',
        warehouse_type:  form.warehouse_type || undefined,
        vehicle_type:    outLeg.vehicle_type || undefined,
        company_id:      outLeg.company_id || undefined,
      },
    }).then(r => r.data.data),
    enabled: outSuggestEnabled && modalOpen,
  })

  // ── Mutations
  function invalidate() {
    qc.invalidateQueries({ queryKey: ['gate-registrations'] })
    // Cây lười: thống kê nhóm + dòng đã tải đều phải làm mới (thêm/gọi/vào/ra đổi cả 2)
    qc.invalidateQueries({ queryKey: ['gate-tree'] })
    qc.invalidateQueries({ queryKey: ['gate-leaves'] })
    // call/entry/exit cập nhật TmsOrder.export_status + slot → làm mới trang Bookings đang mở song song
    qc.invalidateQueries({ queryKey: ['tms-orders-paged'] })
    qc.invalidateQueries({ queryKey: ['tms-orders-summary'] })
    qc.invalidateQueries({ queryKey: ['gate-suggest'] })
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

  // Cập nhật selected chỉ khi detail đang mở cho chính đăng ký đó — không tự mở nếu đang đóng
  const syncSelected = (reg: GateRegistration) =>
    setSelected(prev => prev?.id === reg.id ? reg : prev)

  const callMut = useMutation({
    mutationFn: ({ id, custom_time }: { id: string; custom_time?: string }) =>
      apiClient.patch(`/tms/gate-registrations/${id}/call`, { custom_time }).then(r => r.data),
    onSuccess: (d: { data: GateRegistration }) => { invalidate(); syncSelected(d.data); setCallTarget(null) },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      toast({ variant: 'destructive', title: e.response?.data?.error?.message ?? 'Lỗi gọi xe' }),
  })

  const entryMut = useMutation({
    mutationFn: ({ id, custom_time }: { id: string; custom_time?: string }) =>
      apiClient.patch(`/tms/gate-registrations/${id}/entry`, { custom_time }).then(r => r.data),
    onSuccess: (d: { data: GateRegistration }) => { invalidate(); syncSelected(d.data); setEntryTarget(null) },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      toast({ variant: 'destructive', title: e.response?.data?.error?.message ?? 'Lỗi xác nhận vào' }),
  })

  const exitMut = useMutation({
    mutationFn: ({ id, load_capacity, custom_time }: { id: string; load_capacity?: string; custom_time?: string }) =>
      apiClient.patch(`/tms/gate-registrations/${id}/exit`, { load_capacity: load_capacity || undefined, custom_time }).then(r => r.data),
    onSuccess: (d: { data: GateRegistration }) => {
      invalidate(); syncSelected(d.data); setExitTarget(null); setExitWeight('')
    },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      toast({ variant: 'destructive', title: e.response?.data?.error?.message ?? 'Lỗi xác nhận ra' }),
  })

  const revertCallMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/tms/gate-registrations/${id}/revert-call`).then(r => r.data),
    onSuccess: (d: { data: GateRegistration }) => { invalidate(); syncSelected(d.data) },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      toast({ variant: 'destructive', title: e.response?.data?.error?.message ?? 'Lỗi huỷ gọi xe' }),
  })

  const revertEntryMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/tms/gate-registrations/${id}/revert-entry`).then(r => r.data),
    onSuccess: (d: { data: GateRegistration }) => { invalidate(); syncSelected(d.data) },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      toast({ variant: 'destructive', title: e.response?.data?.error?.message ?? 'Lỗi huỷ xác nhận vào' }),
  })

  const revertExitMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/tms/gate-registrations/${id}/revert-exit`).then(r => r.data),
    onSuccess: (d: { data: GateRegistration }) => { invalidate(); syncSelected(d.data) },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      toast({ variant: 'destructive', title: e.response?.data?.error?.message ?? 'Lỗi huỷ xác nhận ra' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tms/gate-registrations/${id}`).then(r => r.data),
    onSuccess: () => { invalidate(); setSelected(null) },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      toast({ variant: 'destructive', title: e.response?.data?.error?.message ?? 'Lỗi xóa' }),
  })

  // ── Modal helpers
  function openCreate() {
    setEditReg(null)
    setForm({ ...FORM_DEFAULT, date: TODAY_VN, warehouse_id: fWarehouse })
    setOutLeg(LEG_DEFAULT)
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
    setOutLeg(LEG_DEFAULT)
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
                          next.warehouse_type && next.vehicle_type && (next.company_id || next.company_name_raw))
      return complete ? next : { ...next, ...PHASE2_DEFAULT }
    })
  }

  async function handleSubmit() {
    setApiError('')
    // Xe kết hợp: gửi 2 chân (Nhập = trường chính, Xuất = outLeg) → BE tạo 2 record 1 chiều chung visit_group_id
    if (isCombined) {
      const shared = {
        date:           form.date,
        driver_name:    form.driver_name || null,
        phone:          form.phone || null,
        vehicle_id:     form.vehicle_id || null,
        license_plate:  form.license_plate || null,
        warehouse_id:   form.warehouse_id,
        warehouse_type: form.warehouse_type || null,
      }
      createMut.mutate({
        ...shared,
        combined: true,
        legs: [
          {
            direction: 'INBOUND',
            vehicle_type:     form.vehicle_type || null,
            company_id:       form.company_id || null,
            company_name_raw: form.company_name_raw || null,
            content:          form.content || null,
            return_pallet:    form.return_pallet,
            seal_number:      form.seal_number || null,
            notes:            form.notes || null,
          },
          {
            direction: 'OUTBOUND',
            vehicle_type:     outLeg.vehicle_type || null,
            company_id:       outLeg.company_id || null,
            company_name_raw: outLeg.company_name_raw || null,
            content:          outLeg.content || null,
            return_pallet:    outLeg.return_pallet,
            seal_number:      outLeg.seal_number || null,
            notes:            outLeg.notes || null,
          },
        ],
      })
      return
    }
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

  // Xe kết hợp: chân đối ứng (khác chiều) cùng visit_group_id — để gác thứ tự Vào/Ra
  function combinedPartner(reg: GateRegistration): GateRegistration | undefined {
    if (!reg.visit_group_id) return undefined
    // Tìm trong các dòng ĐÃ TẢI: 2 chân của xe kết hợp cùng kho/loại nên gần như luôn nằm cùng
    // lượt tải. Nếu chưa tải kịp thì chỉ mất phần LÀM MỜ nút — thứ tự Vào/Ra vẫn được BE chặn
    // (combinedPartnerStatus ở doCall/doEntry/doRevertExit).
    return displayRegs.find(r => r.visit_group_id === reg.visit_group_id && r.id !== reg.id)
  }

  // ── Action buttons nhỏ NẰM TRONG CELL từng dòng (chuẩn 17b — giữ nguyên, không dùng ActionCluster)
  function ActionButtons({ reg }: { reg: GateRegistration }) {
    const btnCls = 'text-[10px] px-1.5 py-0.5 h-auto !min-h-0 !min-w-0'   // bỏ sàn touch-target 44px → row co theo số mã đơn
    // Xe kết hợp — gác thứ tự: chân Xuất chỉ Gọi xe/Vào khi chân Nhập đã Ra; gỡ "Đã ra" chân Nhập phải hoàn tác chân Xuất trước
    const partner = combinedPartner(reg)
    const blockOutForward = !!(reg.visit_group_id && reg.direction === 'OUTBOUND' && partner && partner.status !== 'COMPLETED')
    const blockInRevertExit = !!(reg.visit_group_id && reg.direction === 'INBOUND' && partner && partner.status !== 'REGISTERED')
    return (
      <div className="flex gap-1 items-center flex-nowrap">
        {/* Gọi xe */}
        {reg.status === 'REGISTERED' && can(perms, 'gate_registration', 'call') && (
          <Button size="sm" variant="outline"
            className={`${btnCls} border-amber-300 text-amber-700 hover:bg-amber-50`}
            disabled={blockOutForward}
            title={blockOutForward ? 'Xe Nhập chưa ra — chân Xuất chưa thể gọi xe' : undefined}
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
            disabled={blockOutForward}
            title={blockOutForward ? 'Xe Nhập chưa ra — chân Xuất chưa thể vào' : undefined}
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
            disabled={revertExitMut.isPending || blockInRevertExit}
            title={blockInRevertExit ? 'Phải hoàn tác thao tác chân Xuất trước (gỡ Gọi xe / Đã vào)' : 'Huỷ xác nhận ra'}
            onClick={e => { e.stopPropagation(); revertExitMut.mutate(reg.id) }}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        )}
      </div>
    )
  }

  // ── Cụm action tiến trình cho PANE chi tiết (chuẩn ActionCluster) — CÙNG điều kiện trạng thái/quyền/
  // gác xe kết hợp với ActionButtons ở trên (sửa 1 bên nhớ sửa bên kia)
  function paneGateActionItems(reg: GateRegistration): ActionItem[] {
    const partner = combinedPartner(reg)
    const blockOutForward = !!(reg.visit_group_id && reg.direction === 'OUTBOUND' && partner && partner.status !== 'COMPLETED')
    const blockInRevertExit = !!(reg.visit_group_id && reg.direction === 'INBOUND' && partner && partner.status !== 'REGISTERED')
    const items: ActionItem[] = []
    if (reg.status === 'REGISTERED' && can(perms, 'gate_registration', 'call'))
      items.push({
        key: 'call', icon: PhoneCall, label: 'Gọi xe',
        tip: blockOutForward ? 'Xe Nhập chưa ra — chân Xuất chưa thể gọi xe' : 'Gọi xe vào lấy/giao hàng',
        primary: true, className: 'border-amber-300 text-amber-700 hover:bg-amber-50',
        disabled: blockOutForward,
        onClick: () => { setCallTarget(reg); setCallTime(nowVnDatetimeLocal()) },
      })
    if (reg.status === 'CALLED' && can(perms, 'gate_registration', 'call'))
      items.push({
        key: 'revert-call', icon: RotateCcw, label: 'Huỷ gọi xe', tip: 'Huỷ gọi xe (quay về Đã đăng ký)',
        variant: 'ghost', className: 'text-slate-400 hover:text-red-500',
        busy: revertCallMut.isPending,
        onClick: () => revertCallMut.mutate(reg.id),
      })
    if ((reg.status === 'REGISTERED' || reg.status === 'CALLED') && can(perms, 'gate_registration', 'entry'))
      items.push({
        key: 'entry', icon: LogIn, label: 'Vào cổng',
        tip: blockOutForward ? 'Xe Nhập chưa ra — chân Xuất chưa thể vào' : 'Xác nhận xe vào cổng',
        primary: true, className: 'border-green-300 text-green-700 hover:bg-green-50',
        disabled: blockOutForward,
        onClick: () => { setEntryTarget(reg); setEntryTime(nowVnDatetimeLocal()) },
      })
    if (reg.status === 'IN' && can(perms, 'gate_registration', 'entry'))
      items.push({
        key: 'revert-entry', icon: RotateCcw, label: 'Huỷ vào', tip: 'Huỷ xác nhận vào (quay về trạng thái trước)',
        variant: 'ghost', className: 'text-slate-400 hover:text-red-500',
        busy: revertEntryMut.isPending,
        onClick: () => revertEntryMut.mutate(reg.id),
      })
    if (reg.status === 'IN' && can(perms, 'gate_registration', 'exit'))
      items.push({
        key: 'exit', icon: LogOut, label: 'Ra cổng', tip: 'Xác nhận xe ra cổng (ghi giờ ra, trọng lượng)',
        primary: true, className: 'border-blue-300 text-blue-700 hover:bg-blue-50',
        onClick: () => { setExitTarget(reg); setExitWeight(''); setExitTime(nowVnDatetimeLocal()) },
      })
    if (reg.status === 'COMPLETED' && can(perms, 'gate_registration', 'exit'))
      items.push({
        key: 'revert-exit', icon: RotateCcw, label: 'Huỷ ra',
        tip: blockInRevertExit ? 'Phải hoàn tác thao tác chân Xuất trước (gỡ Gọi xe / Đã vào)' : 'Huỷ xác nhận ra',
        variant: 'ghost', className: 'text-slate-400 hover:text-red-500',
        disabled: blockInRevertExit,
        busy: revertExitMut.isPending,
        onClick: () => revertExitMut.mutate(reg.id),
      })
    return items
  }

  // ── Vehicle options lọc theo công ty — GOM CHI NHÁNH theo tên (1 ĐVVT nhiều mã, cùng tên)
  // → chọn 1 ĐVVT vẫn ra đủ xe của mọi chi nhánh cùng tên.
  const selCompanyName = companies.find(c => c.id === form.company_id)?.name
  const companyGroupIds = selCompanyName
    ? new Set(companies.filter(c => (c.name ?? '').trim().toLowerCase() === selCompanyName.trim().toLowerCase()).map(c => c.id))
    : null
  const vehicleOptions: ComboOption[] = vehicles
    .filter(v => !form.company_id || (companyGroupIds ? companyGroupIds.has(v.ncc_id) : v.ncc_id === form.company_id))
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

  const vtOptions: ComboOption[] = [
    ...availableVehicleTypes.map(vt => ({
      value: vt.name,   // lưu name để khớp với TmsOrder.vehicle_type
      label: vt.name,
    })),
    // 2 loại đặc biệt luôn có sẵn (không phụ thuộc kho/khung giờ), không gắn booking
    ...SPECIAL_VTYPES.filter(s => !availableVehicleTypes.some(vt => vt.name === s))
      .map(s => ({ value: s, label: s })),
  ]

  // ─── Filter chip bar (Manhattan) ───
  const filterWhOptions = (allowedWhIds
    ? warehouses.filter((w: { id: string }) => allowedWhIds.has(w.id))
    : warehouses
  ).map((w: { id: string; name: string }) => ({ value: w.id, label: w.name }))

  const filterDefs: FilterDef[] = [
    { key: 'date', label: 'Ngày', type: 'daterange', from: fDate, to: fDateTo,
      onChange: (from, to) => { setFDate(from); setFDateTo(to) } },
    { key: 'warehouse', label: 'Kho', type: 'single', options: filterWhOptions, value: fWarehouse, allLabel: 'Tất cả kho',
      onChange: setFWarehouse },
    { key: 'vehType', label: 'Loại xe', type: 'multi', options: vehicleTypes.map(vt => ({ value: vt.name, label: vt.name })), selected: fVehicleTypes, searchable: false,
      onChange: setFVehicleTypes },
    { key: 'company', label: 'ĐVVT/NCC', type: 'single', options: companies.map(c => ({ value: c.id, label: c.name })), value: fCompany, allLabel: 'Tất cả ĐVVT',
      onChange: setFCompany },
    { key: 'direction', label: 'Hướng', type: 'single', options: [{ value: 'OUTBOUND', label: 'Xuất' }, { value: 'INBOUND', label: 'Nhập' }], value: fDirection, allLabel: 'Cả hai',
      onChange: setFDirection },
    { key: 'status', label: 'Trạng thái', type: 'single', options: (['REGISTERED', 'CALLED', 'IN', 'COMPLETED'] as GateStatus[]).map(s => ({ value: s, label: STATUS_LABEL[s] })), value: fStatus, allLabel: 'Tất cả TT',
      onChange: setFStatus },
    { key: 'whType', label: 'Loại kho', type: 'single', options: whTypes.map((t: { id: string; value: string }) => ({ value: t.value, label: t.value })), value: fWarehouseType, allLabel: 'Tất cả loại kho',
      onChange: setFWarehouseType },
  ]

  const viewSnapshot = {
    fDate, fDateTo, fWarehouse, fWarehouseType, fVehicleTypes, fCompany, fDirection, fStatus,
  }
  const savedViews = useSavedViewsStore(s => s.views['gateRegistration'] ?? [])
  const activeViewId = useMemo(() => {
    const cur = JSON.stringify(viewSnapshot)
    return savedViews.find(v => JSON.stringify(v.filters) === cur)?.id ?? null
  }, [savedViews, viewSnapshot])

  const { widths: gateColW, startResize: gateStartResize, totalWidth: gateTotalWidth } =
    useColumnResize('gate_col_widths', GATE_COLS.map(c => c.w))

  const renderLeafRow = (reg: GateRegistration) => (
    <TableRow
      key={reg.id}
      className={`cursor-pointer ${ROW_TEXT[reg.status]} ${selected?.id === reg.id ? 'ring-1 ring-inset ring-blue-400' : ''} ${dense ? '' : '[&_td]:py-2.5'}`}
      onClick={() => setSelected(prev => prev?.id === reg.id ? null : reg)}
    >
      <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap sticky left-0 z-10 bg-white">
        {reg.registration_number}
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">{fmtDate(reg.date)}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
        {reg.direction === 'OUTBOUND'
          ? <span className="flex items-center gap-0.5">Xuất<ArrowRight className="h-3 w-3 text-orange-600" />{reg.visit_group_id && <span className="text-red-500 font-bold" title="Xe kết hợp Nhập + Xuất">*</span>}</span>
          : reg.direction === 'INBOUND'
          ? <span className="flex items-center gap-0.5">Nhập<ArrowLeft className="h-3 w-3 text-blue-600" />{reg.visit_group_id && <span className="text-red-500 font-bold" title="Xe kết hợp Nhập + Xuất">*</span>}</span>
          : '—'}
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{reg.vehicle_type ?? '—'}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
        <span className="flex items-center gap-1">
          <span>{reg.content ?? '—'}</span>
          {reg.return_pallet && <Package className="h-3 w-3 text-blue-500 shrink-0" />}
          {reg.priority && <Star className="h-2.5 w-2.5 text-amber-500 fill-amber-500 shrink-0" />}
        </span>
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
        <span className="flex items-center gap-1">
          {reg.booking_slot_from
            ? <span>{reg.booking_slot_from.slice(0,5)}–{(reg.booking_slot_to ?? '').slice(0,5)}</span>
            : <span className="text-slate-300">—</span>}
          {bookingIcon(reg)}
        </span>
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap align-top">
        {renderOrderField(reg.booking_order_code, true)}
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap align-top">
        {renderOrderField(reg.booking_npp_names)}
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap align-top">
        {renderOrderField(reg.booking_gdo_refs)}
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{companyName(reg)}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{reg.license_plate ?? '—'}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{reg.driver_name ?? '—'}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{reg.phone ?? '—'}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap" title={reg.notes ?? ''}>{reg.notes ?? '—'}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{fmtTime(reg.registered_at)}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-medium">{fmtTime(reg.called_at)}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-medium">{fmtTime(reg.entry_at)}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-medium">{fmtTime(reg.exit_at)}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{warehouseName(reg.warehouse_id)}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{reg.warehouse_type ?? '—'}</TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_BADGE[reg.status]}`}>
          {STATUS_LABEL[reg.status]}
        </span>
      </TableCell>
      <TableCell className="px-1 py-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
        <ActionButtons reg={reg} />
      </TableCell>
    </TableRow>
  )

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* ── Toolbar */}
      <div className="border-b bg-white px-3 py-1.5 shrink-0 space-y-1 sm:py-2 sm:space-y-1.5 sm:rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 shrink-0">Đăng ký cổng</span>
          <div className="flex-1" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          {/* Mobile: SavedViews + action GOM 1 hàng (PDA); desktop sm:contents → như cũ */}
          <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
          <SavedViews
            module="gateRegistration"
            currentFilters={viewSnapshot}
            activeId={activeViewId}
            onApply={(filters) => setGateRegistration(filters as Partial<typeof grf>)}
          />
          <button type="button" onClick={allCollapsed ? expandAll : collapseAll}
            className="inline-flex h-7 items-center gap-1 px-2 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0 text-[11px]"
            title={allCollapsed ? 'Mở tất cả nhóm' : 'Gom tất cả nhóm'}>
            {allCollapsed ? <ChevronsUpDown className="h-3.5 w-3.5" /> : <ChevronsDownUp className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{allCollapsed ? 'Mở' : 'Gom'}</span>
          </button>
          <button type="button" onClick={toggleDensity}
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
            title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
            {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
          <ActionCluster className="shrink-0" mobileInline items={[
            ...(can(perms, 'gate_registration', 'create') ? [{
              key: 'create', icon: Plus, label: 'Đăng ký xe', tip: 'Đăng ký lượt xe mới vào cổng',
              primary: true, variant: 'default',
              onClick: openCreate,
            } satisfies ActionItem] : []),
          ]} />
          </div>
        </div>

        {/* Filter chip bar (desktop) */}
        <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
          <FilterBar defs={filterDefs} />
        </div>
      </div>

      {/* Summary band (Manhattan) */}
      <ListErrorBanner error={listErr} />
      <SummaryBand tiles={[
        // Tổng tính bằng SQL trên TOÀN BỘ bộ lọc — không đếm trên số dòng đã tải về
        { label: 'Tổng xe', value: totals.total },
        { label: 'Đang chờ', value: totals.waiting },
        { label: 'Đang trong', value: totals.inside, accent: totals.inside > 0 },
        { label: 'Đã ra', value: totals.done },
      ]} />

      {/* ── Main area: table */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {treeLoading ? (
          <div className="flex items-center justify-center h-32 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />Đang tải...
          </div>
        ) : totals.total === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-slate-400">
            Không có dữ liệu
          </div>
        ) : (
          <Table className="table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100" style={{ width: gateTotalWidth, minWidth: '100%' }}>
                <colgroup>{gateColW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                <TableHeader>
                  <TableRow>
                    {GATE_COLS.map((c, i) => (
                      <TableHead key={c.id}
                        className={`text-[9px] font-medium text-slate-500 whitespace-nowrap py-1.5 ${i === 21 ? 'px-1' : 'px-2'} ${c.align === 'right' ? 'text-right' : ''} ${c.id === 'num' ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                        {c.label}
                        {i > 0 && c.id !== 'actions' && (
                          <span onPointerDown={e => gateStartResize(i, e)} onClick={e => e.stopPropagation()}
                            className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" title="Kéo để chỉnh độ rộng cột" />
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renderList.map(item => {
                    if (item.kind === 'leaf') return renderLeafRow(item.reg)
                    const cellCls =
                      item.level === 1 ? 'bg-slate-700 text-white py-2 font-bold border-b border-slate-600'
                      : item.level === 2 ? 'bg-sky-100 text-sky-900 py-1.5 font-semibold border-b border-sky-200 border-l-4 border-l-sky-500'
                      : 'bg-slate-100 text-slate-700 py-1 font-medium border-b border-slate-200 border-l-4 border-l-purple-400'
                    return (
                      <TableRow key={item.key} className="hover:bg-transparent">
                        <TableCell
                          colSpan={GATE_COLS.length}
                          onClick={() => toggleGroup(item.key)}
                          className={`whitespace-nowrap cursor-pointer select-none !overflow-visible ${cellCls}`}
                        >
                          {/* span con sticky-left: cell colSpan rộng cả bảng không trượt-dính được; span co theo chữ thì dính được */}
                          <span className="sticky left-0 inline-flex items-center gap-2" style={{ paddingLeft: item.level === 3 ? 8 : 8 + (item.level - 1) * 22 }}>
                            {item.level === 3
                              ? <Star className="h-3.5 w-3.5 shrink-0 text-purple-600 fill-purple-500" />
                              : item.collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                            <span className={`${item.level <= 2 ? 'uppercase tracking-wide text-[11px]' : 'text-[11px]'} ${item.level === 3 ? 'text-purple-700 font-semibold' : ''}`}>{item.label}</span>
                            {/* Thống kê chỉ ở cấp Loại xe — dạng chữ rõ nghĩa, không màu */}
                            {item.level === 3 && (
                              <span className="text-[10px] font-normal text-slate-500">
                                Tổng {item.total} · Xong {item.done} · Trong {item.inside} · Chờ {item.waiting}
                              </span>
                            )}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
          )}
        {/* Mốc cuộn: chạm tới là tải tiếp lượt sau (cây LƯỜI — không có nút phân trang) */}
        {leavesQ.hasNextPage && (
          <div ref={loadMoreRef} className="flex items-center justify-center gap-2 py-3 text-[11px] text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Đang tải thêm… ({displayRegs.length.toLocaleString('vi-VN')}/{leavesTotal.toLocaleString('vi-VN')} dòng)
          </div>
        )}
      </div>

      {/* Footer đếm bản ghi */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 sm:rounded-b-xl">
        {totals.total > 0
          ? `${displayRegs.length.toLocaleString('vi-VN')} / ${leavesTotal.toLocaleString('vi-VN')} dòng đã tải · ${totals.total.toLocaleString('vi-VN')} lượt đăng ký`
          : '0 lượt đăng ký'}
      </div>
     </div>

      {/* Detail dialog — overlay, không ảnh hưởng layout bảng */}
      <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null) }}>
        <DialogContent className="max-w-sm p-0 overflow-hidden">
          <DialogTitle className="sr-only">Chi tiết đăng ký cổng</DialogTitle>
          {selected && (
            <div className="p-4 space-y-2 text-xs max-h-[80vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center gap-2 flex-wrap pr-8">
                <span className="font-mono font-semibold text-slate-700">#{selected.registration_number}</span>
                {selected.priority && <Star className="h-3 w-3 text-amber-500 fill-amber-500" />}
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_BADGE[selected.status]}`}>
                  {STATUS_LABEL[selected.status]}
                </span>
                <ActionCluster className="ml-auto" items={[
                  ...(can(perms, 'gate_registration', 'edit') ? [{
                    key: 'edit', icon: Pencil, label: 'Sửa', tip: 'Sửa thông tin lượt đăng ký',
                    onClick: () => { setSelected(null); openEdit(selected) },
                  } satisfies ActionItem] : []),
                  ...(can(perms, 'gate_registration', 'delete') ? [{
                    key: 'delete', icon: Trash2, label: 'Xóa', tip: 'Xóa lượt đăng ký (không hoàn tác được)',
                    danger: true, className: 'border-red-200 text-red-600 hover:bg-red-50',
                    onClick: () => setDeleteTarget(selected),
                  } satisfies ActionItem] : []),
                ]} />
              </div>

              {/* Cụm action tiến trình theo trạng thái (Gọi xe / Vào / Ra + hoàn tác) */}
              <div className="flex flex-wrap">
                <ActionCluster items={paneGateActionItems(selected)} />
              </div>

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
                  {selected.visit_group_id && <span className="ml-0.5 text-red-500 font-bold" title="Xe kết hợp Nhập + Xuất">*</span>}
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
      <FormSheet
        open={modalOpen} onClose={closeModal}
        title={editReg ? `Sửa đăng ký #${editReg.registration_number}` : 'Thêm đăng ký xe'}
        widthClass="sm:max-w-3xl"
        onPointerDownOutside={e => {
          if ((e.target as Element).closest('[data-combofield-portal]')) e.preventDefault()
        }}
        footer={<>
          <Button variant="outline" size="sm" onClick={closeModal}>Hủy</Button>
          <Button
            size="sm"
            disabled={
              createMut.isPending || updateMut.isPending ||
              !form.date || !form.warehouse_id || !form.direction ||
              !form.warehouse_type || !form.vehicle_type || !(form.company_id || form.company_name_raw) ||
              !form.license_plate || !form.content || !form.driver_name || !form.phone ||
              (isCombined && (!outLeg.vehicle_type || !(outLeg.company_id || outLeg.company_name_raw) || !outLeg.content))
            }
            onClick={handleSubmit}
          >
            {(createMut.isPending || updateMut.isPending)
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Đang lưu...</>
              : (editReg ? 'Cập nhật' : 'Tạo đăng ký')}
          </Button>
        </>}
      >
          <div className="space-y-4">
            {apiError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded px-3 py-2">{apiError}</div>
            )}

            {/* Row 1: Ngày + Kho */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Ngày <span className="text-red-500">*</span></label>
                <Input type="date" value={form.date} min={TODAY_VN} onChange={e => fCriteria('date', e.target.value)} className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Kho <span className="text-red-500">*</span></label>
                <WarehouseSingleSelect
                  warehouses={(allowedWhIds
                    ? warehouses.filter((w: { id: string }) => allowedWhIds.has(w.id))
                    : warehouses) as { id: string; name: string }[]}
                  value={form.warehouse_id}
                  onChange={newId => setForm(prev => {
                    const next = { ...prev, warehouse_id: newId, warehouse_type: '', vehicle_type: '' }
                    if (editReg) return next
                    const complete = !!(next.date && next.warehouse_id && next.direction &&
                                        next.warehouse_type && next.vehicle_type && (next.company_id || next.company_name_raw))
                    return complete ? next : { ...next, ...PHASE2_DEFAULT }
                  })}
                  placeholder="Chọn kho"
                  triggerClassName="h-8"
                />
              </div>
            </div>

            {/* Row 2: Hướng + Loại kho */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Hướng <span className="text-red-500">*</span></label>
                <Select value={form.direction || '__none__'} onValueChange={v => fCriteria('direction', v === '__none__' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Chọn hướng" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Chưa xác định</SelectItem>
                    <SelectItem value="OUTBOUND">Xuất (OUTBOUND)</SelectItem>
                    <SelectItem value="INBOUND">Nhập (INBOUND)</SelectItem>
                    {!editReg && <SelectItem value="BOTH">Nhập + Xuất (kết hợp)</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Loại kho <span className="text-red-500">*</span></label>
                <Select value={form.warehouse_type || '__none__'} onValueChange={v => {
                  const newVal = v === '__none__' ? '' : v
                  setForm(prev => {
                    const next = { ...prev, warehouse_type: newVal, vehicle_type: '' }
                    if (editReg) return next
                    const complete = !!(next.date && next.warehouse_id && next.direction &&
                                        next.warehouse_type && next.vehicle_type && (next.company_id || next.company_name_raw))
                    return complete ? next : { ...next, ...PHASE2_DEFAULT }
                  })
                }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Chọn loại kho" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Không chọn —</SelectItem>
                    {whTypes.map((t: { id: string; value: string }) => (
                      <SelectItem key={t.id} value={t.value}>{t.value}</SelectItem>
                    ))}
                    <SelectItem value="Khác">Khác</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isCombined && (
              <div className="flex items-center gap-2 -mb-1">
                <ArrowLeft className="h-3.5 w-3.5 text-blue-600" />
                <span className="text-xs font-semibold text-blue-700">Chân NHẬP</span>
                <span className="text-[10px] text-slate-400">(loại xe / ĐVVT / nội dung riêng)</span>
              </div>
            )}
            {/* Row 3: Loại xe + ĐVVT */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Loại xe <span className="text-red-500">*</span></label>
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
                <label className="text-xs text-slate-500">ĐVVT / NCC <span className="text-red-500">*</span></label>
                <ComboField
                  value={form.company_id}
                  displayValue={companies.find(c => c.id === form.company_id)?.name ?? form.company_name_raw}
                  freeTextValue={form.company_name_raw}
                  options={companyOptions}
                  placeholder="Tìm hoặc nhập ĐVVT"
                  freetextMode
                  onSelect={opt => setForm(prev => {
                    const next = { ...prev, company_id: opt.value, company_name_raw: opt.label, vehicle_id: '', license_plate: '' }
                    if (editReg) return next
                    const complete = !!(next.date && next.warehouse_id && next.direction && next.warehouse_type && next.vehicle_type && (next.company_id || next.company_name_raw))
                    return complete ? next : { ...next, ...PHASE2_DEFAULT }
                  })}
                  onFreeText={text => fCriteria('company_name_raw', text)}
                  onClear={() => setForm(prev => ({
                    ...prev, company_id: '', company_name_raw: '',
                    ...(editReg ? {} : PHASE2_DEFAULT),
                  }))}
                />
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
                      freeTextValue={form.license_plate}
                      options={vehicleOptions}
                      placeholder="Tìm hoặc nhập biển số"
                      freetextMode
                      onSelect={opt => setForm(prev => ({ ...prev, vehicle_id: opt.value, license_plate: normalizeLicensePlate(opt.label) }))}
                      onFreeText={text => f('license_plate', normalizeLicensePlate(text))}
                      onClear={() => setForm(prev => ({ ...prev, vehicle_id: '', license_plate: '' }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">Nội dung vào ra{isCombined ? ' (nhập)' : ''} <span className="text-red-500">*</span></label>
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
                    <Input type="tel" inputMode="numeric" className="text-xs h-8" value={form.phone} onChange={e => f('phone', normalizePhone(e.target.value))} placeholder="09xxxxxxxx" />
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
                    <div className={`rounded px-2 py-1.5 text-xs space-y-0.5 border ${suggestions[0].from_plan ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
                      <div>
                        <span className={`font-mono font-semibold ${suggestions[0].from_plan ? 'text-amber-700' : 'text-green-700'}`}>{suggestions[0].order_code}</span>
                        {(suggestions[0].booking_slot_from || suggestions[0].booking_slot_to) && (
                          <span className="ml-2 text-green-600">{suggestions[0].booking_slot_from}–{suggestions[0].booking_slot_to}</span>
                        )}
                        {suggestions[0].from_plan && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Kế hoạch nhập — chưa booking</span>
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

                {/* ── Chân XUẤT (chỉ khi đăng ký kết hợp) — loại xe/ĐVVT/nội dung riêng cho chân xuất */}
                {isCombined && (
                  <div className="border-2 border-orange-200 rounded-lg p-3 space-y-3 bg-orange-50/40">
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-3.5 w-3.5 text-orange-600" />
                      <span className="text-xs font-semibold text-orange-700">Chân XUẤT</span>
                      <span className="text-[10px] text-slate-400">(cùng xe/kho, khác loại xe/ĐVVT được)</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-slate-500">Loại xe <span className="text-red-500">*</span></label>
                        <ComboField
                          value={outLeg.vehicle_type}
                          displayValue={vtOptions.find(v => v.value === outLeg.vehicle_type)?.label ?? outLeg.vehicle_type}
                          options={vtOptions}
                          placeholder="Tìm loại xe"
                          onSelect={opt => setOutLeg(prev => ({ ...prev, vehicle_type: opt.value }))}
                          onClear={() => setOutLeg(prev => ({ ...prev, vehicle_type: '' }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-slate-500">ĐVVT / NCC <span className="text-red-500">*</span></label>
                        <ComboField
                          value={outLeg.company_id}
                          displayValue={companies.find(c => c.id === outLeg.company_id)?.name ?? outLeg.company_name_raw}
                          freeTextValue={outLeg.company_name_raw}
                          options={companyOptions}
                          placeholder="Tìm hoặc nhập ĐVVT"
                          freetextMode
                          onSelect={opt => setOutLeg(prev => ({ ...prev, company_id: opt.value, company_name_raw: opt.label }))}
                          onFreeText={text => setOutLeg(prev => ({ ...prev, company_id: '', company_name_raw: text }))}
                          onClear={() => setOutLeg(prev => ({ ...prev, company_id: '', company_name_raw: '' }))}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">Nội dung vào ra (xuất) <span className="text-red-500">*</span></label>
                      <Input className="text-xs h-8" value={outLeg.content} onChange={e => setOutLeg(prev => ({ ...prev, content: e.target.value }))} placeholder="Giao hàng, xuất bán..." />
                    </div>
                    {/* Booking dự kiến cho chân xuất */}
                    <div className="border rounded-lg p-2.5 space-y-1.5 bg-white">
                      <p className="text-xs font-medium text-slate-600">Booking xuất dự kiến</p>
                      {!outSuggestEnabled ? (
                        <p className="text-[10px] text-slate-400">Điền loại xe + ĐVVT chân xuất để xem booking</p>
                      ) : outSuggestLoading ? (
                        <span className="flex items-center gap-1 text-[10px] text-slate-400">
                          <Loader2 className="h-3 w-3 animate-spin" />Đang tìm...
                        </span>
                      ) : outSuggestions[0] ? (
                        <div className="bg-green-50 border border-green-200 rounded px-2 py-1.5 text-xs space-y-0.5">
                          <div>
                            <span className="font-mono font-semibold text-green-700">{outSuggestions[0].order_code}</span>
                            {(outSuggestions[0].booking_slot_from || outSuggestions[0].booking_slot_to) && (
                              <span className="ml-2 text-green-600">{outSuggestions[0].booking_slot_from}–{outSuggestions[0].booking_slot_to}</span>
                            )}
                          </div>
                          <div className="text-slate-500 flex flex-wrap gap-x-3">
                            {outSuggestions[0].planned_boxes && <span>{outSuggestions[0].planned_boxes} thùng</span>}
                            {outSuggestions[0].planned_pallets && <span>{outSuggestions[0].planned_pallets} pallet</span>}
                            {outSuggestions[0].npp_names && <span>{outSuggestions[0].npp_names}</span>}
                            {outSuggestions[0].gdo_refs && <span className="font-mono">{outSuggestions[0].gdo_refs}</span>}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-400">Không tìm thấy booking xuất phù hợp</p>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
      </FormSheet>

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

      {/* ── Dialog: Xác nhận xóa đăng ký */}
      <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Xóa đăng ký</DialogTitle>
          </DialogHeader>
          <p className="text-sm py-2">
            Xóa đăng ký xe <span className="font-mono font-semibold">{deleteTarget?.license_plate ?? '—'}</span>?
            Hành động này không thể hoàn tác.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>Không</Button>
            <Button
              size="sm" variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => { if (deleteTarget) { deleteMut.mutate(deleteTarget.id); setDeleteTarget(null); setSelected(null) } }}
            >
              {deleteMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Trash2 className="h-3.5 w-3.5 mr-1" />Xóa</>}
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
