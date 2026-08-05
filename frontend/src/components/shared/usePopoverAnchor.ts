import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

export interface PopoverAnchor {
  /** Node để portal menu vào: node dialog nếu trigger nằm trong Dialog/Sheet, ngược lại là body. */
  target: HTMLElement
  /** Style sẵn để spread lên menu (đã gồm position + toạ độ + width). */
  style: CSSProperties
  dropUp: boolean
}

/**
 * Neo 1 popover render qua portal, KHÔNG bị `overflow` của Dialog/Sheet cắt.
 *
 * - Nếu trigger nằm TRONG Dialog/Sheet (`[role=dialog]`): portal menu vào chính node dialog
 *   + `position:absolute` neo theo hộp dialog. Cần thiết vì Radix (modal) dùng react-remove-scroll
 *   + pointer-events:none trên body → menu portal ra body sẽ KHÔNG cuộn/không bấm được.
 * - Ngoài dialog (toolbar…): portal ra body + `position:fixed` theo viewport.
 * Tự chọn drop lên/xuống theo chỗ trống. Bám trigger khi scroll/resize.
 */
export function usePopoverAnchor(
  triggerRef: RefObject<HTMLElement>,
  open: boolean,
  estimatedHeight = 260,
): PopoverAnchor | null {
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null)

  useLayoutEffect(() => {
    if (!open) { setAnchor(null); return }
    const el = triggerRef.current
    if (!el) return
    const dialog = el.closest('[role="dialog"]') as HTMLElement | null
    const target = dialog ?? document.body

    const measure = () => {
      const r = el.getBoundingClientRect()
      // Trong Dialog: menu là con ABSOLUTE của hộp dialog, mà DialogContent có
      // `overflow-y-auto` → vượt quá đáy HỘP là bị cắt ("Giao cho" ở đáy dialog Fill hàng:
      // menu mở xuống dưới bị che mất, 05/08). Chỗ trống phải đo theo HỘP DIALOG (giao với
      // viewport), không phải theo màn hình; và kẹp maxHeight để menu không bao giờ tràn hộp.
      const d = dialog?.getBoundingClientRect()
      const boxTop    = d ? Math.max(d.top, 0) : 0
      const boxBottom = d ? Math.min(d.bottom, window.innerHeight) : window.innerHeight
      const spaceBelow = boxBottom - r.bottom
      const spaceAbove = r.top - boxTop
      const dropUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow
      const maxHeight = Math.max(120, Math.min(estimatedHeight, (dropUp ? spaceAbove : spaceBelow) - 8))

      let style: CSSProperties
      if (dialog && d) {
        // absolute neo theo hộp dialog (dialog là positioned ancestor) → không phụ thuộc transform
        style = {
          position: 'absolute',
          left: r.left - d.left,
          width: r.width,
          maxHeight,
          ...(dropUp ? { bottom: d.bottom - r.top + 4 } : { top: r.bottom - d.top + 4 }),
        }
      } else {
        style = {
          position: 'fixed',
          left: r.left,
          width: r.width,
          maxHeight,
          ...(dropUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
        }
      }
      setAnchor({ target, style, dropUp })
    }

    measure()
    // capture=true để bắt cả scroll của thân Dialog/Sheet
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open, triggerRef, estimatedHeight])

  return anchor
}
