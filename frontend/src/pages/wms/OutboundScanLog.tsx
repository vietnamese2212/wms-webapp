import { useState, useMemo, useRef } from 'react'
import {
  ClipboardList, Filter, X, CalendarDays, ChevronLeft, ChevronRight, QrCode, AlertTriangle,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import { QRScanner } from '@/components/shared/QRScanner'
import type { QRScannerHandle } from '@/components/shared/QRScanner'
import {
  useOutboundScanLog, useOutboundScanLogFacets, useWarehouses, useMaterialCategories, useMaterials,
} from '@/api/hooks'
import type { ScanLogParams } from '@/api/hooks'
import { formatDate, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { useWmsFilterStore, type ScanLogApplied } from '@/stores/wmsFilterStore'

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const PAGE_SIZE = 500

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

function DateBtn({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <input
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-7 rounded-md border border-blue-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
      placeholder={placeholder}
    />
  )
}

function FmtTs({ ts }: { ts: string | null }) {
  if (!ts) return <span className="text-slate-300">—</span>
  return (
    <span className="tabular-nums">
      <span className="block">{formatTimestampDate(ts, true)}</span>
      <span className="block text-slate-400">{formatTimestampTime(ts, false)}</span>
    </span>
  )
}

// ─── Draft state type ──────────────────────────────────────────

type DraftFilters = {
  from_date: string
  to_date: string
  warehouses: string[]
  material_category: string
  group_code: string
  distributor: string
  delivery_code: string
  pallet_code: string
  materials: string[]
  machines: string[]
  cycles: string[]
  scanner_name: string
}

const EMPTY_DRAFT: DraftFilters = {
  from_date: TODAY, to_date: TODAY,
  warehouses: [],
  material_category: '',
  group_code: '', distributor: '', delivery_code: '',
  pallet_code: '',
  materials: [],
  machines: [], cycles: [],
  scanner_name: '',
}

// ─── Page ──────────────────────────────────────────────────────

export default function OutboundScanLog() {
  const [showFilters, setShowFilters]   = useState(true)
  const [page, setPage]                 = useState(1)
  const [dateError, setDateError]       = useState('')
  const [showScanner, setShowScanner]   = useState(false)
  const scannerRef = useRef<QRScannerHandle>(null)

  const { scanLogDraft: draft, scanLogApplied: applied, setScanLogDraft, setScanLogApplied } = useWmsFilterStore()

  // Aliases so existing call sites need no change
  type DraftUpdater = Partial<DraftFilters> | ((d: DraftFilters) => DraftFilters)
  const setDraft = (f: DraftUpdater) => typeof f === 'function' ? setScanLogDraft(f(draft)) : setScanLogDraft(f)
  const setApplied = (f: ScanLogApplied) => setScanLogApplied(f)

  const { data: warehousesData } = useWarehouses()
  const { data: categoriesData } = useMaterialCategories()
  const warehouses  = (warehousesData as { id: string; name: string }[] | undefined) ?? []
  const categories  = categoriesData ?? []

  const { data: facets } = useOutboundScanLogFacets(draft.material_category || undefined)
  const { data: materialsData } = useMaterials(
    { category: draft.material_category },
    !!draft.material_category,
  )
  const materials = materialsData ?? []

  const warehouseOpts = useMemo(() => warehouses.map(w => ({ value: w.id, label: w.name })), [warehouses])
  const materialOpts  = useMemo(() =>
    materials.map(m => ({
      value: m.id,
      label: `${m.material_code}${m.short_name ? ' – ' + m.short_name : ''}`,
    })), [materials])
  const machineOpts   = useMemo(() => (facets?.machines ?? []).map(m => ({ value: m, label: m })), [facets])
  const cycleOpts     = useMemo(() => (facets?.cycles   ?? []).map(c => ({ value: c, label: c })), [facets])

  const canFetch = !!applied.material_category && !!applied.warehouse_ids

  const params: ScanLogParams = { ...applied, page, limit: PAGE_SIZE }
  const { data, isLoading, isError } = useOutboundScanLog(params, canFetch)
  const rows       = data?.rows  ?? []
  const total      = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const isBlocked = canFetch && !isLoading && total > 200_000

  function applyFilters() {
    if (!draft.warehouses.length) {
      setDateError('Vui lòng chọn ít nhất 1 Kho')
      return
    }
    if (!draft.material_category) {
      setDateError('Vui lòng chọn Loại hàng')
      return
    }
    if (draft.from_date && draft.to_date && new Date(draft.to_date) < new Date(draft.from_date)) {
      setDateError('Ngày bắt đầu phải trước ngày kết thúc')
      return
    }
    setDateError('')
    setApplied({
      from_date:         draft.from_date || undefined,
      to_date:           draft.to_date   || undefined,
      warehouse_ids:     draft.warehouses.length > 0 ? draft.warehouses.join(',') : undefined,
      material_category: draft.material_category || undefined,
      group_code:        draft.group_code    || undefined,
      distributor:       draft.distributor   || undefined,
      delivery_code:     draft.delivery_code || undefined,
      pallet_code:       draft.pallet_code   || undefined,
      material:          draft.materials.length > 0 ? draft.materials.join(',') : undefined,
      machine_codes:     draft.machines.length > 0  ? draft.machines.join(',')  : undefined,
      cycles:            draft.cycles.length > 0    ? draft.cycles.join(',')    : undefined,
      scanner_name:      draft.scanner_name  || undefined,
    })
    setPage(1)
  }

  function clearFilters() {
    setDraft(EMPTY_DRAFT)
    setDateError('')
    setApplied({ from_date: TODAY, to_date: TODAY })
    setPage(1)
  }

  function handlePalletScan(raw: string) {
    setDraft(d => ({ ...d, pallet_code: raw.trim() }))
    setShowScanner(false)
  }

  const activeCount = [
    applied.warehouse_ids,
    applied.material_category,
    applied.group_code,
    applied.distributor,
    applied.delivery_code,
    applied.pallet_code,
    applied.material,
    applied.machine_codes,
    applied.cycles,
    applied.scanner_name,
  ].filter(Boolean).length

  const dateLabel = applied.from_date === applied.to_date
    ? (applied.from_date ? formatDate(applied.from_date) : '')
    : `${applied.from_date ? formatDate(applied.from_date) : '?'} – ${applied.to_date ? formatDate(applied.to_date) : '?'}`

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2">
        {/* Title row */}
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold flex items-center gap-2 shrink-0">
            <ClipboardList className="h-5 w-5 text-slate-500" />
            Lịch sử quét xuất kho
          </h1>
          <div className="flex-1" />
          <button
            className={`flex items-center gap-1 h-8 px-2.5 rounded-md border text-xs font-medium transition-colors shrink-0 ${
              showFilters || activeCount > 0
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
            onClick={() => setShowFilters(v => !v)}
          >
            <Filter className="h-3.5 w-3.5" />
            Lọc
            {activeCount > 0 && (
              <span className="bg-blue-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {activeCount}
              </span>
            )}
          </button>
        </div>

        {/* Collapsible filter panel */}
        {showFilters && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 space-y-2">

            {/* Row 1: Kho (bắt buộc) + Loại hàng (bắt buộc) + Date range */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Kho — multi-select, bắt buộc */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-red-500 font-medium shrink-0">*</span>
                <MultiSelectFilter
                  label="Kho"
                  options={warehouseOpts}
                  selected={draft.warehouses}
                  onChange={v => setDraft(d => ({ ...d, warehouses: v }))}
                  searchable
                />
              </div>

              {/* Loại hàng — single select mandatory */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-red-500 font-medium shrink-0">*</span>
                <MultiSelectFilter
                  label="Loại hàng"
                  options={(categories as string[]).map(c => ({ value: c, label: c }))}
                  selected={draft.material_category ? [draft.material_category] : []}
                  onChange={v => {
                    const cat = v[v.length - 1] ?? ''
                    setDraft(d => ({ ...d, material_category: cat, materials: [], machines: [], cycles: [] }))
                  }}
                  searchable={false}
                />
              </div>

              <span className="text-slate-300 text-xs mx-1">|</span>

              <CalendarDays className="h-3.5 w-3.5 text-blue-400 shrink-0" />
              <DateBtn value={draft.from_date} placeholder="Từ ngày" onChange={v => { setDraft(d => ({ ...d, from_date: v })); setDateError('') }} />
              <span className="text-blue-300 text-xs">–</span>
              <DateBtn value={draft.to_date}   placeholder="Đến ngày" onChange={v => { setDraft(d => ({ ...d, to_date: v })); setDateError('') }} />
              {!(draft.from_date === TODAY && draft.to_date === TODAY) && (
                <button className="text-xs text-blue-500 hover:text-blue-700 underline whitespace-nowrap"
                  onClick={() => setDraft(d => ({ ...d, from_date: TODAY, to_date: TODAY }))}>
                  Hôm nay
                </button>
              )}
            </div>

            {dateError && (
              <p className="text-[10px] text-red-500 font-medium">{dateError}</p>
            )}

            {/* Row 2: Mã pallet (QR) / Số xe / NPP / Số DO */}
            <div className="flex gap-2 flex-wrap items-center">
              {/* Mã pallet with QR scan button */}
              <div className="flex items-center gap-1">
                <input
                  className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400 w-[120px]"
                  placeholder="Mã pallet…"
                  value={draft.pallet_code}
                  onChange={e => setDraft(d => ({ ...d, pallet_code: e.target.value }))}
                />
                <button
                  type="button"
                  className="h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                  title="Quét QR pallet"
                  onClick={() => setShowScanner(true)}
                >
                  <QrCode className="h-3.5 w-3.5 text-slate-500" />
                </button>
              </div>
              <input
                className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400 w-[110px]"
                placeholder="Số xe…"
                value={draft.group_code}
                onChange={e => setDraft(d => ({ ...d, group_code: e.target.value }))}
              />
              <input
                className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400 w-[130px]"
                placeholder="NPP…"
                value={draft.distributor}
                onChange={e => setDraft(d => ({ ...d, distributor: e.target.value }))}
              />
              <input
                className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400 w-[110px]"
                placeholder="Số DO…"
                value={draft.delivery_code}
                onChange={e => setDraft(d => ({ ...d, delivery_code: e.target.value }))}
              />
            </div>

            {/* Row 3: Mã hàng / Máy / Chu kỳ / Người quét + Actions */}
            <div className="flex gap-2 flex-wrap items-center">
              <MultiSelectFilter
                label="Mã / Tên hàng"
                options={materialOpts}
                selected={draft.materials}
                onChange={v => setDraft(d => ({ ...d, materials: v }))}
                searchable
              />
              <MultiSelectFilter
                label="Máy"
                options={machineOpts}
                selected={draft.machines}
                onChange={v => setDraft(d => ({ ...d, machines: v }))}
                searchable={machineOpts.length > 6}
              />
              <MultiSelectFilter
                label="Chu kỳ"
                options={cycleOpts}
                selected={draft.cycles}
                onChange={v => setDraft(d => ({ ...d, cycles: v }))}
                searchable={false}
              />
              <input
                className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400 w-[120px]"
                placeholder="Người quét…"
                value={draft.scanner_name}
                onChange={e => setDraft(d => ({ ...d, scanner_name: e.target.value }))}
              />

              <div className="flex-1" />
              <button
                className="h-7 px-3 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                onClick={applyFilters}
                disabled={!draft.material_category || !draft.warehouses.length}
                title={(!draft.warehouses.length || !draft.material_category) ? 'Vui lòng chọn Kho và Loại hàng' : ''}
              >
                Áp dụng
              </button>
              <button
                className="h-7 px-2 rounded-md border border-slate-200 bg-white text-xs text-slate-500 hover:bg-slate-50 transition-colors"
                onClick={clearFilters}
              >
                Đặt lại
              </button>
            </div>
          </div>
        )}

        {/* Summary bar */}
        <div className="flex items-center gap-3 -mt-0.5">
          <p className="text-xs text-slate-500 flex-1">
            {(!applied.material_category || !applied.warehouse_ids)
              ? <span className="text-amber-600 font-medium">Chọn Kho và Loại hàng để xem dữ liệu</span>
              : <>
                  <span className="font-medium text-slate-700">{applied.material_category}</span>
                  {dateLabel && <span className="ml-2 text-slate-500">· {dateLabel}</span>}
                  {!isLoading && (
                    <span className="ml-2 text-slate-400">· {total.toLocaleString()} bản ghi</span>
                  )}
                </>
            }
          </p>
          {!isBlocked && totalPages > 1 && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
                disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs text-slate-600 px-1">{page} / {totalPages}</span>
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
            <span className="font-semibold text-slate-600">Loại hàng</span>, rồi nhấn{' '}
            <span className="font-semibold text-slate-600">Áp dụng</span> để xem dữ liệu
          </div>
        ) : isLoading ? (
          <TableSkeleton cols={10} rows={12} />
        ) : isError ? (
          <div className="p-6 text-center text-sm text-red-500">Lỗi tải dữ liệu. Vui lòng thử lại.</div>
        ) : isBlocked ? (
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="h-10 w-10 text-red-400" />
            <p className="text-sm font-semibold text-red-600">
              Kết quả quá lớn: {total.toLocaleString()} bản ghi
            </p>
            <p className="text-xs text-slate-500 max-w-sm">
              Vượt ngưỡng cho phép 200,000 bản ghi. Vui lòng thu hẹp khoảng thời gian hoặc thêm bộ lọc (Kho, Mã hàng, Máy, Chu kỳ…) rồi nhấn <span className="font-semibold">Áp dụng</span> lại.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="Không có dữ liệu scan trong khoảng thời gian này" />
        ) : (
          <Table className="min-w-[2800px]">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[58px]  text-[9px]">Ngày xuất</TableHead>
                <TableHead className="min-w-[72px]  text-[9px]">Kho</TableHead>
                <TableHead className="min-w-[70px]  text-[9px]">Loại hàng</TableHead>
                <TableHead className="min-w-[90px]  text-[9px]">Số xe</TableHead>
                <TableHead className="min-w-[110px] text-[9px]">NPP</TableHead>
                <TableHead className="min-w-[80px]  text-[9px]">Số DO</TableHead>
                <TableHead className="min-w-[100px] text-[9px]">Mã pallet</TableHead>
                <TableHead className="min-w-[70px]  text-[9px]">Mã hàng</TableHead>
                <TableHead className="min-w-[130px] text-[9px]">Tên hàng</TableHead>
                <TableHead className="min-w-[50px]  text-[9px] text-right">Thùng</TableHead>
                <TableHead className="min-w-[58px]  text-[9px]">NSX</TableHead>
                <TableHead className="min-w-[58px]  text-[9px]">HSD</TableHead>
                <TableHead className="min-w-[58px]  text-[9px]">Date cũ nhất</TableHead>
                <TableHead className="min-w-[52px]  text-[9px] text-right">% Date</TableHead>
                <TableHead className="min-w-[70px]  text-[9px]">Vị trí</TableHead>
                <TableHead className="min-w-[50px]  text-[9px]">Máy</TableHead>
                <TableHead className="min-w-[52px]  text-[9px]">Chu kỳ</TableHead>
                <TableHead className="min-w-[58px]  text-[9px]">Ngày nhập</TableHead>
                <TableHead className="min-w-[110px] text-[9px]">Ghi chú</TableHead>
                <TableHead className="min-w-[72px]  text-[9px]">Người quét</TableHead>
                <TableHead className="min-w-[68px]  text-[9px]">TG quét</TableHead>
                <TableHead className="min-w-[68px]  text-[9px]">TG check NL</TableHead>
                <TableHead className="min-w-[72px]  text-[9px]">Người check NL</TableHead>
                <TableHead className="min-w-[72px]  text-[9px]">Biển số</TableHead>
                <TableHead className="min-w-[72px]  text-[9px]">Số cont</TableHead>
                <TableHead className="min-w-[80px]  text-[9px]">Lái xe nâng</TableHead>
                <TableHead className="min-w-[72px]  text-[9px]">Bốc xếp</TableHead>
                <TableHead className="min-w-[62px]  text-[9px]">TG giao đơn</TableHead>
                <TableHead className="min-w-[62px]  text-[9px]">TG bắt đầu</TableHead>
                <TableHead className="min-w-[62px]  text-[9px]">TG quét xong</TableHead>
                <TableHead className="min-w-[62px]  text-[9px]">TG hoàn thành</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => {
                const expiryDate = calcExpiryDate(row.production_date, row.shelf_life_days)
                const pct        = calcPctAtScan(row.production_date, row.shelf_life_days, row.scanned_at)
                return (
                  <TableRow key={row.id}>
                    <TableCell className="px-2 py-1 text-[10px]">
                      {row.delivery_date ? formatDate(row.delivery_date) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">{row.warehouse_name}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">{row.material_category ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold">{row.group_code}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">{row.distributor_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono">{row.delivery_code ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold">{row.pallet_code}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono">
                      {row.material_code ?? row.material_code_raw ?? <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">{row.material_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-semibold tabular-nums text-right">
                      {row.cartons_scanned}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">
                      {row.production_date ? formatDate(row.production_date) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">
                      {expiryDate ? formatDate(expiryDate) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">
                      {row.best_available_date ? formatDate(row.best_available_date) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-right">
                      {pct !== null
                        ? <span className={datePctCls(pct)}>{pct}%</span>
                        : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono">{row.location_code ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">{row.machine_code ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">{row.cycle ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">
                      {row.import_date ? formatTimestampDate(row.import_date, true) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] max-w-[110px] truncate" title={row.header_text ?? ''}>
                      {row.header_text ?? <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">{row.scanner_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px]"><FmtTs ts={row.scanned_at} /></TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">
                      {row.is_loose_picking ? <FmtTs ts={row.loose_confirmed_at} /> : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">
                      {row.is_loose_picking ? (row.loose_confirmed_by_name ?? <span className="text-slate-300">—</span>) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">{row.license_plate ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono">{row.container_number ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">{row.forklift_driver_names ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">{row.loader_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px]"><FmtTs ts={row.assigned_at} /></TableCell>
                    <TableCell className="px-2 py-1 text-[10px]"><FmtTs ts={row.started_at} /></TableCell>
                    <TableCell className="px-2 py-1 text-[10px]"><FmtTs ts={row.last_scanned_at} /></TableCell>
                    <TableCell className="px-2 py-1 text-[10px]"><FmtTs ts={row.completed_at} /></TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
