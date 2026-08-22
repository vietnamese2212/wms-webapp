import { useEffect, useRef, useState } from 'react'
import {
  useWarehouses, useLocationsReal, useLocationsByFlag, useLocationsByIds,
  useUnflagEntry, useStocktakeEntries, useInventoryEntry, fetchAllStocktakeEntries,
  usePctBands,
  type StocktakeEntryRow,
} from '@/api/hooks'
import { PagerNav, ListFooter } from '@/components/shared/ListPager'
import { useAuthStore } from '@/stores/authStore'
import { useScopedWhTypes } from '@/hooks/useUserScope'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { can, type ModulePermissions } from '@/config/permissions'
import * as XLSX from 'xlsx'
import { saveWorkbook } from '@/utils/saveExcel'
import { sanitizeRows } from '@/utils/excelSafe'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { LocationScanButton } from '@/components/wms/LocationScanButton'
import { SavedViews } from '@/components/shared/SavedViews'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { BarChart2, Flag, MapPin, X, Download, Rows3, AlignJustify } from 'lucide-react'
import { formatDate, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { qtyLabel, qtyEntryText, qtyEntryDecimal } from '@/utils/qtyUnits'
import { computePctDate } from '@/utils/shelfLife'
import { pctDateCls } from '@/utils/pctDateBands'
import { rowText, type RowStatusKey } from '@/lib/rowStatus'
import { StocktakeTabs, LOC_ID_CAP } from '@/components/wms/StocktakeTabs'

function parseDiff(note: string | null): { actual: number; app: number; diff: number } | null {
  if (!note) return null
  // Mã KG (base_unit thập phân) kiểm lệch → note có số lẻ ("Thực tế: 12.5 / App: 10.5") — nhận cả thập phân.
  const m = note.match(/Thực tế:\s*([\d.]+)\s*\/\s*App:\s*([\d.]+)/)
  if (!m) return null
  const actual = parseFloat(m[1]), app = parseFloat(m[2])
  if (!Number.isFinite(actual) || !Number.isFinite(app)) return null
  return { actual, app, diff: actual - app }
}

// "Đã kiểm" = CÓ stocktake_at TRONG khoảng ngày kiểm đang xem (mirror BE — BỎ luật "nhập hôm nay=đã kiểm").
function isCheckedInRange(e: StocktakeEntryRow, rangeStart: string, rangeEnd: string): boolean {
  return !!(e.stocktake_at && e.stocktake_at >= rangeStart && e.stocktake_at <= rangeEnd)
}

// ─── Stat Card ───────────────────────────────────────────────────
function StatCard({ label, value, active, color, onClick }: {
  label: string; value: number; active: boolean; color: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 min-w-0 rounded-lg border px-2 py-1.5 text-left transition-all
        ${active ? `${color} shadow-sm` : 'bg-white border-slate-200 hover:bg-slate-50'}`}
    >
      <p className={`text-[9px] font-medium ${active ? 'opacity-75' : 'text-slate-500'}`}>{label}</p>
      <p className={`text-base font-bold tabular-nums leading-tight ${active ? '' : 'text-slate-800'}`}>{value}</p>
    </button>
  )
}

// ─── Side Detail Panel ───────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  IN_STOCK: 'Còn hàng', PARTIAL: 'Xuất 1 phần', EXPORTED: 'Đã xuất',
  TRANSFERRED: 'Đã chuyển', QUARANTINE: 'Cách ly', CANCELLED: 'Đã hủy',
}
const STATUS_CLS: Record<string, string> = {
  IN_STOCK: 'bg-green-100 text-green-700', PARTIAL: 'bg-amber-100 text-amber-700',
  EXPORTED: 'bg-blue-100 text-blue-700', TRANSFERRED: 'bg-slate-100 text-slate-600',
  QUARANTINE: 'bg-red-100 text-red-700', CANCELLED: 'bg-gray-100 text-gray-500',
}

function DR({ label, value, mono, bold, cls }: {
  label: string; value: string; mono?: boolean; bold?: boolean; cls?: string
}) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-slate-400 shrink-0 text-[11px]">{label}</span>
      <span className={`text-right text-[11px] break-all ${mono ? 'font-mono' : ''} ${bold ? 'font-semibold' : ''} ${cls ?? 'text-slate-700'}`}>
        {value}
      </span>
    </div>
  )
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{title}</p>
      {children}
    </div>
  )
}

function DetailPanel({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const { data: entry, isLoading } = useInventoryEntry(entryId)
  const remaining = entry ? (entry.cartons_remaining ?? entry.cartons_imported) : 0
  const exported  = entry ? Math.max(0, Number(entry.cartons_imported) - Number(remaining)) : 0
  const pct       = entry ? computePctDate(entry, entry.material) : null
  const diff      = entry ? parseDiff(entry.stocktake_flag_note ?? null) : null
  const pctBands  = usePctBands()

  return (
    <div className="fixed inset-0 z-50 w-full lg:static lg:inset-auto lg:z-auto lg:w-72 shrink-0 border-l bg-white flex flex-col overflow-hidden shadow-xl lg:shadow-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
        <p className="font-mono text-[10px] font-semibold text-slate-700 truncate flex-1" title={entry?.pallet_code ?? ''}>
          {isLoading ? '…' : (entry?.pallet_code ?? '—')}
        </p>
        <button onClick={onClose} className="ml-2 text-slate-400 hover:text-slate-700 shrink-0">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            {[1,2,3,4,5].map(i => <div key={i} className="h-4 bg-slate-100 rounded animate-pulse" />)}
          </div>
        ) : !entry ? (
          <p className="text-xs text-slate-400 text-center py-4">Không tìm thấy</p>
        ) : (
          <>
            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_CLS[entry.status] ?? 'bg-gray-100 text-gray-500'}`}>
              {STATUS_LABEL[entry.status] ?? entry.status}
            </span>

            {/* Kiểm kê — đặt lên đầu vì đây là thông tin quan trọng nhất ở trang này */}
            <Sec title="Kiểm kê vị trí">
              {entry.stocktake_flagged ? (
                <div className="mb-1">
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-red-600 bg-red-100 rounded-full px-1.5 py-0.5">
                    <Flag className="h-2.5 w-2.5" /> Chênh lệch
                  </span>
                </div>
              ) : entry.stocktake_at ? (
                <div className="mb-1">
                  <span className="text-[9px] font-semibold text-green-600 bg-green-100 rounded-full px-1.5 py-0.5">
                    Đã kiểm
                  </span>
                </div>
              ) : null}
              <DR label="Người check"
                value={entry.stocktake_by_emp?.name ?? '—'}
                cls={entry.stocktake_by_emp ? 'text-slate-700 font-semibold' : undefined} />
              <DR label="Thời gian check"
                value={entry.stocktake_at
                  ? `${formatTimestampDate(entry.stocktake_at, true)} ${formatTimestampTime(entry.stocktake_at)}`
                  : '—'} />
              {diff && (
                <>
                  <DR label="Tồn thực tế" value={qtyLabel(diff.actual, entry.material)} bold />
                  <DR label="Tồn app"     value={qtyLabel(diff.app, entry.material)} />
                  <DR label="Chênh lệch"
                    value={`${diff.diff > 0 ? '+' : ''}${qtyLabel(diff.diff, entry.material)}`}
                    cls={diff.diff < 0 ? 'text-red-600 font-semibold' : diff.diff > 0 ? 'text-amber-600 font-semibold' : 'text-slate-400'} />
                </>
              )}
            </Sec>

            <Sec title="Thông tin hàng">
              <DR label="Kho"      value={entry.location?.warehouse?.name ?? '—'} />
              <DR label="Vị trí"   value={entry.location?.location_code  ?? '—'} mono />
              <DR label="Mã hàng"  value={entry.material?.material_code  ?? '—'} mono />
              <DR label="Tên hàng" value={entry.material?.short_name     ?? '—'} />
              {entry.qa_status && (
                <DR label="QA" value={`${entry.qa_status.code} – ${entry.qa_status.name}`} />
              )}
            </Sec>

            <Sec title="Số lượng">
              <DR label="Nhập" value={qtyLabel(Number(entry.cartons_imported), entry.material)} />
              {exported > 0 && <DR label="Xuất" value={qtyLabel(exported, entry.material)} />}
              <DR label="Tồn"  value={qtyLabel(Number(remaining), entry.material)} bold />
              {entry.adjustment_qty != null && Number(entry.adjustment_qty) !== 0 && (
                <DR label="Điều chỉnh"
                  value={`${Number(entry.adjustment_qty) > 0 ? '+' : ''}${qtyLabel(Number(entry.adjustment_qty), entry.material)}`}
                  cls={Number(entry.adjustment_qty) > 0 ? 'text-green-600' : 'text-red-600'} />
              )}
            </Sec>

            <Sec title="Ngày / Hạn dùng">
              <DR label="NSX" value={entry.production_date ? formatDate(entry.production_date) : '—'} />
              {entry.batch && <DR label="Mã lô" value={entry.batch} mono />}
              {entry.expiry_date
                ? <DR label="HSD" value={formatDate(entry.expiry_date)} bold />
                : entry.material?.shelf_life_days != null && (
                  <DR label="HSD" value={`${entry.material.shelf_life_days} ngày`} />
                )}
              {pct !== null && (
                <DR label="%Date" value={`${pct}%`}
                  cls={`${pctDateCls(pct, pctBands)} font-semibold`} />
              )}
            </Sec>

            {(entry.manufacturer || entry.cycle || entry.machine_code) && (
              <Sec title="Sản xuất">
                {entry.manufacturer && <DR label="NMSX"   value={entry.manufacturer.code} mono />}
                {entry.cycle        && <DR label="Chu kỳ" value={entry.cycle} mono />}
                {entry.machine_code && <DR label="Máy"    value={entry.machine_code} mono />}
              </Sec>
            )}

            <Sec title="Nhập kho">
              <DR label="Ngày nhập"  value={entry.import_date ? formatDate(entry.import_date) : '—'} />
              <DR label="Giờ nhập"   value={entry.created_at  ? formatTimestampTime(entry.created_at) : '—'} />
              <DR label="Người nhập" value={entry.created_by_emp?.name ?? '—'} />
            </Sec>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Cột bảng (Manhattan, kéo giãn) ──────────────────────────────
const STK_COLS: { id: string; label: string; w: number; align?: 'right' }[] = [
  { id: 'pallet', label: 'Mã pallet',      w: 130 },
  { id: 'loc',    label: 'Vị trí',         w: 120 },
  { id: 'mat',    label: 'Tên hàng',       w: 160 },
  { id: 'app',    label: 'Tồn App',        w: 80,  align: 'right' },
  { id: 'real',   label: 'Tồn thực tế',    w: 90,  align: 'right' },
  { id: 'diff',   label: 'Chênh lệch',     w: 90,  align: 'right' },
  { id: 'by',     label: 'Người kiểm',     w: 120 },
  { id: 'at',     label: 'Thời gian kiểm', w: 140 },
  { id: 'status', label: 'Trạng thái',     w: 100 },
  { id: 'unflag', label: 'Bỏ cờ',          w: 80 },
]
const STK_COL_DEFAULTS = STK_COLS.map(c => c.w)

// ─── Main ────────────────────────────────────────────────────────
export default function StocktakeDashboard() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null

  const allowedDashWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids)
    : null

  const { warehouseId, category, locationIds, requiresOnly, view, page, pageSize } = useWmsFilterStore(s => s.stocktakeSummary)
  const setStocktakeSummary = useWmsFilterStore(s => s.setStocktakeSummary)
  const [selectedId,   setSelectedId]   = useState<string | null>(null)
  const [dense, setDense] = useState(() => localStorage.getItem('stocktake_summary_density') === '1')
  const toggleDense = () => setDense(d => { localStorage.setItem('stocktake_summary_density', d ? '0' : '1'); return !d })
  const { widths: colW, startResize, totalWidth } = useColumnResize('stocktake_summary_col_widths', STK_COL_DEFAULTS)
  const viewSnapshot = { warehouseId, category, locationIds }
  const savedViews = useSavedViewsStore(s => s.views['stocktake_summary'] ?? [])
  const activeViewId = savedViews.find(v => JSON.stringify(v.filters) === JSON.stringify(viewSnapshot))?.id ?? null

  // Mặc định kho = kho đầu tiên của user nếu store chưa có (cần kho để chọn vị trí)
  useEffect(() => {
    if (!warehouseId) {
      const def = user?.warehouse_ids?.[0] ?? user?.warehouse_id ?? ''
      if (def) setStocktakeSummary({ warehouseId: def })
    }
  }, [warehouseId, user, setStocktakeSummary])

  const unflag = useUnflagEntry()
  const { data: warehouses = [] } = useWarehouses(true)
  const { data: whTypes    = [] } = useScopedWhTypes()
  const categories = whTypes.map(t => t.value)
  // Ô lọc Vị trí = TÌM TRÊN SERVER (kéo cả kho Bàu Bàng 1.517 vị trí = 1.030KB/2,9s mỗi lần mở màn)
  const [locTerm, setLocTerm] = useState('')
  const locTermDeb = useDebouncedValue(locTerm, 250)
  const { data: locations = [], isFetching: locLoading } = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId, category: category || undefined, search: locTermDeb || undefined, limit: 50 } : undefined,
    !!warehouseId,
  )
  // Nhãn cho vị trí ĐANG CHỌN (options chỉ có 50 dòng khớp từ khóa hiện tại → chip in uuid thô)
  const { data: pickedLocs = [] } = useLocationsByIds(locationIds)

  const filteredLocations = (locations as any[])
  // Vị trí "quan trọng" (cần kiểm) — hỏi thẳng TẬP mang cờ. Màn này TỰ TICK cả tập khi mở nên
  // cần ĐỦ id, không cắt 50 được; nhưng tập cờ là tập CON có chủ đích nên vẫn nhỏ.
  const { data: flagLocs = [] } = useLocationsByFlag(
    'requires_stocktake', { warehouse_id: warehouseId, category: category || undefined }, !!warehouseId)
  const importantLocIds = flagLocs.map(l => l.id)
  // "Chỉ vị trí cần check" bật (mặc định) → tự chọn hết vị trí quan trọng khi MỞ (1 lần/kho).
  // Bỏ tick sẽ xoá chọn (requiresOnly=false) nên effect không tự điền lại.
  const initedWh = useRef<string | null>(null)
  useEffect(() => {
    if (requiresOnly && initedWh.current !== warehouseId && locationIds.length === 0 && importantLocIds.length > 0) {
      initedWh.current = warehouseId
      setStocktakeSummary({ locationIds: importantLocIds })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId, requiresOnly, locationIds.length, importantLocIds.join(',')])
  // Checkbox phản ánh THỰC TẾ: đang giới hạn đúng bộ vị trí quan trọng?
  const isImportantScope = importantLocIds.length > 0
    && locationIds.length === importantLocIds.length
    && importantLocIds.every(id => locationIds.includes(id))

  // Tổng hợp KK = trạng thái HÔM NAY (tiến độ kiểm của current stock). Xem lại ngày quá khứ → tab "Lịch sử kiểm".
  const todayVN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const rangeStart = new Date(`${todayVN}T00:00:00.000+07:00`).toISOString()
  const rangeEnd   = new Date(`${todayVN}T23:59:59.999+07:00`).toISOString()

  // Đúng bộ "cần check" → gửi CỜ requires_only (BE tự resolve vị trí). Nhồi cả nghìn id vào query
  // string là 414 trước khi tới BE (kho 1.517 vị trí = URL 55KB; ngưỡng ~800 id/32KB — đo 27/07).
  const tooManyLocs = !isImportantScope && locationIds.length > LOC_ID_CAP
  const queryParams = {                              // không truyền ngày → BE mặc định HÔM NAY
    warehouse_id: isImportantScope ? (warehouseId || undefined) : undefined,
    category: isImportantScope ? (category || undefined) : undefined,
    requires_only: isImportantScope ? '1' : undefined,
    location_ids: isImportantScope ? undefined : locationIds.join(','),
    view,
  }
  const { data, isFetching } = useStocktakeEntries(
    { ...queryParams, page, page_size: pageSize },
    locationIds.length > 0 && !tooManyLocs,
  )

  const stats   = data?.stats   ?? { total: 0, checked: 0, unchecked: 0, flagged: 0, matched: 0 }
  const entries = data?.entries ?? []
  const totalRows  = data?.total_filtered ?? 0
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))

  // Chỉ số kết quả kiểm (đếm chính xác từ BE): bao phủ = đã kiểm/tổng; chính xác = khớp/đã kiểm.
  // KHÔNG cộng "Σ lệch" cross-mã (đơn vị base khác nhau → tổng vô nghĩa; đã có số PALLET lệch ở thẻ Chênh lệch).
  const coverage = stats.total   > 0 ? Math.round((stats.checked  / stats.total)   * 100) : 0
  const accuracy = stats.checked > 0 ? Math.round((stats.matched  / stats.checked) * 100) : 100

  // Màu CHỮ theo trạng thái (không fill nền):
  // - chênh lệch=đỏ (cần xử lý) · đã quét trong ngày=xanh dương + GẠCH NGANG (xong, bỏ qua)
  // - chưa quét=xám đậm thường (cần tập trung tìm) → đẩy lên đầu (sort ở backend)
  function rowStatusKey(e: StocktakeEntryRow): RowStatusKey {
    if (e.stocktake_flagged) return 'paused'
    if (isCheckedInRange(e, rangeStart, rangeEnd)) return 'completed'
    return 'pending'
  }

  const defs: FilterDef[] = [
    { key: 'warehouse', label: 'Kho', type: 'single', value: warehouseId, allLabel: 'Tất cả kho',
      onChange: v => setStocktakeSummary({ warehouseId: v, locationIds: [], page: 1 }),
      options: (warehouses as { id: string; name: string }[]).filter(w => !allowedDashWhIds || allowedDashWhIds.has(w.id)).map(w => ({ value: w.id, label: w.name })) },
    { key: 'category', label: 'Loại hàng', type: 'single', value: category, allLabel: 'Tất cả loại',
      onChange: v => setStocktakeSummary({ category: v, locationIds: [], page: 1 }),
      options: (categories as string[]).map(c => ({ value: c, label: c })) },
    { key: 'location', label: 'Vị trí', type: 'multi', selected: locationIds,
      onChange: ids => { setStocktakeSummary({ locationIds: ids, page: 1 }); setSelectedId(null) },
      serverSearch: true, onSearchChange: setLocTerm, loading: locLoading,
      selectedOpts: pickedLocs.map(l => ({ value: l.id, label: `${l.location_code}${l.requires_stocktake ? ' 🚩' : ''}` })),
      options: filteredLocations.map((l: { id: string; location_code: string; requires_stocktake?: boolean }) => ({ value: l.id, label: `${l.location_code}${l.requires_stocktake ? ' 🚩' : ''}` })) },
  ]

  // Xuất Excel = TOÀN BỘ kết quả lọc (duyệt hết trang), không phải trang đang xem — file cụt
  // là kiểu sai âm thầm: người nhận không có cách nào biết là thiếu.
  const [exporting, setExporting] = useState(false)
  async function exportExcel() {
    setExporting(true)
    let all: StocktakeEntryRow[]
    try {
      all = await fetchAllStocktakeEntries(queryParams)
    } catch {
      setExporting(false)
      return
    }
    const sheet = all.map(e => {
      const diff = parseDiff(e.stocktake_flag_note ?? null)
      return {
        'Mã pallet': e.pallet_code, 'Vị trí': e.location?.location_code ?? '',
        'Tên hàng': e.material?.short_name ?? e.material?.material_code ?? '',
        'Tồn App': qtyEntryDecimal(e.cartons_remaining, e.material),
        'Thực tế': diff ? qtyEntryDecimal(diff.actual, e.material) : '',
        'Chênh lệch': diff ? qtyEntryDecimal(diff.diff, e.material) : '',
        'Người kiểm': e.stocktake_by_emp?.name ?? '',
        'TG kiểm': e.stocktake_at ? `${formatTimestampDate(e.stocktake_at, true)} ${formatTimestampTime(e.stocktake_at)}` : '',
        'Trạng thái': e.stocktake_flagged ? 'Chênh lệch' : (isCheckedInRange(e, rangeStart, rangeEnd) ? 'Đã kiểm' : 'Chưa kiểm'),
      }
    })
    const ws = XLSX.utils.json_to_sheet(sanitizeRows(sheet))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Tổng hợp KK')
    saveWorkbook(wb, `tong_hop_kk_${todayVN}.xlsx`)
    setExporting(false)
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
     <StocktakeTabs />
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Filters — compact, ~70% kích thước cũ */}
      <div className="border-b bg-white px-3 py-1.5 shrink-0 space-y-1 sm:space-y-1.5 sm:rounded-t-xl">
        {/* Row 1: title + filters (FilterBar chuẩn) */}
        <div className="flex gap-1.5 flex-wrap items-center">
          <div className="flex items-center gap-1 shrink-0">
            <BarChart2 className="h-3.5 w-3.5 text-blue-600" />
            <span className="text-xs font-semibold text-slate-700">Tổng hợp KK</span>
          </div>
          {importantLocIds.length > 0 && (
            <label className="flex items-center gap-1 cursor-pointer select-none shrink-0"
              title={`Chỉ xem ${importantLocIds.length} vị trí đã gắn cờ "cần kiểm kê" (ở trang Vị trí kho). Bỏ tick để chọn vị trí khác.`}>
              <input type="checkbox" checked={isImportantScope} onChange={e => {
                const on = e.target.checked
                setStocktakeSummary(on ? { requiresOnly: true, locationIds: importantLocIds, page: 1 } : { requiresOnly: false, locationIds: [], page: 1 })
              }} className="h-3 w-3 cursor-pointer" />
              <span className="text-[11px] text-slate-600 flex items-center gap-0.5">
                <Flag className="h-2.5 w-2.5 text-red-500" /> Chỉ vị trí cần check
              </span>
            </label>
          )}
          <div className="flex-1" />
          {/* Mobile: SavedViews + action GOM 1 hàng (PDA); desktop sm:contents → như cũ */}
          <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
          <SavedViews module="stocktake_summary" currentFilters={viewSnapshot} activeId={activeViewId}
            onApply={(fl) => setStocktakeSummary(fl as Partial<typeof viewSnapshot>)} />
          <button type="button" onClick={toggleDense}
            className="hidden sm:inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 shrink-0"
            title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
            {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
          {/* Cụm action toolbar (chuẩn ActionCluster) — Export chỉ dùng trên PC */}
          <ActionCluster className="shrink-0" mobileInline items={[
            // Xuất file = mang dữ liệu ra ngoài → quyền RIÊNG stocktake.export
            ...(can(perms, 'stocktake', 'export') ? [{
              key: 'export', icon: Download, label: exporting ? 'Đang tải…' : 'Excel',
              tip: 'Xuất Excel TOÀN BỘ danh sách theo bộ lọc đang áp (không chỉ trang đang xem)',
              mobileHidden: true, disabled: !entries.length || exporting, busy: exporting,
              onClick: exportExcel,
            } satisfies ActionItem] : []),
          ]} />
          <FilterSheetButton defs={defs} className="sm:hidden" />
          {/* Quét tem ô để chọn vị trí cần tổng hợp (cộng dồn — kiểm vài kệ liền nhau) */}
          <LocationScanButton
            purpose="lookup"   // chỉ trỏ tới ô để lọc — ô đầy vẫn phải chọn được
            warehouseId={warehouseId || null}
            onPicked={loc => {
              setStocktakeSummary({
                locationIds: locationIds.includes(loc.id) ? locationIds : [...locationIds, loc.id],
                page: 1,
              })
              setSelectedId(null)
            }}
          />
          </div>
          <FilterBar defs={defs} className="hidden sm:flex" />
        </div>

        {/* Row 2: stat cards — chỉ hiện khi đã chọn vị trí */}
        {locationIds.length > 0 && (
          <div className="flex gap-1.5">
            <StatCard label="Tổng Pallet" value={stats.total}
              active={view === 'all'} color="bg-slate-100 text-slate-700 border-slate-300"
              onClick={() => setStocktakeSummary({ view: 'all', page: 1 })} />
            <StatCard label="Đã kiểm" value={stats.checked}
              active={view === 'checked'} color="bg-green-100 text-green-700 border-green-300"
              onClick={() => setStocktakeSummary({ view: 'checked', page: 1 })} />
            <StatCard label="Chưa kiểm" value={stats.unchecked}
              active={view === 'unchecked'} color="bg-amber-100 text-amber-700 border-amber-300"
              onClick={() => setStocktakeSummary({ view: 'unchecked', page: 1 })} />
            <StatCard label="Chênh lệch" value={stats.flagged}
              active={view === 'flagged'} color="bg-red-100 text-red-700 border-red-300"
              onClick={() => setStocktakeSummary({ view: 'flagged', page: 1 })} />
          </div>
        )}

        {/* Row 3: chỉ số kết quả kiểm — bao phủ + độ chính xác của ĐỢT kiểm đang xem */}
        {locationIds.length > 0 && (
          <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-slate-500">
            <span>Bao phủ <b className={coverage >= 90 ? 'text-green-600' : coverage >= 50 ? 'text-amber-600' : 'text-slate-700'}>{coverage}%</b> ({stats.checked}/{stats.total})</span>
            <span className="text-slate-300">·</span>
            <span>Chính xác <b className={accuracy >= 98 ? 'text-green-600' : accuracy >= 90 ? 'text-amber-600' : 'text-red-600'}>{accuracy}%</b> ({stats.matched}/{stats.checked} khớp)</span>
            <span className="text-slate-300">·</span>
            <span>Kiểm hôm nay <b className="text-slate-700">{todayVN}</b> — xem ngày khác ở <b className="text-blue-600">Lịch sử kiểm</b></span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        {tooManyLocs ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 px-6 text-center">
            <MapPin className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">Đang chọn {locationIds.length.toLocaleString('vi-VN')} vị trí — quá nhiều để lọc (tối đa {LOC_ID_CAP})</p>
            <p className="text-[11px] mt-1 max-w-sm">Bỏ bớt vị trí, hoặc bật <b>“Chỉ vị trí cần check”</b> để xem trọn nhóm trọng yếu của kho.</p>
          </div>
        ) : locationIds.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 px-6 text-center">
            <MapPin className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">Chọn vị trí ở thanh lọc để xem tổng hợp</p>
            {warehouseId && importantLocIds.length === 0 && (
              <p className="text-[11px] mt-1 max-w-xs">Mẹo: gắn cờ <span className="text-red-500 font-medium">"cần kiểm kê"</span> cho các vị trí trọng yếu ở trang <b>Vị trí kho</b> → báo cáo sẽ tự lên nhóm đó mỗi khi mở.</p>
            )}
          </div>
        ) : (
          <>
            {/* Table — overflow-auto cho cả scroll dọc lẫn ngang + sticky header */}
            <div className="flex-1 min-w-0 overflow-auto pb-20 lg:pb-4">
              <Table className={`table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 ${dense ? '[&_td]:!py-0.5' : '[&_td]:!py-1.5'}`} style={{ width: totalWidth, minWidth: '100%' }}>
                <colgroup>
                  {colW.map((w, i) => <col key={i} style={{ width: w }} />)}
                </colgroup>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    {STK_COLS.map((c, i) => (
                      <TableHead key={c.id}
                        className={`px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                        {c.label}
                        {i > 0 && c.id !== 'unflag' && (
                          <span onPointerDown={e => startResize(i, e)} onClick={e => e.stopPropagation()}
                            className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70"
                            title="Kéo để chỉnh độ rộng cột" />
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isFetching && entries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={STK_COLS.length} className="text-center text-xs text-slate-400 py-8">Đang tải…</TableCell>
                    </TableRow>
                  ) : entries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={STK_COLS.length} className="text-center text-xs text-slate-400 py-8">
                        {view === 'problem'   ? 'Không có pallet cần xử lý 🎉'
                          : view === 'checked'   ? 'Chưa có pallet nào được kiểm trong đợt này'
                          : view === 'flagged'   ? 'Không có chênh lệch trong đợt này 🎉'
                          : view === 'unchecked' ? 'Tất cả pallet đã được kiểm 🎉'
                          : 'Không có dữ liệu'}
                      </TableCell>
                    </TableRow>
                  ) : entries.map(e => {
                    const diff    = parseDiff(e.stocktake_flag_note)
                    const checked = isCheckedInRange(e, rangeStart, rangeEnd)
                    const sel     = selectedId === e.id
                    const stickyBg = sel ? 'bg-sky-50' : 'bg-white'
                    return (
                      <TableRow
                        key={e.id}
                        className={`cursor-pointer transition-colors ${rowText(rowStatusKey(e))} ${sel ? 'bg-sky-50' : ''}`}
                        onClick={() => setSelectedId(prev => prev === e.id ? null : e.id)}
                      >
                        <TableCell className={`px-2 py-1 whitespace-nowrap sticky left-0 z-10 ${stickyBg}`}>
                          <span className="font-mono text-[10px] font-semibold">
                            {e.pallet_code}
                          </span>
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          <span className="font-mono text-[10px] block truncate" title={e.location?.location_code ?? ''}>
                            {e.location?.location_code ?? <span className="text-slate-300">—</span>}
                          </span>
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          <span className="text-[10px] block truncate" title={e.material?.short_name ?? e.material?.material_code ?? ''}>
                            {e.material?.short_name ?? e.material?.material_code ?? '—'}
                          </span>
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap text-right">
                          <span className="text-[10px] font-semibold tabular-nums">{qtyEntryText(e.cartons_remaining, e.material)}</span>
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap text-right">
                          {diff
                            ? <span className="text-[10px] tabular-nums font-semibold">{qtyEntryText(diff.actual, e.material)}</span>
                            : <span className="text-[10px] text-slate-300">—</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap text-right">
                          {diff
                            ? <span className={`text-[10px] font-semibold tabular-nums ${diff.diff < 0 ? 'text-red-600' : diff.diff > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                                {diff.diff > 0 ? '+' : ''}{qtyEntryText(diff.diff, e.material)}
                              </span>
                            : <span className="text-[10px] text-slate-300">—</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          <span className="text-[10px] text-slate-500">{e.stocktake_by_emp?.name ?? '—'}</span>
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          {e.stocktake_at
                            ? <span className="text-[10px] text-slate-500">
                                {formatTimestampDate(e.stocktake_at, true)} {formatTimestampTime(e.stocktake_at)}
                              </span>
                            : <span className="text-[10px] text-slate-300">—</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          {e.stocktake_flagged
                            ? <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-red-600 bg-red-100 rounded-full px-1.5 py-0.5">
                                <Flag className="h-2.5 w-2.5" /> Chênh lệch
                              </span>
                            : checked
                              ? <span className="text-[9px] font-semibold text-green-600 bg-green-100 rounded-full px-1.5 py-0.5">Đã kiểm</span>
                              : <span className="text-[9px] text-slate-400 bg-slate-100 rounded-full px-1.5 py-0.5">Chưa kiểm</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap" onClick={ev => ev.stopPropagation()}>
                          {e.stocktake_flagged && can(perms, 'stocktake', 'complete') && (
                            <Button size="sm" variant="outline"
                              className="h-5 text-[9px] px-1.5 border-red-200 text-red-600 hover:bg-red-50 flex items-center gap-0.5"
                              disabled={unflag.isPending}
                              onClick={() => unflag.mutate(e.id)}
                            >
                              <X className="h-2.5 w-2.5" /> Bỏ cờ
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <PagerNav page={page} totalPages={totalPages} onPage={p => { setStocktakeSummary({ page: p }); setSelectedId(null) }} />
            </div>

            {/* Side detail panel */}
            {selectedId && (
              <DetailPanel entryId={selectedId} onClose={() => setSelectedId(null)} />
            )}
          </>
        )}
      </div>

      {/* Footer đếm bản ghi — chuẩn dùng chung mọi list page */}
      {locationIds.length > 0 && !tooManyLocs ? (
        <ListFooter page={page} pageSize={pageSize} total={totalRows} unit="pallet"
          onPageSize={n => setStocktakeSummary({ pageSize: n, page: 1 })}
          right={`${locationIds.length.toLocaleString('vi-VN')} vị trí`} />
      ) : (
        <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 sm:rounded-b-xl">
          Chọn vị trí để xem tổng hợp
        </div>
      )}
     </div>
    </div>
  )
}
