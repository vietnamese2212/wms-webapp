// CHUỖI TÌNH TRẠNG XE — "document flow" kiểu SAP cho MỘT Số xe (18/10/2026, user: "tình trạng này xem được ở mọi nơi có liên quan,
// bao gồm cả số chứng từ để khi cần đi search, và có thể mở ra nó từ đó — không chỉ tab Kế hoạch mà cả Xuất, Booking…").
// Một component, hai dạng: `compact` = một hàng 8 chấm (bước đang đứng in chữ) đặt trên dòng bảng / thẻ xe; `full` = bảng dọc 8 bước
// (số chứng từ · giờ · ai · ghi chú · nút Mở) cho panel chi tiết. Dữ liệu một nguồn: `useTripFlow(code)` (gom lô, realtime).
// Bước "Đã giao" của đơn bán hàng có nút cho tài xế / ĐVVT / điều vận (quyền tms_plan.confirm_delivery) — chỉ khi chuyến đã xuất xong.
import { useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { ClipboardList, FileCheck2, CalendarClock, LogIn, Scale, PackageMinus, LogOut, PackageCheck, ExternalLink, Undo2, type LucideIcon } from 'lucide-react'
import { useTripFlow, useConfirmDelivery, type TripFlow as Flow, type TripFlowStep, type TripFlowKey, type TripFlowState } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useCanSeePath } from '@/hooks/useCanSeePath'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { can } from '@/config/permissions'
import { formatDateTime } from '@/utils/formatters'

const ICON: Record<TripFlowKey, LucideIcon> = { PLAN: ClipboardList, KHVC: FileCheck2, BOOKING: CalendarClock, GATE_IN: LogIn, WEIGH: Scale, OUTBOUND: PackageMinus, GATE_OUT: LogOut, DELIVERED: PackageCheck }
const NAME: Record<TripFlowKey, string> = { PLAN: 'Kế hoạch', KHVC: 'KH xuất', BOOKING: 'Khung giờ', GATE_IN: 'Vào cổng', WEIGH: 'Cân', OUTBOUND: 'Xuất kho', GATE_OUT: 'Ra cổng', DELIVERED: 'Giao hàng' }
// tone theo NGỮ NGHĨA (StatusBadge): done = xanh lá · active = hổ phách · blocked = đỏ · pending = xám · off = xám nhạt gạch
const DOT: Record<TripFlowState, string> = {
  done: 'bg-green-500 text-white', active: 'bg-amber-400 text-amber-950 ring-2 ring-amber-200', pending: 'bg-slate-200 text-slate-500', off: 'bg-slate-100 text-slate-300', blocked: 'bg-red-500 text-white',
}
const TEXT: Record<TripFlowState, string> = { done: 'text-green-700', active: 'text-amber-700', pending: 'text-slate-500', off: 'text-slate-400 line-through', blocked: 'text-red-700' }
const PATH: Record<NonNullable<TripFlowStep['ref']>['kind'], string> = { plan: '/tms/dispatch', khvc: '/external', order: '/tms/bookings', gate: '/tms/gate', weigh: '/wms/weigh-tickets', gdo: '/wms/outbound', transfer: '/tms/bookings' }
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không thực hiện được'

/** Mở trang đích của một bước: đặt bộ lọc của trang đó (ngày · Số xe / số chứng từ) rồi điều hướng — trang nào cũng tìm ra đúng dòng. */
function useOpenStep(flow: Flow | null | undefined) {
  const navigate = useNavigate()
  const canSee = useCanSeePath()
  const st = useWmsFilterStore.getState
  return (s: TripFlowStep): (() => void) | null => {
    if (!s.ref || !flow) return null
    const { kind, id, date } = s.ref
    if (!canSee(PATH[kind])) return null
    const gc = flow.group_code
    switch (kind) {
      case 'plan': return () => { st().setDispatch({ warehouseId: flow.warehouse_id ?? '', planId: id, planDate: date ?? '', tab: 'board', search: gc }); navigate('/tms/dispatch') }
      case 'khvc': return () => { st().setKhvc({ group: gc, search: '', exportFrom: date ?? '', exportTo: date ?? '', page: 1 }); navigate('/external?tab=khvc') }
      case 'order': return () => { st().setTmsBookings({ search: gc, tab: 'main', page: 1, ...(date ? { dateFrom: date, dateTo: date } : {}) }); navigate('/tms/bookings') }
      case 'transfer': return () => { st().setTmsBookings({ search: gc, tab: 'transfer', page: 1, ...(date ? { dateFrom: date, dateTo: date } : {}) }); navigate('/tms/bookings') }
      case 'gate': return () => { if (date) st().setGateRegistration({ fDate: date, fDateTo: date }); navigate('/tms/gate') }
      case 'weigh': return () => { st().setWeighTickets({ search: s.doc && s.doc !== '(không số)' ? s.doc : gc, ...(date ? { from_date: date, to_date: date } : {}) }); navigate('/wms/weigh-tickets') }
      case 'gdo': return () => navigate(`/wms/outbound/${id}`)
    }
  }
}

