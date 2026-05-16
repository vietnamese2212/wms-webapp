import { useState, useMemo } from 'react'
import { ClipboardList, Filter, X, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import {
  useOutboundScanLog, useOutboundScanLogFacets, useWarehouses, useMaterialCategories,
} from '@/api/hooks'
import type { ScanLogParams } from '@/api/hooks'
import { formatDate, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const PAGE_SIZE = 500
const MAX_DAYS = 31

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
  const totalMs = shelfDays * 86_400_000
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
  material_category: string
  warehouses: string[]
  group_code: string
  distributor: string
  delivery_code: string
  pallet_code: string
  material: string
  machines: string[]
  cycles: string[]
  scanner_name: string
}

const EMPTY_DRAFT: DraftFilters = {
  from_date: TODAY, to_date: TODAY,
  material_category: '',
  warehouses: [],
  group_code: '', distributor: '', delivery_code: '',
  pallet_code: '', material: '',
  machines: [], cycles: [],
  scanner_name: '',
}

// ─── Page ──────────────────────────────────────────────────────

export default function OutboundScanLog() {
  const [showFilters, setShowFilters] = useState(true)
  const [page, setPage]               = useState(1)
  const [dateError, setDateError]     = useState('')
  const [draft, setDraft]             = useState<DraftFilters>(EMPTY_DRAFT)
  const [applied, setApplied]         = useState<ScanLogParams>({
    from_date: TODAY, to_date: TODAY,
  })

  const { data: warehousesData }  = useWarehouses()
  const { data: categoriesData }  = useMaterialCategories()
  const warehouses  = (warehousesData as { id: string; name: string }[] | undefined) ?? []
  const categories  = categoriesData ?? []

  const { data: facets } = useOutboundScanLogFacets(draft.material_category || undefined)
  const machineOpts = useMemo(() => (facets?.machines ?? []).map(m => ({ value: m, label: m })), [facets])
  const cycleOpts   = useMemo(() => (facets?.cycles   ?? []).map(c => ({ value: c, label: c })), [facets])
  const warehouseOpts = useMemo(() => warehouses.map(w => ({ value: w.id, label: w.name })), [warehouses])

  // Query only fires when material_category is selected
  const canFetch = !!applied.material_category

  const params: ScanLogParams = {
    ...applied,
    page,
    limit: PAGE_SIZE,
  }

  const { data, isLoading, isError } = useOutboundScanLog(params, canFetch)
  const rows       = data?.rows  ?? []
  const total      = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function applyFilters() {
    // Date range validation
    if (draft.from_date && draft.to_date) {
      const diffDays = Math.round(
        (new Date(draft.to_date).getTime() - new Date(draft.from_date).getTime()) / 86_400_000
      )
      if (diffDays < 0) {
        setDateError('Ngày bắt đầu phải trước ngày kết thúc')
        return
      }
      if (diffDays > MAX_DAYS) {
        setDateError(`Khoảng thời gian tối đa ${MAX_DAYS} ngày (khoảng ~${MAX_DAYS * 6_000} bản ghi/loại hàng)`)
        return
      }
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
      material:          draft.material      || undefined,
      machine_codes:     draft.machines.length > 0 ? draft.machines.join(',') : undefined,
      cycles:            draft.cycles.length > 0   ? draft.cycles.join(',')   : undefined,
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

  // Active filter count (excluding dates which are always present)
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
            {/* Row 1: Ngày + Loại hàng (mandatory) */}
            <div className="flex items-center gap-2 flex-wrap">
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

              <span className="text-slate-300 text-xs mx-1">|</span>

              {/* Loại hàng — bắt buộc */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-red-500 font-medium shrink-0">*</span>
                <Select
                  value={draft.material_category || '__none__'}
                  onValueChange={v => setDraft(d => ({ ...d, material_category: v === '__none__' ? '' : v, machines: [], cycles: [] }))}
                >
                  <SelectTrigger className={`h-7 text-xs w-[130px] bg-white ${!draft.material_category ? 'border-red-300' : ''}`}>
                    <SelectValue placeholder="Chọn loại hàng…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__"><span className="text-slate-400 italic">Chọn loại hàng…</span></SelectItem>
                    {categories.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Kho — multi-select */}
              <MultiSelectFilter
                label="Kho"
                options={warehouseOpts}
                selected={draft.warehouses}
                onChange={v => setDraft(d => ({ ...d, warehouses: v }))}
                searchable
              />
            </div>

            {dateError && (
              <p className="text-[10px] text-red-500 font-medium">{dateError}</p>
            )}

            {/* Row 2: Mã pallet / Số xe / NPP / Số DO */}
            <div className="flex gap-2 flex-wrap items-center">
              <Input className="h-7 text-xs w-[120px] bg-white" placeholder="Mã pallet…"
                value={draft.pallet_code} onChange={e => setDraft(d => ({ ...d, pallet_code: e.target.value }))} />
              <Input className="h-7 text-xs w-[110px] bg-white" placeholder="Số xe…"
                value={draft.group_code} onChange={e => setDraft(d => ({ ...d, group_code: e.target.value }))} />
              <Input className="h-7 text-xs w-[130px] bg-white" placeholder="NPP…"
                value={draft.distributor} onChange={e => setDraft(d => ({ ...d, distributor: e.target.value }))} />
              <Input className="h-7 text-xs w-[110px] bg-white" placeholder="Số DO…"
                value={draft.delivery_code} onChange={e => setDraft(d => ({ ...d, delivery_code: e.target.value }))} />
            </div>

            {/* Row 3: Mã hàng / Máy / Chu kỳ / Người quét + actions */}
            <div className="flex gap-2 flex-wrap items-center">
              <Input className="h-7 text-xs w-[160px] bg-white" placeholder="Mã / Tên hàng…"
                value={draft.material} onChange={e => setDraft(d => ({ ...d, material: e.target.value }))} />

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

              <Input className="h-7 text-xs w-[120px] bg-white" placeholder="Người quét…"
                value={draft.scanner_name} onChange={e => setDraft(d => ({ ...d, scanner_name: e.target.value }))} />

              <div className="flex-1" />
              <button
                className="h-7 px-3 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                onClick={applyFilters}
                disabled={!draft.material_category}
                title={!draft.material_category ? 'Vui lòng chọn Loại hàng trước' : ''}
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
            {applied.material_category
              ? <span className="font-medium text-slate-700">{applied.material_category}</span>
              : <span className="text-amber-600 font-medium">Chọn Loại hàng để xem dữ liệu</span>
            }
            {applied.material_category && dateLabel && (
              <span className="ml-2 text-slate-500">· {dateLabel}</span>
            )}
            {!isLoading && canFetch && (
              <span className="ml-2 text-slate-400">· {total.toLocaleString()} bản ghi</span>
            )}
          </p>
          {totalPages > 1 && (
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

      {/* Table area — single overflow-auto container for sticky header + horizontal scroll */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {!canFetch ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Vui lòng chọn <span className="font-semibold text-slate-600">Loại hàng</span> và nhấn <span className="font-semibold text-slate-600">Áp dụng</span> để xem dữ liệu
          </div>
        ) : isLoading ? (
          <TableSkeleton cols={10} rows={12} />
        ) : isError ? (
          <div className="p-6 text-center text-sm text-red-500">Lỗi tải dữ liệu. Vui lòng thử lại.</div>
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
                <TableHead className="min-w-[52px]  text-[9px] text-right">% Date</TableHead>
                <TableHead className="min-w-[70px]  text-[9px]">Vị trí</TableHead>
                <TableHead className="min-w-[50px]  text-[9px]">Máy</TableHead>
                <TableHead className="min-w-[52px]  text-[9px]">Chu kỳ</TableHead>
                <TableHead className="min-w-[58px]  text-[9px]">Ngày nhập</TableHead>
                <TableHead className="min-w-[110px] text-[9px]">Ghi chú</TableHead>
                <TableHead className="min-w-[72px]  text-[9px]">Người quét</TableHead>
                <TableHead className="min-w-[68px]  text-[9px]">TG quét</TableHead>
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
