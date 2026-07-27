import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { sanitizeRows } from '@/utils/excelSafe'
import type { AxiosError } from 'axios'
import { Package, X, SlidersHorizontal, ChevronRight, Check, Rows3, AlignJustify, Scissors, Layers, Sigma, Download, Upload, BadgeCheck, Factory, MapPin, Tag, CalendarDays } from 'lucide-react'
import { UploadExcelDialog } from '@/components/shared/UploadExcelDialog'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Label } from '@/components/ui/label'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SavedViews } from '@/components/shared/SavedViews'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import {
  useInventoryEntries, useInventoryFacets, useWarehouses, useQAStatuses, useAdjustInventory, useUploadInventoryExcel,
  useAdjustmentLog,
  useLocationsReal, useMaterials,
  useBulkUpdateInventoryQA, useBulkTransferLocation, useBulkTransferMaterial,
  useBulkUpdateProductionDate, useBulkUpdateInventoryNcc, useTransportCompanies,
  useInventorySummary, type InventorySummaryGroup, fetchInventoryExport,
  useSystemSettings,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useScopedWhTypes } from '@/hooks/useUserScope'
import { can } from '@/config/permissions'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { resolveShelfLife, computePctDate } from '@/utils/shelfLife'
import { qtyLabel, qtySplit, qtyUnitLabel, qtyBaseLabel, hasEntry, unitLabel } from '@/utils/qtyUnits'
import { saveWorkbook } from '@/utils/saveExcel'
import type { InventoryEntry, SupplierShelfLifeOverride } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────

function formatLoc(loc: { location_code: string } | null): string {
  if (!loc) return '—'
  return loc.location_code
}

function datePctCls(pct: number): string {
  if (pct >= 70) return 'text-green-600 font-semibold'
  if (pct >= 40) return 'text-amber-600 font-semibold'
  return 'text-red-600 font-semibold'
}

// Nền dòng: dữ liệu KHÔNG tô màu theo trạng thái. Dòng đang xem (selected) nền xanh đậm để chữ
// trắng đọc rõ; dòng đã tick nền xanh nhạt; còn lại trong suốt.
function entryRowBg(selected: boolean, checked: boolean): string {
  if (selected) return 'bg-blue-600 hover:bg-blue-700'
  if (checked)  return 'bg-green-50 hover:bg-green-100'
  return 'hover:bg-slate-50'
}

// Màu CHỮ CHUNG cả dòng — mọi cột theo 1 màu (không có màu riêng từng cột). `[&_td_span]` override
// màu mọi span trong dòng. Ưu tiên: đang xem (trắng) > QA status (đỏ) > % date (tím/cam) > thường.
//   QA status = cờ chất lượng (OK = không có qa_status). < 60% date → tím · 60–80% → cam.
function entryRowText(e: InventoryEntry, selected: boolean): string {
  if (selected)    return '[&_td_span]:text-white'
  if (e.qa_status && e.qa_status.code !== 'OK') return '[&_td_span]:text-red-600'   // chỉ đỏ khi QA GIỮ thật; OK (hoặc NULL) = không đỏ
  const pct = computePctDate(e, e.material)
  if (pct !== null && pct < 60) return '[&_td_span]:text-purple-600'
  if (pct !== null && pct < 80) return '[&_td_span]:text-orange-600'
  return '[&_td_span]:text-slate-700'
}

const STATUS_LABEL: Record<string, string> = {
  IN_STOCK: 'Còn hàng', PARTIAL: 'Xuất 1 phần', EXPORTED: 'Đã xuất',
  TRANSFERRED: 'Đã chuyển', QUARANTINE: 'Cách ly', CANCELLED: 'Đã hủy',
  LOOSE_PICKING: 'Đang nhặt lẻ',
}
const STATUS_CLS: Record<string, string> = {
  IN_STOCK: 'bg-green-100 text-green-700', PARTIAL: 'bg-amber-100 text-amber-700',
  EXPORTED: 'bg-blue-100 text-blue-700', TRANSFERRED: 'bg-slate-100 text-slate-600',
  QUARANTINE: 'bg-red-100 text-red-700', CANCELLED: 'bg-gray-100 text-gray-500',
  LOOSE_PICKING: 'bg-purple-100 text-purple-700',
}

const LIMIT = 50
const EXPORT_MAX = 50_000  // chặn export nếu vượt — yêu cầu lọc hẹp lại (tránh treo trình duyệt)

function writeXlsx(rows: Record<string, unknown>[], baseName: string) {
  const ws = XLSX.utils.json_to_sheet(sanitizeRows(rows))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Tồn kho')
  saveWorkbook(wb, baseName)   // chọn vị trí + nhớ thư mục trước (fallback tải thẳng)
}

// Cột bảng tồn kho — số phần tử PHẢI khớp số <TableCell> mỗi dòng EntryRow (19 cột)
const INVENTORY_COLS: { id: string; label: string; w: number; align?: 'right' }[] = [
  { id: 'check',     label: '',         w: 32 },
  { id: 'warehouse', label: 'Kho',      w: 110 },
  { id: 'category',  label: 'Loại kho', w: 90 },
  { id: 'matCode',   label: 'Mã hàng',  w: 90 },
  { id: 'matName',   label: 'Tên hàng', w: 150 },
  { id: 'ncc',       label: 'NCC',      w: 110 },
  { id: 'pallet',    label: 'Mã pallet',w: 110 },
  { id: 'nmsx',      label: 'NMSX',     w: 52 },
  { id: 'location',  label: 'Vị trí',   w: 90 },
  { id: 'imported',  label: 'Nhập',     w: 116, align: 'right' },
  { id: 'exported',  label: 'Xuất',     w: 116, align: 'right' },
  { id: 'remaining', label: 'Tồn',      w: 116, align: 'right' },
  { id: 'reserved',  label: 'Nhặt lẻ',  w: 110, align: 'right' },
  { id: 'available', label: 'Khả dụng', w: 116, align: 'right' },
  { id: 'date',      label: 'Date',     w: 70 },
  { id: 'datePct',   label: '%Date',    w: 60, align: 'right' },
  { id: 'qa',        label: 'QA',       w: 60 },
  { id: 'adjust',    label: 'Đ.chỉnh',  w: 64, align: 'right' },
  { id: 'chevron',   label: '',         w: 28 },
]
const INVENTORY_COL_DEFAULTS = INVENTORY_COLS.map(c => c.w)

// Cột bảng TỔNG HỢP (gom theo Kho × Mã hàng × Ngày SX) — số phần tử phải khớp số <TableCell> ở SummaryRow (10 cột)
const SUMMARY_COLS: { id: string; label: string; w: number; align?: 'right' }[] = [
  { id: 'warehouse', label: 'Kho',      w: 120 },
  { id: 'category',  label: 'Loại kho', w: 90 },
  { id: 'matCode',   label: 'Mã hàng',  w: 100 },
  { id: 'matName',   label: 'Tên hàng', w: 180 },
  { id: 'ncc',       label: 'NCC',      w: 110 },
  { id: 'date',      label: 'Date',     w: 80 },
  { id: 'datePct',   label: '%Date',    w: 64, align: 'right' },
  { id: 'imported',  label: 'Nhập',     w: 124, align: 'right' },
  { id: 'exported',  label: 'Xuất',     w: 124, align: 'right' },
  { id: 'remaining', label: 'Tồn',      w: 124, align: 'right' },
  { id: 'pallets',   label: 'Số pallet',w: 72, align: 'right' },
]
const SUMMARY_COL_DEFAULTS = SUMMARY_COLS.map(c => c.w)

const DATE_PCT_OPTIONS = [
  { value: '80',   label: '> 80%'  },
  { value: '60',   label: '60–80%' },
  { value: '30',   label: '30–60%' },
  { value: 'le30', label: '≤ 30%'  },
]


// ─── Action modals ────────────────────────────────────────────

