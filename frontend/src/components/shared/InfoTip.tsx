// Dấu ⓘ + diễn giải trong tooltip — NGUỒN DUY NHẤT cho mọi form cấu hình (user chốt: "đưa các
// diễn giải vào tooltip thôi, để đơn giản"). Trước đây mỗi ô cấu hình kèm 2-3 dòng chữ xám bên
// dưới: form Kho dài gấp đôi màn hình, phải cuộn mới thấy nút Lưu.
//
// MỞ ĐƯỢC BẰNG CHẠM, không chỉ hover: Radix Tooltip nguyên bản chỉ mở khi hover/focus bàn phím và
// còn ĐÓNG khi pointerdown ⇒ trên tablet/điện thoại (kho dùng thật) diễn giải thành KHÔNG THỂ ĐỌC.
// Nên: kiểm soát `open` + chặn hành vi đóng-khi-bấm của Radix (`preventDefault` ở pointerdown —
// composeEventHandlers của Radix bỏ qua handler nội bộ khi event đã defaultPrevented), rồi tự lật
// mở/đóng ở onClick. Bấm ra ngoài / Esc vẫn đóng như thường.
//
// `preventDefault` ở onClick còn là lưới an toàn: lỡ đặt ⓘ trong <label> thì bấm vào nó cũng
// KHÔNG lật ô tick của label (bẫy label lồng nhau đã gặp 16/08).
import { useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function InfoTip({ tip, side = 'bottom', className }: {
  tip: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Giải thích"
          onPointerDown={e => e.preventDefault()}
          onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }}
          className={`shrink-0 cursor-help text-slate-400 hover:text-sky-600 ${className ?? ''}`}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-[280px] text-[11px] leading-snug">{tip}</TooltipContent>
    </Tooltip>
  )
}
