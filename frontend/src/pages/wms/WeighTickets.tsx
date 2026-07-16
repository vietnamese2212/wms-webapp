// Phiếu cân trạm cân 100T (PM Cân Kinh Bắc) — agent LAN đẩy lên qua cổng tích hợp.
// Đợt 1: xem phiếu + auto/gắn tay chuyến xuất theo biển số. Đối chiếu KL lý thuyết = đợt 2.
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Scale, ChevronLeft, ChevronRight, Link2, Unlink } from 'lucide-react'
import type { AxiosError } from 'axios'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { useWeighTickets, useMatchWeighTicket, useGDOs, type WeighTicket } from '@/api/hooks'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate, formatTimestampTime } from '@/utils/formatters'

const PAGE_SIZE = 500

const COLS: { id: string; label: string; align?: 'right' }[] = [
  { id: 'weigh_date',  label: 'Ngày cân' },
  { id: 'warehouse',   label: 'Kho' },
  { id: 'ticket_no',   label: 'Số phiếu' },
  { id: 'plate',       label: 'Biển số' },
  { id: 'direction',   label: 'Chiều' },
  { id: 'tare',        label: 'KL bì (kg)', align: 'right' },
  { id: 'tare_at',     label: 'Giờ bì' },
  { id: 'gross',       label: 'KL tổng (kg)', align: 'right' },
  { id: 'gross_at',    label: 'Giờ tổng' },
  { id: 'net',         label: 'KL hàng (kg)', align: 'right' },
  { id: 'goods',       label: 'Hàng' },
  { id: 'status',      label: 'Trạng thái' },
  { id: 'gdo',         label: 'Chuyến gắn' },
  { id: 'trans',       label: 'ĐVVT' },
  { id: 'action',      label: '' },
]
const COL_DEFAULTS = [80, 90, 70, 95, 78, 90, 70, 95, 70, 100, 90, 105, 150, 110, 60]

const nf = new Intl.NumberFormat('vi-VN')
function kg(v: number | null | undefined) {
  return v == null ? null : nf.format(v)
}