function QAPanel({ ids, qaStatuses, onClose }: {
  ids: string[]
  qaStatuses: { id: string; code: string; name: string }[]
  onClose: () => void
}) {
  const user = useAuthStore(s => s.user)
  const [qaId, setQaId]     = useState('')
  const [error, setError]   = useState('')
  const { mutate, isPending } = useBulkUpdateInventoryQA()

  const nonOk  = qaStatuses.filter(q => q.code.toUpperCase() !== 'OK')
  const hasOk  = qaStatuses.some(q => q.code.toUpperCase() === 'OK')
  const qaOptions: { id: string; label: string }[] = [
    ...nonOk.map(q => ({ id: q.id, label: `${q.code} – ${q.name}` })),
    ...(hasOk ? [{ id: '__ok__', label: 'OK' }] : []),
  ]

  function handleSubmit() {
    setError('')
    mutate(
      { ids, qa_status_id: qaId === '__ok__' ? null : qaId, employee_id: user?.id },
      {
        onSuccess: () => { setQaId(''); onClose() },
        onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Lỗi không xác định'),
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 w-full border-l bg-white overflow-y-auto flex flex-col lg:static lg:inset-auto lg:z-auto lg:w-72 lg:shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
        <p className="text-xs font-semibold text-slate-700">Cập nhật QA Status</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">{ids.length} pallet</span>
          <button onClick={() => { setQaId(''); setError(''); onClose() }} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="p-3 space-y-3 text-xs flex-1">
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">QA Status mới</Label>
          <div className="border rounded-md overflow-hidden">
            {qaOptions.map(opt => (
              <label key={opt.id}
                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer border-b last:border-b-0 transition-colors ${
                  qaId === opt.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
                onClick={() => setQaId(prev => prev === opt.id ? '' : opt.id)}
              >
                <div className={`w-3.5 h-3.5 border rounded shrink-0 flex items-center justify-center transition-colors ${
                  qaId === opt.id ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'
                }`}>
                  {qaId === opt.id && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                </div>
                <span className={`text-xs ${opt.id === '__ok__' ? 'text-green-700 font-medium' : 'text-slate-700'}`}>
                  {opt.label}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={() => { setQaId(''); setError(''); onClose() }}>Huỷ</Button>
          <Button className="flex-1" disabled={!qaId || isPending} onClick={handleSubmit}>
            {isPending ? '…' : 'Cập nhật'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function NccPanel({ ids, material, onClose }: {
  ids: string[]
  material?: { supplier_shelf_life_overrides?: SupplierShelfLifeOverride[] | null } | null
  onClose: () => void
}) {
  const user = useAuthStore(s => s.user)
  const [selKey, setSelKey] = useState('')   // '' = chưa chọn; '__none__' = bỏ; '<ncc>|<shelf?>'
  const [expanded, setExpanded] = useState(false)
  const [error, setError]   = useState('')
  const { mutate, isPending } = useBulkUpdateInventoryNcc()
  const { data: allCompanies = [] } = useTransportCompanies(true, 'NCC')   // chỉ NCC, không lấy ĐVVT
  const allNcc = (allCompanies as { id: string; name: string; type?: string }[]).filter(c => c.type === 'NCC')
  const nccName = (id: string) => allNcc.find(n => n.id === id)?.name ?? '(NCC?)'
  // Khi các pallet chọn cùng 1 mã hàng → ưu tiên hiện biến thể (NCC, shelflife) đã khai cho mã đó
  const shelfOv = material?.supplier_shelf_life_overrides ?? []
  const variants = shelfOv
    .filter(o => allNcc.some(n => n.id === o.transport_company_id))
    .map(o => ({ id: `${o.transport_company_id}|${o.shelf_life_days}`, label: `${nccName(o.transport_company_id)} (${o.shelf_life_days} ngày)`, nccId: o.transport_company_id }))

  function handleSubmit() {
    setError('')
    let ncc_id: string | null = null
    let shelf_life_days: number | null = null
    if (selKey !== '__none__' && selKey) {
      const [id, sh] = selKey.split('|')
      ncc_id = id || null
      shelf_life_days = sh ? Number(sh) : null
    }
    mutate(
      { ids, ncc_id, shelf_life_days, employee_id: user?.id },
      {
        onSuccess: () => { setSelKey(''); onClose() },
        onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Lỗi không xác định'),
      }
    )
  }

  // Ưu tiên: biến thể của mã hàng; "Mở rộng" mới thêm tất cả NCC (không kèm shelflife)
  const options: { id: string; label: string; muted?: boolean }[] = [
    ...variants,
    ...(expanded ? allNcc.filter(n => !variants.some(v => v.nccId === n.id)).map(c => ({ id: `${c.id}|`, label: c.name })) : []),
    { id: '__none__', label: '— Bỏ NCC (HSD mặc định) —', muted: true },
  ]

  return (
    <div className="fixed inset-0 z-50 w-full border-l bg-white overflow-y-auto flex flex-col lg:static lg:inset-auto lg:z-auto lg:w-72 lg:shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
        <p className="text-xs font-semibold text-slate-700">Sửa NCC hàng loạt</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">{ids.length} pallet</span>
          <button onClick={() => { setSelKey(''); setError(''); onClose() }} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="p-3 space-y-3 text-xs flex-1">
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
        )}
        <p className="text-[10px] text-slate-400">Chọn NCC = đặt luôn shelflife của lô đó → %Date tính lại. Ưu tiên NCC đã khai cho mã hàng; "Mở rộng" để xem tất cả.</p>
        <div className="space-y-1.5">
          <Label className="text-xs">Nhà cung cấp (NCC)</Label>
          {allNcc.length === 0 ? (
            <p className="text-[11px] text-amber-600">Chưa có NCC — tạo ở Cài đặt TMS.</p>
          ) : (
            <div className="border rounded-md overflow-hidden">
              {options.map(opt => (
                <label key={opt.id}
                  className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer border-b last:border-b-0 transition-colors ${
                    selKey === opt.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                  onClick={() => setSelKey(prev => prev === opt.id ? '' : opt.id)}
                >
                  <div className={`w-3.5 h-3.5 border rounded shrink-0 flex items-center justify-center transition-colors ${
                    selKey === opt.id ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'
                  }`}>
                    {selKey === opt.id && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                  </div>
                  <span className={`text-xs ${opt.muted ? 'text-slate-500' : 'text-slate-700'}`}>{opt.label}</span>
                </label>
              ))}
            </div>
          )}
          {allNcc.length > 0 && (
            <button type="button" onClick={() => setExpanded(x => !x)} className="text-[10px] text-sky-600 hover:underline">
              {expanded ? 'Thu gọn' : 'Mở rộng: tất cả NCC'}
            </button>
          )}
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={() => { setSelKey(''); setError(''); onClose() }}>Huỷ</Button>
          <Button className="flex-1" disabled={!selKey || isPending} onClick={handleSubmit}>
            {isPending ? '…' : 'Cập nhật'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function LocationPanel({ ids, warehouseId, category, onClose }: {
  ids: string[]; warehouseId?: string; category?: string; onClose: () => void
}) {
  const user = useAuthStore(s => s.user)
  const [search, setSearch]   = useState('')
  const [locId, setLocId]     = useState('')
  const [error, setError]     = useState('')
  const { mutate, isPending }  = useBulkTransferLocation()
  const { data: allLocs = [] } = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId, category: category || undefined } : undefined
  )

  const filtered = useMemo(() => {
    const s = search.toLowerCase()
    return (allLocs as any[]).filter((l: any) =>
      !s || l.location_code?.toLowerCase().includes(s) || l.sub_code?.toLowerCase().includes(s)
    )
  }, [allLocs, search])

  const selectedLoc = useMemo(() =>
    (allLocs as any[]).find((l: any) => l.id === locId), [allLocs, locId]
  )

  function reset() { setLocId(''); setSearch(''); setError('') }

  function handleSubmit() {
    if (!locId) { setError('Chọn vị trí trước'); return }
    setError('')
    mutate(
      { ids, location_id: locId, employee_id: user?.id },
      {
        onSuccess: () => { reset(); onClose() },
        onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Lỗi không xác định'),
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 w-full border-l bg-white overflow-y-auto flex flex-col lg:static lg:inset-auto lg:z-auto lg:w-72 lg:shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
        <p className="text-xs font-semibold text-slate-700">Chuyển vị trí</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">{ids.length} pallet</span>
          <button onClick={() => { reset(); onClose() }} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="p-3 space-y-3 text-xs flex-1">
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">Vị trí mới</Label>
          <Input placeholder="Tìm vị trí…" value={search} autoFocus
            onChange={e => setSearch(e.target.value)} className="h-8 text-sm" />
          <div className="border rounded max-h-[calc(100vh-280px)] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400 text-center">Không tìm thấy</div>
            ) : (
              filtered.map((l: any) => {
                const isFull = l.max_pallets > 0 && (l.used_slots ?? 0) >= l.max_pallets
                const isSelected = locId === l.id
                return (
                  <label key={l.id}
                    className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer border-b last:border-b-0 transition-colors ${
                      isSelected ? 'bg-blue-50' : isFull ? 'opacity-50 bg-slate-50 cursor-not-allowed' : 'hover:bg-slate-50'
                    }`}
                    onClick={() => { if (!isFull) setLocId(prev => prev === l.id ? '' : l.id) }}
                  >
                    <div className={`w-3.5 h-3.5 border rounded shrink-0 flex items-center justify-center transition-colors ${
                      isSelected ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'
                    }`}>
                      {isSelected && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                    </div>
                    <span className="text-xs font-mono font-semibold">{formatLoc(l)}</span>
                    <span className={`ml-auto text-[10px] ${isFull ? 'text-red-400 font-medium' : 'text-slate-400'}`}>
                      {l.used_slots ?? 0}/{l.max_pallets}{isFull ? ' (đầy)' : ''}
                    </span>
                  </label>
                )
              })
            )}
          </div>
          {selectedLoc && (
            <p className="text-[10px] text-blue-600">
              Đã chọn: <strong className="font-mono">{formatLoc(selectedLoc)}</strong>
              <button className="ml-2 text-slate-400 hover:text-red-500" onClick={reset}>✕ bỏ chọn</button>
            </p>
          )}
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={() => { reset(); onClose() }}>Huỷ</Button>
          <Button className="flex-1" disabled={!locId || isPending} onClick={handleSubmit}>
            {isPending ? '…' : 'Chuyển'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function MaterialPanel({ ids, category, onClose }: {
  ids: string[]; category?: string; onClose: () => void
}) {
  const user = useAuthStore(s => s.user)
  const [search, setSearch]     = useState('')
  const [matId, setMatId]       = useState('')
  const [error, setError]       = useState('')
  const [confirming, setConfirming] = useState(false)
  const { mutate, isPending }   = useBulkTransferMaterial()
  // Tìm trên server, 50 mã đầu — trước đây bỏ trống ô tìm là kéo cả danh mục mã hàng về máy
  const searchDeb = useDebouncedValue(search, 250)
  const { data: materials = [] } = useMaterials({ search: searchDeb || undefined, category: category || undefined, limit: 50 })

  const selectedMat = useMemo(() =>
    (materials as any[]).find((m: any) => m.id === matId), [materials, matId]
  )

  function reset() { setMatId(''); setSearch(''); setError(''); setConfirming(false) }

  function handleSubmit() {
    setError('')
    mutate(
      { ids, material_id: matId, employee_id: user?.id },
      {
        onSuccess: () => { reset(); onClose() },
        onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Lỗi không xác định'),
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 w-full border-l bg-white overflow-y-auto flex flex-col lg:static lg:inset-auto lg:z-auto lg:w-72 lg:shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
        <p className="text-xs font-semibold text-slate-700">Chuyển mã hàng</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">{ids.length} pallet</span>
          <button onClick={() => { reset(); onClose() }} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="p-3 space-y-3 text-xs flex-1">
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
        )}

        {confirming ? (
          /* ── Confirm step ── */
          <div className="space-y-3">
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-800">Xác nhận chuyển mã?</p>
              <div className="text-[10px] text-amber-700 space-y-0.5">
                <p><span className="text-slate-500">Số pallet:</span> <strong>{ids.length}</strong></p>
                <p><span className="text-slate-500">Mã mới:</span> <strong className="font-mono">{selectedMat?.material_code}</strong></p>
                {selectedMat?.short_name && (
                  <p><span className="text-slate-500">Tên:</span> {selectedMat.short_name}</p>
                )}
              </div>
              <p className="text-[10px] text-amber-600">Thao tác này sẽ đổi mã hàng của tất cả pallet đã chọn.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>Quay lại</Button>
              <Button className="flex-1 bg-amber-600 hover:bg-amber-700" disabled={isPending} onClick={handleSubmit}>
                {isPending ? '…' : 'Xác nhận chuyển'}
              </Button>
            </div>
          </div>
        ) : (
          /* ── Select step ── */
          <div className="space-y-1.5">
            <Label className="text-xs">Hàng hóa mới</Label>
            {category && (
              <p className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 rounded px-2 py-1">
                Chỉ hiện mã cùng loại: <strong>{category}</strong>
              </p>
            )}
            <Input placeholder="Tìm mã hoặc tên hàng…" value={search} autoFocus
              onChange={e => { setSearch(e.target.value); setMatId('') }} className="h-8 text-sm" />
            {(search || category) && (
              <div className="border rounded max-h-[calc(100vh-320px)] overflow-y-auto">
                {(materials as any[]).length === 0 ? (
                  <div className="px-3 py-2 text-xs text-slate-400 text-center">Không tìm thấy</div>
                ) : (
                  (materials as any[]).map((m: any) => {
                    const isSelected = matId === m.id
                    return (
                      <label key={m.id}
                        className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer border-b last:border-b-0 transition-colors ${
                          isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                        }`}
                        onClick={() => setMatId(prev => prev === m.id ? '' : m.id)}
                      >
                        <div className={`w-3.5 h-3.5 border rounded shrink-0 flex items-center justify-center transition-colors ${
                          isSelected ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'
                        }`}>
                          {isSelected && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                        </div>
                        <span className="text-[10px] font-mono text-slate-500 shrink-0">{m.material_code}</span>
                        <span className="text-xs text-slate-700 truncate">{m.short_name ?? m.material_description}</span>
                      </label>
                    )
                  })
                )}
              </div>
            )}
            {selectedMat && (
              <p className="text-[10px] text-blue-600">
                Đã chọn: <strong className="font-mono">{selectedMat.material_code}</strong> – {selectedMat.short_name ?? ''}
                <button className="ml-2 text-slate-400 hover:text-red-500" onClick={reset}>✕ bỏ chọn</button>
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => { reset(); onClose() }}>Huỷ</Button>
              <Button className="flex-1" disabled={!matId} onClick={() => setConfirming(true)}>
                Chuyển
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ProductionDatePanel({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const user = useAuthStore(s => s.user)
  const [date, setDate]           = useState('')
  const [error, setError]         = useState('')
  const [confirming, setConfirming] = useState(false)
  const { mutate, isPending }     = useBulkUpdateProductionDate()

  function reset() { setDate(''); setError(''); setConfirming(false) }

  function handleSubmit() {
    setError('')
    mutate(
      { ids, production_date: date, employee_id: user?.id },
      {
        onSuccess: () => { reset(); onClose() },
        onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Lỗi không xác định'),
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 w-full border-l bg-white overflow-y-auto flex flex-col lg:static lg:inset-auto lg:z-auto lg:w-72 lg:shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
        <p className="text-xs font-semibold text-slate-700">Sửa ngày sản xuất</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">{ids.length} pallet</span>
          <button onClick={() => { reset(); onClose() }} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="p-3 space-y-3 text-xs flex-1">
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
        )}
        {confirming ? (
          <div className="space-y-3">
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-800">Xác nhận đổi ngày SX?</p>
              <div className="text-[10px] text-amber-700 space-y-0.5">
                <p><span className="text-slate-500">Số pallet:</span> <strong>{ids.length}</strong></p>
                <p><span className="text-slate-500">Ngày mới:</span> <strong className="font-mono">{date}</strong></p>
              </div>
              <p className="text-[10px] text-amber-600">Thao tác này sẽ đổi ngày SX của tất cả pallet đã chọn.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>Quay lại</Button>
              <Button className="flex-1 bg-amber-600 hover:bg-amber-700" disabled={isPending} onClick={handleSubmit}>
                {isPending ? '…' : 'Xác nhận đổi'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Ngày sản xuất mới</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-8 text-sm mt-1" autoFocus />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => { reset(); onClose() }}>Huỷ</Button>
              <Button className="flex-1" disabled={!date} onClick={() => setConfirming(true)}>Tiếp theo</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────

export default function Inventory() {
  const user = useAuthStore(s => s.user)
  const { inventory: f, setInventory } = useWmsFilterStore()
  const limit = f.pageSize || LIMIT   // số dòng/trang user chọn (50/100/500/1000); fallback mặc định

  const navigate = useNavigate()
  const [selected,     setSelected]     = useState<InventoryEntry | null>(null)
  const [checkedIds,   setCheckedIds]   = useState<Set<string>>(new Set())
  const [actionModal,  setActionModal]  = useState<'qa' | 'ncc' | 'location' | 'material' | 'production-date' | null>(null)
  const [dense, setDense] = useState(() => localStorage.getItem('inventory_density') !== 'comfortable')
  function toggleDensity() {
    setDense(d => { localStorage.setItem('inventory_density', d ? 'comfortable' : 'compact'); return !d })
  }
  const [aggregate, setAggregate] = useState(() => localStorage.getItem('inventory_view_mode') === 'summary')
  const [exporting, setExporting]     = useState(false)
  const [exportError, setExportError] = useState('')
  const [showUpload, setShowUpload]   = useState(false)
  const uploadInventory = useUploadInventoryExcel()
  function toggleAggregate() {
    const next = !aggregate
    localStorage.setItem('inventory_view_mode', next ? 'summary' : 'pallet')
    setAggregate(next)
    setSelected(null)
    setCheckedIds(new Set())
    setInventory({ page: 1 })
  }
  // Cờ định dạng tem của ĐƠN VỊ — ĐV tem `;` (semicolon) mới thêm cột Mã lô + HSD vào bảng Tồn kho.
  const { data: sysSettings = [] } = useSystemSettings()
  const isV2Format = (sysSettings.find(s => s.key === 'label_format')?.value as string) === 'semicolon'
  const invCols = useMemo(() => {
    if (!isV2Format) return INVENTORY_COLS
    const out = [...INVENTORY_COLS]
    const iPallet = out.findIndex(c => c.id === 'pallet')
    if (iPallet >= 0) out.splice(iPallet + 1, 0, { id: 'batch', label: 'Mã lô', w: 120 })
    const iDate = out.findIndex(c => c.id === 'date')
    if (iDate >= 0) out.splice(iDate + 1, 0, { id: 'hsd', label: 'HSD', w: 76 })
    return out
  }, [isV2Format])
  const invColDefaults = useMemo(() => invCols.map(c => c.w), [invCols])
  // Key riêng theo format → mảng width không lệch số cột khi 2 layout khác nhau
  const { widths: colW,  startResize,                  totalWidth                } = useColumnResize(isV2Format ? 'inventory_col_widths_v2' : 'inventory_col_widths', invColDefaults)
  const { widths: sColW, startResize: sStartResize, totalWidth: sTotalWidth } = useColumnResize('inventory_summary_col_widths', SUMMARY_COL_DEFAULTS)

  const { data: warehouses   = [] } = useWarehouses(true)
  const { data: qaStatuses   = [] } = useQAStatuses()
  const { data: whTypes      = [] } = useScopedWhTypes()
  const { data: allCompaniesF = [] } = useTransportCompanies(true, 'NCC')   // filter NCC — không lấy ĐVVT
  const nccFilterOpts = (allCompaniesF as { id: string; name: string; type?: string }[]).filter(c => c.type === 'NCC').map(c => ({ value: c.id, label: c.name }))
  const categories = whTypes.map(t => t.value)
  const { data: facets } = useInventoryFacets({
    warehouse_ids: f.warehouseIds.length > 0 ? f.warehouseIds : undefined,
    categories:    f.materialCategories.length > 0 ? f.materialCategories : undefined,
  })

  // Filter Tên hàng + Vị trí: TÌM TRÊN SERVER (50 dòng) — trước đây facet nhồi cả 2.740 mã
  // và 1.753 vị trí vào payload (~420KB) mỗi lần mở trang Tồn kho.
  const [matFilterTerm, setMatFilterTerm] = useState('')
  const { data: matFilterRows = [], isFetching: matFilterLoading } = useMaterials(
    { search: matFilterTerm || undefined, category: f.materialCategories.length === 1 ? f.materialCategories[0] : undefined, limit: 50 },
    !!matFilterTerm)
  const [locFilterTerm, setLocFilterTerm] = useState('')
  const { data: locFilterRows = [], isFetching: locFilterLoading } = useLocationsReal(
    { search: locFilterTerm || undefined, warehouse_id: f.warehouseIds.length === 1 ? f.warehouseIds[0] : undefined, limit: 50 },
    !!locFilterTerm)

  // Normalize old JWT abbreviations (TP→Thành phẩm, BAO_BI→Bao bì)
  const normCatFe = (c: string) => c === 'TP' ? 'Thành phẩm' : c === 'BAO_BI' ? 'Bao bì' : c
  const userAllowedCats = (user?.allowed_categories ?? []).map(normCatFe)

  // Auto-set warehouse from auth (prefer warehouse_ids array over single warehouse_id)
  useEffect(() => {
    if (f.warehouseIds.length === 0) {
      const defaultIds = user?.warehouse_ids?.length ? user.warehouse_ids
        : user?.warehouse_id ? [user.warehouse_id]
        : []
      if (defaultIds.length > 0) setInventory({ warehouseIds: defaultIds })
    }
  }, [user?.warehouse_id]) // eslint-disable-line

  // Auto-set default category filter once when DB categories load and nothing is selected
  const categoryDefaultApplied = useRef(false)
  useEffect(() => {
    if (categories.length > 0 && !categoryDefaultApplied.current) {
      categoryDefaultApplied.current = true
      if (f.materialCategories.length === 0) {
        const dbCats = categories as string[]
        // Restrict default to categories the user is allowed to see (if scope is set).
        // NATIONAL/superadmin = TOÀN BỘ (khớp useScopedWhTypes + BE isNational): nếu lọc theo
        // allowed_categories, loại kho tùy biến ngoài 5 loại chuẩn (vd SCA) bị ẩn khỏi Tồn kho dù
        // server không chặn → tổng Tồn kho lệch Dashboard.
        const isNationalScope = user?.warehouse_scope === 'NATIONAL'
        const defaultCats = (!isNationalScope && userAllowedCats.length > 0)
          ? dbCats.filter(c => userAllowedCats.includes(c))
          : dbCats
        setInventory({ materialCategories: [...new Set(defaultCats)], page: 1 })
      }
    }
  }, [categories]) // eslint-disable-line

  const queryParams = {
    warehouse_ids:      f.warehouseIds.length > 0 ? f.warehouseIds : undefined,
    categories:         f.materialCategories.length > 0 ? f.materialCategories : undefined,
    filter_locations:   f.filterLocations.length > 0 ? f.filterLocations : undefined,
    filter_material_ids:f.filterMaterialIds.length > 0 ? f.filterMaterialIds : undefined,
    qa_status_ids:      f.qaStatusIds.length > 0 ? f.qaStatusIds : undefined,
    status:             f.status     || undefined,
    search:             f.search     || undefined,
    manufacturer_id:    f.manufacturerId || undefined,
    filter_cycles:      f.filterCycles.length > 0 ? f.filterCycles : undefined,
    filter_machines:    f.filterMachines.length > 0 ? f.filterMachines : undefined,
    filter_nmsx:        f.filterNmsx.length > 0 ? f.filterNmsx : undefined,
    date_pct_ranges:    f.datePctRanges.length > 0 ? f.datePctRanges : undefined,
    ncc_ids:            f.nccIds.length > 0 ? f.nccIds : undefined,
  }
  const { data, isLoading } = useInventoryEntries({ ...queryParams, page: f.page, limit }, !aggregate)
  const { data: summaryData, isLoading: summaryLoading } = useInventorySummary(queryParams, aggregate)

  const displayEntries    = data?.entries               ?? []
  const summaryGroups     = summaryData?.groups          ?? []
  const pagedGroups       = useMemo(() => summaryGroups.slice((f.page - 1) * limit, f.page * limit), [summaryGroups, f.page, limit])
  const loading           = aggregate ? summaryLoading : isLoading
  const total             = aggregate ? (summaryData?.total ?? 0) : (data?.total ?? 0)
  const totalCartons      = aggregate ? (summaryData?.total_cartons_remaining ?? 0) : (data?.total_cartons_remaining ?? 0)
  const totalPages        = Math.max(1, Math.ceil(total / limit))
  const checkedCount      = checkedIds.size
  const checkedIdArr      = useMemo(() => [...checkedIds], [checkedIds])
  // Mã hàng chung của các pallet đang chọn (để panel Sửa NCC hiện HSD ngoại lệ theo NCC); null nếu nhiều mã
  const ncMaterial        = useMemo(() => {
    const sel = displayEntries.filter(e => checkedIds.has(e.id))
    const mats = new Set(sel.map(e => e.material_id))
    return mats.size === 1 ? sel[0]?.material ?? null : null
  }, [displayEntries, checkedIds])

  // Export Excel theo VIEW đang xem (pallet chi tiết / tổng hợp), tôn trọng filter. Chặn nếu > EXPORT_MAX.
  async function handleExport() {
    setExportError('')
    const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    // BASE UNIT: xuất 2 cột NGUYÊN Thùng + Hộp (round-trip với mẫu upload) + cột "Tồn (base)" = SỐ BASE THÔ
    // (số quyết định tồn kho — chuẩn raw data). ĐVT = ĐƠN VỊ GỐC (Hộp/EA/KG) để cột hộp/base không bị hiểu nhầm là thùng.
    // Mã KG/EA (không entry) → cột thùng để trống, cả lượng nằm ở cột "hộp".
    const qc = (base: number, mat: Parameters<typeof qtySplit>[1]) => {
      const s = qtySplit(Number(base) || 0, mat)
      return { t: hasEntry(mat) ? s.entry : '', h: s.base }
    }
    try {
      if (aggregate) {
        const groups = summaryData?.groups ?? []
        if (groups.length === 0) { setExportError('Không có dữ liệu để xuất'); return }
        if (groups.length > EXPORT_MAX) { setExportError(`Quá nhiều dòng (${groups.length.toLocaleString('vi-VN')}). Hãy lọc hẹp lại rồi xuất.`); return }
        setExporting(true)
        writeXlsx(groups.map(g => {
          const nh = qc(g.cartons_imported, g), xu = qc(g.cartons_exported, g), to = qc(g.cartons_remaining, g)
          return {
            'Kho': g.warehouse_name, 'Loại kho': g.category ?? '', 'Mã hàng': g.material_code ?? '',
            'Tên hàng': g.short_name ?? '', 'NCC': g.ncc_name ?? '', 'Ngày SX': g.production_date ? formatTimestampDate(g.production_date) : '',
            '% Date': g.date_pct ?? '', 'ĐVT': qtyBaseLabel(g),
            'Nhập (thùng)': nh.t, 'Nhập (hộp)': nh.h,
            'Xuất (thùng)': xu.t, 'Xuất (hộp)': xu.h,
            'Tồn (thùng)': to.t, 'Tồn (hộp)': to.h,
            'Tồn (base)': Number(g.cartons_remaining) || 0,
            'Số pallet': g.pallet_count,
          }
        }), `ton_kho_tong_hop_${stamp}`)
      } else {
        if (total === 0) { setExportError('Không có dữ liệu để xuất'); return }
        if (total > EXPORT_MAX) { setExportError(`Quá nhiều dòng (${total.toLocaleString('vi-VN')}). Hãy lọc hẹp lại (kho/loại/mã) rồi xuất.`); return }
        setExporting(true)
        const entries = await fetchInventoryExport(queryParams)
        writeXlsx(entries.map(e => {
          const remaining = e.cartons_remaining ?? e.cartons_imported
          const exported  = Math.max(0, Number(e.cartons_imported) - Number(remaining))
          const reserved  = e.cartons_reserved ?? 0
          const pct       = computePctDate(e, e.material)
          const nh = qc(Number(e.cartons_imported), e.material), xu = qc(exported, e.material), to = qc(Number(remaining), e.material)
          const re = qc(Number(reserved), e.material), kd = qc(Math.max(0, Number(remaining) - Number(reserved)), e.material)
          const dc = qc(Number(e.adjustment_qty ?? 0), e.material)
          return {
            'Kho': e.location?.warehouse?.name ?? '', 'Loại kho': e.material?.category ?? '',
            'Mã hàng': e.material?.material_code ?? '', 'Tên hàng': e.material?.short_name ?? '',
            'NCC': e.ncc?.name ?? '', 'Shelflife (ngày)': e.shelf_life_days ?? '',
            'Mã pallet': e.pallet_code, 'NMSX': e.nmsx ?? '', 'Vị trí': e.location?.location_code ?? '',
            'ĐVT': qtyBaseLabel(e.material),
            'Nhập (thùng)': nh.t, 'Nhập (hộp)': nh.h,
            'Xuất (thùng)': xu.t, 'Xuất (hộp)': xu.h,
            'Tồn (thùng)': to.t, 'Tồn (hộp)': to.h,
            'Tồn (base)': Number(remaining) || 0,
            'Nhặt lẻ (thùng)': re.t, 'Nhặt lẻ (hộp)': re.h,
            'Khả dụng (thùng)': kd.t, 'Khả dụng (hộp)': kd.h,
            'Ngày SX': e.production_date ? formatTimestampDate(e.production_date) : '',
            '% Date': pct ?? '', 'QA': e.qa_status?.code ?? '',
            'Điều chỉnh (thùng)': dc.t, 'Điều chỉnh (hộp)': dc.h,
          }
        }), `ton_kho_chi_tiet_${stamp}`)
      }
    } catch (e) {
      const err = e as AxiosError<{ error?: { message?: string } }>
      setExportError(err?.response?.data?.error?.message ?? 'Xuất Excel lỗi')
    } finally {
      setExporting(false)
    }
  }

  // Mẫu Excel Tồn kho đầu kỳ — BE map theo TÊN cột (đảo cột vẫn đúng). Dòng 1 nhãn, dòng 2 key, dòng 3 ví dụ. `*` = bắt buộc điền.
  function downloadInventoryTemplate() {
    // BASE UNIT: mã có Hộp/thùng → "Số thùng" SỐ NGUYÊN + phần lẻ ghi cột "Hộp" (đơn vị gốc)
    const labels = ['Mã pallet *', 'Mã hàng *', 'Kho (mã) *', 'Mã vị trí *', 'Số thùng * (SỐ NGUYÊN)', 'Ngày SX * (yyyy-mm-dd)', 'NCC (mã/tên, tùy)', 'QA (mặc định OK)', 'HSD (ngày, tùy)', 'Hộp (phần lẻ, tùy)']
    const keys = ['pallet_code', 'material_code', 'warehouse', 'location_code', 'cartons', 'production_date', 'ncc', 'qa_status', 'shelf_life_days', 'boxes_base']
    const ex = ['BV-OPEN-0001', '210000262', '20000016', 'B_TP1_1_T1', 100, '2026-06-01', 'DTV', 'OK', '', 24]
    const ws = XLSX.utils.aoa_to_sheet([labels, keys, ex])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'TonKho')
    saveWorkbook(wb, 'mau_ton_kho.xlsx')
  }

  // Derive pallet context for action modals (from first checked entry on current page)
  const firstCheckedEntry = useMemo(() =>
    displayEntries.find(e => checkedIds.has(e.id)), [displayEntries, checkedIds]
  )
  const actionWarehouseId = firstCheckedEntry?.location?.warehouse?.id
  const actionCategory    = firstCheckedEntry?.material?.category ?? undefined

  // Keep selected entry in sync when list refreshes
  useEffect(() => {
    if (!selected) return
    const refreshed = displayEntries.find(e => e.id === selected.id)
    if (refreshed) setSelected(refreshed)
  }, [displayEntries]) // eslint-disable-line

  // Clear checked IDs that are no longer in the current page
  useEffect(() => {
    if (checkedIds.size === 0) return
    const pageIds = new Set(displayEntries.map(e => e.id))
    const stale = [...checkedIds].filter(id => !pageIds.has(id))
    if (stale.length > 0) {
      setCheckedIds(prev => { const next = new Set(prev); stale.forEach(id => next.delete(id)); return next })
    }
  }, [displayEntries]) // eslint-disable-line

  function resetFilters() {
    setInventory({
      search: '', filterLocations: [], filterMaterialIds: [], qaStatusIds: [], status: '',
      materialCategories: [], manufacturerId: '', filterCycles: [], filterMachines: [], filterNmsx: [], nccIds: [], datePctRanges: [], page: 1,
    })
  }

  function toggleCheck(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setCheckedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  function toggleAll() {
    if (checkedIds.size === displayEntries.length && displayEntries.length > 0) setCheckedIds(new Set())
    else setCheckedIds(new Set(displayEntries.map(e => e.id)))
  }

  const hasFilters = !!(f.search || f.filterLocations.length > 0 || f.filterMaterialIds.length > 0
    || f.qaStatusIds.length > 0 || f.status || f.materialCategories.length > 0
    || f.manufacturerId || f.filterCycles.length > 0 || f.filterMachines.length > 0 || f.filterNmsx.length > 0 || f.nccIds.length > 0 || f.datePctRanges.length > 0)

  // Filter option lists
  const allowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids)
    : null
  const warehouseOpts = (warehouses as any[])
    .filter((w: any) => !allowedWhIds || allowedWhIds.has(w.id))
    .map((w: any) => ({ value: w.id, label: w.name }))
  const warehouseMap: Record<string, string> = Object.fromEntries(
    (warehouses as any[]).map((w: any) => [w.id, w.name])
  )
  // Merge DB categories with user's allowed categories so user can always toggle their scope even if no data yet
  const categoryOpts   = (categories as string[]).map(c => ({ value: c, label: c }))
  const qaOpts         = (qaStatuses as any[]).map((q: any) => ({ value: q.id, label: `${q.code} – ${q.name}` }))
  const locationOpts   = (locFilterRows as { location_code: string }[]).map(l => ({ value: l.location_code, label: l.location_code }))
  const materialOpts   = matFilterRows.map(m => ({ value: m.id, label: m.short_name ? `${m.material_code} – ${m.short_name}` : m.material_code }))
  const cycleOpts      = (facets?.cycles ?? []).map(c => ({ value: c, label: c }))
  const machineOpts    = (facets?.machines ?? []).map(m => ({ value: m, label: m }))
  // NMSX = nmsx_code các kho tổng (B/D…) + O (gia công ngoài). Dedup theo value.
  const nmsxOpts: { value: string; label: string }[] = (() => {
    const out: { value: string; label: string }[] = []
    const seen = new Set<string>()
    for (const w of (warehouses as any[])) {
      const code = String(w.nmsx_code ?? '').trim()
      if (code && !seen.has(code)) { seen.add(code); out.push({ value: code, label: `${code} — ${w.name}` }) }
    }
    if (!seen.has('O')) out.push({ value: 'O', label: 'O — Gia công ngoài' })
    return out
  })()
  const datePctOpts    = DATE_PCT_OPTIONS

  function closeActionModal() {
    setActionModal(null)
    setCheckedIds(new Set())
  }

  // ─── Filter chip bar (Manhattan) ───
  const filterDefs: FilterDef[] = [
    { key: 'warehouse', label: 'Kho', type: 'multi', options: warehouseOpts, selected: f.warehouseIds, searchable: true,
      onChange: v => setInventory({ warehouseIds: v, page: 1 }) },
    { key: 'category', label: 'Loại kho', type: 'multi', options: categoryOpts, selected: f.materialCategories, searchable: false,
      onChange: v => setInventory({ materialCategories: v, page: 1 }) },
    { key: 'status', label: 'Tình trạng', type: 'single', options: [{ value: 'ALL', label: 'Tất cả' }], value: f.status === 'ALL' ? 'ALL' : '', allLabel: 'Còn tồn',
      onChange: v => setInventory({ status: v === 'ALL' ? 'ALL' : '', page: 1 }) },
    { key: 'material', label: 'Tên hàng', type: 'multi', options: materialOpts, selected: f.filterMaterialIds,
      serverSearch: true, onSearchChange: setMatFilterTerm, loading: matFilterLoading,
      onChange: v => setInventory({ filterMaterialIds: v, page: 1 }) },
    { key: 'location', label: 'Vị trí', type: 'multi', options: locationOpts, selected: f.filterLocations,
      serverSearch: true, onSearchChange: setLocFilterTerm, loading: locFilterLoading,
      onChange: v => setInventory({ filterLocations: v, page: 1 }) },
    { key: 'qa', label: 'QA Status', type: 'multi', options: qaOpts, selected: f.qaStatusIds,
      onChange: v => setInventory({ qaStatusIds: v, page: 1 }) },
    { key: 'cycle', label: 'Chu kỳ', type: 'multi', options: cycleOpts, selected: f.filterCycles, searchable: cycleOpts.length > 5,
      onChange: v => setInventory({ filterCycles: v, page: 1 }) },
    { key: 'machine', label: 'Máy', type: 'multi', options: machineOpts, selected: f.filterMachines, searchable: machineOpts.length > 5,
      onChange: v => setInventory({ filterMachines: v, page: 1 }) },
    { key: 'nmsx', label: 'NMSX', type: 'multi', options: nmsxOpts, selected: f.filterNmsx, searchable: false,
      onChange: v => setInventory({ filterNmsx: v, page: 1 }) },
    { key: 'datePct', label: '% Date', type: 'multi', options: datePctOpts, selected: f.datePctRanges, searchable: false,
      onChange: v => setInventory({ datePctRanges: v, page: 1 }) },
    { key: 'ncc', label: 'NCC', type: 'multi', options: nccFilterOpts, selected: f.nccIds, searchable: nccFilterOpts.length > 5,
      onChange: v => setInventory({ nccIds: v, page: 1 }) },
  ]

  const viewSnapshot = {
    search: f.search, warehouseIds: f.warehouseIds, materialCategories: f.materialCategories,
    status: f.status, filterMaterialIds: f.filterMaterialIds, filterLocations: f.filterLocations,
    qaStatusIds: f.qaStatusIds, filterCycles: f.filterCycles, filterMachines: f.filterMachines,
    filterNmsx: f.filterNmsx,
    datePctRanges: f.datePctRanges,
    nccIds: f.nccIds,
  }
  const savedViews = useSavedViewsStore(s => s.views['inventory'] ?? [])
  const activeViewId = useMemo(() => {
    const cur = JSON.stringify(viewSnapshot)
    return savedViews.find(v => JSON.stringify(v.filters) === cur)?.id ?? null
  }, [savedViews, viewSnapshot])

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* ── Toolbar ── */}
      <div className="border-b bg-white px-3 py-1.5 shrink-0 space-y-1 sm:py-2 sm:space-y-1.5 sm:rounded-t-xl">
        {/* Row 1: Title + Search + Views + Density */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 shrink-0 flex items-center gap-1.5">
            <Package className="h-4 w-4 text-slate-500" /> Tồn kho
          </span>
          <SearchInput
            value={f.search}
            onChange={v => setInventory({ search: v, page: 1 })}
            placeholder="Tìm pallet, mã/tên hàng, vị trí…"
            className="flex-1 min-w-[140px]"
          />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          {/* Mobile: SavedViews + action GOM 1 hàng (PDA); desktop sm:contents → như cũ */}
          <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
          <SavedViews
            module="inventory"
            currentFilters={viewSnapshot}
            activeId={activeViewId}
            onApply={(filters) => setInventory({ ...(filters as Partial<typeof f>), page: 1 })}
          />
          <button type="button" onClick={toggleDensity}
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
            title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
            {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
          <button type="button" onClick={toggleAggregate}
            className={`inline-flex h-7 items-center gap-1 px-2 rounded-md border text-[11px] font-medium transition-colors shrink-0 ${aggregate ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
            title={aggregate ? 'Đang xem TỔNG HỢP theo mã — bấm để về chi tiết pallet' : 'Xem tổng hợp tồn kho theo mã hàng (không tới pallet)'}>
            <Sigma className="h-3.5 w-3.5" />Tổng hợp
          </button>
          <ActionCluster className="shrink-0" mobileInline items={[
            ...(can(user?.module_permissions, 'inventory', 'export') ? [{
              key: 'excel', icon: Download, label: 'Excel',
              tip: `Xuất Excel ${aggregate ? 'bảng tổng hợp' : 'chi tiết pallet'} theo bộ lọc hiện tại`,
              mobileHidden: true, // export Excel không dùng trên điện thoại (giữ hành vi cũ hidden sm:inline-flex)
              busy: exporting,
              onClick: handleExport,
            } satisfies ActionItem] : []),
            ...(can(user?.module_permissions, 'inventory', 'import') ? [{
              key: 'upload', icon: Upload, label: 'Upload', tip: 'Upload tồn kho đầu kỳ từ Excel',
              mobileHidden: true, // upload Excel không dùng trên điện thoại (giữ hành vi cũ hidden sm:inline-flex)
              onClick: () => setShowUpload(true),
            } satisfies ActionItem] : []),
          ]} />
          </div>
        </div>
        {exportError && (
          <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{exportError}</div>
        )}

        {/* Row 2: Filter chip bar (desktop) */}
        <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
          <FilterBar defs={filterDefs} />
        </div>
      </div>

      {/* Summary band (Manhattan) */}
      <SummaryBand tiles={aggregate ? [
        { label: 'Nhóm (mã×kho×ngày)', value: total.toLocaleString('vi-VN') },
        { label: 'Thùng tồn', value: totalCartons.toLocaleString('vi-VN') },
        { label: 'Trang', value: `${f.page}/${totalPages}` },
      ] : [
        // Chỉ đếm pallet CÒN TỒN (>0) — list vẫn hiện cả pallet 0 (fallback total khi BE cũ chưa deploy)
        { label: 'Pallet', value: (data?.total_pallets_in_stock ?? total).toLocaleString('vi-VN') },
        { label: 'Thùng tồn', value: totalCartons.toLocaleString('vi-VN') },
        { label: 'Đang chọn', value: checkedCount, accent: checkedCount > 0 },
        { label: 'Trang', value: `${f.page}/${totalPages}` },
      ]} />

      {/* ── Content: table + detail drawer ── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Table */}
        <div className="flex-1 overflow-auto pb-20 lg:pb-4">
          {loading ? (
            <div className="p-4 space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-9 rounded bg-slate-100 animate-pulse" />)}
            </div>
          ) : (aggregate ? pagedGroups.length === 0 : displayEntries.length === 0) ? (
            <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
              <Package className="h-10 w-10 opacity-30" />
              <p className="text-sm">Không tìm thấy {aggregate ? 'mã hàng' : 'pallet'} nào</p>
              {hasFilters && (
                <button onClick={resetFilters} className="text-xs text-blue-500 underline">Xóa bộ lọc</button>
              )}
            </div>
          ) : (
            <>
              {aggregate ? (
              <Table className="table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100" style={{ width: sTotalWidth, minWidth: '100%' }}>
                  <colgroup>{sColW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      {SUMMARY_COLS.map((c, i) => (
                        <TableHead key={c.id}
                          className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap sticky top-0 bg-slate-50 ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'left-0 z-30' : 'z-20'}`}>
                          {c.label}
                          {i > 0 && (
                            <span onPointerDown={e => sStartResize(i, e)} onClick={e => e.stopPropagation()}
                              className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" title="Kéo để chỉnh độ rộng cột" />
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedGroups.map(g => (
                      <SummaryRow
                        key={`${g.warehouse_id}|${g.material_id}|${g.production_date}`}
                        g={g}
                        dense={dense}
                        onClick={() => {
                          // Drill-down "xem pallet của mã đó": chỉ lọc theo mã hàng, giữ nguyên filter kho hiện có.
                          setInventory({ filterMaterialIds: [g.material_id], page: 1 })
                          localStorage.setItem('inventory_view_mode', 'pallet')
                          setAggregate(false)
                        }}
                      />
                    ))}
                  </TableBody>
              </Table>
              ) : (
              <Table className="table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100" style={{ width: totalWidth, minWidth: '100%' }}>
                  <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      {invCols.map((c, i) => (
                        <TableHead key={c.id}
                          className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap sticky top-0 bg-slate-50 ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'left-0 z-30' : 'z-20'}`}>
                          {c.id === 'check'
                            ? <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer" checked={checkedIds.size === displayEntries.length && displayEntries.length > 0} onChange={toggleAll} />
                            : c.label}
                          {i > 0 && c.id !== 'chevron' && (
                            <span onPointerDown={e => startResize(i, e)} onClick={e => e.stopPropagation()}
                              className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" title="Kéo để chỉnh độ rộng cột" />
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayEntries.map(e => (
                      <EntryRow
                        key={e.id}
                        entry={e}
                        isSelected={selected?.id === e.id}
                        isChecked={checkedIds.has(e.id)}
                        onCheck={ev => toggleCheck(e.id, ev)}
                        onClick={() => setSelected(prev => prev?.id === e.id ? null : e)}
                        warehouseMap={warehouseMap}
                        dense={dense}
                        isV2={isV2Format}
                      />
                    ))}
                  </TableBody>
              </Table>
              )}

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 py-3 border-t bg-white">
                  <button
                    disabled={f.page <= 1}
                    onClick={() => setInventory({ page: f.page - 1 })}
                    className="px-3 py-1 text-xs rounded border disabled:opacity-40 hover:bg-slate-50">
                    ← Trước
                  </button>
                  <span className="text-xs text-slate-500">{f.page} / {totalPages}</span>
                  <button
                    disabled={f.page >= totalPages}
                    onClick={() => setInventory({ page: f.page + 1 })}
                    className="px-3 py-1 text-xs rounded border disabled:opacity-40 hover:bg-slate-50">
                    Sau →
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Detail / Action side panel */}
        {actionModal === 'qa' ? (
          <QAPanel ids={checkedIdArr} qaStatuses={qaStatuses as { id: string; code: string; name: string }[]} onClose={closeActionModal} />
        ) : actionModal === 'ncc' ? (
          <NccPanel ids={checkedIdArr} material={ncMaterial} onClose={closeActionModal} />
        ) : actionModal === 'location' ? (
          <LocationPanel ids={checkedIdArr} warehouseId={actionWarehouseId} category={actionCategory} onClose={closeActionModal} />
        ) : actionModal === 'material' ? (
          <MaterialPanel ids={checkedIdArr} category={actionCategory} onClose={closeActionModal} />
        ) : actionModal === 'production-date' ? (
          <ProductionDatePanel ids={checkedIdArr} onClose={closeActionModal} />
        ) : selected ? (
          <DetailPanel entry={selected} onClose={() => setSelected(null)} warehouseMap={warehouseMap}
            onQuickAction={m => { setCheckedIds(new Set([selected.id])); setActionModal(m) }}
            onSplit={() => navigate(`/wms/pallet-ops?tab=split&source=${encodeURIComponent(selected.pallet_code)}`)} />
        ) : null}
      </div>

      {/* Footer đếm bản ghi */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 sm:rounded-b-xl">
        {total > 0
          ? `${(f.page - 1) * limit + 1}–${Math.min(f.page * limit, total)} / ${total.toLocaleString('vi-VN')} ${aggregate ? 'nhóm' : 'pallet'}`
          : (aggregate ? '0 nhóm' : '0 pallet')}
        {selected && checkedCount === 0 && <span className="ml-2 text-blue-600">· 1 đang xem</span>}
        <label className="ml-3 inline-flex items-center gap-1 text-slate-400">
          <span className="hidden sm:inline">·</span> Dòng/trang:
          <select
            value={limit}
            onChange={e => setInventory({ pageSize: Number(e.target.value), page: 1 })}
            className="h-5 rounded border border-slate-200 bg-white px-1 text-[11px] text-slate-600 tabular-nums cursor-pointer">
            {[50, 100, 500, 1000].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
     </div>

      {/* ── Floating action bar (when items checked) ── */}
      {checkedCount > 0 && (
        <div className="fixed bottom-16 lg:bottom-6 left-1/2 -translate-x-1/2 z-50
          bg-slate-800 text-white rounded-full shadow-2xl px-4 py-2
          flex items-center gap-3 text-sm whitespace-nowrap">
          <span className="text-slate-300 text-xs font-medium">{checkedCount} pallet</span>
          <div className="w-px h-4 bg-slate-600" />
          {/* Cụm action bulk — ActionCluster chuẩn; className w-auto để pill nổi ôm sát nội dung
              (không lấy w-full mặc định của cluster mobile). Màu tối truyền qua className từng nút. */}
          <ActionCluster className="w-auto shrink-0" items={[
            ...(can(user?.module_permissions, 'inventory', 'qa_update') ? [{
              key: 'qa', icon: BadgeCheck, label: 'QA Status', tip: 'Đổi QA status các pallet đã chọn',
              className: 'border-slate-600 bg-slate-700 text-slate-100 hover:bg-slate-600 hover:text-white',
              onClick: () => setActionModal('qa'),
            } satisfies ActionItem] : []),
            ...(can(user?.module_permissions, 'inventory', 'update_ncc') ? [{
              key: 'ncc', icon: Factory, label: 'NCC', tip: 'Gán NCC cho các pallet đã chọn (áp HSD ngoại lệ theo NCC)',
              className: 'border-slate-600 bg-slate-700 text-slate-100 hover:bg-slate-600 hover:text-white',
              onClick: () => setActionModal('ncc'),
            } satisfies ActionItem] : []),
            ...(can(user?.module_permissions, 'inventory', 'move_location') ? [{
              key: 'location', icon: MapPin, label: 'Vị trí', tip: 'Chuyển vị trí các pallet đã chọn',
              className: 'border-slate-600 bg-slate-700 text-slate-100 hover:bg-slate-600 hover:text-white',
              onClick: () => setActionModal('location'),
            } satisfies ActionItem] : []),
            ...(can(user?.module_permissions, 'inventory', 'recode') ? [{
              key: 'material', icon: Tag, label: 'Mã hàng', tip: 'Đổi mã hàng các pallet đã chọn',
              className: 'border-slate-600 bg-slate-700 text-slate-100 hover:bg-slate-600 hover:text-white',
              onClick: () => setActionModal('material'),
            } satisfies ActionItem] : []),
            ...(can(user?.module_permissions, 'inventory', 'update_prod_date') ? [{
              key: 'production-date', icon: CalendarDays, label: 'Ngày SX', tip: 'Sửa ngày sản xuất các pallet đã chọn',
              className: 'border-slate-600 bg-slate-700 text-slate-100 hover:bg-slate-600 hover:text-white',
              onClick: () => setActionModal('production-date'),
            } satisfies ActionItem] : []),
            // Dồn / Tách pallet — điều hướng sang trang thao tác, prefill mã (gate quyền pallet_ops giữ nguyên)
            ...(can(user?.module_permissions, 'pallet_ops', 'split') && checkedCount === 1 ? [{
              key: 'split', icon: Scissors, label: 'Tách', tip: 'Tách pallet đang chọn (chia số lượng, sang trang Dồn/Tách)',
              primary: true,
              className: 'border-sky-600 bg-sky-700 text-white hover:bg-sky-600 hover:text-white',
              onClick: () => { const c = displayEntries.find(e => checkedIds.has(e.id))?.pallet_code; if (c) navigate(`/wms/pallet-ops?tab=split&source=${encodeURIComponent(c)}`) },
            } satisfies ActionItem] : []),
            ...(can(user?.module_permissions, 'pallet_ops', 'merge') && checkedCount >= 2 ? [{
              key: 'merge', icon: Layers, label: 'Dồn', tip: 'Dồn các pallet đã chọn về 1 pallet (sang trang Dồn/Tách)',
              primary: true,
              className: 'border-sky-600 bg-sky-700 text-white hover:bg-sky-600 hover:text-white',
              onClick: () => {
                const codes = displayEntries.filter(e => checkedIds.has(e.id)).map(e => e.pallet_code)
                if (codes.length >= 2) navigate(`/wms/pallet-ops?tab=merge&target=${encodeURIComponent(codes[0])}&children=${encodeURIComponent(codes.slice(1).join(','))}`)
              },
            } satisfies ActionItem] : []),
          ]} />
          <div className="w-px h-4 bg-slate-600" />
          <button
            className="text-slate-400 hover:text-white transition-colors"
            onClick={() => setCheckedIds(new Set())}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {showUpload && (
        <UploadExcelDialog
          title="Upload Tồn kho từ Excel"
          hint="Kiểm toàn bộ file trước — có bất kỳ lỗi nào thì KHÔNG ghi gì. Mỗi dòng = 1 pallet; pallet ĐÃ CÓ trong đúng kho đó sẽ được CẬP NHẬT theo file (số thùng, vị trí, ngày SX, NCC, QA — có log điều chỉnh). NCC tham chiếu theo mã (ưu tiên) hoặc tên."
          onClose={() => setShowUpload(false)}
          onDownloadTemplate={downloadInventoryTemplate}
          onUpload={file => uploadInventory.mutateAsync({ file })}
        />
      )}

    </div>
  )
}

// ─── EntryRow ─────────────────────────────────────────────────

function EntryRow({ entry: e, isSelected, isChecked, onCheck, onClick, warehouseMap, dense = true, isV2 = false }: {
  entry: InventoryEntry
  isSelected: boolean
  isChecked: boolean
  onCheck: (ev: React.MouseEvent) => void
  onClick: () => void
  warehouseMap: Record<string, string>
  dense?: boolean
  isV2?: boolean
}) {
  const loc           = formatLoc(e.location)
  const matCode       = e.material?.material_code ?? '—'
  const matName       = e.material?.short_name ?? '—'
  const qa            = e.qa_status?.code ?? '—'
  const remaining     = e.cartons_remaining ?? e.cartons_imported
  const exported      = Math.max(0, Number(e.cartons_imported) - Number(remaining))
  const pct           = computePctDate(e, e.material)
  const prodDateStr   = e.production_date ? formatTimestampDate(e.production_date, true) : '—'
  const adjQty        = e.adjustment_qty ?? 0
  const warehouseNm   = e.location?.warehouse?.name ?? (e.warehouse_id ? warehouseMap[e.warehouse_id] : null) ?? '—'
  const loaiKho       = e.material?.category ?? '—'

  return (
    <TableRow
      className={`transition-colors cursor-pointer ${entryRowBg(isSelected, isChecked)} ${entryRowText(e, isSelected)} ${dense ? '' : '[&_td]:py-2.5'}`}
      onClick={onClick}
    >
      {/* Checkbox — cột sticky-left cần NỀN ĐẶC (bg-inherit + dòng trong suốt → lộ nội dung khi cuộn ngang) */}
      <TableCell className={`px-2 py-1 sticky left-0 z-10 ${isSelected ? 'bg-blue-600' : isChecked ? 'bg-green-50' : 'bg-white'}`} onClick={onCheck}>
        <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer"
          checked={isChecked} onChange={() => {}} />
      </TableCell>
      {/* Kho */}
      <TableCell className="px-2 py-1 whitespace-nowrap max-w-[90px]">
        <span className="text-[10px] text-slate-600 truncate block" title={warehouseNm}>{warehouseNm}</span>
      </TableCell>
      {/* Loại kho */}
      <TableCell className="px-2 py-1 whitespace-nowrap max-w-[80px]">
        <span className="text-[10px] text-slate-500 truncate block" title={loaiKho}>{loaiKho}</span>
      </TableCell>
      {/* Mã hàng */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono font-semibold text-slate-700">{matCode}</span>
      </TableCell>
      {/* Tên hàng */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] text-slate-700 truncate block" title={matName}>{matName}</span>
      </TableCell>
      {/* NCC (+ shelflife lô nếu có) */}
      <TableCell className="px-2 py-1 whitespace-nowrap max-w-[110px]">
        {e.ncc?.name
          ? <span className="text-[10px] text-slate-600 truncate block" title={e.shelf_life_days ? `${e.ncc.name} · ${e.shelf_life_days} ngày` : e.ncc.name}>{e.ncc.name}{e.shelf_life_days ? <span className="text-slate-400"> · {e.shelf_life_days}n</span> : null}</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>
      {/* Mã pallet */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <div className="flex items-center min-w-0">
          {/* whitespace-pre (thay nowrap của truncate): tem V2 có đệm SPACE trong mã — HTML gộp space làm user tưởng lưu sai */}
          <span className="text-[10px] font-mono font-semibold overflow-hidden text-ellipsis whitespace-pre" title={e.pallet_code}>{e.pallet_code}</span>
          {e.parent_pallet_code && (
            <span className="ml-1 shrink-0 inline-flex items-center gap-0.5 rounded-full bg-sky-100 px-1 py-0.5 text-[8px] text-sky-700" title={`Đã dồn vào ${e.parent_pallet_code}`}>
              <Layers className="h-2 w-2" />dồn
            </span>
          )}
          {e.origin === 'SPLIT' && (
            <span className="ml-1 shrink-0 inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1 py-0.5 text-[8px] text-violet-700" title="Pallet tách ra">
              <Scissors className="h-2 w-2" />tách
            </span>
          )}
        </div>
      </TableCell>
      {/* Mã lô (tem V2 `;`) — chỉ ĐV semicolon; khớp kế toán */}
      {isV2 && (
        <TableCell className="px-2 py-1 whitespace-nowrap">
          <span className="text-[10px] font-mono font-semibold truncate block" title={e.batch ?? ''}>{e.batch ?? <span className="text-slate-300 font-sans font-normal">—</span>}</span>
        </TableCell>
      )}
      {/* NMSX (đoạn 6 QR pallet) */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono font-semibold">{e.nmsx ?? <span className="text-slate-300 font-sans font-normal">—</span>}</span>
      </TableCell>
      {/* Vị trí */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono text-slate-700 truncate block" title={loc}>{loc}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {/* BASE UNIT: Nhập/Xuất/Giữ/Khả dụng đồng bộ Thùng + Hộp lẻ như cột Tồn */}
        <span className="text-[10px] tabular-nums text-slate-500">{qtyLabel(Number(e.cartons_imported), e.material)}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-500">{exported > 0 ? qtyLabel(exported, e.material) : '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {/* BASE UNIT: Tồn thể hiện Thùng + Hộp lẻ (base là lõi) */}
        <span className="text-[10px] font-semibold tabular-nums">{qtyLabel(Number(remaining), e.material)}</span>
      </TableCell>
      {/* Giữ chỗ / Khả dụng: bỏ màu riêng (purple/blue) → kế thừa màu dòng (entryRowText) cho đồng nhất */}
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {(e.cartons_reserved ?? 0) > 0
          ? <span className="text-[10px] font-semibold tabular-nums">{qtyLabel(Number(e.cartons_reserved), e.material)}</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">
          {qtyLabel(Math.max(0, Number(remaining) - Number(e.cartons_reserved ?? 0)), e.material)}
        </span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-600">{prodDateStr}</span>
      </TableCell>
      {/* HSD (tem V2 `;`) — HSD tường minh dạng ngày; chỉ ĐV semicolon */}
      {isV2 && (
        <TableCell className="px-2 py-1 whitespace-nowrap">
          <span className="text-[10px] tabular-nums text-slate-600">{e.expiry_date ? formatTimestampDate(e.expiry_date, true) : <span className="text-slate-300">—</span>}</span>
        </TableCell>
      )}
      {/* %Date: dòng đã đổi màu theo %date (entryRowText) → cột không tô riêng (tránh 2 thang màu chọi nhau) */}
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {pct !== null ? (
          <span className="text-[10px] tabular-nums">{pct}%</span>
        ) : (
          <span className="text-[10px] text-slate-300">—</span>
        )}
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${STATUS_CLS[e.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {qa}
        </span>
      </TableCell>
      {/* Điều chỉnh: giữ dấu +/- (đủ phân biệt tăng/giảm), bỏ màu green/red → kế thừa màu dòng */}
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {adjQty !== 0 ? (
          <span className="text-[10px] tabular-nums font-semibold">
            {adjQty > 0 ? '+' : ''}{adjQty}
          </span>
        ) : (
          <span className="text-[10px] text-slate-300">—</span>
        )}
      </TableCell>
      <TableCell className="px-1 py-1">
        <ChevronRight className={`h-3 w-3 text-slate-300 transition-transform ${isSelected ? 'rotate-90 text-white' : ''}`} />
      </TableCell>
    </TableRow>
  )
}

// ─── SummaryRow (view tổng hợp theo mã) ──────────────────────

// Màu CHỮ chung cả dòng tổng hợp theo %date: < 60% tím · 60–80% cam · còn lại slate.
function summaryRowText(pct: number | null): string {
  if (pct !== null && pct < 60) return '[&_td_span]:text-purple-600'
  if (pct !== null && pct < 80) return '[&_td_span]:text-orange-600'
  return '[&_td_span]:text-slate-700'
}

function SummaryRow({ g, dense, onClick }: { g: InventorySummaryGroup; dense: boolean; onClick: () => void }) {
  const dateStr = g.production_date ? formatTimestampDate(g.production_date, true) : '—'
  return (
    <TableRow className={`transition-colors cursor-pointer hover:bg-slate-50 ${summaryRowText(g.date_pct)} ${dense ? '' : '[&_td]:py-2.5'}`} onClick={onClick}>
      {/* Cột Kho sticky-left cần nền ĐẶC (dòng tổng hợp trong suốt → lộ khi cuộn ngang) */}
      <TableCell className="px-2 py-1 whitespace-nowrap sticky left-0 z-10 bg-white">
        <span className="text-[10px] text-slate-600 truncate block" title={g.warehouse_name}>{g.warehouse_name}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] text-slate-500 truncate block" title={g.category ?? ''}>{g.category ?? '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono font-semibold text-slate-700">{g.material_code ?? '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] text-slate-700 truncate block" title={g.short_name ?? ''}>{g.short_name ?? '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap max-w-[110px]">
        {g.ncc_name
          ? <span className="text-[10px] text-slate-600 truncate block" title={g.ncc_name}>{g.ncc_name}</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-600">{dateStr}</span>
      </TableCell>
      {/* %Date: dòng đã đổi màu theo %date (summaryRowText) → cột không tô riêng */}
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {g.date_pct !== null
          ? <span className="text-[10px] tabular-nums">{g.date_pct}%</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-500">{qtyLabel(g.cartons_imported, g)}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-500">{g.cartons_exported > 0 ? qtyLabel(g.cartons_exported, g) : '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {/* BASE UNIT: Tồn tổng hợp thể hiện Thùng + Hộp lẻ */}
        <span className="text-[10px] font-semibold tabular-nums">{qtyLabel(g.cartons_remaining, g)}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{g.pallet_count}</span>
      </TableCell>
    </TableRow>
  )
}

// ─── Detail panel ─────────────────────────────────────────────

type QuickAction = 'qa' | 'ncc' | 'location' | 'material' | 'production-date'
function DetailPanel({ entry: e, onClose, warehouseMap, onQuickAction, onSplit }: {
  entry: InventoryEntry; onClose: () => void; warehouseMap: Record<string, string>
  onQuickAction: (m: QuickAction) => void; onSplit: () => void
}) {
  const user = useAuthStore(s => s.user)
  const [adjInput, setAdjInput]       = useState('')
  const [adjUnit, setAdjUnit]         = useState<'entry' | 'base'>('base')   // BASE UNIT: ĐVT của số vừa gõ (mã có entry)
  const [adjNote, setAdjNote]         = useState('')
  const [showAdj, setShowAdj]         = useState(false)
  const [showLog, setShowLog]         = useState(false)
  const [adjError, setAdjError]       = useState('')
  const { mutate: adjust, isPending } = useAdjustInventory()
  const { data: adjLog }              = useAdjustmentLog(e.id)

  const loc       = formatLoc(e.location)
  const remaining = e.cartons_remaining ?? e.cartons_imported
  const exported  = Math.max(0, Number(e.cartons_imported) - Number(remaining))
  const pct       = computePctDate(e, e.material)

  // BASE UNIT: delta gửi đi = SỐ BASE (nhập theo thùng → × hệ_số); mã có entry bắt SỐ NGUYÊN
  const adjFactor = hasEntry(e.material) && adjUnit === 'entry' ? Number(e.material!.units_per_carton) : 1
  const adjDeltaBase = (hasEntry(e.material) ? (parseInt(adjInput) || 0) : parseFloat(adjInput)) * adjFactor
  function handleAdjust() {
    const val = adjDeltaBase
    if (isNaN(val) || val === 0) { setAdjError('Nhập số khác 0'); return }
    if (hasEntry(e.material) && !Number.isInteger(val)) { setAdjError('Mã có Hộp/thùng — nhập số NGUYÊN'); return }
    setAdjError('')
    adjust(
      { id: e.id, adjustment: val, employee_id: user?.id, note: adjNote.trim() || undefined, actor_name: user?.name ?? undefined },
      {
        onSuccess: () => { setAdjInput(''); setAdjNote(''); setShowAdj(false) },
        onError: (err: any) => {
          setAdjError(err?.response?.data?.error?.message ?? 'Lỗi không xác định')
        },
      }
    )
  }

  const warehouseNm = e.location?.warehouse?.name ?? (e.warehouse_id ? warehouseMap[e.warehouse_id] : null) ?? '—'
  const loaiKho     = e.material?.category ?? '—'

  return (
    <div className="fixed inset-0 z-50 w-full border-l bg-white overflow-y-auto flex flex-col lg:static lg:inset-auto lg:z-auto lg:w-72 lg:shrink-0">
      {/* Header */}
      <div className="flex items-start justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
        {/* Mã pallet V2 dài (có đệm space) → hiện ĐẦY ĐỦ + GIỮ nguyên space (pre-wrap), tự xuống dòng thay vì cắt */}
        <p className="text-xs font-semibold text-slate-700 font-mono whitespace-pre-wrap [overflow-wrap:anywhere] min-w-0">{e.pallet_code}</p>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 ml-2 shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-3 space-y-3 text-xs flex-1">
        {/* Status badge */}
        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_CLS[e.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {STATUS_LABEL[e.status] ?? e.status}
        </span>

        {/* Core info */}
        <Section title="Thông tin hàng">
          <Row label="Kho"      value={warehouseNm} />
          <Row label="Loại kho" value={loaiKho} />
          <Row label="Mã hàng"  value={e.material?.material_code ?? '—'} mono />
          <Row label="Tên hàng" value={e.material?.short_name ?? '—'} wrap />
          <Row label="Vị trí"   value={loc} mono />
          <Row label="QA"       value={e.qa_status ? `${e.qa_status.code} – ${e.qa_status.name}` : '—'} />
        </Section>

        {/* Quantities */}
        <Section title="Số lượng">
          <Row label="Nhập"       value={qtyLabel(Number(e.cartons_imported), e.material)} />
          <Row label="Xuất"       value={exported > 0 ? qtyLabel(exported, e.material) : '—'} />
          <Row label="Tồn"        value={qtyLabel(Number(remaining), e.material)} bold />
          {e.status === 'LOOSE_PICKING' && (e.cartons_reserved ?? 0) > 0 && (<>
            <Row label="Nhặt lẻ (giữ)"
              value={qtyLabel(Number(e.cartons_reserved), e.material)}
              cls="text-purple-700 font-semibold" />
            <Row label="Khả dụng"
              value={qtyLabel(Math.max(0, Number(remaining) - Number(e.cartons_reserved ?? 0)), e.material)}
              bold cls="text-blue-700" />
          </>)}
          <Row label="Điều chỉnh" value={e.adjustment_qty ? `${Number(e.adjustment_qty) > 0 ? '+' : ''}${qtyLabel(Number(e.adjustment_qty), e.material)}` : '—'}
            cls={e.adjustment_qty ? (Number(e.adjustment_qty) > 0 ? 'text-green-600' : 'text-red-600') : ''} />
        </Section>

        {/* Date info */}
        <Section title="Ngày / Hạn dùng">
          <Row label="Ngày SX"
            value={e.production_date ? formatTimestampDate(e.production_date, false) : '—'} />
          {/* Mã lô (tem V2 `;`) — chỉ hiện khi có; khớp kế toán */}
          {e.batch && <Row label="Mã lô" value={e.batch} mono />}
          {/* HSD: tem V2 mang HSD tường minh (expiry_date, hiện dạng NGÀY); tem V1 suy từ shelf-life (số ngày) */}
          {e.expiry_date
            ? <Row label="HSD" value={formatTimestampDate(e.expiry_date, false)} bold />
            : <Row label="HSD (ngày)"
                value={resolveShelfLife(e.shelf_life_days, e.material, e.ncc_id) > 0 ? `${resolveShelfLife(e.shelf_life_days, e.material, e.ncc_id)} ngày` : '—'} />}
          {e.ncc && (
            <Row label="NCC" value={e.ncc.name} />
          )}
          {pct !== null && (
            <Row label="% Date còn" value={`${pct}%`} cls={datePctCls(pct)} bold />
          )}
        </Section>

        {/* Production */}
        <Section title="Sản xuất">
          <Row label="NMSX"    value={e.manufacturer?.code ?? '—'} mono />
          <Row label="Chu kỳ" value={e.cycle ?? '—'} mono />
          <Row label="Máy"    value={e.machine_code ?? '—'} mono />
          <Row label="NMSX"   value={e.nmsx ?? '—'} mono />
        </Section>

        {/* Import */}
        <Section title="Nhập kho">
          <Row label="Ngày nhập"  value={e.import_date ? formatTimestampDate(e.import_date) : '—'} />
          <Row label="Giờ nhập"   value={e.created_at ? formatTimestampTime(e.created_at) : '—'} />
          <Row label="Người nhập" value={e.created_by_emp?.name ?? '—'} />
        </Section>

        {/* Update */}
        <Section title="Cập nhật">
          <Row label="Ngày sửa"  value={e.update_date ? formatTimestampDate(e.update_date) : '—'} />
          <Row label="Giờ sửa"   value={e.updated_at ? formatTimestampTime(e.updated_at) : '—'} />
          <Row label="Người sửa" value={e.updated_by_emp?.name ?? '—'} />
        </Section>

        {/* Stocktaking */}
        <Section title="Kiểm kê">
          <Row label="Người KK"  value={e.stocktake_by_emp?.name ?? '—'} />
          <Row label="Ngày KK"   value={e.stocktake_at ? formatTimestampDate(e.stocktake_at) : '—'} />
          <Row label="Giờ KK"    value={e.stocktake_at ? formatTimestampTime(e.stocktake_at) : '—'} />
        </Section>

        {/* Thao tác đơn-dòng — mirror thanh floating (khi tick), để xem chi tiết 1 pallet là đổi được ngay,
            không cần quay ra tick. Mỗi nút gate đúng quyền như thanh floating. */}
        {(() => {
          const p = user?.module_permissions
          const actionItems: ActionItem[] = []
          if (can(p, 'inventory', 'qa_update'))
            actionItems.push({ key: 'qa', icon: BadgeCheck, label: 'QA Status', tip: 'Đổi QA status pallet này', onClick: () => onQuickAction('qa') })
          if (can(p, 'inventory', 'update_ncc'))
            actionItems.push({ key: 'ncc', icon: Factory, label: 'NCC', tip: 'Gán NCC cho pallet này (áp HSD ngoại lệ theo NCC)', onClick: () => onQuickAction('ncc') })
          if (can(p, 'inventory', 'move_location'))
            actionItems.push({ key: 'location', icon: MapPin, label: 'Vị trí', tip: 'Chuyển vị trí pallet này', onClick: () => onQuickAction('location') })
          if (can(p, 'inventory', 'recode'))
            actionItems.push({ key: 'material', icon: Tag, label: 'Mã hàng', tip: 'Đổi mã hàng pallet này', onClick: () => onQuickAction('material') })
          if (can(p, 'inventory', 'update_prod_date'))
            actionItems.push({ key: 'production-date', icon: CalendarDays, label: 'Ngày SX', tip: 'Sửa ngày sản xuất pallet này', onClick: () => onQuickAction('production-date') })
          if (can(p, 'pallet_ops', 'split'))
            actionItems.push({ key: 'split', icon: Scissors, label: 'Tách', tip: 'Tách pallet này (chia số lượng, sang trang Dồn/Tách)', onClick: onSplit })
          if (!actionItems.length) return null
          return (
            <div className="border-t pt-3">
              <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Thao tác</p>
              <ActionCluster className="justify-start" items={actionItems} />
            </div>
          )
        })()}

        {/* Adjust block */}
        <div className="border-t pt-3 space-y-2">
          {/* Nút + form điều chỉnh: chỉ hiện nếu có quyền inventory.adjust (tránh bấm rồi 403). Lịch sử bên dưới vẫn xem được. */}
          {can(user?.module_permissions, 'inventory', 'adjust') && (!showAdj ? (
            <ActionCluster className="justify-start" items={[{
              key: 'adjust', icon: SlidersHorizontal, label: 'Điều chỉnh tồn',
              tip: 'Điều chỉnh tồn kho pallet này (+/− số thùng, có ghi log điều chỉnh)',
              primary: true,
              onClick: () => setShowAdj(true),
            } satisfies ActionItem]} />
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] text-slate-500">
                Tồn hiện tại: <strong>{qtyLabel(Number(remaining), e.material)}</strong>. Nhập số điều chỉnh (+ hoặc −).
              </p>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  placeholder="Vd: -2 hoặc +5"
                  value={adjInput}
                  onChange={ev => { setAdjInput(ev.target.value); setAdjError('') }}
                  className="h-8 text-sm text-center flex-1"
                />
                {hasEntry(e.material) && (
                  <select className="h-8 border border-slate-200 rounded-md px-1.5 text-xs bg-white shrink-0"
                    value={adjUnit} onChange={ev => setAdjUnit(ev.target.value as 'entry' | 'base')}>
                    <option value="base">{unitLabel(e.material?.base_unit)}</option>
                    <option value="entry">{unitLabel(e.material?.entry_unit)}</option>
                  </select>
                )}
              </div>
              <Input
                placeholder="Lý do điều chỉnh (tùy chọn)"
                value={adjNote}
                onChange={ev => setAdjNote(ev.target.value)}
                className="h-8 text-xs"
              />
              {adjInput && !isNaN(adjDeltaBase) && (
                <p className="text-[10px] text-slate-500 text-center">
                  Tồn mới: <strong>{qtyLabel(Number(remaining) + adjDeltaBase, e.material)}</strong>
                </p>
              )}
              {adjError && <p className="text-[10px] text-red-500">{adjError}</p>}
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={handleAdjust} disabled={isPending || !adjInput}>
                  {isPending ? '…' : 'Xác nhận'}
                </Button>
                <Button size="sm" variant="outline"
                  onClick={() => { setShowAdj(false); setAdjInput(''); setAdjNote(''); setAdjError('') }}>
                  Hủy
                </Button>
              </div>
            </div>
          ))}

          {/* Lịch sử điều chỉnh */}
          {adjLog && adjLog.length > 0 && (
            <div>
              <button
                className="text-[10px] text-blue-600 hover:underline"
                onClick={() => setShowLog(v => !v)}
              >
                {showLog ? 'Ẩn' : 'Xem'} lịch sử điều chỉnh ({adjLog.length})
              </button>
              {showLog && (
                <div className="mt-1.5 space-y-1.5 max-h-48 overflow-y-auto">
                  {adjLog.map(log => (
                    <div key={log.id} className="rounded border px-2 py-1.5 text-[10px] bg-slate-50">
                      <div className="flex items-center justify-between">
                        <span className={`font-semibold font-mono ${log.delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {log.delta > 0 ? '+' : ''}{qtyLabel(log.delta, e.material)}
                        </span>
                        <span className="text-slate-400">{formatTimestampDate(log.adjusted_at, true)} {formatTimestampTime(log.adjusted_at)}</span>
                      </div>
                      <div className="text-slate-500">
                        {qtyLabel(log.cartons_before, e.material)} → {qtyLabel(log.cartons_after, e.material)}
                        {log.actor_name && <span className="ml-1">· {log.actor_name}</span>}
                      </div>
                      {log.note && <div className="text-slate-600 italic mt-0.5">{log.note}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Small helpers ────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function Row({ label, value, mono, bold, cls, wrap }: {
  label: string; value: string; mono?: boolean; bold?: boolean; cls?: string; wrap?: boolean
}) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className={`text-right ${wrap ? 'break-words min-w-0' : 'truncate'} ${mono ? 'font-mono' : ''} ${bold ? 'font-semibold' : ''} ${cls ?? 'text-slate-700'}`}>
        {value}
      </span>
    </div>
  )
}
