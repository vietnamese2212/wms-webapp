// TAB "NHÁP" của Điều vận (12/10, user: "7 là tab nháp — list nháp mở"): bảng các kế hoạch CÒN MỞ (nháp · chờ ĐVVT) của kho, MỌI ngày,
// cả hai mảng — thay băng vàng "nháp quá ngày" (03/10) vốn chỉ nhắc 3 nháp đầu và hiện trên mọi bàn. Mỗi dòng: ngày giao · mảng · trạng
// thái (quá ngày ⚠) · xe · đơn trên xe · khung chờ · người lập · lập lúc; "Mở bàn" đặt ngày + mảng rồi nhảy sang Bàn ghép xe, "Bỏ nháp" là
// cùng cửa với nút Bỏ nháp trên bàn. Nháp chỉ chứa Chờ điều (bấm Xem đơn rồi để đó) in mờ — không phải việc bị bỏ quên (luật 07/10).
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, LayoutGrid, Trash2 } from 'lucide-react'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { ListFooter } from '@/components/shared/ListPager'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SEGMENT_VI, type DispatchPlanListItem } from '@/api/hooks'
import { formatDate, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { planHoldsOrders } from './dispatchIssues'

const nf = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('vi-VN'))
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

function useIsDesktop() {
  const [d, setD] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const h = () => setD(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return d
}

export function DispatchDraftsTable({ plans, loading, error, currentPlanId, canPlan, busyId, onOpen, onDiscard }: {
  plans: DispatchPlanListItem[]; loading: boolean; error: string | null
  currentPlanId: string | null   // kế hoạch đang mở trên bàn — tô nhẹ để biết "mình đang ở đâu"
  canPlan: boolean; busyId: string | null
  onOpen: (p: DispatchPlanListItem) => void; onDiscard: (p: DispatchPlanListItem) => void
}) {
  const desktop = useIsDesktop()
  const today = todayVN()
  const cols = useMemo<RtColDef[]>(() => [
    { id: 'date', label: 'Ngày giao', w: 96 },
    { id: 'seg', label: 'Mảng', w: 100 },
    { id: 'status', label: 'Trạng thái', w: 190 },
    { id: 'trips', label: 'Xe', w: 56, align: 'right' },
    { id: 'ods', label: 'Đơn trên xe', w: 90, align: 'right' },
    { id: 'pool', label: 'Khung chờ', w: 84, align: 'right' },
    { id: 'by', label: 'Người lập', w: 140 },
    { id: 'at', label: 'Lập lúc', w: 120 },
    { id: 'act', label: '', w: 170, align: 'right', stickyRight: desktop },
  ], [desktop])
  // quá ngày lên đầu (việc bị bỏ quên), rồi ngày giao gần nhất
  const rows = useMemo(() => [...plans].sort((a, b) => a.plan_date.localeCompare(b.plan_date) || a.created_at.localeCompare(b.created_at)), [plans])
  const overdueN = rows.filter(p => p.plan_date < today).length
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto pb-20 lg:pb-0">
        <ResizableTable storageKey={`dispatch_drafts_v1${desktop ? '' : '_m'}`} cols={cols}>
          <TableBody>
            {error && <TableEmptyRow colSpan={cols.length}><span className="text-red-600">Không tải được danh sách nháp: {error}</span></TableEmptyRow>}
            {!error && loading && !rows.length && <TableEmptyRow colSpan={cols.length}>Đang tải…</TableEmptyRow>}
            {!error && !loading && !rows.length && <TableEmptyRow colSpan={cols.length}>Kho này không còn nháp nào đang mở — mọi kế hoạch đã xác nhận hoặc đã bỏ.</TableEmptyRow>}
            {rows.map(p => {
              const overdue = p.plan_date < today
              const holds = planHoldsOrders(p.summary)
              const cur = p.id === currentPlanId
              const bg = cur ? 'bg-sky-50' : 'bg-white'
              const pool = Math.max(0, (p.summary?.pool_ods ?? 0) - (p.summary?.unreviewed_ods ?? 0))
              const tendered = p.status === 'TENDERED'
              return (
                <TableRow key={p.id} className={`cursor-pointer hover:bg-slate-50 ${bg} ${holds ? '' : 'text-slate-400'}`} onClick={() => onOpen(p)}
                  title={holds ? 'Bấm dòng để mở bàn của nháp này' : 'Nháp chỉ chứa đơn Chờ điều (bấm Xem đơn rồi để đó) — không giữ đơn nào'}>
                  <TableCell className={`${TD} sticky left-0 z-10 font-semibold ${bg} ${holds ? 'text-slate-800' : ''}`}>{formatDate(p.plan_date)}</TableCell>
                  <TableCell className={TD}>{SEGMENT_VI[p.segment ?? 'SALES']}</TableCell>
                  <TableCell className={TD}>
                    <span className="inline-flex items-center gap-1">
                      <StatusBadge tone={tendered ? 'blue' : 'amber'}>{tendered ? 'Chờ ĐVVT phản hồi' : 'Bản nháp'}</StatusBadge>
                      {overdue && holds && <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1 text-[9px] font-semibold text-red-700" title="Ngày giao đã qua mà nháp chưa xác nhận — đơn trên nháp vẫn bị giữ, kế hoạch ngày khác không lấy được"><AlertTriangle className="h-3 w-3" />quá ngày</span>}
                      {!holds && <span className="text-[9px]">chưa giữ đơn</span>}
                    </span>
                  </TableCell>
                  <TableCell className={`${TD} text-right tabular-nums`}>{nf(p.summary?.trips ?? 0)}</TableCell>
                  <TableCell className={`${TD} text-right tabular-nums`}>{nf(p.summary?.ods ?? 0)}</TableCell>
                  <TableCell className={`${TD} text-right tabular-nums`} title="Đơn đã vào kế hoạch nhưng chưa lên xe">{nf(pool)}</TableCell>
                  <TableCell className={`${TD} truncate`} title={p.created_by ?? ''}>{p.created_by || <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={`${TD} tabular-nums`}>{formatTimestampDate(p.created_at, true)} {formatTimestampTime(p.created_at, false)}</TableCell>
                  <TableCell className={`${TD} text-right ${desktop ? `sticky right-0 z-10 ${bg}` : ''}`} onClick={e => e.stopPropagation()}>
                    <span className="inline-flex items-center gap-2">
                      <button type="button" className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline" onClick={() => onOpen(p)}><LayoutGrid className="h-3 w-3" />Mở bàn</button>
                      {canPlan && <button type="button" className="inline-flex items-center gap-1 font-medium text-red-700 hover:underline disabled:opacity-50" disabled={busyId === p.id} onClick={() => onDiscard(p)}>
                        <Trash2 className="h-3 w-3" />{busyId === p.id ? 'Đang bỏ…' : tendered ? 'Bỏ xe chưa chốt' : 'Bỏ nháp'}</button>}
                    </span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </ResizableTable>
      </div>
      <ListFooter page={1} pageSize={Math.max(1, rows.length)} total={rows.length} unit="nháp" onPageSize={() => { }} options={[]}
        right={`${overdueN ? `${nf(overdueN)} nháp quá ngày · ` : ''}nháp còn mở của kho, mọi ngày, cả Bán hàng lẫn Trung chuyển — "Mở bàn" đặt ngày + mảng rồi sang Bàn ghép xe`} />
    </div>
  )
}
