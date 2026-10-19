// CHUỖI TÌNH TRẠNG XE — "document flow" kiểu SAP cho MỘT Số xe (18/10/2026, user: "tình trạng này xem được ở mọi nơi có liên quan,
// bao gồm cả số chứng từ để khi cần đi search, và có thể mở ra nó từ đó — không chỉ tab Kế hoạch mà cả Xuất, Booking…").
// 19/10 (user chốt lại): KHÔNG trải chuỗi chấm trên dòng — mỗi chỗ cầm Số xe chỉ có MỘT NÚT WORKFLOW NHỎ (như nút workflow của SAP);
// bấm thì mở popup một BẢNG 8 bước: bước · tình trạng · chứng từ · ai làm · lúc nào · ghi chú · nút Mở sang sổ đó.
// Dữ liệu chỉ tải KHI MỞ popup (`useTripFlow(code, open)`) — bảng 50 dòng không tốn request nào cho tới khi có người bấm; realtime giữ
// popup đang mở luôn đúng. Bước "Đã giao" của đơn bán hàng có nút cho tài xế / ĐVVT / điều vận (quyền tms_plan.confirm_delivery).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { ClipboardList, FileCheck2, CalendarClock, LogIn, Scale, PackageMinus, LogOut, PackageCheck, ExternalLink, Undo2, Workflow, type LucideIcon } from 'lucide-react'
import { useTripFlow, useConfirmDelivery, type TripFlow as Flow, type TripFlowStep, type TripFlowKey, type TripFlowState } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useCanSeePath } from '@/hooks/useCanSeePath'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { StatusBadge, type BadgeTone } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { toast } from '@/components/ui/use-toast'
import { can } from '@/config/permissions'
import { formatDateTime } from '@/utils/formatters'

const ICON: Record<TripFlowKey, LucideIcon> = { PLAN: ClipboardList, KHVC: FileCheck2, BOOKING: CalendarClock, GATE_IN: LogIn, WEIGH: Scale, OUTBOUND: PackageMinus, GATE_OUT: LogOut, DELIVERED: PackageCheck }
const NAME: Record<TripFlowKey, string> = { PLAN: 'Kế hoạch', KHVC: 'KH xuất', BOOKING: 'Khung giờ', GATE_IN: 'Vào cổng', WEIGH: 'Cân', OUTBOUND: 'Xuất kho', GATE_OUT: 'Ra cổng', DELIVERED: 'Giao hàng' }
const SHEET: Record<TripFlowKey, string> = { PLAN: 'Bàn ghép xe (Điều vận)', KHVC: 'Kế hoạch xuất', BOOKING: 'Đặt lịch (lệnh VC)', GATE_IN: 'Đăng ký cổng', WEIGH: 'Phiếu cân', OUTBOUND: 'Chuyến Xuất kho', GATE_OUT: 'Đăng ký cổng', DELIVERED: 'Tài xế / ĐVVT xác nhận (chuyển kho: kho nhận)' }
// tone theo NGỮ NGHĨA (StatusBadge): done = xanh lá · active = hổ phách · blocked = đỏ · pending / off = xám
const TONE: Record<TripFlowState, BadgeTone> = { done: 'green', active: 'amber', pending: 'slate', off: 'slate', blocked: 'red' }
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

/** Nút "Đã giao" / "Hoàn tác" cho đơn bán hàng — tài xế / ĐVVT / điều vận ghi hộ (quyền confirm_delivery), chỉ khi chuyến đã xuất xong. */
function DeliverButton({ flow }: { flow: Flow }) {
  const user = useAuthStore(s => s.user)
  const perms = user?.module_permissions
  const [ask, confirmNode] = useConfirmDialog()
  const m = useConfirmDelivery()
  const d = flow.delivery
  if (d.kind !== 'SALES' || !d.slot_id || !can(perms, 'tms_plan', 'confirm_delivery')) return null
  if (!d.delivered_at && !d.ready) return null
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
        ? <Button type="button" size="sm" variant="outline" className="h-8 text-xs border-slate-300 text-slate-600" disabled={m.isPending} onClick={() => void go()} title="Bấm nhầm — gỡ mốc đã giao"><Undo2 className="mr-1 h-3 w-3" />Hoàn tác</Button>
        : <Button type="button" size="sm" className="h-8 text-xs bg-green-600 hover:bg-green-700" disabled={m.isPending} onClick={() => void go()} title="Tài xế / ĐVVT xác nhận hàng đã tới tay khách"><PackageCheck className="mr-1 h-3.5 w-3.5" />{m.isPending ? 'Đang ghi…' : 'Đã giao'}</Button>}
      {confirmNode}
    </>
  )
}

const TD = 'px-2 py-1 text-[11px] whitespace-nowrap truncate'
const COLS: RtColDef[] = [
  { id: 'step', label: 'Bước', w: 110 }, { id: 'state', label: 'Tình trạng', w: 120 }, { id: 'doc', label: 'Chứng từ', w: 150 },
  { id: 'by', label: 'Người làm', w: 120 }, { id: 'at', label: 'Thời gian', w: 125 }, { id: 'note', label: 'Ghi chú', w: 200 }, { id: 'open', label: '', w: 48 },
]

