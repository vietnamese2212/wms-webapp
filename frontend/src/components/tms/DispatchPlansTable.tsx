// TAB "KẾ HOẠCH" của Điều vận (16/10, user: "kế hoạch nếu đã tạo thì cần được đưa vào 1 tab, tab đó là table: ngày nào, kế hoạch nào;
// click vào row để xem; có nút sửa") — thay tab "Nháp" (12/10) vốn chỉ liệt kê nháp còn mở. Bảng MỌI kế hoạch của kho, mọi ngày.
// 16/10 tối (user: "Bán hàng và Trung chuyển là MỘT dòng ở kế hoạch, xem riêng ở các tab"): MỘT DÒNG = MỘT NGÀY, hai cột Bán hàng ·
// Trung chuyển mang trạng thái + xe/đơn của từng mảng; số xe · đơn · khung chờ · pallet · cước cộng cả hai. Bấm dòng = mở ngày (bàn vẫn
// chuyển mảng bằng công tắc Bán hàng | Trung chuyển); Sửa · Bỏ nháp · Huỷ áp cho CẢ HAI kế hoạch của ngày. Kế hoạch ĐÃ BỎ là lịch sử ⇒
// mỗi bản một dòng riêng (chỉ xem), không gộp.
// Nút trên dòng: "Sửa" (có kế hoạch đã xác nhận — nạp đơn chờ cả hai mảng, mở từng xe trên bàn) · "Xoá" (23/10, user: "1 nút để giải quyết
// lỡ tay tạo nhầm kế hoạch — xoá nó đi": thay Bỏ nháp / Bỏ xe chưa chốt / Huỷ kế hoạch; xoá mềm, bên Xuất đã làm thì chặn). Lọc nhanh: Đang mở ·
// Đã xác nhận · Đã xoá · Tất cả.
// 19/10 (user hỏi "lịch sử với xoá chuyến, xoá kế hoạch thì sao") → 20/10 (user: "thay vì lịch sử ngày, cho lịch sử toàn bộ, có search /
// filter"): nút "Lịch sử" trên MỌI dòng (kể cả đã bỏ) mở tab Lịch sử của Điều vận đã lọc sẵn ngày kế hoạch đó — vết kế hoạch + từng Số xe, kể cả xe đã bỏ / xoá.
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, History, LayoutGrid, Pencil, Trash2 } from 'lucide-react'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { ListFooter } from '@/components/shared/ListPager'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useTripFlows } from '@/api/hooks'
import { TripFlowProgressText } from './TripFlow'
import { type DispatchPlanListItem } from '@/api/hooks'
import { formatDate, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { planHoldsOrders } from './dispatchIssues'

const nf = (n: number | string | null | undefined, d = 0) => (n == null ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d }))
const money = (n: number | null) => (n == null ? '—' : `${(n / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tr`)
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const isOpenSt = (p: DispatchPlanListItem) => p.status === 'DRAFT' || p.status === 'TENDERED'
type Show = 'open' | 'confirmed' | 'discarded' | 'all'
const SHOW: { k: Show; label: string; tip: string }[] = [
  { k: 'open', label: 'Đang mở', tip: 'Có mảng còn nháp / đang chờ ĐVVT — chưa vào Kế hoạch xuất hết' },
  { k: 'confirmed', label: 'Đã xác nhận', tip: 'Mọi xe của cả hai mảng đã vào Kế hoạch xuất — "Sửa" để mở từng xe' },
  { k: 'discarded', label: 'Đã xoá', tip: 'Chỉ xem — mỗi bản đã xoá một dòng' },
  { k: 'all', label: 'Tất cả', tip: 'Mọi kế hoạch của kho (200 gần nhất)' },
]
const STATUS: Record<DispatchPlanListItem['status'], { label: string; tone: 'amber' | 'blue' | 'green' | 'slate' }> = {
  DRAFT: { label: 'Bản nháp', tone: 'amber' }, TENDERED: { label: 'Chờ ĐVVT / mở một phần', tone: 'blue' }, CONFIRMED: { label: 'Đã xác nhận', tone: 'green' }, DISCARDED: { label: 'Đã xoá', tone: 'slate' },
}

