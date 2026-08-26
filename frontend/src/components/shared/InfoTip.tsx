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
import { useRef, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function InfoTip({ tip, side = 'bottom', className }: {
  tip: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  // ⚠️ KHÔNG lật theo `open` trong onClick. Đo thật trên Preview 17/08: chạm lần 2 KHÔNG đóng
  // được, vì một lượt chạm chạy 2 nhịp — DismissableLayer của TooltipContent nghe pointerdown
  // ở document, thấy bấm NGOÀI nội dung (nút ⓘ nằm ngoài) nên đã đặt open=false; tới onClick thì
  // `open` đã là false ⇒ lật lại thành true ⇒ mở mãi. Nhớ trạng thái TẠI LÚC pointerdown rồi
  // quyết định theo nó thì đúng cả 2 chiều. (preventDefault ở pointerdown chỉ chặn được handler
  // của CHÍNH nút, không chặn được listener document của DismissableLayer.)
  const openAtPointerDown = useRef(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Giải thích"
          onPointerDown={e => { e.preventDefault(); openAtPointerDown.current = open }}
          onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(!openAtPointerDown.current) }}
          className={`shrink-0 cursor-help text-slate-400 hover:text-sky-600 ${className ?? ''}`}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      {/* z-[210]: TooltipContent gốc z-[60] CHÌM DƯỚI overlay full-màn z-[120] (sơ đồ xếp xe 3D)
          — user 26/08 "info không hiện thông tin". Tooltip transient nên nổi trên tất cả là an toàn. */}
      <TooltipContent side={side} className="z-[210] max-w-[280px] text-[11px] leading-snug">{tip}</TooltipContent>
    </Tooltip>
  )
}
