// TAB "LỊCH SỬ" của Điều vận (20/10, user: "thay vì lịch sử ngày, hãy cho lịch sử toàn bộ, với search, filter — nơi tập kết và kiểm tra
// vấn đề") — sổ vết outbound_events của kho: vết mức kế hoạch (lập · xác nhận · mở lại · bỏ / huỷ) + mọi Số xe, KỂ CẢ xe đã bỏ / đã xoá
// (dòng "Bỏ xe" / "Xoá xe trống" mang danh sách DO). Phân trang SERVER (sổ lớn theo lịch sử — không kéo cả bảng); lọc: ngày kế hoạch ·
// khoảng ngày thao tác · việc · tìm (Số xe / DO / người / chi tiết). Chưa lọc gì ⇒ 7 ngày gần nhất. Nút "Lịch sử" ở tab Kế hoạch mở tab này
// với ngày kế hoạch đã chọn sẵn. Realtime: key ['trip-flow'] làm mới khi outbound_events đổi.
import { useEffect, useMemo } from 'react'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { ListFooter, PagerNav } from '@/components/shared/ListPager'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useDispatchHistory } from '@/api/hooks'
import { EVENT_VI } from './TripFlow'
import { formatDateTime } from '@/utils/formatters'

const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const daysAgo = (n: number) => new Date(Date.parse(`${todayVN()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)
/** Ngày kế hoạch suy từ Số xe `<MãKho>_X_<ddmmyy>[_stt]` → dd/mm/yy */
const planDayOf = (gc: string) => { const m = /_X_(\d{2})(\d{2})(\d{2})/.exec(gc); return m ? `${m[1]}/${m[2]}/${m[3]}` : '' }
/** Vết MỨC KẾ HOẠCH ghi trên tiền tố kho×ngày (không STT xe) */
const isPlanLevel = (gc: string) => /_X_\d{6}$/.test(gc)
const COLS: RtColDef[] = [
  { id: 'at', label: 'Thời gian', w: 125 }, { id: 'day', label: 'Ngày KH', w: 72 }, { id: 'code', label: 'Số xe', w: 160 }, { id: 'by', label: 'Ai', w: 150 },
  { id: 'what', label: 'Việc', w: 130 }, { id: 'do', label: 'DO', w: 100 }, { id: 'detail', label: 'Chi tiết', w: 520 },
]
const TYPE_OPTS = Object.entries(EVENT_VI).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'vi'))
const PAGE_OPTS = [50, 100, 200] as const   // trần page_size của cửa đọc = 200

export function DispatchHistoryTab({ warehouseId }: { warehouseId: string }) {
  const f = useWmsFilterStore(s => s.dispatch)
  const setF = useWmsFilterStore(s => s.setDispatch)
  // chưa lọc ngày kế hoạch lẫn thời gian ⇒ 7 ngày gần nhất (không kéo cả sổ); có ngày kế hoạch thì xem trọn vết của ngày đó
  const from = f.histPlanDate ? f.histFrom : (f.histFrom || daysAgo(7))
  const q = useDebouncedValue(f.histQ.trim(), 300)
  const page = f.histPage || 1, pageSize = f.histPageSize || 100
  const params = useMemo(() => ({
    warehouse_id: warehouseId, plan_date: f.histPlanDate || undefined, from: from || undefined, to: f.histTo || undefined,
    types: f.histTypes.length ? f.histTypes.join(',') : undefined, q: q || undefined, page, page_size: pageSize,
  }), [warehouseId, f.histPlanDate, from, f.histTo, f.histTypes, q, page, pageSize])
  const hq = useDispatchHistory(params)
  const total = hq.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  useEffect(() => { if (!hq.isLoading && total > 0 && page > totalPages) setF({ histPage: totalPages }) }, [hq.isLoading, total, page, totalPages, setF])
  const defs: FilterDef[] = [
    { key: 'planDate', label: 'Ngày kế hoạch', type: 'date', value: f.histPlanDate, onChange: v => setF({ histPlanDate: v, histPage: 1 }), pinned: true },
    { key: 'at', label: 'Thời gian thao tác', type: 'daterange', from: f.histFrom, to: f.histTo, onChange: (a, b) => setF({ histFrom: a, histTo: b, histPage: 1 }), pinned: true },
    { key: 'types', label: 'Việc', type: 'multi', options: TYPE_OPTS, selected: f.histTypes, onChange: v => setF({ histTypes: v, histPage: 1 }) },
  ]
  const items = hq.data?.items ?? []
  return (
    <div className="flex h-full min-h-0 flex-col" data-dispatch-history>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-white px-3 py-1.5 xl:flex-nowrap">
        <SearchInput value={f.histQ} onChange={v => setF({ histQ: v, histPage: 1 })} placeholder="Tìm Số xe, DO, người làm, chi tiết…" className="flex-1 min-w-[160px] sm:max-w-sm" />
        <FilterBar defs={defs} />
        <FilterSheetButton defs={defs} className="sm:hidden" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <ResizableTable storageKey="dispatch_history_v1" cols={COLS}>
          <TableBody>
            {hq.isError && <TableEmptyRow colSpan={COLS.length}><span className="text-red-600">Không tải được lịch sử.</span></TableEmptyRow>}
            {!hq.isError && hq.isLoading && !items.length && <TableEmptyRow colSpan={COLS.length}>Đang tải…</TableEmptyRow>}
            {!hq.isError && !hq.isLoading && !items.length && <TableEmptyRow colSpan={COLS.length}>Không có vết nào trong khoảng đang lọc{!f.histPlanDate && !f.histFrom ? ' (mặc định 7 ngày gần nhất — nới "Thời gian thao tác" để xem xa hơn)' : ''}.</TableEmptyRow>}
            {items.map(e => (
              <TableRow key={e.id} className="bg-white hover:bg-slate-50" data-hist-row={e.event_type}>
                <TableCell className={`${TD} sticky left-0 z-10 bg-white font-mono`}>{formatDateTime(e.created_at)}</TableCell>
                <TableCell className={`${TD} tabular-nums`}>{planDayOf(e.group_code)}</TableCell>
                <TableCell className={`${TD} font-mono`} title={e.group_code}>{isPlanLevel(e.group_code) ? <span className="text-slate-400" title="Vết mức kế hoạch (cả ngày, cả hai mảng)">kế hoạch</span> : e.group_code}</TableCell>
                <TableCell className={`${TD} truncate`} title={e.actor ?? ''}>{e.actor ?? <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} font-medium text-slate-700`} title={e.event_type}>{EVENT_VI[e.event_type] ?? e.event_type}</TableCell>
                <TableCell className={`${TD} font-mono`}>{e.do_number ?? <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} truncate text-slate-600`} title={e.detail ?? ''}>{e.detail ?? <span className="text-slate-300">—</span>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </ResizableTable>
        <PagerNav page={page} totalPages={totalPages} onPage={p => setF({ histPage: p })} />
      </div>
      <ListFooter page={page} pageSize={pageSize} total={total} unit="vết" onPageSize={n => setF({ histPageSize: n, histPage: 1 })} options={PAGE_OPTS}
        right={`${hq.data?.code ? `tiền tố ${hq.data.code} · ` : ''}vết mức kế hoạch (lập · xác nhận · mở lại · bỏ / huỷ) và của từng Số xe, kể cả xe đã bỏ / đã xoá — dòng "Bỏ xe" ghi danh sách DO`} />
    </div>
  )
}
