// Cảnh báo + hỏi lý do CẤT HÀNG cho VỊ TRÍ ĐẶT PHẦN DƯ — dùng CHUNG cho cả 3 màn quét xuất:
// GdoScanSheet (quét cấp đơn) · OutboundItemDetail (quét theo mã) · LoosePickingItemDetail (nhặt lẻ).
// Song sinh với `useRotationGate`: rotation hỏi "lấy pallet nào", cái này hỏi "đặt phần dư ở đâu".
//
// Kết luận (ô có vi phạm luật gì · kho có chặn cứng luật đó không) do BE trả trong khối `putaway`
// của từng dòng vị trí — FE KHÔNG tự suy từ cấu hình kho (đó là bản luật chép tay thứ N).
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { blockLabel, PUTAWAY_OVERRIDE_REASONS, type PutawayHint } from '@/utils/putaway'

export interface PutawayGate {
  blocked: boolean                                  // kho BẮT BUỘC + ô vi phạm → khoá Lưu tới khi có lý do
  ok:      boolean                                  // đủ điều kiện Lưu
  arg:     { putaway_override_reason?: string }     // spread thẳng vào body scan
  reset:   () => void                               // gọi khi quét tem mới / đổi vị trí
  box:     React.ReactNode                          // khối cảnh báo + chọn lý do (null nếu ô sạch)
}

export function usePutawayGate(hint: PutawayHint | null | undefined): PutawayGate {
  const [reason, setReason] = useState('')
  const [note,   setNote]   = useState('')

  const violation = hint?.blocked ?? null
  const blocked   = !!violation && hint?.enforced === true
  // Chọn "Khác" mà bỏ trống ghi chú thì lý do vô nghĩa → chưa cho Lưu
  const ok = !blocked || (!!reason && (reason !== 'OTHER' || !!note.trim()))

  return {
    blocked, ok,
    arg: blocked ? { putaway_override_reason: reason === 'OTHER' ? `OTHER: ${note.trim()}` : reason } : {},
    reset: () => { setReason(''); setNote('') },
    box: violation ? (
      <div className={`rounded-lg border px-3 py-2.5 space-y-1.5 ${blocked ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
        <p className={`text-[11px] font-semibold ${blocked ? 'text-red-700' : 'text-amber-800'}`}>
          ⚠ {blockLabel(violation)}
          {!blocked && ' — vẫn đặt được, kho chỉ nhắc'}
        </p>
        {blocked && (
          <>
            <p className="text-[11px] font-semibold text-red-700">Lý do đặt khác quy tắc (bắt buộc)</p>
            {PUTAWAY_OVERRIDE_REASONS.map(r => (
              <label key={r.code} className="flex items-center gap-2 text-[12px] text-slate-700 py-0.5">
                <input type="radio" name="put-reason" className="h-3.5 w-3.5"
                  checked={reason === r.code} onChange={() => setReason(r.code)} />
                {r.label}
              </label>
            ))}
            {reason === 'OTHER' && (
              <Input className="h-9 text-[12px]" placeholder="Ghi rõ lý do…"
                value={note} onChange={e => setNote(e.target.value)} maxLength={150} />
            )}
          </>
        )}
      </div>
    ) : null,
  }
}