/** Bảng 8 bước trong popup: bước · tình trạng · chứng từ · người làm · thời gian · ghi chú · Mở. */
function FlowTable({ flow, onNavigate }: { flow: Flow; onNavigate: () => void }) {
  const open = useOpenStep(flow)
  return (
    <ResizableTable storageKey="trip_flow_v1" cols={COLS}>
      <TableBody>
        {flow.steps.map(s => {
          const Icon = ICON[s.key]
          const go = open(s)
          const cur = s.key === flow.current
          const dim = s.state === 'off' || s.state === 'pending'
          const bg = cur ? 'bg-amber-50' : 'bg-white'
          return (
            <TableRow key={s.key} className={bg} data-flow-step={s.key}>
              <TableCell className={`${TD} sticky left-0 z-10 ${bg} font-medium ${dim ? 'text-slate-400' : 'text-slate-800'}`} title={SHEET[s.key]}>
                <span className="inline-flex items-center gap-1.5"><Icon className="h-3 w-3" />{NAME[s.key]}</span>
              </TableCell>
              <TableCell className={TD}><StatusBadge tone={TONE[s.state]} className={s.state === 'off' ? 'line-through' : ''}>{s.label}</StatusBadge></TableCell>
              <TableCell className={`${TD} font-mono font-semibold`} title={s.doc ?? undefined}>{s.doc ?? <span className="text-slate-300">—</span>}</TableCell>
              <TableCell className={TD} title={s.by ?? undefined}>{s.by ?? <span className="text-slate-300">—</span>}</TableCell>
              <TableCell className={`${TD} font-mono text-[10px]`}>{s.at ? formatDateTime(s.at) : <span className="text-slate-300">—</span>}</TableCell>
              <TableCell className={`${TD} text-slate-500`} title={s.note ?? undefined}>{s.note ?? <span className="text-slate-300">—</span>}</TableCell>
              <TableCell className={TD}>
                {go && <button type="button" className="inline-flex items-center gap-0.5 text-[10px] font-medium text-sky-700 hover:underline" title={`Mở ${SHEET[s.key]} đúng Số xe / ngày này`} onClick={() => { onNavigate(); go() }}><ExternalLink className="h-2.5 w-2.5" />Mở</button>}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </ResizableTable>
  )
}

/** Popup "Tình trạng xe": tải chuỗi KHI MỞ; realtime cập nhật khi bất kỳ sổ nào đổi. */
function FlowDialog({ code, open, onOpenChange }: { code: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const q = useTripFlow(code, open)
  const f = q.data
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 gap-0" data-trip-flow-dialog={code}>
        <div className="px-4 pt-3 pb-2 pr-10 border-b">
          <DialogTitle className="text-sm font-semibold text-slate-800">Tình trạng xe <span className="font-mono">{code}</span></DialogTitle>
          <DialogDescription className="text-[11px] text-slate-500">Hành trình chứng từ của Số xe qua 8 sổ — mỗi dòng là một sổ, "Mở" đưa tới đúng dòng trong sổ đó.</DialogDescription>
        </div>
        <div className="overflow-x-auto">
          {q.isError && <p className="px-4 py-3 text-xs text-red-600">Không tải được hành trình: {apiMsg(q.error)}</p>}
          {!q.isError && !f && (q.isLoading ? <p className="px-4 py-3 text-xs text-slate-500">Đang tải…</p> : <p className="px-4 py-3 text-xs text-slate-500">Không có hành trình cho Số xe này (chưa vào kế hoạch hoặc ngoài phạm vi của bạn).</p>)}
          {f && <FlowTable flow={f} onNavigate={() => onOpenChange(false)} />}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t bg-slate-50 rounded-b-xl">
          {f && <DeliverButton flow={f} />}
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => onOpenChange(false)}>Đóng</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** NÚT WORKFLOW nhỏ (mặc định: chỉ icon 20 px đứng cạnh Số xe; `label` = nút có chữ cho panel / trang chi tiết). Bấm = mở popup bảng. */
export function TripFlow({ code, label, className }: { code: string | null | undefined; label?: boolean; className?: string }) {
  const [open, setOpen] = useState(false)
  if (!code) return null
  const cls = label
    ? `inline-flex h-7 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50 ${className ?? ''}`
    : `inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-sky-700 hover:bg-sky-100 align-middle ${className ?? ''}`
  return (
    <>
      <button type="button" className={cls} title="Tình trạng xe — hành trình chứng từ (kế hoạch → KH xuất → khung giờ → cổng → cân → xuất kho → ra cổng → giao)" aria-label={`Tình trạng xe ${code}`} data-trip-flow={code}
        onClick={e => { e.stopPropagation(); e.preventDefault(); setOpen(true) }}>
        <Workflow className="h-3.5 w-3.5" />{label && 'Tình trạng xe'}
      </button>
      {/* popup portal ra body nhưng sự kiện React vẫn nổi lên dòng bảng / thẻ xe đang bọc nút ⇒ chặn tại đây (bấm trong popup không chọn dòng / mở chi tiết) */}
      {open && <span className="contents" onClick={stop} onDoubleClick={stop} onPointerDown={stop} onMouseDown={stop}><FlowDialog code={code} open={open} onOpenChange={setOpen} /></span>}
    </>
  )
}
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

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
