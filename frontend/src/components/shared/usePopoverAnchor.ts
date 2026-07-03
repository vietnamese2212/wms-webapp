import { useLayoutEffect, useState, type RefObject } from 'react'

export interface AnchorRect {
  left: number
  top: number       // toạ độ để đặt menu (đã tính drop up/down)
  width: number
  dropUp: boolean
}

/**
 * Neo 1 popover render qua portal (position:fixed) theo nút trigger — KHÔNG bị
 * `overflow` của Dialog/Sheet cắt mất (bug "dropdown bị che" trong form panel phải).
 * Đo bằng getBoundingClientRect khi mở + theo dõi scroll/resize để bám nút.
 * Tự chọn drop lên khi thiếu chỗ bên dưới.
 */
export function usePopoverAnchor(
  triggerRef: RefObject<HTMLElement>,
  open: boolean,
  estimatedHeight = 260,
): AnchorRect | null {
  const [rect, setRect] = useState<AnchorRect | null>(null)

  useLayoutEffect(() => {
    if (!open) { setRect(null); return }
    const el = triggerRef.current
    if (!el) return

    const measure = () => {
      const r = el.getBoundingClientRect()
      const spaceBelow = window.innerHeight - r.bottom
      const spaceAbove = r.top
      const dropUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow
      setRect({
        left: r.left,
        top: dropUp ? r.top : r.bottom,
        width: r.width,
        dropUp,
      })
    }

    measure()
    // capture=true để bắt cả scroll của container cha (Dialog/Sheet body)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open, triggerRef, estimatedHeight])

  return rect
}
