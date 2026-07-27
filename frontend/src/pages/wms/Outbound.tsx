import { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { Upload, Truck, CheckCircle2, AlertTriangle, X, Bookmark, Info, Plus, Trash2, PenSquare, Rows3, AlignJustify, ChevronDown, Building2, PackageCheck, ArrowRight, Download, Loader2, CalendarDays } from 'lucide-react'
import * as XLSX from 'xlsx'
import { saveWorkbook } from '@/utils/saveExcel'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SavedViews } from '@/components/shared/SavedViews'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import type { AxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { Input }  from '@/components/ui/input'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fetchMaterialsByCodes, useGDOs, useUploadGDOExcel, useUploadVl06o, useUploadKhvc, useWarehouses, useCreateGDO, useQuickExportGDO, useQuickExportExistingGDO, useUpdateGDO, usePatchGDO, useMaterials, useGDO, useAssignGDO, useVehicleTypes, useVehicleTypesByWarehouse, useTransportCompanies, useTmsVehicles, useOutboundPalletLookup, useOutboundShortages, UPLOAD_TOO_LARGE_MSG } from '@/api/hooks'
import { usePrefetchGdos } from '@/offline/prefetchScanTargets'
import { useScopedWhTypes } from '@/hooks/useUserScope'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { useActiveVehiclesStore } from '@/stores/activeVehiclesStore'
import { formatTimestampTime, formatTimestampDate } from '@/utils/formatters'
import { omniMatch } from '@/utils/omniSearch'
import { isQtyLike } from '@/utils/inventoryMode'
import { rowText, type RowStatusKey } from '@/lib/rowStatus'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { qtyLabel, qtySplit, qtyFromEntryBase, hasEntry, unitLabel, unitCodeOf, type MatUnits } from '@/utils/qtyUnits'
import { effCartonsPerPallet } from '@/utils/palletCalc'
import { ShortageBadge } from '@/components/shared/ShortageBadge'
import { QtyInput } from '@/components/shared/QtyInput'
import type { GDO } from '@/types'

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })   // 00:00–07:00 sáng VN: UTC vẫn là hôm qua → filter/min lệch ngày
// So sánh không phân biệt hoa thường và dấu ("xe container"→"Xe Container", "xe xa"→"Xe Xá")
const normalizeForMatch = (s: string) =>
  s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().trim()
const canonicalExportType = (raw: string, types: { name: string }[]) =>
  types.find(t => normalizeForMatch(t.name) === normalizeForMatch(raw))?.name ?? raw

// ─── Row text color by status (TEXT color, không fill nền) — dùng helper chung ──
export function gdoKey(gdo: GDO): RowStatusKey {
  if (gdo.status === 'COMPLETED')   return 'completed'
  if (gdo.scan_completed_at)        return 'scanDone'
  if (gdo.status === 'IN_PROGRESS') return 'inProgress'
  if (gdo.status === 'PAUSED')      return 'paused'
  if (gdo.assigned_at)              return 'assigned'
  return 'pending'
}
function gdoRowText(gdo: GDO) { return rowText(gdoKey(gdo)) }

// ─── Nhóm "cùng chuyến xe" để vẽ bracket nối (giống bảng Nhập) ──
// Cùng lượt đăng ký cổng (gate_registration_id) HOẶC cùng biển số (xe vãng lai chưa gắn cổng) = chung 1 chuyến.
type BracketPos = 'first' | 'middle' | 'last' | 'only' | 'none'
export function outboundGroupKey(g: GDO): string | null {
  const gate = (g as { gate_registration_id?: string | null }).gate_registration_id
  if (gate) return `gate:${gate}`
  const plate = (g as { license_plate?: string | null }).license_plate
  if (plate && plate.trim()) return `plate:${plate.trim().toUpperCase()}`
  return null
}

// Màu chữ 1 dòng hàng (item) theo TRẠNG THÁI (khớp màu badge item) — dùng chung list + detail material
export function itemStatusText(status: string): string {
  switch (status) {
    case 'COMPLETED':   return 'text-green-600'
    case 'IN_PROGRESS': return 'text-amber-600'
    case 'PAUSED':
    case 'CANCELLED':   return 'text-red-500'
    default:            return 'text-slate-700'
  }
}

function gdoStatusInfo(gdo: GDO): { label: string; cls: string } {
  if (gdo.status === 'COMPLETED')   return { label: 'Hoàn thành', cls: 'bg-blue-100 text-blue-700'   }
  if (gdo.status === 'IN_PROGRESS') return { label: 'Đang xuất',  cls: 'bg-amber-100 text-amber-700' }
  if (gdo.status === 'PAUSED')      return { label: 'Tạm dừng',   cls: 'bg-red-100 text-red-700'     }
  if (gdo.assigned_at)              return { label: 'Giao đơn',   cls: 'bg-green-100 text-green-700' }
  return                                   { label: '—',           cls: 'bg-slate-100 text-slate-400' }
}

function naturalSortCode(a: string, b: string): number {
  const numA = parseInt(a.match(/(\d+)$/)?.[1] ?? '0', 10)
  const numB = parseInt(b.match(/(\d+)$/)?.[1] ?? '0', 10)
  if (numA !== numB) return numA - numB
  return a.localeCompare(b)
}

function fTime(ts: string | null | undefined): string {
  if (!ts) return '—'
  return formatTimestampTime(ts)
}

// useWarehouses() trả any[] (dùng nhiều nơi) → cast cục bộ sang type tối thiểu thay cho `as any`
type WarehouseLite = { id: string; name: string; code?: string; is_active?: boolean; warehouse_type?: string | null; inventory_mode?: string | null; parent_warehouse_id?: string | null; shipto_codes?: string[] | null }

// Cặp nội bộ parent↔kho phụ (cùng site): biển số tùy chọn khi Xuất luôn (BE cũng nới tương ứng)
function isInternalPairFE(whs: WarehouseLite[], sourceWhId: string, shiptoCode: string): boolean {
  if (!sourceWhId || !shiptoCode) return false
  const dest = whs.find(w => w.code === shiptoCode || (w.shipto_codes ?? []).includes(shiptoCode))
  if (!dest) return false
  const src = whs.find(w => w.id === sourceWhId)
  return dest.parent_warehouse_id === sourceWhId || (src?.parent_warehouse_id ?? null) === dest.id
}

const OUTBOUND_COLS: { id: string; label: string; w: number; align?: 'right' }[] = [
  { id: 'pin',       label: '',              w: 34 },
  { id: 'date',      label: 'Ngày xuất',     w: 96 },
  { id: 'code',      label: 'Số xe',         w: 132 },
  { id: 'npp',       label: 'Tên NPP',       w: 150 },
  { id: 'shipto',    label: 'Ship-to',       w: 96 },
  { id: 'dvvt',      label: 'ĐVVT',          w: 80 },
  { id: 'plate',     label: 'Biển số xe',    w: 110 },
  { id: 'cartons',   label: 'Tổng thùng',    w: 118, align: 'right' },
  { id: 'cartons_qr', label: 'Tổng (QR)',    w: 118, align: 'right' },
  { id: 'cartons_noqr', label: 'Tổng (k QR)', w: 118, align: 'right' },
  { id: 'loose',     label: 'Tổng nhặt lẻ',  w: 118, align: 'right' },
  { id: 'pallets',   label: 'Pallet',        w: 72,  align: 'right' },
  { id: 'warehouse', label: 'Kho xuất',      w: 110 },
  { id: 'exptype',   label: 'Loại xe',       w: 100 },
  { id: 'whtype',    label: 'Loại kho',      w: 96 },
  { id: 'assigned',  label: 'Giờ giao đơn',  w: 96 },
  { id: 'started',   label: 'Giờ bắt đầu',   w: 90 },
  { id: 'scandone',  label: 'Giờ quét xong', w: 96 },
  { id: 'completed', label: 'Giờ kết thúc',  w: 90 },
  { id: 'status',    label: 'Tình trạng',    w: 92 },
  { id: 'transfer',  label: 'Chuyển kho',    w: 92 },
  { id: 'exporter',  label: 'Người xuất',    w: 104 },
  { id: 'forklift',  label: 'Lái xe nâng',   w: 104 },
  { id: 'loader',    label: 'Bốc xếp',       w: 104 },
  { id: 'do',        label: 'Số DO',         w: 120 },
]
const OUTBOUND_COL_DEFAULTS = OUTBOUND_COLS.map(c => c.w)
// Pallet là số lẻ (thùng / thùng-mỗi-pallet) → làm tròn 2 chữ số, cắt đuôi 0 (tránh "3.5300000000000002")
const fmtPallets = (n: number | null | undefined) => +(Number(n ?? 0).toFixed(2))

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

// Hiển thị TỔNG số lượng 1 chuyến theo ĐƠN VỊ KHAI BÁO (base-unit, user 22/07):
// - Đơn MỌI mã CÙNG đơn vị (qty_unit != null) → "N thùng + M base" chính xác (vd 146 thùng + 4 chai).
// - Nhiều mã khác đơn vị (chai+hộp+kg) → không cộng được → thùng QUY ĐỔI, format vi-VN (dấu phẩy thập phân
//   để KHÔNG đọc nhầm "146.083" thành 146 nghìn) + tooltip.
function GdoQty({ base, decimal, unit, zeroDash }: {
  base?: number; decimal?: number; unit?: GDO['qty_unit']; zeroDash?: boolean
}) {
  const d = Number(decimal ?? 0)
  if (zeroDash && !d) return <span className="text-slate-300">—</span>
  if (unit) { const s = qtyLabel(Number(base ?? 0), unit); return <span className="text-[10px] font-semibold tabular-nums" title={s}>{s}</span> }
  return (
    <span title="Thùng quy đổi (đơn nhiều mã khác đơn vị)">
      <span className="text-[10px] font-semibold tabular-nums">{d.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}</span>
      <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
    </span>
  )
}

