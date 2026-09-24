import { useEffect, useRef, useState } from 'react'

/**
 * useColumnResize — kéo giãn/thu cột cho bảng (kiểu Manhattan).
 * Lưu độ rộng vào localStorage theo `storageKey`. Dùng với <colgroup> + table-fixed.
 * Trả về: widths (px theo thứ tự cột) + startResize(index, e) gắn vào tay kéo ở header.
 */
export function useColumnResize(storageKey: string, defaults: number[], min = 44) {
  function load(key: string, def: number[]): number[] {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr) && arr.length === def.length && arr.every(n => typeof n === 'number')) return arr
      }
    } catch {}
    return def
  }
  // ⚠️ KHOÁ ĐỘNG (mỗi tab một bộ cột) PHẢI NẠP LẠI KHI ĐỔI TAB.
  // Bug thật 13/09/2026 ở Việc cần làm: `useState` chỉ chạy hàm khởi tạo MỘT LẦN, nên đổi sang tab
  // có SỐ CỘT KHÁC thì mảng độ rộng của tab CŨ ở lại — `<colgroup>` thiếu <col> cho cột cuối, mà
  // `table-fixed` cho cột không có <col> độ rộng 0 ⇒ **cột thao tác thu về 0 px và hai nút "Nhận" /
  // "Xong" văng ra NGOÀI màn** (đo ở 1280 px: nút nằm ở 1270–1362, cuộn hết cỡ vẫn không tới).
  // Không lỗi nào nổ, tsc/build/QA đều xanh — cùng lớp với ca nút Lọc đè tab 12/09.
  const [state, setState] = useState<{ key: string; widths: number[] }>(
    () => ({ key: storageKey, widths: load(storageKey, defaults) }),
  )
  if (state.key !== storageKey || state.widths.length !== defaults.length) {
    setState({ key: storageKey, widths: load(storageKey, defaults) })   // đặt state khi render = cách React tự đặt lại state dẫn xuất
  }
  const widths = state.widths
  const setWidths = (fn: (w: number[]) => number[]) => setState(s => ({ ...s, widths: fn(s.widths) }))
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