function stepTip(s: TripFlowStep) {
  return [`${NAME[s.key]}: ${s.label}`, s.doc ? `Chứng từ: ${s.doc}` : '', s.at ? `Lúc ${formatDateTime(s.at)}` : '', s.by ? `Bởi ${s.by}` : '', s.note ?? ''].filter(Boolean).join('\n')
}

/** Nút "Đã giao" / "Hoàn tác" cho đơn bán hàng — tài xế / ĐVVT / điều vận ghi hộ (quyền confirm_delivery), chỉ khi chuyến đã xuất xong. */
function DeliverButton({ flow, size = 'sm' }: { flow: Flow; size?: 'sm' | 'xs' }) {
  const user = useAuthStore(s => s.user)
  const perms = user?.module_permissions
  const [ask, confirmNode] = useConfirmDialog()
  const m = useConfirmDelivery()
  const d = flow.delivery
  if (d.kind !== 'SALES' || !d.slot_id || !can(perms, 'tms_plan', 'confirm_delivery')) return null
  if (!d.delivered_at && !d.ready) return null
  const h = size === 'xs' ? 'h-6 text-[10px] px-1.5' : 'h-8 text-xs'
  const go = async () => {
    if (d.delivered_at) {
      if (await ask({ title: `Hoàn tác "Đã giao" của xe ${flow.group_code}?`, body: `Đã ghi bởi ${d.delivered_by ?? '—'} lúc ${d.delivered_at ? formatDateTime(d.delivered_at) : '—'}.`, danger: true, confirmLabel: 'Hoàn tác' }) === null) return
      m.mutateAsync({ slot_id: d.slot_id!, undo: true }).then(() => toast({ title: `Đã hoàn tác "Đã giao" — xe ${flow.group_code}` })).catch(e => toast({ variant: 'destructive', title: 'Không hoàn tác được', description: apiMsg(e) }))
      return
    }
    const note = await ask({ title: `Xe ${flow.group_code} đã giao hàng cho khách?`, body: 'Ghi mốc "Đã giao" vào dòng xe — bước cuối của chuỗi tình trạng xe. Bấm nhầm thì "Hoàn tác" ngay tại đây.', confirmLabel: 'Đã giao', input: { label: 'Ghi chú (tuỳ chọn)', placeholder: 'Người nhận, giờ giao…' } })
    if (note === null) return
    m.mutateAsync({ slot_id: d.slot_id!, note: note.trim() || undefined }).then(() => toast({ title: `Đã ghi "Đã giao" — xe ${flow.group_code}` })).catch(e => toast({ variant: 'destructive', title: 'Không ghi được "Đã giao"', description: apiMsg(e) }))
  }
  return (
    <>
      {d.delivered_at
        ? <Button type="button" size="sm" variant="outline" className={`${h} border-slate-300 text-slate-600`} disabled={m.isPending} onClick={() => void go()} title="Bấm nhầm — gỡ mốc đã giao"><Undo2 className="mr-1 h-3 w-3" />Hoàn tác</Button>
        : <Button type="button" size="sm" className={`${h} bg-green-600 hover:bg-green-700`} disabled={m.isPending} onClick={() => void go()} title="Tài xế / ĐVVT xác nhận hàng đã tới tay khách"><PackageCheck className="mr-1 h-3.5 w-3.5" />{m.isPending ? 'Đang ghi…' : 'Đã giao'}</Button>}
      {confirmNode}
    </>
  )
}

/** Dạng GỌN — một hàng 8 chấm, bước đang đứng in chữ; bấm chấm = mở trang đích (nếu người xem mở được trang đó). */
function Compact({ flow, className }: { flow: Flow; className?: string }) {
  const open = useOpenStep(flow)
  const cur = flow.current
  return (
    <span className={`inline-flex items-center gap-0.5 whitespace-nowrap align-middle ${className ?? ''}`} title={flow.steps.map(stepTip).join('\n\n')} data-trip-flow={flow.group_code}>
      {flow.steps.map(s => {
        const Icon = ICON[s.key]
        const go = open(s)
        const isCur = s.key === cur
        const inner = <><Icon className="h-2.5 w-2.5" />{isCur && <span className="ml-0.5 text-[9px] font-semibold leading-none">{s.label}</span>}</>
        const cls = `inline-flex h-4 items-center rounded-full px-1 ${DOT[s.state]} ${go ? 'cursor-pointer hover:ring-2 hover:ring-sky-300' : ''}`
        return go
          ? <button key={s.key} type="button" className={cls} title={stepTip(s)} aria-label={`${NAME[s.key]}: ${s.label} — mở`} onClick={e => { e.stopPropagation(); go() }}>{inner}</button>
          : <span key={s.key} className={cls} title={stepTip(s)} aria-label={`${NAME[s.key]}: ${s.label}`}>{inner}</span>
      })}
    </span>
  )
}

