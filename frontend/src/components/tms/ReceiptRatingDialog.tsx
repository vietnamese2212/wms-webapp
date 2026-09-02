// CHẤM SAO CHUYẾN GIAO — kho nhận đánh giá lô hàng vừa nhận (28/08).
//
// Đặt ngay trong luồng nhận hàng chứ không làm biểu mẫu riêng: khảo sát nào phải nhớ mới điền thì
// sẽ không ai điền. Lý do chọn từ DANH SÁCH CỐ ĐỊNH (không gõ tự do) để cuối kỳ còn gom nhóm được
// nguyên nhân — cùng bài học với lý do vượt thứ tự luân chuyển.
import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { useReceiptRating, useRateReceipt } from '@/api/hooks'

export const RATING_REASONS = [
  { value: 'SHORT',   label: 'Giao thiếu hàng' },
  { value: 'WRONG',   label: 'Sai hàng / sai lô' },
  { value: 'DAMAGED', label: 'Hàng hư hỏng, móp bẹp' },
  { value: 'LATE',    label: 'Xe tới trễ' },
  { value: 'DOC',     label: 'Chứng từ thiếu / sai' },
  { value: 'OTHER',   label: 'Khác' },
]

export function StarRow({ value, onPick, size = 'md' }: {
  value: number; onPick?: (n: number) => void; size?: 'sm' | 'md'
}) {
  const cls = size === 'sm' ? 'h-3.5 w-3.5' : 'h-7 w-7'
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" disabled={!onPick} onClick={() => onPick?.(n)}
          aria-label={`${n} sao`}
          className={onPick ? 'transition-transform hover:scale-110' : 'cursor-default'}>
          <Star className={`${cls} ${n <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
        </button>
      ))}
    </div>
  )
}

/**
 * `onSaved`: gọi SAU khi lưu sao xong (thay cho onClose) — dùng khi ô chấm sao đứng CHẶN trước bước
 * Hoàn thành (user chốt 02/09 "hoàn thành đơn thì phải đánh sao luôn"). `onSkip`: có = hiện nút
 * "Bỏ qua, hoàn thành" (chế độ optional); required thì không truyền → không bỏ qua được.
 */
export function ReceiptRatingDialog({ orderId, open, onClose, onSaved, onSkip }: {
  orderId: string; open: boolean; onClose: () => void
  onSaved?: () => void; onSkip?: () => void
}) {
  const { data } = useReceiptRating(open ? orderId : null)
  const rate = useRateReceipt()
  const [stars, setStars] = useState(0)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  // Mở lại phiếu đã chấm thì hiện đúng điểm cũ để SỬA, không bắt chấm lại từ đầu
  useEffect(() => {
    if (!open) return
    setStars(data?.rating?.stars ?? 0)
    setReason(data?.rating?.reason_code ?? '')
    setNote(data?.rating?.note ?? '')
    setErr('')
  }, [open, data?.rating])

  const needReason = stars > 0 && stars <= 3

  async function save() {
    setErr('')
    if (!stars) { setErr('Chọn số sao đã'); return }
    if (needReason && !reason) { setErr('Chấm từ 3 sao trở xuống phải chọn lý do'); return }
    try {
      await rate.mutateAsync({ orderId, stars, reason_code: reason || null, note: note.trim() || null })
      if (onSaved) onSaved(); else onClose()
    } catch (e) {
      setErr((e as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message ?? 'Lỗi lưu đánh giá')
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !rate.isPending) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{onSaved ? 'Chấm sao chuyến giao trước khi hoàn thành' : 'Đánh giá chuyến giao'}</DialogTitle>
          <p className="text-xs text-slate-500 mt-1">
            Kho nhận chấm chất lượng lô hàng vừa nhận — hàng, chứng từ, giờ xe.
            {onSaved && !onSkip && <> Đơn vị đang <b>bắt buộc</b> chấm sao mới hoàn thành được phiếu nhận.</>}
            {data?.rating && <> Đã chấm bởi <b>{data.rating.rated_by_name ?? '—'}</b>, sửa lại được.</>}
          </p>
        </DialogHeader>

        <div className="py-2 space-y-3">
          <div className="flex flex-col items-center gap-1.5">
            <StarRow value={stars} onPick={setStars} />
            <span className="text-[11px] text-slate-500">
              {stars === 0 ? 'Chưa chấm' : ['Rất tệ', 'Tệ', 'Tạm được', 'Tốt', 'Rất tốt'][stars - 1]}
            </span>
          </div>

          {needReason && (
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-slate-600">Lý do <span className="text-red-500">*</span></label>
              <SingleSelect options={RATING_REASONS} value={reason} onChange={setReason}
                placeholder="Chọn lý do" triggerClassName="w-full" searchable={false} />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-600">Ghi chú (không bắt buộc)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500}
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
              placeholder="Mô tả thêm để kho gửi biết đường sửa…" />
          </div>

          {err && <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-600">{err}</div>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={rate.isPending}>Hủy</Button>
          {onSkip && (
            <Button variant="outline" size="sm" onClick={onSkip} disabled={rate.isPending}
              title="Không chấm sao lần này, hoàn thành luôn">Bỏ qua, hoàn thành</Button>
          )}
          <Button size="sm" onClick={save} disabled={rate.isPending}>
            {rate.isPending ? 'Đang lưu…' : onSaved ? 'Chấm sao & hoàn thành' : 'Lưu đánh giá'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
