// Cảnh báo + hỏi lý do LUÂN CHUYỂN — dùng CHUNG cho cả 3 màn quét xuất:
// GdoScanSheet (quét cấp đơn) · OutboundItemDetail (quét theo mã) · LoosePickingItemDetail (nhặt lẻ).
// Trước 14/08 cả 3 màn TỰ so `production_date > best_available_date` — 3 bản chép tay của cùng một
// luật, và cả 3 đều so NSX trong khi cột "Vị trí lấy" sắp theo HSD. Giờ: kết quả do BE tính
// (khối `rotation`), 3 màn chỉ hiển thị.
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { formatTimestampDate } from '@/utils/formatters'
import { ROTATION_REASONS, ROTATION_SHORT, type RotationCheck } from '@/utils/rotation'

export interface RotationGate {
  blocked: boolean                       // kho bắt buộc + quét sai thứ tự → khoá nút Lưu tới khi có lý do
  warn:    boolean                       // sai thứ tự nhưng kho chỉ cảnh báo
  ok:      boolean                       // đủ điều kiện Lưu (đã chọn lý do nếu cần)
  arg:     { rotation_override_reason?: string }   // spread thẳng vào body scan
  reset:   () => void                    // gọi khi quét tem mới
  banner:  React.ReactNode               // dòng ⚠ nhét trong thẻ kết quả quét
  reasonBox: React.ReactNode             // khối chọn lý do (null nếu không bị chặn)
}

export function useRotationGate(rot: RotationCheck | null | undefined): RotationGate {
  const [reason, setReason] = useState('')
  const [note,   setNote]   = useState('')

  const blocked = !!rot?.required && !!rot?.violation
  const warn    = !!rot?.violation && !rot?.required
  // Chọn "Khác" mà bỏ trống ghi chú thì lý do vô nghĩa → chưa cho Lưu
  const ok = !blocked || (!!reason && (reason !== 'OTHER' || !!note.trim()))

  return {
    blocked, warn, ok,
    arg: blocked ? { rotation_override_reason: reason === 'OTHER' ? `OTHER: ${note.trim()}` : reason } : {},
    reset: () => { setReason(''); setNote('') },
    banner: rot?.violation && rot.best_date ? (
      <p className={`text-[10px] font-medium mt-0.5 ${blocked ? 'text-red-600' : 'text-orange-600'}`}>
        ⚠ Trong kho còn {rot.date_label} {formatTimestampDate(rot.best_date)}
        {rot.best_location_code ? ` tại ${rot.best_location_code}` : ''} — {ROTATION_SHORT[rot.principle]} phải lấy cái đó trước
      </p>
    ) : null,
    reasonBox: blocked ? (
      <div className="rounded-lg border border-red-200 bg-white px-3 py-2.5 space-y-1.5">
        <p className="text-[11px] font-semibold text-red-700">Lý do lấy khác thứ tự (bắt buộc)</p>
        {ROTATION_REASONS.map(r => (
          <label key={r.code} className="flex items-center gap-2 text-[12px] text-slate-700 py-0.5">
            <input type="radio" name="rot-reason" className="h-3.5 w-3.5"
              checked={reason === r.code} onChange={() => setReason(r.code)} />
            {r.label}
          </label>
        ))}
        {reason === 'OTHER' && (
          <Input className="h-9 text-[12px]" placeholder="Ghi rõ lý do…"
            value={note} onChange={e => setNote(e.target.value)} maxLength={150} />
        )}
      </div>
    ) : null,
  }
}