/** Một dòng của bảng = một NGÀY (hai mảng) — hoặc một kế hoạch đã bỏ (lịch sử, dòng riêng). */
export type DispatchPlanDay = {
  key: string; plan_date: string; discarded: boolean
  sales: DispatchPlanListItem | null; transfer: DispatchPlanListItem | null
  plans: DispatchPlanListItem[]   // kế hoạch của dòng (sống: 1–2 mảng; đã bỏ: đúng một bản)
}
export function groupPlanDays(plans: DispatchPlanListItem[]): DispatchPlanDay[] {
  const byDay = new Map<string, DispatchPlanListItem[]>()
  const out: DispatchPlanDay[] = []
  for (const p of plans) {
    if (p.status === 'DISCARDED') { out.push({ key: p.id, plan_date: p.plan_date, discarded: true, sales: p.segment === 'TRANSFER' ? null : p, transfer: p.segment === 'TRANSFER' ? p : null, plans: [p] }); continue }
    const l = byDay.get(p.plan_date) ?? []; l.push(p); byDay.set(p.plan_date, l)
  }
  for (const [day, l] of byDay) {
    // mỗi mảng lấy bản MỚI NHẤT còn sống (bình thường chỉ có một); bản thừa (nếu có) vẫn nằm trong `plans` để Bỏ / Huỷ không sót
    const newest = (seg: 'SALES' | 'TRANSFER') => l.filter(p => (p.segment ?? 'SALES') === seg).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
    out.push({ key: day, plan_date: day, discarded: false, sales: newest('SALES'), transfer: newest('TRANSFER'), plans: l })
  }
  return out
}
const dayOpen = (d: DispatchPlanDay) => !d.discarded && d.plans.some(isOpenSt)
const dayConfirmed = (d: DispatchPlanDay) => !d.discarded && !dayOpen(d) && d.plans.some(p => p.status === 'CONFIRMED')
const sum = (d: DispatchPlanDay, f: (p: DispatchPlanListItem) => number | null | undefined) => d.plans.reduce((a, p) => a + (Number(f(p)) || 0), 0)

/** TIẾN ĐỘ XE của một ngày (18/10): "k/N đã xuất · j đã giao" từ chuỗi tình trạng các xe đã chốt — chỉ hỏi cho ngày GẦN (±7 ngày quanh hôm
 *  nay; lịch sử xa không hỏi, tránh 200 ngày × 20 xe mỗi lần mở tab). */
function DayProgress({ d, today }: { d: DispatchPlanDay; today: string }) {
  const codes = d.discarded ? [] : d.plans.flatMap(p => p.summary?.confirmed_group_codes ?? [])
  const near = Math.abs((Date.parse(d.plan_date) - Date.parse(today)) / 86_400_000) <= 7
  const q = useTripFlows(codes, near && codes.length > 0)
  if (!codes.length) return <span className="text-slate-300">—</span>
  if (!near) return <span className="text-[10px] text-slate-400" title="Ngày xa hôm nay — mở ngày để xem từng xe">{nf(codes.length)} xe đã chốt</span>
  if (!q.data) return <span className="text-[10px] text-slate-400">{q.isError ? 'không tải được' : '…'}</span>
  return <TripFlowProgressText flows={q.data} />
}

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

