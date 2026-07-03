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
      const spaceBelow = window.innerHeight - r.bottom
      const spaceAbove = r.top
      const dropUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow

      let style: CSSProperties
      if (dialog) {
        // absolute neo theo hộp dialog (dialog là positioned ancestor) → không phụ thuộc transform
        const d = dialog.getBoundingClientRect()
        style = {
          position: 'absolute',
          left: r.left - d.left,
          width: r.width,
          ...(dropUp ? { bottom: d.bottom - r.top + 4 } : { top: r.bottom - d.top + 4 }),
        }
      } else {
        style = {
          position: 'fixed',
          left: r.left,
          width: r.width,
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
