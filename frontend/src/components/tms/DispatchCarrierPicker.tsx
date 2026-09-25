// ĐỔI ĐVVT NGAY TRÊN THẺ XE (user 25/09: "việc đổi ĐVVT có thể đổi theo thẻ, có tiền trong đó — xếp theo rank").
// Bấm tên ĐVVT trên thẻ ⇒ danh sách ĐVVT của kho XẾP THEO CƯỚC cho đúng xe này (cùng `priceFor` với engine — số tiền trên
// danh sách = số tiền xe nhận sau khi chọn), kèm chênh lệch so với ĐVVT đang chọn, tỷ trọng tháng so với mục tiêu và phân
// tuyến. ĐVVT không có cước cho tuyến/dòng xe này xuống cuối kèm lý do — vẫn chọn được (người quyết), cước để trống.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, Send } from 'lucide-react'
import { usePopoverAnchor } from '@/components/shared/usePopoverAnchor'
import { useDispatchTripCarriers, type DispatchTrip } from '@/api/hooks'

const nf = (n: number, d = 0) => n.toLocaleString('vi-VN', { maximumFractionDigits: d })
const money = (n: number | string | null | undefined) => {
  if (n == null) return '—'
  const v = Number(n), a = Math.abs(v)
  return a >= 1e6 ? `${nf(v / 1e6, 2)} tr` : `${nf(v)} ₫`
}

export function DispatchCarrierPicker({ trip, editable, busy, onPick }: {
  trip: DispatchTrip; editable: boolean; busy: boolean; onPick: (carrierId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const anchor = usePopoverAnchor(btn, open, 320)
  const q = useDispatchTripCarriers(trip.id, open)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { const t = e.target as Node; if (!btn.current?.contains(t) && !panel.current?.contains(t)) setOpen(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open])

  const c = trip.detail.carrier
  const label = c ? <><b className="font-mono">{c.code}</b> <span className="break-words">{c.name}</span></> : <span className="text-red-600">Chưa có ĐVVT</span>
  if (!editable) return <div className="text-[10px] text-slate-600 leading-tight">{label}</div>
  const items = q.data?.items ?? []
  const cur = items.find(i => i.current)?.freight ?? null
  return (
    <>
      <button ref={btn} type="button" disabled={busy} onClick={() => setOpen(o => !o)}
        title="Đổi ĐVVT — danh sách xếp theo cước cho đúng xe này"
        className="inline-flex max-w-full items-start gap-0.5 rounded px-1 -mx-1 text-left text-[10px] text-slate-600 leading-tight hover:bg-sky-50 hover:text-sky-800">
        <span className="min-w-0">{label}</span><ChevronDown className="h-3 w-3 shrink-0 mt-px" />
      </button>
      {open && anchor && createPortal(
        <div ref={panel} onPointerDown={e => e.stopPropagation()}
          style={{ ...anchor.style, width: Math.max(300, Number(anchor.style.width) || 0) }}
          className="z-[60] pointer-events-auto overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg text-[11px]">
          <div className="sticky top-0 border-b bg-slate-50 px-2 py-1 text-[10px] text-slate-500">
            ĐVVT xếp theo cước cho #{trip.seq}{q.data?.vehicle_model ? ` · ${q.data.vehicle_model.name}` : ''}
          </div>
          {q.isLoading && <div className="px-2 py-3 text-slate-400">Đang tính cước…</div>}
          {q.isError && <div className="px-2 py-3 text-red-600">Không tải được danh sách ĐVVT</div>}
          {!q.isLoading && !items.length && !q.isError && <div className="px-2 py-3 text-slate-400">Kho chưa có ĐVVT nào có cước / phân tuyến</div>}
          {items.map((it, i) => {
            const d = it.freight != null && cur != null && !it.current ? it.freight - cur : null
            const under = it.target_pct != null && it.share_pct != null && it.share_pct < it.target_pct
            return (
              <button key={it.id} type="button" disabled={busy || it.current}
                onClick={() => { setOpen(false); onPick(it.id) }}
                className={`w-full flex items-start gap-2 px-2 py-1.5 text-left border-b border-slate-100 last:border-0 ${it.current ? 'bg-sky-50' : 'hover:bg-slate-50'}`}>
                <span className={`mt-px w-5 shrink-0 text-center tabular-nums font-semibold ${it.freight == null ? 'text-slate-300' : i === 0 ? 'text-green-700' : 'text-slate-500'}`}>{it.freight == null ? '—' : i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    <b className="font-mono">{it.code}</b><span className="break-words">{it.name}</span>
                    {it.tender_required && <Send className="h-3 w-3 text-sky-600 shrink-0" aria-label="cần phản hồi" />}
                    {it.current && <Check className="h-3.5 w-3.5 text-sky-700 shrink-0" />}
                  </span>
                  <span className="block text-[10px] text-slate-500">
                    {it.share_pct != null || it.target_pct != null ? <span className={under ? 'text-amber-700 font-medium' : ''}>tháng {it.share_pct == null ? '—' : `${nf(it.share_pct, 1)}%`}{it.target_pct != null ? ` / mục tiêu ${it.target_pct}%` : ''}</span> : null}
                    {it.alloc ? <>{it.share_pct != null || it.target_pct != null ? ' · ' : ''}{it.alloc}</> : null}
                    {it.freight == null && it.reason ? <span className="block text-amber-700">{it.reason}</span> : null}
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className={`block font-semibold ${it.freight == null ? 'text-slate-300 font-normal' : ''}`}>{it.freight == null ? 'chưa có cước' : money(it.freight)}</span>
                  {d != null && d !== 0 && <span className={`block text-[10px] ${d > 0 ? 'text-red-600' : 'text-green-700'}`}>{d > 0 ? '+' : '−'}{money(Math.abs(d))}</span>}
                </span>
              </button>
            )
          })}
        </div>, anchor.target)}
    </>
  )
}
