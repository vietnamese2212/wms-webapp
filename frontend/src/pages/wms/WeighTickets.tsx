// Phiếu cân trạm cân 100T (PM Cân Kinh Bắc) — agent LAN đẩy lên qua cổng tích hợp.
// Đợt 1: xem phiếu + auto/gắn tay chuyến xuất theo biển số. Đối chiếu KL lý thuyết = đợt 2.
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Scale, ChevronLeft, ChevronRight, Link2, Unlink } from 'lucide-react'
import type { AxiosError } from 'axios'
import { SearchInput } from '@/components/shared/SearchInput'
import { PagerNav, ListFooter } from '@/components/shared/ListPager'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { useWeighTickets, useWeighTicketWarehouses, useMatchWeighTicket, useGDOs, type WeighTicket } from '@/api/hooks'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate, formatTimestampTime, normalizeLicensePlate } from '@/utils/formatters'

/**
 * Biển số HIỂN THỊ — dạng dùng chung toàn app: IN HOA, không gạch/space (user chốt 30/07).
 * PM cân in ra "89G-00451" còn Đăng ký cổng / Xuất kho / danh mục Xe đều là "89G00451";
 * để hai kiểu cạnh nhau thì mắt đọc ra hai xe khác nhau, đối chiếu bằng mắt rất dễ sai.
 * `license_plate_norm` do BE tính sẵn khi nhận từ trạm cân (đã dùng để khớp chuyến + tìm kiếm);
 * fallback tự chuẩn hoá phòng dòng cũ chưa có cột norm. Giá trị NGUYÊN VĂN vẫn giữ ở
 * `license_plate` để đối chiếu với phiếu cân giấy — chỉ đổi chỗ NHÌN, không đụng dữ liệu gốc.
 */
