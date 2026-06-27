import { useState, useMemo, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import {
  ClipboardList, ChevronLeft, ChevronRight, QrCode, AlertTriangle, Download,
} from 'lucide-react'
import type { AxiosError } from 'axios'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SavedViews } from '@/components/shared/SavedViews'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { QRScanner } from '@/components/shared/QRScanner'
import type { QRScannerHandle } from '@/components/shared/QRScanner'
import {
  useOutboundScanLog, useOutboundScanLogFacets, useWarehouses, useWarehouseTypes, useMaterials,
  fetchScanLogExport,
} from '@/api/hooks'
import type { ScanLogParams } from '@/api/hooks'
import { formatDate, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { useWmsFilterStore, type ScanLogFilters } from '@/stores/wmsFilterStore'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { useAuthStore } from '@/stores/authStore'

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const PAGE_SIZE = 500
const EXPORT_MAX = 50_000  // chặn export nếu vượt — yêu cầu lọc hẹp lại (tránh treo trình duyệt)

// Cột bảng — thứ tự PHẢI khớp các <TableCell> mỗi dòng (31 cột). Cột 0 (Ngày xuất) sticky-left.
const SCANLOG_COLS: { id: string; label: string; align?: 'right' }[] = [
  { id: 'delivery_date', label: 'Ngày xuất' },
  { id: 'warehouse',     label: 'Kho' },
  { id: 'category',      label: 'Loại hàng' },
  { id: 'group_code',    label: 'Số xe' },
  { id: 'distributor',   label: 'NPP' },
  { id: 'delivery_code', label: 'Số DO' },
  { id: 'pallet_code',   label: 'Mã pallet' },
  { id: 'material_code', label: 'Mã hàng' },
  { id: 'material_name', label: 'Tên hàng' },
  { id: 'cartons',       label: 'Thùng', align: 'right' },
  { id: 'nsx',           label: 'NSX' },
  { id: 'hsd',           label: 'HSD' },
  { id: 'best_date',     label: 'Date cũ nhất' },
  { id: 'pct',           label: '% Date', align: 'right' },
  { id: 'location',      label: 'Vị trí' },
  { id: 'machine',       label: 'Máy' },
  { id: 'cycle',         label: 'Chu kỳ' },
  { id: 'import_date',   label: 'Ngày nhập' },
  { id: 'header_text',   label: 'Ghi chú' },
  { id: 'scanner',       label: 'Người quét' },
  { id: 'scanned_at',    label: 'TG quét' },
  { id: 'loose_at',      label: 'TG check NL' },
  { id: 'loose_by',      label: 'Người check NL' },
  { id: 'license_plate', label: 'Biển số' },
  { id: 'container',     label: 'Số cont' },
  { id: 'forklift',      label: 'Lái xe nâng' },
  { id: 'loader',        label: 'Bốc xếp' },
  { id: 'assigned_at',   label: 'TG giao đơn' },
  { id: 'started_at',    label: 'TG bắt đầu' },
  { id: 'last_scan',     label: 'TG quét xong' },
  { id: 'completed_at',  label: 'TG hoàn thành' },
]
const SCANLOG_COL_DEFAULTS = [
  72, 72, 70, 90, 110, 80, 100, 70, 130, 50, 58, 58, 58, 52, 70, 50, 52, 58, 110, 80,
  120, 120, 90, 80, 90, 90, 80, 120, 120, 120, 120,
]

// ─── Helpers ──────────────────────────────────────────────────

function calcExpiryDate(prodDate: string | null, shelfDays: number | null): string | null {
  if (!prodDate || !shelfDays || shelfDays <= 0) return null
  const prod = new Date(prodDate)
  if (isNaN(prod.getTime())) return null
  return new Date(prod.getTime() + shelfDays * 86_400_000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
}

function calcPctAtScan(prodDate: string | null, shelfDays: number | null, scannedAt: string): number | null {
  if (!prodDate || !shelfDays || shelfDays <= 0) return null
  const prod = new Date(prodDate)
  const scan = new Date(scannedAt)
  if (isNaN(prod.getTime()) || isNaN(scan.getTime())) return null
  const totalMs  = shelfDays * 86_400_000
  const remaining = prod.getTime() + totalMs - scan.getTime()
  return Math.max(0, Math.round((remaining / totalMs) * 100))
}

function datePctCls(pct: number): string {
  if (pct >= 70) return 'text-green-600 font-semibold'
  if (pct >= 40) return 'text-amber-600 font-semibold'
  return 'text-red-600 font-semibold'
}

function FmtTs({ ts }: { ts: string | null }) {
  if (!ts) return <span className="text-slate-300">—</span>
  return (
    <span className="tabular-nums whitespace-nowrap">
      {formatTimestampDate(ts, true)} {formatTimestampTime(ts)}
    </span>
  )
}

// Build query params (comma-join arrays) từ state filter
function buildParams(f: ScanLogFilters): ScanLogParams {
  return {
    from_date:         f.from_date || undefined,
    to_date:           f.to_date   || undefined,
    warehouse_ids:     f.warehouses.length > 0 ? f.warehouses.join(',') : undefined,
    material_category: f.material_category || undefined,
    group_code:        f.group_code    || undefined,
    distributor:       f.distributor   || undefined,
    delivery_code:     f.delivery_code || undefined,
    pallet_code:       f.pallet_code   || undefined,
    material:          f.materials.length > 0 ? f.materials.join(',') : undefined,
    machine_codes:     f.machines.length > 0  ? f.machines.join(',')  : undefined,
    cycles:            f.cycles.length > 0    ? f.cycles.join(',')    : undefined,
    scanner_name:      f.scanner_name  || undefined,
  }
}

// ─── Page ──────────────────────────────────────────────────────

export default function OutboundScanLog() {
  const [page, setPage]                 = useState(1)
  const [showScanner, setShowScanner]   = useState(false)
  const [exporting, setExporting]       = useState(false)
  const [exportError, setExportError]   = useState('')
  const scannerRef = useRef<QRScannerHandle>(null)
  const { widths: colW, startResize, totalWidth } = useColumnResize('scanlog_col_widths', SCANLOG_COL_DEFAULTS)

  const user = useAuthStore(s => s.user)
  const filters    = useWmsFilterStore(s => s.scanLog)
  const setScanLog = useWmsFilterStore(s => s.setScanLog)

  const { data: warehousesData } = useWarehouses()
  const { data: whTypesData    } = useWarehouseTypes()
  const warehouses  = (warehousesData as { id: string; name: string }[] | undefined) ?? []
  const categories  = (whTypesData ?? []).map(t => t.value)

  const { data: facets } = useOutboundScanLogFacets(filters.material_category || undefined)
  const { data: materialsData } = useMaterials(
    { category: filters.material_category },
    !!filters.material_category,
  )
  const materials = materialsData ?? []

  // Kho mặc định cho user theo phạm vi (non-NATIONAL) — chỉ set 1 lần khi trống
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (filters.warehouses.length === 0 && user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length) {
      setScanLog({ warehouses: user.warehouse_ids })
    }
  }, [user?.warehouse_id]) // eslint-disable-line

  const warehouseOpts = useMemo(() => {
    const allowed = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
      ? new Set(user.warehouse_ids)
      : null
    return warehouses
      .filter(w => !allowed || allowed.has(w.id))
      .map(w => ({ value: w.id, label: w.name }))
  }, [warehouses, user?.warehouse_ids, user?.warehouse_scope]) // eslint-disable-line

  const categoryOpts = useMemo(() =>
    (categories as string[]).map(c => ({ value: c, label: c }))
  , [categories])
  const materialOpts  = useMemo(() =>
    materials.map(m => ({
      value: m.id,
      label: `${m.material_code}${m.short_name ? ' – ' + m.short_name : ''}`,
    })), [materials])
  const machineOpts   = useMemo(() => (facets?.machines ?? []).map(m => ({ value: m, label: m })), [facets])
  const cycleOpts     = useMemo(() => (facets?.cycles   ?? []).map(c => ({ value: c, label: c })), [facets])

  // ─── Filter chip bar (đồng nhất Manhattan FilterBar) ───
  const filterDefs: FilterDef[] = [
    { key: 'date',         label: 'Ngày',        type: 'daterange', from: filters.from_date, to: filters.to_date,
      onChange: (from, to) => setScanLog({ from_date: from, to_date: to }) },
    { key: 'warehouse',    label: 'Kho',         type: 'multi', options: warehouseOpts, selected: filters.warehouses, searchable: true,
      onChange: v => setScanLog({ warehouses: v }) },
    { key: 'category',     label: 'Loại hàng',   type: 'single', options: categoryOpts, value: filters.material_category, allLabel: 'Tất cả loại',
      onChange: v => setScanLog({ material_category: v, materials: [], machines: [], cycles: [] }) },
    { key: 'material',     label: 'Mã / Tên hàng', type: 'multi', options: materialOpts, selected: filters.materials, searchable: true,
      onChange: v => setScanLog({ materials: v }) },
    { key: 'machine',      label: 'Máy',         type: 'multi', options: machineOpts, selected: filters.machines, searchable: machineOpts.length > 6,
      onChange: v => setScanLog({ machines: v }) },
    { key: 'cycle',        label: 'Chu kỳ',      type: 'multi', options: cycleOpts, selected: filters.cycles, searchable: false,
      onChange: v => setScanLog({ cycles: v }) },
    { key: 'group_code',   label: 'Số xe',       type: 'text', value: filters.group_code, placeholder: 'Số xe…',
      onChange: v => setScanLog({ group_code: v }) },
    { key: 'distributor',  label: 'NPP',         type: 'text', value: filters.distributor, placeholder: 'NPP…',
      onChange: v => setScanLog({ distributor: v }) },
    { key: 'delivery_code', label: 'Số DO',      type: 'text', value: filters.delivery_code, placeholder: 'Số DO…',
      onChange: v => setScanLog({ delivery_code: v }) },
    { key: 'pallet_code',  label: 'Mã pallet',   type: 'text', value: filters.pallet_code, placeholder: 'Mã pallet…',
      onChange: v => setScanLog({ pallet_code: v }) },
    { key: 'scanner_name', label: 'Người quét',  type: 'text', value: filters.scanner_name, placeholder: 'Người quét…',
      onChange: v => setScanLog({ scanner_name: v }) },
  ]

  // SavedViews — snapshot literal (assignable Record) để lưu/khớp
  const viewSnapshot = {
    from_date: filters.from_date, to_date: filters.to_date, warehouses: filters.warehouses,
    material_category: filters.material_category, group_code: filters.group_code,
    distributor: filters.distributor, delivery_code: filters.delivery_code, pallet_code: filters.pallet_code,
    materials: filters.materials, machines: filters.machines, cycles: filters.cycles, scanner_name: filters.scanner_name,
  }
  const savedViews = useSavedViewsStore(s => s.views['scanlog'] ?? [])
  const activeViewId = useMemo(() =>
    savedViews.find(v => JSON.stringify(v.filters) === JSON.stringify(viewSnapshot))?.id ?? null
  , [savedViews, viewSnapshot])

  const canFetch = filters.warehouses.length > 0 && !!filters.material_category

  const params: ScanLogParams = useMemo(() => ({ ...buildParams(filters), page, limit: PAGE_SIZE }), [filters, page])
  const { data, isLoading, isError } = useOutboundScanLog(params, canFetch)
  const rows       = data?.rows  ?? []
  const total      = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const isBlocked = canFetch && !isLoading && total > 200_000

  // Đổi filter → về trang 1
  const paramsKey = JSON.stringify(buildParams(filters))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1) }, [paramsKey])

  function applyView(f: Record<string, unknown>) {
    setScanLog({ ...(f as Partial<ScanLogFilters>) })
  }

  function handlePalletScan(raw: string) {
    setScanLog({ pallet_code: raw.trim() })
    setShowScanner(false)
  }

  async function handleExport() {
    setExportError('')
    if (!canFetch) { setExportError('Chọn Kho và Loại hàng trước khi xuất'); return }
    if (total === 0) { setExportError('Không có dữ liệu để xuất'); return }
    if (total > EXPORT_MAX) { setExportError(`Quá nhiều dòng (${total.toLocaleString('vi-VN')}). Hãy lọc hẹp lại rồi xuất.`); return }
    setExporting(true)
    try {
      const all = await fetchScanLogExport(buildParams(filters))
      const fmtTs = (ts: string | null) => ts ? `${formatTimestampDate(ts, true)} ${formatTimestampTime(ts)}` : ''
      const sheet = all.map(row => {
        const expiry = calcExpiryDate(row.production_date, row.shelf_life_days)
        const pct    = calcPctAtScan(row.production_date, row.shelf_life_days, row.scanned_at)
        return {
          'Ngày xuất': row.delivery_date ? formatDate(row.delivery_date) : '',
          'Kho': row.warehouse_name ?? '', 'Loại hàng': row.material_category ?? '',
          'Số xe': row.group_code ?? '', 'NPP': row.distributor_name ?? '', 'Số DO': row.delivery_code ?? '',
          'Mã pallet': row.pallet_code ?? '', 'Mã hàng': row.material_code ?? row.material_code_raw ?? '',
          'Tên hàng': row.material_name ?? '', 'Thùng': row.cartons_scanned,
          'NSX': row.production_date ? formatDate(row.production_date) : '',
          'HSD': expiry ? formatDate(expiry) : '',
          'Date cũ nhất': row.best_available_date ? formatDate(row.best_available_date) : '',
          '% Date': pct ?? '', 'Vị trí': row.location_code ?? '', 'Máy': row.machine_code ?? '',
          'Chu kỳ': row.cycle ?? '', 'Ngày nhập': row.import_date ? formatTimestampDate(row.import_date, true) : '',
          'Ghi chú': row.header_text ?? '', 'Người quét': row.scanner_name ?? '',
          'TG quét': fmtTs(row.scanned_at),
          'TG check NL': row.is_loose_picking ? fmtTs(row.loose_confirmed_at) : '',
          'Người check NL': row.is_loose_picking ? (row.loose_confirmed_by_name ?? '') : '',
          'Biển số': row.license_plate ?? '', 'Số cont': row.container_number ?? '',
          'Lái xe nâng': row.forklift_driver_names ?? '', 'Bốc xếp': row.loader_name ?? '',
          'TG giao đơn': fmtTs(row.assigned_at), 'TG bắt đầu': fmtTs(row.started_at),
          'TG quét xong': fmtTs(row.last_scanned_at), 'TG hoàn thành': fmtTs(row.completed_at),
        }
      })
      const ws = XLSX.utils.json_to_sheet(sheet)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Lịch sử quét')
      XLSX.writeFile(wb, `lich_su_quet_${filters.material_category}_${TODAY}.xlsx`)
    } catch (e) {
      const err = e as AxiosError<{ error?: { message?: string } }>
      setExportError(err?.response?.data?.error?.message ?? 'Xuất Excel lỗi')
    } finally {
      setExporting(false)
    }
  }

  const activeCount = filterDefs.filter(d =>
    d.type === 'multi' ? d.selected.length > 0
    : d.type === 'single' ? d.value !== ''
    : d.type === 'daterange' ? (!!d.from || !!d.to)
    : d.type === 'text' ? d.value.trim() !== ''
    : false
  ).length

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Header */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2 sm:rounded-t-xl">
        {/* Row 1: Title + actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 shrink-0">
            <ClipboardList className="h-4 w-4 text-slate-500" />
            Lịch sử quét xuất kho
          </span>
          <div className="flex-1" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          <button
            type="button"
            onClick={() => setShowScanner(true)}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 transition-colors shrink-0"
            title="Quét QR lọc theo mã pallet"
          >
            <QrCode className="h-3.5 w-3.5 text-slate-500" />
          </button>
          <SavedViews
            module="scanlog"
            currentFilters={viewSnapshot}
            onApply={applyView}
            activeId={activeViewId}
          />
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || !canFetch}
            className="hidden sm:inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors shrink-0 disabled:opacity-50"
            title="Xuất Excel kết quả đang lọc"
          >
            <Download className="h-3.5 w-3.5" />{exporting ? 'Đang xuất…' : 'Excel'}
          </button>
        </div>

        {/* Row 2: FilterBar (chip) */}
        <FilterBar defs={filterDefs} />

        {exportError && <p className="text-[11px] text-red-500 font-medium">{exportError}</p>}
      </div>

      {/* Summary band (Manhattan) */}
      <SummaryBand tiles={[
        { label: 'Bản ghi', value: canFetch && !isLoading ? total.toLocaleString('vi-VN') : '—' },
        { label: 'Loại hàng', value: filters.material_category || '—' },
        { label: 'Bộ lọc', value: activeCount, accent: activeCount > 0 },
        { label: 'Trang', value: `${page}/${totalPages}` },
      ]} />

      {/* QR Scanner Dialog */}
      <Dialog open={showScanner} onOpenChange={open => { if (!open) setShowScanner(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <QrCode className="h-4 w-4" /> Quét QR mã pallet
            </DialogTitle>
          </DialogHeader>
          {showScanner && (
            <QRScanner
              ref={scannerRef}
              onScan={handlePalletScan}
              onClose={() => setShowScanner(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Table area — single overflow-auto container for sticky header + horizontal scroll */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {!canFetch ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Vui lòng chọn <span className="font-semibold text-slate-600">Kho</span> và{' '}
            <span className="font-semibold text-slate-600">Loại hàng</span> ở thanh lọc để xem dữ liệu
          </div>
        ) : isLoading ? (
          <TableSkeleton cols={12} rows={12} />
        ) : isError ? (
          <div className="p-6 text-center text-sm text-red-500">Lỗi tải dữ liệu. Vui lòng thử lại.</div>
        ) : isBlocked ? (
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="h-10 w-10 text-red-400" />
            <p className="text-sm font-semibold text-red-600">
              Kết quả quá lớn: {total.toLocaleString()} bản ghi
            </p>
            <p className="text-xs text-slate-500 max-w-sm">
              Vượt ngưỡng cho phép 200,000 bản ghi. Vui lòng thu hẹp khoảng thời gian hoặc thêm bộ lọc (Kho, Mã hàng, Máy, Chu kỳ…).
            </p>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="Không có dữ liệu scan trong khoảng thời gian này" />
        ) : (
          <Table className="table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100" style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>
              {colW.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <TableHeader>
              <TableRow>
                {SCANLOG_COLS.map((c, i) => (
                  <TableHead key={c.id}
                    className={`text-[9px] font-medium text-slate-500 py-1.5 px-2 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                    {c.label}
                    {i > 0 && (
                      <span
                        onPointerDown={e => startResize(i, e)}
                        onClick={e => e.stopPropagation()}
                        className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70"
                        title="Kéo để chỉnh độ rộng cột"
                      />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => {
                const expiryDate = calcExpiryDate(row.production_date, row.shelf_life_days)
                const pct        = calcPctAtScan(row.production_date, row.shelf_life_days, row.scanned_at)
                return (
                  <TableRow key={row.id}>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap sticky left-0 z-10 bg-white">
                      {row.delivery_date ? formatDate(row.delivery_date) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{row.warehouse_name}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{row.material_category ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{row.group_code}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{row.distributor_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">{row.delivery_code ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{row.pallet_code}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">
                      {row.material_code ?? row.material_code_raw ?? <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{row.material_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-semibold tabular-nums text-right whitespace-nowrap">
                      {row.cartons_scanned}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      {row.production_date ? formatDate(row.production_date) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      {expiryDate ? formatDate(expiryDate) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      {row.best_available_date ? formatDate(row.best_available_date) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-right whitespace-nowrap">
                      {pct !== null
                        ? <span className={datePctCls(pct)}>{pct}%</span>
                        : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">{row.location_code ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{row.machine_code ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{row.cycle ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      {row.import_date ? formatTimestampDate(row.import_date, true) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      {row.header_text ?? <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{row.scanner_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap"><FmtTs ts={row.scanned_at} /></TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      {row.is_loose_picking ? <FmtTs ts={row.loose_confirmed_at} /> : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      {row.is_loose_picking ? (row.loose_confirmed_by_name ?? <span className="text-slate-300">—</span>) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{row.license_plate ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">{row.container_number ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{row.forklift_driver_names ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{row.loader_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap"><FmtTs ts={row.assigned_at} /></TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap"><FmtTs ts={row.started_at} /></TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap"><FmtTs ts={row.last_scanned_at} /></TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap"><FmtTs ts={row.completed_at} /></TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Footer đếm bản ghi + phân trang */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 flex items-center gap-3 text-[11px] text-slate-500 sm:rounded-b-xl">
        <span className="flex-1">
          {canFetch && !isLoading && !isBlocked
            ? `${total > 0 ? (page - 1) * PAGE_SIZE + 1 : 0}–${Math.min(page * PAGE_SIZE, total)} / ${total.toLocaleString('vi-VN')} bản ghi`
            : 'Chọn Kho và Loại hàng để xem dữ liệu'}
        </span>
        {!isBlocked && totalPages > 1 && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
              disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-1">{page} / {totalPages}</span>
            <button
              className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
              disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
     </div>
    </div>
  )
}
