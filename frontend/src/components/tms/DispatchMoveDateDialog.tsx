// ĐỔI NGÀY ngay trên bàn (19/10, user: "nên đổi được ngày dễ như bên Kế hoạch (Dữ liệu bên ngoài)" — chốt: Số xe GIỮ NGUYÊN, xe đã đặt
// khung giờ vẫn cho đổi kèm nhả khung có cảnh báo). Hai mức, cùng một hộp:
//   • CẢ XE: POST /tms/dispatch/plans/:id/move-date — xe (đơn · ĐVVT · dòng xe) sang kế hoạch ngày mới (lập nếu chưa có); Kế hoạch xuất đổi
//     ngày xuất; chuyến Xuất kho + lệnh VC dội theo; khung giờ đã đặt bị nhả. Xe có chuyến đang xuất / đã quét / đã hoàn thành bị chừa, nêu lý do.
//   • TỪNG ĐƠN (đơn rớt không bốc): trang cha dàn ba bước sẵn có — mở lại xe → hoãn đơn tới ngày → xác nhận lại xe với phần còn lại
//     (cùng Số xe sống lại, khung giờ giữ). Đơn về Chờ điều của ngày mới kèm dấu hoãn + lý do.
// Vết: outbound_events PLAN_DATE_CHANGED / PLAN_OD_HELD (ai · lúc nào · lý do) — hiện trong popup tình trạng xe.
import { useEffect, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import type { AxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'
import { useMoveDispatchTripsDate, type DispatchPlan, type DispatchTrip } from '@/api/hooks'
import { formatDate } from '@/utils/formatters'

export type MoveDateTarget = { kind: 'trips'; trips: DispatchTrip[] } | { kind: 'ods'; trip: DispatchTrip; odNumbers: string[] }
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không thực hiện được'
const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const nextDay = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }

export function DispatchMoveDateDialog({ plan, target, onClose, onMoveOds }: {
  plan: DispatchPlan; target: MoveDateTarget | null; onClose: () => void
  /** đổi ngày TỪNG ĐƠN — trang cha dàn: mở lại xe → hoãn đơn → xác nhận lại (ném lỗi thì hộp giữ nguyên để sửa) */
  onMoveOds?: (trip: DispatchTrip, odNumbers: string[], date: string, reason?: string) => Promise<void>
}) {
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const move = useMoveDispatchTripsDate()
  useEffect(() => { setDate(''); setReason(''); setBusy(false) }, [target])
  const open = !!target
  const isOds = target?.kind === 'ods'
  const trips = target?.kind === 'trips' ? target.trips : target ? [target.trip] : []
  const minDate = isOds ? nextDay(plan.plan_date) : todayVN()
  const confirmedN = trips.filter(t => t.status === 'CONFIRMED').length
  const go = async () => {
    if (!target || !date) return
    setBusy(true)
    try {
      if (target.kind === 'ods') {
        await onMoveOds?.(target.trip, target.odNumbers, date, reason.trim() || undefined)
        onClose(); return
      }
      const r = await move.mutateAsync({ plan_id: plan.id, trip_ids: target.trips.map(t => t.id), new_date: date, reason: reason.trim() || undefined })
      const m = r.moved
      toast({
        title: `Đã dời ${m.trips} xe sang ${formatDate(date)}${m.blocked.length ? ` · ${m.blocked.length} xe bị chừa` : ''}`,
        description: [
          m.target_created ? `Đã lập kế hoạch ${formatDate(date)} (${m.target_status === 'CONFIRMED' ? 'đã xác nhận' : 'nháp'}) cho các xe này.` : `Xe nằm ở kế hoạch ${formatDate(date)} đang có.`,
          m.slots_released ? `Đã nhả ${m.slots_released} khung giờ — ĐVVT đặt lại ở ngày mới.` : '',
          m.blocked.map(b => `#${b.seq} ${b.group_code}: ${b.reason}`).join('\n'),
          m.replan_error ? `Lỗi dội chuyến: ${m.replan_error}` : '',
        ].filter(Boolean).join('\n'),
        variant: m.blocked.length && !m.trips ? 'destructive' : undefined,
      })
      onClose()
    } catch (e) { toast({ variant: 'destructive', title: 'Không đổi được ngày', description: apiMsg(e) }) }
    finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm flex items-center gap-1.5"><CalendarClock className="h-4 w-4 text-sky-600" /> {isOds ? 'Đổi ngày đơn' : trips.length > 1 ? `Đổi ngày ${trips.length} xe` : 'Đổi ngày cả xe'}</DialogTitle></DialogHeader>
        {target && (
          <div className="space-y-3 text-xs">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 space-y-0.5">
              {isOds
                ? <><div><b>{target.odNumbers.length}</b> đơn: <span className="font-mono">{target.odNumbers.join(', ')}</span></div><div className="text-slate-600">đang trên xe <span className="font-mono font-semibold">#{target.trip.seq} {target.trip.group_code}</span> · kế hoạch {formatDate(plan.plan_date)}</div></>
                : trips.map(t => <div key={t.id}><span className="rounded bg-sky-700 px-1 font-mono text-[10px] font-bold text-white">#{t.seq}</span> <span className="font-mono font-semibold">{t.group_code}</span> <span className="text-slate-500">· {t.detail.vehicle_model?.name ?? 'chưa chọn dòng xe'} · {new Set(t.ods.map(o => o.od_number)).size} OD · {t.detail.carrier?.name ?? 'chưa có ĐVVT'}</span></div>)}
            </div>
            <label className="block">
              <span className="font-medium text-slate-700">Sang ngày</span>
              <input type="date" value={date} min={minDate} disabled={busy} onChange={e => setDate(e.target.value)} className="mt-1 h-9 w-full rounded border border-slate-300 px-2 text-sm" />
              {isOds && <span className="mt-0.5 block text-[10px] text-slate-500">Đơn lẻ chỉ hoãn tới ngày SAU {formatDate(plan.plan_date)}; hôm đó lập kế hoạch thì đơn về Chờ điều kèm dấu hoãn.</span>}
            </label>
            <label className="block">
              <span className="font-medium text-slate-700">Lý do (ghi vào lịch sử xe)</span>
              <input type="text" value={reason} maxLength={500} disabled={busy} onChange={e => setReason(e.target.value)} placeholder={isOds ? 'Xe tới không bốc, khách hẹn lại…' : 'Khách hẹn lại, xe hỏng…'} className="mt-1 h-9 w-full rounded border border-slate-300 px-2 text-sm" />
            </label>
            <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900 space-y-0.5">
              {isOds ? (
                <>
                  <div>Xe <b>mở lại</b>, đơn rút ra và <b>hoãn</b> tới ngày chọn, xe <b>xác nhận lại</b> với phần còn lại — cùng Số xe, khung giờ giữ.</div>
                  <div>Chuyến đang có hàng đã quét: hỏi thêm một lần; đơn đã quét thì không gỡ được.</div>
                </>
              ) : (
                <>
                  <div><b>Số xe giữ nguyên.</b> Kế hoạch xuất, chuyến Xuất kho, lệnh VC đổi ngày theo.</div>
                  <div><b>Khung giờ đã đặt bị nhả</b> (khung gắn ngày) — ĐVVT đặt lại ở ngày mới.</div>
                  {confirmedN > 0 && <div>Xe có chuyến đang xuất / đã quét / đã hoàn thành sẽ bị chừa và nêu lý do; đơn rớt lẻ thì đổi ngày từng đơn.</div>}
                </>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={onClose}>Huỷ</Button>
          <Button size="sm" className="h-8" disabled={busy || !date || date === plan.plan_date} onClick={() => void go()}>{busy ? 'Đang đổi…' : 'Đổi ngày'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