// ─── Pane phải + Live Tiles (Manhattan Insight) — chuẩn list→detail như Inbound ───
function OutboundPane({ gdo, onClose }: { gdo: GDO; onClose: () => void }) {
  const navigate = useNavigate()
  const st  = gdoStatusInfo(gdo)
  const npp = gdo.distributor_names?.join(', ') || '—'
  const cartons   = gdo.total_cartons ?? 0
  const noqr      = gdo.total_cartons_noqr ?? 0
  const unit      = gdo.qty_unit
  // Tile Thùng: đơn CÙNG đơn vị → số lớn = ĐVT chính (thùng nếu có entry, ngược lại base) + dòng nhỏ phần lẻ;
  // nhiều mã khác đơn vị → thùng quy đổi (format vi-VN).
  const tileSplit = unit ? qtySplit(gdo.total_cartons_base ?? 0, unit) : null
  const tileBig   = tileSplit
    ? (hasEntry(unit) ? tileSplit.entry : tileSplit.base).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
    : cartons.toLocaleString('vi-VN', { maximumFractionDigits: 1 })
  const tileLbl   = tileSplit
    ? (hasEntry(unit) ? unitLabel(unit!.entry_unit) + (tileSplit.base ? ` +${tileSplit.base} ${unitLabel(unit!.base_unit)}` : '') : unitLabel(unit!.base_unit))
    : 'Thùng quy đổi'
  const noqrText  = unit ? qtyLabel(gdo.total_noqr_base ?? 0, unit) : `${noqr.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} thùng`
  const Row = ({ k, v }: { k: string; v: string }) => (
    <div className="flex justify-between gap-2 text-[11px]"><span className="text-slate-400 shrink-0">{k}</span><span className="text-slate-700 text-right truncate">{v}</span></div>
  )
  return (
    <aside className="hidden lg:flex flex-col w-56 shrink-0 border-l border-slate-200 bg-slate-50">
      <div className="px-3 py-2 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between">
          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium ${st.cls}`}>{st.label}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" title="Đóng"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className={`mt-1 text-sm font-mono font-semibold leading-tight ${gdoRowText(gdo)}`}>{gdo.group_code}</div>
        <div className="text-[11px] text-slate-500 mt-1 truncate" title={npp}>NPP: <span className="font-medium text-slate-700">{npp}</span></div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {/* Số dài (thùng quy đổi 3 số lẻ) tràn tile w-56/2 → gọn 1 số lẻ + co cỡ chữ khi quá dài (user 22/07) */}
          <div className="rounded-lg bg-sky-600 text-white px-1.5 py-2.5 text-center overflow-hidden">
            <div className={`${tileBig.length >= 6 ? 'text-base' : 'text-xl'} font-bold leading-none tabular-nums`}>{tileBig}</div>
            <div className="text-[9px] mt-1 text-sky-100 uppercase tracking-wide truncate">{tileLbl}</div>
          </div>
          <div className="rounded-lg bg-sky-700 text-white px-1.5 py-2.5 text-center overflow-hidden">
            <div className="text-xl font-bold leading-none tabular-nums">{fmtPallets(gdo.total_pallets).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}</div>
            <div className="text-[9px] mt-1 text-sky-100 uppercase tracking-wide">Pallet</div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 space-y-1">
          <Row k="Kho xuất" v={gdo.warehouse?.name ?? '—'} />
          <Row k="Loại kho" v={gdo.warehouse_type ?? '—'} />
          <Row k="ĐVVT" v={gdo.dvvt ?? '—'} />
          <Row k="Loại xe" v={gdo.export_type ?? '—'} />
          {noqr > 0 && <Row k="Tổng (k QR)" v={noqrText} />}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 space-y-1">
          <Row k="Giao đơn"  v={fTime(gdo.assigned_at)} />
          <Row k="Bắt đầu"   v={fTime(gdo.started_at)} />
          <Row k="Quét xong" v={fTime(gdo.scan_completed_at)} />
          <Row k="Kết thúc"  v={fTime(gdo.completed_at)} />
        </div>

        <button onClick={() => navigate(`/wms/outbound/${gdo.id}`)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-blue-300 hover:text-blue-600 transition-colors flex items-center justify-between">
          Mở chi tiết <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </aside>
  )
}

export default function Outbound() {
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)
  const perms    = user?.module_permissions as ModulePermissions | null ?? null
  const fileRef  = useRef<HTMLInputElement>(null)

  const { outbound: f, setOutbound } = useWmsFilterStore()
  const [uploadErr,       setUploadErr]       = useState<string | null>(null)
  const [uploadOk,        setUploadOk]        = useState<string | null>(null)
  const [uploadWarn,      setUploadWarn]      = useState<string | null>(null)
  const [postUploadLoading, setPostUploadLoading] = useState(false)
  const [showCreate,  setShowCreate]  = useState(false)
  const [showUpload,  setShowUpload]  = useState(false)
  // ĐỢT 3: "Up kế hoạch VC" — 2 bước (VL06O raw → KHVC sinh chuyến)
  const [showVcUpload, setShowVcUpload] = useState(false)
  const vl06oRef = useRef<HTMLInputElement>(null)
  const khvcRef  = useRef<HTMLInputElement>(null)
  const [vl06oOk,  setVl06oOk]  = useState<string | null>(null)
  const [vl06oErr, setVl06oErr] = useState<string | null>(null)
  const [vl06oUnitErrs, setVl06oUnitErrs] = useState<{ material_code: string; material_name: string; kind: string; file_value: string; system_value: string }[] | null>(null)
  const [vcOk,     setVcOk]     = useState<string | null>(null)
  const [vcErr,    setVcErr]    = useState<string | null>(null)
  // v2.7 — cảnh báo TRƯỚC khi ghi (preflight): giữ file chờ xác nhận + số liệu cảnh báo
  const [vl06oWarn, setVl06oWarn] = useState<{ file: File; dos_on_trips: number; trips_in_progress: number; scanned_items: number } | null>(null)
  const [khvcWarn,  setKhvcWarn]  = useState<{ file: File; trips: { total: number; in_progress: number; completed: number; paused: number }; vl06o_last_synced: string | null; missing_dos: number; missing_dos_sample: string[]; cross_trip_dos: number; cross_trip_sample: string[] } | null>(null)
  const [dense, setDense] = useState(() => localStorage.getItem('outbound_density') !== 'comfortable')
  const [nppOpen, setNppOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Multi-select chuyến PENDING → chuyển ngày xuất hàng loạt (đơn rớt ngày — user 22/07)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [showMoveDate, setShowMoveDate] = useState(false)
  const [moveDate, setMoveDate] = useState('')
  const [movingDates, setMovingDates] = useState(false)
  const [moveErrs, setMoveErrs] = useState<string[]>([])
  const [moveOk, setMoveOk] = useState<string | null>(null)
  const isDesktop = useIsDesktop()
  const { widths: colW, startResize, totalWidth } = useColumnResize('outbound_col_widths', OUTBOUND_COL_DEFAULTS)
  function toggleDensity() {
    setDense(d => { localStorage.setItem('outbound_density', d ? 'comfortable' : 'compact'); return !d })
  }

  const { data: warehouses = [] } = useWarehouses(true)
  // Tra kho theo tên/mã NPP (SỐNG từ Warehouse) → mã kho + mode (None/QR/QTY) ở cột Ship-to.
  // Đổi inventory_mode HOẶC thêm kho mới ở Warehouse là cột này cập nhật ngay (không cần re-upload).
  // NPP không khớp kho nào = không hiện gì → biết NPP nào còn thiếu trong DB.
  const whInfoByKey = useMemo(() => {
    const m = new Map<string, { code: string; mode: string }>()
    for (const w of warehouses as WarehouseLite[]) {
      if (!w.inventory_mode || !w.code) continue
      const info = { code: w.code, mode: w.inventory_mode }
      if (w.name) m.set(w.name.trim().toLowerCase(), info)
      m.set(w.code.trim().toLowerCase(), info)
    }
    return m
  }, [warehouses])

  const outboundAllowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids)
    : null

  useEffect(() => {
    if (!f.warehouseId) {
      const defaultId = user?.warehouse_ids?.[0] ?? user?.warehouse_id ?? ''
      if (defaultId) setOutbound({ warehouseId: defaultId })
    }
  }, [user?.warehouse_id]) // eslint-disable-line

  const { data: gdos = [], isLoading, isFetching } = useGDOs({
    warehouse_id: f.warehouseId || undefined,
    // search lọc client-side (omni đa cột) — không gửi lên BE để không bị thu hẹp theo mỗi group_code
    date_from: f.dateFrom || undefined,
    date_to:   f.dateTo   || undefined,
  })
  // Prefetch chi tiết chuyến ĐANG CHẠY khi có mạng → offline quét được cả chuyến chưa bấm vào
  usePrefetchGdos(gdos)
  // (BỎ prefetch cả danh mục mã hàng — ô chọn mã trong form nay TÌM TRÊN SERVER theo từ khóa,
  //  không cần danh mục nằm sẵn trong trình duyệt. Trước đây mở trang Xuất kho là tải ~2,5MB.)
  const { mutate: uploadExcel, isPending: uploading } = useUploadGDOExcel()
  const { mutate: uploadVl06o, isPending: vl06oUploading } = useUploadVl06o()
  const { mutate: uploadKhvc,  isPending: khvcUploading }  = useUploadKhvc()
  const { mutate: assignGDO } = useAssignGDO()
  const { mutateAsync: patchGDOAsync } = usePatchGDO()
  // Tem pallet: quét/gõ mã tem ở ô tìm kiếm → ra chuyến đã xuất pallet đó
  const { data: palletGdoIds = [] } = useOutboundPalletLookup(f.search)
  const palletGdoSet = useMemo(() => new Set(palletGdoIds), [palletGdoIds])

  useEffect(() => {
    if (postUploadLoading && !isFetching) setPostUploadLoading(false)
  }, [isFetching, postUploadLoading])

  const typeOptions       = useMemo(() => [...new Set(gdos.map(g => g.export_type).filter(Boolean))] as string[], [gdos])
  const dvvtOptions       = useMemo(() => [...new Set(gdos.map(g => g.dvvt).filter(Boolean))] as string[], [gdos])
  const nppOptions        = useMemo(() => [...new Set(gdos.flatMap(g => g.distributor_names ?? []).filter(Boolean))], [gdos])
  const warehouseTypeOpts = useMemo(() => [...new Set(gdos.map(g => g.warehouse_type).filter(Boolean))] as string[], [gdos])
  const materialOptions   = useMemo(() => {
    const seen = new Map<string, string>()  // code → label
    for (const g of gdos) for (const b of g.item_breakdown ?? []) {
      if (!seen.has(b.material_code))
        seen.set(b.material_code, b.material_name ? `${b.material_code} · ${b.material_name}` : b.material_code)
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, label]) => ({ value, label }))
  }, [gdos])

  const filterTypes          = f.filterTypes          ?? []
  const filterDvvts          = f.filterDvvts          ?? []
  const filterNpps           = f.filterNpps           ?? []
  const filterMaterials      = f.filterMaterials      ?? []
  const filterWarehouseTypes = f.filterWarehouseTypes ?? []
  const filterStatuses       = f.filterStatuses       ?? []

  const statusOptions = useMemo(() => {
    const labels = new Set<string>()
    for (const g of gdos) { const { label } = gdoStatusInfo(g); if (label !== '—') labels.add(label) }
    return [...labels].map(l => ({ value: l, label: l }))
  }, [gdos])

  const filtered = useMemo(() => gdos.filter(g => {
    if (filterTypes.length          > 0 && !filterTypes.includes(g.export_type ?? ''))                              return false
    if (filterDvvts.length          > 0 && !filterDvvts.includes(g.dvvt ?? ''))                                     return false
    if (filterNpps.length           > 0 && !(g.distributor_names ?? []).some(n => filterNpps.includes(n)))          return false
    if (filterMaterials.length      > 0 && !(g.item_breakdown ?? []).some(b => filterMaterials.includes(b.material_code))) return false
    if (filterWarehouseTypes.length > 0 && !filterWarehouseTypes.includes(g.warehouse_type ?? ''))                  return false
    if (filterStatuses.length       > 0 && !filterStatuses.includes(gdoStatusInfo(g).label))                        return false
    // Search khớp cả mã/tên hàng (item_breakdown) → gõ mã hàng ra đơn xuất chứa mã đó.
    // + tem pallet: chuyến khớp nếu id nằm trong kết quả tra tem (palletGdoSet).
    if (!omniMatch([g.group_code, g.export_type, g.dvvt, g.warehouse_type, gdoStatusInfo(g).label,
      ...(g.distributor_names ?? []),
      ...(g.item_breakdown ?? []).flatMap(b => [b.material_code, b.material_name])], f.search)
      && !((f.search ?? '').trim() && palletGdoSet.has(g.id))) return false
    return true
  }), [gdos, f.search, filterTypes, filterDvvts, filterNpps, filterMaterials, filterWarehouseTypes, filterStatuses, palletGdoSet])

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    if (a.delivery_date !== b.delivery_date)
      return b.delivery_date.localeCompare(a.delivery_date)
    // Gom các chuyến chung 1 xe liền nhau (để nối bracket); chuyến có nhóm xếp trước
    const keyA = outboundGroupKey(a) ?? '', keyB = outboundGroupKey(b) ?? ''
    if (keyA !== keyB) {
      if (!keyA && keyB) return 1
      if (keyA && !keyB) return -1
      return keyA.localeCompare(keyB)
    }
    const ta = a.export_type ?? '', tb = b.export_type ?? ''
    if (ta !== tb) return tb.localeCompare(ta)
    return naturalSortCode(a.group_code, b.group_code)
  }), [filtered])

  // Vị trí bracket cho mỗi chuyến trong nhóm "cùng xe" (cùng ngày + cùng outboundGroupKey)
  const bracketPositions = useMemo(() => {
    const pos = new Map<string, BracketPos>()
    const n = sorted.length
    for (let i = 0; i < n; i++) {
      const g = sorted[i]
      const key = outboundGroupKey(g)
      if (!key) { pos.set(g.id, 'none'); continue }
      const prevOk = i > 0 && sorted[i - 1].delivery_date === g.delivery_date && outboundGroupKey(sorted[i - 1]) === key
      const nextOk = i < n - 1 && sorted[i + 1].delivery_date === g.delivery_date && outboundGroupKey(sorted[i + 1]) === key
      if (!prevOk && !nextOk) pos.set(g.id, 'only')
      else if (!prevOk) pos.set(g.id, 'first')
      else if (!nextOk) pos.set(g.id, 'last')
      else pos.set(g.id, 'middle')
    }
    return pos
  }, [sorted])

  const summary = useMemo(() => ({
    count:     sorted.length,
    cartons:   sorted.reduce((s, g) => s + (g.total_cartons ?? 0), 0),
    cartonsQr:   sorted.reduce((s, g) => s + ((g.total_cartons ?? 0) - (g.total_cartons_noqr ?? 0)), 0),
    cartonsNoqr: sorted.reduce((s, g) => s + (g.total_cartons_noqr ?? 0), 0),
    pallets:   sorted.reduce((s, g) => s + (g.total_pallets ?? 0), 0),
    completed: sorted.filter(g => g.status === 'COMPLETED').length,
  }), [sorted])

  // Phân bổ theo NPP — gom item_breakdown của các chuyến đã lọc; nếu đang lọc mã hàng thì
  // chỉ tính mã hàng đó (gõ mã hàng → đi những nhà nào, bao nhiêu, tổng). Kiểu expand Inbound.
  const nppBreakdown = useMemo(() => {
    const map = new Map<string, { npp: string; planned: number; scanned: number }>()
    for (const g of sorted) for (const b of g.item_breakdown ?? []) {
      if (filterMaterials.length > 0 && !filterMaterials.includes(b.material_code)) continue
      const npp = b.distributor_name ?? '(không tên)'
      const cur = map.get(npp) ?? { npp, planned: 0, scanned: 0 }
      cur.planned += b.cartons
      cur.scanned += b.cartons_scanned ?? 0
      map.set(npp, cur)
    }
    return [...map.values()]
      .map(r => ({ ...r, remaining: Math.max(0, r.planned - r.scanned) }))
      .sort((a, b) => b.planned - a.planned)
  }, [sorted, filterMaterials])
  const nppTotals = useMemo(() => ({
    planned:   nppBreakdown.reduce((s, r) => s + r.planned, 0),
    scanned:   nppBreakdown.reduce((s, r) => s + r.scanned, 0),
    remaining: nppBreakdown.reduce((s, r) => s + r.remaining, 0),
  }), [nppBreakdown])

  // Tải mẫu Excel Xuất kho — cột khớp uploadExcel (backend). Ngày + ddmmyy động (ngày mai) để không quá khứ.
  function downloadTemplate() {
    const d = new Date(); d.setDate(d.getDate() + 1)
    const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0'), yyyy = d.getFullYear()
    const ddmmyy = `${dd}${mm}${String(yyyy).slice(2)}`
    const headers = ['Số xe', 'Ngày xuất', 'Kho xuất', 'Loại kho', 'DVVT', 'Delivery', 'Tên NPP', 'Material', 'Material_type',
      'Thùng', 'Hộp', 'Tải', 'Nhặt lẻ', 'Pallet', 'Loại xuất', 'HEADER TEXT', 'Batch_Yêu cầu', '%Date_Yêu cầu', 'CS phụ trách', 'Shipto party']
    const ex = [`20000016_X_${ddmmyy}_01`, `${dd}/${mm}/${yyyy}`, 'Kho Ba Vì', 'Thành phẩm', '3S', 'DO-0001', 'NPP mẫu',
      '510000126', '', 100, '', '', 0, 5, '', '', '', '', '', '']
    const ws = XLSX.utils.aoa_to_sheet([headers, ex])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'XuatKho')
    saveWorkbook(wb, 'mau_xuat_kho.xlsx')
  }

  // ─── ĐỢT 3: mẫu VL06O (giữ NGUYÊN tên cột SAP, rút gọn còn cột cần) + mẫu KHVC (tự soạn, gọn) ───
  function downloadVl06oTemplate() {
    const headers = ['Delivery', 'Item', 'Ship-to Party', 'Material', 'Item Description',
      'Delivery Quantity', 'Sales Unit', 'Actual delivery qty', 'Base Unit of Measure',
      'Name ship-to party', 'Batch', 'Date (%)', 'Ghi chú giao hàng', 'Ghi chú hoá đơn']
    const ex = ['3000384084', '10', '30000325', '510000306', 'BAVI SCA Có đường 100grx48',
      40, 'CAR', 1920, 'HOP', 'NPPTRANGHOANG', '', '', '', '']
    const ws = XLSX.utils.aoa_to_sheet([headers, ex])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Data')
    saveWorkbook(wb, 'mau_vl06o.xlsx')
  }
  function downloadKhvcTemplate() {
    const d = new Date(); d.setDate(d.getDate() + 1)
    const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0'), yyyy = d.getFullYear()
    const ddmmyy = `${dd}${mm}${String(yyyy).slice(2)}`
    const headers = ['Ngày xuất', 'Số xe', 'DO', 'Tên NPP', 'Loại xe', 'DVVT', 'Ưu tiên', 'CS phụ trách', 'Note']
    const ex = [`${dd}/${mm}/${yyyy}`, `20000016_X_${ddmmyy}_01`, '3000384084', 'NPPTRANGHOANG', 'Xe Pallet', 'DA', '1', 'Nguyễn Văn A', 'Giao gấp trước 10h']
    const ws = XLSX.utils.aoa_to_sheet([headers, ex])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Ke hoach dieu van')
    saveWorkbook(wb, 'mau_khvc.xlsx')
  }

  function handleVl06oChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''
    setVl06oErr(null); setVl06oOk(null); setVl06oUnitErrs(null); setVl06oWarn(null)
    // v2.7: preflight — nếu file chứa DO đã lên chuyến → cảnh báo trước, chờ xác nhận. Lỗi preflight → up thẳng.
    uploadVl06o({ file, preflight: true }, {
      onSuccess: (pf: { dos_on_trips?: number; trips_in_progress?: number; scanned_items?: number }) => {
        if (Number(pf?.dos_on_trips) > 0) setVl06oWarn({ file, dos_on_trips: Number(pf.dos_on_trips), trips_in_progress: Number(pf.trips_in_progress ?? 0), scanned_items: Number(pf.scanned_items ?? 0) })
        else doVl06oUpload(file)
      },
      onError: () => doVl06oUpload(file),
    })
  }
  function doVl06oUpload(file: File) {
    setVl06oErr(null); setVl06oOk(null); setVl06oUnitErrs(null); setVl06oWarn(null)
    uploadVl06o({ file }, {
      onSuccess: (r: { rows: number; deliveries: number; skipped_no_key: number; warning_count: number; warnings: string[] }) => {
        const parts = [`Lưu ${r.rows} dòng · ${r.deliveries} DO`]
        if (r.skipped_no_key) parts.push(`bỏ ${r.skipped_no_key} dòng thiếu Delivery/Item`)
        let msg = parts.join(' · ')
        if (r.warning_count) msg += `\n⚠ ${r.warning_count} cảnh báo:\n` + r.warnings.map(w => `  • ${w}`).join('\n')
        setVl06oOk(msg)
      },
      onError: (err) => {
        const ax = err as AxiosError<{ error: { message: string }; unit_errors?: { material_code: string; material_name: string; kind: string; file_value: string; system_value: string }[] }>
        const data = ax?.response?.data
        if (data?.unit_errors?.length) setVl06oUnitErrs(data.unit_errors)
        setVl06oErr(data?.error?.message ?? (ax?.response?.status === 413 ? UPLOAD_TOO_LARGE_MSG : 'Lỗi upload VL06O'))
      },
    })
  }

  function handleKhvcChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''
    setVcErr(null); setVcOk(null); setKhvcWarn(null)
    // v2.7: preflight — ngày này đã có chuyến / DO chưa sẵn sàng → cảnh báo trước. Lỗi preflight → up thẳng.
    uploadKhvc({ file, preflight: true }, {
      onSuccess: (pf: { trips?: { total: number; in_progress: number; completed: number; paused: number }; vl06o_last_synced?: string | null; missing_dos?: number; missing_dos_sample?: string[]; cross_trip_dos?: number; cross_trip_sample?: string[] }) => {
        const trips = pf?.trips ?? { total: 0, in_progress: 0, completed: 0, paused: 0 }
        if (trips.total > 0 || Number(pf?.missing_dos) > 0 || Number(pf?.cross_trip_dos) > 0)
          setKhvcWarn({ file, trips, vl06o_last_synced: pf?.vl06o_last_synced ?? null, missing_dos: Number(pf?.missing_dos ?? 0), missing_dos_sample: pf?.missing_dos_sample ?? [], cross_trip_dos: Number(pf?.cross_trip_dos ?? 0), cross_trip_sample: pf?.cross_trip_sample ?? [] })
        else doKhvcUpload(file)
      },
      onError: () => doKhvcUpload(file),
    })
  }
  function doKhvcUpload(file: File) {
    setVcErr(null); setVcOk(null); setKhvcWarn(null)
    setPostUploadLoading(true)
    uploadKhvc({ file }, {
      onSuccess: (result: { created?: Array<{ created?: boolean; merged?: boolean; skipped?: boolean }> }) => {
        const items = result.created ?? []
        const nCreated = items.filter(r => r.created && !r.merged).length
        const nMerged  = items.filter(r => r.merged).length
        const nSkipped = items.filter(r => r.skipped).length
        setVcOk([
          nCreated > 0 && `Tạo mới ${nCreated} chuyến`,
          nMerged  > 0 && `Cập nhật ${nMerged} chuyến (PAUSED)`,
          nSkipped > 0 && `Bỏ qua ${nSkipped} chuyến (đang xuất/đã HT)`,
        ].filter(Boolean).join(' · ') || 'Không có chuyến mới')
      },
      onError: (err) => {
        setPostUploadLoading(false)
        const ax = err as AxiosError<{ error: { message: string }; validation_errors?: { group_code: string; errors: string[] }[] }>
        const data = ax?.response?.data
        const ve = data?.validation_errors
        if (ve?.length) {
          const lines = [data!.error.message, '']
          for (const { group_code, errors } of ve) { lines.push(`Số xe: ${group_code}`); for (const m of errors) lines.push(`  • ${m}`) }
          setVcErr(lines.join('\n'))
        } else {
          setVcErr(data?.error?.message ?? (ax?.response?.status === 413 ? UPLOAD_TOO_LARGE_MSG : 'Lỗi upload KHVC'))
        }
      },
    })
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadErr(null); setUploadOk(null); setUploadWarn(null)
    setPostUploadLoading(true)
    uploadExcel(
      { file, warehouse_id: user?.warehouse_id || undefined },
      {
        onSuccess: (result) => {
          const items = (result.created ?? []) as Array<{ group_code: string; created?: boolean; merged?: boolean; skipped?: boolean; reason?: string }>
          const nCreated = items.filter(r => r.created && !r.merged).length
          const nMerged  = items.filter(r => r.merged).length
          const skipped  = items.filter(r => r.skipped)
          const okParts = [
            nCreated > 0 && `Tạo mới ${nCreated} xe`,
            nMerged  > 0 && `Cập nhật ${nMerged} xe (PAUSED)`,
          ].filter(Boolean).join(' · ')
          setUploadOk(okParts || (skipped.length ? null : 'Không có xe mới'))
          if (skipped.length) {
            type SkippedItem = { group_code: string; reason?: string }
            const CATS: { key: string; label: string; match: (r: string) => boolean; detailPrefix?: string }[] = [
              { key: 'format',    label: 'Mã xe sai format ngày ddmmyy_',          match: r => r.includes('tiền tố ngày ddmmyy_') },
              { key: 'date',      label: 'Ngày xuất không hợp lệ',                 match: r => r.includes('Ngày xuất không hợp lệ'), detailPrefix: 'Ngày xuất không hợp lệ hoặc trống: ' },
              { key: 'mat',       label: 'Mã hàng không có trong hệ thống',        match: r => r.includes('Mã hàng không tìm thấy'),  detailPrefix: 'Mã hàng không tìm thấy: ' },
              { key: 'wh',        label: 'Kho xuất không tìm thấy',                match: r => r.includes('tìm thấy kho') || r.includes('Thiếu thông tin kho') },
              { key: 'completed', label: 'Đã hoàn thành — bỏ qua, không ghi đè',   match: r => r.includes('Đã hoàn thành') },
              { key: 'progress',  label: 'Đang xuất — bỏ qua, không ghi đè',       match: r => r.includes('Đang xuất') },
              { key: 'missing',   label: 'Mã hàng đã xuất bị xóa khỏi file mới',  match: r => r.includes('đã xuất không có trong file'), detailPrefix: 'Mã hàng đã xuất không có trong file mới: ' },
              { key: 'cartons',   label: 'Số thùng mới nhỏ hơn đã xuất',          match: r => r.includes('Số thùng mới nhỏ hơn'),       detailPrefix: 'Số thùng mới nhỏ hơn đã xuất: ' },
              { key: 'other',     label: 'Lỗi khác',                               match: () => true },
            ]
            const groups = new Map<string, { label: string; detailPrefix?: string; items: SkippedItem[] }>()
            for (const item of skipped) {
              const cat = CATS.find(c => c.match(item.reason ?? ''))!
              if (!groups.has(cat.key)) groups.set(cat.key, { label: cat.label, detailPrefix: cat.detailPrefix, items: [] })
              groups.get(cat.key)!.items.push(item)
            }
            const lines = [`Bỏ qua ${skipped.length} chuyến xe:`]
            for (const { label, detailPrefix, items } of groups.values()) {
              lines.push(`\n[${label}] — ${items.length} xe:`)
              for (const item of items) {
                const detail = detailPrefix ? (item.reason ?? '').replace(detailPrefix, '').trim() : ''
                lines.push(detail ? `  • ${item.group_code}: ${detail}` : `  • ${item.group_code}`)
              }
            }
            setUploadWarn(lines.join('\n'))
          }
        },
        onError: (err) => {
          setPostUploadLoading(false)
          const axErr = err as AxiosError<{ error: { message: string }; validation_errors?: { group_code: string; errors: string[] }[] }>
          const data = axErr?.response?.data
          const ve = data?.validation_errors
          if (ve?.length) {
            const lines = [data!.error.message, '']
            for (const { group_code, errors } of ve) {
              lines.push(`Số xe: ${group_code}`)
              for (const e of errors) lines.push(`  • ${e}`)
            }
            setUploadErr(lines.join('\n'))
          } else {
            // 413 = Vercel chặn body >4.5MB, trả text thô (không phải JSON app)
            setUploadErr(data?.error?.message ?? (axErr?.response?.status === 413 ? UPLOAD_TOO_LARGE_MSG : 'Lỗi upload file'))
          }
        },
      }
    )
    e.target.value = ''
  }

  const hasDate = f.dateFrom || f.dateTo
  const isToday = f.dateFrom === TODAY && f.dateTo === TODAY
  let dateLabel = 'Tất cả ngày'
  if (f.dateFrom && f.dateTo) {
    dateLabel = f.dateFrom === f.dateTo
      ? format(parseISO(f.dateFrom), 'EEEE, dd-MM-yyyy', { locale: vi })
      : `${format(parseISO(f.dateFrom), 'dd-MM-yyyy')} – ${format(parseISO(f.dateTo), 'dd-MM-yyyy')}`
  } else if (f.dateFrom) {
    dateLabel = `Từ ${format(parseISO(f.dateFrom), 'dd-MM-yyyy')}`
  } else if (f.dateTo) {
    dateLabel = `Đến ${format(parseISO(f.dateTo), 'dd-MM-yyyy')}`
  }

  // ─── Filter chip bar (Manhattan) ───
  const warehouseOptions = (warehouses as WarehouseLite[])
    .filter(w => !outboundAllowedWhIds || outboundAllowedWhIds.has(w.id))
    .map(w => ({ value: w.id, label: w.name }))

  const filterDefs: FilterDef[] = [
    { key: 'date',     label: 'Ngày xuất', type: 'daterange', from: f.dateFrom, to: f.dateTo,
      onChange: (from, to) => setOutbound({ dateFrom: from, dateTo: to }) },
    { key: 'warehouse', label: 'Kho xuất', type: 'single', options: warehouseOptions, value: f.warehouseId || '', allLabel: 'Tất cả kho',
      onChange: v => setOutbound({ warehouseId: v }) },
    { key: 'whType',   label: 'Loại kho',  type: 'multi',  options: warehouseTypeOpts.map(t => ({ value: t, label: t })), selected: filterWarehouseTypes,
      onChange: v => setOutbound({ filterWarehouseTypes: v }) },
    { key: 'vehType',  label: 'Loại xe',   type: 'multi',  options: typeOptions.map(t => ({ value: t, label: t })), selected: filterTypes,
      onChange: v => setOutbound({ filterTypes: v }) },
    { key: 'dvvt',     label: 'ĐVVT',      type: 'multi',  options: dvvtOptions.map(d => ({ value: d, label: d })), selected: filterDvvts,
      onChange: v => setOutbound({ filterDvvts: v }) },
    { key: 'npp',      label: 'NPP',       type: 'multi',  options: nppOptions.map(n => ({ value: n, label: n })), selected: filterNpps, searchable: true,
      onChange: v => setOutbound({ filterNpps: v }) },
    { key: 'material', label: 'Mã hàng',   type: 'multi',  options: materialOptions, selected: filterMaterials, searchable: true,
      onChange: v => setOutbound({ filterMaterials: v }) },
    { key: 'status',   label: 'Tình trạng', type: 'multi', options: statusOptions, selected: filterStatuses,
      onChange: v => setOutbound({ filterStatuses: v }) },
  ]

  // ─── Chuyển ngày xuất hàng loạt (multi-select chuyến PENDING — đơn rớt ngày, user 22/07) ───
  const canEditGdo = can(perms, 'outbound', 'edit')
  const pendingIdsOnScreen = useMemo(() => sorted.filter(g => g.status === 'PENDING').map(g => g.id), [sorted])
  const allPendingChecked = pendingIdsOnScreen.length > 0 && pendingIdsOnScreen.every(id => checkedIds.has(id))
  function toggleCheckAll() {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (allPendingChecked) pendingIdsOnScreen.forEach(id => next.delete(id))
      else pendingIdsOnScreen.forEach(id => next.add(id))
      return next
    })
  }
  function toggleCheck(id: string) {
    setCheckedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  // Chỉ thao tác trên chuyến CÒN trên màn hình + còn PENDING (chuyến đổi trạng thái giữa chừng thì bỏ qua)
  const moveTargets = useMemo(() => sorted.filter(g => checkedIds.has(g.id) && g.status === 'PENDING'), [sorted, checkedIds])
  async function handleMoveDates() {
    if (!moveDate || moveTargets.length === 0) return
    setMovingDates(true); setMoveErrs([]); setMoveOk(null)
    const results = await Promise.allSettled(moveTargets.map(g => patchGDOAsync({ id: g.id, delivery_date: moveDate })))
    const errs: string[] = []
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const msg = (r.reason as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
        errs.push(`${moveTargets[i].group_code}: ${msg}`)
      }
    })
    setMovingDates(false)
    const okCount = results.length - errs.length
    setMoveErrs(errs)
    setMoveOk(okCount > 0 ? `Đã chuyển ${okCount}/${results.length} chuyến sang ngày ${format(parseISO(moveDate), 'dd-MM-yyyy')}.` : null)
    if (okCount > 0) setCheckedIds(new Set())   // giữ dialog mở để user thấy kết quả; chuyến đã chuyển rời khỏi filter ngày hiện tại
  }

  const viewSnapshot = {
    search: f.search, dateFrom: f.dateFrom, dateTo: f.dateTo, warehouseId: f.warehouseId,
    filterWarehouseTypes, filterTypes, filterDvvts, filterNpps, filterMaterials, filterStatuses,
  }
  const savedViews = useSavedViewsStore(s => s.views['outbound'] ?? [])
  const activeViewId = useMemo(() => {
    const cur = JSON.stringify(viewSnapshot)
    return savedViews.find(v => JSON.stringify(v.filters) === cur)?.id ?? null
  }, [savedViews, viewSnapshot])

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Header */}
      <div className="border-b bg-white px-3 py-1.5 shrink-0 space-y-1 sm:py-2 sm:space-y-1.5 sm:rounded-t-xl">
        {/* Row 1: Title + Search + Views + Density + Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 shrink-0">Xuất kho</span>
          <SearchInput value={f.search} onChange={v => setOutbound({ search: v })} placeholder="Tìm số xe, ĐVVT, NPP, mã hàng, tem pallet…" className="flex-1 min-w-[140px]" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          {/* Mobile: SavedViews + action GOM 1 hàng chủ đích (hết cảnh mỗi nút 1 hàng rời rạc trên PDA);
              desktop sm:contents → tan vào hàng toolbar như cũ */}
          <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
          <SavedViews
            module="outbound"
            currentFilters={viewSnapshot}
            activeId={activeViewId}
            onApply={(filters) => setOutbound(filters as Partial<typeof f>)}
          />
          <button type="button" onClick={toggleDensity}
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
            title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
            {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
          {/* Action theo selection đặt trên toolbar (chuẩn 22/07 — không chèn bar hiện/ẩn làm bảng nhảy) */}
          {canEditGdo && moveTargets.length > 0 && (
            <button type="button" onClick={() => { setMoveDate(''); setMoveErrs([]); setMoveOk(null); setShowMoveDate(true) }}
              className="inline-flex items-center gap-1 h-9 sm:h-7 px-2 rounded border border-sky-300 bg-sky-50 text-xs text-sky-700 hover:bg-sky-100 transition-colors shrink-0"
              title="Chuyển ngày xuất các chuyến đã chọn (đơn rớt sang ngày khác)">
              <CalendarDays className="h-3.5 w-3.5" /> Chuyển ngày ({moveTargets.length})
            </button>
          )}
          {checkedIds.size > 0 && (
            <button type="button" onClick={() => setCheckedIds(new Set())}
              className="inline-flex items-center gap-1 h-9 sm:h-7 px-2 rounded border border-slate-200 text-xs text-slate-500 hover:bg-slate-50 transition-colors shrink-0">
              <X className="h-3.5 w-3.5" /> Bỏ chọn ({checkedIds.size})
            </button>
          )}
          <ActionCluster className="shrink-0" mobileInline items={[
            ...(can(perms, 'outbound', 'prepare') ? [{
              key: 'prepare', icon: PackageCheck, label: 'Chuẩn bị hàng', tip: 'Mở bảng Chuẩn bị hàng (soạn hàng theo kế hoạch)',
              onClick: () => navigate('/wms/outbound/prepare'),
            } satisfies ActionItem] : []),
            ...(can(perms, 'outbound', 'create') ? [{
              key: 'create', icon: PenSquare, label: 'Tạo đơn', tip: 'Tạo đơn xuất thủ công', primary: true,
              onClick: () => setShowCreate(true),
            } satisfies ActionItem] : []),
            ...(can(perms, 'outbound', 'import') ? [{
              key: 'upload', icon: Upload, label: 'Upload Excel', tip: 'Upload kế hoạch xuất từ file Excel',
              mobileHidden: true, // upload Excel không dùng trên điện thoại (giữ hành vi cũ max-sm:hidden)
              onClick: () => { setUploadErr(null); setUploadOk(null); setUploadWarn(null); setShowUpload(true) },
            } satisfies ActionItem] : []),
            ...(can(perms, 'outbound', 'import') ? [{
              key: 'vcupload', icon: Upload, label: 'Up kế hoạch VC', tip: 'Up VL06O (SAP) + KH điều vận → tự sinh chuyến xuất',
              mobileHidden: true,
              onClick: () => { setVl06oErr(null); setVl06oOk(null); setVl06oUnitErrs(null); setVcErr(null); setVcOk(null); setShowVcUpload(true) },
            } satisfies ActionItem] : []),
          ]} />
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
          <input ref={vl06oRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleVl06oChange} />
          <input ref={khvcRef}  type="file" accept=".xlsx,.xls" className="hidden" onChange={handleKhvcChange} />
        </div>

        {/* Row 2: Filter chip bar (desktop) — mobile dùng nút Lọc ở hàng trên */}
        <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
          <FilterBar defs={filterDefs} />
          {!isToday && (
            <button className="inline-flex h-7 px-2 text-[11px] text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap"
              onClick={() => setOutbound({ dateFrom: TODAY, dateTo: TODAY })}>
              Hôm nay
            </button>
          )}
        </div>

        <p className="text-xs text-slate-500">
          {hasDate ? (
            <>
              <span className="font-medium text-slate-700">{dateLabel}</span>
              {isToday && <span className="ml-1.5 text-blue-600 font-medium">· Hôm nay</span>}
            </>
          ) : (
            <span className="italic">Hiển thị tất cả ngày</span>
          )}
        </p>

        {/* Phân bổ theo NPP – collapsible trong header (kiểu expand Inbound) */}
        {!isLoading && nppBreakdown.length > 0 && (
          <div className="rounded-md border border-slate-200 overflow-hidden">
            <button
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 text-left"
              onClick={() => setNppOpen(v => !v)}>
              <Building2 className="h-3.5 w-3.5 text-slate-400" />
              Phân bổ theo NPP ({nppBreakdown.length} nhà) · KH {nppTotals.planned.toLocaleString('vi-VN')} · đã xuất {nppTotals.scanned.toLocaleString('vi-VN')} · còn {nppTotals.remaining.toLocaleString('vi-VN')} thùng
              {filterMaterials.length > 0 && <span className="text-blue-600">· lọc {filterMaterials.length} mã hàng</span>}
              <ChevronDown className={`h-3 w-3 ml-auto transition-transform ${nppOpen ? 'rotate-180' : ''}`} />
            </button>
            {nppOpen && (
              <div className="px-3 py-2 overflow-x-auto border-t border-slate-200 bg-white">
                {(() => {
                  const parts = [
                    hasDate ? dateLabel : null,
                    f.warehouseId ? (warehouses as { id: string; name: string }[]).find(w => w.id === f.warehouseId)?.name : null,
                    filterMaterials.length > 0 ? `Mã hàng: ${filterMaterials.join(', ')}` : null,
                  ].filter(Boolean)
                  return parts.length > 0 ? <p className="text-[10px] text-slate-400 mb-1.5">Lọc: {parts.join(' · ')}</p> : null
                })()}
                <table className="text-[11px] w-full max-w-lg">
                  <thead>
                    <tr className="text-slate-400 border-b">
                      <th className="py-1 pr-6 text-left font-medium">NPP / Khách hàng</th>
                      <th className="py-1 pr-6 text-right font-medium">Kế hoạch</th>
                      <th className="py-1 pr-6 text-right font-medium">Đã xuất</th>
                      <th className="py-1 text-right font-medium">Còn lại</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nppBreakdown.map(row => (
                      <tr key={row.npp} className="border-b border-slate-100">
                        <td className="py-1 pr-6 text-slate-700">{row.npp}</td>
                        <td className="py-1 pr-6 text-right tabular-nums font-semibold">{row.planned.toLocaleString('vi-VN')}</td>
                        <td className="py-1 pr-6 text-right tabular-nums text-green-700">{row.scanned.toLocaleString('vi-VN')}</td>
                        <td className={`py-1 text-right tabular-nums font-semibold ${row.remaining > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{row.remaining.toLocaleString('vi-VN')}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="text-slate-500 font-semibold border-t">
                      <td className="py-1 pr-6">Tổng</td>
                      <td className="py-1 pr-6 text-right tabular-nums">{nppTotals.planned.toLocaleString('vi-VN')}</td>
                      <td className="py-1 pr-6 text-right tabular-nums text-green-700">{nppTotals.scanned.toLocaleString('vi-VN')}</td>
                      <td className="py-1 text-right tabular-nums text-amber-700">{nppTotals.remaining.toLocaleString('vi-VN')}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Summary band (Manhattan) */}
      <SummaryBand tiles={[
        { label: 'Chuyến xe', value: summary.count },
        { label: 'Tổng thùng', value: summary.cartons.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) },
        { label: 'Tổng (QR)', value: summary.cartonsQr.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) },
        { label: 'Tổng (k QR)', value: summary.cartonsNoqr.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) },
        { label: 'Pallet', value: fmtPallets(summary.pallets).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) },
        { label: 'Hoàn thành', value: summary.completed, accent: summary.completed > 0 },
      ]} />

      {/* Table + Pane (Manhattan Insight) */}
      <div className="flex flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading || postUploadLoading ? (
          <div className="p-4 space-y-2">
            {[1,2,3,4].map(i => <div key={i} className="h-10 rounded bg-slate-100 animate-pulse" />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
            <Truck className="h-10 w-10 opacity-30" />
            <p className="text-sm">{f.search ? 'Không tìm thấy chuyến xe' : hasDate ? `Không có chuyến xe (${dateLabel})` : 'Chưa có chuyến xe nào'}</p>
            {!hasDate && <p className="text-xs">Upload file Excel để bắt đầu</p>}
          </div>
        ) : (
          <Table className="table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100" style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow className="bg-slate-50">
                {OUTBOUND_COLS.map((c, i) => (
                  <TableHead key={c.id}
                    style={i <= 1 ? { left: i === 0 ? 0 : colW[0] } : undefined}
                    className={`text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5 ${c.align === 'right' ? 'text-right' : ''} ${i <= 1 ? 'sticky z-20 bg-slate-50' : ''}`}>
                    {c.id === 'date' && canEditGdo && pendingIdsOnScreen.length > 0 && (
                      <input type="checkbox" className="h-3 w-3 accent-sky-600 cursor-pointer align-middle mr-1"
                        checked={allPendingChecked} onChange={toggleCheckAll}
                        title="Chọn tất cả chuyến Chờ xuất (chuyển ngày hàng loạt)" />
                    )}
                    {c.label}
                    {i > 0 && (
                      <span onPointerDown={e => startResize(i, e)} onClick={e => e.stopPropagation()}
                        className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" title="Kéo để chỉnh độ rộng cột" />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.flatMap((gdo, i) => {
                const bpos     = bracketPositions.get(gdo.id) ?? 'none'
                const prevBpos = i > 0 ? (bracketPositions.get(sorted[i - 1].id) ?? 'none') : 'none'
                const spacerBefore = bpos === 'first' && i > 0 && prevBpos !== 'last'
                const spacerAfter  = bpos === 'last'
                const nodes: React.ReactNode[] = []
                if (spacerBefore) nodes.push(<tr key={`sp-b-${gdo.id}`} aria-hidden><td colSpan={OUTBOUND_COLS.length} className="p-0 border-0 bg-transparent"><div className="h-2.5" /></td></tr>)
                nodes.push(
                  <GDORow
                    key={gdo.id}
                    gdo={gdo}
                    dense={dense}
                    pinW={colW[0]}
                    selected={gdo.id === selectedId}
                    whInfoByKey={whInfoByKey}
                    bracketPos={bpos}
                    onClick={() => { if (isDesktop) setSelectedId(gdo.id); else navigate(`/wms/outbound/${gdo.id}`) }}
                    onDoubleClick={() => navigate(`/wms/outbound/${gdo.id}`)}
                    onAssign={can(perms, 'outbound', 'assign') ? (e => { e.stopPropagation(); assignGDO({ id: gdo.id }) }) : undefined}
                    checkable={canEditGdo && gdo.status === 'PENDING'}
                    checked={checkedIds.has(gdo.id)}
                    onToggleCheck={() => toggleCheck(gdo.id)}
                  />
                )
                if (spacerAfter) nodes.push(<tr key={`sp-a-${gdo.id}`} aria-hidden><td colSpan={OUTBOUND_COLS.length} className="p-0 border-0 bg-transparent"><div className="h-2.5" /></td></tr>)
                return nodes
              })}
            </TableBody>
          </Table>
        )}
      </div>
      {selectedId && sorted.find(g => g.id === selectedId) && (
        <OutboundPane gdo={sorted.find(g => g.id === selectedId)!} onClose={() => setSelectedId(null)} />
      )}
      </div>

      {/* Footer đếm bản ghi */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 sm:rounded-b-xl">
        {sorted.length > 0 ? `1–${sorted.length} / ${sorted.length} chuyến xe` : '0 chuyến xe'}
      </div>
     </div>

      {/* Modal chuyển ngày xuất hàng loạt (đơn rớt ngày) */}
      {showMoveDate && (
        <ModalOverlay onClose={() => !movingDates && setShowMoveDate(false)} className="w-full max-w-md">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-700">Chuyển ngày xuất — {moveTargets.length} chuyến</h3>
            <button onClick={() => !movingDates && setShowMoveDate(false)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
          </div>
          <div className="p-4 space-y-3">
            {moveTargets.length > 0 && (
              <div className="max-h-32 overflow-auto rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-mono text-slate-600 space-y-0.5">
                {moveTargets.map(g => <div key={g.id}>{g.group_code} <span className="font-sans text-slate-400">({format(parseISO(g.delivery_date), 'dd-MM')})</span></div>)}
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Ngày xuất mới</label>
              <Input type="date" min={TODAY} value={moveDate} onChange={e => setMoveDate(e.target.value)} className="h-9" />
            </div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800 flex items-start gap-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Chuyến sinh từ upload SAP: <b>up Kế hoạch VC mới sẽ đè lại ngày theo kế hoạch</b>. Sau khi chuyển, tab Kế hoạch xuất (Dữ liệu bên ngoài) sẽ hiện <b>Lệch ngày xuất</b> để đối chiếu.</span>
            </div>
            {moveOk && (
              <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />{moveOk}
              </div>
            )}
            {moveErrs.length > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 space-y-0.5">
                {moveErrs.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" className="h-8 text-xs" disabled={movingDates} onClick={() => setShowMoveDate(false)}>Đóng</Button>
              <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700" disabled={!moveDate || movingDates || moveTargets.length === 0} onClick={handleMoveDates}>
                {movingDates ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Đang chuyển…</> : `Chuyển ${moveTargets.length} chuyến`}
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Modals */}
      {showCreate && (
        <GDOModal
          defaultWarehouseId={f.warehouseId || user?.warehouse_id || ''}
          onClose={() => setShowCreate(false)}
        />
      )}
      {showUpload && (
        // Kết quả/lỗi dài (file nhiều xe bị bỏ qua) → nới dialog ~80% màn hình cho dễ đọc (chuẩn upload-download)
        <ModalOverlay onClose={() => setShowUpload(false)}
          className={`w-full max-h-[90vh] ${((uploadWarn?.length ?? 0) > 600 || (uploadErr?.length ?? 0) > 600) ? 'max-w-[95vw] sm:max-w-[80vw]' : 'max-w-lg'}`}>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-700">Upload kế hoạch xuất từ Excel</h3>
            <button onClick={() => setShowUpload(false)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
          </div>
          <div className="p-4 space-y-3 overflow-auto">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={downloadTemplate} className="h-8 text-xs gap-1">
                <Download className="h-3.5 w-3.5" />
                Tải mẫu
              </Button>
              <Button size="sm" disabled={uploading} onClick={() => fileRef.current?.click()} className="h-8 text-xs gap-1">
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {uploading ? 'Đang xử lý…' : 'Chọn file Excel'}
              </Button>
            </div>
            <p className="text-[11px] text-slate-500">
              Tải file mẫu để xem đúng định dạng cột, điền dữ liệu rồi chọn file để upload. Xe đang xuất chỉ ghi đè được khi ở trạng thái PAUSED.
            </p>
            {uploadOk && (
              <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />{uploadOk}
              </div>
            )}
            {uploadWarn && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <pre className="whitespace-pre-wrap font-sans">{uploadWarn}</pre>
              </div>
            )}
            {uploadErr && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <pre className="whitespace-pre-wrap font-sans">{uploadErr}</pre>
              </div>
            )}
          </div>
        </ModalOverlay>
      )}
      {showVcUpload && (
        // Bảng lỗi đơn vị / lỗi validate dài → nới dialog ~80% màn hình (chuẩn upload-download)
        <ModalOverlay onClose={() => setShowVcUpload(false)}
          className={`w-full max-h-[90vh] ${((vl06oUnitErrs?.length ?? 0) > 5 || (vl06oErr?.length ?? 0) > 600 || (vcErr?.length ?? 0) > 600 || (vl06oOk?.length ?? 0) > 600) ? 'max-w-[95vw] sm:max-w-[80vw]' : 'max-w-lg'}`}>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-700">Up kế hoạch VC (VL06O + KH điều vận)</h3>
            <button onClick={() => setShowVcUpload(false)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
          </div>
          <div className="p-4 space-y-4 overflow-auto">
            {/* Bước 1 — VL06O (raw SAP) */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-600">Bước 1 — Up VL06O (dữ liệu SAP)</div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={downloadVl06oTemplate} className="h-8 text-xs gap-1">
                  <Download className="h-3.5 w-3.5" /> Tải mẫu VL06O
                </Button>
                <Button size="sm" disabled={vl06oUploading} onClick={() => vl06oRef.current?.click()} className="h-8 text-xs gap-1">
                  {vl06oUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {vl06oUploading ? 'Đang xử lý…' : 'Chọn file VL06O'}
                </Button>
              </div>
              {vl06oWarn && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">File có {vl06oWarn.dos_on_trips} DO đã lên chuyến{vl06oWarn.trips_in_progress > 0 ? ` · ${vl06oWarn.trips_in_progress} chuyến đang xuất/tạm dừng` : ''}.</div>
                      <div>{vl06oWarn.scanned_items > 0
                        ? `${vl06oWarn.scanned_items} dòng ĐÃ QUÉT sẽ KHÔNG bị tự đè — chuyển sang tab "Cần xử lý" để bạn duyệt.`
                        : 'Các dòng chưa quét sẽ tự cập nhật theo SAP (an toàn).'}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700" onClick={() => doVl06oUpload(vl06oWarn.file)}>Tiếp tục up VL06O</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setVl06oWarn(null)}>Huỷ</Button>
                  </div>
                </div>
              )}
              {vl06oOk && (
                <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800 flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /><pre className="whitespace-pre-wrap font-sans">{vl06oOk}</pre>
                </div>
              )}
              {vl06oErr && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><pre className="whitespace-pre-wrap font-sans">{vl06oErr}</pre>
                </div>
              )}
              {vl06oUnitErrs && vl06oUnitErrs.length > 0 && (
                <div className="rounded-lg border border-red-200 overflow-x-auto">
                  <table className="w-full text-[11px] whitespace-nowrap">
                    <thead className="bg-red-50 text-red-700">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium">Mã hàng</th>
                        <th className="px-2 py-1 text-left font-medium">Tên</th>
                        <th className="px-2 py-1 text-left font-medium">Lỗi</th>
                        <th className="px-2 py-1 text-left font-medium">Trong file</th>
                        <th className="px-2 py-1 text-left font-medium">Hệ thống</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vl06oUnitErrs.map((u, i) => (
                        <tr key={i} className="border-t border-red-100">
                          <td className="px-2 py-1 font-mono font-semibold">{u.material_code}</td>
                          <td className="px-2 py-1 max-w-[180px] truncate" title={u.material_name}>{u.material_name || <span className="text-slate-300">—</span>}</td>
                          <td className="px-2 py-1">{u.kind}</td>
                          <td className="px-2 py-1 text-red-600 font-semibold">{u.file_value}</td>
                          <td className="px-2 py-1">{u.system_value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="border-t border-slate-100" />
            {/* Bước 2 — KHVC (sinh chuyến) */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-600">Bước 2 — Up KH điều vận (sinh chuyến xuất)</div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={downloadKhvcTemplate} className="h-8 text-xs gap-1">
                  <Download className="h-3.5 w-3.5" /> Tải mẫu KHVC
                </Button>
                <Button size="sm" disabled={khvcUploading} onClick={() => khvcRef.current?.click()} className="h-8 text-xs gap-1">
                  {khvcUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {khvcUploading ? 'Đang xử lý…' : 'Chọn file KHVC'}
                </Button>
              </div>
              {khvcWarn && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      {khvcWarn.trips.total > 0 && (
                        <div><span className="font-semibold">Ngày/Số xe này đã có {khvcWarn.trips.total} chuyến</span>
                          {(khvcWarn.trips.in_progress + khvcWarn.trips.completed + khvcWarn.trips.paused) > 0
                            ? ` (${khvcWarn.trips.in_progress} đang xuất · ${khvcWarn.trips.completed} đã xong · ${khvcWarn.trips.paused} tạm dừng — được bảo vệ, không tự đè).`
                            : ' (đều PENDING — sẽ ghi đè).'}
                        </div>
                      )}
                      {khvcWarn.missing_dos > 0 && (
                        <div className="text-red-700">⚠ {khvcWarn.missing_dos} DO CHƯA có trong VL06O{khvcWarn.missing_dos_sample.length ? ` (${khvcWarn.missing_dos_sample.join(', ')}${khvcWarn.missing_dos > khvcWarn.missing_dos_sample.length ? '…' : ''})` : ''} → hãy Up VL06O mới nhất TRƯỚC (Bước 1).</div>
                      )}
                      {khvcWarn.cross_trip_dos > 0 && (
                        <div className="text-red-700">⚠ {khvcWarn.cross_trip_dos} DO ĐÃ nằm trong chuyến khác Số xe còn sống{khvcWarn.cross_trip_sample.length ? ` (${khvcWarn.cross_trip_sample.join('; ')}${khvcWarn.cross_trip_dos > khvcWarn.cross_trip_sample.length ? '…' : ''})` : ''} — tiếp tục sẽ sinh chuyến TRÙNG DO (kế hoạch double). Đơn rớt ngày: dùng nút Chuyển ngày ở Xuất kho, đừng gửi lại KH dưới Số xe mới.</div>
                      )}
                      <div className="text-amber-700">VL06O cập nhật lần cuối: <b>{khvcWarn.vl06o_last_synced ? `${formatTimestampDate(khvcWarn.vl06o_last_synced, true)} ${formatTimestampTime(khvcWarn.vl06o_last_synced)}` : 'chưa có DO nào'}</b>. Đã Up VL06O mới nhất chưa?</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700" onClick={() => doKhvcUpload(khvcWarn.file)}>Tiếp tục sinh chuyến</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setKhvcWarn(null)}>Huỷ</Button>
                  </div>
                </div>
              )}
              {vcOk && (
                <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />{vcOk}
                </div>
              )}
              {vcErr && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><pre className="whitespace-pre-wrap font-sans">{vcErr}</pre>
                </div>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              VL06O = bản sao dữ liệu SAP (giữ nguyên định dạng, lưu lại đầy đủ). KHVC = kế hoạch điều vận tự soạn (Số xe, DO, NPP…),
              hệ thống ghép theo DO rồi tự tính Thùng + Hộp lẻ theo đơn vị gốc từng mã. Up VL06O trước, rồi Up KHVC.
            </p>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}

// ─── GDO Row ──────────────────────────────────────────────────

function GDORow({ gdo, onClick, onDoubleClick, onAssign, dense = true, pinW = 34, selected = false, whInfoByKey, bracketPos = 'none', checkable = false, checked = false, onToggleCheck }: {
  gdo: GDO
  onClick: () => void
  onDoubleClick?: () => void
  onAssign?: (e: React.MouseEvent) => void
  dense?: boolean
  pinW?: number
  selected?: boolean
  whInfoByKey: Map<string, { code: string; mode: string }>
  bracketPos?: BracketPos
  checkable?: boolean          // chuyến PENDING + user có outbound.edit → tick chọn để chuyển ngày hàng loạt
  checked?: boolean
  onToggleCheck?: () => void
}) {
  const { pin, unpin, isPinned } = useActiveVehiclesStore()
  const pinned    = isPinned(gdo.id)
  const dateLabel = format(parseISO(gdo.delivery_date), 'dd-MM-yy', { locale: vi })
  const npp       = gdo.distributor_names?.join(', ') ?? '—'
  // Ship-to = giá trị GỐC từ upload (shipto_party). Nối mode (None/QR/QTY) tra SỐNG từ Warehouse
  // theo chính mã shipto — không khớp kho nào thì chỉ hiện mã (không mode). KHÔNG suy từ Tên NPP.
  const shiptoMode = gdo.shipto_party ? (whInfoByKey.get(gdo.shipto_party.trim().toLowerCase())?.mode ?? '') : ''
  const { label: statusLabel, cls: statusCls } = gdoStatusInfo(gdo)
  const isPending = gdo.status === 'PENDING'
  const showBracket = bracketPos !== 'none' && bracketPos !== 'only'
  const rowBg = selected ? 'bg-sky-50' : showBracket ? 'bg-slate-50' : 'bg-white'

  return (
    <TableRow className={`cursor-pointer ${gdoRowText(gdo)} ${dense ? '' : '[&_td]:py-2.5'} ${selected ? 'bg-sky-50' : showBracket ? 'bg-slate-50' : ''} ${showBracket && bracketPos === 'first' ? '[&_td]:border-t [&_td]:!border-t-slate-300' : ''} ${showBracket && bracketPos === 'last' ? '[&_td]:!border-b-slate-300' : ''}`} onClick={onClick} onDoubleClick={onDoubleClick}>
      {/* Bookmark + bracket connector nối chuyến chung 1 xe */}
      <TableCell className={`px-1.5 py-1 sticky left-0 z-10 ${rowBg}`} style={{ left: 0 }} onClick={e => e.stopPropagation()}>
        {showBracket && (
          <div className="absolute pointer-events-none" style={{
            right: 0, width: '10px',
            top: bracketPos === 'first' ? '50%' : 0,
            bottom: bracketPos === 'last' ? '50%' : 0,
            borderLeft: '2px solid #0f172a',
            ...(bracketPos === 'first' ? { borderTop: '2px solid #0f172a', borderTopLeftRadius: '3px' } : {}),
            ...(bracketPos === 'last'  ? { borderBottom: '2px solid #0f172a', borderBottomLeftRadius: '3px' } : {}),
          }} />
        )}
        <button
          onClick={() => pinned ? unpin(gdo.id) : pin({ id: gdo.id, group_code: gdo.group_code, status: gdo.status })}
          className={`p-0.5 rounded transition-colors ${pinned ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'}`}
          title={pinned ? 'Bỏ đánh dấu' : 'Đánh dấu đang làm'}
        >
          <Bookmark className="h-3 w-3" fill={pinned ? 'currentColor' : 'none'} />
        </button>
      </TableCell>

      <TableCell className={`px-2 py-1 whitespace-nowrap sticky z-10 ${rowBg}`} style={{ left: pinW }}>
        {checkable && (
          <input type="checkbox" className="h-3 w-3 accent-sky-600 cursor-pointer align-middle mr-1"
            checked={checked} onClick={e => e.stopPropagation()} onChange={onToggleCheck}
            title="Chọn chuyến (chuyển ngày hàng loạt)" />
        )}
        <span className="text-[10px] font-medium tabular-nums">{dateLabel}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono font-semibold">{gdo.group_code}</span>
      </TableCell>
      <TableCell className="px-2 py-1 max-w-[150px]">
        <span className="text-[10px] truncate block" title={npp}>{npp}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {gdo.shipto_party ? (
          <span className="inline-flex items-center gap-1">
            <span className="text-[10px] font-mono">{gdo.shipto_party}</span>
            {shiptoMode && <span className={`text-[8px] px-1 py-0.5 rounded border font-medium ${shiptoMode === 'NONE' ? 'text-slate-500 border-slate-300' : 'text-green-600 border-green-300'}`}>{shiptoMode}</span>}
          </span>
        ) : <span className="text-slate-300">—</span>}
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px]">{gdo.dvvt ?? '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {gdo.license_plate
          ? <span className="text-[10px] font-mono font-semibold">{gdo.license_plate}</span>
          : <span className="text-slate-300">—</span>}
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <GdoQty base={gdo.total_cartons_base} decimal={gdo.total_cartons} unit={gdo.qty_unit} />
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <GdoQty base={(gdo.total_cartons_base ?? 0) - (gdo.total_noqr_base ?? 0)}
                decimal={(gdo.total_cartons ?? 0) - (gdo.total_cartons_noqr ?? 0)} unit={gdo.qty_unit} zeroDash />
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <GdoQty base={gdo.total_noqr_base} decimal={gdo.total_cartons_noqr} unit={gdo.qty_unit} zeroDash />
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <GdoQty base={gdo.total_loose_base} decimal={gdo.total_loose} unit={gdo.qty_unit} zeroDash />
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{fmtPallets(gdo.total_pallets).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">pl</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px]">{gdo.warehouse?.name ?? '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px]">{gdo.export_type ?? '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px]">{gdo.warehouse_type ?? '—'}</span>
      </TableCell>

      {/* Giờ giao đơn — inline assign action */}
      <TableCell className="px-2 py-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
        {gdo.assigned_at ? (
          <span className="text-[10px] tabular-nums font-medium">{fTime(gdo.assigned_at)}</span>
        ) : isPending && onAssign ? (
          <button
            onClick={onAssign}
            className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200 font-medium transition-colors"
          >
            Giao đơn
          </button>
        ) : (
          <span className="text-[10px] tabular-nums text-slate-400">—</span>
        )}
      </TableCell>

      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] tabular-nums">{fTime(gdo.started_at)}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] tabular-nums">{fTime(gdo.scan_completed_at)}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] tabular-nums">{fTime(gdo.completed_at)}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${statusCls}`}>{statusLabel}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {gdo.transfer_status ? (
          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
            gdo.transfer_status === 'DELIVERED'  ? 'bg-slate-100 text-slate-600' :
            gdo.transfer_status === 'RECEIVING'  ? 'bg-green-100 text-green-700' :
            gdo.transfer_status === 'IN_TRANSIT' ? 'bg-amber-100 text-amber-700' : ''
          }`}>
            {gdo.transfer_status === 'DELIVERED'  ? 'Đã giao' :
             gdo.transfer_status === 'RECEIVING'  ? 'Đang nhận' :
             gdo.transfer_status === 'IN_TRANSIT' ? 'Đang giao' : gdo.transfer_status}
          </span>
        ) : <span className="text-[9px] text-slate-300">—</span>}
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px]">{gdo.exporter_name ?? '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px]">
          {gdo.forklift_driver_names || gdo.forklift_driver?.name || '—'}
        </span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px]">{gdo.loader_name ?? '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {gdo.delivery_codes?.length
          ? <span className="text-[10px] font-mono font-semibold truncate block" title={gdo.delivery_codes.join(', ')}>{gdo.delivery_codes.join(', ')}</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>
    </TableRow>
  )
}

// ─── Material picker ──────────────────────────────────────────

// `unit` để optional: Material KHÔNG có cột này trong DB (ĐVT lấy qua unitCodeOf/base_unit)
type MatOption = { id: string; material_code: string; short_name: string | null; category: string | null; unit?: string | null } & MatUnits & {
  // Định mức pallet (+ ngoại lệ theo kho) — tính Nhặt lẻ TỰ ĐỘNG từ Tổng (pallet-remainder)
  cartons_per_pallet?: number | null
  warehouse_pallet_overrides?: { warehouse_id: string; cartons_per_pallet: number }[] | null
}

function MatPicker({ value, onSelect, disabled, disabledNoType, filterCategory, onPaste }: {
  value: string
  onSelect: (code: string, name: string, category: string | null, unit: string, mat?: MatOption | null) => void
  disabled?: boolean
  disabledNoType?: boolean
  filterCategory?: string
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void
}) {
  const [search, setSearch] = useState(value)
  const [open, setOpen] = useState(false)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const inputRef = useRef<HTMLInputElement>(null)
  // Chỉ gọi API KHI đã gõ ≥2 ký tự, chỉ lấy 50 dòng đầu, và HOÃN 250ms — trước đây gõ chưa đủ
  // ký tự vẫn kéo TOÀN BỘ danh mục mã hàng về trình duyệt (2.740 mã hôm nay, chục nghìn về sau).
  const matTerm = useDebouncedValue(!disabled && !disabledNoType && search.length > 1 ? search : '', 250)
  const { data: mats = [] } = useMaterials(
    { search: matTerm, category: filterCategory || undefined, limit: 50 },
    !!matTerm,
  )

  useEffect(() => { setSearch(value) }, [value])

  function handleFocus() {
    setOpen(true)
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect()
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 2,
        left: rect.left,
        width: Math.max(rect.width, 280),
        zIndex: 9999,
      })
    }
  }

  if (disabledNoType) {
    return (
      <div className="min-w-[140px]">
        <Input
          className="h-7 text-[10px] font-mono px-2 w-full opacity-50 cursor-not-allowed"
          value=""
          disabled
          placeholder="Chọn loại kho trước"
        />
      </div>
    )
  }

  if (disabled) {
    return <span className="text-[10px] font-mono font-semibold text-slate-700">{value}</span>
  }

  return (
    <div className="min-w-[140px]">
      <Input
        ref={inputRef}
        className="h-7 text-[10px] font-mono px-2 w-full"
        value={search}
        onChange={e => { setSearch(e.target.value); setOpen(true); handleFocus() }}
        onFocus={handleFocus}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onPaste={onPaste}
        placeholder="Tìm mã / tên hàng…"
      />
      {open && search.length > 1 && mats.length > 0 && (
        <div style={dropdownStyle} className="bg-white border border-slate-200 rounded-lg shadow-xl max-h-52 overflow-y-auto">
          {(mats as MatOption[]).map(m => (
            <button
              key={m.id}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-50 last:border-0"
              onMouseDown={() => {
                onSelect(m.material_code, m.short_name ?? '', m.category, unitCodeOf(m), m)
                setSearch(m.material_code)
                setOpen(false)
              }}
            >
              <span className="text-[10px] font-mono font-semibold">{m.material_code}</span>
              {m.short_name && <span className="text-[9px] text-slate-500 ml-1.5">{m.short_name}</span>}
              {m.category && <span className="text-[9px] text-slate-400 ml-1">· {m.category}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Customer combobox (search + free text + NPP detection) ──

function CustomerCombobox({ value, onChange, onNPPChange, warehouses }: {
  value: string
  onChange: (v: string) => void
  onNPPChange: (code: string) => void  // '' = không phải NPP
  warehouses: WarehouseLite[]
}) {
  const [open, setOpen] = useState(false)
  const allActive = warehouses.filter(w => w.is_active)
  const filtered = value.trim()
    ? allActive.filter(w =>
        w.name.toLowerCase().includes(value.toLowerCase()) ||
        (w.code ?? '').toLowerCase().includes(value.toLowerCase())
      )
    : allActive

  return (
    <div className="relative">
      <Input
        className="h-7 text-xs"
        placeholder="Tên NPP / khách hàng…"
        value={value}
        onChange={e => { onChange(e.target.value); onNPPChange(''); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-0.5 bg-white border border-slate-200 rounded shadow-lg max-h-44 overflow-y-auto">
          {filtered.map(w => (
            <button key={w.id} type="button"
              className="w-full text-left px-2.5 py-1.5 text-[11px] hover:bg-slate-50 flex items-center justify-between gap-2"
              onMouseDown={() => {
                onChange(w.name)
                // Khách khớp kho trong danh mục (MỌI chế độ QR/QTY/NONE) → gắn shipto để theo dõi
                // vận chuyển bên TMS Chuyển kho; có tạo booking hay không do cờ Xác nhận giao hàng quyết.
                onNPPChange(w.code ?? '')
                setOpen(false)
              }}
            >
              <span>{w.name} <span className="text-slate-400">({w.code})</span></span>
              <span className="flex items-center gap-1 shrink-0">
                {w.warehouse_type && (
                  <span className={`text-[9px] font-medium rounded px-1 border ${w.warehouse_type === 'NPP' ? 'text-amber-600 border-amber-300' : 'text-blue-600 border-blue-300'}`}>
                    {w.warehouse_type}
                  </span>
                )}
                {w.inventory_mode && (
                  <span className={`text-[9px] font-medium rounded px-1 border ${w.inventory_mode === 'NONE' ? 'text-slate-500 border-slate-300' : 'text-green-600 border-green-300'}`}>
                    {w.inventory_mode}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── ĐVVT combobox (UX giống Tên khách hàng): gợi ý từ ĐVVT/NCC + cho gõ tên lạ ──
function DvvtCombobox({ value, onChange, companies }: {
  value: string
  onChange: (v: string) => void
  companies: { id: string; name: string; code?: string; type?: string | null }[]
}) {
  const [open, setOpen] = useState(false)
  const filtered = value.trim()
    ? companies.filter(c => c.name.toLowerCase().includes(value.toLowerCase()) || String(c.code ?? '').toLowerCase().includes(value.toLowerCase()))
    : companies
  return (
    <div className="relative">
      <Input
        className="h-7 text-xs"
        placeholder="Chọn hoặc gõ ĐVVT…"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-0.5 bg-white border border-slate-200 rounded shadow-lg max-h-44 overflow-y-auto">
          {filtered.map(c => (
            <button key={c.id} type="button"
              className="w-full text-left px-2.5 py-1.5 text-[11px] hover:bg-slate-50 flex items-center gap-2"
              onMouseDown={() => { onChange(c.name); setOpen(false) }}
            >
              <span className="flex-1 truncate">{c.name}</span>
              {c.type && (
                <span className={`shrink-0 text-[9px] font-medium rounded px-1 border ${c.type === 'NCC' ? 'text-amber-600 border-amber-300' : 'text-sky-600 border-sky-300'}`}>
                  {c.type}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Biển số combobox: gợi ý xe đã đăng ký của ĐVVT đang chọn, vẫn cho gõ biển lạ ──
function PlateCombobox({ value, onChange, plates }: {
  value: string
  onChange: (v: string) => void
  plates: string[]
}) {
  const [open, setOpen] = useState(false)
  const filtered = value.trim()
    ? plates.filter(p => p.toLowerCase().includes(value.toLowerCase()))
    : plates
  return (
    <div className="relative">
      <Input
        className="h-7 text-xs font-mono"
        placeholder="Biển số xe…"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-0.5 bg-white border border-slate-200 rounded shadow-lg max-h-44 overflow-y-auto">
          {filtered.slice(0, 30).map(p => (
            <button key={p} type="button"
              className="w-full text-left px-2.5 py-1.5 text-[11px] font-mono hover:bg-slate-50"
              onMouseDown={() => { onChange(p); setOpen(false) }}
            >{p}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Item row type ────────────────────────────────────────────

// mat_units mang thêm id (badge Thiếu hàng) + định mức pallet (Nhặt lẻ tự tính) — assignable từ MatOption / item.material
type MatUnitsX = MatUnits & {
  id?: string
  cartons_per_pallet?: number | null
  warehouse_pallet_overrides?: { warehouse_id: string; cartons_per_pallet: number }[] | null
}

type ItemRow = {
  id: string
  db_id?: string       // actual OutboundItem.id in DB (for existing items)
  material_code: string
  mat_name: string
  unit: string
  category: string | null
  cartons: number
  min_cartons: number  // 0 for new items, cartons_scanned for existing (BASE)
  mat_units: MatUnitsX | null   // BASE UNIT: hệ số của mã (QtyInput 2 ô + quy đổi)
  // loose_picking ĐÃ BỎ khỏi form (user 22/07): nhặt lẻ TỰ TÍNH từ Tổng (pallet-remainder) — BE tự tính khi lưu
  sap_linked: boolean  // item có od_refs (đơn UPLOAD từ SAP) → KHÓA sửa số lượng (sửa ở tab DO SAP); đơn tay = false
  batch_required: string
  date_required: number
  cs_responsible: string
  header_text: string
  npp: string          // NPP của dòng (đơn đa-NPP: dòng thêm mới phải chọn; dòng cũ chỉ hiển thị)
}

let _uid = 0
const uid = () => String(++_uid)
const makeItem = (): ItemRow => ({ id: uid(), material_code: '', mat_name: '', unit: '', category: null, cartons: 0, min_cartons: 0, mat_units: null, sap_linked: false, batch_required: '', date_required: 0, cs_responsible: '', header_text: '', npp: '' })

// %Date chỉ nhận số nguyên 0–100 (cho phép đuôi "%"). Trả null nếu ô chứa chữ → dùng để CHẶN paste text.
function parsePctCell(raw: string): number | null {
  const s = raw.trim().replace(/%$/, '').trim()
  if (s === '') return 0
  if (!/^\d+$/.test(s)) return null
  return parseInt(s, 10)
}

// ─── Shared form UI ───────────────────────────────────────────

function GDOFormBody({
  gdo,
  mode,
  date, setDate,
  warehouseId, setWarehouseId,
  warehouseType, setWarehouseType,
  shiptoPartyId, setShiptoPartyId,
  dvvt, setDvvt,
  customerName, setCustomerName,
  deliveryCode, setDeliveryCode,
  exportType, setExportType,
  items, setItems,
  error,
  isPending: submitting,
  onSubmit,
  onClose,
  quickAction,
  plateSlot,
}: {
  gdo?: GDO | null
  mode: 'create' | 'edit'
  date: string; setDate: (v: string) => void
  warehouseId: string; setWarehouseId: (v: string) => void
  warehouseType?: string; setWarehouseType?: (v: string) => void
  shiptoPartyId: string; setShiptoPartyId: (v: string) => void
  dvvt: string; setDvvt: (v: string) => void
  customerName: string; setCustomerName: (v: string) => void
  deliveryCode: string; setDeliveryCode: (v: string) => void
  exportType: string; setExportType: (v: string) => void
  items: ItemRow[]; setItems: React.Dispatch<React.SetStateAction<ItemRow[]>>
  error: string
  isPending: boolean
  onSubmit: () => void
  onClose: () => void
  quickAction?: React.ReactNode   // nút "Tạo & Xuất luôn" — đặt cạnh nút Lưu (chỉ form tạo, kho QTY/NONE)
  plateSlot?: React.ReactNode      // ô Biển số xe — hiện trong header cạnh ĐVVT (chỉ kho QTY/NONE)
}) {
  const formUser = useAuthStore(s => s.user)
  const [pasteErr, setPasteErr] = useState('')
  const { data: dvvtCompanies = [] } = useTransportCompanies(true)
  const formAllowedWhIds = formUser?.warehouse_scope !== 'NATIONAL' && formUser?.warehouse_ids?.length
    ? new Set(formUser.warehouse_ids)
    : null
  const { data: warehouses = [] } = useWarehouses(true)
  const { data: whTypesInForm = [] } = useScopedWhTypes()
  const { data: allVehicleTypes = [] } = useVehicleTypes()
  const { data: vtByWarehouse = [] } = useVehicleTypesByWarehouse(warehouseId || null, warehouseType || undefined)
  // Dán Excel: tra ĐÚNG các mã vừa dán (trước đây nạp cả danh mục mã hàng về trình duyệt chỉ để
  // dò 1 mã). Mã PHI HÀNG HÓA (chiết khấu/dịch vụ) không được nhận vào dòng hàng.
  const qc = useQueryClient()
  const resolveMats = useCallback(async (codes: string[]) => {
    const map = await fetchMaterialsByCodes(qc, codes)
    for (const [k, m] of map) if (m.is_non_stock) map.delete(k)
    return map
  }, [qc])

  // Loại xe = DANH MỤC độc lập (user chốt 04/07) — kho chưa có khung giờ vẫn tạo được đơn;
  // loại có khung giờ tại kho được ưu tiên lên đầu.
  const exportTypeOptions = useMemo(() => {
    const active = (allVehicleTypes as { id: string; name: string; is_active?: boolean }[]).filter(vt => vt.is_active !== false)
    const inWh = new Set((vtByWarehouse as { name: string }[]).map(vt => vt.name))
    return inWh.size ? [...active].sort((a, b) => Number(inWh.has(b.name)) - Number(inWh.has(a.name))) : active
  }, [allVehicleTypes, vtByWarehouse])
  const isNPP = (warehouses as WarehouseLite[]).find(w => w.id === warehouseId)?.warehouse_type === 'NPP'
  // Chuyển nội bộ parent↔kho phụ (cùng site): xe nâng/đẩy tay — không cần Loại xe/ĐVVT
  const internalPair = isInternalPairFE(warehouses as WarehouseLite[], warehouseId, shiptoPartyId)
  const noVehicle = isNPP || internalPair
  // Đa-NPP mới là tiêu chí "đơn gộp" (chuẩn 04/07) — DO chỉ là tham khảo, không có vai trò
  const nppOptions = useMemo(() => [...new Set((gdo?.delivery_orders ?? []).map(d => (d.distributor_name ?? '').trim()).filter(Boolean))], [gdo])
  const isMultiNpp = nppOptions.length > 1

  const TODAY_STR = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const [yr, mo, dy] = TODAY_STR.split('-')
  const codePreview = mode === 'create' ? `Mãkho_X_${dy}${mo}${yr.slice(2)}_01` : gdo?.group_code ?? ''

  function updateItem(id: string, patch: Partial<ItemRow>) {
    setItems(rows => rows.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  // Nhặt lẻ TỰ TÍNH từ Tổng (pallet-remainder, mirror BE loosePalletRemainder — user chốt 22/07:
  // form Xuất KHÔNG cho sửa nhặt lẻ tay). Cột chỉ hiển thị; BE tự tính lại khi lưu (nguồn sự thật).
  function looseAutoOf(i: ItemRow): number {
    if (!hasEntry(i.mat_units)) return 0
    const cpp = effCartonsPerPallet(i.mat_units, warehouseId || null)
    const palletBase = cpp > 0 ? cpp * Number(i.mat_units!.units_per_carton) : 0
    return palletBase > 0 ? i.cartons % palletBase : 0
  }

  // Badge "Thiếu/Chờ về" per mã theo (kho, ngày giao) — cùng nguồn RPC với trang chi tiết chuyến (user 22/07)
  const { data: formShortages = [] } = useOutboundShortages(warehouseId || undefined, date || undefined)
  const shortageByMat = useMemo(() => new Map(formShortages.map(s => [s.material_id, s])), [formShortages])

  // Trùng = cùng mã hàng TRONG CÙNG NPP (khác NPP thì 1 mã được phép xuất hiện lại)
  const dupKey = (i: ItemRow) => `${i.npp.trim()}||${i.material_code}`
  const duplicateCodes = useMemo(() => {
    const seen = new Map<string, number>()
    for (const item of items) {
      if (item.material_code) seen.set(dupKey(item), (seen.get(dupKey(item)) ?? 0) + 1)
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c))
  }, [items])

  // Paste tab-separated Excel row(s) into material code cell — fills all columns.
  // `async` vì phải TRA MÃ TRÊN SERVER trước khi điền: số lượng được quy đổi theo hệ số
  // thùng/hộp của mã (`qtyFromEntryBase`) — điền trước rồi vá sau sẽ ra SỐ SAI.
  // preventDefault phải gọi TRƯỚC await (sau await là trình duyệt đã dán xong).
  async function handlePasteRowAt(startIdx: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    e.preventDefault()
    if (!text.includes('\t') && !text.includes('\n')) {
      // Single code paste — auto-lookup if exact match
      const code = text.trim()
      const mat = (await resolveMats([code])).get(code.toUpperCase()) ?? null
      setItems(prev => prev.map((r, i) => i !== startIdx ? r : {
        ...r, material_code: code,
        ...(mat ? { mat_name: mat.short_name ?? '', unit: unitCodeOf(mat), category: mat.category ?? null, mat_units: mat } : {}),
      }))
      return
    }
    const lines = text.trim().split(/\r?\n/).filter(Boolean)
    const matMap = await resolveMats(lines.map(l => (l.split('\t')[0] ?? '').trim()))
    const lookupMat = (code: string) => matMap.get(code.trim().toUpperCase()) ?? null
    setItems(prev => {
      const rows = [...prev]
      while (rows.length < startIdx + lines.length) rows.push(makeItem())
      lines.forEach((line, offset) => {
        if (rows[startIdx + offset]?.sap_linked) return   // dòng gốc SAP: SL khóa — paste bỏ qua dòng này
        // Thứ tự cột khớp bảng form: Mã hàng | Thùng | Nhặt lẻ | Batch | %Date | CS | Header text
        const cols  = line.split('\t')
        const code  = (cols[0] ?? '').trim()
        const cart  = parseInt((cols[1] ?? '').replace(/[^0-9]/g, '')) || 0
        const loose = parseInt((cols[2] ?? '').replace(/[^0-9]/g, '')) || 0
        const batch = (cols[3] ?? '').trim()
        const dateR = parseInt((cols[4] ?? '').replace(/[^0-9]/g, '')) || 0
        const cs    = (cols[5] ?? '').trim()
        const note  = (cols[6] ?? '').trim()
        const mat   = lookupMat(code)
        rows[startIdx + offset] = {
          ...rows[startIdx + offset],
          material_code: code,
          mat_name:  mat?.short_name ?? rows[startIdx + offset].mat_name,
          unit:      unitCodeOf(mat) || rows[startIdx + offset].unit,
          category:  mat?.category  ?? rows[startIdx + offset].category,
          mat_units: mat ?? rows[startIdx + offset].mat_units,
          // BASE UNIT: cột Thùng = THÙNG NGUYÊN, cột Nhặt lẻ = SỐ LẺ (đơn vị gốc) → tổng base
          // (loose_picking KHÔNG set tay nữa — tự tính từ Tổng khi lưu)
          ...(cart || loose ? { cartons: qtyFromEntryBase(cart, loose, mat) } : {}),
          ...(batch ? { batch_required: batch }                      : {}),
          ...(dateR ? { date_required: dateR }                       : {}),
          ...(cs    ? { cs_responsible: cs }                         : {}),
          ...(note  ? { header_text: note }                          : {}),
        }
      })
      return rows
    })
  }

  async function handlePasteCartonsAt(startIdx: number, e: React.ClipboardEvent<HTMLElement>) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n')) return
    e.preventDefault()
    const values = text.trim().split(/\r?\n/).filter(Boolean)
    // Dòng chưa có hệ số thùng/hộp (mã gõ tay) → tra trước, nếu không số quy đổi sẽ sai
    const need = items.slice(startIdx, startIdx + values.length).filter(r => !r.mat_units && r.material_code).map(r => r.material_code)
    const matMap = need.length ? await resolveMats(need) : new Map()
    setItems(prev => {
      const rows = [...prev]
      while (rows.length < startIdx + values.length) rows.push(makeItem())
      values.forEach((val, offset) => {
        const row = rows[startIdx + offset]
        if (row.sap_linked) return   // dòng gốc SAP: SL khóa — paste bỏ qua
        const u = row.mat_units ?? matMap.get(row.material_code.trim().toUpperCase()) ?? null
        const thung = parseInt(val.trim().replace(/[^0-9]/g, '')) || 0
        rows[startIdx + offset] = { ...row, mat_units: row.mat_units ?? u, cartons: qtyFromEntryBase(thung, 0, u) }
      })
      return rows
    })
  }

  function handlePasteNoteAt(startIdx: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n')) return
    e.preventDefault()
    const values = text.trim().split(/\r?\n/).filter(Boolean)
    setItems(prev => {
      const rows = [...prev]
      while (rows.length < startIdx + values.length) rows.push(makeItem())
      values.forEach((val, offset) => {
        rows[startIdx + offset] = { ...rows[startIdx + offset], header_text: val.trim() }
      })
      return rows
    })
  }

  // Paste nhiều dòng từ Excel vào 1 cột bất kỳ (Batch/%Date/CS) — điền lần lượt xuống từ ô đang dán
  function handlePasteColAt(startIdx: number, e: React.ClipboardEvent<HTMLInputElement>, apply: (val: string) => Partial<ItemRow>) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n')) return
    e.preventDefault()
    const values = text.trim().split(/\r?\n/).filter(Boolean)
    setItems(prev => {
      const rows = [...prev]
      while (rows.length < startIdx + values.length) rows.push(makeItem())
      values.forEach((val, offset) => {
        rows[startIdx + offset] = { ...rows[startIdx + offset], ...apply(val.trim()) }
      })
      return rows
    })
  }

  return (
    <>
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            {mode === 'create' ? 'Tạo đơn xuất thủ công' : `Sửa đơn: ${gdo?.group_code}`}
          </h2>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {mode === 'create'
              ? <>Mã xe tự động: <span className="font-mono font-semibold text-slate-600">{codePreview}</span></>
              : <>Trạng thái: <span className={`font-semibold ${gdo?.status === 'PAUSED' ? 'text-red-600' : 'text-amber-600'}`}>{gdo?.status ?? 'PENDING'}</span> — có thể chỉnh sửa</>
            }
          </p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Metadata fields — compact strip, no scroll */}
      <div className="shrink-0 border-b bg-slate-50/50 px-4 py-2.5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500">Ngày xuất <span className="text-red-500">*</span></label>
            <Input type="date" className="h-7 text-xs" value={date} min={TODAY_STR} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500">Kho xuất</label>
            <WarehouseSingleSelect
              warehouses={(warehouses as WarehouseLite[]).filter(w => !formAllowedWhIds || formAllowedWhIds.has(w.id))}
              value={warehouseId}
              onChange={setWarehouseId}
              placeholder="Chọn kho…"
              triggerClassName="h-7"
            />
          </div>
          {setWarehouseType !== undefined ? (
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500">Loại kho <span className="text-red-500">*</span></label>
              <SingleSelect
                options={[{ value: '', label: '— Chọn loại kho' }, ...whTypesInForm.map(t => ({ value: t.value, label: t.value }))]}
                value={warehouseType ?? ''}
                onChange={setWarehouseType}
                placeholder="Loại kho…"
                searchable={false}
                triggerClassName="h-7"
              />
            </div>
          ) : <div />}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500">
              Tên khách hàng {(!isMultiNpp || mode === 'create') && <span className="text-red-500">*</span>}
            </label>
            {isMultiNpp && mode === 'edit' ? (
              <div className="text-[10px] px-2 py-1 border border-slate-100 rounded bg-white text-slate-600 truncate">
                {(gdo?.delivery_orders ?? []).map(d => d.distributor_name).filter(Boolean).join(' · ') || '—'}
              </div>
            ) : (
              // Kho NPP: gợi ý khách hàng CHỈ gồm kho tổng (trả hàng về tổng) — không hiện NPP khác; khách lẻ gõ tay.
              // Luật quỹ đạo kho phụ: kho phụ chỉ gợi ý cho kho parent của nó; kho xuất là kho phụ → chỉ gợi ý parent (xuất trả).
              <CustomerCombobox
                value={customerName}
                onChange={setCustomerName}
                onNPPChange={setShiptoPartyId}
                warehouses={(warehouses as WarehouseLite[]).filter(w => {
                  if (w.parent_warehouse_id) return w.parent_warehouse_id === warehouseId
                  const srcParentId = (warehouses as WarehouseLite[]).find(s => s.id === warehouseId)?.parent_warehouse_id ?? null
                  if (srcParentId) return w.id === srcParentId
                  return !isNPP || w.warehouse_type === 'CENTRAL'
                })}
              />
            )}
            {shiptoPartyId && (internalPair ? (
              <div className="flex items-center gap-1.5 rounded bg-violet-50 border border-violet-200 px-2 py-1 text-[10px] text-violet-800">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>Chuyển <b>NỘI BỘ</b> · Ship-to: <span className="font-mono font-semibold">{shiptoPartyId}</span> — không cần ĐVVT/Loại xe/biển số; kho phụ chỉ bấm Nhận (không cần booking)</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded bg-amber-50 border border-amber-200 px-2 py-1 text-[10px] text-amber-800">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>Chuyển kho · Ship-to: <span className="font-mono font-semibold">{shiptoPartyId}</span> — Hoàn thành đơn sẽ tạo booking theo dõi vận chuyển (theo cài đặt Xác nhận giao hàng)</span>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500">ĐVVT {mode === 'create' && !internalPair && <span className="text-red-500">*</span>}{internalPair && <span className="text-slate-400"> (nội bộ — không bắt buộc)</span>}</label>
            {mode === 'edit' ? (
              <div className="h-7 text-xs px-2 flex items-center border border-slate-100 rounded bg-white text-slate-600">{dvvt || '—'}</div>
            ) : (
              // Kho NPP: chỉ gợi ý ĐVVT thật (NCC-tự-chở chỉ có nghĩa ở kho tổng)
              <DvvtCombobox value={dvvt} onChange={setDvvt} companies={isNPP ? dvvtCompanies.filter(c => c.type === 'ĐVVT') : dvvtCompanies} />
            )}
          </div>
          {plateSlot}
          {!isMultiNpp && (
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500">Số DO *</label>
              <Input className="h-7 text-xs font-mono" placeholder="VD: 3000245103" value={deliveryCode} onChange={e => setDeliveryCode(e.target.value)} />
            </div>
          )}
          {!noVehicle && (
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500">Loại xe <span className="text-red-500">*</span></label>
              {exportTypeOptions.length === 0 ? (
                <p className="text-[10px] text-slate-400 italic leading-7">
                  {warehouseId ? 'Chưa có loại xe — kiểm tra TMS' : 'Chọn kho để lọc'}
                </p>
              ) : (
                <SingleSelect
                  options={exportTypeOptions.map((vt: { id: string; name: string }) => ({ value: vt.name, label: vt.name }))}
                  value={exportType}
                  onChange={setExportType}
                  placeholder="Chọn loại xe…"
                  searchable={false}
                  triggerClassName="h-7"
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="shrink-0 bg-red-50 border-b border-red-200 px-4 py-1.5 text-[11px] text-red-700">{error}</div>
      )}
      {pasteErr && (
        <div className="shrink-0 bg-red-50 border-b border-red-200 px-4 py-1.5 text-[11px] text-red-700 flex items-center justify-between gap-2">
          <span>{pasteErr}</span>
          <button type="button" onClick={() => setPasteErr('')} className="text-red-400 hover:text-red-600 shrink-0"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Items table — flex-1, fills remaining height */}
      <div className="flex-1 min-h-0 overflow-auto px-4 py-3">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
          Danh sách hàng
          <span className="text-slate-400 font-normal normal-case ml-2">paste từ Excel OK — Mã hàng | Thùng | Nhặt lẻ | Batch | %Date | CS | Ghi chú</span>
        </p>
        <div className="rounded-lg border border-slate-200 overflow-x-auto">
          <table className="min-w-max w-full">
            <thead>
              <tr className="bg-slate-50 sticky top-0">
                <th className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-7">#</th>
                <th className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-40">Mã hàng</th>
                <th className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-44">Tên hàng</th>
                <th className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-center w-20">Thùng</th>
                <th className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-center w-20">Hộp / lẻ</th>
                <th className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-center w-32">Nhặt lẻ (tự tính)</th>
                <th className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-28">Batch</th>
                <th className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-right w-16">%Date</th>
                <th className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-24">CS</th>
                <th className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-40">Ghi chú</th>
                {isMultiNpp && <th className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-32">NPP</th>}
                <th className="px-1 py-1.5 w-7" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const fullScanned    = item.min_cartons > 0 && item.min_cartons >= item.cartons
                const partScanned    = item.min_cartons > 0 && item.min_cartons < item.cartons
                const cartonsInvalid = item.cartons > 0 && item.cartons < item.min_cartons
                const isDup          = item.material_code !== '' && duplicateCodes.has(dupKey(item))
                const rowCls = fullScanned ? 'bg-blue-50' : partScanned ? 'bg-amber-50' : isDup ? 'bg-red-50' : ''
                return (
                  <tr key={item.id} className={`border-t border-slate-100 ${rowCls}`}>
                    <td className="px-2 py-1 text-[9px] text-slate-400 tabular-nums">{idx + 1}</td>
                    <td className="px-2 py-1">
                      <MatPicker
                        value={item.material_code}
                        onSelect={(code, name, category, unit, mat) => updateItem(item.id, { material_code: code, mat_name: name, category, unit, mat_units: mat ?? null })}
                        disabled={item.min_cartons > 0 || item.sap_linked}
                        disabledNoType={!warehouseType && item.min_cartons === 0}
                        filterCategory={undefined}
                        onPaste={item.min_cartons === 0 ? e => handlePasteRowAt(idx, e) : undefined}
                      />
                      {item.min_cartons > 0 && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium mt-0.5 inline-block ${fullScanned ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                          Đã xuất {qtyLabel(item.min_cartons, item.mat_units)}
                        </span>
                      )}
                      {/* Thiếu tồn theo (kho, ngày) — cùng badge với trang chi tiết chuyến (user 22/07) */}
                      <ShortageBadge s={item.mat_units?.id ? shortageByMat.get(item.mat_units.id) : undefined} mat={item.mat_units} />
                    </td>
                    <td className="px-2 py-1 text-[10px] text-slate-600 max-w-[176px] whitespace-normal break-words leading-tight align-top" title={item.mat_name || undefined}>{item.mat_name || <span className="text-slate-300">—</span>}</td>
                    {/* Số lượng tách 2 CỘT: Thùng (entry) | Hộp lẻ / Base — nguyên lý y cũ (value/onChange = BASE) */}
                    <td className="px-2 py-1 align-top" onPaste={e => handlePasteCartonsAt(idx, e)}
                      title={item.sap_linked ? 'SL theo DO SAP — sửa ở Dữ liệu bên ngoài' : undefined}>
                      <QtyInput compact part="entry" className={cartonsInvalid ? '[&_input]:border-red-400' : ''}
                        value={item.cartons} mat={item.mat_units} disabled={item.sap_linked}
                        onChange={b => updateItem(item.id, { cartons: b })}
                      />
                    </td>
                    <td className="px-2 py-1 align-top"
                      title={item.sap_linked ? 'SL theo DO SAP — sửa ở Dữ liệu bên ngoài' : undefined}>
                      <QtyInput compact part="base" className={cartonsInvalid ? '[&_input]:border-red-400' : ''}
                        value={item.cartons} mat={item.mat_units} disabled={item.sap_linked}
                        onChange={b => updateItem(item.id, { cartons: b })}
                      />
                      {cartonsInvalid && <p className="text-[9px] text-red-600 text-center">Min {qtyLabel(item.min_cartons, item.mat_units)}</p>}
                    </td>
                    <td className="px-2 py-1 text-center">
                      {/* Nhặt lẻ READ-ONLY (user 22/07): TỰ TÍNH từ Tổng = phần dư không đủ 1 pallet nguyên */}
                      {(() => {
                        const la = looseAutoOf(item)
                        return la > 0 ? (
                          <div className="leading-tight">
                            <div className="text-[10px] font-semibold tabular-nums text-slate-700">{qtyLabel(la, item.mat_units)}</div>
                            <div className="text-[9px] text-slate-400">tự tính từ Tổng</div>
                          </div>
                        ) : <span className="text-[10px] text-slate-300">—</span>
                      })()}
                    </td>
                    <td className="px-2 py-1">
                      <input
                        className="h-6 w-24 rounded border border-slate-200 px-1.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                        placeholder="Batch…"
                        value={item.batch_required}
                        onChange={e => updateItem(item.id, { batch_required: e.target.value })}
                        onPaste={e => handlePasteColAt(idx, e, v => ({ batch_required: v }))}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number" min={0} max={100}
                        className="h-6 w-12 rounded border border-slate-200 px-1 text-[10px] text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                        placeholder="%"
                        value={item.date_required || ''}
                        onChange={e => { updateItem(item.id, { date_required: parseInt(e.target.value) || 0 }); if (pasteErr) setPasteErr('') }}
                        onPaste={e => {
                          e.preventDefault()
                          const cells = e.clipboardData.getData('text').replace(/\r/g, '').split('\n')
                          while (cells.length && cells[cells.length - 1].trim() === '') cells.pop()
                          // Có ô chứa chữ (không phải số 0–100) → CHẶN, không lưu, báo lỗi
                          const bad = cells.map(c => c.trim()).filter(c => parsePctCell(c) === null)
                          if (bad.length > 0) {
                            setPasteErr(`%Date chỉ nhận số 0–100 — giá trị không hợp lệ: ${bad.slice(0, 3).map(b => `"${b}"`).join(', ')}${bad.length > 3 ? '…' : ''}`)
                            return
                          }
                          setPasteErr('')
                          if (cells.length <= 1) { updateItem(item.id, { date_required: parsePctCell(cells[0] ?? '') ?? 0 }); return }
                          setItems(prev => {
                            const rows = [...prev]
                            while (rows.length < idx + cells.length) rows.push(makeItem())
                            cells.forEach((c, off) => { rows[idx + off] = { ...rows[idx + off], date_required: parsePctCell(c) ?? 0 } })
                            return rows
                          })
                        }}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        className="h-6 w-20 rounded border border-slate-200 px-1.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                        placeholder="CS…"
                        value={item.cs_responsible}
                        onChange={e => updateItem(item.id, { cs_responsible: e.target.value })}
                        onPaste={e => handlePasteColAt(idx, e, v => ({ cs_responsible: v }))}
                      />
                    </td>
                    <td className="px-2 py-1">
                      {item.min_cartons > 0 ? (
                        <span className="text-[10px] text-slate-500 italic">{item.header_text || '—'}</span>
                      ) : (
                        <input
                          className="h-6 w-full rounded border border-slate-200 px-1.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                          placeholder="Header text…"
                          value={item.header_text}
                          onChange={e => updateItem(item.id, { header_text: e.target.value })}
                          onPaste={e => handlePasteNoteAt(idx, e)}
                        />
                      )}
                    </td>
                    {isMultiNpp && (
                      <td className="px-2 py-1">
                        {item.db_id ? (
                          <span className="text-[10px] text-slate-600 truncate block max-w-[120px]" title={item.npp}>{item.npp || '—'}</span>
                        ) : (
                          <select
                            className="h-6 w-full rounded border border-slate-200 px-1 text-[10px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                            value={item.npp}
                            onChange={e => updateItem(item.id, { npp: e.target.value })}
                          >
                            <option value="">— Chọn NPP —</option>
                            {nppOptions.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        )}
                      </td>
                    )}
                    <td className="px-1 py-1">
                      {item.min_cartons === 0 && !item.sap_linked && (
                        <button onClick={() => setItems(rows => rows.filter(r => r.id !== item.id))}
                          className="text-slate-300 hover:text-red-400" title="Xóa dòng">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <button
          onClick={() => setItems(rows => [...rows, { ...makeItem(), npp: isMultiNpp ? '' : (nppOptions[0] ?? '') }])}
          className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 w-full justify-center border border-dashed border-blue-200 rounded-lg py-1.5 hover:border-blue-400 mt-2"
        >
          <Plus className="h-3 w-3" /> Thêm dòng
        </button>
        {duplicateCodes.size > 0 && (
          <p className="text-[11px] text-red-600 mt-2">Mã hàng bị trùng trong cùng NPP: {[...duplicateCodes].map(k => k.split('||')[1]).join(', ')}</p>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-4 py-2.5 shrink-0 bg-slate-50/50 flex flex-wrap items-center justify-end gap-2">
        <div className="hidden sm:block flex-1" />
        <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>Hủy</Button>
        <Button size="sm" disabled={submitting} onClick={onSubmit} className="min-w-[100px]">
          {submitting ? 'Đang lưu…' : (mode === 'create' ? 'Lưu' : 'Lưu thay đổi')}
        </Button>
        {quickAction}
      </div>
    </>
  )
}

// ─── Shared modal wrapper ─────────────────────────────────────

function ModalOverlay({ children, onClose, className }: { children: React.ReactNode; onClose: () => void; className?: string }) {
  return (
    // Mobile: full màn hình (không lề); ≥sm: canh giữa có lề
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative z-10 bg-white shadow-2xl flex flex-col w-full h-full max-h-full rounded-none sm:h-auto sm:rounded-xl ${className ?? 'sm:w-[80vw] sm:max-w-[80vw] sm:max-h-[90vh]'}`}>
        {children}
      </div>
    </div>
  )
}

// ─── Create modal ─────────────────────────────────────────────

function GDOModal({ defaultWarehouseId, onClose }: { defaultWarehouseId: string; onClose: () => void }) {
  const TODAY_STR = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const [date, setDate]               = useState(TODAY_STR)
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId)
  const [warehouseType, setWarehouseType] = useState('')
  const [shiptoPartyId, setShiptoPartyId] = useState('')
  const [dvvt, setDvvt]               = useState('')
  const [customerName, setCustomerName] = useState('')
  const [deliveryCode, setDeliveryCode] = useState('')
  const [exportType, setExportType]   = useState('')
  const [items, setItems]             = useState<ItemRow[]>(() => Array.from({ length: 20 }, makeItem))
  const [error, setError]             = useState('')

  const { mutate: createGDO, isPending } = useCreateGDO()
  const { mutate: quickExportGDO, isPending: quickPending } = useQuickExportGDO()
  const { data: warehousesForCreate = [] } = useWarehouses(true)
  const isNPPCreate = (warehousesForCreate as WarehouseLite[]).find(w => w.id === warehouseId)?.warehouse_type === 'NPP'

  // "Xuất luôn" — chỉ khi có quyền + MỌI mã trong đơn là hàng không tem (mã no-QR hoặc kho QTY)
  const modalUser = useAuthStore(s => s.user)
  const modalPerms = (modalUser?.module_permissions ?? null) as ModulePermissions | null
  const canQuick = can(modalPerms, 'outbound', 'quick_export')
  const [quickPlate, setQuickPlate]   = useState('')
  const quickWhMode: string | null = (warehousesForCreate as WarehouseLite[]).find(w => w.id === warehouseId)?.inventory_mode ?? null
  // "Tạo & Xuất luôn" CHỈ cho kho QTY/QTY_DATE/NONE (kho QR đi luồng quét tem) — không phụ thuộc mã hàng.
  const isQtyOrNone = isQtyLike(quickWhMode) || quickWhMode === 'NONE'
  const showQuick = canQuick && isQtyOrNone            // kho QTY/NONE → hiện ô Biển số + (khi đủ) nút xuất luôn
  const quickFilled = items.filter(i => i.material_code.trim())
  // Chuyển nội bộ parent↔kho phụ: biển số tùy chọn (xe nâng/đẩy tay trong site)
  const internalPairCreate = isInternalPairFE(warehousesForCreate as WarehouseLite[], warehouseId, shiptoPartyId)
  // Nút xuất luôn hiện khi: kho QTY/NONE + có mã + đủ ĐVVT + đủ Biển số (thiếu → chỉ nút Lưu; nội bộ không cần cả hai)
  const quickReady = showQuick && quickFilled.length > 0 && (dvvt.trim() !== '' || internalPairCreate) && (quickPlate.trim() !== '' || internalPairCreate)

  // Biển số gợi ý = xe đã đăng ký của ĐVVT đang chọn (khớp tên ĐVVT → công ty → lọc xe theo ncc_id)
  const { data: dvvtCompaniesForPlate = [] } = useTransportCompanies(true)
  const dvvtCompanyId = (dvvtCompaniesForPlate as { id: string; name: string }[]).find(c => c.name === dvvt)?.id ?? null
  // Lọc xe theo ĐVVT NGAY TRÊN SERVER — trước đây tải TOÀN BỘ xe đang hoạt động (953 xe
  // ≈ 439KB hôm nay) rồi mới lọc ở trình duyệt.
  const { data: allVehicles = [] } = useTmsVehicles(
    dvvtCompanyId ? { ncc_id: dvvtCompanyId, is_active: 'true' } : undefined,
    showQuick && !!dvvtCompanyId)
  const platesForDvvt = useMemo(
    () => [...new Set((allVehicles as { license_plate: string }[]).map(v => v.license_plate))],
    [allVehicles],
  )

  function handleSubmit(quick = false) {
    if (!date)         return setError('Chọn ngày xuất')
    if (!deliveryCode.trim()) return setError('Nhập Số DO')
    if (!warehouseType) return setError('Chọn loại kho')
    if (!customerName.trim()) return setError('Nhập tên khách hàng')
    // Chuyển nội bộ parent↔kho phụ: không cần ĐVVT/Loại xe (xe nâng trong site)
    if (!dvvt.trim() && !internalPairCreate)  return setError('Nhập đơn vị vận tải')
    if (!isNPPCreate && !internalPairCreate && !exportType) return setError('Chọn loại xe')
    const filledItems = items.filter(i => i.material_code.trim())
    if (filledItems.length === 0) return setError('Nhập ít nhất một mã hàng')
    const seenCodes = new Set<string>()
    for (const item of filledItems) {
      if (seenCodes.has(item.material_code)) return setError(`Mã hàng bị trùng: ${item.material_code}`)
      seenCodes.add(item.material_code)
    }
    for (const item of filledItems) {
      if (!item.cartons || item.cartons <= 0) return setError(`Số thùng phải > 0 (${item.material_code})`)
    }
    const isQuick = quick && showQuick
    if (isQuick && !quickPlate.trim() && !internalPairCreate) return setError('Nhập biển số xe để Tạo & Xuất luôn')
    setError('')
    const payload = {
      delivery_date: date,
      warehouse_id: warehouseId || undefined,
      warehouse_type: warehouseType,
      shipto_party: shiptoPartyId || undefined,
      dvvt: dvvt.trim(),
      customer_name: customerName.trim(),
      delivery_code: deliveryCode.trim() || undefined,
      export_type: exportType,
      // loose_picking KHÔNG gửi — BE tự tính từ Tổng (pallet-remainder)
      items: filledItems.map(i => ({ material_code: i.material_code, cartons_ordered: i.cartons, header_text: i.header_text || undefined, batch_required: i.batch_required || undefined, date_required: i.date_required || undefined, cs_responsible: i.cs_responsible || undefined })),
    }
    const handlers = {
      onSuccess: () => onClose(),
      onError: (e: unknown) => {
        const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? (isQuick ? 'Lỗi xuất nhanh' : 'Lỗi tạo đơn')
        setError(msg)
      },
    }
    if (isQuick) quickExportGDO({ ...payload, license_plate: quickPlate.trim() }, handlers)
    else createGDO(payload, handlers)
  }

  return (
    <ModalOverlay onClose={onClose}>
      <GDOFormBody
        mode="create"
        date={date} setDate={setDate}
        warehouseId={warehouseId} setWarehouseId={setWarehouseId}
        warehouseType={warehouseType} setWarehouseType={setWarehouseType}
        shiptoPartyId={shiptoPartyId} setShiptoPartyId={setShiptoPartyId}
        dvvt={dvvt} setDvvt={setDvvt}
        customerName={customerName} setCustomerName={setCustomerName}
        deliveryCode={deliveryCode} setDeliveryCode={setDeliveryCode}
        exportType={exportType} setExportType={setExportType}
        items={items} setItems={setItems}
        error={error} isPending={isPending || quickPending}
        onSubmit={() => handleSubmit(false)} onClose={onClose}
        plateSlot={showQuick ? (
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500">Biển số xe {quickReady ? '' : <span className="text-slate-300">(để Xuất luôn)</span>}</label>
            <PlateCombobox value={quickPlate} onChange={setQuickPlate} plates={platesForDvvt} />
          </div>
        ) : undefined}
        quickAction={quickReady ? (
          <Button
            size="sm"
            disabled={isPending || quickPending}
            onClick={() => handleSubmit(true)}
            className="bg-green-600 hover:bg-green-700 min-w-[120px]"
            title="Tạo đơn + ghi nhận số lượng + Hoàn thành + trừ tồn trong 1 bước (kho QTY/NONE)"
          >
            {quickPending ? 'Đang xuất…' : 'Tạo & Xuất luôn'}
          </Button>
        ) : undefined}
      />
    </ModalOverlay>
  )
}

// ─── Edit modal ───────────────────────────────────────────────

export function EditGDOModal({ gdoId, defaultWarehouseId, onClose }: { gdoId: string; defaultWarehouseId: string; onClose: () => void }) {
  const { data: gdo, isLoading } = useGDO(gdoId)
  const { data: allVehicleTypes = [] } = useVehicleTypes()
  const { data: warehousesForEdit = [] } = useWarehouses(true)

  const [date, setDate]               = useState('')
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId)
  const [shiptoPartyId, setShiptoPartyId] = useState('')
  const [dvvt, setDvvt]               = useState('')
  const [customerName, setCustomerName] = useState('')
  const [deliveryCode, setDeliveryCode] = useState('')
  const [exportType, setExportType]   = useState('')
  const [warehouseType, setWarehouseType] = useState('')
  const [items, setItems]             = useState<ItemRow[]>([])
  const [error, setError]             = useState('')
  const [initialized, setInitialized] = useState(false)

  const { mutate: updateGDO, isPending } = useUpdateGDO()
  const { mutate: quickExportExisting, isPending: quickPending } = useQuickExportExistingGDO()

  // "Lưu & Xuất luôn" trong form Sửa — như form Tạo: chỉ kho QTY/NONE + quyền quick_export.
  // PENDING + PAUSED (đơn tạm dừng để sửa → xuất luôn = tự tiếp tục + chốt; updateGDO cũng chỉ nhận 2 trạng thái này).
  const editUser = useAuthStore(s => s.user)
  const editPerms = (editUser?.module_permissions ?? null) as ModulePermissions | null
  const canQuickEdit = can(editPerms, 'outbound', 'quick_export')
  const [quickPlate, setQuickPlate] = useState('')
  const editWhMode: string | null = (warehousesForEdit as WarehouseLite[]).find(w => w.id === warehouseId)?.inventory_mode ?? null
  const isQtyOrNoneEdit = isQtyLike(editWhMode) || editWhMode === 'NONE'
  const showQuickEdit = canQuickEdit && isQtyOrNoneEdit && (gdo?.status === 'PENDING' || gdo?.status === 'PAUSED')
  // Chuyển nội bộ parent↔kho phụ: biển số tùy chọn (như form Tạo)
  const internalPairEdit = isInternalPairFE(warehousesForEdit as WarehouseLite[], warehouseId, shiptoPartyId)
  const quickReadyEdit = showQuickEdit && items.some(i => i.material_code.trim()) && (dvvt.trim() !== '' || internalPairEdit) && (quickPlate.trim() !== '' || internalPairEdit)

  // Biển số gợi ý = xe đã đăng ký của ĐVVT đang chọn (giống form Tạo)
  const { data: dvvtCompaniesForPlate = [] } = useTransportCompanies(true)
  const dvvtCompanyId = (dvvtCompaniesForPlate as { id: string; name: string }[]).find(c => c.name === dvvt)?.id ?? null
  // Lọc xe theo ĐVVT NGAY TRÊN SERVER — trước đây tải TOÀN BỘ xe đang hoạt động (953 xe
  // ≈ 439KB hôm nay) rồi mới lọc ở trình duyệt.
  const { data: allVehicles = [] } = useTmsVehicles(
    dvvtCompanyId ? { ncc_id: dvvtCompanyId, is_active: 'true' } : undefined,
    showQuickEdit && !!dvvtCompanyId)
  const platesForDvvt = useMemo(
    () => [...new Set((allVehicles as { license_plate: string }[]).map(v => v.license_plate))],
    [allVehicles],
  )

  // Pre-fill once GDO loads (wait for vehicle types to normalize correctly)
  useEffect(() => {
    if (!gdo || initialized || allVehicleTypes.length === 0) return
    setInitialized(true)
    setDate(gdo.delivery_date)
    setWarehouseId(gdo.warehouse_id ?? '')
    setShiptoPartyId(gdo.shipto_party ?? '')
    setDvvt(gdo.dvvt ?? '')
    setWarehouseType(gdo.warehouse_type ?? '')
    setQuickPlate(gdo.license_plate ?? '')
    // distributor_name: single-DO → from first DO; multi-DO → displayed read-only separately
    setCustomerName(gdo.delivery_orders?.[0]?.distributor_name ?? '')
    setDeliveryCode(gdo.delivery_orders?.[0]?.delivery_code ?? '')
    // export_type: tìm từ items, normalize để match "xe container"→"Xe Container", "xe xa"→"Xe Xá"
    const allItemsForFill = (gdo.delivery_orders ?? []).flatMap(d => d.items ?? [])
    const rawExportType = allItemsForFill.find(i => i.export_type)?.export_type ?? ''
    setExportType(canonicalExportType(rawExportType, allVehicleTypes))

    // Build items from delivery_orders (single DO for manual, all DOs for multi-DO)
    const allItems: ItemRow[] = (gdo.delivery_orders ?? []).flatMap(doRow =>
      (doRow.items ?? []).map(item => ({
        id: uid(),
        db_id: item.id,
        material_code: item.material_code_raw ?? '',
        mat_name: item.material?.short_name ?? '',
        unit: unitCodeOf(item.material),
        category: item.material_type ?? null,
        cartons: item.cartons_ordered ?? 0,
        min_cartons: item.cartons_scanned ?? 0,
        mat_units: item.material ?? null,
        sap_linked: (item.od_refs?.length ?? 0) > 0,
        batch_required: item.batch_required ?? '',
        date_required: item.date_required ?? 0,
        cs_responsible: item.cs_responsible ?? '',
        header_text: item.header_text ?? '',
        npp: (doRow.distributor_name ?? '').trim(),
      }))
    )
    setItems(allItems.length ? allItems : [makeItem()])
  }, [gdo, initialized, allVehicleTypes])

  const isNPPEdit = (warehousesForEdit as WarehouseLite[]).find(w => w.id === warehouseId)?.warehouse_type === 'NPP'

  function handleSubmit(quick = false) {
    // Đa-NPP (chuẩn 04/07) — DO chỉ là tham khảo, không dùng làm tiêu chí
    const isMultiNpp = new Set((gdo?.delivery_orders ?? []).map(d => (d.distributor_name ?? '').trim()).filter(Boolean)).size > 1
    if (!date) return setError('Chọn ngày xuất')
    if (!isMultiNpp && !deliveryCode.trim()) return setError('Nhập Số DO')
    if (!isMultiNpp && !customerName.trim()) return setError('Nhập tên khách hàng')
    if (!isNPPEdit && !internalPairEdit && !exportType) return setError('Chọn loại xe')
    for (const item of items) {
      if (!item.material_code.trim()) return setError('Chọn mã hàng cho tất cả dòng')
      if (!item.cartons || item.cartons <= 0) return setError('Số thùng phải > 0')
      if (item.cartons < item.min_cartons) return setError(`Số thùng không được nhỏ hơn đã xuất (${item.min_cartons})`)
      if (isMultiNpp && !item.db_id && !item.npp.trim()) return setError(`Dòng "${item.material_code}": chọn NPP cho dòng thêm mới`)
    }
    const isQuick = quick && showQuickEdit
    if (isQuick && !quickPlate.trim() && !internalPairEdit) return setError('Nhập biển số xe để Xuất luôn')
    setError('')
    updateGDO(
      {
        id: gdoId,
        delivery_date: date,
        warehouse_id: warehouseId || undefined,
        shipto_party: shiptoPartyId || undefined,
        dvvt: dvvt.trim(),
        customer_name: customerName.trim(),
        delivery_code: deliveryCode.trim() || undefined,
        export_type: exportType,
        warehouse_type: warehouseType || undefined,
        // loose_picking KHÔNG gửi — BE tự tính từ Tổng (pallet-remainder)
        items: items.map(i => ({ db_id: i.db_id, material_code: i.material_code, cartons_ordered: i.cartons, header_text: i.header_text || undefined, batch_required: i.batch_required || undefined, date_required: i.date_required || undefined, cs_responsible: i.cs_responsible || undefined, npp: i.npp || undefined })),
      },
      {
        // Lưu & Xuất luôn: cập nhật đơn xong mới gọi xuất (đảm bảo xuất theo số VỪA SỬA)
        onSuccess: () => {
          if (!isQuick) return onClose()
          quickExportExisting(
            { gdoId, license_plate: quickPlate.trim() },
            {
              onSuccess: () => onClose(),
              onError: (e: unknown) => {
                const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Đã lưu nhưng chưa xuất được'
                setError(msg)
              },
            }
          )
        },
        onError: (e: unknown) => {
          const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi cập nhật đơn'
          setError(msg)
        },
      }
    )
  }

  return (
    <ModalOverlay onClose={onClose}>
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-sm text-slate-400">Đang tải…</div>
        </div>
      ) : (
        <GDOFormBody
          mode="edit"
          gdo={gdo}
          date={date} setDate={setDate}
          warehouseId={warehouseId} setWarehouseId={setWarehouseId}
          shiptoPartyId={shiptoPartyId} setShiptoPartyId={setShiptoPartyId}
          dvvt={dvvt} setDvvt={setDvvt}
          customerName={customerName} setCustomerName={setCustomerName}
          deliveryCode={deliveryCode} setDeliveryCode={setDeliveryCode}
          exportType={exportType} setExportType={setExportType}
          warehouseType={warehouseType} setWarehouseType={setWarehouseType}
          items={items} setItems={setItems}
          error={error} isPending={isPending || quickPending}
          onSubmit={() => handleSubmit(false)} onClose={onClose}
          plateSlot={showQuickEdit ? (
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500">Biển số xe {quickReadyEdit ? '' : <span className="text-slate-300">(để Xuất luôn)</span>}</label>
              <PlateCombobox value={quickPlate} onChange={setQuickPlate} plates={platesForDvvt} />
            </div>
          ) : undefined}
          quickAction={quickReadyEdit ? (
            <Button
              size="sm"
              disabled={isPending || quickPending}
              onClick={() => handleSubmit(true)}
              className="bg-green-600 hover:bg-green-700 min-w-[120px]"
              title="Lưu thay đổi + ghi nhận số lượng + Hoàn thành + trừ tồn trong 1 bước (kho QTY/NONE)"
            >
              {quickPending ? 'Đang xuất…' : 'Lưu & Xuất luôn'}
            </Button>
          ) : undefined}
        />
      )}
    </ModalOverlay>
  )
}