export default function WeighTickets() {
  const navigate = useNavigate()
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canMatch = can(perms, 'weigh_station', 'match')

  const filters = useWmsFilterStore(s => s.weighTickets)
  const setF    = useWmsFilterStore(s => s.setWeighTickets)
  const [page, setPage] = useState(1)
  const [matchFor, setMatchFor] = useState<WeighTicket | null>(null)
  const { widths: colW, startResize, totalWidth } = useColumnResize('weigh_col_widths', COL_DEFAULTS)

  const { data: warehouses = [] } = useScopedWarehouses()

  const params = useMemo(() => ({
    from_date: filters.from_date || undefined,
    to_date:   filters.to_date   || undefined,
    q:         filters.search.trim() || undefined,
    direction: filters.direction || undefined,
    match_state: filters.match_state || undefined,
    warehouse_ids: filters.warehouse_ids.length > 0 ? filters.warehouse_ids.join(',') : undefined,
    page, limit: PAGE_SIZE,
  }), [filters, page])
  const { data, isLoading, isError, error } = useWeighTickets(params)
  const rows  = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const paramsKey = JSON.stringify({ ...params, page: 0 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1) }, [paramsKey])

  const filterDefs: FilterDef[] = [
    { key: 'date', label: 'Ngày cân', type: 'daterange', from: filters.from_date, to: filters.to_date,
      onChange: (from, to) => setF({ from_date: from, to_date: to }) },
    { key: 'warehouse', label: 'Kho', type: 'multi', searchable: true,
      options: (warehouses as { id: string; name: string }[]).map(w => ({ value: w.id, label: w.name })),
      selected: filters.warehouse_ids,
      onChange: v => setF({ warehouse_ids: v }) },
    { key: 'direction', label: 'Chiều', type: 'single', allLabel: 'Tất cả chiều', value: filters.direction,
      options: [{ value: 'Cân Xuất', label: 'Cân Xuất' }, { value: 'Cân Nhập', label: 'Cân Nhập' }],
      onChange: v => setF({ direction: v }) },
    { key: 'match_state', label: 'Trạng thái', type: 'single', allLabel: 'Tất cả trạng thái', value: filters.match_state,
      options: [
        { value: 'matched',   label: 'Đã gắn chuyến' },
        { value: 'unmatched', label: 'Chưa gắn chuyến' },
        { value: 'pending',   label: 'Đang chờ cân lần 2' },
      ],
      onChange: v => setF({ match_state: v }) },
  ]

  const nComplete = rows.filter(r => r.is_complete).length
  const nMatched  = rows.filter(r => r.gdo_id).length

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2 sm:rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 shrink-0">
            <Scale className="h-4 w-4 text-slate-500" /> Phiếu cân
          </span>
          <SearchInput value={filters.search} onChange={v => setF({ search: v })}
            placeholder="Tìm biển số, số phiếu, hàng…" className="flex-1 min-w-[140px]" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
        </div>
        <FilterBar defs={filterDefs} />
      </div>

      <SummaryBand tiles={[
        { label: 'Phiếu (trang này)', value: rows.length },
        { label: 'Đã cân xong', value: nComplete },
        { label: 'Đã gắn chuyến', value: nMatched, accent: nMatched > 0 },
        { label: 'Tổng', value: total.toLocaleString('vi-VN') },
      ]} />

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <TableSkeleton cols={10} rows={10} />
        ) : isError ? (
          <div className="p-6 text-center text-sm text-red-500">
            {(error as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi tải phiếu cân. Vui lòng thử lại.'}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="Chưa có phiếu cân trong khoảng ngày này" />
        ) : (
          <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden" style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow>
                {/* KHÔNG đặt `relative` lên TableHead — đè mất `sticky top-0` của base → header hết freeze */}
                {COLS.map((c, i) => (
                  <TableHead key={c.id} className={`px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                    {c.label}
                    <span onPointerDown={e => startResize(i, e)} onClick={e => e.stopPropagation()}
                      className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => {
                const rowCls = !r.is_complete ? 'text-amber-600' : r.gdo_id ? 'text-green-700' : 'text-slate-700'
                return (
                  <TableRow key={r.id} className={rowCls}>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap sticky left-0 z-10 bg-white">{r.weigh_date ? formatDate(r.weigh_date) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={r.warehouse_name ?? undefined}>{r.warehouse_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">{r.ticket_no ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{r.license_plate ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{r.direction ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] tabular-nums text-right whitespace-nowrap">{kg(r.tare_kg) ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">{r.tare_at ? formatTimestampTime(r.tare_at) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] tabular-nums text-right whitespace-nowrap">{r.gross_kg && r.gross_kg > 0 ? kg(r.gross_kg) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">{r.gross_kg && r.gross_kg > 0 && r.gross_at ? formatTimestampTime(r.gross_at) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[11px] font-bold tabular-nums text-right whitespace-nowrap">{r.is_complete ? kg(r.net_kg) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{r.goods_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      {r.is_complete
                        ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">Hoàn tất</span>
                        : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">Chờ cân lần 2</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      {r.gdo_id ? (
                        <button className="font-mono font-semibold text-sky-700 hover:underline !min-h-0 !min-w-0"
                          title={`Mở chuyến (gắn bởi: ${r.matched_by === 'auto' ? 'tự động' : r.matched_by ?? '?'})`}
                          onClick={() => navigate(`/wms/outbound/${r.gdo_id}`)}>
                          {r.gdo_group_code ?? r.gdo_id.slice(0, 8)}
                        </button>
                      ) : <span className="text-slate-300">—</span>}
                      {r.gdo_id && r.matched_by === 'auto' && <span className="ml-1 text-[8px] text-slate-400">auto</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{r.trans_company || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-1 py-1 whitespace-nowrap">
                      {canMatch && (r.gdo_id ? (
                        <button className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 !min-h-0 !min-w-0" title="Gỡ chuyến khỏi phiếu cân"
                          onClick={() => setMatchFor(r)}>
                          <Unlink className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button className="p-1 rounded text-sky-500 hover:text-sky-700 hover:bg-sky-50 !min-h-0 !min-w-0" title="Gắn phiếu cân vào chuyến xe"
                          onClick={() => setMatchFor(r)}>
                          <Link2 className="h-3.5 w-3.5" />
                        </button>
                      ))}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 flex items-center gap-3 text-[11px] text-slate-500 sm:rounded-b-xl">
        <span>{rows.length > 0 ? `${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + rows.length} / ${total.toLocaleString('vi-VN')}` : '0 phiếu'}</span>
        <div className="ml-auto flex items-center gap-1">
          <button className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 !min-h-0 !min-w-0" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></button>
          <span>{page}/{totalPages}</span>
          <button className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 !min-h-0 !min-w-0" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
     </div>

     {matchFor && <MatchDialog ticket={matchFor} onClose={() => setMatchFor(null)} />}
    </div>
  )
}

// Dialog gắn/gỡ chuyến: liệt kê chuyến XUẤT cùng ngày phiếu cân, đánh dấu chuyến trùng biển số
function MatchDialog({ ticket, onClose }: { ticket: WeighTicket; onClose: () => void }) {
  const { mutate: doMatch, isPending } = useMatchWeighTicket()
  const day = ticket.weigh_date ?? undefined
  const { data: gdos = [], isLoading } = useGDOs(day ? { date_from: day, date_to: day } : undefined)
  const norm = (s: string | null | undefined) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  const plateNorm = norm(ticket.license_plate)
  const sorted = useMemo(() => {
    const list = (gdos as { id: string; group_code?: string | null; license_plate?: string | null; status?: string | null; customer_name?: string | null }[])
      .filter(g => g.status !== 'CANCELLED')
    return [...list].sort((a, b) => {
      const ma = plateNorm && norm(a.license_plate) === plateNorm ? 0 : 1
      const mb = plateNorm && norm(b.license_plate) === plateNorm ? 0 : 1
      if (ma !== mb) return ma - mb
      return (a.group_code ?? '').localeCompare(b.group_code ?? '')
    })
  }, [gdos, plateNorm])

  function apply(gdoId: string | null) {
    doMatch({ id: ticket.id, gdo_id: gdoId }, {
      onSuccess: onClose,
      onError: (err) => toast({
        variant: 'destructive', title: 'Không cập nhật được',
        description: (err as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi gắn chuyến',
      }),
    })
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {ticket.gdo_id ? 'Gỡ / đổi chuyến' : 'Gắn chuyến'} — phiếu <span className="font-mono">{ticket.ticket_no ?? ticket.source_id}</span> · xe <span className="font-mono">{ticket.license_plate}</span>
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-xs text-slate-400 p-4 text-center">Đang tải chuyến ngày {ticket.weigh_date ? formatDate(ticket.weigh_date) : ''}…</p>
        ) : sorted.length === 0 ? (
          <p className="text-xs text-slate-400 border border-dashed rounded-lg p-4 text-center">Không có chuyến xuất nào ngày này</p>
        ) : (
          <div className="max-h-[45vh] overflow-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {sorted.slice(0, 200).map(g => {
              const hit = plateNorm && norm(g.license_plate) === plateNorm
              const isCurrent = g.id === ticket.gdo_id
              return (
                <button key={g.id} disabled={isPending}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-sky-50 !min-h-0 ${isCurrent ? 'bg-sky-50' : ''}`}
                  onClick={() => apply(g.id)}>
                  <span className="font-mono text-[10px] font-semibold text-slate-700">{g.group_code}</span>
                  <span className="text-[10px] text-slate-500 font-mono">{g.license_plate ?? '—'}</span>
                  {hit && <span className="text-[8px] px-1 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold shrink-0">khớp biển số</span>}
                  {isCurrent && <span className="ml-auto text-[8px] text-sky-600 font-semibold shrink-0">đang gắn</span>}
                </button>
              )
            })}
          </div>
        )}
        <DialogFooter className="gap-2">
          {ticket.gdo_id && (
            <Button variant="outline" size="sm" className="text-red-600" disabled={isPending} onClick={() => apply(null)}>
              <Unlink className="h-3.5 w-3.5 mr-1" /> Gỡ chuyến hiện tại
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Đóng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