/** Ô một mảng: trạng thái + xe · đơn; nháp quá ngày ⚠; nháp chỉ chứa Chờ điều in mờ "chưa giữ đơn". */
function SegCell({ p, today }: { p: DispatchPlanListItem | null; today: string }) {
  if (!p) return <span className="text-slate-300">—</span>
  // 17/10 (user chốt): TENDERED mà không xe nào chờ ĐVVT = kế hoạch đang SỬA (vài xe mở lại) — không in "Chờ ĐVVT" gây hiểu là kẹt ở ĐVVT
  const st = p.status === 'TENDERED' && !(p.summary?.tendered ?? 0)
    ? { label: `Đang sửa · ${nf(Math.max(0, (p.summary?.trips ?? 0) - (p.summary?.confirmed ?? 0)))} xe mở`, tone: 'amber' as const }
    : STATUS[p.status]
  const holds = p.status === 'DISCARDED' ? true : planHoldsOrders(p.summary)
  const overdue = isOpenSt(p) && p.plan_date < today
  return (
    <span className={`inline-flex items-center gap-1 ${holds ? '' : 'text-slate-400'}`}>
      <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
      <span className="tabular-nums">{nf(p.summary?.trips ?? 0)} xe · {nf(p.summary?.ods ?? 0)} đơn</span>
      {overdue && holds && <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1 text-[9px] font-semibold text-red-700" title="Ngày giao đã qua mà nháp chưa xác nhận — đơn trên nháp vẫn bị giữ, kế hoạch ngày khác không lấy được"><AlertTriangle className="h-3 w-3" />quá ngày</span>}
      {isOpenSt(p) && !holds && <span className="text-[9px]">chưa giữ đơn</span>}
    </span>
  )
}

export function DispatchPlansTable({ plans, loading, error, currentPlanId, canPlan, canConfirm, busyId, onOpen, onEdit, onDelete, onHistory }: {
  plans: DispatchPlanListItem[]; loading: boolean; error: string | null
  currentPlanId: string | null   // kế hoạch đang mở trên bàn — tô nhẹ dòng ngày của nó để biết "mình đang ở đâu"
  canPlan: boolean; canConfirm: boolean; busyId: string | null
  onOpen: (d: DispatchPlanDay) => void
  onHistory: (d: DispatchPlanDay) => void    // 20/10: sang tab Lịch sử, lọc sẵn ngày kế hoạch này
  onEdit: (d: DispatchPlanDay) => void       // có kế hoạch đã xác nhận: nạp đơn chờ cả hai mảng + sang bàn, mở từng xe
  onDelete: (d: DispatchPlanDay) => void     // 23/10: XOÁ kế hoạch của ngày (cả hai mảng) — làm nhầm
}) {
  const desktop = useIsDesktop()
  const today = todayVN()
  const [show, setShow] = useState<Show>('all')   // 19/10 (user: "Đang mở" ra bảng trống khi mọi kế hoạch đã xác nhận — khó thao tác) ⇒ mặc định Tất cả
  const cols = useMemo<RtColDef[]>(() => [
    { id: 'date', label: 'Ngày giao', w: 96 },
    { id: 'sales', label: 'Bán hàng', w: 230 },
    { id: 'transfer', label: 'Trung chuyển', w: 230 },
    { id: 'trips', label: 'Xe', w: 52, align: 'right' },
    { id: 'ods', label: 'Đơn trên xe', w: 84, align: 'right' },
    { id: 'flow', label: 'Tiến độ xe', w: 200 },   // 18/10: k/N đã xuất · j đã giao (chuỗi tình trạng xe)
    { id: 'pool', label: 'Khung chờ', w: 80, align: 'right' },
    { id: 'pal', label: 'Pallet', w: 70, align: 'right' },
    { id: 'freight', label: 'Σ cước', w: 80, align: 'right' },
    { id: 'by', label: 'Người lập', w: 140 },
    { id: 'at', label: 'Lập lúc', w: 110 },
    { id: 'cby', label: 'Xác nhận', w: 170 },
    { id: 'act', label: '', w: 290, align: 'right', stickyRight: desktop },   // 19/10: thêm "Lịch sử"
  ], [desktop])
  const days = useMemo(() => groupPlanDays(plans), [plans])
  const counts = useMemo(() => ({
    open: days.filter(dayOpen).length, confirmed: days.filter(dayConfirmed).length, discarded: days.filter(d => d.discarded).length, all: days.length,
  }), [days])
  // đang mở: quá ngày lên đầu (việc bị bỏ quên) rồi ngày giao gần nhất; còn lại: ngày giao mới nhất trước
  const rows = useMemo(() => days
    .filter(d => show === 'all' || (show === 'open' ? dayOpen(d) : show === 'confirmed' ? dayConfirmed(d) : d.discarded))
    .sort((a, b) => (show === 'open' ? a.plan_date.localeCompare(b.plan_date) : b.plan_date.localeCompare(a.plan_date)) || a.key.localeCompare(b.key)), [days, show])
  const overdueN = rows.filter(d => d.plan_date < today && dayOpen(d)).length
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* lọc nhanh theo trạng thái — số của từng lựa chọn thấy ngay (khuôn switch 17/09); một hàng ở mọi màn */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto no-scrollbar border-b bg-white px-3 py-1.5 [&>*]:shrink-0">
        {SHOW.map(o => (
          <button key={o.k} type="button" title={o.tip} aria-pressed={show === o.k} onClick={() => setShow(o.k)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 h-9 sm:h-7 text-[11px] font-medium whitespace-nowrap ${show === o.k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {o.label}<span className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${show === o.k ? 'bg-white/25 text-white' : 'bg-white text-slate-500'}`}>{nf(counts[o.k])}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-20 lg:pb-0">
        {/* v3 (19/10): thêm cột "Tiến độ xe" — đổi khoá để bề rộng cột đã lưu không lệch cột (cột mới bị bóp còn vài chục px, chữ cắt); v4: cột nút rộng thêm cho "Lịch sử" */}
        <ResizableTable storageKey={`dispatch_plans_v4${desktop ? '' : '_m'}`} cols={cols}>
          <TableBody>
            {error && <TableEmptyRow colSpan={cols.length}><span className="text-red-600">Không tải được danh sách kế hoạch: {error}</span></TableEmptyRow>}
            {!error && loading && !rows.length && <TableEmptyRow colSpan={cols.length}>Đang tải…</TableEmptyRow>}
            {!error && !loading && !rows.length && <TableEmptyRow colSpan={cols.length}>{show === 'open' ? 'Kho này không còn kế hoạch nào đang mở — mọi kế hoạch đã xác nhận hoặc đã bỏ.' : 'Không có kế hoạch nào ở trạng thái này.'}</TableEmptyRow>}
            {rows.map(d => {
              const open = dayOpen(d)
              const holds = d.discarded ? true : d.plans.some(p => planHoldsOrders(p.summary))
              const cur = d.plans.some(p => p.id === currentPlanId)
              const bg = cur ? 'bg-sky-50' : 'bg-white'
              const pool = sum(d, p => Math.max(0, (p.summary?.pool_ods ?? 0) - (p.summary?.unreviewed_ods ?? 0)))
              const freight = d.plans.some(p => p.summary?.freight_total != null) ? sum(d, p => p.summary?.freight_total) : null
              const first = [...d.plans].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
              const lastCf = d.plans.filter(p => p.confirmed_at).sort((a, b) => (b.confirmed_at ?? '').localeCompare(a.confirmed_at ?? ''))[0] ?? null
              const busy = d.plans.some(p => p.id === busyId)
              const hasConfirmed = !d.discarded && d.plans.some(p => p.status === 'CONFIRMED')
              const hasConfirmedTrips = !d.discarded && d.plans.some(p => (p.status === 'CONFIRMED' || p.status === 'TENDERED') && (p.summary?.confirmed ?? 0) > 0)
              return (
                <TableRow key={d.key} className={`cursor-pointer hover:bg-slate-50 ${bg} ${holds && !d.discarded ? '' : 'text-slate-400'}`} onClick={() => onOpen(d)}
                  title={d.discarded ? 'Kế hoạch đã bỏ — bấm để xem (chỉ xem)' : holds ? 'Bấm dòng để mở ngày này — bàn chuyển mảng bằng Bán hàng | Trung chuyển' : 'Nháp chỉ chứa đơn Chờ điều (bấm Xem đơn rồi để đó) — không giữ đơn nào'}>
                  <TableCell className={`${TD} sticky left-0 z-10 font-semibold ${bg} ${holds && !d.discarded ? 'text-slate-800' : ''}`}>{formatDate(d.plan_date)}</TableCell>
                  <TableCell className={TD}><SegCell p={d.sales} today={today} /></TableCell>
                  <TableCell className={TD}><SegCell p={d.transfer} today={today} /></TableCell>
                  <TableCell className={`${TD} text-right tabular-nums`}>{nf(sum(d, p => p.summary?.trips))}</TableCell>
                  <TableCell className={`${TD} text-right tabular-nums`}>{nf(sum(d, p => p.summary?.ods))}</TableCell>
                  <TableCell className={TD}><DayProgress d={d} today={today} /></TableCell>
                  <TableCell className={`${TD} text-right tabular-nums`} title="Đơn đã vào kế hoạch nhưng chưa lên xe (cả hai mảng)">{nf(pool)}</TableCell>
                  <TableCell className={`${TD} text-right tabular-nums`}>{nf(sum(d, p => p.summary?.pallets), 1)}</TableCell>
                  <TableCell className={`${TD} text-right tabular-nums`} title={freight != null ? `${freight.toLocaleString('vi-VN')} ₫` : ''}>{money(freight)}</TableCell>
                  <TableCell className={`${TD} truncate`} title={first?.created_by ?? ''}>{first?.created_by || <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={`${TD} tabular-nums`}>{first ? <>{formatTimestampDate(first.created_at, true)} {formatTimestampTime(first.created_at, false)}</> : '—'}</TableCell>
                  <TableCell className={`${TD} truncate`} title={lastCf?.confirmed_by ?? ''}>{lastCf?.confirmed_at ? <>{lastCf.confirmed_by || '—'} <span className="text-slate-400">{formatTimestampDate(lastCf.confirmed_at, true)} {formatTimestampTime(lastCf.confirmed_at, false)}</span></> : <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={`${TD} text-right ${desktop ? `sticky right-0 z-10 ${bg}` : ''}`} onClick={e => e.stopPropagation()}>
                    <span className="inline-flex items-center gap-2">
                      <button type="button" className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline" onClick={() => onOpen(d)}><LayoutGrid className="h-3 w-3" />Mở</button>
                      <button type="button" className="inline-flex items-center gap-1 font-medium text-slate-700 hover:underline" onClick={() => onHistory(d)} data-plan-history-btn={d.key}
                        title="Mở tab Lịch sử đã lọc ngày này — ai lập / xác nhận / mở lại / bỏ kế hoạch, và mọi thao tác trên từng Số xe (kể cả xe đã bỏ / đã xoá)"><History className="h-3 w-3" />Lịch sử</button>
                      {/* SỬA (16/10): nạp đơn chờ của CẢ HAI mảng vào khung chờ, sang bàn — xe đã chốt hiện ổ khoá, mở khoá xe nào thì xe đó về nháp */}
                      {canPlan && hasConfirmed && <button type="button" className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline disabled:opacity-50" disabled={busy} onClick={() => onEdit(d)} title="Nạp đơn chờ của ngày (cả Bán hàng lẫn Trung chuyển) vào khung chờ rồi sang Bàn ghép xe; xe đã vào Kế hoạch xuất tô tím + ổ khoá — mở khoá xe cần sửa"><Pencil className="h-3 w-3" />{busy ? 'Đang nạp…' : 'Sửa'}</button>}
                      {/* XOÁ (23/10) — cả hai mảng; xe đã vào Kế hoạch xuất cần quyền xác nhận (gỡ dòng Kế hoạch xuất) */}
                      {!d.discarded && canPlan && (!hasConfirmedTrips || canConfirm) && <button type="button" className="inline-flex items-center gap-1 font-medium text-red-700 hover:underline disabled:opacity-50" disabled={busy} onClick={() => onDelete(d)} title="Xoá kế hoạch làm nhầm (cả hai mảng) — đơn về Chờ điều; xe đã vào Kế hoạch xuất: chuyến bên Xuất ngừng (giữ lại), khung giờ nhả. Bên Xuất đã bắt đầu / quét / nhặt lẻ thì không xoá được — kho gỡ trước">
                        <Trash2 className="h-3 w-3" />{busy ? 'Đang xoá…' : 'Xoá'}</button>}
                    </span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </ResizableTable>
      </div>
      <ListFooter page={1} pageSize={Math.max(1, rows.length)} total={rows.length} unit="ngày" onPageSize={() => { }} options={[]}
        right={`${overdueN ? `${nf(overdueN)} ngày có nháp quá ngày · ` : ''}mỗi dòng một ngày, cột Bán hàng · Trung chuyển là hai mảng của ngày đó — bấm dòng để mở; "Sửa" kế hoạch đã xác nhận = mở khoá từng xe trên bàn`} />
    </div>
  )
}
