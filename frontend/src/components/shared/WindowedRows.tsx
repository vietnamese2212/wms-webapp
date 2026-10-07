// Dòng của bảng dài chỉ vẽ phần đang thấy (07/10, C65 — xem `utils/rowWindow`). Đặt trong <TableBody>, khung cuộn là phần tử của `scrollRef`.
// Dòng phải CAO ĐỀU (ô `whitespace-nowrap` / `truncate`): chiều cao đo từ dòng thật đầu tiên đang vẽ, dòng đệm = số dòng khuất × chiều cao đó.
// Cuộn chỉ vẽ lại khối này, không chạy lại phần tính của bảng cha.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { rowWindow } from '@/utils/rowWindow'

export function WindowedRows({ scrollRef, count, colSpan, row }: {
  scrollRef: RefObject<HTMLElement>
  count: number
  colSpan: number
  row: (i: number) => ReactNode   // dòng thứ i (một <TableRow key=…>)
}) {
  const [vp, setVp] = useState(() => ({ top: 0, height: typeof window === 'undefined' ? 900 : window.innerHeight }))
  const [rowH, setRowH] = useState(32)
  const topRef = useRef<HTMLTableRowElement>(null), bottomRef = useRef<HTMLTableRowElement>(null)
  // gắn nghe cuộn ở effect thường (không phải layout): lúc mount, ref của khung cuộn (phần tử CHA) gắn sau layout effect của con
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const read = () => { raf = 0; setVp(v => (v.top === el.scrollTop && v.height === el.clientHeight ? v : { top: el.scrollTop, height: el.clientHeight })) }
    const onChange = () => { if (!raf) raf = requestAnimationFrame(read) }
    read()
    el.addEventListener('scroll', onChange, { passive: true })
    const ro = new ResizeObserver(onChange)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', onChange); ro.disconnect(); if (raf) cancelAnimationFrame(raf) }
  }, [scrollRef])
  // đo chiều cao dòng thật (cỡ chữ / mật độ đổi thì tự theo)
  useLayoutEffect(() => {
    const tr = topRef.current?.nextElementSibling
    if (!tr || tr === bottomRef.current) return
    const h = tr.getBoundingClientRect().height
    if (h > 0 && Math.abs(h - rowH) > 0.5) setRowH(h)
  })
  const w = rowWindow({ top: vp.top, height: vp.height, rowH, count })
  const pad = (h: number) => <td colSpan={colSpan} style={{ height: h, padding: 0, border: 0 }} />
  const out: ReactNode[] = []
  for (let i = w.start; i < w.end; i++) out.push(row(i))
  return (
    <>
      <tr ref={topRef} aria-hidden>{pad(w.padTop)}</tr>
      {out}
      <tr ref={bottomRef} aria-hidden>{pad(w.padBottom)}</tr>
    </>
  )
}
