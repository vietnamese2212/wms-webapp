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
//
// ĐIỆN THOẠI KHÔNG DÙNG TOOLTIP (user chốt 16/09: "trên điện thoại tooltip như trên máy tính k đc"):
// khung nổi 280 px cạnh một nút 14 px là thứ của con trỏ chuột — trên màn 360 nó che mất chỗ vừa bấm,
// chữ 11 px, nút bên trong nhỏ hơn tầm ngón tay, và chạm hụt một nhát là đóng mất. Dưới `sm` mở thành
// TẤM TRƯỢT TỪ ĐÁY: rộng hết bề ngang, chữ 13 px, nút cao 44 px, có thanh kéo + nút Đóng rõ ràng.
// Cùng một `tip` cho cả hai lối — nơi gọi không phải biết mình đang ở màn nào.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Info, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** < 640 px (breakpoint `sm` của Tailwind) = màn cầm tay: PDA, điện thoại kho */
function useIsPhone() {
  const [p, setP] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const h = () => setP(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return p
}

export function InfoTip({ tip, side = 'bottom', className }: {
  /** Nội dung. Dạng HÀM khi bên trong có nút bấm — nhận sẵn `close` để tự đóng sau khi bấm
   *  (vd "Sửa diễn giải" ở tab KPI: mở form xong phải đóng tooltip, không thì nó nổi đè lên form). */
  tip: ReactNode | ((close: () => void) => ReactNode)
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const phone = useIsPhone()
  // ⚠️ MỌI hook phải đứng TRƯỚC nhánh return sớm của bản điện thoại — hook gọi sau return sớm làm
  // TRẮNG TRANG mà tsc/build/QA đều xanh (lớp lỗi 10/09, ratchet `hook_after_early_return` gác).
  const openAtPointerDown = useRef(false)
  const body = typeof tip === 'function' ? tip(() => setOpen(false)) : tip

  // ── ĐIỆN THOẠI: tấm trượt từ đáy ──────────────────────────────────────────────────────────────
  // Portal ra body + `pointer-events-auto`: InfoTip hay nằm TRONG form panel (Radix Dialog modal) đặt
  // `pointer-events:none` lên <body>, panel portal kế thừa `none` sẽ HIỆN mà KHÔNG bấm được.
  // `stopPropagation` ở pointerdown để DismissableLayer của dialog cha không đóng cả form.
  if (phone) {
    return (
      <>
        <button
          type="button"
          aria-label="Giải thích"
          onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}
          className={`shrink-0 cursor-help text-slate-400 hover:text-sky-600 ${className ?? ''}`}
        >
          <Info className="h-4 w-4" />
        </button>
        {open && createPortal(
          <div className="fixed inset-0 z-[210] pointer-events-auto" onPointerDown={e => e.stopPropagation()}>
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
            <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white shadow-2xl max-h-[70vh] flex flex-col">
              <div className="shrink-0 pt-2 pb-1 flex justify-center"><span className="h-1 w-10 rounded-full bg-slate-300" /></div>
              <div className="flex-1 min-h-0 overflow-auto px-4 pb-2 text-[13px] leading-relaxed text-slate-700
                [&_button]:min-h-11 [&_button]:text-[13px] [&_a]:min-h-11">
                {body}
              </div>
              <button type="button" onClick={() => setOpen(false)}
                className="shrink-0 m-3 h-11 rounded-xl bg-slate-100 text-[13px] font-medium text-slate-700 flex items-center justify-center gap-1">
                <X className="h-4 w-4" /> Đóng
              </button>
            </div>
          </div>, document.body)}
      </>
    )
  }
  // ── MÁY TÍNH: tooltip như cũ ──────────────────────────────────────────────────────────────────
  // ⚠️ KHÔNG lật theo `open` trong onClick. Đo thật trên Preview 17/08: chạm lần 2 KHÔNG đóng
  // được, vì một lượt chạm chạy 2 nhịp — DismissableLayer của TooltipContent nghe pointerdown
  // ở document, thấy bấm NGOÀI nội dung (nút ⓘ nằm ngoài) nên đã đặt open=false; tới onClick thì
  // `open` đã là false ⇒ lật lại thành true ⇒ mở mãi. Nhớ trạng thái TẠI LÚC pointerdown rồi
  // quyết định theo nó thì đúng cả 2 chiều. (preventDefault ở pointerdown chỉ chặn được handler
  // của CHÍNH nút, không chặn được listener document của DismissableLayer.)
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
      {/* ⚠️ Radix dựng THÊM một bản VisuallyHidden của nội dung này (mang role="tooltip") cho trình đọc
          màn hình. Nút bên trong vì thế có 2 bản; bản BẤM ĐƯỢC là bản hiển thị, đứng TRƯỚC trong DOM —
          kịch bản kiểm phải nhắm `.first()`, đừng lọc theo `[role="tooltip"] button` (trúng bản ẩn 1×1px). */}
      <TooltipContent side={side} className="z-[210] max-w-[280px] text-[11px] leading-snug pointer-events-auto">
        {body}
      </TooltipContent>
    </Tooltip>
  )
}