/** Dạng ĐẦY ĐỦ — bảng dọc 8 bước: bước · tình trạng · số chứng từ · lúc · ai · ghi chú · Mở. */
function Full({ flow, className }: { flow: Flow; className?: string }) {
  const open = useOpenStep(flow)
  return (
    <div className={`rounded-md border border-slate-200 bg-white ${className ?? ''}`} data-trip-flow={flow.group_code}>
      <div className="flex items-center justify-between gap-2 border-b bg-slate-50 px-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Hành trình xe <span className="font-mono normal-case text-slate-700">{flow.group_code}</span></span>
        <DeliverButton flow={flow} size="xs" />
      </div>
      <ol className="divide-y divide-slate-100">
        {flow.steps.map(s => {
          const Icon = ICON[s.key]
          const go = open(s)
          return (
            <li key={s.key} className="flex items-start gap-2 px-2 py-1 text-[11px]">
              <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${DOT[s.state]}`}><Icon className="h-2.5 w-2.5" /></span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="font-medium text-slate-700">{NAME[s.key]}</span>
                  <span className={`font-semibold ${TEXT[s.state]}`}>{s.label}</span>
                  {s.doc && <span className="font-mono text-[10px] text-slate-600">{s.doc}</span>}
                  {go && <button type="button" className="inline-flex items-center gap-0.5 text-[10px] font-medium text-sky-700 hover:underline" onClick={go}><ExternalLink className="h-2.5 w-2.5" />Mở</button>}
                </div>
                {(s.at || s.by || s.note) && (
                  <div className="text-[10px] text-slate-500">
                    {s.at && <span className="font-mono">{formatDateTime(s.at)}</span>}{s.at && s.by && ' · '}{s.by}{(s.at || s.by) && s.note && ' · '}{s.note}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function TripFlow({ code, mode = 'compact', className, enabled = true }: { code: string | null | undefined; mode?: 'compact' | 'full'; className?: string; enabled?: boolean }) {
  const q = useTripFlow(code, enabled)
  if (!code || !enabled) return null
  if (q.isError) return <span className={`text-[10px] text-red-600 ${className ?? ''}`} title={apiMsg(q.error)}>Không tải được hành trình</span>
  if (!q.data) return q.isLoading ? <span className={`inline-block h-4 w-24 animate-pulse rounded bg-slate-100 ${className ?? ''}`} aria-label="Đang tải hành trình xe" /> : null
  return mode === 'full' ? <Full flow={q.data} className={className} /> : <Compact flow={q.data} className={className} />
}

/** Tiến độ gộp của NHIỀU xe (tab Kế hoạch: một ngày / một kế hoạch): đếm theo bước đang đứng. */
export function tripFlowProgress(flows: Flow[]): { total: number; shipped: number; delivered: number; inWh: number; booked: number; stuck: number } {
  const out = { total: flows.length, shipped: 0, delivered: 0, inWh: 0, booked: 0, stuck: 0 }
  for (const f of flows) {
    const st = (k: TripFlowKey) => f.steps.find(s => s.key === k)?.state
    if (st('DELIVERED') === 'done') out.delivered++
    if (st('OUTBOUND') === 'done') out.shipped++
    else if (st('OUTBOUND') === 'active') out.inWh++
    if (st('BOOKING') === 'done') out.booked++
    if (f.steps.some(s => s.state === 'blocked')) out.stuck++
  }
  return out
}

/** Hàng chữ ngắn "k/N đã xuất · j đã giao" — dùng cho ô của tab Kế hoạch. */
export function TripFlowProgressText({ flows }: { flows: Flow[] }) {
  const p = tripFlowProgress(flows)
  if (!p.total) return null
  return (
    <span className="inline-flex items-center gap-1 text-[10px] tabular-nums" title={`Trong ${p.total} xe đã chốt: ${p.booked} đã đặt khung giờ · ${p.inWh} đang xuất · ${p.shipped} đã xuất xong · ${p.delivered} đã giao${p.stuck ? ` · ${p.stuck} xe có bước ngừng / huỷ` : ''}`}>
      <span className={p.shipped === p.total ? 'text-green-700 font-semibold' : 'text-slate-600'}>{p.shipped}/{p.total} đã xuất</span>
      <span className="text-slate-300">·</span>
      <span className={p.delivered === p.total ? 'text-green-700 font-semibold' : 'text-slate-600'}>{p.delivered} đã giao</span>
      {p.inWh > 0 && <><span className="text-slate-300">·</span><span className="text-amber-700">{p.inWh} đang xuất</span></>}
      {p.stuck > 0 && <><span className="text-slate-300">·</span><span className="text-red-700">{p.stuck} ngừng</span></>}
    </span>
  )
}
