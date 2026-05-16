import { useState } from 'react'
import { ClipboardList, Filter, X, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { useOutboundScanLog, useWarehouses } from '@/api/hooks'
import type { ScanLogParams } from '@/api/hooks'
import { formatDate, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const PAGE_SIZE = 200

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

function FmtTs({ ts, short }: { ts: string | null; short?: boolean }) {
  if (!ts) return <span className="text-slate-300">—</span>
  return (
    <span className="tabular-nums">
      <span className="block">{formatTimestampDate(ts, short ?? true)}</span>
      <span className="block text-slate-400">{formatTimestampTime(ts, false)}</span>
    </span>
  )
}

export default function OutboundScanLog() {
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState<ScanLogParams>({
    from_date: TODAY,
    to_date: TODAY,
    warehouse_id: '',
    group_code: '',
    distributor: '',
    delivery_code: '',
    material: '',
    scanner_name: '',
  })
  // applied = what was actually sent to server (only changes when user clicks Áp dụng or clears)
  const [applied, setApplied] = useState<ScanLogParams>({
    from_date: TODAY,
    to_date: TODAY,
  })

  const { data: warehousesData } = useWarehouses()
  const warehouses = (warehousesData as { id: string; name: string }[] | undefined) ?? []

  const params: ScanLogParams = {
    ...applied,
    warehouse_id:  applied.warehouse_id  || undefined,
    group_code:    applied.group_code    || undefined,
    distributor:   applied.distributor   || undefined,
    delivery_code: applied.delivery_code || undefined,
    material:      applied.material      || undefined,
    scanner_name:  applied.scanner_name  || undefined,
    page,
    limit: PAGE_SIZE,
  }

  const { data, isLoading, isError } = useOutboundScanLog(params)
  const rows  = data?.rows  ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function applyFilters() {
    setApplied({ ...draft })
    setPage(1)
  }

  function clearFilters() {
    const reset: ScanLogParams = { from_date: TODAY, to_date: TODAY }
    setDraft(reset)
    setApplied(reset)
    setPage(1)
  }

  const activeFilterCount = [
    applied.warehouse_id,
    applied.group_code,
    applied.distributor,
    applied.delivery_code,
    applied.material,
    applied.scanner_name,
    applied.from_date !== TODAY || applied.to_date !== TODAY ? 'date' : '',
  ].filter(Boolean).length

  const isToday = applied.from_date === TODAY && applied.to_date === TODAY
  const hasDate = !!(applied.from_date || applied.to_date)
  const dateLabel = applied.from_date === applied.to_date
    ? applied.from_date ? formatDate(applied.from_date) : ''
    : `${applied.from_date ? formatDate(applied.from_date) : '?'} – ${applied.to_date ? formatDate(applied.to_date) : '?'}`

  const hasDraftClientFilters = !!(
    draft.warehouse_id || draft.group_code || draft.distributor ||
    draft.delivery_code || draft.material || draft.scanner_name
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2">
        {/* Row 1: title + filter toggle */}
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold flex items-center gap-2 shrink-0">
            <ClipboardList className="h-5 w-5 text-slate-500" />
            Lịch sử quét xuất kho
          </h1>
          <div className="flex-1" />
          <button
            className={`flex items-center gap-1 h-8 px-2.5 rounded-md border text-xs font-medium transition-colors shrink-0 ${
              showFilters || activeFilterCount > 0
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
            onClick={() => setShowFilters(v => !v)}
          >
            <Filter className="h-3.5 w-3.5" />
            Lọc
            {activeFilterCount > 0 && (
              <span className="bg-blue-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Collapsible filter panel */}
        {showFilters && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 space-y-2">
            {/* Hàng 1: Ngày xuất */}
            <div className="flex items-center gap-2 flex-wrap">
              <CalendarDays className="h-3.5 w-3.5 text-blue-400 shrink-0" />
              <DateBtn value={draft.from_date ?? ''} placeholder="Từ ngày" onChange={v => setDraft(d => ({ ...d, from_date: v }))} />
              <span className="text-blue-300 text-xs">–</span>
              <DateBtn value={draft.to_date ?? ''} placeholder="Đến ngày" onChange={v => setDraft(d => ({ ...d, to_date: v }))} />
              {!(draft.from_date === TODAY && draft.to_date === TODAY) && (
                <button className="text-xs text-blue-500 hover:text-blue-700 underline whitespace-nowrap"
                  onClick={() => setDraft(d => ({ ...d, from_date: TODAY, to_date: TODAY }))}>
                  Hôm nay
                </button>
              )}
              {(draft.from_date || draft.to_date) && (
                <button className="p-0.5 rounded hover:bg-blue-100 text-blue-300 hover:text-blue-500"
                  onClick={() => setDraft(d => ({ ...d, from_date: '', to_date: '' }))}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Hàng 2: Kho / Số xe / NPP / Số DO */}
            <div className="flex gap-2 flex-wrap items-center">
              <Select
                value={draft.warehouse_id || '__all__'}
                onValueChange={v => setDraft(d => ({ ...d, warehouse_id: v === '__all__' ? '' : v }))}
              >
                <SelectTrigger className="h-7 text-xs w-[110px] bg-white">
                  <SelectValue placeholder="Tất cả kho" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Tất cả kho</SelectItem>
                  {warehouses.map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                className="h-7 text-xs w-[110px] bg-white"
                placeholder="Số xe…"
                value={draft.group_code ?? ''}
                onChange={e => setDraft(d => ({ ...d, group_code: e.target.value }))}
              />
              <Input
                className="h-7 text-xs w-[130px] bg-white"
                placeholder="NPP…"
                value={draft.distributor ?? ''}
                onChange={e => setDraft(d => ({ ...d, distributor: e.target.value }))}
              />
              <Input
                className="h-7 text-xs w-[110px] bg-white"
                placeholder="Số DO…"
                value={draft.delivery_code ?? ''}
                onChange={e => setDraft(d => ({ ...d, delivery_code: e.target.value }))}
              />
            </div>

            {/* Hàng 3: Mã/Tên hàng / Người quét / actions */}
            <div className="flex gap-2 flex-wrap items-center">
              <Input
                className="h-7 text-xs w-[160px] bg-white"
                placeholder="Mã / Tên hàng…"
                value={draft.material ?? ''}
                onChange={e => setDraft(d => ({ ...d, material: e.target.value }))}
              />
              <Input
                className="h-7 text-xs w-[130px] bg-white"
                placeholder="Người quét…"
                value={draft.scanner_name ?? ''}
                onChange={e => setDraft(d => ({ ...d, scanner_name: e.target.value }))}
              />
              {hasDraftClientFilters && (
                <button className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-600 px-1"
                  onClick={() => setDraft(d => ({ ...d, warehouse_id: '', group_code: '', distributor: '', delivery_code: '', material: '', scanner_name: '' }))}>
                  <X className="h-3 w-3" /> Xóa lọc
                </button>
              )}
              <div className="flex-1" />
              <button
                className="h-7 px-3 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
                onClick={applyFilters}
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
            {hasDate ? (
              <>
                <span className="font-medium text-slate-700">{dateLabel}</span>
                {isToday && <span className="ml-1.5 text-blue-600 font-medium">· Hôm nay</span>}
              </>
            ) : (
              <span className="italic">Tất cả ngày</span>
            )}
            {!isLoading && (
              <span className="ml-2 text-slate-400">· {total.toLocaleString()} bản ghi</span>
            )}
          </p>
          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs text-slate-600 px-1">{page} / {totalPages}</span>
              <button
                className="h-6 w-6 flex items-center justify-center rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table area */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <TableSkeleton cols={8} rows={12} />
        ) : isError ? (
          <div className="p-6 text-center text-sm text-red-500">Lỗi tải dữ liệu. Vui lòng thử lại.</div>
        ) : rows.length === 0 ? (
          <EmptyState title="Không có dữ liệu scan trong khoảng thời gian này" />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[2400px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[58px]">Ngày xuất</TableHead>
                  <TableHead className="min-w-[72px]">Kho</TableHead>
                  <TableHead className="min-w-[90px]">Số xe</TableHead>
                  <TableHead className="min-w-[110px]">NPP</TableHead>
                  <TableHead className="min-w-[80px]">Số DO</TableHead>
                  <TableHead className="min-w-[90px]">Mã pallet</TableHead>
                  <TableHead className="min-w-[70px]">Mã hàng</TableHead>
                  <TableHead className="min-w-[130px]">Tên hàng</TableHead>
                  <TableHead className="min-w-[50px] text-right">Thùng</TableHead>
                  <TableHead className="min-w-[58px]">NSX</TableHead>
                  <TableHead className="min-w-[70px]">Vị trí</TableHead>
                  <TableHead className="min-w-[48px]">Máy</TableHead>
                  <TableHead className="min-w-[50px]">Chu kỳ</TableHead>
                  <TableHead className="min-w-[58px]">Ngày nhập</TableHead>
                  <TableHead className="min-w-[110px]">Ghi chú</TableHead>
                  <TableHead className="min-w-[70px]">Người quét</TableHead>
                  <TableHead className="min-w-[68px]">TG quét</TableHead>
                  <TableHead className="min-w-[72px]">Biển số</TableHead>
                  <TableHead className="min-w-[72px]">Số cont</TableHead>
                  <TableHead className="min-w-[80px]">Lái xe nâng</TableHead>
                  <TableHead className="min-w-[72px]">Bốc xếp</TableHead>
                  <TableHead className="min-w-[62px]">TG giao đơn</TableHead>
                  <TableHead className="min-w-[62px]">TG bắt đầu</TableHead>
                  <TableHead className="min-w-[62px]">TG quét xong</TableHead>
                  <TableHead className="min-w-[62px]">TG hoàn thành</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="px-2 py-1 text-[10px]">
                      {row.delivery_date ? formatDate(row.delivery_date) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">{row.warehouse_name}</TableCell>
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
                    <TableCell className="px-2 py-1 text-[10px]">
                      <FmtTs ts={row.scanned_at} />
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
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
