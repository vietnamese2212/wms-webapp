// Bề rộng thật của một phần tử (px), cập nhật khi khung đổi cỡ — cho biểu đồ SVG tự vẽ theo bề ngang (KPI, Báo cáo NVL).
import { useEffect, useRef, useState } from 'react'

export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const ro = new ResizeObserver(es => { for (const e of es) setW(e.contentRect.width) })
    ro.observe(el); setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}
