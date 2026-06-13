import { useEffect, useRef, useState } from 'react'

/**
 * useColumnResize — kéo giãn/thu cột cho bảng (kiểu Manhattan).
 * Lưu độ rộng vào localStorage theo `storageKey`. Dùng với <colgroup> + table-fixed.
 * Trả về: widths (px theo thứ tự cột) + startResize(index, e) gắn vào tay kéo ở header.
 */
export function useColumnResize(storageKey: string, defaults: number[], min = 44) {
  const [widths, setWidths] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr) && arr.length === defaults.length && arr.every(n => typeof n === 'number')) return arr
      }
    } catch {}
    return defaults
  })
  const drag = useRef<{ index: number; startX: number; startW: number } | null>(null)

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = drag.current
      if (!d) return
      const next = Math.max(min, d.startW + (e.clientX - d.startX))
      setWidths(w => { const c = [...w]; c[d.index] = next; return c })
    }
    function onUp() {
      if (!drag.current) return
      drag.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setWidths(w => { try { localStorage.setItem(storageKey, JSON.stringify(w)) } catch {} ; return w })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [storageKey, min])

  function startResize(index: number, e: React.PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    drag.current = { index, startX: e.clientX, startW: widths[index] }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const totalWidth = widths.reduce((s, w) => s + w, 0)
  return { widths, startResize, totalWidth }
}
