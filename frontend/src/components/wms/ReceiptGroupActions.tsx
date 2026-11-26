// THAO TÁC CẢ PHIẾU NHẬP CHUNG (26/11): Hoàn thành / Huỷ cả phiếu — xem trước danh sách (máy chủ trả will / short / keep,
// không ghi) rồi mới xác nhận. MỘT bản cho trang phiếu chung (InboundReceipt) và trang dòng mã (InboundDetail) — trước đây
// logic nằm riêng trong InboundDetail; trang phiếu chung ra đời thì gom về đây, không chép bản thứ hai.
import { useState } from 'react'
import type { AxiosError } from 'axios'
import { useInboundGroupActs, type InboundGroupBrief } from '@/api/hooks'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { qtyLabel } from '@/utils/qtyUnits'

const errMsg = (e: unknown, fb: string) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? fb

function BriefList({ arr = [], max = 8 }: { arr?: InboundGroupBrief[]; max?: number }) {
  return (
    <ul className="my-1 space-y-0.5 text-[12px]">
      {arr.slice(0, max).map(b => (
        <li key={b.id}>• <span className="font-mono font-semibold">{b.material_code ?? '—'}</span> <span className="text-slate-400">{b.import_code}</span>
          {' · '}nhận {qtyLabel(b.received, b)}{b.planned != null ? ` / KH ${qtyLabel(Number(b.planned), b)}` : ''}
          {b.planned != null && b.received > Number(b.planned) + 1e-9 ? <span className="text-blue-700"> (thừa {qtyLabel(b.received - Number(b.planned), b)})</span> : null}
          {b.reason ? <span className="text-slate-500"> — {b.reason}</span> : null}</li>
      ))}
      {arr.length > max && <li className="text-slate-400">… và {arr.length - max} mã khác</li>}
    </ul>
  )
}

/** `onError(null)` xoá băng lỗi trước mỗi lần bấm. `onCancelled(ids)` = id các dòng vừa huỷ (trang đang đứng ở dòng bị huỷ thì rời trang). */
export function useReceiptGroupActions({ onError, onCancelled, onCompleted }: {
  onError: (msg: string | null) => void
  onCancelled?: (ids: string[]) => void
  onCompleted?: (n: number) => void
}) {
  const acts = useInboundGroupActs()
  const [ask, node] = useConfirmDialog()
  const [busy, setBusy] = useState<'cancel' | 'complete' | null>(null)

  async function runComplete(group: string) {
    onError(null); setBusy('complete')
    try {
      const pv = await acts.complete.mutateAsync({ group, preview: true })
      const will = pv.will ?? [], short = pv.short ?? [], keep = pv.keep ?? []
      if (!will.length) { onError(keep.length ? `Chưa mã nào của phiếu nhận hàng — ${keep.length} mã giữ mở` : 'Phiếu không còn mã nào đang mở'); return }
      const over = will.filter(b => b.planned != null && b.received > Number(b.planned) + 1e-9)
      const yes = await ask({
        title: `Hoàn thành ${will.length} mã của phiếu?`, confirmLabel: 'Hoàn thành', cancelLabel: 'Quay lại',
        body: (
          <div className="whitespace-normal" data-testid="group-complete-confirm">
            <p>Hoàn thành <b>{will.length}</b> mã đã nhận hàng:</p><BriefList arr={will} />
            {short.length > 0 && (<><p className="mt-2 font-semibold text-amber-700">Trong đó {short.length} mã nhận THIẾU so kế hoạch:</p><BriefList arr={short} /></>)}
            {over.length > 0 && (<><p className="mt-2 font-semibold text-blue-700">{over.length} mã nhận THỪA so kế hoạch:</p><BriefList arr={over} /></>)}
            {keep.length > 0 && (<><p className="mt-2 text-slate-600">Giữ mở {keep.length} mã:</p><BriefList arr={keep} /></>)}
            <p className="mt-2 text-slate-500">Mã đã hoàn thành không quét thêm được — cần quét tiếp thì Gỡ hoàn thành ở dòng mã đó.</p>
          </div>
        ),
      })
      if (yes === null) return
      const r = await acts.complete.mutateAsync({ group, preview: false })
      onCompleted?.(r.completed ?? 0)
    } catch (e) { onError(errMsg(e, 'Không hoàn thành được phiếu')) } finally { setBusy(null) }
  }

  async function runCancel(group: string) {
    onError(null); setBusy('cancel')
    try {
      const pv = await acts.cancel.mutateAsync({ group, preview: true })
      const will = pv.will ?? [], keep = pv.keep ?? []
      if (!will.length) { onError(`Không có mã nào huỷ được — ${keep.length} mã đã có hàng hoặc đã hoàn thành (xoá pallet ở dòng mã trước)`); return }
      const yes = await ask({
        title: `Huỷ ${will.length} mã chưa nhận hàng của phiếu?`, confirmLabel: 'Huỷ phiếu', cancelLabel: 'Quay lại',
        body: (
          <div className="whitespace-normal" data-testid="group-cancel-confirm">
            <p>Huỷ (xoá) <b>{will.length}</b> mã chưa có pallet / chưa lưu hàng:</p><BriefList arr={will} />
            {keep.length > 0 && (<><p className="mt-2 text-slate-600">Giữ lại {keep.length} mã:</p><BriefList arr={keep} /></>)}
            <p className="mt-2 text-red-600">Không hoàn tác được.</p>
          </div>
        ),
      })
      if (yes === null) return
      await acts.cancel.mutateAsync({ group, preview: false })
      onCancelled?.(will.map(o => o.id))
    } catch (e) { onError(errMsg(e, 'Không huỷ được phiếu')) } finally { setBusy(null) }
  }

  return { runComplete, runCancel, busy, node }
}
