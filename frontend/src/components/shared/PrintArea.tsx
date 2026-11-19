// VÙNG IN TEM — MỘT CHỖ cho mọi màn in (tem pallet, tem pallet của mẻ, tem vị trí). Lớp lỗi C120 (18/11).
//
// Vùng in (.pl-print-area / .lc-print-area) được CSS in đặt `position:absolute; left:0; top:0`. Đặt nó BÊN TRONG một khung
// trượt / hộp thoại (FormSheet, Dialog — `position:fixed` + `transform` + `overflow`) thì "góc trái trên" là góc của KHUNG,
// không phải của trang: bản in lệch sang phải đúng bằng chỗ khung đứng trên màn và bị cắt mất cột tem bên phải (user 18/11,
// in tem pallet của mẻ từ trang mẻ). Cùng gốc với dropdown bị che trong Dialog (skill table-format mục 17).
// ⇒ Vùng in LUÔN vẽ thẳng vào <body> qua portal, dù màn gọi in ở đâu. Ratchet `print_area_outside_portal` (09-static-gate)
//   cấm tự viết <div className="pl-print-area"> ở chỗ khác.
//
// printWhenReady: chờ ẢNH QR trong vùng in vẽ xong rồi mới mở hộp in. Canh giờ cố định (150 / 600 ms) là cuộc đua — nhiều tem
// thì in ra ô trống (ghi chú cũ ở locationLabel.tsx).
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function PrintArea({ className = 'pl-print-area', children }: { className?: 'pl-print-area' | 'lc-print-area'; children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(<div className={className} aria-hidden>{children}</div>, document.body)
}

/** Mở hộp in khi đủ `expected` ảnh QR trong vùng in đã tải xong (quá hạn chờ vẫn in — như trước).
 *  `onClosed`: gọi MỘT lần khi hộp in đóng (in xong hoặc bấm Huỷ — trình duyệt không cho biết là cái nào). */
export function printWhenReady(expected: number, selector = '.pl-print-area', onClosed?: () => void): void {
  const t0 = Date.now()
  const limit = Math.min(15_000, 3_000 + expected * 40)
  const tick = () => {
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(`${selector} img`))
    const ready = imgs.length >= expected && imgs.every(i => i.complete && i.naturalWidth > 0)
    if (ready || Date.now() - t0 > limit) {
      if (onClosed) {
        let done = false
        const fire = () => { if (!done) { done = true; window.removeEventListener('afterprint', fire); onClosed() } }
        window.addEventListener('afterprint', fire)
        window.print()
        if (!('onafterprint' in window)) setTimeout(fire, 500)   // trình duyệt không có sự kiện afterprint (hiếm) vẫn hỏi
        return
      }
      window.print(); return
    }
    window.setTimeout(tick, 60)
  }
  window.setTimeout(tick, 60)
}
