import { useEffect, useMemo, useRef, useState } from 'react'
import { Package, X, SlidersHorizontal, ChevronRight, Check, Rows3, AlignJustify, Scissors, Layers, Sigma } from 'lucide-react'
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
  useInventoryEntries, useInventoryFacets, useWarehouses, useQAStatuses, useAdjustInventory,
  useAdjustmentLog,
  useLocationsReal, useMaterials, useWarehouseTypes,
  useBulkUpdateInventoryQA, useBulkTransferLocation, useBulkTransferMaterial,
  useBulkUpdateProductionDate, useInventorySummary, type InventorySummaryGroup,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can } from '@/config/permissions'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import type { InventoryEntry } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────

function formatLoc(loc: { location_code: string } | null): string {
  if (!loc) return '—'
  return loc.location_code
}

function calcDatePct(prodDate: string | null, shelfDays: number | null): number | null {
  if (!prodDate || !shelfDays || shelfDays <= 0) return null
  const prod = new Date(prodDate)
  if (isNaN(prod.getTime())) return null
  const totalMs = shelfDays * 86_400_000
  const remaining = prod.getTime() + totalMs - Date.now()
  return Math.max(0, Math.round((remaining / totalMs) * 100))
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
  if (e.qa_status) return '[&_td_span]:text-red-600'
  const pct = calcDatePct(e.production_date, e.material?.shelf_life_days ?? null)
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

// Cột bảng tồn kho — số phần tử PHẢI khớp số <TableCell> mỗi dòng EntryRow (17 cột)
const INVENTORY_COLS: { id: string; label: string; w: number; align?: 'right' }[] = [
  { id: 'check',     label: '',         w: 32 },
  { id: 'warehouse', label: 'Kho',      w: 110 },
  { id: 'category',  label: 'Loại kho', w: 90 },
  { id: 'matCode',   label: 'Mã hàng',  w: 90 },
  { id: 'matName',   label: 'Tên hàng', w: 150 },
  { id: 'pallet',    label: 'Mã pallet',w: 110 },
  { id: 'location',  label: 'Vị trí',   w: 90 },
  { id: 'imported',  label: 'Nhập',     w: 60, align: 'right' },
  { id: 'exported',  label: 'Xuất',     w: 60, align: 'right' },
  { id: 'remaining', label: 'Tồn',      w: 70, align: 'right' },
  { id: 'reserved',  label: 'Nhặt lẻ',  w: 64, align: 'right' },
  { id: 'available', label: 'Khả dụng', w: 70, align: 'right' },
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
  { id: 'date',      label: 'Date',     w: 80 },
  { id: 'datePct',   label: '%Date',    w: 64, align: 'right' },
  { id: 'imported',  label: 'Nhập',     w: 70, align: 'right' },
  { id: 'exported',  label: 'Xuất',     w: 70, align: 'right' },
  { id: 'remaining', label: 'Tồn',      w: 80, align: 'right' },
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
    <div className="w-72 shrink-0 border-l bg-white overflow-y-auto flex flex-col">
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
    <div className="w-72 shrink-0 border-l bg-white overflow-y-auto flex flex-col">
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
  const { data: materials = [] } = useMaterials({ search: search || undefined, category: category || undefined })

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
    <div className="w-72 shrink-0 border-l bg-white overflow-y-auto flex flex-col">
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
    <div className="w-72 shrink-0 border-l bg-white overflow-y-auto flex flex-col">
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

  const navigate = useNavigate()
  const [selected,     setSelected]     = useState<InventoryEntry | null>(null)
  const [checkedIds,   setCheckedIds]   = useState<Set<string>>(new Set())
  const [actionModal,  setActionModal]  = useState<'qa' | 'location' | 'material' | 'production-date' | null>(null)
  const [dense, setDense] = useState(() => localStorage.getItem('inventory_density') !== 'comfortable')
  function toggleDensity() {
    setDense(d => { localStorage.setItem('inventory_density', d ? 'comfortable' : 'compact'); return !d })
  }
  const [aggregate, setAggregate] = useState(() => localStorage.getItem('inventory_view_mode') === 'summary')
  function toggleAggregate() {
    const next = !aggregate
    localStorage.setItem('inventory_view_mode', next ? 'summary' : 'pallet')
    setAggregate(next)
    setSelected(null)
    setCheckedIds(new Set())
    setInventory({ page: 1 })
  }
  const { widths: colW,  startResize,                  totalWidth                } = useColumnResize('inventory_col_widths',         INVENTORY_COL_DEFAULTS)
  const { widths: sColW, startResize: sStartResize, totalWidth: sTotalWidth } = useColumnResize('inventory_summary_col_widths', SUMMARY_COL_DEFAULTS)

  const { data: warehouses   = [] } = useWarehouses(true)
  const { data: qaStatuses   = [] } = useQAStatuses()
  const { data: whTypes      = [] } = useWarehouseTypes()
  const categories = whTypes.map(t => t.value)
  const { data: facets } = useInventoryFacets({
    warehouse_ids: f.warehouseIds.length > 0 ? f.warehouseIds : undefined,
    categories:    f.materialCategories.length > 0 ? f.materialCategories : undefined,
  })

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
        // Restrict default to categories the user is allowed to see (if scope is set)
        const defaultCats = userAllowedCats.length > 0
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
    date_pct_ranges:    f.datePctRanges.length > 0 ? f.datePctRanges : undefined,
  }
  const { data, isLoading } = useInventoryEntries({ ...queryParams, page: f.page, limit: LIMIT }, !aggregate)
  const { data: summaryData, isLoading: summaryLoading } = useInventorySummary(queryParams, aggregate)

  const displayEntries    = data?.entries               ?? []
  const summaryGroups     = summaryData?.groups          ?? []
  const pagedGroups       = useMemo(() => summaryGroups.slice((f.page - 1) * LIMIT, f.page * LIMIT), [summaryGroups, f.page])
  const loading           = aggregate ? summaryLoading : isLoading
  const total             = aggregate ? (summaryData?.total ?? 0) : (data?.total ?? 0)
  const totalCartons      = aggregate ? (summaryData?.total_cartons_remaining ?? 0) : (data?.total_cartons_remaining ?? 0)
  const totalPages        = Math.max(1, Math.ceil(total / LIMIT))
  const checkedCount      = checkedIds.size
  const checkedIdArr      = useMemo(() => [...checkedIds], [checkedIds])

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
      materialCategories: [], manufacturerId: '', filterCycles: [], filterMachines: [], datePctRanges: [], page: 1,
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
    || f.manufacturerId || f.filterCycles.length > 0 || f.filterMachines.length > 0 || f.datePctRanges.length > 0)

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
  const locationOpts   = (facets?.locations ?? []).map(l => ({ value: l.code, label: l.code }))
  const materialOpts   = (facets?.materials ?? []).map(m => ({ value: m.id, label: m.name ? `${m.code} – ${m.name}` : m.code }))
  const cycleOpts      = (facets?.cycles ?? []).map(c => ({ value: c, label: c }))
  const machineOpts    = (facets?.machines ?? []).map(m => ({ value: m, label: m }))
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
      onChange: v => setInventory({ filterMaterialIds: v, page: 1 }) },
    { key: 'location', label: 'Vị trí', type: 'multi', options: locationOpts, selected: f.filterLocations,
      onChange: v => setInventory({ filterLocations: v, page: 1 }) },
    { key: 'qa', label: 'QA Status', type: 'multi', options: qaOpts, selected: f.qaStatusIds,
      onChange: v => setInventory({ qaStatusIds: v, page: 1 }) },
    { key: 'cycle', label: 'Chu kỳ', type: 'multi', options: cycleOpts, selected: f.filterCycles, searchable: cycleOpts.length > 5,
      onChange: v => setInventory({ filterCycles: v, page: 1 }) },
    { key: 'machine', label: 'Máy', type: 'multi', options: machineOpts, selected: f.filterMachines, searchable: machineOpts.length > 5,
      onChange: v => setInventory({ filterMachines: v, page: 1 }) },
    { key: 'datePct', label: '% Date', type: 'multi', options: datePctOpts, selected: f.datePctRanges, searchable: false,
      onChange: v => setInventory({ datePctRanges: v, page: 1 }) },
  ]

  const viewSnapshot = {
    search: f.search, warehouseIds: f.warehouseIds, materialCategories: f.materialCategories,
    status: f.status, filterMaterialIds: f.filterMaterialIds, filterLocations: f.filterLocations,
    qaStatusIds: f.qaStatusIds, filterCycles: f.filterCycles, filterMachines: f.filterMachines,
    datePctRanges: f.datePctRanges,
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
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 sm:rounded-t-xl">
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
        </div>

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
        { label: 'Pallet', value: total.toLocaleString('vi-VN') },
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
                      {INVENTORY_COLS.map((c, i) => (
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
        ) : actionModal === 'location' ? (
          <LocationPanel ids={checkedIdArr} warehouseId={actionWarehouseId} category={actionCategory} onClose={closeActionModal} />
        ) : actionModal === 'material' ? (
          <MaterialPanel ids={checkedIdArr} category={actionCategory} onClose={closeActionModal} />
        ) : actionModal === 'production-date' ? (
          <ProductionDatePanel ids={checkedIdArr} onClose={closeActionModal} />
        ) : selected ? (
          <DetailPanel entry={selected} onClose={() => setSelected(null)} warehouseMap={warehouseMap} />
        ) : null}
      </div>

      {/* Footer đếm bản ghi */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 sm:rounded-b-xl">
        {total > 0
          ? `${(f.page - 1) * LIMIT + 1}–${Math.min(f.page * LIMIT, total)} / ${total.toLocaleString('vi-VN')} ${aggregate ? 'nhóm' : 'pallet'}`
          : (aggregate ? '0 nhóm' : '0 pallet')}
        {selected && checkedCount === 0 && <span className="ml-2 text-blue-600">· 1 đang xem</span>}
      </div>
     </div>

      {/* ── Floating action bar (when items checked) ── */}
      {checkedCount > 0 && (
        <div className="fixed bottom-16 lg:bottom-6 left-1/2 -translate-x-1/2 z-50
          bg-slate-800 text-white rounded-full shadow-2xl px-4 py-2
          flex items-center gap-3 text-sm whitespace-nowrap">
          <span className="text-slate-300 text-xs font-medium">{checkedCount} pallet</span>
          <div className="w-px h-4 bg-slate-600" />
          {can(user?.module_permissions, 'inventory', 'qa_update') && (
            <button
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-700 hover:bg-slate-600 transition-colors"
              onClick={() => setActionModal('qa')}>
              QA Status
            </button>
          )}
          {can(user?.module_permissions, 'inventory', 'move_location') && (
            <button
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-700 hover:bg-slate-600 transition-colors"
              onClick={() => setActionModal('location')}>
              Vị trí
            </button>
          )}
          {can(user?.module_permissions, 'inventory', 'recode') && (
            <button
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-700 hover:bg-slate-600 transition-colors"
              onClick={() => setActionModal('material')}>
              Mã hàng
            </button>
          )}
          {can(user?.module_permissions, 'inventory', 'update_prod_date') && (
            <button
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-700 hover:bg-slate-600 transition-colors"
              onClick={() => setActionModal('production-date')}>
              Ngày SX
            </button>
          )}
          {/* Dồn / Tách pallet — điều hướng sang trang thao tác, prefill mã */}
          {can(user?.module_permissions, 'pallet_ops', 'split') && checkedCount === 1 && (
            <button
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-sky-700 hover:bg-sky-600 transition-colors"
              onClick={() => { const c = displayEntries.find(e => checkedIds.has(e.id))?.pallet_code; if (c) navigate(`/wms/pallet-ops?tab=split&source=${encodeURIComponent(c)}`) }}>
              <Scissors className="h-3 w-3" />Tách
            </button>
          )}
          {can(user?.module_permissions, 'pallet_ops', 'merge') && checkedCount >= 2 && (
            <button
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-sky-700 hover:bg-sky-600 transition-colors"
              onClick={() => {
                const codes = displayEntries.filter(e => checkedIds.has(e.id)).map(e => e.pallet_code)
                if (codes.length >= 2) navigate(`/wms/pallet-ops?tab=merge&target=${encodeURIComponent(codes[0])}&children=${encodeURIComponent(codes.slice(1).join(','))}`)
              }}>
              <Layers className="h-3 w-3" />Dồn
            </button>
          )}
          <div className="w-px h-4 bg-slate-600" />
          <button
            className="text-slate-400 hover:text-white transition-colors"
            onClick={() => setCheckedIds(new Set())}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

    </div>
  )
}

// ─── EntryRow ─────────────────────────────────────────────────

function EntryRow({ entry: e, isSelected, isChecked, onCheck, onClick, warehouseMap, dense = true }: {
  entry: InventoryEntry
  isSelected: boolean
  isChecked: boolean
  onCheck: (ev: React.MouseEvent) => void
  onClick: () => void
  warehouseMap: Record<string, string>
  dense?: boolean
}) {
  const loc           = formatLoc(e.location)
  const matCode       = e.material?.material_code ?? '—'
  const matName       = e.material?.short_name ?? '—'
  const qa            = e.qa_status?.code ?? '—'
  const remaining     = e.cartons_remaining ?? e.cartons_imported
  const exported      = Math.max(0, Number(e.cartons_imported) - Number(remaining))
  const pct           = calcDatePct(e.production_date, e.material?.shelf_life_days ?? null)
  const prodDateStr   = e.production_date ? formatTimestampDate(e.production_date, true) : '—'
  const adjQty        = e.adjustment_qty ?? 0
  const warehouseNm   = e.location?.warehouse?.name ?? (e.warehouse_id ? warehouseMap[e.warehouse_id] : null) ?? '—'
  const loaiKho       = e.material?.category ?? '—'

  return (
    <TableRow
      className={`transition-colors cursor-pointer ${entryRowBg(isSelected, isChecked)} ${entryRowText(e, isSelected)} ${dense ? '' : '[&_td]:py-2.5'}`}
      onClick={onClick}
    >
      {/* Checkbox */}
      <TableCell className="px-2 py-1 sticky left-0 z-10 bg-inherit" onClick={onCheck}>
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
        <span className="text-[10px] text-slate-700">{matName}</span>
      </TableCell>
      {/* Mã pallet */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono font-semibold">{e.pallet_code}</span>
        {e.parent_pallet_code && (
          <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-sky-100 px-1 py-0.5 text-[8px] text-sky-700" title={`Đã dồn vào ${e.parent_pallet_code}`}>
            <Layers className="h-2 w-2" />dồn
          </span>
        )}
        {e.origin === 'SPLIT' && (
          <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1 py-0.5 text-[8px] text-violet-700" title="Pallet tách ra">
            <Scissors className="h-2 w-2" />tách
          </span>
        )}
      </TableCell>
      {/* Vị trí */}
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono text-slate-700">{loc}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-500">{e.cartons_imported}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-500">{exported > 0 ? exported : '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{remaining}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {(e.cartons_reserved ?? 0) > 0
          ? <span className="text-[10px] font-semibold tabular-nums text-purple-600">{e.cartons_reserved}</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums text-blue-700">
          {Math.max(0, Number(remaining) - Number(e.cartons_reserved ?? 0))}
        </span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-600">{prodDateStr}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {pct !== null ? (
          <span className={`text-[10px] tabular-nums ${datePctCls(pct)}`}>{pct}%</span>
        ) : (
          <span className="text-[10px] text-slate-300">—</span>
        )}
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${STATUS_CLS[e.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {qa}
        </span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {adjQty !== 0 ? (
          <span className={`text-[10px] tabular-nums font-semibold ${adjQty > 0 ? 'text-green-600' : 'text-red-600'}`}>
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
      <TableCell className="px-2 py-1 whitespace-nowrap sticky left-0 z-10 bg-inherit">
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
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-600">{dateStr}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {g.date_pct !== null
          ? <span className={`text-[10px] tabular-nums ${datePctCls(g.date_pct)}`}>{g.date_pct}%</span>
          : <span className="text-[10px] text-slate-300">—</span>}
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-500">{g.cartons_imported}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-500">{g.cartons_exported > 0 ? g.cartons_exported : '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{g.cartons_remaining}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums text-slate-700">{g.pallet_count}</span>
      </TableCell>
    </TableRow>
  )
}

// ─── Detail panel ─────────────────────────────────────────────

function DetailPanel({ entry: e, onClose, warehouseMap }: { entry: InventoryEntry; onClose: () => void; warehouseMap: Record<string, string> }) {
  const user = useAuthStore(s => s.user)
  const [adjInput, setAdjInput]       = useState('')
  const [adjNote, setAdjNote]         = useState('')
  const [showAdj, setShowAdj]         = useState(false)
  const [showLog, setShowLog]         = useState(false)
  const [adjError, setAdjError]       = useState('')
  const { mutate: adjust, isPending } = useAdjustInventory()
  const { data: adjLog }              = useAdjustmentLog(e.id)

  const loc       = formatLoc(e.location)
  const remaining = e.cartons_remaining ?? e.cartons_imported
  const exported  = Math.max(0, Number(e.cartons_imported) - Number(remaining))
  const pct       = calcDatePct(e.production_date, e.material?.shelf_life_days ?? null)

  function handleAdjust() {
    const val = parseFloat(adjInput)
    if (isNaN(val) || val === 0) { setAdjError('Nhập số khác 0'); return }
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
    <div className="w-72 shrink-0 border-l bg-white overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
        <p className="text-xs font-semibold text-slate-700 font-mono truncate">{e.pallet_code}</p>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 ml-2">
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
          <Row label="Nhập"       value={`${e.cartons_imported} thùng`} />
          <Row label="Xuất"       value={exported > 0 ? `${exported} thùng` : '—'} />
          <Row label="Tồn"        value={`${remaining} thùng`} bold />
          {e.status === 'LOOSE_PICKING' && (e.cartons_reserved ?? 0) > 0 && (<>
            <Row label="Nhặt lẻ (giữ)"
              value={`${e.cartons_reserved} thùng`}
              cls="text-purple-700 font-semibold" />
            <Row label="Khả dụng"
              value={`${Math.max(0, Number(remaining) - Number(e.cartons_reserved ?? 0))} thùng`}
              bold cls="text-blue-700" />
          </>)}
          <Row label="Điều chỉnh" value={e.adjustment_qty ? `${Number(e.adjustment_qty) > 0 ? '+' : ''}${e.adjustment_qty}` : '—'}
            cls={e.adjustment_qty ? (Number(e.adjustment_qty) > 0 ? 'text-green-600' : 'text-red-600') : ''} />
        </Section>

        {/* Date info */}
        <Section title="Ngày / Hạn dùng">
          <Row label="Ngày SX"
            value={e.production_date ? formatTimestampDate(e.production_date, false) : '—'} />
          <Row label="HSD (ngày)"
            value={e.material?.shelf_life_days ? `${e.material.shelf_life_days} ngày` : '—'} />
          {pct !== null && (
            <Row label="% Date còn" value={`${pct}%`} cls={datePctCls(pct)} bold />
          )}
        </Section>

        {/* Production */}
        <Section title="Sản xuất">
          <Row label="NMSX"    value={e.manufacturer?.code ?? '—'} mono />
          <Row label="Chu kỳ" value={e.cycle ?? '—'} mono />
          <Row label="Máy"    value={e.machine_code ?? '—'} mono />
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

        {/* Adjust block */}
        <div className="border-t pt-3 space-y-2">
          {/* Nút + form điều chỉnh: chỉ hiện nếu có quyền inventory.adjust (tránh bấm rồi 403). Lịch sử bên dưới vẫn xem được. */}
          {can(user?.module_permissions, 'inventory', 'adjust') && (!showAdj ? (
            <Button size="sm" variant="outline" className="w-full gap-1.5"
              onClick={() => setShowAdj(true)}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Điều chỉnh tồn kho
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] text-slate-500">
                Tồn hiện tại: <strong>{remaining}</strong> thùng. Nhập số điều chỉnh (+ hoặc −).
              </p>
              <Input
                type="number"
                placeholder="Vd: -2 hoặc +5"
                value={adjInput}
                onChange={ev => { setAdjInput(ev.target.value); setAdjError('') }}
                className="h-8 text-sm text-center"
              />
              <Input
                placeholder="Lý do điều chỉnh (tùy chọn)"
                value={adjNote}
                onChange={ev => setAdjNote(ev.target.value)}
                className="h-8 text-xs"
              />
              {adjInput && !isNaN(parseFloat(adjInput)) && (
                <p className="text-[10px] text-slate-500 text-center">
                  Tồn mới: <strong>{Number(remaining) + parseFloat(adjInput)}</strong> thùng
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
                          {log.delta > 0 ? '+' : ''}{log.delta} thùng
                        </span>
                        <span className="text-slate-400">{formatTimestampDate(log.adjusted_at, true)} {formatTimestampTime(log.adjusted_at)}</span>
                      </div>
                      <div className="text-slate-500">
                        {log.cartons_before} → {log.cartons_after} thùng
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