const plateOf = (t: { license_plate?: string | null; license_plate_norm?: string | null }): string =>
  t.license_plate_norm || normalizeLicensePlate(t.license_plate ?? '')



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
  // Đối chiếu KL (01/08): KL hàng của CHUYẾN ĐÃ GẮN tính từ Material.weight_kg (kg/thùng) vs KL cân thực
  { id: 'est',         label: 'KL tính (kg)', align: 'right' },
  { id: 'diff',        label: 'Lệch cân−tính', align: 'right' },
  { id: 'goods',       label: 'Hàng' },
  { id: 'status',      label: 'Trạng thái' },
  { id: 'gdo',         label: 'Chuyến gắn' },
  { id: 'trans',       label: 'ĐVVT' },
  { id: 'action',      label: '' },
]
const COL_DEFAULTS = [80, 90, 70, 95, 78, 90, 70, 95, 70, 100, 95, 110, 90, 105, 150, 110, 60]

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
  const [pageSize, setPageSize] = useState(500)
  const [matchFor, setMatchFor] = useState<WeighTicket | null>(null)
  // _v2: thêm 2 cột KL tính/Lệch (01/08) — đổi key để width cũ 15 cột không làm lệch 17 cột mới
  const { widths: colW, startResize, totalWidth } = useColumnResize('weigh_col_widths_v2', COL_DEFAULTS)

  const { data: warehouses = [] } = useWeighTicketWarehouses()  // chỉ kho THỰC CÓ phiếu cân

  const params = useMemo(() => ({
    from_date: filters.from_date || undefined,
    to_date:   filters.to_date   || undefined,
    q:         filters.search.trim() || undefined,
    direction: filters.direction || undefined,
    match_state: filters.match_state || undefined,
    warehouse_ids: filters.warehouse_ids.length > 0 ? filters.warehouse_ids.join(',') : undefined,
    page, limit: pageSize,
  }), [filters, page, pageSize])
  const { data, isLoading, isError, error } = useWeighTickets(params)
  const rows  = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const paramsKey = JSON.stringify({ ...params, page: 0 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1) }, [paramsKey])

  const filterDefs: FilterDef[] = [
    { key: 'date', label: 'Ngày cân', type: 'daterange', from: filters.from_date, to: filters.to_date,
      onChange: (from, to) => setF({ from_date: from, to_date: to }) },
    { key: 'warehouse', label: 'Kho', type: 'multi', searchable: true,
      options: warehouses.map(w => ({ value: w.id, label: w.name })),
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
      <div className="border-b bg-white px-3 py-1.5 shrink-0 space-y-1 sm:py-2 sm:space-y-2 sm:rounded-t-xl">
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
        { label: 'Phiếu', value: total.toLocaleString('vi-VN') },
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
                // Đối chiếu KL: ưu tiên KL theo THỰC XUẤT, chuyến chưa xuất gì → theo kế hoạch
                const est = (r.est_kg_actual ?? 0) > 0 ? r.est_kg_actual : (r.est_kg_planned ?? null)
                const diff = r.is_complete && r.net_kg != null && est != null && est > 0 ? r.net_kg - est : null
                const diffPct = diff != null && est ? (diff / est) * 100 : null
                return (
                  <TableRow key={r.id} className={rowCls}>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap sticky left-0 z-10 bg-white">{r.weigh_date ? formatDate(r.weigh_date) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={r.warehouse_name ?? undefined}>{r.warehouse_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">{r.ticket_no ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap" title={r.license_plate ?? undefined}>{plateOf(r) || '—'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{r.direction ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] tabular-nums text-right whitespace-nowrap">{kg(r.tare_kg) ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">{r.tare_at ? formatTimestampTime(r.tare_at) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] tabular-nums text-right whitespace-nowrap">{r.gross_kg && r.gross_kg > 0 ? kg(r.gross_kg) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">{r.gross_kg && r.gross_kg > 0 && r.gross_at ? formatTimestampTime(r.gross_at) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[11px] font-bold tabular-nums text-right whitespace-nowrap">{r.is_complete ? kg(r.net_kg) : <span className="text-slate-300">—</span>}</TableCell>
                    {/* KL hàng của chuyến gắn TÍNH từ Material.weight_kg — chỉ có khi phiếu đã gắn chuyến */}
                    <TableCell className="px-2 py-1 text-[10px] tabular-nums text-right whitespace-nowrap"
                      title={(r.est_items_missing ?? 0) > 0 ? `Thiếu KL (kg/thùng) ${r.est_items_missing}/${r.est_items_total} mã — số tính chưa trọn` : undefined}>
                      {est != null ? <>{kg(est)}{(r.est_items_missing ?? 0) > 0 && <span className="text-amber-500">*</span>}</> : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className={`px-2 py-1 text-[10px] font-semibold tabular-nums text-right whitespace-nowrap ${diff != null ? (Math.abs(diffPct ?? 0) > 5 ? 'text-red-600' : 'text-green-700') : ''}`}>
                      {diff != null
                        ? `${diff >= 0 ? '+' : ''}${kg(Math.round(diff * 10) / 10)} (${diffPct!.toFixed(1)}%)`
                        : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{r.goods_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      {r.is_complete
                        ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">Hoàn tất</span>
                        : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">Chờ cân lần 2</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      {r.gdo_id ? (
                        <button className="font-mono font-semibold text-sky-700 hover:underline !min-h-0 !min-w-0"
                          title={`Mở chuyến (gắn bởi: ${r.matched_by === 'auto' ? 'tự động' : r.matched_by === 'auto-start' ? 'tự động khi Bắt đầu chuyến' : r.matched_by ?? '?'})`}
                          onClick={() => navigate(`/wms/outbound/${r.gdo_id}`)}>
                          {r.gdo_group_code ?? r.gdo_id.slice(0, 8)}
                        </button>
                      ) : <span className="text-slate-300">—</span>}
                      {r.gdo_id && (r.matched_by === 'auto' || r.matched_by === 'auto-start') && <span className="ml-1 text-[8px] text-slate-400">auto</span>}
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
        <PagerNav page={page} totalPages={totalPages} onPage={setPage} />
      </div>

      <ListFooter page={page} pageSize={pageSize} total={total} unit="phiếu"
        onPageSize={n => { setPageSize(n); setPage(1) }} />
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
  // Chuẩn hoá biển số dùng CHUNG hàm của app (trước đây chép lại luật ngay tại đây — 2 bản
  // rời nhau thì sửa 1 chỗ là lệch chỗ kia; nay chỉ còn utils/formatters là nguồn duy nhất).
  const plateNorm = normalizeLicensePlate(ticket.license_plate ?? '')
  const sorted = useMemo(() => {
    const list = (gdos as { id: string; group_code?: string | null; license_plate?: string | null; status?: string | null; customer_name?: string | null }[])
      .filter(g => g.status !== 'CANCELLED')
    return [...list].sort((a, b) => {
      const ma = plateNorm && normalizeLicensePlate(a.license_plate ?? '') === plateNorm ? 0 : 1
      const mb = plateNorm && normalizeLicensePlate(b.license_plate ?? '') === plateNorm ? 0 : 1
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
            {ticket.gdo_id ? 'Gỡ / đổi chuyến' : 'Gắn chuyến'} — phiếu <span className="font-mono">{ticket.ticket_no ?? ticket.source_id}</span> · xe <span className="font-mono" title={ticket.license_plate ?? undefined}>{plateOf(ticket)}</span>
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-xs text-slate-400 p-4 text-center">Đang tải chuyến ngày {ticket.weigh_date ? formatDate(ticket.weigh_date) : ''}…</p>
        ) : sorted.length === 0 ? (
          <p className="text-xs text-slate-400 border border-dashed rounded-lg p-4 text-center">Không có chuyến xuất nào ngày này</p>
        ) : (
          <div className="max-h-[45vh] overflow-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {sorted.slice(0, 200).map(g => {
              const hit = plateNorm && normalizeLicensePlate(g.license_plate ?? '') === plateNorm
              const isCurrent = g.id === ticket.gdo_id
              return (
                <button key={g.id} disabled={isPending}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-sky-50 !min-h-0 ${isCurrent ? 'bg-sky-50' : ''}`}
                  onClick={() => apply(g.id)}>
                  <span className="font-mono text-[10px] font-semibold text-slate-700">{g.group_code}</span>
                  <span className="text-[10px] text-slate-500 font-mono">{normalizeLicensePlate(g.license_plate ?? '') || '—'}</span>
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
